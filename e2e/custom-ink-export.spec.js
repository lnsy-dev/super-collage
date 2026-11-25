import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addSolidColorImage, addImageFromBuffer,
  createSolidPngBuffer, setLayerColorDirect,
} from './helpers.js';

const YELLOW = '#ffe800';
const AQUA = '#5ec8e5';
const BLUE = '#0078bf';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

// Install the factory palette plus custom mixed inks into the running app.
// A custom ink carries the recipe the ink mixer saves with it; passing
// `inks: null` models a legacy saved ink that predates stored recipes.
async function setPalette(page, customs) {
  await page.evaluate(async customs => {
    const { DEFAULT_RISO_COLORS, setRisoColors } = await import('/src/app/constants.js');
    const { rebuildColorSepLut } = await import('/src/app/color-lut.js');
    const { UI } = await import('/src/app/ui.js');
    setRisoColors([
      ...DEFAULT_RISO_COLORS.map(c => ({ ...c })),
      ...customs.map(c => ({ name: c.name, hex: c.hex, pantone: '', ...(c.inks ? { inks: c.inks } : {}) })),
    ]);
    rebuildColorSepLut();
    UI.refreshColorSwatches();
  }, customs);
}

// The app's own subtractive mix simulation, so a custom ink's saved hex is
// exactly the color its recipe produces on screen.
async function mixHex(page, inks) {
  return page.evaluate(async inks => {
    const { mixInks } = await import('/src/app/color-layer.js');
    return mixInks(inks);
  }, inks);
}

// Export the current layers and summarize every plate: its hex, the average
// ink density (grey — lower is denser) of printed pixels, and how many
// pixels sit within ±6 of each expected grey value (antialiased edges
// cannot pollute the counts; layer interiors are thousands of pixels).
async function exportPlateStats(page, expectedGreys) {
  return page.evaluate(async expectedGreys => {
    const { ExportEngine } = await import('/src/app/export-engine.js');
    const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
    const plates = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);
    const stats = {};
    for (const [hex, canvas] of plates.entries()) {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      let count = 0;
      const near = {};
      for (const target of expectedGreys) near[target] = 0;
      for (let i = 0; i < data.length; i += 4) {
        const g = data[i]; // R=G=B
        if (g >= 250) continue;
        sum += g;
        count++;
        for (const target of expectedGreys) {
          if (Math.abs(g - target) <= 6) near[target]++;
        }
      }
      stats[hex.toUpperCase()] = {
        avgGrey: count ? sum / count : 255,
        count,
        near,
      };
    }
    return { colors: Object.keys(stats).sort(), stats };
  }, expectedGreys);
}

// Reposition an imported layer so two layers can print side by side
// without overlapping (half-letter pages are 3300×5100 at 600 dpi).
async function moveLayer(page, index, x, y) {
  await page.evaluate(([index, x, y]) => {
    State.layers[index].x = x;
    State.layers[index].y = y;
  }, [index, x, y]);
}

// A fully-inked pixel's plate grey is 255 − alpha×coverage:
// 20% → 204, 30% → 178, 40% → 153, 10% → 229, 100% → 0.
const GREY_20 = 204;
const GREY_30 = 178;
const GREY_40 = 153;
const GREY_10 = 229;
const GREY_FULL = 0;
// The user's "Mud" repro: Black 35, Red 76, Neon Orange 36.
const BLACK = '#010101';
const RED = '#f65058';
const NEON_ORANGE = '#ff7477';
const GREY_35 = 166; // 255 − 255×0.35 ≈ 166
const GREY_76 = 61;  // 255 − 255×0.76 ≈ 61
const GREY_36 = 163; // 255 − 255×0.36 ≈ 163

// Drive the real Mix Ink dialog the way the user does: open it from the
// bucket's ink swatch, set the named coverages, save the mix into the
// palette under `name`, and close the dialog again.
async function mixInkViaUi(page, name, inks) {
  await page.click('.tool-btn[data-tool="paint-bucket"]');
  await page.click('#bucket-color-swatch');
  await expect(page.locator('#paint-bucket-dialog')).toBeVisible();
  await page.evaluate(inks => {
    const set = (hex, value) => {
      const slider = document.querySelector(`.bucket-ink-row input[data-hex="${hex}"]`);
      if (!slider) throw new Error(`no Mix Ink slider for ${hex}`);
      slider.value = value;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // Zero every slider first so the mix is exactly the requested recipe.
    for (const slider of document.querySelectorAll('.bucket-ink-row input[data-hex]')) {
      set(slider.dataset.hex, '0');
    }
    for (const [hex, value] of Object.entries(inks)) set(hex, String(value));
  }, inks);
  await page.locator('#bucket-ink-name').fill(name);
  await page.click('#btn-bucket-save-mix');
  // Save Ink Mix saves the mix into the palette and closes the dialog.
  await expect(page.locator(`#color-swatches .color-swatch[title="${name}"]`)).toHaveCount(1);
  await expect(page.locator('#paint-bucket-dialog')).toBeHidden();
}

// Fill the whole page with the bucket's current mixed ink (the mixer's
// active recipe), as the user's fill does, and wait for the Color Layer.
async function paintBucketFullPage(page) {
  await page.evaluate(() => window.BucketTool.fillEntireLayer());
  await page.waitForFunction(() => {
    const l = window.State.layers.find(l => l.name === 'Color Layer');
    return !!l && !!l._processedCanvas;
  });
}

// Open the Export Plates dialog and read its plate list once populated.
async function exportDialogPlateList(page) {
  await page.click('.menu-item[data-menu="file"]');
  await page.click('[data-action="export"]');
  await expect(page.locator('#export-dialog')).toBeVisible();
  await page.waitForFunction(() => {
    const el = document.getElementById('export-color-list');
    return !!el && el.textContent.length > 0;
  });
  return page.locator('#export-color-list').innerText();
}

test.describe('Custom ink export', () => {
  test('a saved custom ink exports as its component inks at their densities', async ({ page }) => {
    await createProject(page, 'Custom Ink Layers', { pageSize: 'half-letter' });
    const hex = await mixHex(page, [
      { hex: YELLOW, amount: 20 },
      { hex: AQUA, amount: 30 },
    ]);
    await setPalette(page, [
      { name: 'Custom Green', hex, inks: { [YELLOW]: 20, [AQUA]: 30 } },
    ]);
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async customHex => {
      const layer = State.layers[0];
      layer.color = customHex; // painted with the palette's custom ink swatch
      layer.colorMode = 'solid';
      delete layer.mixedInks; // swatch-painted layers carry no recipe record
      layer._dirty = true;
    }, hex).then(() => exportPlateStats(page, [GREY_20, GREY_30]));

    // The risograph has no drum for the mixed color: exactly the two
    // component plates, no plate for the custom ink itself.
    expect(result.colors).toEqual([AQUA.toUpperCase(), YELLOW.toUpperCase()]);

    // Yellow prints at 20% density (lighter), aqua at 30% (denser).
    expect(result.stats[YELLOW.toUpperCase()].near[GREY_20]).toBeGreaterThan(1000);
    expect(result.stats[AQUA.toUpperCase()].near[GREY_30]).toBeGreaterThan(1000);
    expect(result.stats[YELLOW.toUpperCase()].avgGrey).toBeGreaterThan(result.stats[AQUA.toUpperCase()].avgGrey);
  });

  test('a plain ink layer folds into the custom ink\'s component plate', async ({ page }) => {
    await createProject(page, 'Custom Ink Fold', { pageSize: 'half-letter' });
    const hex = await mixHex(page, [
      { hex: YELLOW, amount: 20 },
      { hex: AQUA, amount: 30 },
    ]);
    await setPalette(page, [
      { name: 'Custom Green', hex, inks: { [YELLOW]: 20, [AQUA]: 30 } },
    ]);
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 800, 800), { name: 'plain.png' });
    await moveLayer(page, 0, 100, 100);
    await moveLayer(page, 1, 1600, 100);

    const result = await page.evaluate(async customHex => {
      // Layer 0: painted with the custom ink. Layer 1: plain factory aqua.
      const [customLayer, plainLayer] = State.layers;
      customLayer.color = customHex;
      customLayer.colorMode = 'solid';
      delete customLayer.mixedInks;
      plainLayer.color = '#5ec8e5';
      plainLayer.colorMode = 'solid';
      delete plainLayer.mixedInks;
      State.layers.forEach(l => { l._dirty = true; });
    }, hex).then(() => exportPlateStats(page, [GREY_20, GREY_30, GREY_FULL]));

    // One aqua plate serves both the plain aqua layer and the custom
    // ink's aqua component — no duplicate cyan layer.
    expect(result.colors).toEqual([AQUA.toUpperCase(), YELLOW.toUpperCase()]);

    const aqua = result.stats[AQUA.toUpperCase()];
    expect(aqua.near[GREY_FULL]).toBeGreaterThan(1000);  // plain aqua layer
    expect(aqua.near[GREY_30]).toBeGreaterThan(1000);    // custom ink's 30% aqua
    expect(result.stats[YELLOW.toUpperCase()].near[GREY_20]).toBeGreaterThan(1000);
  });

  test('zero-coverage components are dropped from the recipe', async ({ page }) => {
    await createProject(page, 'Custom Ink Zero', { pageSize: 'half-letter' });
    const hex = await mixHex(page, [
      { hex: YELLOW, amount: 20 },
      { hex: AQUA, amount: 30 },
      { hex: BLUE, amount: 0 },
    ]);
    await setPalette(page, [
      { name: 'Custom Green', hex, inks: { [YELLOW]: 20, [AQUA]: 30, [BLUE]: 0 } },
    ]);
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async customHex => {
      const layer = State.layers[0];
      layer.color = customHex;
      layer.colorMode = 'solid';
      delete layer.mixedInks;
      layer._dirty = true;
    }, hex).then(() => exportPlateStats(page, [GREY_20, GREY_30]));

    expect(result.colors).toEqual([AQUA.toUpperCase(), YELLOW.toUpperCase()]);
    expect(result.stats[YELLOW.toUpperCase()].near[GREY_20]).toBeGreaterThan(1000);
    expect(result.stats[AQUA.toUpperCase()].near[GREY_30]).toBeGreaterThan(1000);
  });

  test('a custom ink with a factory ink\'s hex stays a single full-density plate', async ({ page }) => {
    await createProject(page, 'Custom Ink Plain', { pageSize: 'half-letter' });
    await setPalette(page, [
      // Saved from the mixer at 100% aqua: the same hex the drum prints.
      { name: 'My Aqua', hex: AQUA, inks: { [AQUA]: 100 } },
    ]);
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async customHex => {
      const layer = State.layers[0];
      layer.color = customHex;
      layer.colorMode = 'solid';
      delete layer.mixedInks;
      layer._dirty = true;
    }, AQUA).then(() => exportPlateStats(page, [GREY_FULL]));

    expect(result.colors).toEqual([AQUA.toUpperCase()]);
    expect(result.stats[AQUA.toUpperCase()].near[GREY_FULL]).toBeGreaterThan(1000);
  });

  test('two custom inks sharing a component fold into shared plates', async ({ page }) => {
    await createProject(page, 'Custom Inks Share', { pageSize: 'half-letter' });
    const greenHex = await mixHex(page, [
      { hex: YELLOW, amount: 20 },
      { hex: AQUA, amount: 30 },
    ]);
    const tealHex = await mixHex(page, [
      { hex: YELLOW, amount: 10 },
      { hex: BLUE, amount: 40 },
    ]);
    await setPalette(page, [
      { name: 'Custom Green', hex: greenHex, inks: { [YELLOW]: 20, [AQUA]: 30 } },
      { name: 'Custom Teal', hex: tealHex, inks: { [YELLOW]: 10, [BLUE]: 40 } },
    ]);
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 800, 800), { name: 'teal.png' });
    await moveLayer(page, 0, 100, 100);
    await moveLayer(page, 1, 1600, 100);

    const result = await page.evaluate(([greenHex, tealHex]) => {
      const [greenLayer, tealLayer] = State.layers;
      greenLayer.color = greenHex;
      greenLayer.colorMode = 'solid';
      delete greenLayer.mixedInks;
      tealLayer.color = tealHex;
      tealLayer.colorMode = 'solid';
      delete tealLayer.mixedInks;
      State.layers.forEach(l => { l._dirty = true; });
    }, [greenHex, tealHex]).then(() =>
      exportPlateStats(page, [GREY_20, GREY_30, GREY_40, GREY_10]));

    // Three physical inks: yellow serves both custom mixes. (Sorted by hex.)
    expect(result.colors).toEqual([BLUE.toUpperCase(), AQUA.toUpperCase(), YELLOW.toUpperCase()]);

    // The shared yellow plate carries both densities: 20% (green) and 10% (teal).
    const yellow = result.stats[YELLOW.toUpperCase()];
    expect(yellow.near[GREY_20]).toBeGreaterThan(1000);
    expect(yellow.near[GREY_10]).toBeGreaterThan(1000);
    expect(result.stats[AQUA.toUpperCase()].near[GREY_30]).toBeGreaterThan(1000);
    expect(result.stats[BLUE.toUpperCase()].near[GREY_40]).toBeGreaterThan(1000);
  });

  test('a bucket-fill recipe referencing a custom ink resolves to components', async ({ page }) => {
    await createProject(page, 'Custom Ink Recipe', { pageSize: 'half-letter' });
    const hex = await mixHex(page, [
      { hex: YELLOW, amount: 20 },
      { hex: AQUA, amount: 30 },
    ]);
    await setPalette(page, [
      { name: 'Custom Green', hex, inks: { [YELLOW]: 20, [AQUA]: 30 } },
    ]);
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async customHex => {
      // Color Layers filled with the custom ink store the ink hex in
      // mixedInks (the mixer slider was set to the saved ink itself).
      const layer = State.layers[0];
      layer.color = customHex;
      layer.colorMode = 'solid';
      layer.mixedInks = { [customHex]: 100 };
      layer._dirty = true;
    }, hex).then(() => exportPlateStats(page, [GREY_20, GREY_30]));

    expect(result.colors).toEqual([AQUA.toUpperCase(), YELLOW.toUpperCase()]);
    expect(result.stats[YELLOW.toUpperCase()].near[GREY_20]).toBeGreaterThan(1000);
    expect(result.stats[AQUA.toUpperCase()].near[GREY_30]).toBeGreaterThan(1000);
  });

  test('a legacy custom ink decomposes when exactly reproducible and keeps its plate otherwise', async ({ page }) => {
    await createProject(page, 'Custom Ink Legacy', { pageSize: 'half-letter' });
    // The spot color is picked by the app's own fitter: the first candidate
    // no exact factory-ink mix reproduces (so it must keep its own plate).
    const { greenHex, spotHex } = await page.evaluate(async () => {
      const { mixInks, fitInksToColor } = await import('/src/app/color-layer.js');
      const { DEFAULT_RISO_COLORS } = await import('/src/app/constants.js');
      const greenHex = mixInks([
        { hex: '#ffe800', amount: 20 },
        { hex: '#5ec8e5', amount: 30 },
      ]);
      let spotHex = null;
      for (let i = 0; i < 5000 && !spotHex; i++) {
        const candidate = '#' + ((0x100000 + i * 7919) % 0xffffff).toString(16).padStart(6, '0');
        const fit = fitInksToColor(candidate, DEFAULT_RISO_COLORS);
        if (fit.hex.toUpperCase() !== candidate.toUpperCase()) spotHex = candidate;
      }
      return { greenHex, spotHex };
    });
    await setPalette(page, [
      // Saved before recipes were stored with palette colors.
      { name: 'Legacy Green', hex: greenHex, inks: null },
      // A spot color no factory-ink mix reproduces exactly.
      { name: 'Spot Color', hex: spotHex, inks: null },
    ]);
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 800, 800), { name: 'spot.png' });
    await moveLayer(page, 0, 100, 100);
    await moveLayer(page, 1, 1600, 100);

    const result = await page.evaluate(([greenHex, spotHex]) => {
      const [legacyLayer, spotLayer] = State.layers;
      legacyLayer.color = greenHex;
      legacyLayer.colorMode = 'solid';
      delete legacyLayer.mixedInks;
      spotLayer.color = spotHex;
      spotLayer.colorMode = 'solid';
      delete spotLayer.mixedInks;
      State.layers.forEach(l => { l._dirty = true; });
    }, [greenHex, spotHex]).then(() => exportPlateStats(page, [GREY_20, GREY_30, GREY_FULL]));

    // The reproducible legacy ink splits into its fitted factory mix; the
    // spot color keeps its own plate (fitted mixes must be exact).
    expect(result.colors).toEqual([spotHex.toUpperCase(), AQUA.toUpperCase(), YELLOW.toUpperCase()].sort());
    expect(result.stats[YELLOW.toUpperCase()].near[GREY_20]).toBeGreaterThan(1000);
    expect(result.stats[AQUA.toUpperCase()].near[GREY_30]).toBeGreaterThan(1000);
    expect(result.stats[spotHex.toUpperCase()].near[GREY_FULL]).toBeGreaterThan(1000);
  });

  test('a shape painted with a custom ink exports its component densities', async ({ page }) => {
    await createProject(page, 'Custom Ink Shape', { pageSize: 'half-letter' });
    const hex = await mixHex(page, [
      { hex: YELLOW, amount: 20 },
      { hex: AQUA, amount: 30 },
    ]);
    await setPalette(page, [
      { name: 'Custom Green', hex, inks: { [YELLOW]: 20, [AQUA]: 30 } },
    ]);

    const result = await page.evaluate(async customHex => {
      // A fill-only rectangle, colored with the custom ink the way a
      // palette-swatch click colors it (fill color + layer color, no recipe).
      const { LayerManager } = await import('/src/app/layer-manager.js');
      State.tool = 'shape-rect'; // addShape derives the shape type from the tool
      await LayerManager.addShape({ shapeHasFill: true, shapeHasStroke: false }, 200, 200, 600, 400);
      const layer = State.layers[0];
      layer.shapeFillColor = customHex;
      layer.color = customHex;
      layer._dirty = true;
    }, hex).then(() => exportPlateStats(page, [GREY_20, GREY_30]));

    expect(result.colors).toEqual([AQUA.toUpperCase(), YELLOW.toUpperCase()]);
    expect(result.stats[YELLOW.toUpperCase()].near[GREY_20]).toBeGreaterThan(500);
    expect(result.stats[AQUA.toUpperCase()].near[GREY_30]).toBeGreaterThan(500);
  });

  // ── Inks created through the Mix Ink view (the user's real flow) ──

  test('a Mix Ink-saved recipe ink exports as its component inks at their densities', async ({ page }) => {
    // The user's exact repro: mix Black 35, Red 76 and Neon Orange 36 in
    // the Mix Ink view, save it as 'Mud', paint with it, and Export Plates
    // must produce the three component plates — not a plate for Mud.
    await createProject(page, 'Mud Plates', { pageSize: 'half-letter' });
    await mixInkViaUi(page, 'Mud', { [BLACK]: 35, [RED]: 76, [NEON_ORANGE]: 36 });
    await paintBucketFullPage(page);

    const result = await exportPlateStats(page, [GREY_35, GREY_76, GREY_36]);

    expect(result.colors).toEqual([BLACK, NEON_ORANGE.toUpperCase(), RED.toUpperCase()].sort());
    expect(result.stats[BLACK].near[GREY_35]).toBeGreaterThan(1000);
    expect(result.stats[RED.toUpperCase()].near[GREY_76]).toBeGreaterThan(1000);
    expect(result.stats[NEON_ORANGE.toUpperCase()].near[GREY_36]).toBeGreaterThan(1000);
  });

  test('the Export Plates dialog lists a Mix Ink recipe ink as its component plates', async ({ page }) => {
    // The dialog's plate preview must mirror what the export produces: the
    // component inks, one entry each — never a single entry for the mix.
    await createProject(page, 'Mud Dialog', { pageSize: 'half-letter' });
    await mixInkViaUi(page, 'Mud', { [BLACK]: 35, [RED]: 76, [NEON_ORANGE]: 36 });
    await paintBucketFullPage(page);

    const list = await exportDialogPlateList(page);

    expect(list).toContain('Black');
    expect(list).toContain('Red');
    expect(list).toContain('Neon Orange');
    expect(list).not.toContain('Mud');
  });

  test('a two-component Mix Ink recipe ink exports as its two component plates', async ({ page }) => {
    await createProject(page, 'Mix Ink Two', { pageSize: 'half-letter' });
    await mixInkViaUi(page, 'Custom Green', { [YELLOW]: 20, [AQUA]: 30 });
    await paintBucketFullPage(page);

    const result = await exportPlateStats(page, [GREY_20, GREY_30]);

    expect(result.colors).toEqual([AQUA.toUpperCase(), YELLOW.toUpperCase()]);
    expect(result.stats[YELLOW.toUpperCase()].near[GREY_20]).toBeGreaterThan(1000);
    expect(result.stats[AQUA.toUpperCase()].near[GREY_30]).toBeGreaterThan(1000);
  });

  test('a recipe ink whose components include another custom ink resolves recursively', async ({ page }) => {
    await createProject(page, 'Custom Ink Nested', { pageSize: 'half-letter' });
    const greenHex = await mixHex(page, [
      { hex: YELLOW, amount: 20 },
      { hex: AQUA, amount: 30 },
    ]);
    const deepHex = await mixHex(page, [
      { hex: YELLOW, amount: 10 },
      { hex: greenHex, amount: 50 },
    ]);
    await setPalette(page, [
      { name: 'Custom Green', hex: greenHex, inks: { [YELLOW]: 20, [AQUA]: 30 } },
      { name: 'Deep Green', hex: deepHex, inks: { [YELLOW]: 10, [greenHex]: 50 } },
    ]);
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async customHex => {
      const layer = State.layers[0];
      layer.color = customHex;
      layer.colorMode = 'solid';
      delete layer.mixedInks;
      layer._dirty = true;
    }, deepHex).then(() => exportPlateStats(page, [206, 217]));

    // Deep Green resolves through Custom Green down to factory inks, and
    // its 10% yellow folds with the 50%×20% yellow carried by Custom Green
    // (1 − 0.9×0.9 = 19% → grey ≈ 206; aqua 50%×30% = 15% → grey ≈ 217).
    expect(result.colors).toEqual([AQUA.toUpperCase(), YELLOW.toUpperCase()]);
    expect(result.stats[YELLOW.toUpperCase()].near[206]).toBeGreaterThan(1000);
    expect(result.stats[AQUA.toUpperCase()].near[217]).toBeGreaterThan(1000);
  });

  test('a Mix Ink recipe ink layer folds into the same plate as a plain ink layer', async ({ page }) => {
    await createProject(page, 'Mud Fold', { pageSize: 'half-letter' });
    await mixInkViaUi(page, 'Mud', { [BLACK]: 35, [RED]: 76, [NEON_ORANGE]: 36 });
    await paintBucketFullPage(page);
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 800, 800), { name: 'plain.png' });
    await moveLayer(page, 1, 1600, 100);
    await setLayerColorDirect(page, RED);

    const result = await exportPlateStats(page, [GREY_35, GREY_76, GREY_36, GREY_FULL]);

    // Three physical inks; the red plate serves both the plain red layer
    // (full density) and Mud's 76% red component.
    expect(result.colors).toEqual([BLACK, NEON_ORANGE.toUpperCase(), RED.toUpperCase()].sort());
    const red = result.stats[RED.toUpperCase()];
    expect(red.near[GREY_FULL]).toBeGreaterThan(1000);  // plain red layer
    expect(red.near[GREY_76]).toBeGreaterThan(1000);    // Mud's 76% red
    expect(result.stats[BLACK].near[GREY_35]).toBeGreaterThan(1000);
    expect(result.stats[NEON_ORANGE.toUpperCase()].near[GREY_36]).toBeGreaterThan(1000);
  });
});
