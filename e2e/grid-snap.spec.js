/* ═══════════════════════════════════════════════════════════════════
   Grid snapping end-to-end tests.

   Invariant under test: WHEN THE GRID IS VISIBLE, every pointer
   interaction that produces a position — moving a layer, resizing by
   any handle, drawing a shape, dragging out a text box — lands its
   result on the SAME grid lines that Renderer.drawGrid paints on the
   display canvas. The drawn lines are detected from actual display-
   canvas pixels (sampled OUTSIDE the committed layer's fill, since the
   grid composites differently over ink), so a regression in either the
   grid's origin or the snapping origin (they must be the same) fails
   these tests.

   Negative controls assert that nothing snaps when the grid is hidden
   or isometric (diagonal lines, different geometry).
   ═══════════════════════════════════════════════════════════════════ */

import { test, expect } from '@playwright/test';
import { clearIndexedDB, gotoApp, createProject, addSolidColorImage, addImageFromBuffer, createSolidPngBuffer, selectTool } from './helpers.js';

const G = 150; // default grid size: 0.25" @ 600dpi, in page pixels
const EPS = 1e-6;

/* ── helpers ──────────────────────────────────────────────────────── */

async function enableGridViaMenu(page) {
  await page.locator('.menu-item[data-menu="view"]').click();
  await page.locator('.menu-entry[data-action="toggle-grid"]').click();
  await expect.poll(() => page.evaluate(() => window.State.showGrid)).toBe(true);
}

/**
 * createProject + immediate cleanup: the app shows a Ko-fi toast (fixed,
 * bottom-centre, z-index 9999) for 6s after every project creation, and it
 * intercepts pointer events over whatever sits under it — including the
 * create-wizard's own buttons in a back-to-back createProject call.
 */
async function createProjectClean(page, name, opts = {}) {
  await createProject(page, name, opts);
  await page.evaluate(() => document.querySelector('.kofi-toast')?.remove());
}

async function setGrid(page, { size = G, type = 'standard', show = true } = {}) {
  await page.evaluate(({ size, type, show }) => {
    window.State.grid = { size, type };
    window.State.showGrid = show;
    window.Renderer.schedule();
  }, { size, type, show });
}

/** Convert a page-space point to client (viewport) coordinates. */
async function clientForPage(page, px, py) {
  return page.evaluate(([px, py]) => new Promise((resolve) => {
    import('/src/app/constants.js').then(({ CANVAS_PAD }) => {
      const r = document.getElementById('interaction-overlay').getBoundingClientRect();
      const z = window.State.zoom;
      resolve({ x: r.left + (px + CANVAS_PAD) * z, y: r.top + (py + CANVAS_PAD) * z, zoom: z });
    });
  }), [px, py]);
}

/**
 * An off-grid parking spot INSIDE the visible page area (page coords ≥ 0),
 * far enough from the viewport edges for a ~250-page-px interaction.
 */
async function parkSpot(page, margin = 100) {
  return page.evaluate(async (margin) => {
    const { CANVAS_PAD, CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
    const r = document.getElementById('interaction-overlay').getBoundingClientRect();
    const z = window.State.zoom;
    const x0 = Math.max(r.left, 0), y0 = Math.max(r.top, 0);
    const x1 = Math.min(r.right, window.innerWidth), y1 = Math.min(r.bottom, window.innerHeight);
    const vx0 = (x0 - r.left) / z - CANVAS_PAD, vy0 = (y0 - r.top) / z - CANVAS_PAD;
    const vx1 = (x1 - r.left) / z - CANVAS_PAD, vy1 = (y1 - r.top) / z - CANVAS_PAD;
    // Park near the visible page corner, keeping room for the drag below/right.
    const px = Math.max(0, Math.min(Math.floor(vx0) + margin, CANVAS_W - margin - 300));
    const py = Math.max(0, Math.min(Math.floor(vy0) + margin, CANVAS_H - margin - 300));
    return { x: px + 37, y: py + 53 }; // deliberately off-grid offsets
  }, margin);
}

/** Real mouse drag through interpolated moves (fires pointerdown/move/up). */
async function dragMouse(page, from, to, steps = 6) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps
    );
  }
  await page.mouse.up();
}

async function settle(page) {
  await page.waitForFunction(() =>
    !window.State.drag && !window.State.shapeDrag && !window.State.textDrag);
  await page.waitForTimeout(120); // let async DB saves / redraws finish
}

/** A layer record: 'last' (default) or the primary selected layer. */
async function getLayer(page, which = 'last') {
  return page.evaluate((which) => {
    const l = which === 'primary'
      ? window.State.layers.find(l => l.id === window.State.selectedId)
      : window.State.layers[window.State.layers.length - 1];
    return {
      id: l.id, x: l.x, y: l.y, width: l.width, height: l.height,
      naturalWidth: l.naturalWidth, naturalHeight: l.naturalHeight,
      isText: !!l.isText,
    };
  }, which);
}

async function parkLayer(page, x, y, { idx = -1, size = 600 } = {}) {
  // 600 page px keeps the resize handles (clustered on the perimeter) away
  // from the centre drag point even at the default fit-to-screen zoom.
  await page.evaluate(([x, y, idx, size]) => new Promise((resolve) => {
    const l = window.State.layers.at(idx);
    l.x = x; l.y = y; l.width = size; l.height = size; l._dirty = true;
    window.DB.saveLayer(l).then(() => {
      window.Renderer.schedule();
      resolve();
    });
  }), [x, y, idx, size]);
  await page.waitForFunction((idx) => {
    const l = window.State.layers.at(idx);
    return l._processedCanvas || l.isText;
  }, idx, { timeout: 8000 });
}

/**
 * Distances from a layer's four edges to the grid lines actually PAINTED on
 * the display canvas. Samples are taken just outside the layer's own fill
 * (below its bottom edge / right of its right edge), because the grid
 * composites to a different colour over inked pixels.
 * Returns { left, top, right, bottom } in display pixels (Infinity when the
 * sample fell outside the canvas).
 */
async function drawnEdgeDistance(page, which = 'last') {
  return page.evaluate(async (which) => {
    const { CANVAS_PAD, CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
    void CANVAS_PAD; void CANVAS_W; void CANVAS_H;
    const l = which === 'primary'
      ? window.State.layers.find(l => l.id === window.State.selectedId)
      : window.State.layers[window.State.layers.length - 1];
    const z = window.State.zoom;
    const c = document.getElementById('display-canvas');
    const ctx = c.getContext('2d');
    // rgba(135,206,235,0.35) over white → exactly (213, 238, 248)
    const isGrid = (r, g, b) => r >= 200 && r < 235 && g >= 225 && g < 248 && b >= 240 && b < 253;
    const nearest = (positions, target) =>
      positions.reduce((acc, p) => Math.min(acc, Math.abs(p - target)), Infinity);

    // Vertical lines: scan a pixel row below the layer's bottom edge.
    const rowY = Math.min(l.y + l.height + 60, (c.height - 2) / z);
    const row = Math.round(rowY * z);
    let left = Infinity, right = Infinity;
    if (row >= 0 && row < c.height) {
      const d = ctx.getImageData(0, row, c.width, 1).data;
      const cols = [];
      for (let x = 0; x < c.width; x++) {
        if (isGrid(d[x * 4], d[x * 4 + 1], d[x * 4 + 2])) cols.push(x);
      }
      left = nearest(cols, l.x * z);
      right = nearest(cols, (l.x + l.width) * z);
    }

    // Horizontal lines: scan a pixel column right of the layer's right edge.
    const colX = Math.min(l.x + l.width + 60, (c.width - 2) / z);
    const col = Math.round(colX * z);
    let top = Infinity, bottom = Infinity;
    if (col >= 0 && col < c.width) {
      const d = ctx.getImageData(col, 0, 1, c.height).data;
      const rows = [];
      for (let y = 0; y < c.height; y++) {
        if (isGrid(d[y * 4], d[y * 4 + 1], d[y * 4 + 2])) rows.push(y);
      }
      top = nearest(rows, l.y * z);
      bottom = nearest(rows, (l.y + l.height) * z);
    }
    return { left, top, right, bottom };
  }, which);
}

const multipleOf = (v, g) => Math.abs(v / g - Math.round(v / g));

/* ── the tests ────────────────────────────────────────────────────── */

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Grid snapping (grid visible → pointer results snap to the drawn grid)', () => {

  test('move: dragging a layer snaps its corner onto the drawn grid lines', async ({ page }) => {
    await createProjectClean(page, 'Snap Move');
    await addSolidColorImage(page, '#000000');

    const spot = await parkSpot(page);
    await parkLayer(page, spot.x, spot.y);
    await selectTool(page, 'select');
    await enableGridViaMenu(page);

    const z = await page.evaluate(() => window.State.zoom);
    const from = await clientForPage(page, spot.x + 300, spot.y + 300); // layer centre
    const to = { x: from.x + 123 * z, y: from.y + 237 * z };
    await dragMouse(page, from, to);
    await settle(page);

    const l = await getLayer(page);
    // Exact grid multiples (grid.size = 150 page px):
    expect(multipleOf(l.x, G), `x=${l.x}`).toBeLessThan(EPS);
    expect(multipleOf(l.y, G), `y=${l.y}`).toBeLessThan(EPS);
    // …and those multiples are the lines actually PAINTED on screen:
    const d = await drawnEdgeDistance(page);
    expect(d.left, 'left edge vs drawn columns').toBeLessThan(0.75);
    expect(d.top, 'top edge vs drawn rows').toBeLessThan(0.75);
  });

  test('move: a shift-added multi-selection moves rigidly and the primary snaps', async ({ page }) => {
    await createProjectClean(page, 'Snap Multi');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'a.png' }); // A
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'b.png' }); // B (auto-selected by its import)
    const spot = await parkSpot(page);
    await parkLayer(page, spot.x, spot.y, { idx: -2 });        // A
    await parkLayer(page, spot.x + 700, spot.y, { idx: -1 });  // B, beside A

    await selectTool(page, 'select');
    await enableGridViaMenu(page);

    const z = await page.evaluate(() => window.State.zoom);
    // Shift+click-drag on A (UNselected — the last import auto-selected only
    // B): adds A to the selection and drags the group with A as the primary.
    const from = await clientForPage(page, spot.x + 300, spot.y + 300);
    const to = { x: from.x + 111 * z, y: from.y + 87 * z };
    await page.keyboard.down('Shift');
    await dragMouse(page, from, to);
    await page.keyboard.up('Shift');
    await settle(page);

    const layers = await page.evaluate(() => window.State.layers.map(l => ({ x: l.x, y: l.y })));
    const [a, b] = layers;
    // Primary (A) snapped to grid multiples:
    expect(multipleOf(a.x, G), `A.x=${a.x}`).toBeLessThan(EPS);
    expect(multipleOf(a.y, G), `A.y=${a.y}`).toBeLessThan(EPS);
    // Rigid: identical translation for both layers, relative offset preserved.
    expect(b.x - a.x, 'B.x - A.x').toBeCloseTo(700, 3);
    expect(b.y - a.y, 'B.y - A.y').toBeCloseTo(0, 3);
    // B moved by the SAME (snapped) delta as A, not an independent snap.
    expect(b.x - (spot.x + 700 + 111)).toBeCloseTo(a.x - (spot.x + 111), 3);
    expect(b.y - (spot.y + 87)).toBeCloseTo(a.y - (spot.y + 87), 3);
    // The primary's edges sit on the drawn grid:
    const d = await drawnEdgeDistance(page, 'primary');
    expect(d.left, 'primary left edge vs drawn columns').toBeLessThan(0.75);
    expect(d.top, 'primary top edge vs drawn rows').toBeLessThan(0.75);
  });

  test('resize: corner handle snaps the moving edges; fixed corner stays put; aspect kept', async ({ page }) => {
    await createProjectClean(page, 'Snap Resize BR');
    await addSolidColorImage(page, '#000000');
    const spot = await parkSpot(page);
    // Park the fixed (top-left) corner exactly ON a grid intersection so the
    // aspect-locked moving edges can land on drawn grid lines.
    const home = {
      x: Math.round(spot.x / G) * G,
      y: Math.round(spot.y / G) * G,
    };
    await parkLayer(page, home.x, home.y);
    await selectTool(page, 'select');
    await enableGridViaMenu(page);

    const z = await page.evaluate(() => window.State.zoom);
    const br = await page.evaluate(() => {
      const l = window.State.layers[window.State.layers.length - 1];
      const h = window.Renderer.getHandles(l, window.State.zoom).find(h => h.id === 'br');
      return { x: h.x, y: h.y };
    });
    const r = await page.evaluate(() => {
      const b = document.getElementById('interaction-overlay').getBoundingClientRect();
      return { left: b.left, top: b.top };
    });
    const from = { x: r.left + br.x, y: r.top + br.y };
    // Drag out by (87, 93) page px — past the half-cell so the driven axis
    // grows to the NEXT grid line rather than shrinking back.
    await dragMouse(page, from, { x: from.x + 87 * z, y: from.y + 93 * z });
    await settle(page);

    const l = await getLayer(page);
    // The stationary top-left corner did not move (float dust allowed):
    expect(l.x).toBeCloseTo(home.x, 6);
    expect(l.y).toBeCloseTo(home.y, 6);
    // The moving (bottom-right) edges land on exact grid lines:
    expect(multipleOf(l.x + l.width, G), `right=${l.x + l.width}`).toBeLessThan(EPS);
    expect(multipleOf(l.y + l.height, G), `bottom=${l.y + l.height}`).toBeLessThan(EPS);
    // Corner handles preserve aspect ratio exactly:
    expect(l.width / l.height).toBeCloseTo(l.naturalWidth / l.naturalHeight, 6);
    // The snapped moving edges coincide with drawn grid lines (the fixed
    // corner is on-grid, so edge = grid multiple = drawn line):
    const d = await drawnEdgeDistance(page);
    expect(d.right, 'right edge vs drawn columns').toBeLessThan(0.75);
    expect(d.bottom, 'bottom edge vs drawn rows').toBeLessThan(0.75);
  });

  test('resize: edge handle snaps the dragged edge only', async ({ page }) => {
    await createProjectClean(page, 'Snap Resize MR');
    await addSolidColorImage(page, '#000000');
    const spot = await parkSpot(page);
    await parkLayer(page, spot.x, spot.y);
    await selectTool(page, 'select');
    await enableGridViaMenu(page);

    const z = await page.evaluate(() => window.State.zoom);
    const mr = await page.evaluate(() => {
      const l = window.State.layers[window.State.layers.length - 1];
      const h = window.Renderer.getHandles(l, window.State.zoom).find(h => h.id === 'mr');
      return { x: h.x, y: h.y };
    });
    const r = await page.evaluate(() => {
      const b = document.getElementById('interaction-overlay').getBoundingClientRect();
      return { left: b.left, top: b.top };
    });
    await dragMouse(page,
      { x: r.left + mr.x, y: r.top + mr.y },
      { x: r.left + mr.x + 43 * z, y: r.top + mr.y + 11 * z });
    await settle(page);

    const l = await getLayer(page);
    expect(l.x).toBeCloseTo(spot.x, 6);   // left edge (fixed) untouched
    expect(l.y).toBeCloseTo(spot.y, 6);
    expect(l.height).toBe(600);           // vertical size untouched
    expect(multipleOf(l.x + l.width, G), `right=${l.x + l.width}`).toBeLessThan(EPS);
    const d = await drawnEdgeDistance(page);
    expect(d.right, 'right edge vs drawn columns').toBeLessThan(0.75);
  });

  test('shape: drawing a rectangle snaps its position AND size to grid cells', async ({ page }) => {
    await createProjectClean(page, 'Snap Shape Rect');
    const spot = await parkSpot(page);
    await selectTool(page, 'shape-rect');
    await enableGridViaMenu(page);

    const z = await page.evaluate(() => window.State.zoom);
    const from = await clientForPage(page, spot.x, spot.y);
    await dragMouse(page, from, { x: from.x + 201 * z, y: from.y + 310 * z });
    await settle(page);

    const l = await getLayer(page);
    for (const [k, v] of [['x', l.x], ['y', l.y], ['width', l.width], ['height', l.height]]) {
      expect(multipleOf(v, G), `${k}=${v}`).toBeLessThan(EPS);
    }
    // The rect's edges coincide with drawn grid lines:
    const d = await drawnEdgeDistance(page);
    expect(d.left, 'left edge vs drawn columns').toBeLessThan(0.75);
    expect(d.top, 'top edge vs drawn rows').toBeLessThan(0.75);
  });

  test('shape: drawing an ellipse snaps its bounding box to grid cells', async ({ page }) => {
    await createProjectClean(page, 'Snap Shape Ellipse');
    const spot = await parkSpot(page);
    await selectTool(page, 'shape-ellipse');
    await enableGridViaMenu(page);

    const z = await page.evaluate(() => window.State.zoom);
    const from = await clientForPage(page, spot.x, spot.y);
    await dragMouse(page, from, { x: from.x + 240 * z, y: from.y + 180 * z });
    await settle(page);

    const l = await getLayer(page);
    for (const [k, v] of [['x', l.x], ['y', l.y], ['width', l.width], ['height', l.height]]) {
      expect(multipleOf(v, G), `${k}=${v}`).toBeLessThan(EPS);
    }
  });

  test('text: dragging out a paragraph box snaps it to the grid', async ({ page }) => {
    await createProjectClean(page, 'Snap Text Box');
    const spot = await parkSpot(page);
    await selectTool(page, 'text-box');
    await enableGridViaMenu(page);

    const z = await page.evaluate(() => window.State.zoom);
    const from = await clientForPage(page, spot.x, spot.y);
    await dragMouse(page, from, { x: from.x + 220 * z, y: from.y + 160 * z });
    await settle(page);

    // Assert the committed box geometry BEFORE the text editor commit can
    // reflow it (the editor adjusts height to fit type metrics).
    const l = await getLayer(page);
    expect(l.isText).toBe(true);
    for (const [k, v] of [['x', l.x], ['y', l.y], ['width', l.width], ['height', l.height]]) {
      expect(multipleOf(v, G), `${k}=${v}`).toBeLessThan(0.03); // editor reflow rounding
    }

    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible();
    await editor.fill('Hi');
    await page.keyboard.press('Escape'); // commit
    await settle(page);
  });

  test('zoom invariance: snapping still coincides with the drawn grid at 0.5× and 1×', async ({ page }) => {
    for (const zoom of [0.5, 1]) {
      // Inline project creation (instead of the shared helper) with a DB
      // clear per iteration: back-to-back creations are racy through the
      // shared helper when the app is busy, and each zoom level needs a
      // pristine project for a deterministic park spot.
      await clearIndexedDB(page);
      await gotoApp(page);
      if (await page.locator('#project-dialog').isVisible()) {
        await page.click('#btn-create-new');
        await expect(page.locator('#create-project-dialog')).toBeVisible();
      }
      await page.fill('#create-project-name', `Snap Zoom ${zoom}`);
      await page.click('#btn-create-next');
      await page.locator(`label:has(input[name="create-page-size"][value="half-letter"])`).click();
      await page.click('#btn-create-next');
      await page.click('#btn-create-next'); // Create (step 3 → project)
      await expect(page.locator('#main-app')).toBeVisible({ timeout: 10000 });
      await page.evaluate(() => document.querySelector('.kofi-toast')?.remove());
      await addSolidColorImage(page, '#000000');
      await page.evaluate((z) => {
        window.State.zoom = z;
        window.Renderer.resize();
        window.Renderer.schedule();
      }, zoom);
      await page.waitForTimeout(600);

      const spot = await parkSpot(page);
      await parkLayer(page, spot.x, spot.y);
      await selectTool(page, 'select');
      await enableGridViaMenu(page);

      const z = await page.evaluate(() => window.State.zoom);
      const from = await clientForPage(page, spot.x + 300, spot.y + 300); // layer centre
      await dragMouse(page, from, { x: from.x + 123 * z, y: from.y + 237 * z });
      await settle(page);

      const l = await getLayer(page);
      expect(multipleOf(l.x, G), `zoom ${zoom}: x=${l.x}`).toBeLessThan(EPS);
      expect(multipleOf(l.y, G), `zoom ${zoom}: y=${l.y}`).toBeLessThan(EPS);
      const d = await drawnEdgeDistance(page);
      expect(d.left, `zoom ${zoom}: left edge vs drawn columns`).toBeLessThan(0.75);
      expect(d.top, `zoom ${zoom}: top edge vs drawn rows`).toBeLessThan(0.75);
    }
  });

});

test.describe('Grid snapping negative controls (nothing snaps without a standard grid)', () => {

  test('control: with the grid hidden, drags are NOT snapped', async ({ page }) => {
    await createProjectClean(page, 'No Snap Hidden');
    await addSolidColorImage(page, '#000000');
    const spot = await parkSpot(page);
    await parkLayer(page, spot.x, spot.y);
    await selectTool(page, 'select');
    // Grid stays hidden (default off).

    const z = await page.evaluate(() => window.State.zoom);
    const from = await clientForPage(page, spot.x + 300, spot.y + 300); // layer centre
    await dragMouse(page, from, { x: from.x + 123 * z, y: from.y + 237 * z });
    await settle(page);

    const l = await getLayer(page);
    expect(l.x).toBeCloseTo(spot.x + 123, 3); // un-snapped drag math (float noise ~1e-4)
    expect(l.y).toBeCloseTo(spot.y + 237, 3);
  });

  test('control: an isometric grid is visible but does not snap (diagonal lines)', async ({ page }) => {
    await createProjectClean(page, 'No Snap Iso');
    await addSolidColorImage(page, '#000000');
    const spot = await parkSpot(page);
    await parkLayer(page, spot.x, spot.y);
    await selectTool(page, 'select');
    await setGrid(page, { size: G, type: 'isometric', show: true });
    await expect.poll(() => page.evaluate(() => window.State.showGrid)).toBe(true);

    const z = await page.evaluate(() => window.State.zoom);
    const from = await clientForPage(page, spot.x + 300, spot.y + 300); // layer centre
    await dragMouse(page, from, { x: from.x + 123 * z, y: from.y + 237 * z });
    await settle(page);

    const l = await getLayer(page);
    expect(l.x).toBeCloseTo(spot.x + 123, 3);
    expect(l.y).toBeCloseTo(spot.y + 237, 3);
  });

});
