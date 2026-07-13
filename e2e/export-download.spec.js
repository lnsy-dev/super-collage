import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, getProjectPageIds, loadPageById, addSolidColorImage, setLayerColorDirect } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

async function addBlackImageToPage(page, pageId, colorHex) {
  await loadPageById(page, pageId);
  await addSolidColorImage(page, '#000000', { width: 3300, height: 5100 });
  await setLayerColorDirect(page, colorHex);
}

test('export all pages as booklet downloads sheets', async ({ page }) => {
  await createProject(page, 'Booklet Download', { pageSize: 'half-letter', pageCount: 4 });
  const pageIds = await getProjectPageIds(page);
  const colors = ['#f65058', '#0078bf', '#ffe800', '#5ec8e5'];
  for (let i = 0; i < pageIds.length; i++) {
    await addBlackImageToPage(page, pageIds[i], colors[i]);
  }

  // Open export dialog.
  await page.click('.menu-item[data-menu="file"]');
  await page.click('[data-action="export"]');
  await expect(page.locator('#export-dialog')).toBeVisible();

  // Select booklet options (binding is always saddle-stitch; no UI choice).
  await page.locator('input[name="export-booklet-layout"][value="folio"]').click();
  await page.selectOption('#export-target-size', 'letter');

  // Wait for downloads.
  const [download1] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-go'),
  ]);

  // Saddle-stitch folio with 4 pages and 4 colors yields 2 sheets per color.
  const downloads = [download1];
  for (let i = 0; i < 7; i++) {
    downloads.push(await page.waitForEvent('download', { timeout: 10000 }));
  }

  expect(downloads.length).toBe(8);
  for (const d of downloads) {
    expect(d.suggestedFilename()).toMatch(/\.png$/);
  }
});
