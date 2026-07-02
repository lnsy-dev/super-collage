import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  clearIndexedDB,
  gotoApp,
  createProject,
  buildComplexProject,
  snapshotProject,
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
    await expect(page.locator('#project-dialog')).toBeVisible();
    await expect(page.locator('.project-entry')).toContainText('No projects yet');

    // Upload via the project dialog's hidden input (wired to #btn-upload-project).
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
    await gotoApp(page);
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
