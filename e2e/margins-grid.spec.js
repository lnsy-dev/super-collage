import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, getCanvasPixel } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Margins & Grid overlays', () => {
  test('View menu toggles margins and grid', async ({ page }) => {
    await createProject(page, 'Margin Grid Test', { pageSize: 'half-letter', pageCount: 1 });

    const viewMenu = page.locator('.menu-item[data-menu="view"]');
    await viewMenu.click();
    await page.locator('.menu-entry[data-action="toggle-margins"]').click();

    let showMargins = await page.evaluate(() => window.State.showMargins);
    expect(showMargins).toBe(true);

    await viewMenu.click();
    await page.locator('.menu-entry[data-action="toggle-grid"]').click();

    let showGrid = await page.evaluate(() => window.State.showGrid);
    expect(showGrid).toBe(true);
  });

  test('Set Margins dialog updates state', async ({ page }) => {
    await createProject(page, 'Set Margins Test', { pageSize: 'half-letter', pageCount: 1 });

    await page.locator('.menu-item[data-menu="view"]').click();
    await page.locator('.menu-entry[data-action="set-margins"]').click();

    await expect(page.locator('#margins-dialog')).toBeVisible();
    await page.fill('#margin-top', '1');
    await page.fill('#margin-right', '0.75');
    await page.fill('#margin-bottom', '0.5');
    await page.fill('#margin-left', '0.25');
    await page.click('#btn-margins-ok');

    await expect(page.locator('#margins-dialog')).toBeHidden();
    const margins = await page.evaluate(() => window.State.margins);
    expect(margins).toEqual({ top: 600, right: 450, bottom: 300, left: 150 });
  });

  test('Set Grid dialog updates state', async ({ page }) => {
    await createProject(page, 'Set Grid Test', { pageSize: 'half-letter', pageCount: 1 });

    await page.locator('.menu-item[data-menu="view"]').click();
    await page.locator('.menu-entry[data-action="set-grid"]').click();

    await expect(page.locator('#grid-dialog')).toBeVisible();
    await page.fill('#grid-size', '0.5');
    await page.locator('input[name="grid-type"][value="isometric"]').check();
    await page.click('#btn-grid-ok');

    await expect(page.locator('#grid-dialog')).toBeHidden();
    const grid = await page.evaluate(() => window.State.grid);
    expect(grid).toEqual({ size: 300, type: 'isometric' });
  });

  test('Spread view tracks split position', async ({ page }) => {
    await createProject(page, 'Spread Margins Test', { pageSize: 'half-letter', pageCount: 8 });

    await page.evaluate(async () => {
      const { PageManager } = await import('/src/app/page-manager.js');
      const { computeViewUnits } = await import('/src/app/spread-manager.js');
      const units = computeViewUnits(window.State.project.pageOrder, 'saddle-stitch');
      const spread = units.find(u => u.type === 'spread');
      if (spread) await PageManager.loadUnit(spread.id);
    });

    const splitX = await page.evaluate(() => window.State.spreadSplitX);
    expect(splitX).toBeGreaterThan(0);
    const isSpread = await page.evaluate(() => window.State.spreadView);
    expect(isSpread).toBe(true);
  });

  test('isometric grid covers lower-left corner', async ({ page }) => {
    await createProject(page, 'Iso Grid Coverage Test', { pageSize: 'half-letter', pageCount: 1 });

    await page.locator('.menu-item[data-menu="view"]').click();
    await page.locator('.menu-entry[data-action="set-grid"]').click();
    await page.locator('input[name="grid-type"][value="isometric"]').check();
    await page.click('#btn-grid-ok');
    await page.locator('.menu-item[data-menu="view"]').click();
    await page.locator('.menu-entry[data-action="toggle-grid"]').click();

    // Force a render and wait briefly
    await page.waitForTimeout(150);

    const dims = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      return { w: c.width, h: c.height };
    });
    // Sample points near the lower-left corner; at least one should be the grid color
    let foundGrid = false;
    for (let y = dims.h - 1; y >= Math.max(0, dims.h - 80); y -= 4) {
      for (let x = 0; x <= Math.min(dims.w - 1, 80); x += 4) {
        const px = await getCanvasPixel(page, '#display-canvas', x, y);
        // Grid is rendered as translucent light blue blended with the white paper.
        if (px && px.r < px.b && px.g > 230 && px.b > 245) {
          foundGrid = true;
          break;
        }
      }
      if (foundGrid) break;
    }
    expect(foundGrid).toBe(true);
  });
});
