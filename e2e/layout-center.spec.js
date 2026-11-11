import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

async function openLayoutMenu(page) {
  await page.locator('.menu-item[data-menu="layout"]').click();
}

async function addRectLayer(page, { x, y, w, h, name = 'Rect' }) {
  return page.evaluate(async ({ x, y, w, h, name }) => {
    const { LayerManager } = await import('/src/app/layer-manager.js');
    State.tool = 'shape-rect';
    await LayerManager.addShape({
      shapeHasFill: true,
      shapeHasStroke: false,
      shapeStrokeWidth: 4,
      shapeSides: 6,
      shapeIsStar: false,
      shapeStarRatio: 0.4,
    }, x, y, w, h);
    const l = State.layers.find(layer => layer.id === State.selectedId);
    if (l && name) l.name = name;
    return l.id;
  }, { x, y, w, h, name });
}

test.describe('Layout menu centering', () => {
  test('adds Layout menu with centering actions', async ({ page }) => {
    await createProject(page, 'Layout Menu Test', { pageSize: 'half-letter', pageCount: 1 });

    await expect(page.locator('.menu-item[data-menu="layout"]')).toContainText('Layout');
    await openLayoutMenu(page);
    await expect(page.locator('.menu-entry[data-action="center-horizontal"]')).toHaveText('Center Horizontally On Page');
    await expect(page.locator('.menu-entry[data-action="center-vertical"]')).toHaveText('Center Vertically on Page');
  });

  test('centers a single layer horizontally on the page', async ({ page }) => {
    await createProject(page, 'Center H Single', { pageSize: 'half-letter', pageCount: 1 });
    await addRectLayer(page, { x: 100, y: 400, w: 600, h: 300 });

    await openLayoutMenu(page);
    await page.locator('.menu-entry[data-action="center-horizontal"]').click();

    const result = await page.evaluate(async () => {
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
      const l = State.layers.find(x => x.id === State.selectedId);
      return { x: l.x, y: l.y, w: l.width, h: l.height, cw: CANVAS_W, ch: CANVAS_H };
    });
    expect(result.x).toBeCloseTo((result.cw - result.w) / 2, 5);
    expect(result.y).toBe(400);
  });

  test('centers a single layer vertically on the page', async ({ page }) => {
    await createProject(page, 'Center V Single', { pageSize: 'half-letter', pageCount: 1 });
    await addRectLayer(page, { x: 200, y: 100, w: 600, h: 300 });

    await openLayoutMenu(page);
    await page.locator('.menu-entry[data-action="center-vertical"]').click();

    const result = await page.evaluate(async () => {
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
      const l = State.layers.find(x => x.id === State.selectedId);
      return { x: l.x, y: l.y, w: l.width, h: l.height, cw: CANVAS_W, ch: CANVAS_H };
    });
    expect(result.x).toBe(200);
    expect(result.y).toBeCloseTo((result.ch - result.h) / 2, 5);
  });

  test('centers multiple selected layers as a group', async ({ page }) => {
    await createProject(page, 'Center Group', { pageSize: 'half-letter', pageCount: 1 });
    const id1 = await addRectLayer(page, { x: 100, y: 200, w: 200, h: 200 });
    const id2 = await addRectLayer(page, { x: 500, y: 600, w: 200, h: 200 });

    const before = await page.evaluate(async ({ id1, id2 }) => {
      const { CANVAS_W } = await import('/src/app/constants.js');
      State.selectedIds = [id1, id2];
      State.selectedId = id1;
      const targets = State.layers.filter(l => State.selectedIds.includes(l.id));
      const left = Math.min(...targets.map(l => l.x));
      const right = Math.max(...targets.map(l => l.x + l.width));
      const rel = targets.map(l => ({ id: l.id, dx: l.x - left, y: l.y }));
      return { rel, cw: CANVAS_W };
    }, { id1, id2 });

    await openLayoutMenu(page);
    await page.locator('.menu-entry[data-action="center-horizontal"]').click();

    const after = await page.evaluate(async ({ id1, id2 }) => {
      const { CANVAS_W } = await import('/src/app/constants.js');
      const targets = State.layers.filter(l => [id1, id2].includes(l.id));
      const left = Math.min(...targets.map(l => l.x));
      const right = Math.max(...targets.map(l => l.x + l.width));
      return {
        left,
        cx: (left + right) / 2,
        cw: CANVAS_W,
        positions: targets.map(l => ({ id: l.id, x: l.x, y: l.y })),
      };
    }, { id1, id2 });

    expect(after.cx).toBeCloseTo(after.cw / 2, 5);
    for (const b of before.rel) {
      const a = after.positions.find(p => p.id === b.id);
      expect(a.x).toBeCloseTo(after.left + b.dx, 5);
      expect(a.y).toBe(b.y);
    }
  });

  test('does nothing when nothing is selected', async ({ page }) => {
    await createProject(page, 'Center No Selection', { pageSize: 'half-letter', pageCount: 1 });
    await addRectLayer(page, { x: 100, y: 400, w: 600, h: 300 });

    const before = await page.evaluate(() => {
      State.selectedId = null;
      State.selectedIds = [];
      const l = State.layers[0];
      return { x: l.x, y: l.y };
    });

    await openLayoutMenu(page);
    await page.locator('.menu-entry[data-action="center-horizontal"]').click();

    const after = await page.evaluate(() => {
      const l = State.layers[0];
      return { x: l.x, y: l.y };
    });
    expect(after).toEqual(before);
  });
});

