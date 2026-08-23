import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

async function setupTwoSquares(page) {
  await createProject(page, 'Merge Test');
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'square-a.png' });
  await addImageFromBuffer(page, createSolidPngBuffer('#111111', 100, 100), { name: 'square-b.png' });

  // Place the two squares apart so the merged result must span both.
  return await page.evaluate(() => {
    const [a, b] = window.State.layers;
    a.x = 100; a.y = 100;
    b.x = 300; b.y = 300;
    a._dirty = true; b._dirty = true;
    window.State.selectedIds = [a.id, b.id];
    window.UI.refreshLayerList();
    return { aId: a.id, bId: b.id };
  });
}

test.describe('Merge layers', () => {
  test('merge button appears when multiple layers are selected', async ({ page }) => {
    await createProject(page, 'Merge Button Test');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'a.png' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'b.png' });

    const btn = page.locator('#layer-buttons [data-action="merge-layers"]');
    await expect(btn).toBeHidden();

    await page.evaluate(() => {
      window.State.selectedIds = window.State.layers.map(l => l.id);
      window.UI.refreshLayerList();
    });
    await expect(btn).toBeVisible();
  });

  test('merges two layers into one cropped layer spanning both', async ({ page }) => {
    await setupTwoSquares(page);

    await page.locator('#layer-buttons [data-action="merge-layers"]').click();
    await page.waitForFunction(() => window.State.layers.length === 1);

    const result = await page.evaluate(() => {
      const ls = window.State.layers;
      return {
        count: ls.length,
        merged: ls[0] ? { name: ls[0].name, x: ls[0].x, y: ls[0].y, w: ls[0].width, h: ls[0].height } : null,
        selectedCount: window.State.selectedIds.length,
      };
    });

    expect(result.count).toBe(1);
    expect(result.selectedCount).toBe(1);
    expect(result.merged.name).toContain('square-a');
    expect(result.merged.name).toContain('square-b');
    // Content spans from (100,100) to (400,400) in page units.
    expect(result.merged.w).toBeGreaterThanOrEqual(298);
    expect(result.merged.w).toBeLessThanOrEqual(303);
    expect(result.merged.h).toBeGreaterThanOrEqual(298);
    expect(result.merged.h).toBeLessThanOrEqual(303);
    expect(result.merged.x).toBeGreaterThanOrEqual(98);
    expect(result.merged.x).toBeLessThanOrEqual(102);
    expect(result.merged.y).toBeGreaterThanOrEqual(98);
    expect(result.merged.y).toBeLessThanOrEqual(102);
  });

  test('merged layer renders combined content', async ({ page }) => {
    await setupTwoSquares(page);
    await page.locator('#layer-buttons [data-action="merge-layers"]').click();
    await page.waitForFunction(() => window.State.layers.length === 1);

    // Sample the display canvas: both original square centers should now be dark.
    const samples = await page.evaluate(async () => {
      await window.Renderer.draw();
      const canvas = document.getElementById('display-canvas');
      const ctx = canvas.getContext('2d');
      const z = window.State.zoom;
      const px = (x, y) => Array.from(ctx.getImageData(Math.round(x * z), Math.round(y * z), 1, 1).data);
      return { inA: px(150, 150), inB: px(350, 350), between: px(250, 250) };
    });

    expect(samples.inA[0]).toBeLessThan(128);
    expect(samples.inB[0]).toBeLessThan(128);
    // Gap between squares stays white.
    expect(samples.between[0]).toBeGreaterThan(200);
  });
});
