import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImageFromBuffer, createShapePngBuffer } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Generate Outline', () => {
  test('creates an editable custom-path shape layer from an image', async ({ page }) => {
    await createProject(page, 'Outline Test');
    // 200x200 image with a 100x100 black square centered on white.
    await addImageFromBuffer(page, createShapePngBuffer('rect', 200, 200), { name: 'square.png' });

    await page.locator('#layer-buttons [data-action="generate-outline"]').click();
    await page.waitForFunction(() => {
      const ol = window.State.layers[1];
      return ol && !ol._dirty && ol._processedCanvas;
    });

    const info = await page.evaluate(() => {
      const l = window.State.layers[window.State.layers.length - 1];
      return {
        name: l.name,
        isShape: l.isShape,
        shapeType: l.shapeType,
        hasPath: Array.isArray(l.shapePath) && l.shapePath.length > 0,
        pathPts: l.shapePath?.[0]?.length || 0,
        hasFill: l.shapeHasFill,
        hasStroke: l.shapeHasStroke,
        isSelected: window.State.selectedId === l.id && window.State.selectedIds.length === 1,
      };
    });

    expect(info.name).toBe('Outline of square');
    expect(info.isShape).toBe(true);
    expect(info.shapeType).toBe('custom-path');
    expect(info.hasPath).toBe(true);
    // A traced square should simplify to a handful of corner points.
    expect(info.pathPts).toBeLessThanOrEqual(12);
    expect(info.hasFill).toBe(false);
    expect(info.hasStroke).toBe(true);
    expect(info.isSelected).toBe(true);
  });

  test('outline renders as a border around the original content area', async ({ page }) => {
    await createProject(page, 'Outline Render Test');
    await addImageFromBuffer(page, createShapePngBuffer('rect', 200, 200), { name: 'square.png' });

    await page.locator('#layer-buttons [data-action="generate-outline"]').click();
    await page.waitForFunction(() => {
      const ol = window.State.layers[1];
      return ol && !ol._dirty && ol._processedCanvas;
    });

    // Hide the source image so only the outline shape is visible.
    await page.evaluate(async () => {
      window.State.layers[0].visible = false;
      const outline = window.State.layers[1];
      outline.color = '#010101';
      outline._dirty = true;
      await window.Renderer.draw();
    });

    const samples = await page.evaluate(() => {
      const canvas = document.getElementById('display-canvas');
      const ctx = canvas.getContext('2d');
      const z = window.State.zoom;
      const l = window.State.layers[1];
      const cx = (l.x + l.width / 2) * z;
      const cy = (l.y + l.height / 2) * z;
      const halfW = (l.width / 4) * z; // black square spans middle half of the image
      // Darkest red-channel value in a small neighbourhood. The stroke is
      // only a couple of screen px wide at fit zoom, so a single-pixel probe
      // can land on anti-aliased fringe.
      const darkest = (x, y, r = 4) => {
        let m = 255;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const sx = Math.round(x) + dx, sy = Math.round(y) + dy;
            if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
            const v = ctx.getImageData(sx, sy, 1, 1).data[0];
            if (v < m) m = v;
          }
        }
        return m;
      };
      return {
        edgeTop: darkest(cx, cy - halfW),
        center: darkest(cx, cy),
        outside: darkest(l.x * z - 10, l.y * z - 10),
      };
    });

    expect(samples.edgeTop[0]).toBeLessThan(128);   // stroke on the square's edge
    expect(samples.center[0]).toBeGreaterThan(200); // no fill inside
    expect(samples.outside[0]).toBeGreaterThan(200);
  });

  test('outline stroke width can be edited like other shapes', async ({ page }) => {
    await createProject(page, 'Outline Edit Test');
    await addImageFromBuffer(page, createShapePngBuffer('rect', 200, 200), { name: 'square.png' });

    await page.locator('#layer-buttons [data-action="generate-outline"]').click();
    await page.waitForFunction(() => {
      const ol = window.State.layers[1];
      return ol && !ol._dirty && ol._processedCanvas;
    });

    const numInput = page.locator('#prop-shape-stroke-width-num');
    await expect(numInput).toBeVisible();

    await numInput.fill('20');
    await numInput.dispatchEvent('change');

    const width = await page.evaluate(() => {
      return window.State.layers.find(l => l.isShape)?.shapeStrokeWidth;
    });
    expect(width).toBe(20);
  });
});
