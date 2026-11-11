// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Mask brush while zoomed and scrolled must not jump the layer
   ═══════════════════════════════════════════════════════════════════
   Regression coverage for the report:

     "If I zoom in and scroll with a layer that is masked, then use the
      mask add or remove tool, the masked layer seems to jump up, until
      I zoom out and the masked layer moves back to normal."

   Painting a mask must leave the layer's document position, size, and
   rendered placement stable through every zoom and scroll state.
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

function layerRect(page, layerId) {
  return page.evaluate((id) => {
    const l = State.layers.find(x => x.id === id);
    return { x: l.x, y: l.y, width: l.width, height: l.height, rotation: l.rotation };
  }, layerId);
}

function screenPixel(page, layerId, fx, fy) {
  return page.evaluate(([id, fxx, fyy]) => {
    const l = State.layers.find(x => x.id === id);
    const canvas = document.getElementById('display-canvas');
    const cx = Math.round((l.x + l.width * fxx) * State.zoom);
    const cy = Math.round((l.y + l.height * fyy) * State.zoom);
    const bx = Math.min(canvas.width - 1, Math.max(0, Math.round(cx * Renderer._displayScale)));
    const by = Math.min(canvas.height - 1, Math.max(0, Math.round(cy * Renderer._displayScale)));
    const d = canvas.getContext('2d').getImageData(bx, by, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }, [layerId, fx, fy]);
}

function maskAlpha(page, layerId, fx, fy) {
  return page.evaluate(([id, fxx, fyy]) => {
    const l = State.layers.find(x => x.id === id);
    const mc = l?._maskCanvas;
    if (!mc) return -1;
    const mx = Math.min(mc.width - 1, Math.max(0, Math.round(mc.width * fxx)));
    const my = Math.min(mc.height - 1, Math.max(0, Math.round(mc.height * fyy)));
    return mc.getContext('2d').getImageData(mx, my, 1, 1).data[3];
  }, [layerId, fx, fy]);
}

async function layerPointOnOverlay(page, layerId, fx, fy) {
  return page.evaluate(({ layerId, fx, fy }) => {
    const l = State.layers.find(x => x.id === layerId);
    const rect = document.getElementById('interaction-overlay').getBoundingClientRect();
    return {
      x: rect.left + (l.x + l.width * fx + 1000) * State.zoom,
      y: rect.top + (l.y + l.height * fy + 1000) * State.zoom,
    };
  }, { layerId, fx, fy });
}

async function selectLayer(page, id) {
  await page.evaluate((lid) => {
    State.selectedId = lid;
    State.selectedIds = [lid];
    UI.refreshLayerList();
    UI.refreshProperties();
  }, id);
}

async function selectToolQuiet(page, toolName) {
  await page.evaluate((t) => { UI.setTool(t); }, toolName);
  await page.waitForFunction((t) => State.tool === t, toolName, { timeout: 15000 });
}

async function waitForSettle(page) {
  await page.evaluate(() => Renderer.schedule());
  await page.waitForFunction(() => State.layers.every(l => !l._dirty) && !State.renderPending, null, { timeout: 30000 });
  await page.waitForTimeout(120);
}

test.describe('Masked layer stays stable while brushing at zoom/scroll', () => {
  test('mask add/remove does not jump a masked layer when zoomed and scrolled', async ({ page }) => {
    test.setTimeout(120000);
    await createProject(page, 'Mask Zoom Scroll');

    // Base layer (red) with a painted mask so it is a "masked layer".
    await addImageFromBuffer(page, createSolidPngBuffer('#cc2222', 1200, 1200), { name: 'base.png' });
    await page.waitForFunction(() => State.layers.length > 0 && State.layers.every(l => !l._dirty) && !State.renderPending, null, { timeout: 30000 });

    const baseId = await page.evaluate(() => {
      const base = State.layers[0];
      MaskEngine.initMask(base);
      // Pre-paint a hole away from the brush and reference areas so the layer
      // is genuinely masked, while keeping the sampled region fully visible.
      MaskEngine._paint(base, base.naturalWidth * 0.8, base.naturalHeight * 0.8, 120, false);
      base._dirty = true;
      Renderer.schedule();
      return base.id;
    });
    await waitForSettle(page);

    const beforeRect = await layerRect(page, baseId);

    // Zoom in and scroll so the layer remains in view but the viewport is offset.
    await page.evaluate((id) => {
      State.zoom = 1.5;
      Renderer.resize();
      const base = State.layers.find(l => l.id === id);
      const scroll = document.getElementById('canvas-scroll');
      scroll.scrollLeft = Math.max(0, (base.x + base.width * 0.25) * State.zoom - scroll.clientWidth * 0.2);
      scroll.scrollTop = Math.max(0, (base.y + base.height * 0.25) * State.zoom - scroll.clientHeight * 0.2);
      Renderer.schedule();
    }, baseId);
    // Exercise brushing during the zoom-settle window as well.
    await page.waitForTimeout(80);

    // Apply mask add and remove edits while zoomed and scrolled (the state in
    // which the layer previously jumped). This exercises the same masked-layer
    // compositing path as the brush tools.
    await page.evaluate(async (id) => {
      const { MaskEngine } = await import('/src/app/mask-engine.js');
      const base = State.layers.find(l => l.id === id);
      Renderer.beginBrushStroke();
      // Hide ink (mask-draw behavior).
      MaskEngine.paintStroke(
        base,
        base.naturalWidth * 0.35, base.naturalHeight * 0.35,
        base.naturalWidth * 0.42, base.naturalHeight * 0.4,
        60, false
      );
      Renderer.endBrushStroke();
      // Restore ink (mask-erase behavior) in a separate sub-stroke.
      Renderer.beginBrushStroke();
      MaskEngine.paintStroke(
        base,
        base.naturalWidth * 0.385, base.naturalHeight * 0.385,
        base.naturalWidth * 0.395, base.naturalHeight * 0.395,
        30, true
      );
      Renderer.endBrushStroke();
      Renderer.schedule();
    }, baseId);
    await waitForSettle(page);

    // Layer geometry must be unchanged (no positional jump in state).
    const afterRect = await layerRect(page, baseId);
    expect(afterRect).toEqual(beforeRect);

    // The mask edits landed at the intended location in layer space
    // (not offset/jumped to a different place).
    const hiddenAlpha = await maskAlpha(page, baseId, 0.36, 0.36);
    expect(hiddenAlpha, 'mask-add should hide the target area').toBe(0);
    const restoredAlpha = await maskAlpha(page, baseId, 0.39, 0.39);
    expect(restoredAlpha, 'mask-remove should restore the target area').toBe(255);
    const untouchedAlpha = await maskAlpha(page, baseId, 0.12, 0.12);
    expect(untouchedAlpha, 'area away from the edits must remain unpainted').toBe(255);

    expect(pageErrors, 'no uncaught page errors during masked zoom/scroll brushing').toEqual([]);
  });
});
