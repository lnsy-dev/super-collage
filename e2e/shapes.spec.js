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
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    // A new shape layer should have been created
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name').first()).toContainText('Rectangle');

    // Tool should switch back to select after drawing a shape
    const currentTool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(currentTool).toBe('select');
  });

  test('draw an ellipse shape on canvas', async ({ page }) => {
    await createProject(page, 'Draw Ellipse Test');
    await selectTool(page, 'shape-ellipse');

    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name').first()).toContainText('Ellipse');
  });

  test('draw a polygon shape on canvas', async ({ page }) => {
    await createProject(page, 'Draw Poly Test');
    await selectTool(page, 'shape-poly');

    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name').first()).toContainText('Polygon');
  });

  test('shape attributes panel appears for selected shape', async ({ page }) => {
    await createProject(page, 'Shape Attributes Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    await expect(page.locator('#shape-attributes')).toBeVisible();
    await expect(page.locator('#prop-shape-fill')).toBeVisible();
    await expect(page.locator('#prop-shape-border')).toBeVisible();
  });

  test('toggle shape border on and off', async ({ page }) => {
    await createProject(page, 'Toggle Border Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    await page.check('#prop-shape-border');
    let hasStroke = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers.find(l => l.id === State.selectedId);
      return l?.shapeHasStroke;
    });
    expect(hasStroke).toBe(true);

    await page.uncheck('#prop-shape-border');
    hasStroke = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers.find(l => l.id === State.selectedId);
      return l?.shapeHasStroke;
    });
    expect(hasStroke).toBe(false);
  });

  test('adjust shape border width', async ({ page }) => {
    await createProject(page, 'Border Width Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    await page.check('#prop-shape-border');
    await page.fill('#prop-shape-stroke-width-num', '12');
    await page.keyboard.press('Tab');

    const width = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers.find(l => l.id === State.selectedId);
      return l?.shapeStrokeWidth;
    });
    expect(width).toBe(12);
  });

  test('change shape border color', async ({ page }) => {
    await createProject(page, 'Border Color Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    await page.check('#prop-shape-border');
    await page.locator('#shape-stroke-swatches .color-swatch[data-color="#f65058"]').click();

    const color = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers.find(l => l.id === State.selectedId);
      return { stroke: l?.shapeStrokeColor, ink: l?.color };
    });
    expect(color.stroke).toBe('#f65058');
  });

  test('shape can have distinct body and border colors', async ({ page }) => {
    await createProject(page, 'Two Tone Shape Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    // Fill on (default), enable border, then pick distinct colors.
    await page.check('#prop-shape-border');
    await page.locator('#shape-fill-swatches .color-swatch[data-color="#0078bf"]').click();
    await page.locator('#shape-stroke-swatches .color-swatch[data-color="#f65058"]').click();

    const info = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers.find(l => l.id === State.selectedId);
      return { fill: l.shapeFillColor, stroke: l.shapeStrokeColor };
    });
    expect(info.fill).toBe('#0078bf');
    expect(info.stroke).toBe('#f65058');

    // The rendered shape shows both colors.
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const l = State.layers.find(l => l.id === State.selectedId);
      await ImageProcessor.processLayer(l, {});
      await Renderer.draw();
    });
    const samples = await page.evaluate(() => {
      const canvasEl = document.getElementById('display-canvas');
      const ctx = canvasEl.getContext('2d');
      const z = State.zoom;
      // @ts-ignore
      const l = State.layers.find(l => l.id === State.selectedId);
      const cx = (l.x + l.width / 2) * z;
      const cy = (l.y + l.height / 2) * z;
      const px = (x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
      return {
        center: px(cx, cy),                      // body
        edge: px((l.x + 3 / z) * z, cy),         // inside left border
      };
    });
    // Blue-ish body center
    expect(samples.center[2]).toBeGreaterThan(samples.center[0]);
    // Pink-ish border (red channel dominant)
    expect(samples.edge[0]).toBeGreaterThan(150);
    expect(samples.edge[2]).toBeLessThan(150);
  });
});
