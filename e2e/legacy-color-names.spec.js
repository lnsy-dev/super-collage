import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, gotoApp } from './helpers.js';

// Palette a legacy save could have written before color naming became
// mandatory: entries named by their hex ("Save Color") or 'Untitled' (the
// old Edit Colors fallback), plus one well-named entry that must survive
// untouched.
const LEGACY_COLORS = [
  { name: '#5EC8E5', hex: '#5EC8E5', pantone: '' },
  { name: 'Untitled', hex: '#FF48B0', pantone: '' },
  { name: 'Charcoal', hex: '#333333', pantone: '' },
];

async function readManagerRows(page) {
  return page.locator('.color-manager-row').evaluateAll((rows) =>
    rows.map((row) => ({
      name: row.querySelector('.color-manager-name')?.value,
      // <input type="color"> normalizes its value to lowercase six-digit hex.
      hex: row.querySelector('.color-manager-color')?.value?.toUpperCase(),
    }))
  );
}

async function reloadAndReopenProject(page) {
  await page.reload();
  await page.waitForFunction(() => window.__appReady === true, null, { timeout: 10000 });
  await expect(page.locator('#project-dialog')).toBeVisible();
  await page.click('.project-entry');
  await page.click('#btn-open-project');
  await expect(page.locator('#main-app')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Legacy palette backfill', () => {
  test('renames hex-named and Untitled palette entries to Custom N on open', async ({ page }) => {
    // Seed the legacy palette once the splash is up (no project open yet);
    // the next project open runs the backfill over it.
    await gotoApp(page);
    await page.evaluate(async (colors) => {
      const { DB } = await import('/src/app/db.js');
      await DB.putSetting('risoColors', colors);
    }, LEGACY_COLORS);

    await createProject(page, 'Legacy Palette Test');
    await reloadAndReopenProject(page);

    // Edit Colors shows a real name for every entry, hexes unchanged.
    await page.click('.menu-item[data-menu="colors"]');
    await page.click('.menu-entry[data-action="edit-colors"]');
    await expect(page.locator('#color-manager-dialog')).toBeVisible();
    const rows = await readManagerRows(page);
    expect(rows.map((r) => r.name)).toEqual(['Custom 1', 'Custom 2', 'Charcoal']);
    expect(rows.map((r) => r.hex)).toEqual(['#5EC8E5', '#FF48B0', '#333333']);

    // The rename was written back to the global setting.
    const persisted = await page.evaluate(async () => {
      const { DB } = await import('/src/app/db.js');
      return ((await DB.getSetting('risoColors'))?.value || []).map((c) => c.name);
    });
    expect(persisted).toEqual(['Custom 1', 'Custom 2', 'Charcoal']);
    await page.click('#btn-color-manager-cancel');
    await expect(page.locator('#color-manager-dialog')).toBeHidden();

    // Opening again must not rename a second time (no Custom 3/4).
    await reloadAndReopenProject(page);
    await page.click('.menu-item[data-menu="colors"]');
    await page.click('.menu-entry[data-action="edit-colors"]');
    await expect(page.locator('#color-manager-dialog')).toBeVisible();
    const rowsAgain = await readManagerRows(page);
    expect(rowsAgain.map((r) => r.name)).toEqual(['Custom 1', 'Custom 2', 'Charcoal']);
    await page.click('#btn-color-manager-cancel');
    await expect(page.locator('#color-manager-dialog')).toBeHidden();
  });
});
