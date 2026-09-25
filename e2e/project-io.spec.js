import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  clearIndexedDB,
  gotoApp,
  createProject,
  buildComplexProject,
  snapshotProject,
  addImageFromBuffer,
  createSolidPngBuffer,
  createShapePngBuffer,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/* ─── comparison helpers ────────────────────────────────────────────── */

// Everything except the (tolerance-compared) composite fingerprints must match
// byte-for-byte after a round-trip.
function structural(snapshot) {
  const { composites, ...rest } = snapshot;
  return rest;
}

function meanAbsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function assertCompositesClose(before, after) {
  expect(after.composites.length).toBe(before.composites.length);
  for (let i = 0; i < before.composites.length; i++) {
    const bc = before.composites[i];
    const ac = after.composites[i];
    if (bc == null || ac == null) {
      expect(ac).toEqual(bc);
      continue;
    }
    expect(ac.width).toBe(bc.width);
    expect(ac.height).toBe(bc.height);
    // Identical data through an identical render path — allow only a tiny
    // margin for any anti-aliasing / subpixel nondeterminism.
    expect(meanAbsDiff(bc.fp, ac.fp)).toBeLessThan(3);
  }
}

function assertRoundTrip(before, after) {
  expect(structural(after)).toEqual(structural(before));
  assertCompositesClose(before, after);
}

/* ─── tests ─────────────────────────────────────────────────────────── */

test.describe('Project download / upload (ZIP round-trip)', () => {
  test('JSZip is available on the page', async ({ page }) => {
    await gotoApp(page);
    const hasJSZip = await page.evaluate(() => typeof window.JSZip === 'function');
    expect(hasJSZip).toBe(true);
  });

  test('complicated document round-trips through the download + upload UI flow', async ({ page }) => {
    await buildComplexProject(page);
    const before = await snapshotProject(page);

    // Sanity: the fixture really is complicated.
    expect(before.pageCount).toBe(2);
    expect(before.pages[0].layerCount).toBeGreaterThanOrEqual(4);
    expect(before.pages[1].layerCount).toBeGreaterThanOrEqual(5);

    // Download via the File menu.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.click('.menu-item[data-menu="file"]');
        await page.click('.menu-entry[data-action="download-project"]');
      })(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const zipPath = await download.path();
    const buffer = fs.readFileSync(zipPath);
    expect(buffer.length).toBeGreaterThan(0);

    // Wipe all local state — simulate a fresh browser / different machine.
    await clearIndexedDB(page);
    await page.reload();
    await expect(page.locator('#create-project-dialog')).toBeVisible();

    // Upload via the create dialog's hidden input (wired to #btn-upload-project in the manager).
    await page.setInputFiles('#project-import-input', {
      name: 'complex-doc.zip',
      mimeType: 'application/zip',
      buffer,
    });
    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('#status-project')).toContainText('Complex Doc');

    const after = await snapshotProject(page);
    assertRoundTrip(before, after);
  });

  test('upload button opens the file chooser', async ({ page }) => {
    // Seed a project so the manager (with Upload button) is visible.
    await page.goto('/');
    await page.evaluate(async () => {
      const { DB } = await import('/src/app/db.js');
      await DB.open();
      await DB.put('projects', {
        id: crypto.randomUUID(),
        name: 'Existing Project',
        pageSize: 'letter',
        pageOrder: [],
        booklet: { binding: 'saddle-stitch', targetSheetSize: 'letter', pagesPerSheet: 1 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await gotoApp(page);
    await expect(page.locator('#project-dialog')).toBeVisible();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#btn-upload-project'),
    ]);
    expect(chooser).toBeTruthy();
  });

  test('every feature survives a round-trip (coverage)', async ({ page }) => {
    await buildComplexProject(page);
    const before = await snapshotProject(page);

    // Round-trip via the core API (build zip Blob → import → open).
    const newId = await page.evaluate(async () => {
      const blob = await window.ProjectIO.buildZipBlob(window.State.project.id);
      return window.ProjectIO.importZip(blob);
    });
    await page.evaluate(async (id) => { await window.openProject(id); }, newId);
    await expect(page.locator('#main-app')).toBeVisible();

    const after = await snapshotProject(page);
    assertRoundTrip(before, after);

    // Explicit coverage assertions on the re-imported project.
    const p1 = after.pages[0].layers;
    const p2 = after.pages[1].layers;
    const all = [...p1, ...p2];

    // Multiple pages.
    expect(after.pageCount).toBe(2);

    // Solid color layer preserved.
    expect(p1.some(l => l.colorMode === 'solid' && l.color === '#f65058' && l.flipH === true)).toBe(true);

    // Gradient preserved (type + stops).
    const grad = all.find(l => l.colorMode === 'gradient');
    expect(grad).toBeTruthy();
    expect(grad.gradient.type).toBe('radial');
    expect(grad.gradient.stops.length).toBe(3);
    expect(grad.gradient.stops.map(s => s.color)).toEqual(['#010101', '#0078bf', '#ffe800']);

    // Pattern preserved.
    const pat = all.find(l => l.colorMode === 'pattern');
    expect(pat).toBeTruthy();
    expect(pat.pattern.type).toBe('dots');
    expect(pat.pattern.color1).toBe('#00a95c');
    expect(pat.pattern.size).toBe(32);

    // SVG preserved with its blob.
    const svg = all.find(l => l.isSvg);
    expect(svg).toBeTruthy();
    expect(svg._image).toBeTruthy();
    expect(svg._image.type).toContain('svg');

    // Drawn mask preserved (mask blob present).
    expect(all.some(l => l._mask != null)).toBe(true);

    // Image-mask relationship preserved (a layer points at its base).
    expect(p2.some(l => l.isMaskFor != null && l.isMaskFor >= 0)).toBe(true);
    expect(p2.some(l => Array.isArray(l.imageMaskIds) && l.imageMaskIds.length > 0)).toBe(true);

    // Text layer preserved with typography.
    const text = p2.find(l => l.isText);
    expect(text).toBeTruthy();
    expect(text.text).toBe('Round Trip 1234');
    expect(text.textFontSize).toBe(132);
    expect(text.textFontWeight).toBe(700);
    expect(text.textFontStyle).toBe('italic');
    expect(text.textAlign).toBe('center');

    // Color separation preserved with all riso plates.
    const sep = p2.find(l => l.isColorSeparation);
    expect(sep).toBeTruthy();
    expect(sep.separationColors.length).toBe(7);
    expect(sep._image).toBeTruthy();
  });

  test('text layers round-trip with all typography fields intact', async ({ page }) => {
    await createProject(page, 'Text RT', { pageSize: 'half-letter' });

    await page.evaluate(async () => {
      const defs = [
        { text: 'Alpha', textFontFamily: 'IBM Plex Serif', textFontSize: 120, textFontWeight: 700, textFontStyle: 'italic', textAlign: 'center', textLetterSpacing: 6, textLineHeight: 1.4, x: 120, y: 180, color: '#f65058' },
        { text: 'Beta\nGamma', textFontSize: 84, textFontWeight: 400, textFontStyle: 'normal', textAlign: 'right', textLetterSpacing: 0, textLineHeight: 2.0, x: 240, y: 1100, color: '#0078bf' },
        { text: 'δ ε ζ 42!', textFontSize: 64, textFontWeight: 400, textFontStyle: 'normal', textAlign: 'left', textLetterSpacing: 2, textLineHeight: 1.1, x: 300, y: 2200, color: '#00a95c' },
      ];
      for (const d of defs) {
        const l = await window.LayerManager.addText(d.text, d.x, d.y, 1500, 500);
        Object.assign(l, d);
        l._originalCanvas = null; l._dirty = true;
        await window.DB.saveLayer(l);
      }
      await window.PageManager.saveActivePage();
    });
    await page.waitForFunction(() => window.State.layers.filter(l => l.isText).length === 3);

    const before = await snapshotProject(page);

    const newId = await page.evaluate(async () => {
      const blob = await window.ProjectIO.buildZipBlob(window.State.project.id);
      return window.ProjectIO.importZip(blob);
    });
    await page.evaluate(async (id) => { await window.openProject(id); }, newId);
    await expect(page.locator('#main-app')).toBeVisible();

    const after = await snapshotProject(page);
    assertRoundTrip(before, after);

    const texts = after.pages[0].layers.filter(l => l.isText);
    expect(texts.length).toBe(3);
    expect(texts.map(t => t.text)).toEqual(['Alpha', 'Beta\nGamma', 'δ ε ζ 42!']);
    expect(texts.map(t => t.textLineHeight)).toEqual([1.4, 2.0, 1.1]);
    expect(texts.map(t => t.textAlign)).toEqual(['center', 'right', 'left']);
    expect(texts.map(t => t.textLetterSpacing)).toEqual([6, 0, 2]);
  });

  test('upload always creates a fresh project and never touches the original', async ({ page }) => {
    await createProject(page, 'Original', { pageSize: 'half-letter' });
    await page.evaluate(async () => {
      const l = await window.LayerManager.addText('Keep me', 100, 100, 1000, 300);
      await window.DB.saveLayer(l);
      await window.PageManager.saveActivePage();
    });

    const originalId = await page.evaluate(() => window.State.project.id);

    // Build the zip once, import it twice.
    const zipInfo = await page.evaluate(async () => {
      const blob = await window.ProjectIO.buildZipBlob(window.State.project.id);
      // Round-trip the blob through an ArrayBuffer so we can re-import it twice.
      const buf = await blob.arrayBuffer();
      const id1 = await window.ProjectIO.importZip(new Blob([buf]));
      const id2 = await window.ProjectIO.importZip(new Blob([buf]));
      const projects = await window.DB.getAll('projects');
      return { id1, id2, projectIds: projects.map(p => p.id), count: projects.length };
    });

    // Two imports → two distinct new projects, original preserved → 3 total.
    expect(zipInfo.id1).not.toBe(zipInfo.id2);
    expect(zipInfo.id1).not.toBe(originalId);
    expect(zipInfo.id2).not.toBe(originalId);
    expect(zipInfo.projectIds).toContain(originalId);
    expect(zipInfo.count).toBe(3);

    // The original still has exactly its one text layer, unchanged.
    const originalLayers = await page.evaluate(async (id) => {
      return window.DB.getByIndex('layers', 'by-project', id);
    }, originalId);
    expect(originalLayers.length).toBe(1);
    expect(originalLayers[0].text).toBe('Keep me');
    expect(originalLayers[0].projectId).toBe(originalId);
  });
});

/* ─── ProjectIO.parseZip (read-only parse) ──────────────────────────── */

test.describe('ProjectIO.parseZip (read-only parse)', () => {
  test('returns project, pages and per-layer blob entries without writing to IndexedDB', async ({ page }) => {
    await createProject(page, 'Parse Zip', { pageSize: 'half-letter' });

    // Two image layers (one with a drawn mask) + one text layer (no blobs).
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 120, 80), { name: 'plain.png' });
    await addImageFromBuffer(page, createShapePngBuffer('rect', 100, 100), { name: 'masked.png' });
    await page.evaluate(async () => {
      const l = window.State.layers[window.State.layers.length - 1];
      l.color = '#0078bf';
      window.MaskEngine._paint(l, l.naturalWidth / 2, l.naturalHeight / 2, l.naturalWidth / 3, false);
      l._dirty = true;
      await window.DB.saveLayer(l);
      await window.DB.saveMask(l);
    });
    await page.evaluate(async () => {
      const l = await window.LayerManager.addText('Parse Me', 200, 300, 800, 300);
      l._originalCanvas = null; l._dirty = true;
      await window.DB.saveLayer(l);
    });
    await page.waitForFunction(() => window.State.layers.length === 3);
    await page.evaluate(() => window.PageManager.saveActivePage());

    const result = await page.evaluate(async () => {
      const blob = await window.ProjectIO.buildZipBlob(window.State.project.id);

      const countsBefore = {
        projects: (await window.DB.getAll('projects')).length,
        layers: (await window.DB.getAll('layers')).length,
        imageBlobs: (await window.DB.getAll('imageBlobs')).length,
        maskBlobs: (await window.DB.getAll('maskBlobs')).length,
      };

      const parsed = await window.ProjectIO.parseZip(blob);

      const countsAfter = {
        projects: (await window.DB.getAll('projects')).length,
        layers: (await window.DB.getAll('layers')).length,
        imageBlobs: (await window.DB.getAll('imageBlobs')).length,
        maskBlobs: (await window.DB.getAll('maskBlobs')).length,
      };

      // Layer records must be exactly the persisted records (deep-equal check
      // happens on the Node side; here just ship them across with blob sigs).
      // dbHas*: whether IndexedDB actually holds an image/mask blob for the
      // layer — parseZip must mirror DB truth, not assumptions about which
      // layers "should" have masks (the image pipeline auto-saves default
      // masks for image layers).
      const entries = [];
      for (const e of parsed.layerEntries) {
        const dbRec = await window.DB.get('layers', e.record.id);
        const dbImg = await window.DB.get('imageBlobs', e.record.id);
        const dbMask = await window.DB.get('maskBlobs', e.record.id);
        entries.push({
          record: e.record,
          matchesDbRecord: JSON.stringify(e.record) === JSON.stringify(dbRec),
          dbHasImage: !!(dbImg && dbImg.blob),
          dbHasMask: !!(dbMask && dbMask.blob),
          image: e.imageBlob ? { isBlob: e.imageBlob instanceof Blob, type: e.imageBlob.type, size: e.imageBlob.size } : null,
          mask: e.maskBlob ? { isBlob: e.maskBlob instanceof Blob, type: e.maskBlob.type, size: e.maskBlob.size } : null,
        });
      }

      return {
        projectId: parsed.project.id,
        projectName: parsed.project.name,
        pageIds: parsed.pages.map(p => p.id),
        countsBefore,
        countsAfter,
        entries,
      };
    });

    const source = await page.evaluate(() => ({
      projectId: window.State.project.id,
      projectName: window.State.project.name,
      pageId: window.State.pageId,
      layers: window.State.layers.map(l => ({
        id: l.id, color: l.color, isText: l.isText,
      })),
    }));

    // Structure: the manifest's project + pages, untouched.
    expect(result.projectId).toBe(source.projectId);
    expect(result.projectName).toBe(source.projectName);
    expect(result.pageIds).toEqual([source.pageId]);

    // Layer entries: one per layer, in manifest order, ids matching.
    expect(result.entries.length).toBe(3);
    expect(result.entries.map(e => e.record.id).sort()).toEqual(source.layers.map(l => l.id).sort());

    const byId = new Map(result.entries.map(e => [e.record.id, e]));

    // parseZip's blob presence must mirror IndexedDB truth for every layer.
    for (const e of result.entries) {
      expect(!!e.image).toBe(e.dbHasImage);
      expect(!!e.mask).toBe(e.dbHasMask);
    }

    // Plain image layer: real PNG image blob, record intact. (The image
    // pipeline auto-saves a default mask, so only the image side is pinned
    // here; the mask side is covered by the DB-truth loop above.)
    const plain = byId.get(source.layers[0].id);
    expect(plain.matchesDbRecord).toBe(true);
    expect(plain.image).toEqual({ isBlob: true, type: 'image/png', size: expect.any(Number) });
    expect(plain.image.size).toBeGreaterThan(0);

    // Masked image layer: image + hand-drawn mask blobs, both real PNGs.
    const masked = byId.get(source.layers[1].id);
    expect(masked.matchesDbRecord).toBe(true);
    expect(masked.image).toEqual({ isBlob: true, type: 'image/png', size: expect.any(Number) });
    expect(masked.mask).toEqual({ isBlob: true, type: 'image/png', size: expect.any(Number) });
    expect(masked.mask.size).toBeGreaterThan(0);
    expect(masked.record.color).toBe('#0078bf');

    // Text layer: no blobs at all.
    const text = byId.get(source.layers[2].id);
    expect(text.record.isText).toBe(true);
    expect(text.record.text).toBe('Parse Me');
    expect(text.image).toBe(null);
    expect(text.mask).toBe(null);

    // Read-only: nothing was written to IndexedDB.
    expect(result.countsAfter).toEqual(result.countsBefore);
    expect(result.countsAfter.projects).toBe(1);
  });

  test('parseZip rejects a zip without project.json', async ({ page }) => {
    await gotoApp(page); // JSZip is loaded with the app shell
    const err = await page.evaluate(async () => {
      const zip = new window.JSZip();
      zip.file('readme.txt', 'not a project');
      const blob = await zip.generateAsync({ type: 'blob' });
      try {
        await window.ProjectIO.parseZip(blob);
        return null;
      } catch (e) {
        return { message: e.message };
      }
    });
    expect(err).toBeTruthy();
    expect(err.message).toContain('project.json missing');
  });

  test('importZip remaps importedGroupId to a fresh non-null id', async ({ page }) => {
    await createProject(page, 'Group RT', { pageSize: 'half-letter' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'g1.png' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'g2.png' });
    await page.evaluate(async () => {
      const gid = crypto.randomUUID();
      for (const l of window.State.layers) {
        l.importedGroupId = gid;
        l._dirty = true;
        await window.DB.saveLayer(l);
      }
      await window.PageManager.saveActivePage();
    });
    await page.waitForFunction(() => window.State.layers.every(l => l.importedGroupId));

    const out = await page.evaluate(async () => {
      const sourceGid = window.State.layers[0].importedGroupId;
      const blob = await window.ProjectIO.buildZipBlob(window.State.project.id);
      const newId = await window.ProjectIO.importZip(blob);
      const importedLayers = await window.DB.getByIndex('layers', 'by-project', newId);
      return {
        sourceGid,
        imported: importedLayers.map(l => ({ importedGroupId: l.importedGroupId })),
      };
    });

    // Both imported layers share ONE group id, different from the source's.
    expect(out.imported.length).toBe(2);
    expect(out.imported[0].importedGroupId).toBeTruthy();
    expect(out.imported[0].importedGroupId).not.toBe(out.sourceGid);
    expect(out.imported[1].importedGroupId).toBe(out.imported[0].importedGroupId);
  });

  test('parseZip rejects a manifest with the wrong format', async ({ page }) => {
    await gotoApp(page);
    const err = await page.evaluate(async () => {
      const zip = new window.JSZip();
      zip.file('project.json', JSON.stringify({ format: 'someone-elses-format', layers: [] }));
      const blob = await zip.generateAsync({ type: 'blob' });
      try {
        await window.ProjectIO.parseZip(blob);
        return null;
      } catch (e) {
        return { message: e.message };
      }
    });
    expect(err).toBeTruthy();
    expect(err.message).toBe('Unrecognized project format: someone-elses-format');
  });
});
