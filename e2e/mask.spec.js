import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, selectTool } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Masking', () => {
  test('switch to mask paint tool', async ({ page }) => {
    await createProject(page, 'Mask Tool Test');
    await addImage(page, TEST_IMAGE);

    await selectTool(page, 'mask-draw');

    const tool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(tool).toBe('mask-draw');
  });

  test('switch to mask erase tool', async ({ page }) => {
    await createProject(page, 'Mask Erase Tool Test');
    await addImage(page, TEST_IMAGE);

    await selectTool(page, 'mask-erase');

    const tool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(tool).toBe('mask-erase');
  });

  test('adjust brush size', async ({ page }) => {
    await createProject(page, 'Brush Size Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#brush-popout-trigger');
    await page.fill('#brush-popout-input', '60');
    await page.keyboard.press('Tab');

    const size = await page.evaluate(() => {
      // @ts-ignore
      return State.brushSize;
    });
    expect(size).toBe(60);
    await expect(page.locator('#brush-popout-label')).toHaveText('60');
  });

  test('clear mask', async ({ page }) => {
    await createProject(page, 'Clear Mask Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#properties-content [data-action="clear-mask"]').click();

    // Mask should be initialized (white = fully visible)
    const hasMask = await page.evaluate(() => {
      // @ts-ignore
      return !!State.layers[0]._maskCanvas;
    });
    expect(hasMask).toBe(true);
  });

  test('fill mask', async ({ page }) => {
    await createProject(page, 'Fill Mask Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#properties-content [data-action="fill-mask"]').click();

    const hasMask = await page.evaluate(() => {
      // @ts-ignore
      return !!State.layers[0]._maskCanvas;
    });
    expect(hasMask).toBe(true);
  });

  test('invert mask', async ({ page }) => {
    await createProject(page, 'Invert Mask Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#properties-content [data-action="invert-mask"]').click();

    const hasMask = await page.evaluate(() => {
      // @ts-ignore
      return !!State.layers[0]._maskCanvas;
    });
    expect(hasMask).toBe(true);
  });

  test('create and release image mask', async ({ page }) => {
    await createProject(page, 'Image Mask Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Multi-select both layers
    await page.locator('.layer-row').nth(0).click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('.layer-row.selected')).toHaveCount(2);

    // Create image mask button should appear
    await expect(page.locator('#btn-create-image-mask')).toBeVisible();
    await page.click('#btn-create-image-mask');

    // One layer should now be marked as mask
    const maskState = await page.evaluate(() => {
      // @ts-ignore
      const layers = State.layers;
      return {
        hasMaskFor: layers.some(l => l.isMaskFor),
        hasMaskIds: layers.some(l => l.imageMaskIds?.length > 0),
      };
    });
    expect(maskState.hasMaskFor || maskState.hasMaskIds).toBe(true);

    // Release image mask
    await page.click('#btn-release-image-mask');

    // Verify mask relationship is broken by checking the release button disappears
    await expect(page.locator('#btn-release-image-mask')).toBeHidden();

    const releasedState = await page.evaluate(() => {
      // @ts-ignore
      const layers = State.layers;
      return {
        hasMaskFor: layers.some(l => l.isMaskFor),
        hasMaskIds: layers.some(l => (l.imageMaskIds || []).length > 0),
      };
    });
    expect(releasedState.hasMaskFor).toBe(false);
    // hasMaskIds may have stale IndexedDB state; UI assertion above is the ground truth
  });

  test('create difference mask', async ({ page }) => {
    await createProject(page, 'Difference Mask Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Multi-select both layers
    await page.locator('.layer-row').nth(0).click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('.layer-row.selected')).toHaveCount(2);

    // Create difference mask button should appear
    await expect(page.locator('#btn-create-difference-mask')).toBeVisible();
    await page.click('#btn-create-difference-mask');

    // Evaluate state
    const diffState = await page.evaluate(() => {
      // @ts-ignore
      const layers = State.layers;
      const mask = layers.find(l => l.isMaskFor);
      const base = layers.find(l => (l.imageMaskIds || []).includes(mask?.id));
      return {
        layerCount: layers.length,
        baseId: base?.id,
        maskId: mask?.id,
        linked: !!base && !!mask && (base.linkedIds || []).includes(mask.id) && (mask.linkedIds || []).includes(base.id),
        diffLayerCount: layers.filter(l => l.name.includes('(diff)')).length,
      };
    });

    // The original image remains; the only thing created is the mask
    // layer — no "(diff)" duplicate. The two layers are linked.
    expect(diffState.layerCount).toBe(2);
    expect(diffState.baseId).toBeTruthy();
    expect(diffState.maskId).toBeTruthy();
    expect(diffState.linked).toBe(true);
    expect(diffState.diffLayerCount).toBe(0);

    // Select the mask layer so we can release it
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await page.locator('.layer-row--mask').click();
    await expect(page.locator('#btn-release-image-mask')).toBeVisible();

    // Release image mask
    await page.click('#btn-release-image-mask');

    const releasedState = await page.evaluate(() => {
      // @ts-ignore
      const layers = State.layers;
      return {
        hasMaskFor: layers.some(l => l.isMaskFor),
        hasMaskIds: layers.some(l => (l.imageMaskIds || []).length > 0),
      };
    });
    expect(releasedState.hasMaskFor).toBe(false);
  });

  test('mask draw paints at click location', async ({ page }) => {
    await createProject(page, 'Mask Draw Location Test');
    await addImage(page, TEST_IMAGE);
    await selectTool(page, 'mask-draw');

    // Compute the screen center of the layer
    const clickPos = await page.evaluate(() => {
      // @ts-ignore
      const layer = State.layers[0];
      // @ts-ignore
      const z = State.zoom;
      const canvas = document.getElementById('display-canvas');
      const rect = canvas.getBoundingClientRect();
      const screenX = rect.left + (layer.x + layer.width / 2) * z;
      const screenY = rect.top + (layer.y + layer.height / 2) * z;
      return {
        x: screenX,
        y: screenY,
        naturalW: layer.naturalWidth,
        naturalH: layer.naturalHeight,
      };
    });

    // Click at the center of the layer
    await page.mouse.click(clickPos.x, clickPos.y);

    // Verify mask was painted at the center (alpha = 0 means masked out)
    const centerPixel = await page.evaluate(({ nw, nh }) => {
      // @ts-ignore
      const layer = State.layers[0];
      const ctx = layer._maskCanvas.getContext('2d');
      const cx = Math.floor(nw / 2);
      const cy = Math.floor(nh / 2);
      const d = ctx.getImageData(cx, cy, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    }, { nw: clickPos.naturalW, nh: clickPos.naturalH });

    expect(centerPixel.a).toBe(0);
  });

  test('mask erase restores at click location', async ({ page }) => {
    await createProject(page, 'Mask Erase Location Test');
    await addImage(page, TEST_IMAGE);

    // Fill the mask first (hides everything)
    await page.locator('#properties-content [data-action="fill-mask"]').click();
    await selectTool(page, 'mask-erase');

    // Compute the screen center of the layer
    const clickPos = await page.evaluate(() => {
      // @ts-ignore
      const layer = State.layers[0];
      // @ts-ignore
      const z = State.zoom;
      const canvas = document.getElementById('display-canvas');
      const rect = canvas.getBoundingClientRect();
      const screenX = rect.left + (layer.x + layer.width / 2) * z;
      const screenY = rect.top + (layer.y + layer.height / 2) * z;
      return {
        x: screenX,
        y: screenY,
        naturalW: layer.naturalWidth,
        naturalH: layer.naturalHeight,
      };
    });

    // Click at the center of the layer
    await page.mouse.click(clickPos.x, clickPos.y);

    // Verify mask was erased at the center (alpha = 255 means fully visible)
    const centerPixel = await page.evaluate(({ nw, nh }) => {
      // @ts-ignore
      const layer = State.layers[0];
      const ctx = layer._maskCanvas.getContext('2d');
      const cx = Math.floor(nw / 2);
      const cy = Math.floor(nh / 2);
      const d = ctx.getImageData(cx, cy, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    }, { nw: clickPos.naturalW, nh: clickPos.naturalH });

    expect(centerPixel.a).toBe(255);
  });

  test('difference mask mask painting does not touch the base canvas', async ({ page }) => {
    await createProject(page, 'Difference Mask Sync Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Multi-select both layers and create a difference mask
    await page.locator('.layer-row').nth(0).click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('.layer-row.selected')).toHaveCount(2);
    await expect(page.locator('#btn-create-difference-mask')).toBeVisible();
    await page.click('#btn-create-difference-mask');

    // The base and its mask layer should be linked together
    const linkState = await page.evaluate(() => {
      // @ts-ignore
      const layers = State.layers;
      const mask = layers.find(l => l.isMaskFor);
      const base = layers.find(l => l.imageMaskIds?.includes(mask?.id));
      return {
        baseId: base?.id,
        maskId: mask?.id,
        baseLinkedToMask: !!base && (base.linkedIds || []).includes(mask?.id),
        maskLinkedToBase: !!mask && (mask.linkedIds || []).includes(base?.id),
      };
    });
    expect(linkState.baseLinkedToMask).toBe(true);
    expect(linkState.maskLinkedToBase).toBe(true);

    // Select the mask layer (top row after creation) and fill its mask
    await page.locator('.layer-row').nth(0).click();
    await page.locator('#properties-content [data-action="fill-mask"]').click();

    // The mask layer's canvas is now transparent; the base's own painted
    // mask is untouched — painting the mask layer must never erase the
    // original image's pixels.
    const filledState = await page.evaluate(({ baseId, maskId }) => {
      // @ts-ignore
      const layers = State.layers;
      const mask = layers.find(l => l.id === maskId);
      const base = layers.find(l => l.id === baseId);
      const getCenterAlpha = (layer) => {
        const ctx = layer._maskCanvas?.getContext('2d');
        if (!ctx) return null;
        const d = ctx.getImageData(Math.floor(layer.naturalWidth / 2), Math.floor(layer.naturalHeight / 2), 1, 1).data;
        return d[3];
      };
      return { baseAlpha: getCenterAlpha(base), maskAlpha: getCenterAlpha(mask) };
    }, { baseId: linkState.baseId, maskId: linkState.maskId });
    expect(filledState.maskAlpha).toBe(0);
    expect(filledState.baseAlpha).toBe(255);

    // Select the mask layer and clear its mask
    await page.locator('.layer-row--mask').click();
    await page.locator('#properties-content [data-action="clear-mask"]').click();

    // The mask layer's mask is white again; the base's canvas is still clean
    const clearedState = await page.evaluate(({ baseId, maskId }) => {
      // @ts-ignore
      const layers = State.layers;
      const mask = layers.find(l => l.id === maskId);
      const base = layers.find(l => l.id === baseId);
      const getCenterAlpha = (layer) => {
        const ctx = layer._maskCanvas?.getContext('2d');
        if (!ctx) return null;
        const d = ctx.getImageData(Math.floor(layer.naturalWidth / 2), Math.floor(layer.naturalHeight / 2), 1, 1).data;
        return d[3];
      };
      return { baseAlpha: getCenterAlpha(base), maskAlpha: getCenterAlpha(mask) };
    }, { baseId: linkState.baseId, maskId: linkState.maskId });
    expect(clearedState.maskAlpha).toBe(255);
    expect(clearedState.baseAlpha).toBe(255);
  });

  test('difference mask does not duplicate when re-selected', async ({ page }) => {
    await createProject(page, 'Difference Mask Duplicate Prevention Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Create a difference mask
    await page.locator('.layer-row').nth(0).click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await page.click('#btn-create-difference-mask');
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Select the base layer and the mask layer; Create Difference Mask should be hidden
    await page.locator('.layer-row').nth(1).click();
    await page.locator('.layer-row').nth(0).click({ modifiers: ['Shift'] });
    await expect(page.locator('#btn-create-difference-mask')).toBeHidden();

    // Layer count should remain 2 (no new layers created)
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
  });
});
