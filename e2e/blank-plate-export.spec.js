import { test, expect } from '@playwright/test';
import { deflateSync } from 'zlib';
import {
  clearIndexedDB, createProject, getProjectPageIds, loadPageById,
  addSolidColorImage, addTextLayer, addImageFromBuffer, setLayerColorDirect,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

// ── Fixtures ────────────────────────────────────────────────────────────────

// Minimal fully-transparent RGBA PNG (color type 6, every byte zero). A layer
// imported from it has image geometry but no image information at all.
function createTransparentPngBuffer(width, height) {
  const writePngChunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc32 = (() => {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
      }
      return buf => {
        let c = 0xffffffff;
        for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
      };
    })();
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])));
    return Buffer.concat([len, Buffer.from(type, 'ascii'), data, crcBuf]);
  };
  const imageData = Buffer.alloc((1 + width * 4) * height); // zeros = transparent
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  return Buffer.concat([
    signature,
    writePngChunk('IHDR', ihdrData),
    writePngChunk('IDAT', deflateSync(imageData)),
    writePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The selected layer becomes a "layer without image information": an empty
 * text box that still carries its ink color. The plate list keeps enumerating
 * its color, but rendering it produces not a single inked pixel.
 */
async function emptySelectedTextLayer(page) {
  await page.evaluate(async () => {
    const { DB } = await import('/src/app/db.js');
    const layer = State.layers.find(l => l.id === State.selectedId);
    layer.text = '';
    layer._originalCanvas = null;
    layer._exportOriginalCanvas = null;
    layer._dirty = true;
    await DB.saveLayer(layer);
  });
}

/**
 * Record every progress-widget state during an export (label / stage /
 * metrics), deduplicated — same harness as export-progress.spec.js.
 */
async function recordProgress(page) {
  await page.evaluate(() => {
    const root = document.querySelector('#export-progress');
    window.__progLog = [];
    const read = () => ({
      label: root.querySelector('.export-progress-label')?.textContent ?? '',
      stage: root.querySelector('.export-progress-stage')?.textContent ?? '',
      metrics: root.querySelector('.export-progress-metrics')?.textContent ?? '',
    });
    let last = null;
    const snap = () => {
      const cur = read();
      if (last && last.label === cur.label && last.stage === cur.stage && last.metrics === cur.metrics) return;
      last = cur;
      window.__progLog.push(cur);
    };
    new MutationObserver(snap).observe(root, { subtree: true, childList: true, characterData: true });
    snap();
  });
}

const progressText = page => page.evaluate(() =>
  window.__progLog.map(e => `${e.label}\n${e.stage}\n${e.metrics}`).join('\n'));

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Blank plate skipping', () => {
  test('single-image export saves no file for an ink with no image information', async ({ page }) => {
    await createProject(page, 'Blank Plate Single');
    // A real ink: a solid-color image recolored Blue.
    await addSolidColorImage(page, '#000000', { width: 900, height: 900 });
    await setLayerColorDirect(page, '#0078bf');
    // A blank ink: an empty text layer recolored Red. Its plate is enumerated
    // but has nothing to print.
    await addTextLayer(page, 'Hello');
    await emptySelectedTextLayer(page);
    await setLayerColorDirect(page, '#f65058');

    await recordProgress(page);
    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();

    // Pre-condition: the blank ink is still enumerated in the dialog list —
    // the skip happens because it renders empty, not because it is unknown.
    await expect(page.locator('#export-color-list')).toContainText('Blue');
    await expect(page.locator('#export-color-list')).toContainText('Red');

    const downloads = [];
    page.on('download', d => downloads.push(d));
    await page.click('#btn-export-go');
    await expect(page.locator('#export-progress .export-progress-label'))
      .toContainText('Done!', { timeout: 60000 });

    // Exactly one real file — the Blue plate. No Red file exists.
    expect(downloads).toHaveLength(1);
    expect(downloads[0].suggestedFilename()).toMatch(/blank-plate-single-blue\.png$/);
    expect(downloads[0].suggestedFilename()).not.toContain('red');

    // The summary counts only real plates and notes the skipped blank; the
    // progress accounting stays consistent (1 of 1, bar complete).
    const label = await page.locator('#export-progress .export-progress-label').textContent();
    expect(label).toContain('Done! 1 plate exported');
    expect(label).toContain('1 blank skipped');
    await expect(page.locator('#export-progress .export-progress-metrics')).toContainText('1 / 1 plates');
    expect(await progressText(page)).toMatch(/nothing printed in this ink — plate skipped/);
  });

  test('booklet export saves no blank sheets for inks with nothing to print', async ({ page }) => {
    await createProject(page, 'Blank Plate Booklet', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    // Page 1: a Blue layer that prints, plus a Red empty text layer that
    // never prints anywhere in the book.
    await loadPageById(page, pageIds[0]);
    await addSolidColorImage(page, '#000000', { width: 900, height: 900 });
    await setLayerColorDirect(page, '#0078bf');
    await addTextLayer(page, 'Hello');
    await emptySelectedTextLayer(page);
    await setLayerColorDirect(page, '#f65058');
    // Page 2: Yellow only. Pages 3 and 4: Blue again, so Blue prints on both
    // sheet sides while Yellow prints only on side 2.
    await loadPageById(page, pageIds[1]);
    await addSolidColorImage(page, '#000000', { width: 900, height: 900 });
    await setLayerColorDirect(page, '#ffe800');
    for (const pid of [pageIds[2], pageIds[3]]) {
      await loadPageById(page, pid);
      await addSolidColorImage(page, '#000000', { width: 900, height: 900 });
      await setLayerColorDirect(page, '#0078bf');
    }

    await recordProgress(page);
    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();
    // Pick the paper first: folio is disabled while the dialog's default
    // "Current image size" target is too small for a folio spread.
    await page.selectOption('#export-target-size', 'letter');
    await page.locator('input[name="export-booklet-layout"][value="folio"]').click();

    const downloads = [];
    page.on('download', d => downloads.push(d));
    await page.click('#btn-export-go');
    await expect(page.locator('#export-progress .export-progress-label'))
      .toContainText('Done!', { timeout: 60000 });

    // 4 folio pages → 2 sides. Blue prints on both sides (2 files), Yellow
    // only on side 2 (1 file), Red nowhere. No blank white sheets are saved.
    expect(downloads).toHaveLength(3);
    const names = downloads.map(d => d.suggestedFilename());
    expect(names).toContain('blank-plate-booklet-blue-sheet-1.png');
    expect(names).toContain('blank-plate-booklet-blue-sheet-2.png');
    expect(names).toContain('blank-plate-booklet-yellow-sheet-2.png');
    expect(names.some(n => n.includes('red'))).toBe(false);
    expect(names).not.toContain('blank-plate-booklet-yellow-sheet-1.png');

    // Summary counts only real sheets and reports the skipped blanks.
    const label = await page.locator('#export-progress .export-progress-label').textContent();
    expect(label).toContain('Done! 3 sheets');
    expect(label).toContain('3 blank plates skipped');
    expect(label).toContain('4 pages');
    await expect(page.locator('#export-progress .export-progress-metrics')).toContainText('3 / 3 plates');
    expect(await progressText(page)).toMatch(/nothing printed in this ink — plate skipped/);
  });

  test('blank plates are genuinely empty — every enumerated plate still renders, only the file is skipped', async ({ page }) => {
    await createProject(page, 'Blank Plate Layers');
    await addSolidColorImage(page, '#000000', { width: 900, height: 900 });
    await setLayerColorDirect(page, '#0078bf');
    // A fully transparent image: geometry without image information.
    await addImageFromBuffer(page, createTransparentPngBuffer(600, 400), { name: 'transparent.png' });
    await setLayerColorDirect(page, '#ff48b0');

    // exportLayers renders EVERY enumerated plate (it is the look-at-all-plates
    // API). The transparent-ink plate must come out entirely white — proving
    // the exporters skip it because it is blank, not because it was missed.
    const result = await page.evaluate(async () => {
      const { ExportEngine } = await import('/src/app/export-engine.js');
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
      const plates = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);
      const out = {};
      for (const [color, canvas] of plates.entries()) {
        // Downscaled scan for the darkest pixel: 255 means no ink anywhere.
        const s = new OffscreenCanvas(64, 64);
        const sctx = s.getContext('2d', { willReadFrequently: true });
        sctx.drawImage(canvas, 0, 0, 64, 64);
        const d = sctx.getImageData(0, 0, 64, 64).data;
        let minGrey = 255;
        for (let i = 0; i < d.length; i += 4) if (d[i] < minGrey) minGrey = d[i];
        out[color] = { minGrey, w: canvas.width, h: canvas.height };
      }
      return out;
    });

    expect(Object.keys(result).sort()).toEqual(['#0078bf', '#ff48b0']);
    expect(result['#0078bf'].minGrey).toBeLessThan(128);
    expect(result['#ff48b0'].minGrey).toBe(255);
    expect(result['#ff48b0'].w).toBe(3300);
    expect(result['#ff48b0'].h).toBe(5100);
  });
});
