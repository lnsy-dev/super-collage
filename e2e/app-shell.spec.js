import { test, expect } from '@playwright/test';
import { clearIndexedDB } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('App Shell (Alternative UI)', () => {
  test('app-shell component is defined after importing module', async ({ page }) => {
    await page.goto('/');
    const componentDefined = await page.evaluate(async () => {
      await import('/src/main.js');
      return customElements.get('app-shell') !== undefined;
    });
    expect(componentDefined).toBe(true);
  });

  test('webgl-canvas component is defined after importing module', async ({ page }) => {
    await page.goto('/');
    const componentDefined = await page.evaluate(async () => {
      await import('/src/main.js');
      return customElements.get('webgl-canvas') !== undefined;
    });
    expect(componentDefined).toBe(true);
  });

  test('WASM module loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#project-dialog')).toBeVisible();

    const wasmLoaded = await page.evaluate(() => {
      // @ts-ignore
      return typeof blendSubtractive === 'function';
    });
    expect(wasmLoaded).toBe(true);
  });

  test('app-shell can be instantiated programmatically', async ({ page }) => {
    await page.goto('/');
    const canInstantiate = await page.evaluate(async () => {
      await import('/src/main.js');
      try {
        const el = document.createElement('app-shell');
        return el.tagName.toLowerCase() === 'app-shell';
      } catch (e) {
        return false;
      }
    });
    expect(canInstantiate).toBe(true);
  });

  test('webgl-canvas can be instantiated programmatically', async ({ page }) => {
    await page.goto('/');
    const canInstantiate = await page.evaluate(async () => {
      await import('/src/main.js');
      try {
        const el = document.createElement('webgl-canvas');
        return el.tagName.toLowerCase() === 'webgl-canvas';
      } catch (e) {
        return false;
      }
    });
    expect(canInstantiate).toBe(true);
  });
});
