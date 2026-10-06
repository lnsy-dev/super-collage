import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, gotoApp, getProjectPageIds, loadPageById,
  addImageFromBuffer, createSolidPngBuffer, setLayerColorDirect,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

const INKS = ['#FF0000', '#00FF00', '#0000FF'];

/** Give every page one layer per ink, so each page carries all its plates. */
async function buildInkPages(page, inks) {
  const pageIds = await getProjectPageIds(page);
  for (const id of pageIds) {
    await loadPageById(page, id);
    for (const ink of inks) {
      await addImageFromBuffer(page, createSolidPngBuffer('#000000', 900, 900), { name: 'ink.png' });
      await setLayerColorDirect(page, ink);
    }
    await page.evaluate(() => window.PageManager.saveActivePage());
  }
  return pageIds;
}

/**
 * Record every state the progress widget passes through during an export:
 * label (which unit), stage (what is happening right now) and metrics
 * (plates / elapsed / ETA / bytes). Deduplicated, so a stalled line is logged
 * once.
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

const lastEntry = page => page.evaluate(() => window.__progLog[window.__progLog.length - 1]);

/** Open the plates dialog, record progress, export, and wait for completion. */
async function runPlateExport(page, { configure = null, timeout = 150000 } = {}) {
  await recordProgress(page);
  await page.click('.menu-item[data-menu="file"]');
  await page.click('[data-action="export"]');
  await expect(page.locator('#export-dialog')).toBeVisible();
  if (configure) await configure();
  const downloads = [];
  page.on('download', d => downloads.push(d));
  await page.click('#btn-export-go');
  await expect(page.locator('#export-progress .export-progress-label'))
    .toContainText('Done!', { timeout });
  return downloads;
}

test.describe('Export progress reporting', () => {
  test('booklet export reports sheet, ink, page, layer, encode and save stages', async ({ page }) => {
    test.setTimeout(180000);
    await createProject(page, 'Progress Booklet', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await buildInkPages(page, INKS);
    expect(pageIds).toHaveLength(4);

    const downloads = await runPlateExport(page, {
      configure: async () => {
        await page.locator('input[name="export-booklet-layout"][value="folio"]').click();
        await page.selectOption('#export-target-size', 'letter');
      },
    });

    // 4 pages impose as one sheet: 2 sides × 3 inks.
    expect(downloads).toHaveLength(6);

    const text = await progressText(page);

    // Label: which unit is in flight — sheet, ink and position in the run.
    expect(text).toMatch(/Sheet 1 of 2 · .+ ink · plate 1 of 6/);
    expect(text).toMatch(/Sheet 2 of 2 · .+ ink · plate \d of 6/);

    // Stage: page-by-page and layer-by-layer detail inside that unit.
    expect(text).toMatch(/page \d of 4 — checking content/);
    expect(text).toMatch(/page \d of 4 — loading \d+ layers?/);
    expect(text).toMatch(/rendering layer \d+ of \d+ ·/);
    expect(text).toMatch(/page \d of 4 — flattening/);
    expect(text).toMatch(/encoding .*sheet-\d+\.png/);
    expect(text).toMatch(/saving .*sheet-\d+\.png/);

    // Metrics: counts, elapsed time, ETA and bytes written.
    expect(text).toMatch(/\d \/ \d plates/);
    expect(text).toMatch(/⏱/);
    expect(text).toMatch(/~\S+ left/);
    expect(text).toMatch(/\d+(\.\d+)? (MB|GB)/);

    // Final state: a summary with the full accounting, empty stage line.
    const last = await lastEntry(page);
    expect(last.label).toContain('Done!');
    expect(last.label).toContain('6 sheets — 2 sides × 3 inks');
    expect(last.label).toContain('4 pages');
    expect(last.stage).toBe('');
    expect(last.metrics).toContain('6 / 6 plates');
    expect(last.metrics).toMatch(/⏱/);
  });

  test('single-page export reports per-plate stages and totals', async ({ page }) => {
    test.setTimeout(90000);
    await createProject(page, 'Progress Single', { pageSize: 'half-letter', pageCount: 1 });
    for (const ink of ['#FF0000', '#0000FF']) {
      await addImageFromBuffer(page, createSolidPngBuffer('#000000', 900, 900), { name: 'ink.png' });
      await setLayerColorDirect(page, ink);
    }
    await page.evaluate(() => window.PageManager.saveActivePage());

    const downloads = await runPlateExport(page, { timeout: 60000 });
    expect(downloads).toHaveLength(2);

    const text = await progressText(page);

    // Label names the plate and its ink.
    expect(text).toMatch(/Plate 1 of 2 · .+ ink/);
    expect(text).toMatch(/Plate 2 of 2 · .+ ink/);

    // Stage walks through render → impose → encode → save per plate.
    expect(text).toMatch(/rendering \d+ layers?/);
    expect(text).toMatch(/rendering layer \d+ of \d+ ·/);
    expect(text).toMatch(/imposing 1-up sheet/);
    expect(text).toMatch(/encoding .*\.png/);
    expect(text).toMatch(/saving .*\.png/);

    const last = await lastEntry(page);
    expect(last.label).toContain('Done! 2 plates exported');
    expect(last.stage).toBe('');
    expect(last.metrics).toContain('2 / 2 plates');
    expect(last.metrics).toMatch(/⏱/);
    expect(last.metrics).toMatch(/\d+(\.\d+)? (MB|GB)/);
  });

  test('progress widget exposes label, stage and metrics lines', async ({ page }) => {
    await gotoApp(page);
    const out = await page.evaluate(async () => {
      const { createExportProgress } = await import('/src/app/export-progress.js');
      const el = document.createElement('div');
      document.body.appendChild(el);
      const prog = createExportProgress(el);
      const q = s => el.querySelector(s);

      prog.begin(4);
      const initial = {
        label: prog.textContent,
        stage: prog.stageText,
        width: q('.export-progress-fill').style.width,
        hasStageLine: !!q('.export-progress-stage'),
      };

      prog.textContent = 'Sheet 1 of 2 · Red ink · plate 1 of 4';
      prog.stage('rendering layer 1 of 3 · art.png');
      const live = {
        label: prog.textContent,
        stage: prog.stageText,
        metrics: q('.export-progress-metrics').textContent,
      };

      prog.advance(1, { bytes: 2 * 1024 * 1024 });
      const mid = {
        metrics: q('.export-progress-metrics').textContent,
        width: q('.export-progress-fill').style.width,
      };
      prog.advance(3, { bytes: 0 });
      prog.finish('Done! 4 plates exported');
      const done = {
        label: prog.textContent,
        stage: prog.stageText,
        width: q('.export-progress-fill').style.width,
        metrics: q('.export-progress-metrics').textContent,
      };
      el.remove();
      return { initial, live, mid, done };
    });

    expect(out.initial.label).toBe('Preparing export…');
    expect(out.initial.stage).toBe('');
    expect(out.initial.width).toBe('0%');
    expect(out.initial.hasStageLine).toBe(true);

    expect(out.live.label).toBe('Sheet 1 of 2 · Red ink · plate 1 of 4');
    expect(out.live.stage).toBe('rendering layer 1 of 3 · art.png');
    expect(out.live.metrics).toContain('0 / 4 plates');
    expect(out.live.metrics).toContain('⏱');

    expect(out.mid.metrics).toContain('1 / 4 plates');
    expect(out.mid.metrics).toContain('left');
    expect(out.mid.metrics).toContain('2.0 MB');
    expect(out.mid.width).toBe('25%');

    expect(out.done.label).toBe('Done! 4 plates exported');
    expect(out.done.stage).toBe('');
    expect(out.done.width).toBe('100%');
    expect(out.done.metrics).toContain('4 / 4 plates');
    expect(out.done.metrics).toContain('⏱');
    expect(out.done.metrics).toContain('2.0 MB');
  });
});
