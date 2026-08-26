import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, selectTool, runExportBooklet } from './helpers.js';

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

  test('shape part radios select exactly one part per layer', async ({ page }) => {
    await createProject(page, 'Toggle Border Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    // New shapes are fill-only.
    const readParts = () => page.evaluate(() => State.layers.map(l => ({
      id: l.id,
      sel: l.id === State.selectedId,
      name: l.name,
      hasFill: l.shapeHasFill,
      hasStroke: l.shapeHasStroke,
    })));

    let parts = await readParts();
    expect(parts[0].hasFill).toBe(true);
    expect(parts[0].hasStroke).toBe(false);

    // Selecting Border on a fill shape spawns a separate outline layer;
    // the inside stays on its own layer.
    await page.check('#prop-shape-border');
    await page.waitForFunction(() => State.layers.length === 2);
    parts = await readParts();
    expect(parts.length).toBe(2);
    const outline = parts.find(p => p.sel);
    const body = parts.find(p => !p.sel);
    expect(body.hasFill).toBe(true);
    expect(body.hasStroke).toBe(false);
    expect(outline.hasFill).toBe(false);
    expect(outline.hasStroke).toBe(true);
    expect(outline.name).toContain('Border');

    // The radios reflect the newly selected outline layer only.
    expect(await page.isChecked('#prop-shape-border')).toBe(true);
    expect(await page.isChecked('#prop-shape-fill')).toBe(false);
  });

  test('adjust shape border width', async ({ page }) => {
    await createProject(page, 'Border Width Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    await page.check('#prop-shape-border');
    // Checking Border spawns the outline layer and selects it; wait for that
    // so the width edit lands on the border layer.
    await page.waitForFunction(() => State.layers.length === 2);
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
    // Checking Border spawns the outline layer and selects it; wait for that
    // so the swatch lands on the border layer's ink.
    await page.waitForFunction(() => State.layers.length === 2);
    await page.locator('#color-swatches .color-swatch[data-color="#f65058"]').click();

    const color = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers.find(l => l.id === State.selectedId);
      return { stroke: l?.shapeStrokeColor, ink: l?.color };
    });
    expect(color.stroke).toBe('#f65058');
  });

  test('body and border inks live on separate layers with one color each', async ({ page }) => {
    await createProject(page, 'Two Tone Shape Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    // Ink the fill body blue.
    await page.locator('#color-swatches .color-swatch[data-color="#0078bf"]').click();
    await page.waitForFunction(() => {
      const l = State.layers.find(x => x.id === State.selectedId);
      return l?.shapeFillColor === '#0078bf';
    });

    // Selecting Border spawns a separate outline layer (selected); ink it red.
    await page.check('#prop-shape-border');
    await page.waitForFunction(() => State.layers.length === 2);
    await page.locator('#color-swatches .color-swatch[data-color="#f65058"]').click();
    await page.waitForFunction(() => {
      const l = State.layers.find(x => x.id === State.selectedId);
      return l?.shapeStrokeColor === '#f65058';
    });

    const info = await page.evaluate(() => State.layers.map(l => ({
      hasFill: l.shapeHasFill,
      hasStroke: l.shapeHasStroke,
      fill: l.shapeFillColor,
      stroke: l.shapeStrokeColor,
      color: l.color,
    })));
    expect(info.length).toBe(2);

    const body = info.find(l => l.hasFill);
    const ring = info.find(l => l.hasStroke);
    expect(body.hasStroke).toBe(false);
    expect(body.fill).toBe('#0078bf');
    expect(body.color).toBe('#0078bf');
    expect(ring.hasFill).toBe(false);
    expect(ring.stroke).toBe('#f65058');
    expect(ring.color).toBe('#f65058');

    // The composite shows the blue body centre; the ring overlaps it and
    // layers multiply on screen (riso overprint), so hide the body to see
    // the outline layer's own ink.
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      for (const l of State.layers) {
        if (l.isShape) {
          await ImageProcessor.processLayer(l, {});
          if (l.shapeHasFill) l.visible = false;
        }
      }
      await Renderer.draw();
    });
    const samples = await page.evaluate(() => {
      const canvasEl = document.getElementById('display-canvas');
      const ctx = canvasEl.getContext('2d');
      const z = State.zoom;
      // @ts-ignore
      const l = State.layers.find(x => x.isShape && x.shapeHasStroke);
      const cx = (l.x + l.width / 2) * z;
      // Ring centre-line runs sw/2 document pixels inside the top edge.
      const ringY = (l.y + l.shapeStrokeWidth / 2) * z;
      const px = (x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
      return { edgeTop: px(cx, ringY) };
    });
    // Red-ish border ring (red channel dominant, low blue)
    expect(samples.edgeTop[0]).toBeGreaterThan(150);
    expect(samples.edgeTop[2]).toBeLessThan(150);

    // Restore visibility.
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      for (const l of State.layers) if (l.isShape) l.visible = true;
      await Renderer.draw();
    });
  });

  test('legacy two-tone shape can be split into editable fill and border layers', async ({ page }) => {
    await createProject(page, 'Two Tone Split Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    // Two-tone shapes are no longer creatable via the UI (one part per
    // layer now), so construct a legacy two-tone record directly — saved
    // projects may still contain them, and Split is their migration path.
    await page.evaluate(async () => {
      const { rerenderShapeLayer } = await import('/src/app/shape-utils.js');
      const l = State.layers.find(x => x.id === State.selectedId);
      l.shapeHasFill = true;
      l.shapeHasStroke = true;
      l.shapeFillColor = '#0078bf';
      l.shapeStrokeColor = '#f65058';
      l.color = '#0078bf';
      await rerenderShapeLayer(l);
    });

    // The Split button becomes available for two-tone shapes.
    const splitBtn = page.locator('#btn-split-color-separation');
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();

    // The original layer is replaced by a fill layer and a border layer.
    await page.waitForFunction(() => State.layers.length === 2, null, { timeout: 10000 });
    const info = await page.evaluate(() => State.layers.map(l => ({
      name: l.name, isShape: l.isShape,
      hasFill: l.shapeHasFill, hasStroke: l.shapeHasStroke,
      fill: l.shapeFillColor, stroke: l.shapeStrokeColor, color: l.color,
      x: l.x, y: l.y, w: l.width, h: l.height,
      sides: l.shapeSides,
    })));
    expect(info.length).toBe(2);

    const fillLayer = info.find(l => l.hasFill && !l.hasStroke);
    const borderLayer = info.find(l => l.hasStroke && !l.hasFill);
    expect(fillLayer, 'expected a fill-only shape layer').toBeTruthy();
    expect(borderLayer, 'expected a border-only shape layer').toBeTruthy();

    expect(fillLayer.fill).toBe('#0078bf');
    expect(fillLayer.color).toBe('#0078bf');
    expect(borderLayer.stroke).toBe('#f65058');
    expect(borderLayer.color).toBe('#f65058');

    // Both parts share the source geometry so they stay aligned.
    for (const key of ['x', 'y', 'w', 'h', 'sides']) {
      expect(fillLayer[key]).toBe(borderLayer[key]);
    }

    // Each part renders as black artwork on white in its own bitmap channel:
    // the fill body covers the centre; the border ring does not.
    const coverage = await page.evaluate(async () => {
      const { renderShapeLayerBitmap } = await import('/src/app/shape-utils.js');
      const sample = async (layer) => {
        const bmp = renderShapeLayerBitmap(layer, 'union');
        const ctx = bmp.getContext('2d');
        const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
        return dark / (bmp.width * bmp.height);
      };
      return {
        fill: await sample(State.layers.find(l => l.shapeHasFill && !l.shapeHasStroke)),
        border: await sample(State.layers.find(l => l.shapeHasStroke && !l.shapeHasFill)),
      };
    });
    expect(coverage.fill).toBeGreaterThan(coverage.border);
  });

  test('fill and border layers export separate color plates', async ({ page }) => {
    await createProject(page, 'Two Tone Plates Test');
    await selectTool(page, 'shape-rect');
    const canvas = page.locator('#interaction-overlay');
    await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });

    // Body layer inked blue; selecting Border spawns the outline layer
    // (selected), which we ink red.
    await page.locator('#color-swatches .color-swatch[data-color="#0078bf"]').click();
    await page.check('#prop-shape-border');
    await page.waitForFunction(() => State.layers.length === 2);
    await page.locator('#color-swatches .color-swatch[data-color="#f65058"]').click();

    // Shape edits persist asynchronously; wait for both single-ink records to
    // reach IndexedDB so the export reads them.
    await page.waitForFunction(async () => {
      const recs = await new Promise((resolve, reject) => {
        const req = indexedDB.open('superCollage');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('layers', 'readonly');
          const r = tx.objectStore('layers').getAll();
          r.onsuccess = () => { db.close(); resolve(r.result || []); };
          r.onerror = () => reject(r.error);
        };
      });
      return recs.length === 2
        && recs.some(r => r.shapeHasFill && !r.shapeHasStroke && r.shapeFillColor === '#0078bf')
        && recs.some(r => r.shapeHasStroke && !r.shapeHasFill && r.shapeStrokeColor === '#f65058');
    }, null, { timeout: 10000 });

    const plates = await runExportBooklet(page, { binding: 'saddle-stitch', bookletLayout: 'folio', targetSheetSize: 'letter' });
    const findKey = hex => Object.keys(plates).find(k => k.toLowerCase() === hex.toLowerCase());
    const blueKey = findKey('#0078bf');
    const redKey = findKey('#f65058');
    expect(blueKey, 'expected a plate for the fill color').toBeTruthy();
    expect(redKey, 'expected a plate for the border color').toBeTruthy();

    // Both plates must carry ink (avg grey < 255 means something printed).
    for (const [key, label] of [[blueKey, 'fill'], [redKey, 'border']]) {
      const minAvg = Math.min(...plates[key].map(s => s.avgGrey));
      expect(minAvg, `${label} plate has no ink`).toBeLessThan(255);
    }
  });
});
