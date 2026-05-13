import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Undo / Redo', () => {
  test('undo restores previous rotation value', async ({ page }) => {
    await createProject(page, 'Undo Test');
    await addImage(page, TEST_IMAGE);

    // Change rotation using blur to trigger change event
    await page.fill('#prop-rot', '45');
    await page.locator('#prop-rot').blur();

    const changedRotation = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].rotation;
    });
    expect(changedRotation).toBe(45);

    // Undo
    await page.keyboard.press('Control+z');

    const undoneRotation = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].rotation;
    });
    expect(undoneRotation).toBe(0);
  });

  test('redo restores undone property value', async ({ page }) => {
    await createProject(page, 'Redo Test');
    await addImage(page, TEST_IMAGE);

    // Change brightness
    await page.fill('#prop-brightness', '50');
    await page.keyboard.press('Tab');

    const changedBrightness = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].brightness;
    });
    expect(changedBrightness).toBe(50);

    // Undo
    await page.keyboard.press('Control+z');

    // Redo
    await page.keyboard.press('Control+Shift+z');

    const redoneBrightness = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].brightness;
    });
    expect(redoneBrightness).toBe(50);
  });

  test('undo flip horizontal', async ({ page }) => {
    await createProject(page, 'Undo Flip Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#properties-content [data-action="flip-h"]').click();
    const flipped = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].flipH;
    });
    expect(flipped).toBe(true);

    await page.keyboard.press('Control+z');

    const undone = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].flipH;
    });
    expect(undone).toBe(false);
  });
});
