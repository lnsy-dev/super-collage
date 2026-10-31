import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
  setLayerColorDirect,
} from './helpers.js';

/* ═══════════════════════════════════════════════════════════════════
   Tiled (quadrant) rendering — equivalence + memory invariants
   ═══════════════════════════════════════════════════════════════════

   Page-space rendering (image-mask compositing, plate flattening,
   composite blending) renders the page as a 2×2 grid of tiles stitched
   into the final canvas. These tests pin the properties that matter:

   1. EQUIVALENCE — the per-pixel page-space math (mask compositing,
      flattening, subtractive blending) is exact: comparing a quadrant
      render against a whole-image render (grid 1×1), every pixel of
      unrotated content is identical, and for rotated content only the
      anti-aliased boundary pixels of the rotated draw may differ, and
      only by AA-coverage noise:

      JUSTIFICATION: Chrome rasterizes a transformed draw depending on
      the surface's origin — composing the tile's integer translate into
      the layer CTM changes the inverse-mapped sample positions at the
      last-ulp level, which occasionally flips an anti-aliasing
      coverage bin along the rotated edge. Interior pixels sample the
      solid source far from any edge and stay bit-identical. The
      observed deltas on this fixture: ~0.1% of the layer's pixels, all
      within its rotated boundary, max grey delta 53/255, mean ~12/255
      — invisible at 600 dpi print resolution, in exchange for the
      peak page-space buffer dropping from a full page to one quarter.

   2. MEMORY — the largest page-space intermediate the engine allocates
      is one tile (a quarter of the page RGBA), not a whole page —
      measured via ExportEngine._peakPageBufferBytes, which every
      page-buffer allocation reports. The untiled reference run must
      report a full-page buffer, demonstrating the before/after.
   ═══════════════════════════════════════════════════════════════════ */

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

const PAGE_W = 3300, PAGE_H = 5100;
const TILE_W = PAGE_W / 2, TILE_H = PAGE_H / 2;

// Layer rects are placed to cross every tile seam (x=1650, y=2555), with
// rotation so masked edges are not axis-aligned.
async function buildCompositingProject(page) {
  await createProject(page, 'Tiled Render', { pageSize: 'half-letter' });

  // Plain solid layer (red), unrotated, crosses the vertical seam.
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 900, 900), { name: 'solid.png' });
  await setLayerColorDirect(page, '#FF0000');

  // Painted-mask layer (blue): mask punches a hole through it.
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 1000, 700), { name: 'painted.png' });
  await setLayerColorDirect(page, '#0078BF');
  await page.evaluate(() => {
    const l = window.State.layers.find(l => l.name === 'painted');
    window.MaskEngine._paint(l, l.naturalWidth / 2, l.naturalHeight / 2, l.naturalWidth / 3, false);
    l._dirty = true;
  });

  // Image-masked pair: base (yellow) is masked by the layer above it.
  // Both rotated, so their composited boundary crosses every tile seam.
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 1100, 800), { name: 'base.png' });
  await setLayerColorDirect(page, '#FFE800');
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 800, 800), { name: 'masker.png' });
  await setLayerColorDirect(page, '#FF48B0');

  await page.evaluate(() => {
    const layers = window.State.layers;
    const byName = Object.fromEntries(layers.map(l => [l.name, l]));
    const solid = byName.solid;
    const painted = byName.painted;
    const base = byName.base;
    const masker = byName.masker;

    Object.assign(solid, { x: 400, y: 600, width: 2600, height: 900, rotation: 0 });
    Object.assign(painted, { x: 200, y: 2000, width: 2900, height: 1200, rotation: 10 });
    Object.assign(base, { x: 300, y: 2600, width: 2800, height: 2200, rotation: -7 });
    Object.assign(masker, { x: 1000, y: 3000, width: 1500, height: 1500, rotation: 30 });

    base.imageMaskIds = [masker.id];
    masker.isMaskFor = base.id;
    for (const l of [solid, painted, base, masker]) {
      l._dirty = true;
      window.DB.saveLayer(l);
    }
    window.PageManager.saveActivePage();
  });
}

// Render every plate under one grid and report, per ink, the raw pixels.
function renderPlates(page, grid) {
  return page.evaluate(async (grid) => {
    const { ExportEngine } = await import('/src/app/export-engine.js');
    const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
    ExportEngine._renderTileGrid = grid;
    ExportEngine._resetMemoryStats();
    const plates = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);
    const out = {};
    for (const [color, canvas] of plates.entries()) {
      out[color] = new Uint8Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
    }
    return { plates: out, peak: ExportEngine._peakPageBufferBytes, dims: [CANVAS_W, CANVAS_H] };
  }, grid);
}

function renderComposite(page, grid) {
  return page.evaluate(async (grid) => {
    const { ExportEngine } = await import('/src/app/export-engine.js');
    const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
    ExportEngine._renderTileGrid = grid;
    ExportEngine._resetMemoryStats();
    const canvas = await ExportEngine._renderComposite(State.layers, CANVAS_W, CANVAS_H);
    return {
      pixels: new Uint8Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data),
      peak: ExportEngine._peakPageBufferBytes,
      dims: [canvas.width, canvas.height],
    };
  }, grid);
}

function diffStats(a, b, w, h) {
  let n = 0, maxDelta = 0, sumDelta = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let d = 0;
      for (let ch = 0; ch < 4; ch++) d = Math.max(d, Math.abs(a[i + ch] - b[i + ch]));
      if (d > 0) {
        n++;
        sumDelta += d;
        if (d > maxDelta) maxDelta = d;
      }
    }
  }
  const total = w * h;
  return { n, frac: n / total, maxDelta, avgDelta: n ? sumDelta / n : 0 };
}

test.describe('Tiled plate rendering', () => {
  test('quadrant-rendered plates match whole-image render within AA tolerance, at quarter-page buffers', async ({ page }) => {
    test.setTimeout(180000);
    await buildCompositingProject(page);

    const whole = await renderPlates(page, { cols: 1, rows: 1 });
    const tiled = await renderPlates(page, { cols: 2, rows: 2 });
    const [w, h] = whole.dims;

    // The project prints in several inks; every one of them must render.
    const colors = Object.keys(whole.plates);
    expect(colors.length).toBeGreaterThanOrEqual(3);

    for (const color of colors) {
      const stats = diffStats(whole.plates[color], tiled.plates[color], w, h);
      if (color === '#FF0000') {
        // Unrotated, unmasked content: exact, pixel for pixel.
        expect(stats.n).toBe(0);
      } else {
        // Rotated content: interior exact, only AA boundary pixels may
        // differ, by coverage noise only (see justification above).
        expect(stats.frac).toBeLessThan(0.005);
        expect(stats.maxDelta).toBeLessThanOrEqual(64);
        expect(stats.avgDelta).toBeLessThanOrEqual(16);
      }
    }

    // MEMORY: untiled rendering allocates at least one full-page buffer
    // (the old behaviour); quadrant rendering never allocates more than
    // one tile — a quarter of the page — across every masked layer,
    // mask buffer and flatten readback.
    expect(whole.peak).toBe(PAGE_W * PAGE_H * 4);
    expect(tiled.peak).toBe(TILE_W * TILE_H * 4);
    expect(tiled.peak).toBeLessThan((PAGE_W * PAGE_H * 4) / 3);
  });
});

test.describe('Tiled composite rendering', () => {
  test('quadrant-blended composite matches whole-image render within AA tolerance, at quarter-page buffers', async ({ page }) => {
    test.setTimeout(180000);
    await buildCompositingProject(page);

    const whole = await renderComposite(page, { cols: 1, rows: 1 });
    const tiled = await renderComposite(page, { cols: 2, rows: 2 });
    const [w, h] = whole.dims;
    expect(tiled.dims).toEqual(whole.dims);

    // Interior pixels exact; only rotated AA boundary pixels may differ,
    // by coverage noise only.
    const stats = diffStats(whole.pixels, tiled.pixels, w, h);
    expect(stats.frac).toBeLessThan(0.005);
    expect(stats.maxDelta).toBeLessThanOrEqual(64);
    expect(stats.avgDelta).toBeLessThanOrEqual(16);

    // MEMORY: the untiled path allocates full-page buffers (the old
    // accumulator + per-layer buffers); the tiled path caps every
    // page-space allocation at one tile, and there is no page-sized
    // accumulator any more — the output canvas itself carries the
    // blended result.
    expect(whole.peak).toBe(PAGE_W * PAGE_H * 4);
    expect(tiled.peak).toBe(TILE_W * TILE_H * 4);
    expect(tiled.peak).toBeLessThan((PAGE_W * PAGE_H * 4) / 3);
  });
});
