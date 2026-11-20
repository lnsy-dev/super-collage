// @ts-check
import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/** Force a full render and wait until no draws or layer processing are pending. */
async function settleRender(page) {
  await page.evaluate(async () => {
    if (typeof Renderer._settleZoom === 'function') Renderer._settleZoom();
    Renderer.schedule();
  });
  await page.waitForFunction(
    () => State.layers.every(l => !l._dirty) && !State.renderPending,
    null,
    { timeout: 30000 }
  );
  await page.evaluate(async () => {
    Renderer.schedule();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/**
 * Sample a display-canvas pixel at page-space coordinates (doc units).
 * Returns { bx, by, rgba } in backing-pixel space.
 */
async function samplePagePixel(page, docX, docY) {
  return page.evaluate(({ docX, docY }) => {
    const canvas = document.getElementById('display-canvas');
    const z = State.zoom;
    const ds = Renderer._displayScale || 1;
    const bx = Math.min(canvas.width - 1, Math.max(0, Math.round(docX * z * ds)));
    const by = Math.min(canvas.height - 1, Math.max(0, Math.round(docY * z * ds)));
    const d = canvas.getContext('2d').getImageData(bx, by, 1, 1).data;
    return { bx, by, rgba: [d[0], d[1], d[2], d[3]] };
  }, { docX, docY });
}

test.describe('Page bottom placement', () => {
  test('content can be placed at the bottom edge of a page and remains visible', async ({ page }) => {
    await createProject(page, 'Bottom Edge Test', { pageSize: 'half-letter', pageCount: 1 });

    // Solid image layers default to black ink (#010101) on white paper; inked
    // pixels render as near-black, so "content visible" means dark (not white).
    await addImageFromBuffer(page, createSolidPngBuffer('#cc2020', 400, 400), { name: 'red.png' });
    await expect.poll(() => page.evaluate(() => State.layers.length)).toBe(1);

    // Move the layer so its bottom edge sits exactly on the page bottom.
    const placed = await page.evaluate(async () => {
      const layer = State.layers[0];
      const p = await DB.get('pages', State.pageId);
      layer.x = 100;
      layer.y = p.height - layer.height;
      layer._dirty = true;
      await DB.saveLayer(layer);
      Renderer.resize();
      Renderer.schedule();
      return { pageW: p.width, pageH: p.height, layerY: layer.y, layerH: layer.height };
    });

    expect(placed.layerY + placed.layerH).toBe(placed.pageH);

    await settleRender(page);

    // Sample inside the placed layer, 2px and 10px above the page bottom edge.
    // A masked/clipped/unrenderable bottom strip would show white paper here.
    const inside2 = await samplePagePixel(page, 300, placed.pageH - 2);
    const inside10 = await samplePagePixel(page, 300, placed.pageH - 10);
    // Outside the layer at the same y: should remain white paper.
    const outside = await samplePagePixel(page, 50, placed.pageH - 10);

    expect(inside10.rgba[0], `10px above bottom inside layer should be ink, got ${JSON.stringify({ inside10, outside })}`).toBeLessThan(80);
    expect(inside10.rgba[1], `10px above bottom inside layer should be ink, got ${JSON.stringify({ inside10, outside })}`).toBeLessThan(80);
    expect(inside2.rgba[0], `2px above bottom inside layer should be ink, got ${JSON.stringify({ inside2, outside })}`).toBeLessThan(80);
    expect(inside2.rgba[1], `2px above bottom inside layer should be ink, got ${JSON.stringify({ inside2, outside })}`).toBeLessThan(80);
    expect(outside.rgba[0], `outside layer should be white paper, got ${JSON.stringify(outside)}`).toBeGreaterThan(240);
    expect(outside.rgba[1], `outside layer should be white paper, got ${JSON.stringify(outside)}`).toBeGreaterThan(240);
    expect(outside.rgba[2], `outside layer should be white paper, got ${JSON.stringify(outside)}`).toBeGreaterThan(240);
  });

  test('layer moved to page bottom renders there after viewport culling path', async ({ page }) => {
    await createProject(page, 'Bottom Cull Test', { pageSize: 'half-letter', pageCount: 1 });

    await addImageFromBuffer(page, createSolidPngBuffer('#2040cc', 300, 300), { name: 'blue.png' });
    await expect.poll(() => page.evaluate(() => State.layers.length)).toBe(1);

    const pageH = await page.evaluate(async () => {
      const p = await DB.get('pages', State.pageId);
      const layer = State.layers[0];
      // Place 1px above the bottom edge so the layer's bottom sits just inside
      // the page; this exercises clipping/culling at the page boundary.
      layer.x = 200;
      layer.y = p.height - layer.height - 1;
      layer._dirty = true;
      await DB.saveLayer(layer);
      Renderer.resize();
      Renderer.schedule();
      return p.height;
    });

    await settleRender(page);

    // 5px above the page bottom is inside the 300px-tall layer.
    const inside = await samplePagePixel(page, 350, pageH - 5);
    const outside = await samplePagePixel(page, 100, pageH - 5);

    expect(inside.rgba[0], `bottom area inside layer should be ink, got ${JSON.stringify({ inside, outside })}`).toBeLessThan(80);
    expect(inside.rgba[1], `bottom area inside layer should be ink, got ${JSON.stringify({ inside, outside })}`).toBeLessThan(80);
    expect(outside.rgba[0], `outside layer should be white paper, got ${JSON.stringify(outside)}`).toBeGreaterThan(240);
  });
});
