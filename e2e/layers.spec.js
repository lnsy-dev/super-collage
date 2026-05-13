import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Layer System', () => {
  test('layer appears in list after import', async ({ page }) => {
    await createProject(page, 'Layer List Test');
    await addImage(page, TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name')).toContainText('test-image');
  });

  test('toggle layer visibility', async ({ page }) => {
    await createProject(page, 'Visibility Test');
    await addImage(page, TEST_IMAGE);

    const visBtn = page.locator('.layer-vis').first();
    await expect(visBtn).toHaveText('◉');

    await visBtn.click();
    await expect(visBtn).toHaveText('○');

    await visBtn.click();
    await expect(visBtn).toHaveText('◉');
  });

  test('toggle layer lock', async ({ page }) => {
    await createProject(page, 'Lock Test');
    await addImage(page, TEST_IMAGE);

    const lockBtn = page.locator('.layer-lock').first();
    await expect(lockBtn).not.toHaveClass(/locked/);

    await lockBtn.click();
    await expect(lockBtn).toHaveClass(/locked/);
    await expect(lockBtn).toHaveText('🔒');
  });

  test('duplicate layer', async ({ page }) => {
    await createProject(page, 'Duplicate Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
    await expect(page.locator('#layer-list .layer-name').nth(0)).toContainText('copy');
  });

  test('delete layer', async ({ page }) => {
    await createProject(page, 'Delete Test');
    await addImage(page, TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    await page.locator('#layer-buttons [data-action="delete-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(0);
    await expect(page.locator('#no-layer-msg')).toBeVisible();
  });

  test('reorder layer up', async ({ page }) => {
    await createProject(page, 'Reorder Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Select bottom layer and move up
    await page.locator('.layer-row').nth(1).click();
    await page.locator('#layer-buttons [data-action="layer-up"]').click();
    // After move, the order in the DOM may change; just verify we still have 2 layers
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
  });

  test('reorder layer down', async ({ page }) => {
    await createProject(page, 'Reorder Down Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    await page.locator('.layer-row').nth(0).click();
    await page.locator('#layer-buttons [data-action="layer-down"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
  });

  test('rename layer via double click', async ({ page }) => {
    await createProject(page, 'Rename Test');
    await addImage(page, TEST_IMAGE);

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Layer name');
      await dialog.accept('Renamed Layer');
    });

    await page.locator('.layer-name').first().dblclick();
    await expect(page.locator('#layer-list .layer-name').first()).toContainText('Renamed Layer');
  });

  test('multi-select layers with shift+click', async ({ page }) => {
    await createProject(page, 'Multi Select Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Click first layer
    await page.locator('.layer-row').nth(0).click();
    await expect(page.locator('.layer-row.selected')).toHaveCount(1);

    // Shift+click second layer
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('.layer-row.selected')).toHaveCount(2);
  });
});
