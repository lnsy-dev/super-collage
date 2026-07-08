import { test, expect } from '@playwright/test';
import { clearIndexedDB } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('App Bootstrap', () => {
  test('WASM module loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#project-dialog:visible, #create-project-dialog:visible')).toBeVisible();

    const wasmLoaded = await page.evaluate(() => {
      // @ts-ignore
      return typeof window.blendSubtractive === 'function';
    });
    expect(wasmLoaded).toBe(true);
  });

  test('main app module initializes without errors', async ({ page }) => {
    await page.goto('/');
    const initOk = await page.evaluate(async () => {
      try {
        await import('/src/app/init.js');
        return true;
      } catch (e) {
        return false;
      }
    });
    expect(initOk).toBe(true);
  });
});
