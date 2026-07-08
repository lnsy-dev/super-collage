import { test, expect } from '@playwright/test';
import { clearIndexedDB, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Project Management', () => {
  async function ensureCreateDialog(page) {
    if (await page.locator('#project-dialog').isVisible()) {
      await page.click('#btn-create-new');
    }
    await expect(page.locator('#create-project-dialog')).toBeVisible();
  }

  test('project dialog is visible on load when projects exist', async ({ page }) => {
    // Seed an existing project so the manager (not create) opens.
    await page.goto('/');
    await page.evaluate(async () => {
      const { DB } = await import('/src/app/db.js');
      await DB.open();
      await DB.put('projects', {
        id: crypto.randomUUID(),
        name: 'Existing Project',
        pageSize: 'letter',
        pageOrder: [],
        booklet: { binding: 'saddle-stitch', targetSheetSize: 'letter', pagesPerSheet: 1 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await gotoApp(page);
    await expect(page.locator('#project-dialog')).toBeVisible();
    await expect(page.locator('#project-dialog .dialog-title')).toContainText('Super Collage — Projects');
  });

  test('empty library opens create dialog directly', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('#create-project-dialog')).toBeVisible();
    await expect(page.locator('#create-project-dialog .dialog-title')).toContainText('Super Collage — Create New');
  });

  test('create new button opens create modal', async ({ page }) => {
    // Seed a project so the manager stays open.
    await page.goto('/');
    await page.evaluate(async () => {
      const { DB } = await import('/src/app/db.js');
      await DB.open();
      await DB.put('projects', {
        id: crypto.randomUUID(),
        name: 'Existing Project',
        pageSize: 'letter',
        pageOrder: [],
        booklet: { binding: 'saddle-stitch', targetSheetSize: 'letter', pagesPerSheet: 1 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await gotoApp(page);
    await expect(page.locator('#project-dialog')).toBeVisible();
    await expect(page.locator('#create-project-dialog')).toBeHidden();
    await page.click('#btn-create-new');
    await expect(page.locator('#create-project-dialog')).toBeVisible();
  });

  test('create a new project with default size', async ({ page }) => {
    await gotoApp(page);
    await ensureCreateDialog(page);
    await page.fill('#create-project-name', 'Test Project');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('#canvas-title')).toContainText('Test Project');
    await expect(page.locator('#status-project')).toContainText('Test Project');
  });

  test('create project with each paper size', async ({ page }) => {
    const sizes = [
      { value: 'letter', label: '8.5" × 11"' },
      { value: 'legal', label: '8.5" × 14"' },
      { value: 'half-letter', label: '5.5" × 8.5"' },
      { value: '4x6', label: '4" × 6"' },
      { value: '4.25x7', label: '4.25" × 7"' },
      { value: 'manga', label: '5.04" × 7.17"' },
      { value: 'business-card', label: '3.5" × 2"' },
    ];

    for (const size of sizes) {
      await clearIndexedDB(page);
      await gotoApp(page);
      await ensureCreateDialog(page);
      await page.fill('#create-project-name', `Project ${size.value}`);
      await page.locator(`label:has(input[name="create-page-size"][value="${size.value}"])`).click();
      await page.click('#btn-create-project');
      await expect(page.locator('#main-app')).toBeVisible();
      await expect(page.locator('#canvas-title')).toContainText(size.label);
    }
  });

  test('create project with custom size', async ({ page }) => {
    await gotoApp(page);
    await ensureCreateDialog(page);
    await page.fill('#create-project-name', 'Custom Size Project');
    await page.locator('label:has(input[name="create-page-size"][value="custom"])').click();
    await expect(page.locator('#create-custom-size-row')).toBeVisible();
    await page.fill('#create-custom-width', '5');
    await page.fill('#create-custom-height', '7');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('#canvas-title')).toContainText('5" × 7"');
  });

  test('create project persists target sheet size', async ({ page }) => {
    await gotoApp(page);
    await ensureCreateDialog(page);
    await page.fill('#create-project-name', 'Target Sheet Project');
    await page.locator('label:has(input[name="create-target-size"][value="tabloid"])').click();
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();
    const booklet = await page.evaluate(() => window.State.project.booklet);
    expect(booklet.binding).toBe('saddle-stitch');
    expect(booklet.targetSheetSize).toBe('tabloid');
  });

  test('switch orientation between portrait and landscape', async ({ page }) => {
    await gotoApp(page);
    await ensureCreateDialog(page);
    await page.fill('#create-project-name', 'Orientation Test');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    // Default half-letter is portrait (3300x5100)
    await expect(page.locator('#btn-portrait')).toHaveClass(/active/);

    // Switch to landscape
    await page.locator('#zoom-controls [data-action="orient-landscape"]').click();
    await expect(page.locator('#btn-landscape')).toHaveClass(/active/);

    // Switch back
    await page.locator('#zoom-controls [data-action="orient-portrait"]').click();
    await expect(page.locator('#btn-portrait')).toHaveClass(/active/);
  });

  test('project persists across reload', async ({ page }) => {
    await gotoApp(page);
    await ensureCreateDialog(page);
    await page.fill('#create-project-name', 'Persistent Project');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    // Reload page
    await page.reload();
    await expect(page.locator('#project-dialog')).toBeVisible();

    // The project should appear in the list
    await expect(page.locator('.project-entry')).toContainText('Persistent Project');
  });

  test('open existing project from dialog', async ({ page }) => {
    await gotoApp(page);
    await ensureCreateDialog(page);
    await page.fill('#create-project-name', 'Openable Project');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    // Go back to dialog via File menu
    await page.locator('.menu-item[data-menu="file"]').click();
    await page.locator('[data-action="open-project"]').click();
    await expect(page.locator('#project-dialog')).toBeVisible();

    // Select and open
    await page.locator('.project-entry', { hasText: 'Openable Project' }).click();
    await page.click('#btn-open-project');
    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('#canvas-title')).toContainText('Openable Project');
  });

  test('delete a project', async ({ page }) => {
    await gotoApp(page);
    await ensureCreateDialog(page);
    await page.fill('#create-project-name', 'Deletable Project');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    // Go back to dialog
    await page.reload();
    await expect(page.locator('#project-dialog')).toBeVisible();

    // Select and delete
    await page.locator('.project-entry', { hasText: 'Deletable Project' }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.click('#btn-delete-project');

    await expect(page.locator('.project-entry', { hasText: 'Deletable Project' })).not.toBeVisible();
  });

  test('create dialog is not cancellable when no project is open', async ({ page }) => {
    await gotoApp(page);
    // Empty library opens directly into create; no project behind it → no close/back affordance.
    await expect(page.locator('#create-project-dialog')).toBeVisible();
    await expect(page.locator('#btn-create-project-close')).toBeHidden();
    await expect(page.locator('#btn-create-back')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#create-project-dialog')).toBeVisible();
  });

  test('close button cancels the dialog when a project is open', async ({ page }) => {
    await gotoApp(page);
    await ensureCreateDialog(page);
    await page.fill('#create-project-name', 'Cancelable Project');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    // Reopen the dialog over the open project via the File menu.
    await page.locator('.menu-item[data-menu="file"]').click();
    await page.locator('[data-action="open-project"]').click();
    await expect(page.locator('#project-dialog')).toBeVisible();
    await expect(page.locator('#btn-close-project-dialog')).toBeVisible();

    await page.click('#btn-close-project-dialog');
    await expect(page.locator('#project-dialog')).toBeHidden();
    await expect(page.locator('#main-app')).toBeVisible();
  });

  test('Escape cancels the dialog when a project is open', async ({ page }) => {
    await gotoApp(page);
    await ensureCreateDialog(page);
    await page.fill('#create-project-name', 'Escapable Project');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();

    await page.locator('.menu-item[data-menu="file"]').click();
    await page.locator('[data-action="open-project"]').click();
    await expect(page.locator('#project-dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#project-dialog')).toBeHidden();
    await expect(page.locator('#main-app')).toBeVisible();
  });
});
