import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImageFromBuffer, createShapePngBuffer, setLayerColorDirect } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/**
 * Click the overlay canvas at a page-space point. The interaction overlay is
 * offset by -CANVAS_PAD * zoom relative to the page, and the page is centered
 * in the wrapper, so overlay-relative point = (pageX + CANVAS_PAD) * zoom.
 */
async function bucketClick(page, px, py, { clickCount = 1 } = {}) {
  const pos = await page.evaluate(async ({ px, py }) => {
    const { CANVAS_PAD } = await import('/src/app/constants.js');
    const z = window.State.zoom;
    return { x: (px + CANVAS_PAD) * z, y: (py + CANVAS_PAD) * z };
  }, { px, py });
  const overlay = page.locator('#interaction-overlay');
  if (clickCount === 2) {
    await overlay.dblclick({ position: { x: pos.x, y: pos.y } });
  } else {
    await overlay.click({ position: { x: pos.x, y: pos.y } });
  }
}

function getPageSize(page) {
  // Live page dims (independent of zoom) from the app's constants module.
  return page.evaluate(async () => {
    const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
    return { w: CANVAS_W, h: CANVAS_H };
  });
}

/**
 * Wait for a named Color Layer to exist AND to have been rendered (the
 * processed bitmap is produced asynchronously by Renderer.schedule).
 */
async function waitForColorLayer(page, name = 'Color Layer') {
  await page.waitForFunction((n) => {
    const l = window.State.layers.find(l => l.name === n);
    return l && !!l._processedCanvas;
  }, name);
}

test.describe('Color Layer (paint bucket)', () => {
  test('selecting the tool shows the ink swatch below the bucket', async ({ page }) => {
    await createProject(page, 'Bucket Tool Test');
    await expect(page.locator('#bucket-options')).toBeHidden();
    await page.click('.tool-btn[data-tool="paint-bucket"]');
    await expect(page.locator('#status-tool')).toContainText('Color Layer');
    await expect(page.locator('#bucket-options')).toBeVisible();
    await expect(page.locator('#bucket-color-swatch')).toHaveCSS('background-color', 'rgb(1, 1, 1)');
  });

  test('mix ink window opens only from the ink swatch, never the tool button', async ({ page }) => {
    await createProject(page, 'Bucket Modal Test');
    await page.click('.tool-btn[data-tool="paint-bucket"]');
    await expect(page.locator('#paint-bucket-dialog')).toBeHidden();
    // Clicking the active tool button again must not open the mixer either.
    await page.click('.tool-btn[data-tool="paint-bucket"]');
    await expect(page.locator('#paint-bucket-dialog')).toBeHidden();
    // Only the ink swatch opens it.
    await page.click('#bucket-color-swatch');
    await expect(page.locator('#paint-bucket-dialog')).toBeVisible();
    await page.click('#btn-bucket-done');
    await expect(page.locator('#paint-bucket-dialog')).toBeHidden();
  });

  test('mix ink dialog lists riso colors with sliders and mixes them', async ({ page }) => {
    await createProject(page, 'Bucket Mix Test');
    await page.click('.tool-btn[data-tool="paint-bucket"]');

    // Clicking the swatch opens the mixer with one slider per non-white riso ink.
    await page.click('#bucket-color-swatch');
    await expect(page.locator('#paint-bucket-dialog')).toBeVisible();
    const rows = page.locator('.bucket-ink-row');
    const expectedInks = await page.evaluate(async () => {
      const { RISO_COLORS } = await import('/src/app/constants.js');
      return RISO_COLORS.filter(c => c.hex.toUpperCase() !== '#FFFFFF').length;
    });
    await expect(rows).toHaveCount(expectedInks);
    // Black ink starts at full coverage.
    await expect(rows.filter({ has: page.locator('[data-hex="#010101"]') }).locator('.bucket-ink-val')).toHaveText('100%');

    // Zero black, cover with yellow → the mix preview and toolbar swatch go yellow.
    await page.evaluate(() => {
      const black = document.querySelector('.bucket-ink-row input[data-hex="#010101"]');
      black.value = '0';
      black.dispatchEvent(new Event('input', { bubbles: true }));
      const yellow = document.querySelector('.bucket-ink-row input[data-hex="#ffe800"]');
      yellow.value = '100';
      yellow.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#bucket-mix-hex')).toHaveText('#FFE800');
    await expect(page.locator('#bucket-color-swatch')).toHaveCSS('background-color', 'rgb(255, 232, 0)');

    // Done closes the dialog; the mixed ink is remembered.
    await page.click('#btn-bucket-done');
    await expect(page.locator('#paint-bucket-dialog')).toBeHidden();
    const bucketColor = await page.evaluate(() => window.State.bucketColor);
    expect(bucketColor).toBe('#ffe800');
  });

  test('single click on an empty page fills everything with the mixed ink', async ({ page }) => {
    await createProject(page, 'Bucket Empty Test');
    await page.evaluate(() => window.UI.fitZoom());
    await page.click('.tool-btn[data-tool="paint-bucket"]');

    await bucketClick(page, 1600, 2500);
    await waitForColorLayer(page);

    const pageSize = await getPageSize(page);
    const layer = await page.evaluate(() => {
      const l = window.State.layers[0];
      return {
        color: l.color,
        x: l.x, y: l.y, width: l.width, height: l.height,
        pixel: (() => {
          const ctx = l._processedCanvas.getContext('2d');
          const d = ctx.getImageData(Math.floor(ctx.canvas.width / 2), Math.floor(ctx.canvas.height / 2), 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] };
        })(),
      };
    });
    // Fills the whole page.
    expect(layer.x).toBeLessThanOrEqual(2);
    expect(layer.y).toBeLessThanOrEqual(2);
    expect(Math.abs(layer.width - pageSize.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(layer.height - pageSize.h)).toBeLessThanOrEqual(2);
    expect(layer.color).toBe('#010101');
    expect(layer.pixel).toEqual({ r: 1, g: 1, b: 1, a: 255 });
  });

  test('region fill stops at drawn shapes but runs white to the page edges', async ({ page }) => {
    await createProject(page, 'Bucket Region Test');
    await page.evaluate(() => window.UI.fitZoom());
    // Black square in the middle of the page.
    await addImageFromBuffer(page, createShapePngBuffer('rect', 300, 300), { name: 'rect.png' });
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !!l._processedCanvas;
    });
    const pageSize = await getPageSize(page);

    await page.click('.tool-btn[data-tool="paint-bucket"]');
    // Click the white area left of the square: the fill must surround the
    // square and run to the page edges.
    await bucketClick(page, pageSize.w / 2 - 700, pageSize.h / 2);
    await waitForColorLayer(page);

    const layer = await page.evaluate(() => {
      const l = window.State.layers.find(l => l.name === 'Color Layer');
      const ctx = l._processedCanvas.getContext('2d');
      const w = ctx.canvas.width, h = ctx.canvas.height;
      // A point that lands on the square (page center) inside the layer bbox…
      const relX = Math.floor(w * 0.5), relY = Math.floor(h * 0.5);
      // …and a point in the filled white region (layer bbox top-left corner).
      const corner = ctx.getImageData(1, 1, 1, 1).data;
      const center = ctx.getImageData(relX, relY, 1, 1).data;
      return {
        color: l.color,
        x: l.x, y: l.y, width: l.width, height: l.height,
        colorWhereFilled: { r: corner[0], g: corner[1], b: corner[2], a: corner[3] },
        colorWhereShape: { r: center[0], g: center[1], b: center[2], a: center[3] },
      };
    });
    // Bbox spans (at least) the full page: white fills to every edge.
    expect(layer.x).toBeLessThanOrEqual(2);
    expect(layer.y).toBeLessThanOrEqual(2);
    expect(Math.abs(layer.width - pageSize.w)).toBeLessThanOrEqual(3);
    expect(Math.abs(layer.height - pageSize.h)).toBeLessThanOrEqual(3);
    // Filled area shows the (black) ink…
    expect(layer.color).toBe('#010101');
    expect(layer.colorWhereFilled).toEqual({ r: 1, g: 1, b: 1, a: 255 });
    // …and the square itself is a hole (white → dropped by colorize).
    expect(layer.colorWhereShape.a).toBe(0);
  });

  test('later bucket clicks add pixels to the same fill layer', async ({ page }) => {
    await createProject(page, 'Bucket Merge Test');
    await page.evaluate(() => window.UI.fitZoom());
    // Black square in the middle of the page.
    await addImageFromBuffer(page, createShapePngBuffer('rect', 300, 300), { name: 'rect.png' });
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !!l._processedCanvas;
    });
    const pageSize = await getPageSize(page);

    await page.click('.tool-btn[data-tool="paint-bucket"]');
    // First fill: everything around the square (hole in the middle).
    await bucketClick(page, pageSize.w / 2 - 700, pageSize.h / 2);
    await waitForColorLayer(page);
    expect(await page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Second click inside the square: the same layer absorbs the region…
    await bucketClick(page, pageSize.w / 2, pageSize.h / 2);
    // Poll the rendered result: the former hole must be inked now.
    await page.waitForFunction(() => {
      const l = window.State.layers.find(l => l.name === 'Color Layer');
      if (!l || !l._processedCanvas) return false;
      const ctx = l._processedCanvas.getContext('2d');
      const d = ctx.getImageData(Math.floor(ctx.canvas.width / 2), Math.floor(ctx.canvas.height / 2), 1, 1).data;
      return d[3] === 255;
    }, null, { timeout: 8000 });
    // …no new layer was spawned…
    expect(await page.locator('#layer-list .layer-row')).toHaveCount(2);
    const layer = await page.evaluate(() => {
      const l = window.State.layers.find(l => l.name === 'Color Layer');
      const ctx = l._processedCanvas.getContext('2d');
      const d = ctx.getImageData(Math.floor(ctx.canvas.width / 2), Math.floor(ctx.canvas.height / 2), 1, 1).data;
      return {
        color: l.color,
        x: l.x, y: l.y, width: l.width, height: l.height,
        centerPixel: { r: d[0], g: d[1], b: d[2], a: d[3] },
      };
    });
    // …and the former hole is now inked too, on a single layer.
    expect(layer.color).toBe('#010101');
    expect(layer.centerPixel).toEqual({ r: 1, g: 1, b: 1, a: 255 });
    expect(layer.x).toBeLessThanOrEqual(2);
    expect(layer.y).toBeLessThanOrEqual(2);
    expect(Math.abs(layer.width - pageSize.w)).toBeLessThanOrEqual(3);
    expect(Math.abs(layer.height - pageSize.h)).toBeLessThanOrEqual(3);
  });

  test('undoing a merged fill restores the previous pixels', async ({ page }) => {
    await createProject(page, 'Bucket Merge Undo Test');
    await page.evaluate(() => window.UI.fitZoom());
    await addImageFromBuffer(page, createShapePngBuffer('rect', 300, 300), { name: 'rect.png' });
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !!l._processedCanvas;
    });
    const pageSize = await getPageSize(page);

    await page.click('.tool-btn[data-tool="paint-bucket"]');
    await bucketClick(page, pageSize.w / 2 - 700, pageSize.h / 2); // fill excluding square
    await waitForColorLayer(page);
    await bucketClick(page, pageSize.w / 2, pageSize.h / 2);       // merge square into same layer
    // Wait until the merge is visible: the former hole is inked.
    await page.waitForFunction(() => {
      const l = window.State.layers.find(l => l.name === 'Color Layer');
      if (!l || !l._processedCanvas) return false;
      const ctx = l._processedCanvas.getContext('2d');
      const d = ctx.getImageData(Math.floor(ctx.canvas.width / 2), Math.floor(ctx.canvas.height / 2), 1, 1).data;
      return d[3] === 255;
    }, null, { timeout: 8000 });

    await page.keyboard.press('Control+z');
    // Poll the rendered result: the square must be a hole again.
    await page.waitForFunction(() => {
      const l = window.State.layers.find(l => l.name === 'Color Layer');
      if (!l || !l._processedCanvas) return false;
      const ctx = l._processedCanvas.getContext('2d');
      const d = ctx.getImageData(Math.floor(ctx.canvas.width / 2), Math.floor(ctx.canvas.height / 2), 1, 1).data;
      return d[3] === 0;
    }, null, { timeout: 8000 });
    const fillCount = await page.evaluate(() =>
      window.State.layers.filter(l => l.name === 'Color Layer').length);
    expect(fillCount).toBe(1);
    const layer = await page.evaluate(() => {
      const l = window.State.layers.find(l => l.name === 'Color Layer');
      const ctx = l._processedCanvas.getContext('2d');
      const d = ctx.getImageData(Math.floor(ctx.canvas.width / 2), Math.floor(ctx.canvas.height / 2), 1, 1).data;
      return { centerPixel: { r: d[0], g: d[1], b: d[2], a: d[3] } };
    });
    // The square is a hole again after undo — pixels, not just geometry.
    expect(layer.centerPixel.a).toBe(0);
  });

  test('filling with a different mixed ink spawns a fresh fill layer', async ({ page }) => {
    await createProject(page, 'Bucket New Ink Test');
    await page.evaluate(() => window.UI.fitZoom());
    await addImageFromBuffer(page, createShapePngBuffer('rect', 300, 300), { name: 'rect.png' });
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !!l._processedCanvas;
    });
    const pageSize = await getPageSize(page);

    await page.click('.tool-btn[data-tool="paint-bucket"]');
    await bucketClick(page, pageSize.w / 2 - 700, pageSize.h / 2);
    await waitForColorLayer(page);
    expect(await page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Switch the mix to blue ink, then fill again.
    await page.click('#bucket-color-swatch');
    await page.evaluate(() => {
      const black = document.querySelector('.bucket-ink-row input[data-hex="#010101"]');
      black.value = '0';
      black.dispatchEvent(new Event('input', { bubbles: true }));
      const blue = document.querySelector('.bucket-ink-row input[data-hex="#0078bf"]');
      blue.value = '100';
      blue.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#btn-bucket-done');
    await bucketClick(page, pageSize.w / 2, pageSize.h / 2);
    await page.waitForFunction(() =>
      window.State.layers.filter(l => l.name === 'Color Layer').length === 2);
    expect(await page.locator('#layer-list .layer-row')).toHaveCount(3);

    const colors = await page.evaluate(() =>
      window.State.layers.filter(l => l.name === 'Color Layer').map(l => l.color));
    expect(colors).toEqual(['#010101', '#0078bf']);
  });

  test('eyedropper picks the composite mix of two overlapping inks', async ({ page }) => {
    await createProject(page, 'Dropper Mix Test');
    // Two black square layers printed in aqua and yellow ink, fully
    // overlapping: aqua over yellow multiply to a printed green.
    await addImageFromBuffer(page, createShapePngBuffer('rect', 300, 300), { name: 'aqua.png' });
    await setLayerColorDirect(page, '#5ec8e5');
    await addImageFromBuffer(page, createShapePngBuffer('rect', 300, 300), { name: 'yellow.png' });
    await setLayerColorDirect(page, '#ffe800');
    await page.waitForFunction(() =>
      window.State.layers.length === 2 && window.State.layers.every(l => l._processedCanvas));

    await page.click('.tool-btn[data-tool="eyedropper"]');
    await expect(page.locator('#status-tool')).toContainText('Eyedropper');

    // Sample the overlap: the fitted mix must be 100% aqua + 100% yellow.
    await bucketClick(page, 1650, 2550);
    await page.waitForFunction(() =>
      window.State.bucketInks['#5ec8e5'] === 100 && window.State.bucketInks['#ffe800'] === 100,
      null, { timeout: 8000 });

    // The dropper hands back to the fill bucket, which now carries the mix.
    await expect(page.locator('#status-tool')).toContainText('Color Layer');
    await expect(page.locator('#bucket-options')).toBeVisible();
    const dist = await page.evaluate(() => {
      const h = window.State.bucketColor;
      const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
      // The printed green of aqua #5ec8e5 × yellow #ffe800 is rgb(94, 182, 0).
      return Math.abs(r - 94) + Math.abs(g - 182) + Math.abs(b - 0);
    });
    expect(dist).toBeLessThanOrEqual(6);
    const cov = await page.evaluate(() =>
      Object.entries(window.State.bucketInks).filter(([hex, v]) => v > 0));
    expect(cov).toHaveLength(2);
  });

  test('the ink fitter reproduces partial-coverage shading', async ({ page }) => {
    await createProject(page, 'Dropper Shade Test');
    await page.click('.tool-btn[data-tool="eyedropper"]');
    // Pale yellow ≈ half-strength yellow ink on paper.
    const fit = await page.evaluate(() => window.BucketTool.fitInksToColor('#fff37f'));
    const yellow = fit.inks['#ffe800'];
    expect(yellow).toBeGreaterThanOrEqual(40);
    expect(yellow).toBeLessThanOrEqual(65);
    // No other ink matters…
    const others = Object.entries(fit.inks).filter(([hex]) => hex !== '#ffe800').map(([, v]) => v);
    expect(Math.max(...others)).toBeLessThanOrEqual(12);
    // …and the resulting mix matches the target shading.
    const r = parseInt(fit.hex.slice(1, 3), 16);
    const g = parseInt(fit.hex.slice(3, 5), 16);
    const b = parseInt(fit.hex.slice(5, 7), 16);
    expect(Math.max(Math.abs(r - 255), Math.abs(g - 243), Math.abs(b - 127))).toBeLessThanOrEqual(8);
  });

  test('eyedropper on empty paper picks no ink', async ({ page }) => {
    await createProject(page, 'Dropper Paper Test');
    await page.click('.tool-btn[data-tool="eyedropper"]');
    await bucketClick(page, 1650, 2550);
    await page.waitForFunction(() => window.State.bucketColor !== '#010101', null, { timeout: 8000 });
    const inks = await page.evaluate(() => Object.values(window.State.bucketInks));
    expect(inks.every(v => v === 0)).toBe(true);
    expect(await page.evaluate(() => window.State.bucketColor)).toBe('#ffffff');
  });

  test('double-click fills the entire layer regardless of drawn content', async ({ page }) => {
    await createProject(page, 'Bucket Double Click Test');
    await page.evaluate(() => window.UI.fitZoom());
    await addImageFromBuffer(page, createShapePngBuffer('rect', 300, 300), { name: 'rect.png' });
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !!l._processedCanvas;
    });
    const pageSize = await getPageSize(page);

    await page.click('.tool-btn[data-tool="paint-bucket"]');
    // Double-click anywhere: no flood-fill geometry, whole page gets filled.
    await bucketClick(page, pageSize.w / 2 - 700, pageSize.h / 2, { clickCount: 2 });
    await waitForColorLayer(page);

    expect(await page.locator('#layer-list .layer-row')).toHaveCount(2);
    const layer = await page.evaluate(() => {
      const l = window.State.layers.find(l => l.name === 'Color Layer');
      const ctx = l._processedCanvas.getContext('2d');
      const d = ctx.getImageData(Math.floor(ctx.canvas.width / 2), Math.floor(ctx.canvas.height / 2), 1, 1).data;
      return {
        x: l.x, y: l.y, width: l.width, height: l.height,
        centerPixel: { r: d[0], g: d[1], b: d[2], a: d[3] },
      };
    });
    // Covers the whole page.
    expect(layer.x).toBeLessThanOrEqual(2);
    expect(layer.y).toBeLessThanOrEqual(2);
    expect(Math.abs(layer.width - pageSize.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(layer.height - pageSize.h)).toBeLessThanOrEqual(2);
    // Filled straight through the drawn square — no hole in the middle.
    expect(layer.centerPixel.a).toBe(255);
    expect(layer.centerPixel.r).toBe(1);
  });

  test('undo removes the added color layer', async ({ page }) => {
    await createProject(page, 'Bucket Undo Test');
    await page.evaluate(() => window.UI.fitZoom());
    await page.click('.tool-btn[data-tool="paint-bucket"]');
    await bucketClick(page, 1600, 2500);
    await page.waitForFunction(() => window.State.layers.length === 1);

    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.State.layers.length === 0);
  });

  test('switching tools cancels a pending bucket fill', async ({ page }) => {
    await createProject(page, 'Bucket Switch Tool Test');
    await page.evaluate(() => window.UI.fitZoom());
    await page.click('.tool-btn[data-tool="paint-bucket"]');

    // Schedule a fill, immediately switch tools: it must never run.
    await bucketClick(page, 1600, 2500);
    await page.click('.tool-btn[data-tool="select"]');
    await page.waitForTimeout(500);
    expect(await page.locator('#layer-list .layer-row')).toHaveCount(0);
  });
});
