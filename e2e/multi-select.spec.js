import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, reopenProject } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/**
 * Three large, non-overlapping image layers plus client-space click/drag
 * points (overlay-box relative) for their centers and the first two layers'
 * bottom-right resize handles. All interactions dispatch PointerEvents
 * directly on the interaction overlay (the technique transform.spec.js uses)
 * so viewport clipping can never eat a drag.
 */
async function setupLayers(page) {
  await createProject(page, 'Multi Select Transform');
  await addImage(page, TEST_IMAGE);
  await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
  await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(3);

  await page.evaluate(() => {
    const [l1, l2, l3] = State.layers;
    const place = (l, x, y) => { l.x = x; l.y = y; l.width = 400; l.height = 200; l.rotation = 0; };
    place(l1, 100, 100);
    place(l2, 800, 500);
    place(l3, 1500, 900);
    State.zoom = 1;
    Renderer.resize(); Renderer.schedule();
    State.selectedId = null; State.selectedIds = [];
  });
  await page.waitForTimeout(200);

  return page.evaluate(() => {
    const box = document.getElementById('interaction-overlay').getBoundingClientRect();
    const z = State.zoom, pad = 1000;
    const center = l => ({ x: box.x + (l.x + l.width / 2 + pad) * z, y: box.y + (l.y + l.height / 2 + pad) * z });
    const brHandle = l => {
      const h = Renderer.getHandles(l, State.zoom).find(h => h.id === 'br');
      return { x: box.x + h.x, y: box.y + h.y };
    };
    return {
      centers: State.layers.map(center),
      brs: State.layers.map(brHandle),
    };
  });
}

/** Dispatch a press (+drag) sequence of raw PointerEvents on the overlay. */
async function pressDrag(page, sx, sy, ex, ey, { shift = false, moveSteps = 4 } = {}) {
  await page.evaluate(({ sx, sy, ex, ey, shift, moveSteps }) => {
    const el = document.getElementById('interaction-overlay');
    const orig = el.setPointerCapture;
    el.setPointerCapture = () => {};
    const base = { pointerId: 42, isPrimary: true, bubbles: true, cancelable: true, shiftKey: shift };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: sx, clientY: sy, buttons: 1 }));
    for (let i = 1; i <= moveSteps; i++) {
      el.dispatchEvent(new PointerEvent('pointermove', {
        ...base,
        clientX: sx + (ex - sx) * i / moveSteps,
        clientY: sy + (ey - sy) * i / moveSteps,
        buttons: 1,
      }));
    }
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: ex, clientY: ey, buttons: 0 }));
    el.setPointerCapture = orig;
  }, { sx, sy, ex, ey, shift, moveSteps });
  await page.waitForTimeout(150);
}

async function selectTwo(page, pts) {
  await pressDrag(page, pts.centers[0].x, pts.centers[0].y, pts.centers[0].x, pts.centers[0].y);
  await pressDrag(page, pts.centers[1].x, pts.centers[1].y, pts.centers[1].x, pts.centers[1].y, { shift: true });
  return page.evaluate(() => ({
    ids: [...State.selectedIds], primary: State.selectedId,
  }));
}

const geo = page => page.evaluate(() => window.State.layers.map(l => ({
  id: l.id, x: l.x, y: l.y, width: l.width, height: l.height,
})));

test.describe('Multi-select', () => {
  test('pressing an already-selected member keeps the multi-selection and promotes it to primary', async ({ page }) => {
    const pts = await setupLayers(page);
    const layerIds = await page.evaluate(() => window.State.layers.map(l => l.id));
    await selectTwo(page, pts);
    await expect(page.locator('.layer-row.selected')).toHaveCount(2);

    // A plain press on the first member must not collapse the selection.
    await pressDrag(page, pts.centers[0].x, pts.centers[0].y, pts.centers[0].x, pts.centers[0].y);
    let sel = (await selection(page));
    expect(sel.ids).toHaveLength(2);
    expect(sel.primary).toBe(layerIds[0]);

    // Same for the second member: selection kept, primary follows the press.
    await pressDrag(page, pts.centers[1].x, pts.centers[1].y, pts.centers[1].x, pts.centers[1].y);
    sel = (await selection(page));
    expect(sel.ids).toHaveLength(2);
    expect(sel.primary).toBe(layerIds[1]);

    // A plain press on a layer OUTSIDE the selection still re-selects it alone.
    await pressDrag(page, pts.centers[2].x, pts.centers[2].y, pts.centers[2].x, pts.centers[2].y);
    sel = (await selection(page));
    expect(sel.ids).toEqual([layerIds[2]]);

    // Pressing empty canvas still clears the whole selection.
    await pressDrag(page, pts.centers[2].x + 40, pts.centers[2].y + 300, pts.centers[2].x + 40, pts.centers[2].y + 300);
    sel = (await selection(page));
    expect(sel.ids).toHaveLength(0);
  });

  test('click-drag moves every selected layer by the same delta', async ({ page }) => {
    const pts = await setupLayers(page);
    await selectTwo(page, pts);
    const before = await geo(page);
    const sel = await selection(page);

    // Drag the primary (second member, last shift-clicked) by +40/+40 screen px.
    await pressDrag(page, pts.centers[1].x, pts.centers[1].y, pts.centers[1].x + 40, pts.centers[1].y + 40);

    const after = await geo(page);
    const prim = before.findIndex(l => l.id === sel.primary);
    const other = before.findIndex(l => l.id !== sel.primary);
    expect(after[prim].x).toBeCloseTo(before[prim].x + 40, 6);
    expect(after[prim].y).toBeCloseTo(before[prim].y + 40, 6);
    expect(after[other].x).toBeCloseTo(before[other].x + 40, 6);
    expect(after[other].y).toBeCloseTo(before[other].y + 40, 6);
    expect(after).toHaveLength(3);
  });

  test('dragging the primary resize handle scales every selected layer by the same factor', async ({ page }) => {
    const pts = await setupLayers(page);
    await selectTwo(page, pts);
    const before = await geo(page);
    const ids = (await selection(page)).ids;

    // Drag the primary's bottom-right corner by +50 screen px (zoom 1 → 50 page px).
    await pressDrag(page, pts.brs[1].x, pts.brs[1].y, pts.brs[1].x + 50, pts.brs[1].y + 50);

    const after = await geo(page);
    const primIdx = before.findIndex(l => l.id === ids[1]);
    const extraIdx = before.findIndex(l => l.id === ids[0]);

    const scalePrimary = after[primIdx].width / before[primIdx].width;
    expect(after[primIdx].height / before[primIdx].height).toBeCloseTo(scalePrimary, 6);
    // Every selected member resizes by the same scale factor…
    expect(after[extraIdx].width / before[extraIdx].width).toBeCloseTo(scalePrimary, 6);
    expect(after[extraIdx].height / before[extraIdx].height).toBeCloseTo(scalePrimary, 6);
    // …and follows the primary's own translation (zero for a br-corner
    // resize, whose top-left corner stays pinned).
    expect(after[primIdx].x).toBeCloseTo(before[primIdx].x, 6);
    expect(after[primIdx].y).toBeCloseTo(before[primIdx].y, 6);
    expect(after[extraIdx].x).toBeCloseTo(before[extraIdx].x, 6);
    expect(after[extraIdx].y).toBeCloseTo(before[extraIdx].y, 6);

    // The multi-selection survives the resize gesture.
    expect((await selection(page)).ids).toHaveLength(2);
  });

  test('group resize persists after a project reload', async ({ page }) => {
    const pts = await setupLayers(page);
    await selectTwo(page, pts);
    const ids = (await selection(page)).ids;
    await pressDrag(page, pts.brs[1].x, pts.brs[1].y, pts.brs[1].x + 50, pts.brs[1].y + 50);
    const afterResize = await geo(page);
    const expectIds = afterResize.map(l => l.id).sort();

    await reopenProject(page, 'Multi Select Transform');
    // Pointerup saves every affected layer once; the reload must come back
    // from IndexedDB with exactly the post-resize geometry.
    await expect.poll(async () => {
      const loaded = await geo(page);
      // Only the resized layers were written; compare those.
      return afterResize.filter(g => ids.includes(g.id)).every(g => {
        const l = loaded.find(x => x.id === g.id);
        return l && Math.abs(l.x - g.x) < 0.5 && Math.abs(l.y - g.y) < 0.5
          && Math.abs(l.width - g.width) < 0.5 && Math.abs(l.height - g.height) < 0.5;
      });
    }, { timeout: 20000 }).toBe(true);
    // Layer identity is preserved for every layer (order can differ after a reload).
    const finalIds = (await geo(page)).map(l => l.id).sort();
    expect(finalIds).toEqual(expectIds);
  });

  test('group drag writes each layer once on pointerup, not on every pointermove', async ({ page }) => {
    const pts = await setupLayers(page);
    await selectTwo(page, pts);

    await page.evaluate(() => {
      window.__saveCounts = { move: 0, up: 0 };
      window.__phase = 'idle';
      const orig = DB.saveLayer.bind(DB);
      DB.saveLayer = layer => {
        // The up-handler saves while State.drag is still set, so phases are
        // tracked from document-level capture listeners instead (they fire
        // before the overlay's own handlers).
        if (window.__phase === 'move') window.__saveCounts.move++;
        if (window.__phase === 'up') window.__saveCounts.up++;
        return orig(layer);
      };
      document.addEventListener('pointermove', () => { window.__phase = 'move'; }, true);
      document.addEventListener('pointerup', () => { window.__phase = 'up'; }, true);
    });

    // 24 pointermove events during the drag: zero saves should happen mid-drag.
    await pressDrag(page, pts.centers[1].x, pts.centers[1].y, pts.centers[1].x + 60, pts.centers[1].y + 60, { moveSteps: 24 });

    const counts = await page.evaluate(() => window.__saveCounts);
    expect(counts.move).toBe(0);
    // Exactly one deferred save per transformed layer at pointerup.
    expect(counts.up).toBe(2);
  });

  test('drag coalesces properties-panel refreshes to one per frame', async ({ page }) => {
    const pts = await setupLayers(page);
    await selectTwo(page, pts);

    await page.evaluate(() => {
      window.__propsRefreshes = 0;
      const orig = UI.refreshProperties.bind(UI);
      UI.refreshProperties = (...args) => {
        window.__propsRefreshes++;
        return orig(...args);
      };
    });

    // 24 pointermove events in one tick: 1 sync refresh on pointerdown plus
    // at most one rAF-coalesced refresh regardless of the event rate.
    await pressDrag(page, pts.centers[1].x, pts.centers[1].y, pts.centers[1].x + 60, pts.centers[1].y + 60, { moveSteps: 24 });
    await page.waitForTimeout(120);

    const refreshes = await page.evaluate(() => window.__propsRefreshes);
    expect(refreshes).toBeGreaterThanOrEqual(1);
    expect(refreshes).toBeLessThanOrEqual(3);

    // The panel still ends up showing the dragged layer's final geometry.
    const props = await page.evaluate(() => ({
      x: Number(document.getElementById('prop-x').value),
      y: Number(document.getElementById('prop-y').value),
    }));
    expect(props.x).toBeCloseTo(await page.evaluate(() => State.layers.find(l => l.id === State.selectedId).x), 1);
    expect(props.y).toBeCloseTo(await page.evaluate(() => State.layers.find(l => l.id === State.selectedId).y), 1);
  });
});

const selection = page => page.evaluate(() => ({
  ids: [...State.selectedIds], primary: State.selectedId,
}));
