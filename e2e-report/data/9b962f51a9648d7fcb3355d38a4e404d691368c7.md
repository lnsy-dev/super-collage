# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pagination.spec.js >> Pagination >> half-letter pages layout 2-up on landscape letter
- Location: e2e/pagination.spec.js:40:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "2 per sheet"
Received string:    "1 page booklet, folio, 2 per side, Interleaved, landscape"
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e5]: Export Color Plates
    - generic [ref=e6]:
      - paragraph [ref=e7]: "Exports one PNG per risograph color at 3300×5100 px (600 dpi). Each plate: black ink on white."
      - paragraph [ref=e9]: No visible layers to export.
      - generic [ref=e10]:
        - strong [ref=e11]: "Binding:"
        - generic [ref=e12] [cursor=pointer]:
          - radio "Saddle-stitch" [checked] [ref=e13]
          - text: Saddle-stitch
      - generic [ref=e14]:
        - strong [ref=e15]: "Booklet layout:"
        - generic [ref=e16] [cursor=pointer]:
          - radio "Folio (2-up)" [checked] [ref=e17]
          - text: Folio (2-up)
        - generic [ref=e18] [cursor=pointer]:
          - radio "Quarto (4-up)" [ref=e19]
          - text: Quarto (4-up)
        - generic [ref=e20] [cursor=pointer]:
          - radio "Octavo (8-up)" [ref=e21]
          - text: Octavo (8-up)
      - generic [ref=e22]:
        - strong [ref=e23]: "Target paper:"
        - combobox [ref=e24]:
          - option "Letter 8.5\"×11\"" [selected]
          - option "Legal 8.5\"×14\""
          - option "Tabloid 11\"×17\""
          - option "Custom"
        - text: 1 page booklet, folio, 2 per side, Interleaved, landscape
      - generic [ref=e25]:
        - strong [ref=e26]: "Layout:"
        - generic [ref=e27] [cursor=pointer]:
          - radio "1 up" [checked] [ref=e28]
          - text: 1 up
        - generic [ref=e29] [cursor=pointer]:
          - radio "2 up" [ref=e30]
          - text: 2 up
        - generic [ref=e31] [cursor=pointer]:
          - radio "4 up" [ref=e32]
          - text: 4 up
        - generic [ref=e33] [cursor=pointer]:
          - radio "8 up" [ref=e34]
          - text: 8 up
    - generic [ref=e35]:
      - button "Cancel" [ref=e36] [cursor=pointer]
      - button "Export All Plates" [ref=e37] [cursor=pointer]
  - generic [ref=e38]:
    - generic [ref=e39]:
      - generic [ref=e40]: ▨ SC
      - generic [ref=e41] [cursor=pointer]: File
      - generic [ref=e42] [cursor=pointer]: Edit
      - generic [ref=e43] [cursor=pointer]: View
      - generic [ref=e44] [cursor=pointer]: Layer
    - generic [ref=e45]:
      - generic [ref=e47]:
        - button "▶" [ref=e48] [cursor=pointer]
        - button "✥" [ref=e49] [cursor=pointer]
        - button "●" [ref=e51] [cursor=pointer]
        - button "○" [ref=e52] [cursor=pointer]
        - button "▭" [ref=e54] [cursor=pointer]
        - button "◯" [ref=e55] [cursor=pointer]
        - button "⬠" [ref=e56] [cursor=pointer]
        - generic [ref=e58]: Brush
        - slider [ref=e59] [cursor=pointer]: "30"
        - generic [ref=e60]: "30"
      - generic [ref=e61]:
        - generic [ref=e64]: Half Letter Layout — Page 1 — 5.5" × 8.5" @ 600dpi
        - generic [ref=e65]:
          - generic [ref=e67]:
            - generic:
              - text: Drop images here
              - text: or
              - text: File → Add Image
          - generic [ref=e70]:
            - button "−" [ref=e71] [cursor=pointer]
            - generic [ref=e72]: 12%
            - button "+" [ref=e73] [cursor=pointer]
            - button "Fit" [ref=e74] [cursor=pointer]
            - button "1:1" [ref=e75] [cursor=pointer]
            - button "▯" [ref=e77] [cursor=pointer]
            - button "▭" [ref=e78] [cursor=pointer]
            - button "↶" [ref=e80] [cursor=pointer]
            - button "↷" [ref=e81] [cursor=pointer]
      - generic [ref=e82]:
        - generic [ref=e84]:
          - generic [ref=e86]: No layers
          - generic [ref=e87]:
            - button "▲" [ref=e88] [cursor=pointer]
            - button "▼" [ref=e89] [cursor=pointer]
            - button "⊕" [ref=e90] [cursor=pointer]
            - button "✕" [ref=e91] [cursor=pointer]
        - generic [ref=e92]:
          - generic [ref=e94]: Pages
          - generic [ref=e95]:
            - generic [ref=e99] [cursor=pointer]: Page 1
            - generic [ref=e100]:
              - button "▲" [ref=e101] [cursor=pointer]
              - button "▼" [ref=e102] [cursor=pointer]
        - generic [ref=e103]:
          - generic [ref=e105]: Properties
          - generic [ref=e108]: Select a layer
    - generic [ref=e109]:
      - generic [ref=e110]:
        - text: "Tool:"
        - strong [ref=e111]: Select
      - generic [ref=e112]:
        - text: "Layer:"
        - strong [ref=e113]: —
      - generic [ref=e114]:
        - text: "Pos:"
        - strong [ref=e115]: —
      - generic [ref=e116]:
        - text: "Zoom:"
        - strong [ref=e117]: 12%
      - generic [ref=e118]: Half Letter Layout
  - generic [ref=e119]:
    - text: Enjoying Super Collage?
    - link "Support me on Ko-fi" [ref=e120] [cursor=pointer]:
      - /url: https://ko-fi.com/lnsy47369
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
  37 |     await expect(page.locator('#export-layout-info')).toContainText('per sheet');
  38 |   });
  39 | 
  40 |   test('half-letter pages layout 2-up on landscape letter', async ({ page }) => {
  41 |     await createProject(page, 'Half Letter Layout', { pageSize: 'half-letter' });
  42 |     await page.click('.menu-item[data-menu="file"]');
  43 |     await page.click('[data-action="export"]');
  44 |     await expect(page.locator('#export-dialog')).toBeVisible();
  45 |     const info = await page.locator('#export-layout-info').textContent();
> 46 |     expect(info).toContain('2 per sheet');
     |                  ^ Error: expect(received).toContain(expected) // indexOf
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