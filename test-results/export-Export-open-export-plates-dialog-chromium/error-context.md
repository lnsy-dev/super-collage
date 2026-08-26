# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: export.spec.js >> Export >> open export plates dialog
- Location: e2e/export.spec.js:14:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.goto: Test timeout of 30000ms exceeded.
Call log:
  - navigating to "http://localhost:3421/", waiting until "load"

```

# Test source

```ts
  1   | // @ts-check
  2   | import { expect } from '@playwright/test';
  3   | 
  4   | /**
  5   |  * Clean up the IndexedDB database used by the app.
  6   |  * Navigates to the app first, then clears the database.
  7   |  * Call this in beforeEach to ensure test isolation.
  8   |  */
  9   | export async function clearIndexedDB(page) {
  10  |   // Must navigate to an actual page (not about:blank) before accessing IndexedDB
  11  |   await page.goto('/');
  12  |   await page.waitForLoadState('domcontentloaded');
  13  |   await page.evaluate(() => {
  14  |     return new Promise((resolve, reject) => {
  15  |       const req = indexedDB.deleteDatabase('superCollage');
  16  |       req.onsuccess = () => resolve(undefined);
  17  |       req.onerror = () => reject(req.error);
  18  |       req.onblocked = () => {
  19  |         // Force close any open connections and retry
  20  |         resolve(undefined);
  21  |       };
  22  |     });
  23  |   });
  24  | }
  25  | 
  26  | /**
  27  |  * Navigate to the app and wait for either the project manager or the
  28  |  * create-new dialog to appear (empty libraries open directly into create).
  29  |  */
  30  | export async function gotoApp(page) {
> 31  |   await page.goto('/');
      |              ^ Error: page.goto: Test timeout of 30000ms exceeded.
  32  |   await page.waitForFunction(() => window.__appReady === true, null, { timeout: 10000 });
  33  |   await expect(page.locator('#project-dialog:visible, #create-project-dialog:visible')).toBeVisible();
  34  | }
  35  | 
  36  | /**
  37  |  * Create a new project from the create-new modal.
  38  |  */
  39  | export async function createProject(page, name, { pageSize = 'half-letter', orientation = 'portrait', pageCount = 1 } = {}) {
  40  |   await gotoApp(page);
  41  |   // Empty libraries open directly into the create modal; otherwise open it manually.
  42  |   if (await page.locator('#project-dialog').isVisible()) {
  43  |     await page.click('#btn-create-new');
  44  |     await expect(page.locator('#create-project-dialog')).toBeVisible();
  45  |   }
  46  |   await page.fill('#create-project-name', name);
  47  |   // Step 1: Units (default imperial) -> Next
  48  |   await page.click('#btn-create-next');
  49  |   // Step 2: Page Size
  50  |   await page.locator(`label:has(input[name="create-page-size"][value="${pageSize}"])`).click();
  51  |   await page.click('#btn-create-next');
  52  |   // Step 3: Pages for Project
  53  |   if (pageCount !== 1) {
  54  |     await page.locator(`label:has(input[name="create-page-count"][value="${pageCount}"])`).click();
  55  |   }
  56  |   await page.click('#btn-create-next'); // Create
  57  |   // Wait for main app to be visible
  58  |   await expect(page.locator('#main-app')).toBeVisible();
  59  |   if (orientation === 'landscape') {
  60  |     await page.locator('#zoom-controls [data-action="orient-landscape"]').click();
  61  |   }
  62  | }
  63  | 
  64  | /**
  65  |  * Add an image to the current project using the hidden file input.
  66  |  */
  67  | export async function addImage(page, imagePath) {
  68  |   // Directly set files on the hidden input — the menu approach requires opening dropdowns
  69  |   await page.setInputFiles('#file-input', imagePath);
  70  |   // Wait for layer to appear in list
  71  |   await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
  72  | }
  73  | 
  74  | /**
  75  |  * Get the currently selected layer id from the page state.
  76  |  */
  77  | export async function getSelectedLayerId(page) {
  78  |   return page.evaluate(() => {
  79  |     // @ts-ignore
  80  |     return State?.selectedId;
  81  |   });
  82  | }
  83  | 
  84  | /**
  85  |  * Get the number of layers.
  86  |  */
  87  | export async function getLayerCount(page) {
  88  |   return page.locator('#layer-list .layer-row').count();
  89  | }
  90  | 
  91  | /**
  92  |  * Select a tool by its data-tool attribute.
  93  |  */
  94  | export async function selectTool(page, toolName) {
  95  |   await page.click(`.tool-btn[data-tool="${toolName}"]`);
  96  |   await expect(page.locator(`#status-tool`)).toContainText(
  97  |     toolName === 'select' ? 'Select' :
  98  |     toolName === 'mask-draw' ? 'Mask Draw' :
  99  |     toolName === 'mask-erase' ? 'Mask Erase' :
  100 |     toolName === 'text-box' ? 'Type — Paragraph Box' :
  101 |     toolName === 'text-line' ? 'Type — Single Line' :
  102 |     toolName === 'shape-rect' ? 'Rectangle' :
  103 |     toolName === 'shape-ellipse' ? 'Ellipse' :
  104 |     toolName === 'shape-poly' ? 'Polygon' : toolName
  105 |   );
  106 | }
  107 | 
  108 | /**
  109 |  * Add a text layer via File → Add Text… and edit it on-canvas.
  110 |  * The new flow opens an in-box editor directly; we type into it and
  111 |  * press Escape to commit.
  112 |  */
  113 | export async function addTextLayer(page, text = 'Hello') {
  114 |   await page.click('[data-menu="file"]');
  115 |   await page.click('[data-action="add-text"]');
  116 |   const editor = page.locator('.text-editor-input');
  117 |   await expect(editor).toBeVisible();
  118 |   if (text) await editor.fill(text);
  119 |   await page.keyboard.press('Escape');
  120 |   await expect(editor).toHaveCount(0);
  121 |   await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T / })).toBeVisible();
  122 | }
  123 | 
  124 | /**
  125 |  * Return all page ids for the current project from browser state.
  126 |  */
  127 | export async function getProjectPageIds(page) {
  128 |   return page.evaluate(() => {
  129 |     // @ts-ignore
  130 |     return State.project?.pageOrder || [];
  131 |   });
```