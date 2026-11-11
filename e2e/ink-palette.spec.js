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

  test('+ button opens the ink mixing view and can be dismissed', async ({ page }) => {
    await createProject(page, 'Mix Ink From Palette');

    await expect(page.locator('#paint-bucket-dialog')).toBeHidden();
    await page.click('.color-swatch-add');
    await expect(page.locator('#paint-bucket-dialog')).toBeVisible();
    await expect(page.locator('#paint-bucket-dialog .dialog-title')).toHaveText('Mix Ink');
    await expect(page.locator('#color-manager-dialog')).toBeHidden();

    await page.click('#btn-bucket-done');
    await expect(page.locator('#paint-bucket-dialog')).toBeHidden();
  });

  test('ink mixing view opened from + updates the bucket swatch', async ({ page }) => {
    await createProject(page, 'Mix Ink Updates');

    await page.click('.color-swatch-add');
    await expect(page.locator('#paint-bucket-dialog')).toBeVisible();
    // Reset to a known state, then move the first ink slider to 0%.
    await page.click('#btn-bucket-reset');
    const slider = page.locator('#bucket-ink-sliders .bucket-ink-slider').first();
    await slider.evaluate((el) => {
      el.value = '0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#bucket-mix-hex')).toHaveText('#FFFFFF');
    await expect(page.locator('#bucket-color-swatch')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });

  test('Edit Colors is only available from the Colors menu', async ({ page }) => {
    await createProject(page, 'Edit Colors Menu Only');

    // Menu entry remains present.
    await page.click('.menu-item[data-menu="colors"]');
    await expect(page.locator('.menu-entry[data-action="edit-colors"]')).toBeVisible();
    await expect(page.locator('.menu-entry[data-action="edit-colors"]')).toHaveText('Edit Colors…');
    await page.click('.menu-entry[data-action="edit-colors"]');
    await expect(page.locator('#color-manager-dialog')).toBeVisible();
    await page.click('#btn-color-manager-cancel');
    await expect(page.locator('#color-manager-dialog')).toBeHidden();

    // No other Edit Colors option/entry appears outside the menu.
    const extra = await page.evaluate(() => {
      const allowed = new Set(['menu-entry']);
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const el = walker.currentNode;
        if (el.id === 'menu-bar' || el.closest('#menu-bar')) continue;
        if (el.id === 'color-manager-dialog' || el.closest('#color-manager-dialog')) continue;
        const text = (el.textContent || '').trim();
        if (text !== 'Edit Colors' && text !== 'Edit Colors…') continue;
        // Ignore containers that merely include dialog/menu text via descendants.
        if ([...el.children].some((c) => (c.textContent || '').includes('Edit Colors'))) continue;
        const cls = [...el.classList];
        if (cls.some((c) => allowed.has(c))) continue;
        hits.push({ tag: el.tagName, text, id: el.id || null, classes: cls });
      }
      return hits;
    });
    expect(extra, `unexpected Edit Colors entries outside menu: ${JSON.stringify(extra)}`).toEqual([]);
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
    await expect(page.locator('#no-selection-msg')).toBeVisible();
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
