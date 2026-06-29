# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pagination.spec.js >> Pagination >> export dialog shows layout info
- Location: e2e/pagination.spec.js:31:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#export-layout-info')
Expected substring: "per sheet"
Received string:    "1 page booklet, folio, 2 per side, Interleaved, landscape"
Timeout: 5000ms

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('#export-layout-info')
    14 × locator resolved to <span id="export-layout-info">1 page booklet, folio, 2 per side, Interleaved, l…</span>
       - unexpected value "1 page booklet, folio, 2 per side, Interleaved, landscape"

```

```yaml
- text: 1 page booklet, folio, 2 per side, Interleaved, landscape
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { clearIndexedDB, gotoApp, createProject, addImage } from './helpers.js';
  3  | import path from 'path';
  4  | import { fileURLToPath } from 'url';
  5  | 
  6  | const __dirname = path.dirname(fileURLToPath(import.meta.url));
  7  | const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');
  8  | 
  9  | test.beforeEach(async ({ page }) => {
  10 |   await clearIndexedDB(page);
  11 | });
  12 | 
  13 | test.describe('Pagination', () => {
  14 |   test('create project with 4-page preset', async ({ page }) => {
  15 |     await gotoApp(page);
  16 |     await page.fill('#new-project-name', 'Four Page Zine');
  17 |     await page.locator('label:has(input[name="new-page-count"][value="4"])').click();
  18 |     await page.click('#btn-create-project');
  19 |     await expect(page.locator('#main-app')).toBeVisible();
  20 |     // Default saddle-stitch binding shows only the cover and centre spreads.
  21 |     await expect(page.locator('#page-list .page-row')).toHaveCount(2);
  22 |   });
  23 | 
  24 |   test('rename a page', async ({ page }) => {
  25 |     await createProject(page, 'Rename Page Test');
  26 |     page.once('dialog', dialog => dialog.accept('Cover'));
  27 |     await page.locator('#page-list .page-row').first().dblclick({ position: { x: 30, y: 10 } });
  28 |     await expect(page.locator('#page-list .page-row').first()).toContainText('Cover');
  29 |   });
  30 | 
  31 |   test('export dialog shows layout info', async ({ page }) => {
  32 |     await createProject(page, 'Export Layout Test');
  33 |     await addImage(page, TEST_IMAGE);
  34 |     await page.click('.menu-item[data-menu="file"]');
  35 |     await page.click('[data-action="export"]');
  36 |     await expect(page.locator('#export-dialog')).toBeVisible();
> 37 |     await expect(page.locator('#export-layout-info')).toContainText('per sheet');
     |                                                       ^ Error: expect(locator).toContainText(expected) failed
  38 |   });
  39 | 
  40 |   test('half-letter pages layout 2-up on landscape letter', async ({ page }) => {
  41 |     await createProject(page, 'Half Letter Layout', { pageSize: 'half-letter' });
  42 |     await page.click('.menu-item[data-menu="file"]');
  43 |     await page.click('[data-action="export"]');
  44 |     await expect(page.locator('#export-dialog')).toBeVisible();
  45 |     const info = await page.locator('#export-layout-info').textContent();
  46 |     expect(info).toContain('2 per sheet');
  47 |     expect(info).toContain('landscape');
  48 |   });
  49 | 
  50 |   test('saddle-stitch half-letter uses landscape sheet', async ({ page }) => {
  51 |     await createProject(page, 'Saddle Layout', { pageSize: 'half-letter' });
  52 |     await page.click('.menu-item[data-menu="file"]');
  53 |     await page.click('[data-action="export"]');
  54 |     await page.locator('input[name="export-binding"][value="saddle-stitch"]').click();
  55 |     await expect(page.locator('#export-layout-info')).toContainText('landscape');
  56 |   });
  57 | 
  58 | });
  59 | 
```