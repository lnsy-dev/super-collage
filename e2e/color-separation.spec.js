import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, reopenProject } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Color Separation Import', () => {
  test('import color separation creates single layer', async ({ page }) => {
    await createProject(page, 'Separation Test');

    // Open the File menu and click Import Color Separation
    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');

    // Playwright can set files on the hidden input directly even though it's triggered by menu
    await page.setInputFiles('#color-sep-input', TEST_IMAGE);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name')).toContainText('Sep:');
  });

  test('color separation layer has isColorSeparation flag', async ({ page }) => {
    await createProject(page, 'Separation Flag Test');

    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');
    await page.setInputFiles('#color-sep-input', TEST_IMAGE);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const isSep = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0]?.isColorSeparation;
    });
    expect(isSep).toBe(true);
  });

  test('color separation layer has multiple separationColors', async ({ page }) => {
    await createProject(page, 'Separation Colors Test');

    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');
    await page.setInputFiles('#color-sep-input', TEST_IMAGE);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const colors = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0]?.separationColors;
    });
    expect(Array.isArray(colors)).toBe(true);
    expect(colors.length).toBe(7);
  });

  test('export dialog includes separation colors', async ({ page }) => {
    await createProject(page, 'Separation Export Test');

    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');
    await page.setInputFiles('#color-sep-input', TEST_IMAGE);

    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="export"]');

    await expect(page.locator('#export-dialog')).toBeVisible();
    // The export list should contain at least one entry (the test image will map to some riso colors)
    const exportItems = page.locator('#export-color-list > div');
    await expect(exportItems).not.toHaveCount(0);
  });

  test('split color separation into per-color layers', async ({ page }) => {
    await createProject(page, 'Split Separation Test');

    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');
    await page.setInputFiles('#color-sep-input', TEST_IMAGE);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#btn-split-color-separation')).toBeVisible();

    await page.click('#btn-split-color-separation');

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(7, { timeout: 15000 });

    const layers = await page.evaluate(() => {
      // @ts-ignore
      return State.layers.map(l => ({ name: l.name, isSep: l.isColorSeparation, color: l.color }));
    });

    expect(layers.length).toBe(7);
    expect(layers.every(l => !l.isSep)).toBe(true);
    expect(layers.every(l => /^#[0-9A-Fa-f]{6}$/.test(l.color))).toBe(true);
  });

  test('masking works on color separation layer', async ({ page }) => {
    await createProject(page, 'Separation Mask Test');

    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');
    await page.setInputFiles('#color-sep-input', TEST_IMAGE);

    // Clear mask should create a mask canvas
    await page.locator('#properties-content [data-action="clear-mask"]').click();

    const hasMask = await page.evaluate(() => {
      // @ts-ignore
      return !!State.layers[0]?._maskCanvas;
    });
    expect(hasMask).toBe(true);
  });
});

test.describe('Color Separation Calibration', () => {
  /**
   * Helper: generate a calibration PNG in the browser and import it via
   * LayerManager.addColorSeparation.  The image is 64×64 with four
   * quadrants of pure colors so we can verify the decomposition LUT.
   */
  async function importCalibrationImage(page, drawFn) {
    await page.evaluate(async (drawSource) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      // eslint-disable-next-line no-eval
      const fn = eval(drawSource);
      fn(ctx);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'calibration.png', { type: 'image/png' });
      // @ts-ignore
      await LayerManager.addColorSeparation(file);
    }, drawFn.toString());
  }

  test('defaults to grayscale halftone', async ({ page }) => {
    await createProject(page, 'Halftone Default Test');
    await importCalibrationImage(page, (ctx) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 64, 64);
    });
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const ht = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0]?.halftoneType;
    });
    expect(ht).toBe('grayscale');
  });

  test('black and white image maps white to no ink', async ({ page }) => {
    await createProject(page, 'B&W Calibration Test');

    await importCalibrationImage(page, (ctx) => {
      // White background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 64, 64);
      // Black circle in center
      ctx.fillStyle = '#010101';
      ctx.beginPath();
      ctx.arc(32, 32, 20, 0, Math.PI * 2);
      ctx.fill();
    });

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const results = await page.evaluate(() => {
      // @ts-ignore
      const layer = State.layers[0];
      const plates = {};
      for (const color of layer.separationColors) {
        const canvas = layer.separationPlates.get(color);
        if (!canvas) {
          console.log('Missing plate for color:', color);
          continue;
        }
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, 64, 64).data;

        // Sample white background area (top-right corner)
        let whiteAreaSum = 0;
        for (let y = 0; y < 8; y++) {
          for (let x = 56; x < 64; x++) {
            whiteAreaSum += data[(y * 64 + x) * 4];
          }
        }

        // Sample black circle area (center)
        let blackAreaSum = 0;
        for (let y = 26; y < 38; y++) {
          for (let x = 26; x < 38; x++) {
            blackAreaSum += data[(y * 64 + x) * 4];
          }
        }

        plates[color] = {
          whiteAreaAvg: whiteAreaSum / 64,
          blackAreaAvg: blackAreaSum / 144,
        };
      }
      return plates;
    });

    // White background should have NO ink on any plate (255 = no ink)
    for (const [color, vals] of Object.entries(results)) {
      expect(vals.whiteAreaAvg, `White background should have no ${color} ink`).toBeGreaterThan(200);
    }

    // Black circle should have Black ink, minimal other ink
    expect(results['#010101'].blackAreaAvg, 'Black circle should have black ink').toBeLessThan(50);
    for (const [color, vals] of Object.entries(results)) {
      if (color !== '#010101') {
        expect(vals.blackAreaAvg, `Black circle should have no ${color} ink`).toBeGreaterThan(180);
      }
    }
  });

  test('riso color patches map to their own plates', async ({ page }) => {
    await createProject(page, 'Riso Color Calibration Test');

    // Use our 4-ink palette so each patch should map primarily to its own plate.
    await importCalibrationImage(page, (ctx) => {
      // Top-left: Black
      ctx.fillStyle = '#010101';
      ctx.fillRect(0, 0, 21, 21);
      // Top-mid: Aqua
      ctx.fillStyle = '#5ec8e5';
      ctx.fillRect(21, 0, 21, 21);
      // Top-right: Yellow
      ctx.fillStyle = '#ffe800';
      ctx.fillRect(42, 0, 22, 21);
      // Bottom-left: 50% Gray
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 21, 21, 22);
      // Bottom-mid: Fluorescent Pink
      ctx.fillStyle = '#ff48b0';
      ctx.fillRect(21, 21, 21, 22);
      // Bottom-right: White
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(42, 21, 22, 22);
    });

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const results = await page.evaluate(() => {
      // @ts-ignore
      const layer = State.layers[0];
      const getPatchAvg = (canvas, x, y, w, h) => {
        const data = canvas.getContext('2d').getImageData(x, y, w, h).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += data[i];
        return sum / (data.length / 4);
      };

      const p = (hex) => layer.separationPlates.get(hex);

      return {
        blackOnBlack:   getPatchAvg(p('#010101'), 0, 0, 21, 21),
        blackOnAqua:    getPatchAvg(p('#5ec8e5'), 0, 0, 21, 21),
        aquaOnAqua:     getPatchAvg(p('#5ec8e5'), 21, 0, 21, 21),
        aquaOnBlack:    getPatchAvg(p('#010101'), 21, 0, 21, 21),
        yellowOnYellow: getPatchAvg(p('#ffe800'), 42, 0, 22, 21),
        yellowOnBlack:  getPatchAvg(p('#010101'), 42, 0, 22, 21),
        grayOnBlack:    getPatchAvg(p('#010101'), 0, 21, 21, 22),
        pinkOnPink:     getPatchAvg(p('#ff48b0'), 21, 21, 21, 22),
        whiteOnBlack:   getPatchAvg(p('#010101'), 42, 21, 22, 22),
        whiteOnPink:    getPatchAvg(p('#ff48b0'), 42, 21, 22, 22),
      };
    });

    // 0 = full ink, 255 = no ink
    expect(results.blackOnBlack,   'Black patch → black ink').toBeLessThan(50);
    expect(results.blackOnAqua,    'Black patch → no aqua ink').toBeGreaterThan(200);
    expect(results.aquaOnAqua,     'Aqua patch → aqua ink').toBeLessThan(80);
    expect(results.aquaOnBlack,    'Aqua patch → no black ink').toBeGreaterThan(200);
    expect(results.yellowOnYellow, 'Yellow patch → yellow ink').toBeLessThan(80);
    expect(results.yellowOnBlack,  'Yellow patch → no black ink').toBeGreaterThan(200);
    expect(results.grayOnBlack,    'Gray patch → some black ink (or other color mix)').toBeLessThan(240);
    expect(results.pinkOnPink,     'Pink patch → pink ink').toBeLessThan(80);
    expect(results.whiteOnBlack,   'White patch → no black ink').toBeGreaterThan(220);
    expect(results.whiteOnPink,    'White patch → no pink ink').toBeGreaterThan(220);
  });

  test('oversized separation source survives reload without cropping', async ({ page }) => {
    test.setTimeout(60000);
    await createProject(page, 'Sep Reload Crop Test');

    // Build a 2000 × 3000 PNG — larger than the 1500 px decomposition cap, so
    // the stored blob is bigger than the layer's natural size. Left half red,
    // right half blue: a top-left crop of the oversized source would drop
    // every blue pixel from the rebuilt plates.
    const base64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 2000; c.height = 3000;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#FF0000'; ctx.fillRect(0, 0, 1000, 3000);
      ctx.fillStyle = '#0000FF'; ctx.fillRect(1000, 0, 1000, 3000);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    });
    const png = Buffer.from(base64, 'base64');

    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');
    await page.setInputFiles('#color-sep-input', {
      name: 'sep-oversized.png', mimeType: 'image/png', buffer: png,
    });
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1, { timeout: 20000 });

    const before = await sepPlateInkBounds(page);
    expect(before).not.toBeNull();
    expect(Object.keys(before).length, 'red/blue source must ink some plates').toBeGreaterThan(0);

    // Reload rehydrates every layer from the stored blob and rebuilds the
    // plates — the ink bounds must be identical afterwards.
    await reopenProject(page, 'Sep Reload Crop Test');
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1, { timeout: 20000 });
    const after = await sepPlateInkBounds(page);

    expect(after).toEqual(before);
  });
});

// Ink bounding box of every rebuilt separation plate (0 = full ink). Plates
// are grayscale-on-white, so any channel < 250 marks ink.
async function sepPlateInkBounds(page) {
  return page.evaluate(() => {
    const l = window.State.layers.find(x => x.isColorSeparation);
    if (!l || !l.separationPlates?.size) return null;
    const out = {};
    for (const [hex, plate] of l.separationPlates) {
      const d = plate.getContext('2d').getImageData(0, 0, plate.width, plate.height).data;
      let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
      for (let y = 0; y < plate.height; y += 2) {
        for (let x = 0; x < plate.width; x += 2) {
          if (d[(y * plate.width + x) * 4] < 250) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) out[hex] = { minX, maxX, minY, maxY, plateW: plate.width, plateH: plate.height };
    }
    return out;
  });
}
