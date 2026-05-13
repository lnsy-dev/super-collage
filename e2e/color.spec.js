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

    await page.click('.color-swatch[data-color="#E02B2B"]'); // Red

    const color = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].color;
    });
    expect(color).toBe('#E02B2B');
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
    await page.locator('#pat-color1-swatches .pat-color-sw[data-pat-color="#E02B2B"]').click();
    await page.locator('#pat-color2-swatches .pat-color-sw[data-pat-color="#0078BF"]').click();

    const colors = await page.evaluate(() => {
      // @ts-ignore
      const p = State.layers[0].pattern;
      return { c1: p.color1, c2: p.color2 };
    });
    expect(colors.c1).toBe('#E02B2B');
    expect(colors.c2).toBe('#0078BF');
  });
});
