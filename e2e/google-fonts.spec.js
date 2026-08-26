import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';

const SAMPLE_METADATA = ")]}'\n" + JSON.stringify({
  familyMetadataList: [
    { family: 'ABeeZee', subsets: ['latin'], category: 'SANS_SERIF', variants: ['regular', 'italic'] },
    { family: 'Zilla Slab', subsets: ['latin', 'cyrillic'], category: 'SERIF', variants: ['regular'] },
    { family: 'IBM Plex Serif', subsets: ['latin'], category: 'SERIF', variants: ['regular'] },
    { family: 'No Latin Subset', subsets: ['arabic'], category: 'SANS_SERIF', variants: ['regular'] },
  ],
});

async function setupPage(page, { mock = true } = {}) {
  await clearIndexedDB(page);
  if (mock) {
    await page.route('**/fonts.google.com/metadata/fonts*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: SAMPLE_METADATA }));
  }
  await createProject(page, 'Font Test');
}

test.describe('Google Fonts in font selector', () => {
  test('font select is populated from the Google Fonts metadata API', async ({ page }) => {
    await setupPage(page);

    const select = page.locator('#prop-text-font');
    await expect(select).toBeAttached();

    // Wait for background population.
    await expect(page.locator('#prop-text-font optgroup[label="Google Fonts"] option')).toHaveCount(2);

    const options = await page.evaluate(() => {
      const sel = document.getElementById('prop-text-font');
      return {
        bundledStillThere: [...sel.options].some(o => o.value === 'IBM Plex Serif' && !o.closest('optgroup')),
        googleFamilies: [...sel.querySelectorAll('optgroup[label="Google Fonts"] option')].map(o => o.value),
      };
    });
    // Bundled fonts remain at the top level.
    expect(options.bundledStillThere).toBe(true);
    // Latin-subset Google families are listed alphabetically…
    expect(options.googleFamilies).toEqual(['ABeeZee', 'Zilla Slab']);
    // …already-bundled families are not duplicated…
    expect(options.googleFamilies).not.toContain('IBM Plex Serif');
    // …and non-latin families are skipped.
    expect(options.googleFamilies).not.toContain('No Latin Subset');
  });

  test('selecting a Google font sets the layer font family', async ({ page }) => {
    await setupPage(page);

    // Add a text layer so properties panel shows font controls.
    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible();
    await editor.fill('Hello');
    await page.keyboard.press('Escape');
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text/ })).toBeVisible();

    await page.selectOption('#prop-text-font', 'Zilla Slab');

    const family = await page.evaluate(() => {
      return window.State.layers.find(l => l.isText)?.textFontFamily;
    });
    expect(family).toBe('Zilla Slab');
  });

  test('bundled fonts still work when the metadata API is unreachable', async ({ page }) => {
    await setupPage(page, { mock: false });
    // Block the request entirely to simulate being offline.
    await page.route('**/fonts.google.com/metadata/fonts*', route => route.abort());

    const options = await page.evaluate(() => {
      const sel = document.getElementById('prop-text-font');
      return [...sel.options].map(o => o.value);
    });
    expect(options).toContain('IBM Plex Serif');
    expect(options.length).toBeGreaterThan(5);
  });
});
