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

// Heavy fixture (four 3300×5100 source images + eight letter-size PNG
// sheets): the default 30s test timeout leaves no room under suite load.
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
  // Choose the paper first: booklet layouts are disabled until the selected
  // paper can fit the pages unscaled (the dialog opens on "Current image
  // size", which is too small for a folio spread).
  await page.selectOption('#export-target-size', 'letter');
  await page.locator('input[name="export-booklet-layout"][value="folio"]').click();

  // Collect every download until the export completes. Blank-plate skipping
  // means the file count is not sides × inks: an ink with nothing printed on
  // a sheet side saves no file, so waiting for a fixed total would block
  // forever once the real files have all arrived.
  const downloads = [];
  page.on('download', d => downloads.push(d));
  await page.click('#btn-export-go');

  // The export progress shows a determinate bar while sheets stream out.
  await expect(page.locator('#export-progress .export-progress-bar')).toBeVisible();

  // Saddle-stitch folio imposes 4 pages on 1 sheet: side 1 carries pages 4
  // and 1, side 2 pages 2 and 3. Each ink here prints on exactly one reader
  // page, so each ink yields one file — and the three sides where it has
  // nothing to print are skipped as blank plates.
  await expect(page.locator('#export-progress .export-progress-label'))
    .toContainText('Done!', { timeout: 60000 });

  expect(downloads).toHaveLength(4);
  const names = downloads.map(d => d.suggestedFilename());
  for (const name of names) {
    expect(name).toMatch(/\.png$/);
  }
  expect(names.sort()).toEqual([
    'booklet-download-aqua-sheet-1.png',
    'booklet-download-blue-sheet-2.png',
    'booklet-download-red-sheet-1.png',
    'booklet-download-yellow-sheet-2.png',
  ]);

  // Completion summary with metrics (elapsed time, downloaded size). Only
  // real sheets are counted; the skipped blanks are reported separately.
  // Web-first assertions throughout: anything that re-runs the export dialog
  // or a second export wipes #export-progress's children
  // (createExportProgress / showExportDialog), so a bare textContent()
  // snapshot can race the wipe and hang or read null. Auto-retrying expect()
  // re-resolves the (possibly recreated) label instead.
  const summary = page.locator('#export-progress .export-progress-label');
  await expect(summary).toContainText('Done! 4 sheets', { timeout: 30000 });
  await expect(summary).toContainText('4 blank plates skipped');
  await expect(summary).toContainText('4 pages');
  await expect(page.locator('#export-progress .export-progress-metrics')).toContainText('⏱');
});
