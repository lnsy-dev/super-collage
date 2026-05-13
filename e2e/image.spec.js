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

  test('set halftone to crosshatch', async ({ page }) => {
    await createProject(page, 'Halftone Hatch Test');
    await addImage(page, TEST_IMAGE);

    await page.click('.halftone-opt[data-halftone="crosshatch"]');

    const type = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].halftoneType;
    });
    expect(type).toBe('crosshatch');

    // Hatch-specific controls should be visible
    await expect(page.locator('#hatch-height-row')).toBeVisible();
    await expect(page.locator('#hatch-length-row')).toBeVisible();
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
