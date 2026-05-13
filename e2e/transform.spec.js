import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, selectTool } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Transform', () => {
  test('move layer by dragging on canvas', async ({ page }) => {
    await createProject(page, 'Move Test');
    await addImage(page, TEST_IMAGE);

    const layer = await page.evaluate(() => {
      // @ts-ignore
      return { x: State.layers[0].x, y: State.layers[0].y };
    });

    const canvasBox = await page.locator('#interaction-overlay').boundingBox();
    if (!canvasBox) throw new Error('Canvas not found');
    const startX = canvasBox.x + canvasBox.width / 2;
    const startY = canvasBox.y + canvasBox.height / 2;

    // Click to select the layer, then drag
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 100, { steps: 5 });
    await page.mouse.up();

    const newLayer = await page.evaluate(() => {
      // @ts-ignore
      return { x: State.layers[0].x, y: State.layers[0].y };
    });

    // Position should have changed
    expect(newLayer.x).not.toBe(layer.x);
  });

  test('resize layer via property inputs', async ({ page }) => {
    await createProject(page, 'Resize Props Test');
    await addImage(page, TEST_IMAGE);

    await page.fill('#prop-w', '200');
    await page.fill('#prop-h', '150');
    await page.keyboard.press('Enter');

    const dims = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { w: l.width, h: l.height };
    });

    expect(dims.w).toBe(200);
    expect(dims.h).toBe(150);
  });

  test('move layer via X/Y property inputs', async ({ page }) => {
    await createProject(page, 'XY Props Test');
    await addImage(page, TEST_IMAGE);

    await page.fill('#prop-x', '100');
    await page.fill('#prop-y', '200');
    await page.keyboard.press('Enter');

    const pos = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { x: l.x, y: l.y };
    });

    expect(pos.x).toBe(100);
    expect(pos.y).toBe(200);
  });

  test('rotate layer via property input', async ({ page }) => {
    await createProject(page, 'Rotate Test');
    await addImage(page, TEST_IMAGE);

    await page.fill('#prop-rot', '45');
    await page.keyboard.press('Enter');

    const rot = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].rotation;
    });

    expect(rot).toBe(45);
  });

  test('flip horizontal', async ({ page }) => {
    await createProject(page, 'Flip H Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#properties-content [data-action="flip-h"]').click();

    const flipped = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].flipH;
    });

    expect(flipped).toBe(true);
  });

  test('flip vertical', async ({ page }) => {
    await createProject(page, 'Flip V Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#properties-content [data-action="flip-v"]').click();

    const flipped = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].flipV;
    });

    expect(flipped).toBe(true);
  });

  test('reset transform', async ({ page }) => {
    await createProject(page, 'Reset Test');
    await addImage(page, TEST_IMAGE);

    // Apply some transforms
    await page.locator('#properties-content [data-action="flip-h"]').click();
    await page.fill('#prop-rot', '45');
    await page.keyboard.press('Enter');

    // Reset
    await page.locator('#properties-content [data-action="reset-transform"]').click();

    const state = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { rotation: l.rotation, flipH: l.flipH, flipV: l.flipV, width: l.width, height: l.height };
    });

    expect(state.rotation).toBe(0);
    expect(state.flipH).toBe(false);
    expect(state.flipV).toBe(false);
    expect(state.width).toBe(state.width); // natural size restored
  });
});
