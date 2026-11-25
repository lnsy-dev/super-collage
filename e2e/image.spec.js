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

  test('size slider reaches the new minimum (1) for dot screens', async ({ page }) => {
    await createProject(page, 'Halftone Min Size Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.halftone-opt[data-halftone="grunge"]');
    await page.fill('#prop-halftone-size', '1');
    await page.keyboard.press('Tab');

    expect(await page.locator('#prop-halftone-size').getAttribute('min')).toBe('1');
    const size = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].halftoneSize;
    });
    expect(size).toBe(1);
  });

  test('smallest dot-screen cell is floored at the magazine pitch (600 dpi / 150 lpi = 4 device px)', async ({ page }) => {
    const cell = await page.evaluate(async () => {
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const layer = {
        halftoneType: 'grunge',
        halftoneSize: 1, // new slider minimum
        width: 512,      // on-page footprint in 600-dpi document px
        naturalWidth: 512,
      };
      // Knob 1 would be a 1 px cell; the magazine anchor must floor it to
      // 4 device px at 600 dpi (600/150 lpi).
      const grunge = ImageProcessor._halftoneCell(layer, 1, 512);
      layer.halftoneType = 'magazine';
      const magazine = ImageProcessor._halftoneCell(layer, 1, 512);
      return { grunge, magazine };
    });
    expect(cell.grunge).toBe(4);
    expect(cell.magazine).toBe(4);
  });

  test('magazine dots render at the floored pitch across a row', async ({ page }) => {
    // Render the real magazineDots at the floored minimum cell (4 px) over
    // a mid-gray ramp and measure the horizontal dot pitch: at angle 0 the
    // grid is axis-aligned, so dark runs must repeat every ~4 px = one
    // 150 lpi cell at 600 dpi.
    const pitch = await page.evaluate(async () => {
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const w = 256, h = 64;
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 102; // mid gray
        img.data[i * 4 + 3] = 255;
      }
      const out = ImageProcessor.magazineDots(img, w, h, 4, 0);
      const d = out.data;
      // Average spacing between dark-run starts over the rows that pass
      // through dot centers.
      const spacings = [];
      for (let y = 0; y < h; y++) {
        const starts = [];
        for (let x = 1; x < w; x++) {
          const prev = d[(y * w + x - 1) * 4];
          const cur = d[(y * w + x) * 4];
          if (prev >= 128 && cur < 128) starts.push(x);
        }
        for (let s = 1; s < starts.length; s++) spacings.push(starts[s] - starts[s - 1]);
      }
      if (!spacings.length) return 0;
      return spacings.reduce((a, s) => a + s, 0) / spacings.length;
    });
    expect(pitch).toBeGreaterThan(3);
    expect(pitch).toBeLessThan(5.5);
  });

  test('dot-screen size scales with the render ratio and keeps its on-page pitch', async ({ page }) => {
    // The scaling contract: a knob anchored to natural-resolution pixels
    // renders the same on-page pitch at any bitmap resolution, and the
    // magazine floor applies in device pixels at every resolution.
    const pitches = await page.evaluate(async () => {
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const layer = {
        halftoneType: 'grunge',
        width: 1024,     // on-page footprint in 600-dpi document px
        naturalWidth: 2048,
      };
      const onPage = (size, ratio, targetW) =>
        ImageProcessor._halftoneCell({ ...layer, halftoneSize: size }, ratio, targetW) * 1024 / targetW;
      return {
        // Knob 8: natural render (2048 px) and half-res render (1024 px)
        // must land on the same on-page pitch.
        knob8Natural: onPage(8, 1, 2048),
        knob8Half: onPage(8, 0.5, 1024),
        // Knob 1 (the new minimum): both renders floor to the magazine
        // pitch in device px, staying equal to each other.
        knob1Natural: onPage(1, 1, 2048),
        knob1Half: onPage(1, 0.5, 1024),
      };
    });
    expect(pitches.knob8Natural).toBeCloseTo(pitches.knob8Half, 6);
    expect(pitches.knob1Natural).toBeCloseTo(pitches.knob1Half, 6);
    // The lowest knob setting lands on the magazine anchor: 4 device px.
    expect(pitches.knob1Natural).toBeCloseTo(4, 6);
  });
});
