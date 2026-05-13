import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Export', () => {
  test('open export plates dialog', async ({ page }) => {
    await createProject(page, 'Export Dialog Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();
    await expect(page.locator('#export-dialog .dialog-title')).toContainText('Export Color Plates');
  });

  test('export dialog shows color list', async ({ page }) => {
    await createProject(page, 'Export Colors Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-color-list')).toBeVisible();
    // Should show at least one color entry
    await expect(page.locator('#export-color-list')).not.toBeEmpty();
  });

  test('cancel export plates dialog', async ({ page }) => {
    await createProject(page, 'Export Cancel Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();

    await page.click('#btn-export-cancel');
    await expect(page.locator('#export-dialog')).toBeHidden();
  });

  test('open composite export dialog', async ({ page }) => {
    await createProject(page, 'Composite Dialog Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export-composite"]');
    await expect(page.locator('#composite-export-dialog')).toBeVisible();
    await expect(page.locator('#composite-export-dialog .dialog-title')).toContainText('Export Composite Preview');
  });

  test('cancel composite export dialog', async ({ page }) => {
    await createProject(page, 'Composite Cancel Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export-composite"]');
    await expect(page.locator('#composite-export-dialog')).toBeVisible();

    await page.click('#btn-composite-cancel');
    await expect(page.locator('#composite-export-dialog')).toBeHidden();
  });

  test('export layout options exist in plates dialog', async ({ page }) => {
    await createProject(page, 'Export Layouts Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('input[name="export-layout"][value="1up"]')).toBeVisible();
    await expect(page.locator('input[name="export-layout"][value="2up"]')).toBeVisible();
    await expect(page.locator('input[name="export-layout"][value="4up"]')).toBeVisible();
  });

  test('export layout options exist in composite dialog', async ({ page }) => {
    await createProject(page, 'Composite Layouts Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export-composite"]');
    await expect(page.locator('input[name="composite-layout"][value="1up"]')).toBeVisible();
    await expect(page.locator('input[name="composite-layout"][value="2up"]')).toBeVisible();
    await expect(page.locator('input[name="composite-layout"][value="4up"]')).toBeVisible();
  });
});
