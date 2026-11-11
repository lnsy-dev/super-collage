// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Resize + flatten does not crash on oversized layers
   ═══════════════════════════════════════════════════════════════════
   Regression coverage for the report:

     "occasionally resizing and then flattening large images and the
      application crashes"

   Root cause: text layers grow naturalWidth/naturalHeight on every box
   resize/refit with no allocation guard. A layer resized past the
   browser's canvas envelope (2^28 px² area) allocates dead 0×0 bitmaps
   whose first readback throws — flatten then crashed with an uncaught
   IndexSizeError / getImageData OOM and left the layer half-baked
   (isText flipped off while the raster never survived).

   The fix: every natural-size write goes through Layer.setNaturalSize
   (constructor guard), processing targets are clamped in
   ImageProcessor (display supersampling + export), and the text/SVG
   bake steps plus flatten's natural-size allocation clamp too, so the
   baked raster always exists and flatten completes without uncaught
   errors.
*/
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
} from './helpers.js';

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
  pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e));
});

/** Flatten the given (single) layer through the UI button and wait for
 *  the bake to complete. Oversized reprocessing work drains first so the
 *  click isn't racing a busy main thread. */
async function flattenViaUI(page, idleTimeout = 60_000) {
  await page.waitForFunction(
    () => State.layers.every(l => !l._dirty) && !State.renderPending,
    null, { timeout: idleTimeout },
  );
  await page.evaluate(() => {
    State.selectedId = State.layers[0].id;
    State.selectedIds = [State.layers[0].id];
  });
  // Flatten of an armed oversized layer runs long synchronous pixel
  // passes; the default 5s action timeout would abort the click mid-work.
  page.setDefaultTimeout(90_000);
  await page.locator('#layer-buttons [data-action="flatten-layer"]').click();
}

test.describe('Flatten after resize — oversized layers must not crash', () => {
  test('text layer resized past the canvas allocation cap flattens cleanly', async ({ page }) => {
    await createProject(page, 'Flatten Oversized Text');
    // A text layer, then resized far past the 2^28 px² canvas cap.
    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    await page.locator('.text-editor-input').waitFor({ timeout: 15000 });
    await page.fill('.text-editor-input', 'Oversized text flatten');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    const created = await page.evaluate(() => {
      const l = State.layers[0];
      return { isText: l.isText, nw: l.naturalWidth };
    });
    expect(created.isText).toBe(true);

    // The resize that used to crash flatten: natural size blows the cap.
    await page.evaluate(() => {
      const l = State.layers[0];
      l.width = 30000;
      l.height = 20000;
      l.setNaturalSize(l.width, l.height);
      l._dirty = true;
      Renderer.schedule();
    });
    await page.waitForTimeout(2000);
    const clamped = await page.evaluate(() => {
      const l = State.layers[0];
      // The guard keeps natural sizes allocatable after ANY resize.
      return { nw: l.naturalWidth, nh: l.naturalHeight, px: l.naturalWidth * l.naturalHeight };
    });
    expect(clamped.px).toBeLessThanOrEqual(268435456);

    await flattenViaUI(page);
    // Flatten must complete (no half-baked state, no uncaught errors).
    await page.waitForFunction(() => {
      const l = State.layers[0];
      return l && !l.isText && l._originalCanvas && !l._dirty;
    }, null, { timeout: 30000 });
    const after = await page.evaluate(() => {
      const l = State.layers[0];
      return {
        isText: l.isText, nw: l.naturalWidth, nh: l.naturalHeight,
        px: l.naturalWidth * l.naturalHeight,
        origLive: l._originalCanvas.width * l._originalCanvas.height > 0,
      };
    });
    expect(after.isText).toBe(false);
    expect(after.origLive).toBe(true);
    expect(after.px).toBeLessThanOrEqual(268435456);
    expect(pageErrors, 'no uncaught flatten errors').toEqual([]);
  });

  test('display rendering of an oversized text layer does not throw', async ({ page }) => {
    await createProject(page, 'Flatten Oversized Text Render');
    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    await page.locator('.text-editor-input').waitFor({ timeout: 15000 });
    await page.fill('.text-editor-input', 'Render with clamp');
    await page.keyboard.press('Escape');

    // Resize past the cap and let the renderer re-process (the draw was
    // where the uncaught Out-of-memory getImageData surfaced).
    await page.evaluate(() => {
      const l = State.layers[0];
      l.width = 30000;
      l.height = 20000;
      l.setNaturalSize(l.width, l.height);
      l._dirty = true;
      Renderer.schedule();
    });
    await page.waitForFunction(() => {
      const l = State.layers[0];
      return l && l._processedCanvas && !l._dirty;
    }, null, { timeout: 30000 });
    const live = await page.evaluate(() => {
      const l = State.layers[0];
      return {
        procW: l._processedCanvas.width,
        procH: l._processedCanvas.height,
        px: l._processedCanvas.width * l._processedCanvas.height,
      };
    });
    expect(live.px).toBeLessThanOrEqual(268435456);
    expect(live.procW).toBeGreaterThan(0);
    expect(pageErrors, 'no uncaught reprocessing errors').toEqual([]);
  });

  test('big raster + painted mask + resize + flatten keeps its ink and stays stable', async ({ page }) => {
    await createProject(page, 'Flatten Big Raster Resize');
    const buf = createSolidPngBuffer('#cc0000', 6000, 6000);
    await addImageFromBuffer(page, buf, { name: 'big.png' });
    await page.waitForFunction(() => {
      const l = State.layers[0];
      return l && l._originalCanvas && !l._dirty;
    }, null, { timeout: 30000 });

    // Paint a mask: hide everything, restore a hole at the quarter point.
    await page.evaluate(() => {
      const l = State.layers[0];
      MaskEngine.fillMask(l);
      MaskEngine._paint(l, l.naturalWidth * 0.25, l.naturalHeight * 0.5,
        l.naturalWidth * 0.1, true);
      // Resize the layer display size up (what a handle drag does).
      l.width *= 2; l.height *= 2;
      l._dirty = true;
      Renderer.schedule();
    });
    await page.waitForTimeout(2000);

    await flattenViaUI(page);
    await page.waitForFunction(() => {
      const l = State.layers[0];
      return l && !l._maskCanvas && l._originalCanvas && !l._dirty;
    }, null, { timeout: 60000 });
    const after = await page.evaluate(() => {
      const l = State.layers[0];
      const ctx = l._originalCanvas.getContext('2d');
      return {
        nw: l.naturalWidth, nh: l.naturalHeight,
        center: ctx.getImageData(Math.floor(l.naturalWidth / 2), Math.floor(l.naturalHeight / 2), 1, 1).data,
        ink: ctx.getImageData(Math.floor(l.naturalWidth * 0.5), Math.floor(l.naturalHeight * 0.25), 1, 1).data,
      };
    });
    expect(after.nw).toBeGreaterThan(0);
    expect(after.nw).toBeLessThan(6000); // cropped to the visible bbox
    // The crop surrounds the restored mask hole (fill hid everything;
    // the eraser restored one spot), so its centre is the plate's red ink.
    expect(after.center[0]).toBe(204);
    expect(after.ink[0]).toBe(204); // the plate's own red ink survives
    expect(pageErrors, 'no uncaught flatten errors').toEqual([]);
  });

  test('oversized SVG mask layer flattens via export-scale processing without crashing', async ({ page }) => {
    await createProject(page, 'Flatten Oversized Svg Pair');
    // Authored A4: 96→600 DPI scaling puts natural size at ~15k×21k.
    const LARGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2480" height="3508" viewBox="0 0 2480 3508"><rect width="2480" height="3508" fill="#cc0000"/><rect x="1240" width="1240" height="3508" fill="#ffffff"/></svg>`;
    await page.setInputFiles('#file-input', {
      name: 'big.svg', mimeType: 'image/svg+xml',
      buffer: Buffer.from(LARGE_SVG, 'utf8'),
    });
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForFunction(() => {
      const l = State.layers[0];
      return l && l._processedCanvas && !l._dirty;
    }, null, { timeout: 30000 });
    const sizes = await page.evaluate(() => {
      const l = State.layers[0];
      return { nw: l.naturalWidth, nh: l.naturalHeight };
    });
    expect(Math.max(sizes.nw, sizes.nh)).toBeGreaterThan(4096);

    // Difference-mask pair with a resize, then flatten the base: the
    // mask layers get processed at export scale inside flatten.
    await page.evaluate(async () => {
      const baseId = State.layers[0].id;
      await LayerManager.duplicate(baseId);
      State.selectedId = baseId;
      State.selectedIds = [baseId, State.layers[1].id];
      await handleAction('create-difference-mask');
      await PageManager.queueIdle();
      for (const l of State.layers) { l.width *= 2; l.height *= 2; }
      Renderer.schedule();
    });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      State.selectedId = State.layers[0].id;
      State.selectedIds = [State.layers[0].id];
    });
    await flattenViaUI(page);

    await page.waitForFunction(() => {
      const l = State.layers[0];
      return l && !l.isSvg && l._originalCanvas && !l._dirty;
    }, null, { timeout: 60000 });
    const after = await page.evaluate(() => {
      const l = State.layers[0];
      const ctx = l._originalCanvas.getContext('2d');
      return {
        isSvg: l.isSvg, nw: l.naturalWidth, nh: l.naturalHeight,
        corner: ctx.getImageData(2, 2, 1, 1).data[0],
        px: l.naturalWidth * l.naturalHeight,
      };
    }).catch(e => ({ probeError: String(e) }));
    if (after.probeError) throw new Error(after.probeError);
    expect(after.isSvg).toBe(false);
    expect(after.px).toBeLessThanOrEqual(268435456);
    expect(pageErrors, 'no uncaught flatten errors').toEqual([]);
  });
});
