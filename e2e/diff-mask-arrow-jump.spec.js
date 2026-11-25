// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Difference-mask pair + arrow-key nudge must not jump the masked layer

   Regression coverage for the report:

     "When I create a difference mask and then go to mask further, the
     masked layer 'jumps' when I press down key."

   The user's repro, scripted here: create a difference mask, simulate a
   click on the canvas, then press the down key. A "jump" would show up as
   the base layer of the pair (the layer being masked) ending up at a
   position other than the +1px nudge the arrow key is documented to give
   (see e2e/keyboard.spec.js 'arrow keys nudge selected layer'), or moving
   at all without the mask layer staying glued to it.

   Model under test:
     - create-difference-mask links the base and its mask layer;
     - pressing an arrow key in select mode nudges the selection by 1px
       (10px with Shift) and carries linked layers with it
       (events.js arrow handler);
     - a click on the canvas must not move any layer by itself.
  ═══════════════════════════════════════════════════════════════════ */
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
} from './helpers.js';

/** Find the difference-mask pair after creation: [base, mask] with base.imageMaskIds = [maskId]. */
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

/** Click on the canvas at the center of the layer (document space → screen). */
async function clickLayerCenter(page, id) {
  const pt = await page.evaluate(lid => {
    const l = window.State.layers.find(x => x.id === lid);
    const canvas = document.getElementById('display-canvas');
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(rect.left + (l.x + l.width / 2) * window.State.zoom),
      y: Math.round(rect.top + (l.y + l.height / 2) * window.State.zoom),
    };
  }, id);
  await page.mouse.click(pt.x, pt.y);
}

test.describe('Difference-mask pair + arrow nudge', () => {
  test('click then down key: the masked layer moves only by the nudge, pair stays linked', async ({ page }) => {
    await clearIndexedDB(page);
    await createProject(page, 'Diff Mask Arrow Jump');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc2222', 100, 100), { name: 'base.png' });
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    await page.locator('.layer-row').nth(0).click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('#btn-create-difference-mask')).toBeVisible();
    await page.click('#btn-create-difference-mask');

    // Wait for the async create-difference-mask completion (selection + saves).
    await page.waitForFunction(() => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
      return !!base && !window.State.renderPending;
    }, null, { timeout: 15000 });

    const { baseId, maskId } = await diffPair(page);
    await page.waitForFunction(() =>
      window.State.layers.every(l => !l._dirty) && !window.State.renderPending
    , null, { timeout: 15000 });

    const before = {
      base: await layerRect(page, baseId),
      mask: await layerRect(page, maskId),
    };

    // --- The user's repro: simulate a click on the canvas over the base.
    await clickLayerCenter(page, baseId);
    await page.waitForTimeout(200);
    const afterClick = {
      base: await layerRect(page, baseId),
      mask: await layerRect(page, maskId),
    };
    expect(afterClick.base).toEqual(before.base);
    expect(afterClick.mask).toEqual(before.mask);

    // --- Press the down key with select mode active.
    await page.evaluate(() => window.UI.setTool('select'));
    await page.waitForFunction(() => window.State.tool === 'select', null, { timeout: 5000 });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    const afterDown = {
      base: await layerRect(page, baseId),
      mask: await layerRect(page, maskId),
    };

    // A nudge moves the selected pair down by exactly 1px — no jump.
    expect(afterDown.base.y).toBe(before.base.y + 1);
    expect(afterDown.base.x).toBe(before.base.x);
    expect(afterDown.base.width).toBe(before.base.width);
    expect(afterDown.base.height).toBe(before.base.height);
    // The mask layer is glued to the base: same relative offset as before,
    // only the nudge applied.
    expect(afterDown.mask.y - afterDown.base.y).toBe(before.mask.y - before.base.y);
    expect(afterDown.mask.x - afterDown.base.x).toBe(before.mask.x - before.base.x);
    expect(afterDown.mask.width).toBe(before.mask.width);
    expect(afterDown.mask.height).toBe(before.mask.height);

    // Still linked and still the difference-mask pair.
    const pairAfter = await diffPair(page);
    expect(pairAfter.baseId).toBe(baseId);
    expect(pairAfter.maskId).toBe(maskId);
  });

  test('base alone selected + down key: the pair still moves as one unit', async ({ page }) => {
    await clearIndexedDB(page);
    await createProject(page, 'Diff Mask Arrow Jump 2');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc2222', 100, 100), { name: 'base.png' });
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    await page.locator('.layer-row').nth(0).click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('#btn-create-difference-mask')).toBeVisible();
    await page.click('#btn-create-difference-mask');

    await page.waitForFunction(() => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
      return base && !window.State.renderPending;
    }, null, { timeout: 15000 });

    const { baseId, maskId } = await diffPair(page);

    const before = {
      base: await layerRect(page, baseId),
      mask: await layerRect(page, maskId),
    };

    // Select only the base row, press down.
    await page.evaluate(id => {
      const base = window.State.layers.find(l => l.id === id);
      window.State.selectedId = base.id;
      window.State.selectedIds = [base.id];
      window.UI.refreshLayerList();
    }, baseId);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    const afterDown = {
      base: await layerRect(page, baseId),
      mask: await layerRect(page, maskId),
    };
    expect(afterDown.base.y).toBe(before.base.y + 1);
    expect(afterDown.mask.y).toBe(before.mask.y + 1);
    expect(afterDown.base.x).toBe(before.base.x);
    expect(afterDown.mask.x).toBe(before.mask.x);
    expect(afterDown.base.height).toBe(before.base.height);
    expect(afterDown.mask.height).toBe(before.mask.height);
  });
});
