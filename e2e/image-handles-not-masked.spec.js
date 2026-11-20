// @ts-check
import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

async function expectHandlesVisible(page, label) {
  const result = await page.evaluate(() => {
    const layer = State.layers.find(l => l.id === State.selectedId);
    if (!layer) return { error: 'no selected layer' };
    Renderer.drawOverlay();
    const handles = Renderer.getHandles(layer, State.zoom);
    const canvas = document.getElementById('interaction-overlay');
    const ctx = canvas.getContext('2d');
    const samples = handles.map(h => {
      const sx = Math.round(h.x * Renderer._overlayScale);
      const sy = Math.round(h.y * Renderer._overlayScale);
      const inBounds = sx >= 0 && sy >= 0 && sx < canvas.width && sy < canvas.height;
      let alpha = 0;
      if (inBounds) {
        alpha = ctx.getImageData(sx, sy, 1, 1).data[3];
      }
      return { id: h.id, inBounds, alpha };
    });
    return { handleCount: handles.length, samples };
  });
  expect(result.error, label).toBeUndefined();
  expect(result.handleCount, `${label}: handle count`).toBe(9);
  for (const s of result.samples) {
    expect(s.inBounds, `${label}: handle ${s.id} in overlay bounds`).toBe(true);
    expect(s.alpha, `${label}: handle ${s.id} drawn`).toBeGreaterThan(0);
  }
}

async function moveSelectedAndExpectHandles(page, positions, labelPrefix) {
  for (const pos of positions) {
    await page.evaluate(({ x, y }) => {
      const layer = State.layers.find(l => l.id === State.selectedId);
      layer.x = x; layer.y = y;
      Renderer.schedule();
    }, pos);
    await page.waitForTimeout(30);
    await expectHandlesVisible(page, `${labelPrefix} at (${pos.x},${pos.y})`);
  }
}

const EXTREME_POSITIONS = [
  { x: -500, y: -400 },
  { x: 2000, y: 1500 },
  { x: 4000, y: 3000 },
  { x: -1500, y: -1500 }, // beyond base CANVAS_PAD margin
  { x: 7000, y: 7000 },
];

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Image handles not masked by mask or position', () => {
  test('selected image has handles when fully painted-masked', async ({ page }) => {
    await createProject(page, 'Handles Painted Mask');
    await addImage(page, TEST_IMAGE);
    await page.locator('#properties-content [data-action="fill-mask"]').click();
    await expectHandlesVisible(page, 'painted-masked image');
  });

  test('selected image has handles at extreme positions', async ({ page }) => {
    await createProject(page, 'Handles Extreme Pos');
    await addImage(page, TEST_IMAGE);
    await moveSelectedAndExpectHandles(page, EXTREME_POSITIONS, 'image');
  });

  test('base image with image mask applied keeps handles at extreme positions', async ({ page }) => {
    await createProject(page, 'Handles Masked Base');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Create image mask: higher layer becomes mask, mask layer selected after.
    await page.locator('.layer-row').nth(0).click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('#btn-create-image-mask')).toBeVisible();
    await page.click('#btn-create-image-mask');

    // Select the base layer (the one being masked) and verify its handles
    // remain visible regardless of position.
    await page.evaluate(() => {
      const base = State.layers.find(l => l.imageMaskIds && l.imageMaskIds.length > 0);
      State.selectedId = base.id;
      State.selectedIds = [base.id];
      Renderer.drawOverlay();
    });
    await expectHandlesVisible(page, 'masked base layer');
    await moveSelectedAndExpectHandles(page, EXTREME_POSITIONS, 'masked base');
  });

  test('image mask layer (isMaskFor) keeps handles when selected and repositioned', async ({ page }) => {
    await createProject(page, 'Handles Image Mask Layer');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    await page.locator('.layer-row').nth(0).click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('#btn-create-image-mask')).toBeVisible();
    await page.click('#btn-create-image-mask');

    const selectedIsMask = await page.evaluate(() => {
      const sel = State.layers.find(l => l.id === State.selectedId);
      return !!sel?.isMaskFor;
    });
    expect(selectedIsMask).toBe(true);

    await expectHandlesVisible(page, 'image mask layer');
    await moveSelectedAndExpectHandles(page, EXTREME_POSITIONS, 'image mask layer');
  });
});
