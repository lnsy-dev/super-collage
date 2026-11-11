// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Shift+drag straight-line brush strokes (45° snap)
   ═══════════════════════════════════════════════════════════════════
   With Shift held, a mask brush stroke locks to one of the 8 snap
   directions (0/45/90/…) from the stroke's anchor point. Probing the
   painted mask along the expected snapped ray must show a hole at the
   ray's far end, while a shift-free stroke paints along its own
   (unsnapped) drag slope.
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

/** Probe a layer-space point (fx, fy ∈ [0,1]) in a layer's mask canvas. */
function maskAlpha(page, layerIndex, fx, fy) {
  return page.evaluate(([i, fxx, fyy]) => {
    const l = window.State.layers[i];
    const mc = l._maskCanvas;
    const mx = Math.min(mc.width - 1, Math.round(mc.width * fxx));
    const my = Math.min(mc.height - 1, Math.round(mc.height * fyy));
    return mc.getContext('2d').getImageData(mx, my, 1, 1).data[3];
  }, [layerIndex, fx, fy]);
}

/** Client point (fx, fy ∈ [0,1] of the layer) on the interaction overlay. */
async function layerPoint(page, fx, fy) {
  return page.evaluate(([fxx, fyy]) => {
    const l = window.State.layers[0];
    const rect = document.getElementById('interaction-overlay').getBoundingClientRect();
    return {
      x: rect.left + (l.x + l.width * fxx + 1000) * window.State.zoom,
      y: rect.top + (l.y + l.height * fyy + 1000) * window.State.zoom,
    };
  }, [fx, fy]);
}

async function stroke(page, from, to, { shift = false } = {}) {
  await page.mouse.move(from.x, from.y);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

test.describe('Shift straight-line brush strokes', () => {
  test('shift+drag snaps a sloped drag onto the 45° ray', async ({ page }) => {
    await createProject(page, 'Shift Brush Line');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 2000, 2000), { name: 'brush.png' });
    await page.waitForFunction(
      () => State.layers.every(l => !l._dirty) && !State.renderPending,
      null, { timeout: 30_000 });
    await selectTool(page, 'mask-draw');

    // Drag from (0.25, 0.25) toward (0.4, 0.325): a shallow ~26° slope.
    // Layer space (square layer): dx = 0.15, dy = 0.075 → len 0.1677;
    // snapped to 45°, the ray's far end lands at (0.25 + 0.1677·√2/2,
    // 0.25 + same) ≈ (0.3686, 0.3686) — NOT at the raw drag target.
    const anchor = await layerPoint(page, 0.25, 0.25);
    const raw = await layerPoint(page, 0.4, 0.325);
    await stroke(page, anchor, raw, { shift: true });

    // Hole at the start, hole at the snapped 45° endpoint.
    await expect.poll(() => maskAlpha(page, 0, 0.25, 0.25), { timeout: 10_000 }).toBe(0);
    const end = 0.25 + 0.075 * 2 * Math.SQRT1_2;
    await expect.poll(() => maskAlpha(page, 0, end, end), { timeout: 10_000 }).toBe(0);
    // The raw (unsnapped) drag target sits off the ray — no drop there to
    // the side of the ray end… actually a snapped filter bends the pointer
    // onto the ray only, so nothing painted at (0.4, 0.3).
    expect(await maskAlpha(page, 0, 0.4, 0.30)).toBe(255);
    expect(pageErrors).toEqual([]);
  });

  test('a shift-free stroke paints along its own (unsnapped) slope', async ({ page }) => {
    await createProject(page, 'Free Brush Drag');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 2000, 2000), { name: 'brush.png' });
    await page.waitForFunction(
      () => State.layers.every(l => !l._dirty) && !State.renderPending,
      null, { timeout: 30_000 });
    await selectTool(page, 'mask-draw');

    const anchor = await layerPoint(page, 0.25, 0.25);
    const raw = await layerPoint(page, 0.4, 0.325);
    await stroke(page, anchor, raw);

    // The free stroke follows the drag target: the hole lands at the raw
    // end point (0.4, 0.325) — not at the snapped-diagonal endpoint.
    await expect.poll(() => maskAlpha(page, 0, 0.4, 0.325), { timeout: 10_000 }).toBe(0);
    expect(pageErrors).toEqual([]);
  });
});
