// @ts-check
import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

async function setupThreeLayers(page, projectName) {
  await createProject(page, projectName);
  await addImage(page, TEST_IMAGE);
  await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
  await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(3);

  await page.evaluate(() => {
    const [l1, l2, l3] = State.layers;
    const place = (l, x, y, w = 400, h = 200) => {
      l.x = x; l.y = y; l.width = w; l.height = h; l.rotation = 0;
      l._dirty = true;
    };
    // Non-overlapping layout with distinct positions/sizes for bounds checks.
    place(l1, 100, 100, 300, 150);
    place(l2, 600, 250, 200, 250);
    place(l3, 1000, 150, 250, 200);
    State.selectedId = null;
    State.selectedIds = [];
    Renderer.resize();
    Renderer.schedule();
  });
  await page.waitForTimeout(150);
  return page.evaluate(() => State.layers.map(l => ({ id: l.id, x: l.x, y: l.y, width: l.width, height: l.height })));
}

async function selectAllLayers(page) {
  const ids = await page.evaluate(() => State.layers.map(l => l.id));
  await page.evaluate((ids) => {
    State.selectedIds = [...ids];
    State.selectedId = ids[ids.length - 1] || null;
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.drawOverlay();
  }, ids);
  await expect.poll(async () => page.evaluate(() => State.selectedIds.length)).toBe(ids.length);
  return ids;
}

test.describe('Multi-select color and gradient', () => {
  test('changing solid color applies to every selected layer', async ({ page }) => {
    await setupThreeLayers(page, 'Multi Color');
    const ids = await selectAllLayers(page);

    await page.click('.color-swatch[data-color="#ff48b0"]');

    await expect.poll(async () => page.evaluate(() => State.layers.map(l => l.color))).toEqual([
      '#ff48b0', '#ff48b0', '#ff48b0',
    ]);
    // Selection remains intact (UX: predictable multi-select).
    const sel = await page.evaluate(() => ({ ids: [...State.selectedIds], primary: State.selectedId }));
    expect(new Set(sel.ids)).toEqual(new Set(ids));
    expect(ids).toContain(sel.primary);
  });

  test('changing solid color with a single selection only affects that layer', async ({ page }) => {
    await setupThreeLayers(page, 'Single Color');
    const firstId = await page.evaluate(() => State.layers[0].id);
    await page.evaluate((id) => {
      State.selectedId = id;
      State.selectedIds = [id];
      UI.refreshLayerList();
      UI.refreshProperties();
    }, firstId);

    await page.click('.color-swatch[data-color="#ff48b0"]');

    const colors = await page.evaluate(() => State.layers.map(l => l.color));
    expect(colors[0]).toBe('#ff48b0');
    expect(colors[1]).not.toBe('#ff48b0');
    expect(colors[2]).not.toBe('#ff48b0');
  });

  test('switching to gradient with multiple selected sets gradient mode and stretches across all sub items', async ({ page }) => {
    const layers = await setupThreeLayers(page, 'Multi Gradient Mode');
    const ids = await selectAllLayers(page);

    await page.click('#btn-mode-gradient');

    const state = await page.evaluate(() => State.layers.map(l => ({
      id: l.id, colorMode: l.colorMode, gradientBounds: l.gradientBounds,
      x: l.x, y: l.y, w: l.width, h: l.height,
    })));
    const expectedBounds = {
      x: Math.min(...layers.map(l => l.x)),
      y: Math.min(...layers.map(l => l.y)),
      width: Math.max(...layers.map(l => l.x + l.width)) - Math.min(...layers.map(l => l.x)),
      height: Math.max(...layers.map(l => l.y + l.height)) - Math.min(...layers.map(l => l.y)),
    };
    for (const l of state) {
      expect(l.colorMode).toBe('gradient');
      expect(l.gradientBounds).not.toBeNull();
      expect(l.gradientBounds.x).toBeCloseTo(expectedBounds.x, 5);
      expect(l.gradientBounds.y).toBeCloseTo(expectedBounds.y, 5);
      expect(l.gradientBounds.width).toBeCloseTo(expectedBounds.width, 5);
      expect(l.gradientBounds.height).toBeCloseTo(expectedBounds.height, 5);
    }
    expect(new Set(state.map(l => l.id))).toEqual(new Set(ids));
  });

  test('editing gradient type with multiple selected updates all selected gradient layers and keeps stretch bounds', async ({ page }) => {
    await setupThreeLayers(page, 'Multi Gradient Type');
    await selectAllLayers(page);
    await page.click('#btn-mode-gradient');

    await page.click('.grad-type-btn[data-grad-type="circular"]');

    const state = await page.evaluate(() => State.layers.map(l => ({
      type: l.gradient?.type, bounds: l.gradientBounds, colorMode: l.colorMode,
    })));
    for (const l of state) {
      expect(l.colorMode).toBe('gradient');
      expect(l.type).toBe('circular');
      expect(l.bounds).not.toBeNull();
    }
    // Same shared bounds object values across all sub items.
    const b0 = state[0].bounds;
    for (const l of state.slice(1)) {
      expect(l.bounds.x).toBeCloseTo(b0.x, 5);
      expect(l.bounds.y).toBeCloseTo(b0.y, 5);
      expect(l.bounds.width).toBeCloseTo(b0.width, 5);
      expect(l.bounds.height).toBeCloseTo(b0.height, 5);
    }
  });

  test('editing gradient angle and stops with multiple selected updates all selected gradient layers', async ({ page }) => {
    await setupThreeLayers(page, 'Multi Gradient Edit');
    await selectAllLayers(page);
    await page.click('#btn-mode-gradient');

    await page.locator('#grad-angle').evaluate((el) => {
      el.value = '135';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Change first stop color via riso swatch in stop list.
    await page.locator('#gradient-stop-list .stop-riso-sw[data-stop-idx="0"][data-riso-color="#ff48b0"]').first().click();

    const state = await page.evaluate(() => State.layers.map(l => ({
      angle: l.gradient?.angle,
      stop0: l.gradient?.stops?.[0]?.color,
      bounds: l.gradientBounds,
    })));
    for (const l of state) {
      expect(l.angle).toBe(135);
      expect(l.stop0).toBe('#ff48b0');
      expect(l.bounds).not.toBeNull();
    }
  });

  test('switching to solid with multiple selected clears stretched gradient bounds', async ({ page }) => {
    await setupThreeLayers(page, 'Multi Solid Clears');
    await selectAllLayers(page);
    await page.click('#btn-mode-gradient');
    await page.click('#btn-mode-solid');

    const state = await page.evaluate(() => State.layers.map(l => ({ colorMode: l.colorMode, bounds: l.gradientBounds })));
    for (const l of state) {
      expect(l.colorMode).toBe('solid');
      expect(l.bounds).toBeNull();
    }
  });

  test('single selected gradient layer is not stretched across others', async ({ page }) => {
    await setupThreeLayers(page, 'Single Gradient');
    const firstId = await page.evaluate(() => State.layers[0].id);
    await page.evaluate((id) => {
      State.selectedId = id; State.selectedIds = [id];
      UI.refreshLayerList(); UI.refreshProperties();
    }, firstId);

    await page.click('#btn-mode-gradient');

    const state = await page.evaluate(() => State.layers.map(l => ({ colorMode: l.colorMode, bounds: l.gradientBounds })));
    expect(state[0].colorMode).toBe('gradient');
    expect(state[0].bounds).toBeNull();
    expect(state[1].colorMode).not.toBe('gradient');
    expect(state[2].colorMode).not.toBe('gradient');
  });
});
