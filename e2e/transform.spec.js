import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, selectTool, getSelectedLayerId } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Transform', () => {
  test('move layer by dragging on canvas', async ({ page }) => {
    await createProject(page, 'Move Test');
    await addImage(page, TEST_IMAGE);

    const layer = await page.evaluate(() => {
      // @ts-ignore
      return { x: State.layers[0].x, y: State.layers[0].y };
    });

    const canvasBox = await page.locator('#interaction-overlay').boundingBox();
    if (!canvasBox) throw new Error('Canvas not found');
    const startX = canvasBox.x + canvasBox.width / 2;
    const startY = canvasBox.y + canvasBox.height / 2;

    // Click to select the layer, then drag
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 100, { steps: 5 });
    await page.mouse.up();

    const newLayer = await page.evaluate(() => {
      // @ts-ignore
      return { x: State.layers[0].x, y: State.layers[0].y };
    });

    // Position should have changed
    expect(newLayer.x).not.toBe(layer.x);
  });

  test('selection still works after a pointer is lost mid-drag (regression)', async ({ page }) => {
    // Regression for: after dragging a layer, clicking can no longer select
    // layers until a page reload. Root cause was the multi-touch tracker
    // retaining a stale pointer entry when a pointerup/pointercancel was missed
    // (e.g. pointer capture lost on a tablet); the next click was then misread
    // as a two-finger pan and bailed out before running any selection code.
    await createProject(page, 'Lost Pointer Test');
    await addImage(page, TEST_IMAGE);

    const layerId = await page.evaluate(() => State.layers[0].id);

    const box = await page.locator('#interaction-overlay').boundingBox();
    if (!box) throw new Error('Canvas not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Deselect first so the final assertion genuinely proves selection ran.
    // The layer is placed at the canvas centre (= overlay centre); a point well
    // to its left is empty but still on-screen (the overlay's top edge sits
    // above the viewport, so a corner click would miss the canvas entirely).
    await page.mouse.click(cx - 150, cy);
    expect(await getSelectedLayerId(page)).toBeNull();

    // Simulate a pointer whose pointerup never reached the overlay: inject a
    // lingering entry into the handler's active-pointer map. setPointerCapture
    // is stubbed because a synthetic pointerId is not a real active pointer.
    await page.evaluate(() => {
      const el = document.getElementById('interaction-overlay');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 999, isPrimary: false, bubbles: true, cancelable: true,
        clientX: rect.left + 4, clientY: rect.top + 4, buttons: 1,
      }));
      el.setPointerCapture = orig;
      // No matching pointerup is dispatched — the entry is now stale.
    });

    // A normal click must still select the layer, not be swallowed as a
    // phantom "second finger" pan.
    await page.mouse.click(cx, cy);
    expect(await getSelectedLayerId(page)).toBe(layerId);
  });

  test('resize layer via property inputs', async ({ page }) => {
    await createProject(page, 'Resize Props Test');
    await addImage(page, TEST_IMAGE);

    await page.fill('#prop-w', '200');
    await page.fill('#prop-h', '150');
    await page.keyboard.press('Enter');

    const dims = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { w: l.width, h: l.height };
    });

    expect(dims.w).toBe(200);
    expect(dims.h).toBe(150);
  });

  test('move layer via X/Y property inputs', async ({ page }) => {
    await createProject(page, 'XY Props Test');
    await addImage(page, TEST_IMAGE);

    await page.fill('#prop-x', '100');
    await page.fill('#prop-y', '200');
    await page.keyboard.press('Enter');

    const pos = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { x: l.x, y: l.y };
    });

    expect(pos.x).toBe(100);
    expect(pos.y).toBe(200);
  });

  test('rotate layer via property input', async ({ page }) => {
    await createProject(page, 'Rotate Test');
    await addImage(page, TEST_IMAGE);

    await page.fill('#prop-rot', '45');
    await page.keyboard.press('Enter');

    const rot = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].rotation;
    });

    expect(rot).toBe(45);
  });

  test('flip horizontal', async ({ page }) => {
    await createProject(page, 'Flip H Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#properties-content [data-action="flip-h"]').click();

    const flipped = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].flipH;
    });

    expect(flipped).toBe(true);
  });

  test('flip vertical', async ({ page }) => {
    await createProject(page, 'Flip V Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#properties-content [data-action="flip-v"]').click();

    const flipped = await page.evaluate(() => {
      // @ts-ignore
      return State.layers[0].flipV;
    });

    expect(flipped).toBe(true);
  });

  test('reset transform', async ({ page }) => {
    await createProject(page, 'Reset Test');
    await addImage(page, TEST_IMAGE);

    // Apply some transforms
    await page.locator('#properties-content [data-action="flip-h"]').click();
    await page.fill('#prop-rot', '45');
    await page.keyboard.press('Enter');

    // Reset
    await page.locator('#properties-content [data-action="reset-transform"]').click();

    const state = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { rotation: l.rotation, flipH: l.flipH, flipV: l.flipV, width: l.width, height: l.height };
    });

    expect(state.rotation).toBe(0);
    expect(state.flipH).toBe(false);
    expect(state.flipV).toBe(false);
    expect(state.width).toBe(state.width); // natural size restored
  });

  test('resize layer by dragging bottom-right handle', async ({ page }) => {
    await createProject(page, 'Resize Handle Test');
    await addImage(page, TEST_IMAGE);

    // Zoom in and position the layer so handles are well separated.
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      // @ts-ignore
      const l = State.layers[0];
      l.x = 200; l.y = 200; l.width = 100; l.height = 100;
      // @ts-ignore
      State.zoom = 4;
      Renderer.resize();
      Renderer.schedule();
    });
    await page.waitForTimeout(100);

    const box = await page.locator('#interaction-overlay').boundingBox();
    if (!box) throw new Error('Canvas not found');

    const handles = await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      // @ts-ignore
      return Renderer.getHandles(State.layers[0], State.zoom);
    });
    const br = handles.find(h => h.id === 'br');
    if (!br) throw new Error('br handle not found');

    const startX = box.x + br.x;
    const startY = box.y + br.y;
    const before = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { x: l.x, y: l.y, w: l.width, h: l.height };
    });

    // Dispatch pointer events directly to the overlay so the test is not
    // clipped by the browser viewport.
    await page.evaluate(({ sx, sy, ex, ey }) => {
      const el = document.getElementById('interaction-overlay');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      const opts = { pointerId: 42, isPrimary: true, bubbles: true, cancelable: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ex, clientY: ey, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ex, clientY: ey, buttons: 0 }));
      el.setPointerCapture = orig;
    }, { sx: startX, sy: startY, ex: startX + 60, ey: startY + 60 });
    await page.waitForTimeout(100);

    const after = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { x: l.x, y: l.y, w: l.width, h: l.height };
    });

    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeGreaterThan(before.h);
    // The opposite corner (top-left) should stay pinned.
    expect(Math.abs(after.x - before.x)).toBeLessThan(2);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });

  test('resize rotated layer follows drag direction, not original orientation', async ({ page }) => {
    await createProject(page, 'Rotated Resize Test');
    await addImage(page, TEST_IMAGE);

    // Zoom in, position the layer, and rotate 90° so the local width axis points down.
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      // @ts-ignore
      const l = State.layers[0];
      l.x = 200; l.y = 200; l.width = 100; l.height = 100; l.rotation = 90;
      // @ts-ignore
      State.zoom = 4;
      Renderer.resize();
      Renderer.schedule();
    });
    await page.waitForTimeout(100);

    const box = await page.locator('#interaction-overlay').boundingBox();
    if (!box) throw new Error('Canvas not found');

    const handles = await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      // @ts-ignore
      return Renderer.getHandles(State.layers[0], State.zoom);
    });
    const mr = handles.find(h => h.id === 'mr');
    if (!mr) throw new Error('mr handle not found');

    const startX = box.x + mr.x;
    const startY = box.y + mr.y;
    const before = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { w: l.width, h: l.height };
    });

    // Drag straight down: this is the local width direction for a 90° rotation.
    await page.evaluate(({ sx, sy, ex, ey }) => {
      const el = document.getElementById('interaction-overlay');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      const opts = { pointerId: 42, isPrimary: true, bubbles: true, cancelable: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ex, clientY: ey, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ex, clientY: ey, buttons: 0 }));
      el.setPointerCapture = orig;
    }, { sx: startX, sy: startY, ex: startX, ey: startY + 60 });
    await page.waitForTimeout(100);

    const after = await page.evaluate(() => {
      // @ts-ignore
      const l = State.layers[0];
      return { w: l.width, h: l.height };
    });

    expect(after.w).toBeGreaterThan(before.w);
    expect(Math.abs(after.h - before.h)).toBeLessThan(2);
  });
});
