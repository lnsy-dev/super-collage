import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addSolidColorImage } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Color Manager', () => {
  test('renames and recolors a swatch, removes a color, and adds a project color', async ({ page }) => {
    await createProject(page, 'Color Manager Test');
    await addSolidColorImage(page, '#000000');

    // Open the color manager from the Colors menu.
    await page.click('.menu-item[data-menu="colors"]');
    await page.click('.menu-entry[data-action="edit-colors"]');
    await expect(page.locator('#color-manager-dialog')).toBeVisible();

    // Rename the first color (Black) and change its hex.
    const firstRow = page.locator('.color-manager-row').first();
    await firstRow.locator('.color-manager-name').fill('Charcoal');
    await firstRow.locator('.color-manager-color').evaluate((el) => {
      el.value = '#333333';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Remove another default color to keep the printable palette within 7 colors.
    await page.locator('.color-manager-row').nth(6).locator('.color-manager-remove').click();

    // Add a new project-only color.
    await page.click('#btn-add-color');
    const newRow = page.locator('.color-manager-row').last();
    await newRow.locator('.color-manager-name').fill('Lime');
    await newRow.locator('.color-manager-color').evaluate((el) => {
      el.value = '#00ff00';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Save changes with the OK button.
    await page.click('#btn-color-manager-ok');
    await expect(page.locator('#color-manager-dialog')).toBeHidden();

    // Swatches should reflect the new colors.
    await expect(page.locator('.color-swatch[data-color="#333333"]')).toBeVisible();
    await expect(page.locator('.color-swatch[data-color="#00FF00"]')).toBeVisible();
    await expect(page.locator('.color-swatch[data-color="#010101"]')).toHaveCount(0);

    // Layer that was black should now be charcoal.
    await page.waitForTimeout(100);
    const layerColor = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.id === window.State.selectedId);
      return layer?.color;
    });
    expect(layerColor).toBe('#333333');
  });

  test('persists project colors across reload', async ({ page }) => {
    await createProject(page, 'Color Persistence Test');

    await page.click('.menu-item[data-menu="colors"]');
    await page.click('.menu-entry[data-action="edit-colors"]');
    await expect(page.locator('#color-manager-dialog')).toBeVisible();

    // Remove a default color so adding Lime stays within the 7-color limit.
    await page.locator('.color-manager-row').nth(6).locator('.color-manager-remove').click();

    await page.click('#btn-add-color');
    const newRow = page.locator('.color-manager-row').last();
    await newRow.locator('.color-manager-name').fill('Lime');
    await newRow.locator('.color-manager-color').evaluate((el) => {
      el.value = '#00ff00';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.click('#btn-color-manager-ok');
    await expect(page.locator('#color-manager-dialog')).toBeHidden();

    // Reload and reopen the same project.
    await page.reload();
    await page.waitForFunction(() => window.__appReady === true, null, { timeout: 10000 });
    await expect(page.locator('#project-dialog')).toBeVisible();
    await page.click('.project-entry');
    await page.click('#btn-open-project');
    await expect(page.locator('#main-app')).toBeVisible();

    await expect(page.locator('.color-swatch[data-color="#00FF00"]')).toHaveCount(1);
  });
});
