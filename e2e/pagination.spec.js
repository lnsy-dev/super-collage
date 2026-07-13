import { test, expect } from '@playwright/test';
import { clearIndexedDB, gotoApp, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Pagination', () => {
  test('create project with 4-page preset', async ({ page }) => {
    await gotoApp(page);
    await page.fill('#create-project-name', 'Four Page Zine');
    await page.locator('label:has(input[name="create-page-count"][value="4"])').click();
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();
    // Default saddle-stitch binding shows only the cover and centre spreads.
    await expect(page.locator('#page-list .page-row')).toHaveCount(2);
  });

  test('rename a page', async ({ page }) => {
    await createProject(page, 'Rename Page Test');
    page.once('dialog', dialog => dialog.accept('Cover'));
    await page.locator('#page-list .page-row').first().dblclick({ position: { x: 30, y: 10 } });
    await expect(page.locator('#page-list .page-row').first()).toContainText('Cover');
  });

  test('export dialog shows layout info', async ({ page }) => {
    await createProject(page, 'Export Layout Test', { pageCount: 4 });
    await addImage(page, TEST_IMAGE);
    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();
    await expect(page.locator('#export-layout-info')).toContainText('per side');
  });

  test('half-letter pages layout 2-up on landscape letter', async ({ page }) => {
    await createProject(page, 'Half Letter Layout', { pageSize: 'half-letter', pageCount: 4 });
    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();
    const info = await page.locator('#export-layout-info').textContent();
    expect(info).toContain('2 per side');
    expect(info).toContain('landscape');
  });

  test('saddle-stitch half-letter uses landscape sheet', async ({ page }) => {
    await createProject(page, 'Saddle Layout', { pageSize: 'half-letter', pageCount: 4 });
    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-layout-info')).toContainText('landscape');
  });

});
