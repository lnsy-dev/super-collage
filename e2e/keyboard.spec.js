import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, selectTool } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Keyboard Shortcuts', () => {
  test('V key switches to select tool', async ({ page }) => {
    await createProject(page, 'Key V Test');
    await addImage(page, TEST_IMAGE);

    await page.keyboard.press('v');
    const tool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(tool).toBe('select');
  });

  test('M key switches to move tool', async ({ page }) => {
    await createProject(page, 'Key M Test');
    await addImage(page, TEST_IMAGE);

    await page.keyboard.press('m');
    const tool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(tool).toBe('move');
  });

  test('B key switches to mask draw tool', async ({ page }) => {
    await createProject(page, 'Key B Test');
    await addImage(page, TEST_IMAGE);

    await page.keyboard.press('b');
    const tool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(tool).toBe('mask-draw');
  });

  test('E key switches to mask erase tool', async ({ page }) => {
    await createProject(page, 'Key E Test');
    await addImage(page, TEST_IMAGE);

    await page.keyboard.press('e');
    const tool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(tool).toBe('mask-erase');
  });

  test('R key switches to rectangle tool', async ({ page }) => {
    await createProject(page, 'Key R Test');
    await addImage(page, TEST_IMAGE);

    await page.keyboard.press('r');
    const tool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(tool).toBe('shape-rect');
  });

  test('O key switches to ellipse tool', async ({ page }) => {
    await createProject(page, 'Key O Test');
    await addImage(page, TEST_IMAGE);

    await page.keyboard.press('o');
    const tool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(tool).toBe('shape-ellipse');
  });

  test('P key switches to polygon tool', async ({ page }) => {
    await createProject(page, 'Key P Test');
    await addImage(page, TEST_IMAGE);

    await page.keyboard.press('p');
    const tool = await page.evaluate(() => {
      // @ts-ignore
      return State.tool;
    });
    expect(tool).toBe('shape-poly');
  });

  test('Command+D duplicates selected layer', async ({ page }) => {
    await createProject(page, 'Cmd D Test');
    await addImage(page, TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    await page.keyboard.press('Control+d');
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
  });

  test('Delete key deletes selected layer', async ({ page }) => {
    await createProject(page, 'Delete Key Test');
    await addImage(page, TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    await page.keyboard.press('Delete');
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(0);
  });

  test('Command+] moves layer up', async ({ page }) => {
    await createProject(page, 'Cmd Bracket Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Select bottom layer
    await page.locator('.layer-row').nth(1).click();

    await page.keyboard.press('Control+]');
    // Should still have 2 layers after reorder
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
  });

  test('Command+[ moves layer down', async ({ page }) => {
    await createProject(page, 'Cmd Bracket Down Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Select top layer
    await page.locator('.layer-row').nth(0).click();

    await page.keyboard.press('Control+[');
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
  });

  test('arrow keys nudge selected layer', async ({ page }) => {
    await createProject(page, 'Arrow Nudge Test');
    await addImage(page, TEST_IMAGE);

    const initialPos = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { x: l.x, y: l.y };
    });

    await page.keyboard.press('ArrowRight');

    const newPos = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { x: l.x, y: l.y };
    });

    expect(newPos.x).toBe(initialPos.x + 1);
    expect(newPos.y).toBe(initialPos.y);
  });

  test('Shift+arrow keys nudge by 10px', async ({ page }) => {
    await createProject(page, 'Shift Arrow Nudge Test');
    await addImage(page, TEST_IMAGE);

    const initialPos = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { x: l.x, y: l.y };
    });

    await page.keyboard.press('Shift+ArrowDown');

    const newPos = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { x: l.x, y: l.y };
    });

    expect(newPos.y).toBe(initialPos.y + 10);
  });
});
