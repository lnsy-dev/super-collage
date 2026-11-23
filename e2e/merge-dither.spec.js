/* ═══════════════════════════════════════════════════════════════════
   Merge + dither interaction tests.

   The invariant under test: merging layers must render each layer
   (dither applied, rasterized at the composite's final scale) BEFORE
   combining pixels, so the dither pattern is never resampled. A merge
   that scales already-dithered pixels visibly grows/shrinks/softens
   the dots whenever the composite scale differs from the layer's own
   natural pixel density.

   Pattern sizes (dither cells, dot grids) are anchored to the layer's
   natural-resolution pixels, so the render-before-merge pass scales
   the pattern knob by the render ratio: the merged dither keeps the
   same on-page dot size the layer has on its own, crisp at the final
   scale, no matter what resolution the merged-with partners bring.
   ═══════════════════════════════════════════════════════════════════ */

import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer } from './helpers.js';

// Injected into page.evaluate contexts (Node-scope functions are not
// visible there). Binarize rows of a sub-rectangle and measure:
//   · runs          — run lengths of ink along rows (median = dot pitch)
//   · midToneFrac   — share of neither-ink-nor-paper pixels; a resampled
//                     1-bit pattern smears into mid-grays, a freshly
//                     rasterized one is pure black/white
const METRICS_SRC = `
  // mode 'lum': opaque composites (merged canvas) — ink is dark.
  // mode 'alpha': transparent layer canvases — ink is opaque.
  window.__bandMetrics = (data, W, x0, x1, y0, y1, mode = 'lum') => {
    const isInk = (i) => {
      if (mode === 'alpha') return data[i * 4 + 3] > 128;
      const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      return v < 128;
    };
    const isMid = (i) => {
      if (mode === 'alpha') return false;
      const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      return v >= 32 && v <= 224;
    };
    const runs = [];
    let mid = 0, total = 0;
    for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 24))) {
      let cur = isInk(y * W + x0) ? 1 : 0;
      let len = 1;
      for (let x = x0 + 1; x < x1; x++) {
        if (isMid(y * W + x)) mid++;
        total++;
        const b = isInk(y * W + x) ? 1 : 0;
        if (b === cur) len++;
        else { runs.push(len); cur = b; len = 1; }
      }
      runs.push(len);
    }
    const sorted = runs.slice().sort((a, b) => a - b);
    return {
      medianRun: sorted[Math.floor(runs.length / 2)],
      meanRun: runs.reduce((a, b) => a + b, 0) / runs.length,
      midToneFrac: mid / total,
    };
  };
  // Crispness for colored inks: every pixel in the band must be the ink
  // color or paper — a resampled pattern smears into in-between colors.
  window.__mergedColorCrisp = (pageX0, pageX1, pageY0, pageY1, inkHex) => {
    const merged = window.State.layers[0];
    const orig = merged._originalCanvas;
    const pxPerUnit = orig.width / merged.width;
    const data = orig.getContext('2d').getImageData(0, 0, orig.width, orig.height).data;
    const ir = parseInt(inkHex.slice(1, 3), 16);
    const ig = parseInt(inkHex.slice(3, 5), 16);
    const ib = parseInt(inkHex.slice(5, 7), 16);
    const x0 = Math.round((pageX0 - merged.x) * pxPerUnit);
    const x1 = Math.round((pageX1 - merged.x) * pxPerUnit);
    const y0 = Math.round((pageY0 - merged.y) * pxPerUnit);
    const y1 = Math.round((pageY1 - merged.y) * pxPerUnit);
    let other = 0, total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * orig.width + x) * 4;
        const dInk = Math.abs(data[i] - ir) + Math.abs(data[i + 1] - ig) + Math.abs(data[i + 2] - ib);
        const dPaper = (255 - data[i]) + (255 - data[i + 1]) + (255 - data[i + 2]);
        if (dInk > 90 && dPaper > 90) other++;
        total++;
      }
    }
    return { otherFrac: other / total };
  };
  // Sample the merged layer's _originalCanvas inside a page-space band.
  window.__mergedBand = (pageX0, pageX1, pageY0, pageY1) => {
    const merged = window.State.layers[0];
    const orig = merged._originalCanvas;
    const pxPerUnit = orig.width / merged.width;
    const data = orig.getContext('2d').getImageData(0, 0, orig.width, orig.height).data;
    const metrics = window.__bandMetrics(
      data, orig.width,
      Math.round((pageX0 - merged.x) * pxPerUnit),
      Math.round((pageX1 - merged.x) * pxPerUnit),
      Math.round((pageY0 - merged.y) * pxPerUnit),
      Math.round((pageY1 - merged.y) * pxPerUnit),
    );
    return { ...metrics, pxPerUnit, canvasSize: [orig.width, orig.height] };
  };
`;

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/**
 * Import a solid-gray image and turn it into a Bayer-dithered layer.
 * natural: source bitmap size (px); width: page footprint (units) —
 * the layer's natural/page ratio drives the merge's composite scale.
 * Returns the layer's canonical on-page dot size in units:
 * cell (natural px) × width / natural.
 */
async function addDitheredLayer(page, { natural = 400, width = 400, cell = 4, x = 100, y = 100 } = {}) {
  await addImageFromBuffer(page, createSolidPngBuffer('#808080', natural, natural), { name: 'dither-src.png' });
  const info = await page.evaluate(({ natural, width, cell, x, y }) => {
    const d = window.State.layers[window.State.layers.length - 1];
    d.x = x; d.y = y;
    d.width = width; d.height = width;
    d.halftoneType = 'dither';
    d.halftoneSize = cell;
    d._dirty = true;
    return { id: d.id, naturalWidth: d.naturalWidth, width: d.width };
  }, { natural, width, cell, x, y });
  return { ...info, canonicalDotUnits: cell * width / natural };
}

/** Import a solid dark layer (plain raster, no halftone) as merge partner. */
async function addPartnerLayer(page, { natural, width, x, y } = {}) {
  await addImageFromBuffer(page, createSolidPngBuffer('#303030', natural, natural), { name: 'partner.png' });
  return page.evaluate(({ natural, width, x, y }) => {
    const p = window.State.layers[window.State.layers.length - 1];
    p.x = x; p.y = y;
    p.width = width; p.height = width;
    p._dirty = true;
    return { id: p.id, naturalWidth: p.naturalWidth, width: p.width };
  }, { natural, width, x, y });
}

async function mergeSelected(page) {
  await page.evaluate(() => {
    window.State.selectedIds = window.State.layers.map(l => l.id);
    window.UI.refreshLayerList();
  });
  await page.locator('#layer-buttons [data-action="merge-layers"]').click();
  await page.waitForFunction(() => window.State.layers.length === 1);
  return page.evaluate(() => {
    const m = window.State.layers[0];
    return { id: m.id, w: m.width, h: m.height, nw: m.naturalWidth, nh: m.naturalHeight };
  });
}

test.describe('Merge preserves dither size', () => {
  // Dithered layer: natural 400px at 400 units (1px/unit), Bayer cell 4
  // → canonical dot = 4 units. Partner: natural 1000px at 400 units
  // (2.5px/unit) → merge composites at 2.5px/unit, a FRACTIONAL ratio to
  // the dithered layer's own density — exactly the case where scaling
  // already-dithered pixels smears the pattern.
  test('merging with a higher-density layer keeps the dither dot size at final scale', async ({ page }) => {
    await createProject(page, 'Merge Dither Size');
    await page.evaluate(METRICS_SRC);
    const d = await addDitheredLayer(page, { natural: 400, width: 400, cell: 4, x: 100, y: 100 });
    await addPartnerLayer(page, { natural: 1000, width: 400, x: 700, y: 100 });
    const merged = await mergeSelected(page);

    // The merge composited at 2.5px/unit (the partner's density).
    expect(merged.nw).toBeCloseTo(merged.w * 2.5, 0);

    // Inside the dithered layer's band (kept clear of both edges), the
    // dots keep their canonical on-page size: 10px runs at 2.5px/unit.
    const band = await page.evaluate(() => window.__mergedBand(120, 380, 140, 360));
    const dotUnits = band.medianRun / band.pxPerUnit;
    expect(dotUnits).toBeGreaterThanOrEqual(d.canonicalDotUnits * 0.7);
    expect(dotUnits).toBeLessThanOrEqual(d.canonicalDotUnits * 1.3);
    // Render-before-merge: the 1-bit pattern is rasterized fresh at the
    // final scale, not resampled — no smeared mid-gray transition pixels.
    expect(band.midToneFrac).toBeLessThan(0.03);
  });

  // Same dithered layer merged with a same-density partner (composite
  // scale 1px/unit): the dot size must match the higher-density case —
  // the merged dot size may not depend on what the layer merges with.
  test('merging with a same-density partner keeps the same dot size', async ({ page }) => {
    await createProject(page, 'Merge Dither Same Density');
    await page.evaluate(METRICS_SRC);
    const d = await addDitheredLayer(page, { natural: 400, width: 400, cell: 4, x: 100, y: 100 });
    await addPartnerLayer(page, { natural: 400, width: 400, x: 700, y: 100 });
    const merged = await mergeSelected(page);

    expect(merged.nw).toBe(merged.w); // composited at 1px/unit
    const band = await page.evaluate(() => window.__mergedBand(120, 380, 140, 360));
    const dotUnits = band.medianRun / band.pxPerUnit;
    expect(dotUnits).toBeGreaterThanOrEqual(d.canonicalDotUnits * 0.7);
    expect(dotUnits).toBeLessThanOrEqual(d.canonicalDotUnits * 1.3);
    expect(band.midToneFrac).toBeLessThan(0.03);
  });

  // The non-dithered partner keeps its solid ink through the merge, and
  // the merged layer spans both sources (dithered + plain content).
  test('dithered layer merged with a non-dithered layer keeps both contents', async ({ page }) => {
    await createProject(page, 'Merge Dither Plain');
    await page.evaluate(METRICS_SRC);
    await addDitheredLayer(page, { natural: 400, width: 400, cell: 4, x: 100, y: 100 });
    await addPartnerLayer(page, { natural: 400, width: 400, x: 700, y: 100 });
    const merged = await mergeSelected(page);

    // Content spans both layers: 100..1100 units wide, 400 tall.
    expect(merged.w).toBeGreaterThanOrEqual(995);
    expect(merged.w).toBeLessThanOrEqual(1005);
    expect(merged.h).toBeGreaterThanOrEqual(395);
    expect(merged.h).toBeLessThanOrEqual(405);

    // Partner interior is solid ink; dither interior is patterned ink.
    const partnerBand = await page.evaluate(() => window.__mergedBand(760, 1040, 160, 340));
    expect(partnerBand.midToneFrac).toBeLessThan(0.03);
    expect(partnerBand.medianRun).toBeGreaterThan(partnerBand.canvasSize[0] * 0.2); // one solid run
    const ditherBand = await page.evaluate(() => window.__mergedBand(140, 360, 160, 340));
    expect(ditherBand.medianRun).toBeLessThan(ditherBand.canvasSize[0] * 0.2); // many short runs
  });

  // Merge must render (process at final scale) BEFORE compositing: each
  // merged-away layer is processed with an explicit composite target and
  // a pattern scale that preserves its on-page pattern size.
  test('merge renders layers at the composite scale before merging', async ({ page }) => {
    await createProject(page, 'Merge Render Order');
    const d = await addDitheredLayer(page, { natural: 400, width: 400, cell: 4, x: 100, y: 100 });
    const p = await addPartnerLayer(page, { natural: 1000, width: 400, x: 700, y: 100 });

    // Patch the module singleton the app code actually calls.
    await page.evaluate(async () => {
      window.__processCalls = [];
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const orig = ImageProcessor.processLayer.bind(ImageProcessor);
      ImageProcessor.processLayer = function (layer, opts = {}) {
        window.__processCalls.push({
          id: layer.id,
          forExport: !!opts.forExport,
          pixelWidth: opts.pixelWidth ?? null,
          pixelHeight: opts.pixelHeight ?? null,
          patternScale: opts.patternScale ?? null,
        });
        return orig(layer, opts);
      };
    });

    await mergeSelected(page);

    const calls = await page.evaluate(() => window.__processCalls);
    // The merge's own render pass: explicit composite target + pattern
    // scale on the export path. (Display processing triggered elsewhere
    // carries no composite target and is not part of the merge.)
    const mergeCalls = calls.filter(c => c.pixelWidth !== null);
    expect(mergeCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of mergeCalls) {
      expect(call.forExport).toBe(true);
      expect(call.patternScale).not.toBeNull();
      expect(call.pixelHeight).not.toBeNull();
    }
    // Partner density 2.5px/unit at 400 units → 1000px target; its
    // natural is 1000px, so the pattern scale is exactly 1.
    const pCall = mergeCalls.find(c => c.id === p.id);
    expect(pCall).toBeTruthy();
    expect(pCall.pixelWidth).toBe(1000);
    expect(pCall.pixelHeight).toBe(1000);
    expect(pCall.patternScale).toBeCloseTo(1, 5);
    // The dithered layer (400px natural at 400 units) is rendered at its
    // composite footprint 400×2.5 = 1000px with patternScale 2.5 so its
    // 4px cells rasterize as 10px at the final scale (4-unit dots kept).
    const dCall = mergeCalls.find(c => c.id === d.id);
    expect(dCall).toBeTruthy();
    expect(dCall.pixelWidth).toBe(1000);
    expect(dCall.pixelHeight).toBe(1000);
    expect(dCall.patternScale).toBeCloseTo(2.5, 5);
  });

  // Merge → resize ×2 → merge again: the dither must not compound its
  // distortion across cycles — the second merge re-renders at the new
  // final scale with the pattern size following the single resize.
  test('repeated merge/resize cycles do not compound the dither size change', async ({ page }) => {
    await createProject(page, 'Merge Dither Cycle');
    await page.evaluate(METRICS_SRC);
    const d = await addDitheredLayer(page, { natural: 400, width: 400, cell: 4, x: 100, y: 100 });
    await addPartnerLayer(page, { natural: 1000, width: 400, x: 700, y: 100 });
    await mergeSelected(page);

    // Resize the merged layer ×2 in page space.
    await page.evaluate(() => {
      const m = window.State.layers[0];
      m.width *= 2;
      m.height *= 2;
      m._dirty = true;
    });
    await addPartnerLayer(page, { natural: 400, width: 400, x: 2300, y: 100 });
    const merged2 = await mergeSelected(page);

    const band = await page.evaluate(() => window.__mergedBand(140, 700, 160, 640));
    const dotUnits = band.medianRun / band.pxPerUnit;
    // One resize doubled the on-page dot size; the second merge must
    // carry that through exactly once (not squared, not eroded).
    expect(dotUnits).toBeGreaterThanOrEqual(d.canonicalDotUnits * 2 * 0.7);
    expect(dotUnits).toBeLessThanOrEqual(d.canonicalDotUnits * 2 * 1.3);
    expect(merged2.w).toBeGreaterThan(0);
    expect(band.midToneFrac).toBeLessThan(0.05);
  });

  // Error-diffusion dithering (the Spectrolite path on color separation
  // layers) must behave the same: ditherScale is a plate-pixel knob, so
  // the merge render scales it with the render ratio. Atkinson clusters
  // dots, so the invariant is the dot PITCH (median run) relative to the
  // layer's own canonical render, not an absolute dot size.
  test('error-diffusion dithered separation layer keeps its dot size through merge', async ({ page }) => {
    await createProject(page, 'Merge Errordiff');
    await page.evaluate(METRICS_SRC);

    // Synthetic color-separation layer: one blue ink, 50% tone plate,
    // natural 200px at 200 units (1px/unit), chunky 2px dots (ditherScale 2).
    await page.evaluate(async () => {
      const { Layer } = await import('/src/app/layer.js');
      const { makeSepPlate } = await import('/src/app/separation-methods.js');
      const N = 200;
      const plateData = new Uint8Array(N * N).fill(128); // 0 = full ink, 255 = none
      const sep = new Layer({
        name: 'Sep dither',
        x: 100, y: 100, width: 200, height: 200,
        naturalWidth: N, naturalHeight: N,
        isColorSeparation: true,
        separationColors: ['#0078bf'],
        halftoneType: 'errordiff',
        ditherMethod: 'atkinson',
        ditherScale: 2,
        ditherThreshold: 0.5,
      });
      sep.separationPlates = new Map([['#0078bf', makeSepPlate(N, N, plateData)]]);
      sep._dirty = true;
      window.State.layers.push(sep);
      window.State.selectedIds = [sep.id];
    });

    // Canonical pitch: the layer dithered alone at its natural resolution
    // (1px/unit, so canvas runs are page units directly).
    const canon = await page.evaluate(async () => {
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const sep = window.State.layers.find(l => l.isColorSeparation);
      const c = await ImageProcessor.processLayer(sep, { forExport: true });
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      return window.__bandMetrics(data, c.width, 20, c.width - 20, 20, c.height - 20, 'alpha');
    });

    // Partner with 2.5× density → composite scale 2.5, fractional to the
    // sep layer's own 1px/unit.
    await addPartnerLayer(page, { natural: 1000, width: 400, x: 500, y: 100 });
    await mergeSelected(page);

    // Blue ink (#0078bf) reads darker than paper by luminance.
    const band = await page.evaluate(() => window.__mergedBand(120, 280, 140, 260));
    const pitchUnits = band.medianRun / band.pxPerUnit;
    expect(pitchUnits).toBeGreaterThanOrEqual(canon.medianRun * 0.7);
    expect(pitchUnits).toBeLessThanOrEqual(canon.medianRun * 1.45);
    // Render-before-merge: every pixel is exactly ink or paper — no
    // resampled in-between colors.
    const crisp = await page.evaluate(() => window.__mergedColorCrisp(120, 280, 140, 260, '#0078bf'));
    expect(crisp.otherFrac).toBeLessThan(0.03);
  });
});
