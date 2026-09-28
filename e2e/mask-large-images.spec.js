// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Masking end-to-end: large images, drag-and-drop, and SVGs
   ═══════════════════════════════════════════════════════════════════
   Regression coverage for the IndexSizeError outbreak:

     Uncaught (in promise) IndexSizeError: Failed to execute
     'convertToBlob' on 'OffscreenCanvas': The size of the
     OffscreenCanvas is zero.  (db.js saveMask / layer-manager
     addFromFile)

   Root cause: Chromium silently allocates a dead 0×0 backing store for
   any canvas whose area exceeds 2^28 px² (the 16384×16384 square).
   Every later readback/encode on such a canvas throws. Two import
   paths produced over-limit canvases:
     - SVGs: intrinsic size is scaled 96→600 DPI (×6.25) before the
       mask canvas is allocated, so large authored dims (e.g. an A4
       poster at 300 DPI) blew the cap; SVGs without intrinsic
       dimensions decoded at 0×0/300×150 and fell through `|| 100`.
     - Huge rasters: natural dims were used for masks unclamped.

   These tests pin the whole masking pipeline for all three import
   channels (file picker, canvas drag-and-drop, clipboard paste) and
   both formats (raster, SVG), including persistence and reload.
 */
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
  createShapePngBuffer, selectTool,
} from './helpers.js';
import sharp from 'sharp';

/* ─── Fixtures ──────────────────────────────────────────────────── */

// A small SVG that exercises normal (non-clamped) vector import.
const SIMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#00a95c"/><circle cx="60" cy="40" r="25" fill="#ffffff"/></svg>`;

// A "large" SVG: authored at A4/300 DPI (2480×3508 px). After the app's
// 96→600 DPI intrinsic scaling this lands at 15500×21925 — far past the
// 16384² canvas area cap that used to kill masking on import.
const LARGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2480" height="3508" viewBox="0 0 2480 3508"><rect width="2480" height="3508" fill="#cc0000"/><circle cx="1240" cy="1754" r="900" fill="#ffffff"/></svg>`;

// An SVG with NO intrinsic dimensions (no width/height, viewBox only) —
// decodes at the 0×0 / 300×150 default box.
const DIMENSIONLESS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect width="200" height="150" fill="#0078bf"/><circle cx="100" cy="75" r="50" fill="#ffffff"/></svg>`;

// A genuinely over-limit raster: 20000×14000 = 280,000,000 px > 2^28.
// Built with sharp (limitInputPixels:false) as a tiny uniform PNG.
async function buildHugeRasterPng() {
  return sharp({
    create: { width: 20000, height: 14000, channels: 3, background: { r: 0, g: 120, b: 191 } },
    limitInputPixels: false,
  }).png().toBuffer();
}

// The big raster fixture from the repo (2000×2000 PNG).
const LARGE_PNG_PATH = 'e2e/fixtures/large-test-image.png';

/* ─── Shared helpers ────────────────────────────────────────────── */

// Drop files onto the canvas wrapper through the real drop handler
// (dispatches a DataTransfer drop, exactly like a user drag).
async function dragDropFiles(page, files) {
  await page.evaluate(async (dropped) => {
    const wrapper = document.getElementById('canvas-wrapper');
    const dt = new DataTransfer();
    for (const f of dropped) {
      const bin = atob(f.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    wrapper.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    wrapper.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
}

// Paint with the mask brush at a layer-space point (fx, fy ∈ [0,1]) of the
// currently selected layer, through the real pointer pipeline.
async function paintAtLayerPoint(page, fx = 0.5, fy = 0.5) {
  const pos = await layerPointOn(page, 'interaction-overlay', fx, fy, 1000);
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function paintAtLayerCenter(page) {
  await paintAtLayerPoint(page, 0.5, 0.5);
}

// Mask diagnostics for the selected (or only) layer.
function maskProbe(page, layerIndex = 0) {
  return page.evaluate((idx) => {
    const l = State.layers[idx];
    if (!l) return { exists: false };
    const mc = l._maskCanvas;
    return {
      exists: true,
      id: l.id,
      isSvg: !!l.isSvg,
      nw: l.naturalWidth, nh: l.naturalHeight,
      w: l.width, h: l.height,
      mask: mc ? { w: mc.width, h: mc.height, allocatable: mc.width * mc.height <= 268435456 } : null,
      centerAlpha: mc
        ? mc.getContext('2d').getImageData(Math.floor(mc.width / 2), Math.floor(mc.height / 2), 1, 1).data[3]
        : null,
    };
  }, layerIndex);
}

// Read the persisted mask blob (or null) for a layer id.
function persistedMask(page, layerId) {
  return page.evaluate(async (id) => {
    const { DB } = await import('/src/app/db.js');
    const rec = await DB.get('maskBlobs', id);
    if (!rec || !rec.blob) return null;
    return { size: rec.blob.size, type: rec.blob.type };
  }, layerId);
}

// Client coordinates of a layer-space point (fx, fy ∈ [0,1]) on a canvas.
// pad: document-px offset baked into that canvas's coordinate space — the
// interaction overlay is shifted by −CANVAS_PAD (1000), the display canvas
// is page-sized with no pad.
async function layerPointOn(page, canvasId, fx = 0.5, fy = 0.5, pad = 0) {
  return page.evaluate(({ canvasId, fx, fy, pad }) => {
    const l = State.layers[0];
    const rect = document.getElementById(canvasId).getBoundingClientRect();
    return {
      x: rect.left + (l.x + l.width * fx + pad) * State.zoom,
      y: rect.top + (l.y + l.height * fy + pad) * State.zoom,
    };
  }, { canvasId, fx, fy, pad });
}

// Screenshot-pixel probe of the on-screen display canvas. Takes viewport
// client coords and converts them to canvas-pixel space before reading.
function screenPixel(page, clientX, clientY) {
  return page.evaluate(({ clientX, clientY }) => {
    const canvas = document.getElementById('display-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(clientX - rect.left), y = Math.round(clientY - rect.top);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return { outOfCanvas: true, cw: canvas.width, ch: canvas.height };
    const d = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }, { clientX, clientY });
}

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
  // Collect uncaught page errors so every assertion below can insist the
  // IndexSizeError outbreak (dead 0×0 mask canvases) never resurfaces.
  pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e));
});

/* ══════════════════════════════════════════════════════════════════
   1. SVG masking (file picker)
   ══════════════════════════════════════════════════════════════════ */

test.describe('SVG masking', () => {
  test('simple SVG: mask brush hides the painted area and persists', async ({ page }) => {
    await createProject(page, 'SVG Mask Simple');
    await addImageFromBuffer(page, Buffer.from(SIMPLE_SVG, 'utf8'), { name: 'simple.svg', mimeType: 'image/svg+xml' });

    const probe = await maskProbe(page);
    expect(probe.isSvg).toBe(true);
    expect(probe.nw).toBeGreaterThan(0);
    expect(probe.nh).toBeGreaterThan(0);
    expect(probe.mask).not.toBeNull();
    expect(probe.mask.allocatable).toBe(true);
    expect(probe.centerAlpha).toBe(255); // fully visible initially

    // Paint a hole through the brush pipeline.
    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);

    // saveMask must have persisted a non-empty PNG (no IndexSizeError).
    const saved = await persistedMask(page, probe.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(saved.type).toBe('image/png');

    // No uncaught page errors during the whole interaction.
    expect(pageErrors.length).toBe(0);
  });

  test('large SVG (A4 @ 300 DPI authored): imports, masks, paints, persists', async ({ page }) => {
    await createProject(page, 'SVG Mask Large');
    await addImageFromBuffer(page, Buffer.from(LARGE_SVG, 'utf8'), { name: 'large.svg', mimeType: 'image/svg+xml' });

    const probe = await maskProbe(page);
    expect(probe.exists).toBe(true);
    expect(probe.isSvg).toBe(true);
    // Intrinsic dims must be clamped inside the canvas allocation envelope
    // (raw 96→600 DPI scaling of 2480×3508 would be 15500×21925).
    expect(probe.nw * probe.nh).toBeLessThanOrEqual(268435456);
    expect(probe.nw).toBeGreaterThan(0);
    expect(probe.nh).toBeGreaterThan(0);
    // Mask canvas exists, is a live size, and starts fully visible.
    expect(probe.mask).not.toBeNull();
    expect(probe.mask.w).toBeGreaterThan(0);
    expect(probe.mask.h).toBeGreaterThan(0);
    expect(probe.mask.allocatable).toBe(true);
    expect(probe.centerAlpha).toBe(255);

    // Brush paint works and saves without IndexSizeError.
    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);

    const saved = await persistedMask(page, probe.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(pageErrors.length).toBe(0);
  });

  test('dimensionless SVG (no width/height): usable layer and mask', async ({ page }) => {
    await createProject(page, 'SVG Mask NoDims');
    await addImageFromBuffer(page, Buffer.from(DIMENSIONLESS_SVG, 'utf8'), { name: 'nodims.svg', mimeType: 'image/svg+xml' });

    const probe = await maskProbe(page);
    expect(probe.exists).toBe(true);
    expect(probe.nw).toBeGreaterThan(0);
    expect(probe.nh).toBeGreaterThan(0);
    expect(probe.w).toBeGreaterThan(0);
    expect(probe.h).toBeGreaterThan(0);
    expect(probe.mask).not.toBeNull();
    expect(probe.mask.w).toBeGreaterThan(0);
    expect(probe.mask.allocatable).toBe(true);
    expect(probe.centerAlpha).toBe(255);
    expect(pageErrors.length).toBe(0);
  });

  test('SVG mask strokes at the right location (edge, not just center)', async ({ page }) => {
    await createProject(page, 'SVG Mask Location');
    await addImageFromBuffer(page, Buffer.from(SIMPLE_SVG, 'utf8'), { name: 'loc.svg', mimeType: 'image/svg+xml' });

    await selectTool(page, 'mask-draw');
    // Paint near the layer's top-left corner.
    const pos = await page.evaluate(() => {
      const l = State.layers[0];
      const rect = document.getElementById('interaction-overlay').getBoundingClientRect();
      return { x: rect.left + (l.x + 10 + 1000) * State.zoom, y: rect.top + (l.y + 10 + 1000) * State.zoom };
    });
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await page.mouse.up();

    const alpha = await page.evaluate(() => {
      const l = State.layers[0];
      const mc = l._maskCanvas;
      return mc.getContext('2d').getImageData(0, 0, 1, 1).data[3];
    });
    expect(alpha).toBe(0);
    // And the rest of the mask is untouched.
    const farAlpha = await page.evaluate(() => {
      const l = State.layers[0];
      const mc = l._maskCanvas;
      return mc.getContext('2d').getImageData(mc.width - 1, mc.height - 1, 1, 1).data[3];
    });
    expect(farAlpha).toBe(255);
    expect(pageErrors.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   2. Large raster masking (file picker)
   ══════════════════════════════════════════════════════════════════ */

test.describe('Large raster masking', () => {
  test('repo large fixture (2000×2000): mask paints, saves, persists', async ({ page }) => {
    await createProject(page, 'Raster 2000sq');
    await addImageFromBuffer(page, createSolidPngBuffer('#0078bf', 2000, 2000), { name: 'big2k.png' });

    const probe = await maskProbe(page);
    expect(probe.nw).toBe(2000);
    expect(probe.mask.w).toBe(2000);
    expect(probe.mask.allocatable).toBe(true);

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);
    const saved = await persistedMask(page, probe.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(pageErrors.length).toBe(0);
  });

  test('over-limit raster (20000×14000): imports with clamped intrinsic size and masks', async ({ page }) => {
    await createProject(page, 'Raster Huge');
    const hugePng = await buildHugeRasterPng();
    await addImageFromBuffer(page, hugePng, { name: 'huge.png' });

    const probe = await maskProbe(page);
    expect(probe.exists).toBe(true);
    // Intrinsic size clamped inside the allocatable envelope.
    expect(probe.nw * probe.nh).toBeLessThanOrEqual(268435456);
    expect(probe.mask).not.toBeNull();
    expect(probe.mask.allocatable).toBe(true);
    expect(probe.centerAlpha).toBe(255);

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);
    const saved = await persistedMask(page, probe.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(pageErrors.length).toBe(0);
  });

  test('large raster: mask erase restores a filled (hidden) layer', async ({ page }) => {
    await createProject(page, 'Raster Erase Large');
    await addImageFromBuffer(page, createShapePngBuffer('rect', 3000, 3000), { name: 'rect3k.png' });

    // Hide everything, then erase a hole back at the center.
    await page.locator('#properties-content [data-action="fill-mask"]').click();
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);

    await selectTool(page, 'mask-erase');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(255);

    const probe = await maskProbe(page);
    const saved = await persistedMask(page, probe.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(pageErrors.length).toBe(0);
  });

  test('large raster: invert / clear / fill all persist valid PNG masks', async ({ page }) => {
    await createProject(page, 'Raster Ops Large');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 4000, 2500), { name: 'ops.png' });

    const ops = ['#properties-content [data-action="fill-mask"]', '#properties-content [data-action="clear-mask"]', '#properties-content [data-action="invert-mask"]'];
    for (const sel of ops) {
      await page.locator(sel).click();
      await page.waitForTimeout(120);
      const probe = await maskProbe(page);
      expect(probe.mask.allocatable).toBe(true);
      const saved = await persistedMask(page, probe.id);
      expect(saved).not.toBeNull();
      expect(saved.size).toBeGreaterThan(0);
      expect(saved.type).toBe('image/png');
    }
    expect(pageErrors.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   3. Drag-and-drop (the channel from the bug report)
   ══════════════════════════════════════════════════════════════════ */

test.describe('Drag-and-drop masking', () => {
  test('drop a large SVG onto the canvas, then mask it', async ({ page }) => {
    await createProject(page, 'Drop SVG Mask');
    await dragDropFiles(page, [{ name: 'dropped-large.svg', type: 'image/svg+xml', b64: Buffer.from(LARGE_SVG, 'utf8').toString('base64') }]);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name')).toContainText('dropped-large');

    const probe = await maskProbe(page);
    expect(probe.isSvg).toBe(true);
    expect(probe.nw * probe.nh).toBeLessThanOrEqual(268435456);
    expect(probe.mask).not.toBeNull();
    expect(probe.mask.allocatable).toBe(true);
    expect(probe.centerAlpha).toBe(255);

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);
    const saved = await persistedMask(page, probe.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(pageErrors.length).toBe(0);
  });

  test('drop an over-limit raster onto the canvas, then mask it', async ({ page }) => {
    await createProject(page, 'Drop Huge Raster');
    const hugePng = await buildHugeRasterPng();
    await dragDropFiles(page, [{ name: 'dropped-huge.png', type: 'image/png', b64: hugePng.toString('base64') }]);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const probe = await maskProbe(page);
    expect(probe.nw * probe.nh).toBeLessThanOrEqual(268435456);
    expect(probe.mask).not.toBeNull();
    expect(probe.mask.allocatable).toBe(true);

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);
    const saved = await persistedMask(page, probe.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(pageErrors.length).toBe(0);
  });

  test('drop a normal raster and mask with erase + paint round trip', async ({ page }) => {
    await createProject(page, 'Drop Normal Raster');
    const png = createSolidPngBuffer('#ff48b0', 1800, 1200);
    await dragDropFiles(page, [{ name: 'dropped.png', type: 'image/png', b64: png.toString('base64') }]);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    await page.locator('#properties-content [data-action="fill-mask"]').click();
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);

    await selectTool(page, 'mask-erase');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(255);

    const probe = await maskProbe(page);
    const saved = await persistedMask(page, probe.id);
    expect(saved).not.toBeNull();
    expect(pageErrors.length).toBe(0);
  });

  test('drop a mask-target SVG together with a raster (multi-file drop)', async ({ page }) => {
    await createProject(page, 'Drop Multi');
    await dragDropFiles(page, [
      { name: 'a.svg', type: 'image/svg+xml', b64: Buffer.from(SIMPLE_SVG, 'utf8').toString('base64') },
      { name: 'b.png', type: 'image/png', b64: createSolidPngBuffer('#00a95c', 1500, 1500).toString('base64') },
    ]);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // The last-dropped layer is selected after import; the brush paints the
    // selection. Paint and confirm the hole lands on the selected layer only.
    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => page.evaluate(() => {
      const sel = State.layers.find(l => l.id === State.selectedId);
      const mc = sel?._maskCanvas;
      return mc ? mc.getContext('2d').getImageData(Math.floor(mc.width / 2), Math.floor(mc.height / 2), 1, 1).data[3] : -1;
    }), { timeout: 5000 }).toBe(0);

    const probes = await page.evaluate(() => State.layers.map(l => ({
      id: l.id,
      isSvg: !!l.isSvg,
      alpha: l._maskCanvas
        ? l._maskCanvas.getContext('2d').getImageData(Math.floor(l._maskCanvas.width / 2), Math.floor(l._maskCanvas.height / 2), 1, 1).data[3]
        : null,
      allocatable: l._maskCanvas ? l._maskCanvas.width * l._maskCanvas.height <= 268435456 : false,
    })));
    const svgProbe = probes.find(p => p.isSvg);
    const rasterProbe = probes.find(p => !p.isSvg);
    expect(svgProbe).toBeTruthy();
    expect(svgProbe.allocatable).toBe(true);
    expect(svgProbe.alpha).toBe(255); // untouched — brush hits the selection only
    expect(rasterProbe).toBeTruthy();
    expect(rasterProbe.allocatable).toBe(true);
    expect(rasterProbe.alpha).toBe(0); // painted

    const savedSvg = await persistedMask(page, svgProbe.id);
    const savedRaster = await persistedMask(page, rasterProbe.id);
    expect(savedSvg).not.toBeNull();
    expect(savedRaster).not.toBeNull();
    expect(pageErrors.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   4. Clipboard paste
   ══════════════════════════════════════════════════════════════════ */

test.describe('Clipboard paste masking', () => {
  test('pasted large SVG layer accepts mask strokes and persists them', async ({ page }) => {
    await createProject(page, 'Paste SVG Mask');
    await page.evaluate(async (svgText) => {
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const item = new DataTransfer();
      item.items.add(new File([blob], 'pasted.svg', { type: 'image/svg+xml' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: item, bubbles: true, cancelable: true }));
    }, LARGE_SVG);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const probe = await maskProbe(page);
    expect(probe.exists).toBe(true);
    expect(probe.isSvg).toBe(true);
    expect(probe.mask).not.toBeNull();
    expect(probe.mask.allocatable).toBe(true);

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);
    const saved = await persistedMask(page, probe.id);
    expect(saved).not.toBeNull();
    expect(pageErrors.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   5. Persistence & reload
   ══════════════════════════════════════════════════════════════════ */

test.describe('Mask persistence across reload', () => {
  test('large SVG mask survives project close/reopen', async ({ page }) => {
    await createProject(page, 'SVG Mask Reload');
    await addImageFromBuffer(page, Buffer.from(LARGE_SVG, 'utf8'), { name: 'reload.svg', mimeType: 'image/svg+xml' });

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    const before = await maskProbe(page);
    expect(before.centerAlpha).toBe(0);
    // Give the debounced saves a beat to land.
    await page.waitForTimeout(300);

    await page.reload();
    await expect(page.locator('#project-dialog')).toBeVisible();
    await page.locator('.project-entry', { hasText: 'SVG Mask Reload' }).click();
    await page.click('#btn-open-project');
    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('.layer-row')).toHaveCount(1);

    // The mask blob must have rehydrated with the painted hole.
    const after = await maskProbe(page);
    expect(after.exists).toBe(true);
    expect(after.isSvg).toBe(true);
    expect(after.centerAlpha).toBe(0);
    const saved = await persistedMask(page, after.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(pageErrors.length).toBe(0);
  });

  test('over-limit raster mask survives project close/reopen', async ({ page }) => {
    await createProject(page, 'Raster Mask Reload');
    const hugePng = await buildHugeRasterPng();
    await addImageFromBuffer(page, hugePng, { name: 'reload-huge.png' });

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    const before = await maskProbe(page);
    expect(before.centerAlpha).toBe(0);
    await page.waitForTimeout(300);

    await page.reload();
    await expect(page.locator('#project-dialog')).toBeVisible();
    await page.locator('.project-entry', { hasText: 'Raster Mask Reload' }).click();
    await page.click('#btn-open-project');
    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('.layer-row')).toHaveCount(1);

    const after = await maskProbe(page);
    expect(after.exists).toBe(true);
    expect(after.centerAlpha).toBe(0);
    expect(after.mask.allocatable).toBe(true);
    const saved = await persistedMask(page, after.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(pageErrors.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   6. Visible effect on screen (renderer applies masks)
   ══════════════════════════════════════════════════════════════════ */

test.describe('Masked rendering on screen', () => {
  test('large raster: painted mask makes the page show paper where ink was hidden', async ({ page }) => {
    await createProject(page, 'Render Mask Effect');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 3000, 3000), { name: 'render.png' });

    // Wait for the first processed frame (import resolves before the
    // scheduled draw lands), then sample the layer center on screen —
    // it should be inked (dark) before masking.
    await page.waitForFunction(() => {
      const l = State.layers[0];
      return l._processedCanvas && !l._dirty;
    }, null, { timeout: 15000 });
    const pos = await page.evaluate(() => {
      const l = State.layers[0];
      const rect = document.getElementById('display-canvas').getBoundingClientRect();
      return {
        x: rect.left + (l.x + l.width / 2) * State.zoom,
        y: rect.top + (l.y + l.height / 2) * State.zoom,
      };
    });
    const before = await screenPixel(page, pos.x, pos.y);
    expect(before.outOfCanvas).toBeFalsy();
    expect(before.r).toBeLessThan(128);

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);
    await page.waitForTimeout(250); // let the scheduled render land

    const after = await screenPixel(page, pos.x, pos.y);
    expect(after.r).toBeGreaterThan(200); // paper white where the hole was punched
    expect(pageErrors.length).toBe(0);
  });

  test('SVG: painted mask hides the SVG ink on screen', async ({ page }) => {
    await createProject(page, 'Render Mask SVG');
    await addImageFromBuffer(page, Buffer.from(SIMPLE_SVG, 'utf8'), { name: 'render.svg', mimeType: 'image/svg+xml' });

    // The fixture's center is a white circle, so sample a point in the green
    // square (fx=0.2 is left of the circle) — and punch the mask hole there.
    const FX = 0.2, FY = 0.5;
    // Wait for the first processed frame before sampling.
    await page.waitForFunction(() => {
      const l = State.layers[0];
      return l._processedCanvas && !l._dirty;
    }, null, { timeout: 15000 });
    const pos = await layerPointOn(page, 'display-canvas', FX, FY);
    const before = await screenPixel(page, pos.x, pos.y);
    expect(before.outOfCanvas).toBeFalsy();
    expect(before.r).toBeLessThan(200); // green square ink, colorized dark

    await selectTool(page, 'mask-draw');
    await paintAtLayerPoint(page, FX, FY);
    await expect.poll(() => page.evaluate(([fx, fy]) => {
      const l = State.layers[0];
      const mc = l._maskCanvas;
      const mx = Math.floor(mc.width * fx), my = Math.floor(mc.height * fy);
      return mc.getContext('2d').getImageData(mx, my, 1, 1).data[3];
    }, [FX, FY]), { timeout: 5000 }).toBe(0);
    await page.waitForTimeout(250);

    const after = await screenPixel(page, pos.x, pos.y);
    expect(after.r).toBeGreaterThan(200); // masked out to paper
    expect(pageErrors.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   7. Downstream features on masked large layers
   ══════════════════════════════════════════════════════════════════ */

test.describe('Downstream features on masked large layers', () => {
  test('duplicate copies a masked large SVG and persists the copy mask', async ({ page }) => {
    await createProject(page, 'Duplicate Masked SVG');
    await addImageFromBuffer(page, Buffer.from(LARGE_SVG, 'utf8'), { name: 'dup.svg', mimeType: 'image/svg+xml' });
    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);

    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    const dup = await page.evaluate(() => {
      const l = State.layers.find(x => x.name.includes(' copy'));
      if (!l || !l._maskCanvas) return null;
      const mc = l._maskCanvas;
      return { id: l.id, alpha: mc.getContext('2d').getImageData(Math.floor(mc.width / 2), Math.floor(mc.height / 2), 1, 1).data[3] };
    });
    expect(dup).not.toBeNull();
    expect(dup.alpha).toBe(0); // hole copied
    const saved = await persistedMask(page, dup.id);
    expect(saved).not.toBeNull();
    expect(saved.size).toBeGreaterThan(0);
    expect(pageErrors.length).toBe(0);
  });

  test('the copy keeps the mask at mask resolution, hole in the same place', async ({ page }) => {
    await createProject(page, 'Duplicate Masked SVG Dims');
    await addImageFromBuffer(page, Buffer.from(LARGE_SVG, 'utf8'), { name: 'dup.svg', mimeType: 'image/svg+xml' });

    // Two holes, one of them well off-centre: a copy pasted 1:1 into a
    // wrongly-sized mask canvas would land the second hole in the wrong
    // place (or not at all).
    await selectTool(page, 'mask-draw');
    await paintAtLayerPoint(page, 0.5, 0.5);
    await paintAtLayerPoint(page, 0.25, 0.25);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);

    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    const masks = await page.evaluate(() => {
      const src = State.layers.find(l => !l.name.includes(' copy'));
      const dup = State.layers.find(l => l.name.includes(' copy'));
      const alphaAt = (layer, fx, fy) => {
        const mc = layer._maskCanvas;
        const mx = Math.min(mc.width - 1, Math.floor(mc.width * fx));
        const my = Math.min(mc.height - 1, Math.floor(mc.height * fy));
        return mc.getContext('2d').getImageData(mx, my, 1, 1).data[3];
      };
      return {
        srcDims: [src._maskCanvas.width, src._maskCanvas.height],
        dupDims: [dup._maskCanvas.width, dup._maskCanvas.height],
        natural: [src.naturalWidth, src.naturalHeight],
        src: [[0.5, 0.5], [0.25, 0.25], [0.8, 0.8]].map(([fx, fy]) => alphaAt(src, fx, fy)),
        dup: [[0.5, 0.5], [0.25, 0.25], [0.8, 0.8]].map(([fx, fy]) => alphaAt(dup, fx, fy)),
      };
    });

    // Same resolution as the source mask — and not the layer's natural size.
    expect(masks.dupDims).toEqual(masks.srcDims);
    expect(masks.dupDims).not.toEqual(masks.natural);
    // Both holes copied, untouched area still visible.
    expect(masks.src).toEqual([0, 0, 255]);
    expect(masks.dup).toEqual(masks.src);
    expect(pageErrors.length).toBe(0);
  });

  test('undo restores the mask state after painting on a large raster', async ({ page }) => {
    await createProject(page, 'Undo Mask Large');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 3500, 2500), { name: 'undo.png' });

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);

    await page.keyboard.press('Control+z');
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(255);
    expect(pageErrors.length).toBe(0);
  });

  test('flatten bakes a painted mask on a large raster into the layer', async ({ page }) => {
    await createProject(page, 'Flatten Mask Large');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 3000, 3000), { name: 'flat.png' });

    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await expect.poll(() => maskProbe(page).then(p => p.centerAlpha), { timeout: 5000 }).toBe(0);

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();
    await page.waitForFunction(() => {
      const l = State.layers[0];
      return l && !l._maskCanvas && l._originalCanvas;
    }, null, { timeout: 15000 });

    const result = await page.evaluate(() => {
      const l = State.layers[0];
      const ctx = l._originalCanvas.getContext('2d');
      const cx = Math.floor(l.naturalWidth / 2), cy = Math.floor(l.naturalHeight / 2);
      const center = ctx.getImageData(cx, cy, 1, 1).data;
      const corner = ctx.getImageData(2, 2, 1, 1).data;
      return { center: center[0], corner: corner[0], nw: l.naturalWidth };
    });
    // Masked-out center was baked to white; untouched corner stays inked.
    expect(result.center).toBe(255);
    expect(result.corner).toBeLessThan(128);
    expect(result.nw).toBeGreaterThan(0);
    // Mask record is removed after flatten (poll: the DB.del is async).
    const layerId = await page.evaluate(() => State.layers[0].id);
    await expect.poll(async () => persistedMask(page, layerId), { timeout: 10000 }).toBeNull();
    expect(pageErrors.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   8. Regression guards (the exact IndexSizeError signatures)
   ══════════════════════════════════════════════════════════════════ */

test.describe('IndexSizeError regression guards', () => {
  test('mask ops on an over-limit SVG never throw and never store zero-byte PNGs', async ({ page }) => {
    await createProject(page, 'Guard OverLimit SVG');
    await addImageFromBuffer(page, Buffer.from(LARGE_SVG, 'utf8'), { name: 'guard.svg', mimeType: 'image/svg+xml' });

    // Drive every mask op through the real UI.
    await page.locator('#properties-content [data-action="fill-mask"]').click();
    await page.locator('#properties-content [data-action="invert-mask"]').click();
    await page.locator('#properties-content [data-action="clear-mask"]').click();
    await selectTool(page, 'mask-draw');
    await paintAtLayerCenter(page);
    await page.waitForTimeout(300);

    const probe = await maskProbe(page);
    expect(probe.mask).not.toBeNull();
    expect(probe.mask.w).toBeGreaterThan(0);
    expect(probe.mask.allocatable).toBe(true);

    const layerId = probe.id;
    // Whatever was saved must be a valid non-empty PNG.
    const saved = await persistedMask(page, layerId);
    if (saved) {
      expect(saved.type).toBe('image/png');
      expect(saved.size).toBeGreaterThan(0);
    }
    expect(pageErrors.length).toBe(0);
  });

  test('saveMask is a no-op (not a crash) when the mask canvas is not allocatable', async ({ page }) => {
    await createProject(page, 'Guard saveMask');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 900, 900), { name: 'guard.png' });

    // Simulate a legacy/foreign layer whose mask canvas is over the limit.
    const outcome = await page.evaluate(async () => {
      const { DB } = await import('/src/app/db.js');
      const l = State.layers[0];
      l._maskCanvas = new OffscreenCanvas(20000, 20000); // dead 0×0 backing store
      let err = null;
      try { await DB.saveMask(l); } catch (e) { err = e.name + ': ' + e.message; }
      return { err };
    });
    expect(outcome.err).toBeNull();

    // And the DB gate rejects zero-byte PNGs outright.
    const gate = await page.evaluate(async () => {
      const { DB } = await import('/src/app/db.js');
      let err = null;
      try {
        await DB.put('maskBlobs', { layerId: 'fake', blob: new Blob([], { type: 'image/png' }) });
      } catch (e) { err = e.message; }
      return err;
    });
    expect(gate).toContain('zero-byte PNG');
    expect(pageErrors.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   8. Mask storage ordering
   ══════════════════════════════════════════════════════════════════ */

test.describe('Mask storage ordering', () => {
  test('a save already in flight cannot resurrect a deleted mask', async ({ page }) => {
    await createProject(page, 'Mask Save Race');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 3000, 3000), { name: 'race.png' });

    // The paint handler kicks off saveMask() without awaiting it, and
    // converting a 3000×3000 mask to PNG takes long enough that a delete
    // issued right after (flatten bakes the mask in, then drops the record)
    // used to land first — leaving a mask record that never went away.
    const result = await page.evaluate(async () => {
      const { DB, State } = window;
      const layer = State.layers[0];
      if (!layer._maskCanvas) return { error: 'no mask canvas' };
      const save = DB.saveMask(layer);        // deliberately not awaited
      await DB.del('maskBlobs', layer.id);    // ... and deleted right after
      await save;
      const rec = await DB.get('maskBlobs', layer.id);
      return { present: !!rec };
    });
    expect(result).toEqual({ present: false });
    expect(pageErrors.length).toBe(0);
  });
});
