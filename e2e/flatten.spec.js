import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, addImageFromBuffer, createShapePngBuffer, createSolidPngBuffer } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Flatten layer', () => {
  test('flatten button is present in layer buttons', async ({ page }) => {
    await createProject(page, 'Flatten Button Test');
    await addImage(page, TEST_IMAGE);
    await expect(page.locator('#layer-buttons [data-action="flatten-layer"]')).toBeVisible();
  });

  test('flatten crops to visible pixels without a mask', async ({ page }) => {
    await createProject(page, 'Flatten Crop Test');
    // 200x200 image with a 100x100 black rect centered on white.
    await addImageFromBuffer(page, createShapePngBuffer('rect', 200, 200), { name: 'rect.png' });

    const before = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { nw: l.naturalWidth, nh: l.naturalHeight, x: l.x, y: l.y, w: l.width, h: l.height };
    });

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      return {
        nw: l.naturalWidth,
        nh: l.naturalHeight,
        x: l.x,
        y: l.y,
        w: l.width,
        h: l.height,
        hasMaskCanvas: !!l._maskCanvas,
        imageMaskIds: l.imageMaskIds?.length || 0,
      };
    });

    // The black rect occupies the center 100x100 pixels.
    expect(after.nw).toBe(100);
    expect(after.nh).toBe(100);
    // Display size scaled proportionally.
    expect(Math.round(after.w)).toBe(Math.round(before.w * 100 / before.nw));
    expect(Math.round(after.h)).toBe(Math.round(before.h * 100 / before.nh));
    // Position adjusted so the visible content stays in the same place (no rotation).
    expect(Math.round(after.x)).toBe(Math.round(before.x + (before.w - after.w) / 2));
    expect(Math.round(after.y)).toBe(Math.round(before.y + (before.h - after.h) / 2));
    expect(after.hasMaskCanvas).toBe(false);
    expect(after.imageMaskIds).toBe(0);
  });

  test('flatten applies manual mask and crops', async ({ page }) => {
    await createProject(page, 'Flatten Manual Mask Test');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 200, 200), { name: 'solid.png' });

    // Hide everything, then reveal a circle on the right side.
    await page.evaluate(() => {
      const l = window.State.layers[0];
      window.MaskEngine.fillMask(l);
      window.MaskEngine._paint(l, l.naturalWidth * 0.75, l.naturalHeight / 2, l.naturalWidth / 4, true);
    });

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      return {
        nw: l.naturalWidth,
        nh: l.naturalHeight,
        hasMaskCanvas: !!l._maskCanvas,
      };
    });

    // The revealed circle is 100x100 in natural pixels.
    expect(after.nw).toBe(100);
    expect(after.nh).toBe(100);
    expect(after.hasMaskCanvas).toBe(false);
  });

  test('flatten applies image mask, removes relationship, and deletes mask layer', async ({ page }) => {
    await createProject(page, 'Flatten Image Mask Test');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 200, 200), { name: 'base.png' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 150, 200), { name: 'maskimg.png' });

    // Position the mask layer over the left 150px of the base.
    await page.evaluate(() => {
      const base = window.State.layers[0];
      const mask = window.State.layers[1];
      mask.x = base.x;
      mask.y = base.y;
    });

    await page.evaluate(async () => {
      const base = window.State.layers[0];
      const mask = window.State.layers[1];
      window.State.selectedIds = [base.id, mask.id];
      window.State.selectedId = mask.id;
      await window.handleAction('create-image-mask');
    });

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    await page.locator('.layer-row').nth(0).click();
    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      return {
        layerCount: window.State.layers.length,
        nw: l.naturalWidth,
        nh: l.naturalHeight,
        imageMaskIds: l.imageMaskIds?.length || 0,
        hasMaskCanvas: !!l._maskCanvas,
      };
    });

    // Mask layer should be deleted after flatten.
    expect(after.layerCount).toBe(1);
    // Base layer should be cropped to the 50px-wide visible strip on the right.
    expect(after.nw).toBe(50);
    expect(after.nh).toBe(200);
    expect(after.imageMaskIds).toBe(0);
    expect(after.hasMaskCanvas).toBe(false);
  });
});
