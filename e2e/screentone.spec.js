import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Screentone Dialog', () => {
  test('open screentone dialog from menu and cancel', async ({ page }) => {
    await createProject(page, 'Screentone Test');

    // Open File menu
    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="add-screentone"]');

    // Dialog should be visible
    await expect(page.locator('#screentone-dialog')).toBeVisible();

    // Grid should populate
    await expect(page.locator('.screentone-item')).toHaveCount(12);

    // Cancel should close
    await page.click('#btn-screentone-cancel');
    await expect(page.locator('#screentone-dialog')).toBeHidden();
  });

  test('select and add a screentone', async ({ page }) => {
    await createProject(page, 'Screentone Add Test');

    // Open dialog
    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="add-screentone"]');
    await expect(page.locator('#screentone-dialog')).toBeVisible();

    // Select first screentone
    const firstItem = page.locator('.screentone-item').first();
    await firstItem.click();
    await expect(firstItem).toHaveClass(/selected/);

    // Add button should be enabled
    await expect(page.locator('#btn-screentone-add')).toBeEnabled();

    // Click Add
    await page.click('#btn-screentone-add');

    // Dialog should close and layer should appear
    await expect(page.locator('#screentone-dialog')).toBeHidden();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    // Verify layer name contains screentone
    const layerName = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0]?.name;
    });
    expect(layerName).toContain('cmkosemen');
  });
});
