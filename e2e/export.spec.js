import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, addSolidColorImage, runExportSinglePlate } from './helpers.js';
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

    // Single-page projects hide the booklet rows but can still adjust to a
    // target paper like multi-page documents.
    await expect(page.locator('#export-booklet-layout-row')).toBeHidden();
    await expect(page.locator('#export-binding-row')).toBeHidden();
    await expect(page.locator('#export-target-size-row')).toBeVisible();
    await expect(page.locator('#export-layout-info')).toContainText('1 per sheet, portrait');
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

  test('single-image 1up plate export centers upright on portrait letter', async ({ page }) => {
    // Landscape half-letter page (5100×3300 px @600dpi) with a black image
    // 3000×2000 centered on it — the "landscape image" scenario.
    await createProject(page, 'Single Paper Fit 1up', { orientation: 'landscape' });
    await addSolidColorImage(page, '#000000', { width: 3000, height: 2000 });
    // Place the image explicitly: the page-size cache can lag the orientation
    // toggle, so auto-centering is not deterministic here.
    await page.evaluate(() => {
      const l = window.State.layers[0];
      l.x = 1050; l.y = 650;
    });

    const result = await runExportSinglePlate(page, { layout: '1up', targetSheetSize: 'letter' });
    const plates = Object.values(result);
    expect(plates.length).toBe(1);
    const sheet = plates[0];

    // Output is a full portrait letter sheet, not the raw landscape canvas.
    expect(sheet.width).toBe(5100);
    expect(sheet.height).toBe(6600);

    // The page is drawn upright (not rotated), 1:1, centered on the sheet.
    // Page lands at offset (0, 1650); its image ink sits at (1050, 650).
    expect(sheet.ink.minX).toBeGreaterThanOrEqual(1048);
    expect(sheet.ink.maxX).toBeLessThanOrEqual(4051);
    expect(sheet.ink.minY).toBeGreaterThanOrEqual(2298);
    expect(sheet.ink.maxY).toBeLessThanOrEqual(4301);
    // Landscape-oriented ink on a portrait sheet proves no 90° rotation.
    expect(sheet.ink.maxX - sheet.ink.minX).toBeGreaterThan(sheet.ink.maxY - sheet.ink.minY);
  });

  test('single-image 2up plate export stacks copies vertically on portrait letter', async ({ page }) => {
    await createProject(page, 'Single Paper Fit 2up', { orientation: 'landscape' });
    await addSolidColorImage(page, '#000000', { width: 3000, height: 2000 });
    await page.evaluate(() => {
      const l = window.State.layers[0];
      l.x = 1050; l.y = 650;
    });

    const result = await runExportSinglePlate(page, { layout: '2up', targetSheetSize: 'letter' });
    const plates = Object.values(result);
    expect(plates.length).toBe(1);
    const sheet = plates[0];

    // Two copies fit at 100% only stacked vertically on portrait letter.
    expect(sheet.width).toBe(5100);
    expect(sheet.height).toBe(6600);
    expect(sheet.ink.minX).toBeGreaterThanOrEqual(1048);
    expect(sheet.ink.maxX).toBeLessThanOrEqual(4051);
    expect(sheet.ink.minY).toBeGreaterThanOrEqual(648);
    expect(sheet.ink.maxY).toBeLessThanOrEqual(5951);
    // White gap between the vertically stacked copies at the sheet midpoint.
    expect(sheet.midGapGrey).toBeGreaterThan(250);
  });
});
