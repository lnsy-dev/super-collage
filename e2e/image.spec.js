import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Image Processing', () => {
  test('adjust brightness slider', async ({ page }) => {
    await createProject(page, 'Brightness Test');
    await addImage(page, TEST_IMAGE);

    await page.fill('#prop-brightness', '50');
    await page.keyboard.press('Tab');

    const brightness = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].brightness;
    });
    expect(brightness).toBe(50);
    await expect(page.locator('#val-brightness')).toHaveText('50');
  });

  test('adjust contrast slider', async ({ page }) => {
    await createProject(page, 'Contrast Test');
    await addImage(page, TEST_IMAGE);

    await page.fill('#prop-contrast', '-30');
    await page.keyboard.press('Tab');

    const contrast = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].contrast;
    });
    expect(contrast).toBe(-30);
    await expect(page.locator('#val-contrast')).toHaveText('-30');
  });

  test('invert image colors', async ({ page }) => {
    await createProject(page, 'Invert Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#btn-invert-image');

    const inverted = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].invert;
    });
    expect(inverted).toBe(true);
    await expect(page.locator('#btn-invert-image')).toHaveClass(/active/);

    // Toggle off
    await page.click('#btn-invert-image');
    const invertedOff = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].invert;
    });
    expect(invertedOff).toBe(false);
  });
});

test.describe('Halftone', () => {
  test('set halftone to grayscale', async ({ page }) => {
    await createProject(page, 'Halftone Gray Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.halftone-opt[data-halftone="grayscale"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].halftoneType;
    });
    expect(type).toBe('grayscale');
  });

  test('set halftone to dither', async ({ page }) => {
    await createProject(page, 'Halftone Dither Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.halftone-opt[data-halftone="dither"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].halftoneType;
    });
    expect(type).toBe('dither');
  });

  test('set halftone to magazine dots', async ({ page }) => {
    await createProject(page, 'Halftone Dots Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.halftone-opt[data-halftone="magazine"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].halftoneType;
    });
    expect(type).toBe('magazine');
  });

  test('set halftone to grunge dots', async ({ page }) => {
    await createProject(page, 'Halftone Grunge Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.halftone-opt[data-halftone="grunge"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].halftoneType;
    });
    expect(type).toBe('grunge');
  });

  test('grunge dithering responds smoothly across a gradient (no banding steps)', async ({ page }) => {
    // Run the real grungeDots over a synthetic horizontal white→black ramp
    // and measure inked-pixel fraction per source-darkness stripe. Output is
    // deterministic (seeded PRNG), so bounds are stable.
    const stripes = await page.evaluate(async () => {
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const w = 1024, h = 256;
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const g = Math.round(255 * x / (w - 1)); // 255 (white) → 0 (black)
          img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
          img.data[i + 3] = 255;
        }
      }
      const out = ImageProcessor.grungeDots(img, w, h, 8, 45);
      const d = out.data;
      const S = 64; // stripe width → 16 stripes spanning darkness 0..1
      const res = [];
      for (let s = 0; s < w / S; s++) {
        let inked = 0, tot = 0;
        for (let y = 0; y < h; y++) {
          for (let x = s * S; x < (s + 1) * S; x++) {
            const i = (y * w + x) * 4;
            tot++;
            if (d[i] < 128) inked++;
          }
        }
        res.push({ ink: inked / tot, darkness: 1 - (s * S + S / 2) / (w - 1) });
      }
      return res;
    });

    // 1. Tone follows the source as a straight ramp (below the saturation
    //    plateau at darkness ≥0.95, where dots merge by design): least-squares
    //    fit of ink vs darkness must have a solid positive slope and every
    //    stripe must sit close to the line. Curvature/cliffs (the old
    //    quadratic response) blow the residuals up several-fold.
    const toneStripes = stripes.filter(s => s.darkness <= 0.91);
    const n = toneStripes.length;
    const sumX = toneStripes.reduce((a, s) => a + s.darkness, 0);
    const sumY = toneStripes.reduce((a, s) => a + s.ink, 0);
    const sumXX = toneStripes.reduce((a, s) => a + s.darkness * s.darkness, 0);
    const sumXY = toneStripes.reduce((a, s) => a + s.darkness * s.ink, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    expect(slope).toBeGreaterThan(0.4);
    for (const s of toneStripes) {
      expect(Math.abs(s.ink - (slope * s.darkness + intercept))).toBeLessThan(0.06);
    }

    // 2. No dead zone: every stripe with real tone (darkness ≥ 0.15) has
    //    visible ink — the old hard cutoffs left highlights empty.
    for (const st of stripes) {
      if (st.darkness >= 0.15) expect(st.ink).toBeGreaterThan(0.02);
    }

    // 3. Smooth tone response: dot area must track darkness linearly, so the
    //    mean ink increment per darkness step in the lower-mid half of the
    //    band matches the upper-mid half (measured ≈0.72 for the area-linear
    //    response; the old radius-linear/quadratic response measured ≈2.3,
    //    which read as tone cliffs — banding).
    const mids = stripes.filter(s => s.darkness >= 0.19 && s.darkness <= 0.91);
    const half = Math.floor(mids.length / 2);
    const inc = arr => (arr[arr.length - 1].ink - arr[0].ink) / (arr.length - 1);
    const lowInc = inc(mids.slice(0, half + 1));
    const highInc = inc(mids.slice(half));
    const ratio = highInc / lowInc;
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(1.55);
  });

  test('adjust halftone size', async ({ page }) => {
    await createProject(page, 'Halftone Size Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.halftone-opt[data-halftone="dither"]');
    await page.fill('#prop-halftone-size', '16');
    await page.keyboard.press('Tab');

    const size = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].halftoneSize;
    });
    expect(size).toBe(16);
  });

  test('adjust halftone angle', async ({ page }) => {
    await createProject(page, 'Halftone Angle Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.halftone-opt[data-halftone="magazine"]');
    await page.fill('#prop-halftone-angle', '90');
    await page.keyboard.press('Tab');

    const angle = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].halftoneAngle;
    });
    expect(angle).toBe(90);
  });
});
