import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clearIndexedDB, createProject, addTextLayer } from './helpers.js';

const SAMPLE_CATALOG = [
  {
    id: 'zee', family: 'Zee', subsets: ['latin'], weights: [400],
    styles: ['normal'], category: 'sans-serif',
  },
  {
    id: 'abeezee', family: 'ABeeZee', subsets: ['latin'], weights: [400, 700],
    styles: ['normal', 'italic'], category: 'sans-serif',
  },
  {
    id: 'zilla-slab', family: 'Zilla Slab', subsets: ['latin', 'cyrillic'],
    weights: [300, 400, 700], styles: ['normal', 'italic'], category: 'serif',
  },
  {
    id: 'no-latin', family: 'No Latin Subset', subsets: ['arabic'], weights: [400],
    styles: ['normal'], category: 'sans-serif',
  },
];

/**
 * A real WOFF (taken from the bundled face) stands in for the jsDelivr
 * @fontsource file, so the whole resolve → opentype → rasterize path runs
 * offline. Requests are recorded so we can assert which file was asked for.
 */
const STUB_WOFF = readFileSync(new URL(
  '../vendor/type-set/fonts/ibm-plex-sans-latin-400-normal.woff', import.meta.url));

async function setupPage(page, { mockCatalog = true, mockFiles = true } = {}) {
  await clearIndexedDB(page);
  const requested = [];
  if (mockCatalog) {
    await page.route('**/api.fontsource.org/v1/fonts*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATALOG) }));
  }
  if (mockFiles) {
    await page.route('**/cdn.jsdelivr.net/**', route => {
      requested.push(route.request().url());
      // Only Zilla Slab 400 upright exists; every other file 404s, so the
      // nearest-weight fallback and the offline fallback are exercised too.
      if (!/zilla-slab-latin-400-normal\.woff$/.test(route.request().url())) {
        return route.fulfill({ status: 404, body: '' });
      }
      return route.fulfill({ status: 200, contentType: 'font/woff', body: STUB_WOFF });
    });
  }
  await createProject(page, 'Font Test');
  return requested;
}

/** Wait for the (background) catalogue fetch to reach the picker. */
async function waitForCatalog(page) {
  await expect(page.locator('#prop-text-font optgroup[data-source="google"] option')).toHaveCount(3);
}

/** Open the font picker popup (needs a text layer so the panel is visible). */
async function openPicker(page) {
  await waitForCatalog(page);
  await page.click('#font-picker-button');
  await expect(page.locator('#font-picker-pop')).toBeVisible();
}

async function pickFont(page, family) {
  await openPicker(page);
  await page.fill('#font-picker-search', family);
  await page.locator('#font-picker-list .font-picker-row').first().click();
}

test.describe('Google Fonts in the font picker', () => {
  test('the picker lists bundled and Google families, each with a preview row', async ({ page }) => {
    await setupPage(page);
    await addTextLayer(page, 'Hello');
    await openPicker(page);

    const rows = page.locator('#font-picker-list .font-picker-row');
    // Bundled families plus the three latin Google ones ("No Latin Subset" is
    // filtered out, and "IBM Plex Serif" is already bundled).
    await expect(rows).toHaveCount(13);

    const titles = await rows.evaluateAll(els => els.map(e => e.dataset.family));
    expect(titles.slice(0, 2)).toEqual(['IBM Plex Serif', 'IBM Plex Sans']);
    expect(titles).toContain('ABeeZee');
    expect(titles).toContain('Zilla Slab');
    expect(titles).not.toContain('No Latin Subset');
    expect(titles.filter(t => t === 'IBM Plex Serif')).toHaveLength(1);

    // The hidden <select> still mirrors the list for the rest of the app.
    const selectState = await page.evaluate(() => {
      const sel = document.getElementById('prop-text-font');
      const group = sel.querySelector('optgroup[data-source="google"]');
      return {
        hidden: sel.classList.contains('visually-hidden'),
        bundled: sel.options.length - group.children.length,
        google: [...group.children].map(o => o.value),
      };
    });
    expect(selectState.hidden).toBe(true);
    expect(selectState.bundled).toBe(10);
    expect(selectState.google).toEqual(['ABeeZee', 'Zee', 'Zilla Slab']);
  });

  test('fuzzy search narrows the list and picks a font with the keyboard', async ({ page }) => {
    await setupPage(page);
    await addTextLayer(page, 'Hello');

    await openPicker(page);
    // Subsequence match, not a prefix: "zsl" → Zilla Slab, "abz" → ABeeZee.
    await page.fill('#font-picker-search', 'zsl');
    await expect(page.locator('#font-picker-list .font-picker-row')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.locator('#font-picker-pop')).toBeHidden();

    const state = await page.evaluate(() => ({
      family: window.State.layers.find(l => l.isText)?.textFontFamily,
      button: document.getElementById('font-picker-label').textContent,
    }));
    expect(state.family).toBe('Zilla Slab');
    expect(state.button).toBe('Zilla Slab');

    // The variant dropdown lists the weights the family actually publishes.
    const variants = await page.locator('#prop-text-variant option').allTextContents();
    expect(variants).toEqual([
      '300 – Light', '400 – Regular', '700 – Bold',
      '300 – Light Italic', '400 – Regular Italic', '700 – Bold Italic',
    ]);
  });

  test('a Google font is fetched and used to rasterize the text layer', async ({ page }) => {
    const requested = await setupPage(page);
    await addTextLayer(page, 'Hello');

    await pickFont(page, 'Zilla Slab');
    await expect.poll(
      () => page.evaluate(() => window.State.layers.find(l => l.isText)?.textFontFamily)
    ).toBe('Zilla Slab');

    // The mirror file for the family/weight was requested…
    await expect.poll(() => requested.filter(u => /zilla-slab-latin-400-normal\.woff$/.test(u)).length)
      .toBeGreaterThan(0);

    // …registered as a CSS face…
    await expect.poll(() => page.evaluate(() => document.fonts.check('16px "Zilla Slab"')))
      .toBe(true);

    // …and the layer actually rasterized glyphs with it.
    await expect.poll(() => page.evaluate(async () => {
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const layer = window.State.layers.find(l => l.isText);
      const canvas = await ImageProcessor.processTextLayer(layer, false);
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let ink = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) ink++;
      return ink;
    }), { timeout: 10000 }).toBeGreaterThan(20);
  });

  test('a weight with no published file falls back to the nearest one', async ({ page }) => {
    // The stub mirror only publishes Zilla Slab 400 upright, so a 700 layer
    // must shape with the 400 file instead of dropping the text.
    await setupPage(page);
    await addTextLayer(page, 'Hello');
    await pickFont(page, 'Zilla Slab');
    await page.selectOption('#prop-text-variant', '700:normal');

    const info = await page.evaluate(async () => {
      const { resolveRenderFont } = await import('/src/app/google-fonts.js');
      return resolveRenderFont('Zilla Slab', 700, 'normal');
    });
    expect(info.family).toBe('Zilla Slab');
    expect(info.weight).toBe(400);
  });

  test('bundled fonts still work when the catalogue is unreachable', async ({ page }) => {
    await setupPage(page, { mockCatalog: false });
    // Block the request entirely to simulate being offline.
    await page.route('**/api.fontsource.org/v1/fonts*', route => route.abort());

    const options = await page.evaluate(() => {
      const sel = document.getElementById('prop-text-font');
      return [...sel.options].map(o => o.value);
    });
    expect(options).toContain('IBM Plex Serif');
    expect(options.length).toBeGreaterThan(5);
  });

  test('an unreachable font file falls back to a bundled face instead of blank text', async ({ page }) => {
    await setupPage(page, { mockFiles: false });
    await addTextLayer(page, 'Hello');
    await pickFont(page, 'ABeeZee');

    const ink = await page.evaluate(async () => {
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const layer = window.State.layers.find(l => l.isText);
      const canvas = await ImageProcessor.processTextLayer(layer, false);
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let inked = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) inked++;
      return inked;
    });
    expect(ink).toBeGreaterThan(20);
  });
});
