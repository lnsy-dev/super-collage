import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addTextLayer } from './helpers.js';

/**
 * The 16 Google families vendored into the app by
 * scripts/fetch-bundled-google-fonts.mjs. Everything here must work with
 * the network unplugged: the .woff files ship with the app and opentype
 * shapes the text from them.
 */
const BUNDLED = [
  { family: 'Playfair Display', weights: [400, 700], italics: [400, 700] },
  { family: 'Bodoni Moda', weights: [400, 700, 900], italics: [400, 700] },
  { family: 'Lora', weights: [400, 500, 700], italics: [400, 500, 700] },
  { family: 'Libre Baskerville', weights: [400, 700], italics: [400] },
  { family: 'Bitter', weights: [300, 400, 700], italics: [400, 700] },
  { family: 'Inter', weights: [300, 400, 600, 700, 800], italics: [400, 700] },
  { family: 'Public Sans', weights: [400, 600, 700, 800], italics: [400, 700] },
  { family: 'Oswald', weights: [300, 500, 700], italics: [] },
  { family: 'Space Grotesk', weights: [300, 400, 500, 700], italics: [] },
  { family: 'Raleway', weights: [300, 400, 700], italics: [400, 700] },
  { family: 'Zilla Slab', weights: [300, 400, 700], italics: [400, 700] },
  { family: 'Roboto Slab', weights: [100, 300, 400, 700, 900], italics: [] },
  { family: 'Abril Fatface', weights: [400], italics: [] },
  { family: 'Anton', weights: [400], italics: [] },
  { family: 'IBM Plex Mono', weights: [400, 600, 700], italics: [400, 700] },
  { family: 'Caveat', weights: [400, 600, 700], italics: [] },
];

/** Ink coverage of the selected text layer's raster, in pixels. */
async function inkCount(page) {
  return page.evaluate(async () => {
    const { ImageProcessor } = await import('/src/app/image-processor.js');
    const layer = window.State.layers.find(l => l.isText);
    const canvas = await ImageProcessor.processTextLayer(layer, false);
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) ink++;
    return ink;
  });
}

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Bundled Google Fonts', () => {
  test('every vendored family is offered in the font list, grouped by kind', async ({ page }) => {
    await createProject(page, 'Fonts');
    await addTextLayer(page, 'Hello');

    const groups = await page.evaluate(() => {
      const sel = document.getElementById('prop-text-font');
      return [...sel.querySelectorAll('optgroup')].map(g => [g.label, [...g.children].map(o => o.value)]);
    });

    const all = groups.flatMap(([, options]) => options);
    for (const { family } of BUNDLED) expect(all).toContain(family);
    // The families that were already bundled are still there.
    expect(all).toContain('IBM Plex Serif');
    expect(all).toContain('Fira Code');
    expect(all).toHaveLength(new Set(all).size);   // no duplicates

    // Families are sorted into meaningful groups, not one flat list.
    const byGroup = Object.fromEntries(groups.map(([label, options]) => [label, options]));
    expect(byGroup.Serif).toContain('Playfair Display');
    expect(byGroup.Sans).toContain('Inter');
    expect(byGroup.Slab).toContain('Roboto Slab');
    expect(byGroup.Display).toContain('Anton');
    expect(byGroup['Mono & Script']).toContain('Caveat');
  });

  test('every vendored family has a real font file that renders text', async ({ page }) => {
    // Any request for a font that isn't served by this app would show up here.
    // (The UI's own Atkinson Hyperlegible Mono is a pre-existing webfont, and
    // the <select> needs a font stack — neither is a text-layer font.)
    const external = [];
    page.on('request', req => {
      const url = req.url();
      const layerFont = /jsdelivr|fontsource/.test(url)
        || (/fonts\.(googleapis|gstatic)\.com/.test(url) && !/atkinson/i.test(url));
      if (layerFont) external.push(url);
    });

    await createProject(page, 'Fonts Render');
    await addTextLayer(page, 'Handgloves 123');

    for (const { family } of BUNDLED) {
      await page.selectOption('#prop-text-font', family);
      await expect.poll(() => page.evaluate(() => window.State.layers.find(l => l.isText)?.textFontFamily))
        .toBe(family);
      // Shaped by opentype from the vendored .woff — real glyphs, not a fallback.
      await expect.poll(() => inkCount(page), { timeout: 15000 }).toBeGreaterThan(50);
    }
    expect(external).toEqual([]);
  });

  test('the Variant dropdown offers exactly the vendored weights and italics', async ({ page }) => {
    await createProject(page, 'Font Variants');
    await addTextLayer(page, 'Variants');

    for (const { family, weights, italics } of BUNDLED) {
      await page.selectOption('#prop-text-font', family);
      const options = await page.locator('#prop-text-variant option').evaluateAll(
        els => els.map(e => e.value)
      );
      const expected = [
        ...weights.map(w => `${w}:normal`),
        ...italics.map(w => `${w}:italic`),
      ];
      expect(options, `variants for ${family}`).toEqual(expected);
    }
  });

  test('weight and style changes re-render the layer with the right file', async ({ page }) => {
    await createProject(page, 'Font Weights');
    await addTextLayer(page, 'Hamburgefonstiv');

    await page.selectOption('#prop-text-font', 'Playfair Display');
    await page.selectOption('#prop-text-variant', '400:normal');
    const regular = await inkCount(page);

    await page.selectOption('#prop-text-variant', '700:normal');
    const bold = await inkCount(page);
    expect(bold).toBeGreaterThan(0);
    // A bolder cut of the same family has more ink — proof the 700 file was
    // loaded rather than re-using the regular one.
    expect(bold).not.toBe(regular);

    await page.selectOption('#prop-text-variant', '400:italic');
    const italic = await inkCount(page);
    expect(italic).toBeGreaterThan(0);
    expect(italic).not.toBe(regular);

    const state = await page.evaluate(() => {
      const l = window.State.layers.find(x => x.isText);
      return { family: l.textFontFamily, weight: l.textFontWeight, style: l.textFontStyle };
    });
    expect(state).toEqual({ family: 'Playfair Display', weight: 400, style: 'italic' });
  });

  test('a layer saved with a vendored family survives a reload', async ({ page }) => {
    await createProject(page, 'Font Persistence');
    await addTextLayer(page, 'Persist');
    await page.selectOption('#prop-text-font', 'Caveat');
    await page.selectOption('#prop-text-variant', '700:normal');
    await expect.poll(() => inkCount(page)).toBeGreaterThan(20);

    await page.reload();
    await page.locator('.project-entry', { hasText: 'Font Persistence' }).click();
    await page.click('#btn-open-project');
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await page.locator('#layer-list .layer-row').first().click();
    await expect(page.locator('#prop-text-font')).toHaveValue('Caveat');

    const state = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { family: l.textFontFamily, weight: l.textFontWeight, selected: document.getElementById('prop-text-font').value };
    });
    expect(state.family).toBe('Caveat');
    expect(state.weight).toBe(700);
    expect(state.selected).toBe('Caveat');
  });
});
