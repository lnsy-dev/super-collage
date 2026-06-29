import { test, expect } from '@playwright/test';
import { clearIndexedDB, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Project Management', () => {
  test('project dialog is visible on load', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('#project-dialog')).toBeVisible();
    await expect(page.locator('#project-dialog .dialog-title')).toContainText('Super Collage — Projects');
  });

  test('create a new project with default size', async ({ page }) => {
    await gotoApp(page);
    await page.fill('#new-project-name', 'Test Project');
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
      await page.fill('#new-project-name', `Project ${size.value}`);
      await page.locator(`label:has(input[name="new-page-size"][value="${size.value}"])`).click();
      await page.click('#btn-create-project');
      await expect(page.locator('#main-app')).toBeVisible();
      await expect(page.locator('#canvas-title')).toContainText(size.label);
    }
  });

  test('create project with custom size', async ({ page }) => {
    await gotoApp(page);
    await page.fill('#new-project-name', 'Custom Size Project');
    await page.locator('label:has(input[name="new-page-size"][value="custom"])').click();
    await expect(page.locator('#custom-size-row')).toBeVisible();
    await page.fill('#custom-width', '5');
    await page.fill('#custom-height', '7');
    await page.click('#btn-create-project');
    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('#canvas-title')).toContainText('5" × 7"');
  });

  test('switch orientation between portrait and landscape', async ({ page }) => {
    await gotoApp(page);
    await page.fill('#new-project-name', 'Orientation Test');
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
    await page.fill('#new-project-name', 'Persistent Project');
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
    await page.fill('#new-project-name', 'Openable Project');
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
    await page.fill('#new-project-name', 'Deletable Project');
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

  test('dialog is not cancellable when no project is open', async ({ page }) => {
    await gotoApp(page);
    // No project behind the dialog → no close affordance, Escape is inert.
    await expect(page.locator('#btn-close-project-dialog')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#project-dialog')).toBeVisible();
  });

  test('close button cancels the dialog when a project is open', async ({ page }) => {
    await gotoApp(page);
    await page.fill('#new-project-name', 'Cancelable Project');
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
    await page.fill('#new-project-name', 'Escapable Project');
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
