import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});


/** Wait until the raster matches the layer's current box size. */
async function waitForTextRender(page) {
  await page.waitForFunction(() => {
    const l = window.State.layers.find(x => x.isText);
    return !!l?._processedCanvas
      && l._processedCanvas.width === Math.round(l.width * 2)
      && l._processedCanvas.height === Math.round(l.height * 2);
  }, { timeout: 10000 });
}

test.describe('Text layer integration', () => {
  test('can add a text layer and see it rendered', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await createProject(page, 'Text Test');

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.fill('Hello, type-set!');
    await page.keyboard.press('Escape');
    // Wait for layer to appear and reflect the text-derived name.
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Hello, type-set!/ })).toBeVisible({ timeout: 15000 });

    // Wait for the async text render to produce a processed canvas that
    // matches the committed box size (waitForTextRender).
    try {
      await waitForTextRender(page);
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

    await createProject(page, 'Text Test');

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.fill('Hello, type-set!');
    await page.keyboard.press('Escape');

    // Wait for the layer to render
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Hello, type-set!/ })).toBeVisible({ timeout: 15000 });
    await waitForTextRender(page);

    // Change the text in the properties panel
    await page.fill('#prop-text', 'Goodbye, type-set!');
    await page.locator('#prop-text').blur();

    // Wait for re-render and verify the new text and derived name are stored
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return layer?.text === 'Goodbye, type-set!' && layer?.name === 'Goodbye, type-set!';
    }, { timeout: 10000 });
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Goodbye, type-set!/ })).toBeVisible({ timeout: 15000 });
    await waitForTextRender(page);

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

  test('text layer name tracks text content (truncation, normalization, empty)', async ({ page }) => {
    await createProject(page, 'Text Name Test');

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible({ timeout: 15000 });

    // New/empty text keeps a sensible default name.
    await expect.poll(async () => page.evaluate(() => window.State.layers.find(l => l.isText)?.name), { timeout: 10000 }).toBe('Text');
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text$/ })).toBeVisible();

    // Short text becomes the name.
    await editor.fill('Hi');
    await expect.poll(async () => page.evaluate(() => window.State.layers.find(l => l.isText)?.name), { timeout: 10000 }).toBe('Hi');
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Hi$/ })).toBeVisible();

    // Long text is truncated to the first 20 characters.
    await editor.fill('abcdefghijklmnopqrstuvwxyz');
    await expect.poll(async () => page.evaluate(() => window.State.layers.find(l => l.isText)?.name), { timeout: 10000 }).toBe('abcdefghijklmnopqrst');
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T abcdefghijklmnopqrst$/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await waitForTextRender(page);

    // Whitespace/newlines normalize to a single space in the name; property edits update it.
    await page.fill('#prop-text', '  Hello   world  again  ');
    await page.locator('#prop-text').blur();
    await page.waitForFunction(() => window.State.layers.find(l => l.isText)?.name === 'Hello world again', { timeout: 10000 });
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Hello world again$/ })).toBeVisible();

    // Clearing text falls back to the sensible default name.
    await page.fill('#prop-text', '   ');
    await page.locator('#prop-text').blur();
    await page.waitForFunction(() => window.State.layers.find(l => l.isText)?.name === 'Text', { timeout: 10000 });
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text$/ })).toBeVisible();
  });



  test('export processLayer returns 1x canvas sized to layer dimensions', async ({ page }) => {
    await createProject(page, 'Text Export Size Test');

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.fill('Export size test');
    await page.keyboard.press('Escape');

    // The processed canvas must match the committed box size: right after
    // Escape the raster can still be the pre-commit size.
    await waitForTextRender(page);

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
    await createProject(page, 'Text Variant Test');

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.fill('Hello, variant!');
    await page.keyboard.press('Escape');

    // The processed canvas must match the committed box size: right after
    // Escape the raster can still be the pre-commit size.
    await waitForTextRender(page);

    // Default font (IBM Plex Serif) has italic, so variant list should include italic combos.
    const variantSelect = page.locator('#prop-text-variant');
    await expect(variantSelect).toBeVisible({ timeout: 15000 });
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

    // The italic re-render is async — poll until the pixels actually change.
    await expect(async () => {
      const italicChecksum = await pixelChecksum();
      expect(italicChecksum).not.toBe(normalChecksum);
    }).toPass({ timeout: 10000 });

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

