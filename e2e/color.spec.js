import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Color Modes', () => {
  test('select solid color swatch', async ({ page }) => {
    await createProject(page, 'Solid Color Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.color-swatch[data-color="#ff48b0"]'); // Fluorescent Pink

    const color = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].color;
    });
    expect(color).toBe('#ff48b0');
  });

  test('switch to gradient mode', async ({ page }) => {
    await createProject(page, 'Gradient Mode Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#btn-mode-gradient');

    const mode = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].colorMode;
    });
    expect(mode).toBe('gradient');
    await expect(page.locator('#gradient-editor')).toBeVisible();
  });

  test('change gradient type to radial', async ({ page }) => {
    await createProject(page, 'Gradient Radial Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#btn-mode-gradient');
    await page.click('.grad-type-btn[data-grad-type="circular"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].gradient.type;
    });
    expect(type).toBe('circular');
  });

  test('change gradient type to conic', async ({ page }) => {
    await createProject(page, 'Gradient Conic Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#btn-mode-gradient');
    await page.click('.grad-type-btn[data-grad-type="conic"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].gradient.type;
    });
    expect(type).toBe('conic');
  });

  test('change gradient type to multipolar', async ({ page }) => {
    await createProject(page, 'Gradient Multi Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#btn-mode-gradient');
    await page.click('.grad-type-btn[data-grad-type="multipolar"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].gradient.type;
    });
    expect(type).toBe('multipolar');
  });

  test('switch to pattern mode', async ({ page }) => {
    await createProject(page, 'Pattern Mode Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#btn-mode-pattern');

    const mode = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].colorMode;
    });
    expect(mode).toBe('pattern');
    await expect(page.locator('#pattern-editor')).toBeVisible();
  });

  test('change pattern type to polka dots', async ({ page }) => {
    await createProject(page, 'Pattern Polka Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#btn-mode-pattern');
    await page.click('.pat-type-btn[data-pat-type="polka"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].pattern.type;
    });
    expect(type).toBe('polka');
  });

  test('change pattern type to stars', async ({ page }) => {
    await createProject(page, 'Pattern Stars Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#btn-mode-pattern');
    await page.click('.pat-type-btn[data-pat-type="stars"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].pattern.type;
    });
    expect(type).toBe('stars');
  });

  test('change pattern colors', async ({ page }) => {
    await createProject(page, 'Pattern Colors Test');
    await addImage(page, TEST_IMAGE);

    await page.click('#btn-mode-pattern');
    await page.locator('#pat-color1-swatches .pat-color-sw[data-pat-color="#ff48b0"]').click();
    await page.locator('#pat-color2-swatches .pat-color-sw[data-pat-color="#5ec8e5"]').click();

    const colors = await page.evaluate(() => {
      // @ts-ignore
      const p = State.layers[0].pattern;
      return { c1: p.color1, c2: p.color2 };
    });
    expect(colors.c1).toBe('#ff48b0');
    expect(colors.c2).toBe('#5ec8e5');
  });

  test('pattern density is independent of output resolution', async ({ page }) => {
    await createProject(page, 'Pattern Scale Test');
    await addImage(page, TEST_IMAGE);

    const consistent = await page.evaluate(async () => {
      const mod = await import('/src/app/image-processor.js');
      const pattern = { type: 'stripes', color1: '#000000', color2: '#ffffff', size: 10, angle: 0 };
      const c1 = mod.generatePatternCanvas(100, 100, pattern, 0.5);
      const c2 = mod.generatePatternCanvas(200, 200, pattern, 1.0);
      const d1 = c1.getContext('2d').getImageData(0, 0, 100, 100).data;
      const d2 = c2.getContext('2d').getImageData(0, 0, 200, 200).data;

      function countTransitions(data, w) {
        let count = 0;
        const y = 10;
        for (let x = 1; x < w; x++) {
          const i1 = (y * w + x - 1) * 4;
          const i2 = (y * w + x) * 4;
          const g1 = data[i1] + data[i1 + 1] + data[i1 + 2];
          const g2 = data[i2] + data[i2 + 1] + data[i2 + 2];
          if ((g1 < 384) !== (g2 < 384)) count++;
        }
        return count;
      }

      const t1 = countTransitions(d1, 100);
      const t2 = countTransitions(d2, 200);
      return Math.abs(t1 - t2) <= 1;
    });
    expect(consistent).toBe(true);
  });
});
