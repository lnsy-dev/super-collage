/* ═══════════════════════════════════════════════════════════════════
   Difference-mask pair + mask tools must not move the pair at zoom —
   user repros from #supercollage:

     1. "When I create a difference mask, then zoom in and try to mask
        with the mask tools, the targeted image moves."
     2. "When I click and drag with a difference mask, the masks move in
        different directions and do not stay lined up."

   These specs assert the DESIRED behavior:
     - painting with the mask tools at zoom leaves every layer of the
       pair in place (their state geometry unchanged);
     - a click-and-drag with the mask tools changes nothing;
     - a click-and-drag with the select tool moves base and mask together
       (same delta, offsets unchanged);
     - scrolling the canvas while zoomed does not move the pair.

   Interactions go through the app's real pointer handlers on the
   interaction overlay (dispatched PointerEvents with overlay-space
   coordinates — deterministic, and the same handlers real clicks run).
   ═══════════════════════════════════════════════════════════════════ */
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
} from './helpers.js';

/** Find the difference-mask pair: [base, mask] with base.imageMaskIds = [maskId]. */
function diffPair(page) {
  return page.evaluate(() => {
    const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
    if (!base) throw new Error('no difference mask pair found');
    const mask = window.State.layers.find(l => l.id === base.imageMaskIds[0]);
    return { baseId: base.id, maskId: mask.id };
  });
}

/** Rect of a layer, in document space. */
function layerRect(page, id) {
  return page.evaluate(lid => {
    const l = window.State.layers.find(x => x.id === lid);
    return { x: l.x, y: l.y, width: l.width, height: l.height };
  }, id);
}

/** Create the difference pair and wait for the async create to finish. */
async function setupDiffPair(page, projectName) {
  await clearIndexedDB(page);
  await createProject(page, projectName);
  await addImageFromBuffer(page, createSolidPngBuffer('#cc2222', 100, 100), { name: 'base.png' });
  await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

  await page.locator('.layer-row').nth(0).click();
  await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('#btn-create-difference-mask')).toBeVisible();
  await page.click('#btn-create-difference-mask');

  await page.waitForFunction(() => {
    const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
    return !!base && !window.State.renderPending;
  }, null, { timeout: 15000 });
  const { baseId, maskId } = await diffPair(page);
  await settle(page);
  return { baseId, maskId };
}

/** Set zoom like the zoom-in/zoom-out actions do, then let the renderer settle. */
async function setZoom(page, z) {
  await page.evaluate(zoom => {
    window.State.zoom = zoom;
    window.Renderer.resize();
    window.Renderer.schedule();
  }, z);
  await page.waitForFunction(() => !window.State.renderPending && !window.State.zoomDebounceTimer,
    null, { timeout: 15000 });
  await page.waitForTimeout(200);
}

async function setTool(page, tool) {
  await page.evaluate(t => window.UI.setTool(t), tool);
  await page.waitForFunction(t => window.State.tool === t, tool, { timeout: 5000 });
}

/** Select a single layer in select mode. */
async function selectLayer(page, id) {
  await page.evaluate(lid => {
    window.State.selectedId = lid;
    window.State.selectedIds = [lid];
    window.UI.refreshLayerList();
    window.UI.refreshProperties();
  }, id);
  await page.waitForFunction(lid => window.State.selectedId === lid, id, { timeout: 5000 });
}

/** Overlay-space client point of a layer's center (what hitTestLayer/onPointer* use). */
function layerPointOnOverlay(page, layerId, fx, fy) {
  return page.evaluate(({ layerId, fx, fy }) => {
    const l = window.State.layers.find(x => x.id === layerId);
    const z = window.State.zoom;
    const ov = document.getElementById('interaction-overlay');
    const rect = ov.getBoundingClientRect();
    const b = window.Renderer._getLayerScreenBounds(l, z);
    const padPx = -parseFloat(ov.style.left || '0px');
    const ox = b.left + padPx + b.width * fx;
    const oy = b.top + padPx + b.height * fy;
    const hit = window.Renderer.hitTestLayer(ox, oy);
    return { ox: Math.round(ox), oy: Math.round(oy), clientX: Math.round(rect.left + ox), clientY: Math.round(rect.top + oy), hitId: hit && hit.id };
  }, { layerId, fx, fy });
}

/** Dispatch pointer events on the interaction overlay (the app's real handlers). */
async function dispatchPointer(page, { ox, oy, down = false, move = false, up = false }) {
  await page.evaluate(({ ox, oy, down, up, move }) => {
    const overlay = document.getElementById('interaction-overlay');
    const rect = overlay.getBoundingClientRect();
    const mk = (type, buttons) => new PointerEvent(type, {
      clientX: rect.left + ox, clientY: rect.top + oy,
      pointerId: 1, isPrimary: true, buttons, pointerType: 'mouse',
    });
    if (move) overlay.dispatchEvent(mk('pointermove', 1));
    if (down) overlay.dispatchEvent(mk('pointerdown', 0));
    if (up) overlay.dispatchEvent(mk('pointerup', 0));
  }, { ox, oy, down, up, move });
}

/** Mask revision of a layer — a nonzero increase proves painting actually happened. */
function maskRev(page, id) {
  return page.evaluate(lid => {
    const l = window.State.layers.find(x => x.id === lid);
    return l._maskRev || 0;
  }, id);
}

/** Pair rects snapshot. */
async function pairRects(page, { baseId, maskId }) {
  return {
    base: await layerRect(page, baseId),
    mask: await layerRect(page, maskId),
  };
}

/** Wait until all layers are clean and nothing renders. */
async function settle(page) {
  await page.waitForFunction(() =>
    window.State.layers.every(l => !l._dirty) && !window.State.renderPending
  , null, { timeout: 15000 });
}

test.describe('Difference-mask pair + mask tools at zoom', () => {
  test('zoom in, then paint on the base: the pair stays in place', async ({ page }) => {
    const { baseId, maskId } = await setupDiffPair(page, 'Diff Mask Zoom Paint');
    await settle(page);
    await setZoom(page, 2);
    await setTool(page, 'mask-draw');
    await selectLayer(page, baseId);

    const pt = await layerPointOnOverlay(page, baseId, 0.5, 0.5);
    const before = await pairRects(page, { baseId, maskId });
    const revBase = await maskRev(page, baseId);
    const revMask = await maskRev(page, maskId);
    await dispatchPointer(page, { ox: pt.ox, oy: pt.oy, down: true, up: true });
    await settle(page);
    const after = await pairRects(page, { baseId, maskId });

    expect(await maskRev(page, baseId), 'paint on the base actually happened').toBeGreaterThan(revBase);
    expect(await maskRev(page, maskId), 'pair mask untouched').toBe(revMask);
    expect(after.base).toEqual(before.base);
    expect(after.mask).toEqual(before.mask);
  });

  test('zoom in, then paint on the mask layer: the pair stays in place', async ({ page }) => {
    const { baseId, maskId } = await setupDiffPair(page, 'Diff Mask Zoom Paint Mask');
    await settle(page);
    await setZoom(page, 2);
    await setTool(page, 'mask-draw');
    await selectLayer(page, maskId);

    const pt = await layerPointOnOverlay(page, maskId, 0.5, 0.5);
    const before = await pairRects(page, { baseId, maskId });
    const revMask = await maskRev(page, maskId);
    await dispatchPointer(page, { ox: pt.ox, oy: pt.oy, down: true, up: true });
    await settle(page);
    const after = await pairRects(page, { baseId, maskId });

    expect(await maskRev(page, maskId), 'paint on the mask layer actually happened').toBeGreaterThan(revMask);
    expect(after.base).toEqual(before.base);
    expect(after.mask).toEqual(before.mask);
  });

  test('click-and-drag with mask-draw: the pair stays in place', async ({ page }) => {
    const { baseId, maskId } = await setupDiffPair(page, 'Diff Mask Zoom Drag');
    await settle(page);
    await setZoom(page, 2);
    await setTool(page, 'mask-draw');
    await selectLayer(page, baseId);

    const pt = await layerPointOnOverlay(page, baseId, 0.5, 0.5);
    const before = await pairRects(page, { baseId, maskId });
    await dispatchPointer(page, { ox: pt.ox, oy: pt.oy, move: true });
    await dispatchPointer(page, { ox: pt.ox + 40, oy: pt.oy + 25, down: true });
    await dispatchPointer(page, { ox: pt.ox + 40, oy: pt.oy + 25, move: true });
    await dispatchPointer(page, { ox: pt.ox + 80, oy: pt.oy + 50, move: true });
    await dispatchPointer(page, { ox: pt.ox + 80, oy: pt.oy + 50, up: true });
    await settle(page);
    const after = await pairRects(page, { baseId, maskId });

    expect(after.base).toEqual(before.base);
    expect(after.mask).toEqual(before.mask);
  });

  test('click-and-drag with select: base and mask stay lined up', async ({ page }) => {
    const { baseId, maskId } = await setupDiffPair(page, 'Diff Mask Zoom Drag Sel');
    await settle(page);
    await setZoom(page, 2);
    // The mask layer is the topmost of the pair — that's what hitTestLayer
    // finds when a user presses on the pair, so select it.
    await selectLayer(page, maskId);

    const pt = await layerPointOnOverlay(page, maskId, 0.5, 0.5);
    const before = await pairRects(page, { baseId, maskId });
    await dispatchPointer(page, { ox: pt.ox, oy: pt.oy, down: true });
    await dispatchPointer(page, { ox: pt.ox + 40, oy: pt.oy + 25, move: true });
    await dispatchPointer(page, { ox: pt.ox + 40, oy: pt.oy + 25, up: true });
    await settle(page);
    const after = await pairRects(page, { baseId, maskId });

    // The drag must have happened at all.
    expect(after.mask.x - before.mask.x, 'mask moved with the drag').toBeGreaterThan(0.5);
    expect(after.mask.y - before.mask.y, 'mask moved with the drag').toBeGreaterThan(0.5);
    // Base and mask moved as one unit: same delta, offsets unchanged.
    expect(after.mask.x - after.base.x, `mask relative x (before ${before.mask.x - before.base.x})`)
      .toBeCloseTo(before.mask.x - before.base.x, 5);
    expect(after.mask.y - after.base.y, `mask relative y (before ${before.mask.y - before.base.y})`)
      .toBeCloseTo(before.mask.y - before.base.y, 5);
    expect(after.mask.width).toBeCloseTo(before.mask.width, 5);
    expect(after.mask.height).toBeCloseTo(before.mask.height, 5);
    expect(after.base.width).toBeCloseTo(before.base.width, 5);
    expect(after.base.height).toBeCloseTo(before.base.height, 5);
  });

  test('scroll while zoomed: the pair does not move', async ({ page }) => {
    const { baseId, maskId } = await setupDiffPair(page, 'Diff Mask Zoom Scroll');
    await settle(page);
    await setZoom(page, 2);
    await setTool(page, 'mask-draw');
    await selectLayer(page, baseId);

    const before = await pairRects(page, { baseId, maskId });
    await page.evaluate(() => {
      const el = document.getElementById('canvas-scroll');
      el.scrollLeft += 80;
      el.scrollTop += 40;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const after = await pairRects(page, { baseId, maskId });

    expect(after.base).toEqual(before.base);
    expect(after.mask).toEqual(before.mask);
  });
});
