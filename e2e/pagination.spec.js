import { test, expect } from '@playwright/test';
import { clearIndexedDB, gotoApp, createProject, addImage, getProjectPageIds } from './helpers.js';
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

  test('add folio appends four pages', async ({ page }) => {
    await createProject(page, 'Add Folio Test', { pageCount: 4 });
    await page.click('[data-action="add-folio"]');
    await expect(page.locator('#page-list .page-row')).toHaveCount(6); // 8-page saddle-stitch view units
    const pageIds = await getProjectPageIds(page);
    expect(pageIds.length).toBe(8);
  });

  test('remove folio dialog lists folios with thumbnails', async ({ page }) => {
    await createProject(page, 'Remove Folio Test', { pageCount: 8 });
    await page.click('[data-action="remove-folio"]');
    await expect(page.locator('#remove-folio-dialog')).toBeVisible();
    await expect(page.locator('.folio-row')).toHaveCount(2);
    await expect(page.locator('.folio-row').first().locator('.folio-thumb')).toHaveCount(4);
    // Thumbnails should load (non-empty data/blob URLs).
    const firstThumb = page.locator('.folio-row').first().locator('.folio-thumb').first();
    await expect(firstThumb).toHaveAttribute('src', /^(blob|data):/);
  });

  test('remove selected folio deletes four pages', async ({ page }) => {
    await createProject(page, 'Remove Folio Confirm Test', { pageCount: 8 });
    await page.click('[data-action="remove-folio"]');
    await page.locator('.folio-row').first().click();
    await page.click('#btn-confirm-remove-folio');
    await expect(page.locator('#remove-folio-dialog')).toBeHidden();
    await expect(page.locator('#page-list .page-row')).toHaveCount(2); // wait for removal
    const pageIds = await getProjectPageIds(page);
    expect(pageIds.length).toBe(4);
  });

});
