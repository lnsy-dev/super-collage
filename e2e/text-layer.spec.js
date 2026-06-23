import { test, expect } from '@playwright/test';
import { clearIndexedDB } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Text layer integration', () => {
  test('can add a text layer and see it rendered', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto('/');

    // Create a project
    await page.fill('#new-project-name', 'Text Test');
    await page.click('#btn-create-project');

    // Wait for main app
    await expect(page.locator('#main-app')).toBeVisible();

    // Add text via File menu
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Hello, type-set!');
      }
    });

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');

    // Wait for layer to appear
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text/ })).toBeVisible();

    // Wait for the async text render to produce a processed canvas
    try {
      await page.waitForFunction(() => {
        const layer = window.State.layers.find(l => l.isText);
        return !!layer?._processedCanvas;
      }, { timeout: 10000 });
    } catch (e) {
      errors.forEach(err => console.log('CONSOLE ERROR:', err));
      throw e;
    }

    // Verify the text is what we typed
    const text = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      return layer?.text;
    });
    expect(text).toBe('Hello, type-set!');

    // Verify the processed canvas has ink pixels (text) and transparent pixels
    // (background), confirming it is not a solid black/colored box.
    const pixelStats = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      const ctx = layer._processedCanvas.getContext('2d');
      const { width, height } = layer._processedCanvas;
      const d = ctx.getImageData(0, 0, width, height).data;
      let opaque = 0, transparent = 0;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 10) opaque++;
        else transparent++;
      }
      return { width, height, opaque, transparent };
    });
    expect(pixelStats.opaque).toBeGreaterThan(0);
    expect(pixelStats.transparent).toBeGreaterThan(0);
  });

  test('updating text re-renders the layer', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto('/');

    // Create a project
    await page.fill('#new-project-name', 'Text Test');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    // Add text via File menu
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Hello, type-set!');
      }
    });
    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');

    // Wait for the layer to render
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text/ })).toBeVisible();
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return !!layer?._processedCanvas;
    }, { timeout: 10000 });

    // Change the text in the properties panel
    await page.fill('#prop-text', 'Goodbye, type-set!');
    await page.locator('#prop-text').blur();

    // Wait for re-render and verify the new text is stored
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return layer?.text === 'Goodbye, type-set!';
    }, { timeout: 10000 });

    const pixelStats = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      const ctx = layer._processedCanvas.getContext('2d');
      const { width, height } = layer._processedCanvas;
      const d = ctx.getImageData(0, 0, width, height).data;
      let opaque = 0, transparent = 0;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 10) opaque++;
        else transparent++;
      }
      return { opaque, transparent };
    });
    expect(pixelStats.opaque).toBeGreaterThan(0);
    expect(pixelStats.transparent).toBeGreaterThan(0);
  });

  test('resizing text box re-renders text instead of stretching', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto('/');

    // Create a project
    await page.fill('#new-project-name', 'Text Resize Test');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    // Add text via File menu
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Hello, type-set!');
      }
    });
    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');

    // Wait for the layer to render
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text/ })).toBeVisible();
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return !!layer?._processedCanvas;
    }, { timeout: 10000 });

    // Resize the text box via the W property input
    await page.fill('#prop-w', '600');
    await page.keyboard.press('Enter');

    // Wait for re-render and verify dimensions match the new box size
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return layer && layer._processedCanvas && layer._processedCanvas.width === Math.round(layer.width * 2);
    }, { timeout: 10000 });

    const dims = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      return {
        width: layer.width,
        height: layer.height,
        naturalWidth: layer.naturalWidth,
        naturalHeight: layer.naturalHeight,
        processedWidth: layer._processedCanvas.width,
        processedHeight: layer._processedCanvas.height,
      };
    });
    expect(dims.width).toBe(600);
    expect(dims.naturalWidth).toBe(600);
    expect(dims.processedWidth).toBe(Math.round(dims.width * 2));
    expect(dims.processedHeight).toBe(Math.round(dims.height * 2));

    // Also resize by dragging the right-middle handle
    const canvasBox = await page.locator('#interaction-overlay').boundingBox();
    if (!canvasBox) throw new Error('Canvas not found');

    const startHandle = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      const h = window.Renderer.getHandles(layer, window.State.zoom).find(h => h.id === 'mr');
      return h;
    });

    const startX = canvasBox.x + startHandle.x;
    const startY = canvasBox.y + startHandle.y;
    const endX = startX + 100;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, startY, { steps: 5 });
    await page.mouse.up();

    // Wait for re-render after handle resize
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return layer && layer._processedCanvas && layer._processedCanvas.width === Math.round(layer.width * 2);
    }, { timeout: 10000 });

    const handleDims = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      return {
        width: layer.width,
        naturalWidth: layer.naturalWidth,
        processedWidth: layer._processedCanvas.width,
      };
    });
    expect(handleDims.width).toBeGreaterThan(600);
    expect(handleDims.naturalWidth).toBe(handleDims.width);
    expect(handleDims.processedWidth).toBe(Math.round(handleDims.width * 2));

    if (errors.length) {
      errors.forEach(err => console.log('CONSOLE ERROR:', err));
    }
    expect(errors).toHaveLength(0);
  });

  test('export processLayer returns 1x canvas sized to layer dimensions', async ({ page }) => {
    await page.goto('/');
    await page.fill('#new-project-name', 'Text Export Size Test');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') await dialog.accept('Export size test');
    });
    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');

    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return !!layer?._processedCanvas;
    }, { timeout: 10000 });

    // Simulate what the export engine does: call processLayer with forExport=true
    const result = await page.evaluate(async () => {
      const layer = window.State.layers.find(l => l.isText);
      const exportCanvas = await window.ImageProcessor.processLayer(layer, { forExport: true });
      return {
        layerWidth: layer.width,
        layerHeight: layer.height,
        exportWidth: exportCanvas?.width,
        exportHeight: exportCanvas?.height,
        // Display canvas is 2x supersampled
        displayWidth: layer._processedCanvas?.width,
        displayHeight: layer._processedCanvas?.height,
      };
    });

    // Export canvas must be 1x (layer.width × layer.height)
    expect(result.exportWidth).toBe(result.layerWidth);
    expect(result.exportHeight).toBe(result.layerHeight);
    // Display canvas must be 2x
    expect(result.displayWidth).toBe(Math.round(result.layerWidth * 2));
    expect(result.displayHeight).toBe(Math.round(result.layerHeight * 2));
  });

  test('variant dropdown lists weight/style combinations and updates layer', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
    await page.goto('/');
    await page.fill('#new-project-name', 'Text Variant Test');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') await dialog.accept('Hello, variant!');
    });
    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');

    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return !!layer?._processedCanvas;
    }, { timeout: 10000 });

    // Default font (IBM Plex Serif) has italic, so variant list should include italic combos.
    const variantSelect = page.locator('#prop-text-variant');
    await expect(variantSelect).toBeVisible();
    await expect(variantSelect).toHaveValue('400:normal');

    const serifOptions = await variantSelect.evaluate(sel => [...sel.options].map(o => o.value));
    expect(serifOptions).toContain('400:italic');
    expect(serifOptions).toContain('700:normal');

    // Helper: checksum of rendered text pixels to detect actual visual changes.
    const pixelChecksum = async () => page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      const ctx = layer._processedCanvas.getContext('2d');
      const { width, height } = layer._processedCanvas;
      const d = ctx.getImageData(0, 0, width, height).data;
      let h = 2166136261;
      for (let i = 3; i < d.length; i += 4) {
        h ^= d[i];
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
      }
      return h >>> 0;
    });

    const normalChecksum = await pixelChecksum();

    // Select an italic variant and verify layer weight/style and re-render.
    await variantSelect.selectOption('400:italic');
    await expect(async () => {
      const props = await page.evaluate(() => {
        const layer = window.State.layers.find(l => l.isText);
        return { weight: layer?.textFontWeight, style: layer?.textFontStyle };
      });
      expect(props).toEqual({ weight: 400, style: 'italic' });
    }).toPass({ timeout: 5000 });

    const italicChecksum = await pixelChecksum();
    expect(italicChecksum).not.toBe(normalChecksum);

    // Switch to a font without italic; dropdown should only contain normal variants.
    await page.selectOption('#prop-text-font', 'Fira Code');
    const firaOptions = await variantSelect.evaluate(sel => [...sel.options].map(o => o.value));
    expect(firaOptions.every(v => v.endsWith(':normal'))).toBe(true);
    await expect(variantSelect).toHaveValue('400:normal');

    const propsAfterSwitch = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      return { weight: layer?.textFontWeight, style: layer?.textFontStyle };
    });
    expect(propsAfterSwitch).toEqual({ weight: 400, style: 'normal' });

    if (errors.length) errors.forEach(err => console.log('CONSOLE ERROR:', err));
    expect(errors).toHaveLength(0);
  });
});
