import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('custom target paper too small', () => {
  test('export plates: shows error on its own line with option to set target to current image size', async ({ page }) => {
    await createProject(page, 'Too Small Plates', { pageSize: 'half-letter' });

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();

    await page.selectOption('#export-target-size', 'custom');
    await page.locator('#export-custom-width').fill('1');
    await page.locator('#export-custom-height').fill('1');
    await page.locator('#export-custom-width').dispatchEvent('change');
    await page.locator('#export-custom-height').dispatchEvent('change');

    const warning = page.locator('#export-custom-warning');
    await expect(warning).toBeVisible();
    await expect(page.locator('#export-custom-warning-text')).toContainText('Custom paper too small');
    await expect(page.locator('#export-layout-info')).not.toContainText('Custom paper too small');
    await expect(page.locator('#btn-export-go')).toBeDisabled();

    const setBtn = page.locator('#btn-export-set-target-image');
    await expect(setBtn).toBeVisible();
    await expect(setBtn).toHaveText('Set target page to current image size');
    await setBtn.click();

    await expect(page.locator('#export-target-size')).toHaveValue('image');
    await expect(warning).toBeHidden();
    await expect(page.locator('#btn-export-go')).toBeEnabled();
    await expect(page.locator('#export-layout-info')).not.toBeEmpty();
  });

  test('composite export: shows error on its own line with option to set target to current image size', async ({ page }) => {
    await createProject(page, 'Too Small Composite', { pageSize: 'half-letter', pageCount: 4 });

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export-composite"]');
    await expect(page.locator('#composite-export-dialog')).toBeVisible();

    await page.selectOption('#composite-target-size', 'custom');
    await page.locator('#composite-custom-width').fill('1');
    await page.locator('#composite-custom-height').fill('1');
    await page.locator('#composite-custom-width').dispatchEvent('change');
    await page.locator('#composite-custom-height').dispatchEvent('change');

    const warning = page.locator('#composite-custom-warning');
    await expect(warning).toBeVisible();
    await expect(page.locator('#composite-custom-warning-text')).toContainText('Custom paper too small');
    await expect(page.locator('#composite-layout-info')).not.toContainText('Custom paper too small');
    await expect(page.locator('#btn-composite-go')).toBeDisabled();

    const setBtn = page.locator('#btn-composite-set-target-image');
    await expect(setBtn).toBeVisible();
    await expect(setBtn).toHaveText('Set target page to current image size');
    await setBtn.click();

    await expect(page.locator('#composite-target-size')).toHaveValue('image');
    await expect(warning).toBeHidden();
    await expect(page.locator('#btn-composite-go')).toBeEnabled();
  });
});
