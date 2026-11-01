import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

async function paletteVisible(page) {
  return page.evaluate(() => {
    const section = document.querySelector('#layer-props .prop-section:has(#color-swatches)');
    if (!section) return { found: false, visible: false, hiddenOther: [] };
    return {
      found: true,
      visible: section.offsetParent !== null,
      hiddenOther: [...document.querySelectorAll('#layer-props .prop-section')]
        .filter(s => s !== section && s.offsetParent !== null).length,
    };
  });
}

test.describe('Ink palette', () => {
  test('palette view is visible with no layer selected and has a + button', async ({ page }) => {
    await createProject(page, 'Palette No Selection');

    const info = await paletteVisible(page);
    expect(info.found, 'palette section exists').toBe(true);
    expect(info.visible, 'palette section visible with no selection').toBe(true);
    // The + affordance lives at the end of the palette view.
    const isLast = await page.evaluate(() => {
      const strip = document.getElementById('color-swatches');
      const kids = [...strip.children];
      return kids.length > 0 && kids[kids.length - 1].classList.contains('color-swatch-add');
    });
    expect(isLast, '+ button is the last element of the palette').toBe(true);

    // Swatches render unattached to any layer.
    await expect(page.locator('#color-swatches .color-swatch').first()).toBeVisible();
  });

  test('palette view survives gradient mode and color-separation selection', async ({ page }) => {
    await createProject(page, 'Palette Always Visible');
    await addImage(page, TEST_IMAGE);
    const layerId = await page.evaluate(() => State.layers[0].id);
    await page.evaluate((id) => { State.selectedId = id; UI.refreshProperties(); }, layerId);

    // Gradient mode used to hide the solid swatch strip entirely.
    await page.click('#btn-mode-gradient');
    let info = await paletteVisible(page);
    expect(info.found).toBe(true);
    await expect(page.locator('#color-swatches')).toBeVisible();

    // Back to solid, then pretend the layer is a color separation (their
    // palette used to disappear entirely).
    await page.evaluate(() => {
      const l = State.layers[0];
      l.colorMode = 'solid';
      l.isColorSeparation = true;
      l.separationColors = ['#010101'];
      UI.refreshProperties();
    });
    info = await paletteVisible(page);
    expect(info.visible).toBe(true);
    await expect(page.locator('#color-swatches')).toBeVisible();
  });

  test('palette view shows when switching between layers and empty canvas', async ({ page }) => {
    await createProject(page, 'Palette Toggle');
    await addImage(page, TEST_IMAGE);

    // Select layer → deselect (null selection) → palette stays visible.
    const layerId = await page.evaluate(() => State.layers[0].id);
    await page.evaluate((id) => { State.selectedId = id; UI.refreshProperties(); }, layerId);
    expect((await paletteVisible(page)).visible).toBe(true);

    await page.evaluate(() => { State.selectedId = null; UI.refreshProperties(); });
    expect((await paletteVisible(page)).visible).toBe(true);

    // Property sections for the layer are hidden while nothing is selected.
    await page.evaluate(() => {
      document.getElementById('no-selection-msg');
    });
    await expect(page.locator('#no-selection-msg')).toBeVisible();
  });

  test('+ button opens the ink selection with a fresh editable row and applies it', async ({ page }) => {
    await createProject(page, 'Add Ink Flow');

    // An ink row already exists: free a slot so the quick add can land
    // within the separation engine's 7-printable-ink cap.
    await page.click('.color-swatch-add');
    await expect(page.locator('#color-manager-dialog')).toBeVisible();
    // The manager opened with one pre-appended editable row at the end.
    const lastRow = page.locator('.color-manager-row').last();
    await expect(lastRow.locator('.color-manager-name')).toHaveValue('New Color');

    // Complete the new-ink edit like a user would.
    await page.locator('.color-manager-row').nth(6).locator('.color-manager-remove').click();
    await lastRow.locator('.color-manager-name').fill('Cornflower');
    await lastRow.locator('.color-manager-color').evaluate((el) => {
      el.value = '#1e90ff';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#btn-color-manager-ok');
    await expect(page.locator('#color-manager-dialog')).toBeHidden();

    // The new ink shows in the palette view.
    await expect(page.locator('#color-swatches .color-swatch[data-color="#1E90FF"]')).toHaveCount(1);
  });

  test('added ink persists across reload', async ({ page }) => {
    await createProject(page, 'Ink Persistence');

    await page.click('.color-swatch-add');
    await expect(page.locator('#color-manager-dialog')).toBeVisible();
    const lastRow = page.locator('.color-manager-row').last();
    await page.locator('.color-manager-row').nth(6).locator('.color-manager-remove').click();
    await lastRow.locator('.color-manager-name').fill('Coral');
    await lastRow.locator('.color-manager-color').evaluate((el) => {
      el.value = '#ff7f50';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#btn-color-manager-ok');
    await expect(page.locator('#color-manager-dialog')).toBeHidden();
    await expect(page.locator('#color-swatches .color-swatch[data-color="#FF7F50"]')).toHaveCount(1);

    // Reload and reopen the project; the project-scoped ink survives.
    await page.reload();
    await page.waitForFunction(() => window.__appReady === true, null, { timeout: 10000 });
    await expect(page.locator('#project-dialog')).toBeVisible();
    await page.click('.project-entry');
    await page.click('#btn-open-project');
    await expect(page.locator('#main-app')).toBeVisible();

    await expect(page.locator('#color-swatches .color-swatch[data-color="#FF7F50"]')).toHaveCount(1);
  });

  test('palette stays visible after picking an ink on a selected layer', async ({ page }) => {
    await createProject(page, 'Ink Pick');
    await addImage(page, TEST_IMAGE);
    const layerId = await page.evaluate(() => State.layers[0].id);
    await page.evaluate((id) => { State.selectedId = id; UI.refreshProperties(); }, layerId);

    await page.locator('.color-swatch[data-color="#f65058"]').click();
    await expect(page.locator('#color-swatches .color-swatch[data-color="#f65058"].selected')).toHaveCount(1);

    const info = await paletteVisible(page);
    expect(info.visible).toBe(true);
  });
});
