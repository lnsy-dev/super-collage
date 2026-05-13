import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, selectTool } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Shapes', () => {
  test('select rectangle tool', async ({ page }) => {
    await createProject(page, 'Rect Tool Test');
    await selectTool(page, 'shape-rect');
    await expect(page.locator('#shape-options')).toBeVisible();
  });

  test('select ellipse tool', async ({ page }) => {
    await createProject(page, 'Ellipse Tool Test');
    await selectTool(page, 'shape-ellipse');
    await expect(page.locator('#shape-options')).toBeVisible();
  });

  test('select polygon tool', async ({ page }) => {
    await createProject(page, 'Poly Tool Test');
    await selectTool(page, 'shape-poly');
    await expect(page.locator('#shape-options')).toBeVisible();
    await expect(page.locator('#poly-options')).toBeVisible();
  });

  test('switch shape mode to outline', async ({ page }) => {
    await createProject(page, 'Outline Mode Test');
    await selectTool(page, 'shape-rect');

    await page.click('#shape-outline-btn');

    const mode = await page.evaluate(() => {
      // @ts-ignore
      return State.shapeMode;
    });
    expect(mode).toBe('outline');
    await expect(page.locator('#shape-stroke-row')).toBeVisible();
  });

  test('adjust stroke width', async ({ page }) => {
    await createProject(page, 'Stroke Width Test');
    await selectTool(page, 'shape-rect');
    await page.click('#shape-outline-btn');

    await page.fill('#shape-stroke-input', '10');
    await page.keyboard.press('Tab');

    const width = await page.evaluate(() => {
      // @ts-ignore
      return State.shapeStrokeWidth;
    });
    expect(width).toBe(10);
  });

  test('adjust polygon sides', async ({ page }) => {
    await createProject(page, 'Poly Sides Test');
    await selectTool(page, 'shape-poly');

    await page.fill('#poly-sides-input', '8');
    await page.keyboard.press('Tab');

    const sides = await page.evaluate(() => {
      // @ts-ignore
      return State.shapeSides;
    });
    expect(sides).toBe(8);
  });

  test('toggle star mode for polygon', async ({ page }) => {
    await createProject(page, 'Star Toggle Test');
    await selectTool(page, 'shape-poly');

    await page.check('#poly-star-toggle');

    const isStar = await page.evaluate(() => {
      // @ts-ignore
      return State.shapeIsStar;
    });
    expect(isStar).toBe(true);
    await expect(page.locator('#star-ratio-row')).toBeVisible();
  });

  test('adjust star inner ratio', async ({ page }) => {
    await createProject(page, 'Star Ratio Test');
    await selectTool(page, 'shape-poly');
    await page.check('#poly-star-toggle');

    await page.fill('#star-ratio-input', '60');
    await page.keyboard.press('Tab');

    const ratio = await page.evaluate(() => {
      // @ts-ignore
      return State.shapeStarRatio;
    });
    expect(ratio).toBe(0.6);
  });

  test('draw a rectangle shape on canvas', async ({ page }) => {
    await createProject(page, 'Draw Rect Test');
    await selectTool(page, 'shape-rect');

    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 50, y: 50 }, targetPosition: { x: 150, y: 150 } });

    // A new shape layer should have been created
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name').first()).toContainText('Rectangle');
  });

  test('draw an ellipse shape on canvas', async ({ page }) => {
    await createProject(page, 'Draw Ellipse Test');
    await selectTool(page, 'shape-ellipse');

    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 50, y: 50 }, targetPosition: { x: 150, y: 150 } });

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name').first()).toContainText('Ellipse');
  });

  test('draw a polygon shape on canvas', async ({ page }) => {
    await createProject(page, 'Draw Poly Test');
    await selectTool(page, 'shape-poly');

    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 50, y: 50 }, targetPosition: { x: 150, y: 150 } });

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name').first()).toContainText('Polygon');
  });
});
