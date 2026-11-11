// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Masks are additive — creating an image mask must not erase a brush mask
   ═══════════════════════════════════════════════════════════════════
   Regression coverage for the report:

     "If I have done a mask with the brush tool and then create an
      image mask with a shape, the old mask is entirely erased by the
      new mask. … All image masks and other masks should be additive
      to the mask, they should not replace the previous mask."

   The render export paths combine the layer's painted mask
   (layer._maskCanvas) with each image mask sequentially (alpha
   multiplication), and neither buffer is touched by the other:
   creating an image mask must leave the painted mask working — on
   screen, on the mask canvas, and on export — under combinations:

   1. base has a painted hole, then an image mask (shape) is created:
      BOTH effects must render (painted hole + masked-out shape ink).
   2. a NEW brush hole painted on the base after the image mask was
      created shows through the combined stack.
   3. the mask layer's own painted mask keeps restricting its mask
      effect (the shape's ink no longer hides the base where it was
      painted away) — the painted mask survives there too.
*/
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
  selectTool,
} from './helpers.js';

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
  pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e));
});

/** On-screen rgb at a layer-space point (fx, fy ∈ [0,1]). */
function screenAt(page, layerId, fx, fy) {
  return page.evaluate(([id, fxx, fyy]) => {
    const l = window.State.layers.find(x => x.id === id);
    const canvas = document.getElementById('display-canvas');
    const cx = Math.round((l.x + l.width * fxx) * window.State.zoom * window.Renderer._displayScale);
    const cy = Math.round((l.y + l.height * fyy) * window.State.zoom * window.Renderer._displayScale);
    const d = canvas.getContext('2d').getImageData(
      Math.min(canvas.width - 1, Math.max(0, cx)),
      Math.min(canvas.height - 1, Math.max(0, cy)), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [layerId, fx, fy]);
}

/** Painted-mask alpha at a layer-space point. */
function maskAlpha(page, layerId, fx, fy) {
  return page.evaluate(([id, fxx, fyy]) => {
    const l = window.State.layers.find(x => x.id === id);
    const mc = l._maskCanvas;
    return mc.getContext('2d').getImageData(
      Math.min(mc.width - 1, Math.round(mc.width * fxx)),
      Math.min(mc.height - 1, Math.round(mc.height * fyy)), 1, 1).data[3];
  }, [layerId, fx, fy]);
}

test.describe('Masks combine additively', () => {
  test('painted mask survives an image mask; both render', async ({ page }) => {
    await createProject(page, 'Masks Additive');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 1000, 1000), { name: 'base.png' });
    // A second, shape-like solid plate set up to overlap the base's
    // bottom-right corner (the import centers the base on the page).
    await page.evaluate(() => {
      const c = new OffscreenCanvas(400, 400);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, 400, 400);
      const l = new window.Layer({
        name: 'shape', x: 1700, y: 2000, width: 400, height: 400,
        naturalWidth: 400, naturalHeight: 400, color: '#010101', colorMode: 'solid',
      });
      l._originalCanvas = c;
      l._dirty = true;
      window.State.layers.push(l);
      window.Renderer.schedule();
    });
    await page.waitForFunction(
      () => State.layers.every(l => !l._dirty) && !State.renderPending,
      null, { timeout: 30_000 });

    // Brush mask: a hole at the base's center.
    await selectTool(page, 'mask-draw');
    const baseIdEarly = await page.evaluate(() => window.State.layers[0].id);
    await page.evaluate(() => {
      const base = window.State.layers[0];
      window.MaskEngine._paint(base, 500, 500, 70, false); // isErasing=false: hide
      window.Renderer.schedule();
    });
    await expect.poll(() => maskAlpha(page, baseIdEarly, 0.5, 0.5), { timeout: 10_000 }).toBe(0);

    // Create an image mask: higher layer = the shape masks the base.
    await page.evaluate(() => {
      window.State.selectedId = window.State.layers[0].id;
      window.State.selectedIds = [window.State.layers[0].id, window.State.layers[1].id];
      window.UI.refreshLayerList();
      window.UI.refreshProperties();
    });
    await expect(page.locator('#btn-create-image-mask')).toBeVisible();
    await page.click('#btn-create-image-mask');
    await page.waitForTimeout(500);

    const baseId = await page.evaluate(() => window.State.layers[0].id);
    // The painted mask's buffer was NOT replaced by the new mask.
    expect(await maskAlpha(page, baseId, 0.5, 0.5)).toBe(0);
    expect(await maskAlpha(page, baseId, 0.1, 0.1)).toBe(255);

    // Both effects render: painted hole = paper; shape ink over the
    // base = paper as well (hidden by the image mask); plain ink = red.
    // The shape sits at page (1700,2000)–(2100,2400); the import centers
    // the base at (650,1550)–(2650,2550), so the overlap in base space is
    // (0.525–0.7, 0.225–0.4).
    await page.waitForTimeout(400);
    const hole = await screenAt(page, baseId, 0.5, 0.5);
    expect(hole[0]).toBeGreaterThan(200); // punched hole survived
    const covered = await screenAt(page, baseId, 0.6, 0.3);
    expect(covered[0]).toBeGreaterThan(200); // shape's ink masked the base there
    const ink = await screenAt(page, baseId, 0.1, 0.1);
    expect(ink[0]).toBeLessThan(200); // red ink intact
    expect(pageErrors).toEqual([]);
  });

  test('a brush hole painted after the image mask still applies', async ({ page }) => {
    await createProject(page, 'Masks Additive Paint');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 1000, 1000), { name: 'base.png' });
    await page.evaluate(() => {
      const c = new OffscreenCanvas(400, 400);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, 400, 400);
      const l = new window.Layer({
        name: 'shape', x: 1700, y: 2000, width: 400, height: 400,
        naturalWidth: 400, naturalHeight: 400, color: '#010101', colorMode: 'solid',
      });
      l._originalCanvas = c;
      l._dirty = true;
      window.State.layers.push(l);
      window.Renderer.schedule();
    });
    await page.waitForFunction(
      () => State.layers.every(l => !l._dirty) && !State.renderPending,
      null, { timeout: 30_000 });

    await page.evaluate(() => {
      window.State.selectedId = window.State.layers[0].id;
      window.State.selectedIds = [window.State.layers[0].id, window.State.layers[1].id];
      window.UI.refreshLayerList();
      window.UI.refreshProperties();
    });
    await page.click('#btn-create-image-mask');
    await page.waitForTimeout(400);

    // Paint a hole in the base's own mask AFTER the image mask exists.
    await selectTool(page, 'mask-draw');
    await page.evaluate(() => {
      const base = window.State.layers[0];
      window.MaskEngine._paint(base, 250, 250, 70, false);
      window.Renderer.schedule();
    });
    await page.waitForTimeout(500);

    const baseId = await page.evaluate(() => window.State.layers[0].id);
    const hole = await screenAt(page, baseId, 0.25, 0.25);
    expect(hole[0]).toBeGreaterThan(200); // the new hole renders through
    const ink = await screenAt(page, baseId, 0.1, 0.1);
    expect(ink[0]).toBeLessThan(200); // the rest still inked
    expect(await maskAlpha(page, baseId, 0.5, 0.5)).toBe(255); // no pre-existing hole
    expect(pageErrors).toEqual([]);
  });
});
