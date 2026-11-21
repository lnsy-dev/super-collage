import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/** Mix a color that is not already in the palette: black 0%, blue 100%, neon pink 100%. */
async function mixNewColor(page) {
  await page.evaluate(() => {
    const set = (hex, value) => {
      const slider = document.querySelector(`.bucket-ink-row input[data-hex="${hex}"]`);
      slider.value = value;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('#010101', '0');
    set('#0078bf', '100');
    set('#ff48b0', '100');
  });
}

/** Palette swatch strip + the persisted 'risoColors' setting. */
async function paletteSnapshot(page) {
  return page.evaluate(async () => {
    const { DB } = await import('/src/app/db.js');
    return {
      swatchCount: document.querySelectorAll('#color-swatches .color-swatch').length,
      titles: [...document.querySelectorAll('#color-swatches .color-swatch')].map(s => s.title),
      setting: (await DB.getSetting('risoColors'))?.value ?? null,
    };
  });
}

test.describe('Mix Ink naming', () => {
  test('Save Color requires an ink name, then saves the mix under it', async ({ page }) => {
    await createProject(page, 'Mix Ink Naming');

    // Open the Mix Ink dialog from the palette "+" button.
    await page.click('.color-swatch-add');
    await expect(page.locator('#paint-bucket-dialog')).toBeVisible();
    await expect(page.locator('#bucket-ink-name')).toHaveValue('');

    await mixNewColor(page);
    const mixHex = (await page.locator('#bucket-mix-hex').textContent()).trim();
    const before = await paletteSnapshot(page);
    expect(before.titles).not.toContain('Purple Sky');

    // Saving without a name is blocked: inline crimson highlight, the dialog
    // stays open, and neither the swatch strip nor the stored setting changes.
    await page.click('#btn-bucket-save-color');
    await expect(page.locator('#paint-bucket-dialog')).toBeVisible();
    await expect(page.locator('#bucket-ink-name')).toHaveCSS('border-color', 'rgb(220, 20, 60)');
    expect(await paletteSnapshot(page)).toEqual(before);

    // Typing clears the highlight…
    await page.locator('#bucket-ink-name').fill('Purple Sky');
    await expect(page.locator('#bucket-ink-name')).not.toHaveCSS('border-color', 'rgb(220, 20, 60)');

    // …and Save Color adds a palette swatch named "Purple Sky". Wait for the
    // swatch: the save persists asynchronously before refreshing the strip.
    await page.click('#btn-bucket-save-color');
    await expect(page.locator('#color-swatches .color-swatch[title="Purple Sky"]')).toHaveCount(1);
    const after = await paletteSnapshot(page);
    expect(after.swatchCount).toBe(before.swatchCount + 1);
    expect(after.titles).toContain('Purple Sky');

    const saved = await page.evaluate(async (hex) => {
      const { DB } = await import('/src/app/db.js');
      return (await DB.getSetting('risoColors'))?.value?.find(c => c.hex === hex);
    }, mixHex);
    expect(saved?.name).toBe('Purple Sky');
  });

  test('Enter in the name field saves the mixed ink', async ({ page }) => {
    await createProject(page, 'Mix Ink Enter');

    await page.click('.color-swatch-add');
    await expect(page.locator('#paint-bucket-dialog')).toBeVisible();

    await mixNewColor(page);
    const mixHex = (await page.locator('#bucket-mix-hex').textContent()).trim();
    const before = await paletteSnapshot(page);

    await page.locator('#bucket-ink-name').fill('Purple Sky');
    await page.locator('#bucket-ink-name').press('Enter');

    // Wait for the swatch: the save persists asynchronously before the
    // swatch strip refreshes.
    await expect(page.locator('#color-swatches .color-swatch[title="Purple Sky"]')).toHaveCount(1);
    const after = await paletteSnapshot(page);
    expect(after.swatchCount).toBe(before.swatchCount + 1);
    expect(after.titles).toContain('Purple Sky');
    const saved = await page.evaluate(async (hex) => {
      const { DB } = await import('/src/app/db.js');
      return (await DB.getSetting('risoColors'))?.value?.find(c => c.hex === hex);
    }, mixHex);
    expect(saved?.name).toBe('Purple Sky');
  });

  test('name field resets (value and highlight) every time the dialog opens', async ({ page }) => {
    await createProject(page, 'Mix Ink Reset');

    await page.click('.color-swatch-add');
    await expect(page.locator('#paint-bucket-dialog')).toBeVisible();

    // Leave a stale value + highlight behind (blocked save focuses the field).
    await page.click('#btn-bucket-save-color');
    await expect(page.locator('#bucket-ink-name')).toHaveCSS('border-color', 'rgb(220, 20, 60)');

    // Reopen via Done + "+" — the field must come back clean.
    await page.click('#btn-bucket-done');
    await expect(page.locator('#paint-bucket-dialog')).toBeHidden();
    await page.click('.color-swatch-add');
    await expect(page.locator('#paint-bucket-dialog')).toBeVisible();
    await expect(page.locator('#bucket-ink-name')).toHaveValue('');
    await expect(page.locator('#bucket-ink-name')).not.toHaveCSS('border-color', 'rgb(220, 20, 60)');
  });
});
