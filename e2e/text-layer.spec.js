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
});
