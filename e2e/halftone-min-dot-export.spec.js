import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addSolidColorImage } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

// ── Harness ────────────────────────────────────────────────────────────────

/**
 * Export the single layer's plate at full page resolution (600 dpi) and
 * measure the average horizontal spacing between ink-run starts inside the
 * layer's inked bounding box. At halftone angle 0 the dot grid is
 * axis-aligned, so that spacing is the screen's cell pitch in device px.
 */
async function measureExportDotPitch(page, halftoneType) {
  return page.evaluate(async (type) => {
    const layer = State.layers.find(l => l.id === State.selectedId);
    layer.halftoneType = type;
    layer.halftoneSize = 1;  // new slider minimum
    layer.halftoneAngle = 0; // axis-aligned grid → pitch is measurable on a row
    layer._dirty = true;

    const { ExportEngine } = await import('/src/app/export-engine.js');
    const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
    const plateMap = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);

    // One ink → one plate; take the first entry.
    const plate = plateMap.values().next().value;
    const w = plate.width, h = plate.height;
    const d = plate.getContext('2d').getImageData(0, 0, w, h).data;

    // Bounding box of inked pixels (the layer is a small solid square).
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4] < 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { pitch: 0, bbox: null };

    // Average spacing between dark-run starts per row, over all rows in
    // the bounding box that contain at least two run starts.
    const spacings = [];
    for (let y = minY; y <= maxY; y++) {
      const starts = [];
      for (let x = minX + 1; x <= maxX; x++) {
        const prev = d[(y * w + x - 1) * 4];
        const cur = d[(y * w + x) * 4];
        if (prev >= 128 && cur < 128) starts.push(x);
      }
      for (let s = 1; s < starts.length; s++) spacings.push(starts[s] - starts[s - 1]);
    }
    if (!spacings.length) return { pitch: 0, bbox: { minX, minY, maxX, maxY } };
    const pitch = spacings.reduce((a, s) => a + s, 0) / spacings.length;
    return { pitch, bbox: { minX, minY, maxX, maxY } };
  }, halftoneType);
}

// ── Tests ──────────────────────────────────────────────────────────────────
//
// The magazine-size anchor: pages rasterize at 600 dpi and a magazine
// screen (133–150 lpi) spans 600/150 = 4 device px per cell, so the
// smallest dot-screen setting must render a ~4 device px pitch in the
// 600-dpi plate — not the sub-resolution 1 px the raw knob would give.

test.describe('Halftone minimum dot size at 600 dpi export', () => {
  test('grunge dots at the minimum setting render a ~4 device px pitch', async ({ page }) => {
    await createProject(page, 'Grunge Min Pitch Export');
    // Mid-gray source: after the 6-level posterize it sits around 60%
    // darkness, so every cell carries a clearly separable dot.
    await addSolidColorImage(page, '#606060');

    const { pitch, bbox } = await measureExportDotPitch(page, 'grunge');
    expect(bbox).not.toBeNull();
    // Jittered/splatted dots wobble around the 4 px cell pitch, but the
    // average must sit near it — the old unfloored minimum rendered a
    // 1 px pitch (sub-resolution noise instead of dots).
    expect(pitch).toBeGreaterThan(2.5);
    expect(pitch).toBeLessThan(6);
  });

  test('magazine dots at the minimum setting render a ~4 device px pitch', async ({ page }) => {
    await createProject(page, 'Dots Min Pitch Export');
    await addSolidColorImage(page, '#606060');

    const { pitch, bbox } = await measureExportDotPitch(page, 'magazine');
    expect(bbox).not.toBeNull();
    // Regular grid, no jitter: the pitch must sit tightly on 4 device px.
    expect(pitch).toBeGreaterThan(3);
    expect(pitch).toBeLessThan(5);
  });
});
