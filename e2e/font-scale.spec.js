import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addTextLayer } from './helpers.js';

// Regression: scaling a text layer up used to allocate canvases past the
// browser's backing-store envelope (and past what Firefox can hold in memory
// alongside its sibling copies), crashing Firefox. Every processed canvas
// must stay inside the canvas-limits envelope and remain readable.
const MAX_CANVAS_PIXELS = 67108864;

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Text font scaling', () => {
  test('scale a paragraph text layer up via the corner handle', async ({ page }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await createProject(page, 'Font Scale');
    await addTextLayer(page, 'Hello Firefox this is a much longer paragraph of text that will wrap into several lines inside the box when scaled up.');

    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const l = State.layers.find(x => x.isText);
      l.x = 100; l.y = 100;
      State.selectedId = l.id;
      State.selectedIds = [l.id];
      State.zoom = 2;
      Renderer.resize();
      Renderer.schedule();
      UI.refreshLayerList();
      UI.refreshProperties();
    });
    await page.waitForTimeout(200);

    const box = await page.locator('#interaction-overlay').boundingBox();
    const handles = await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const l = State.layers.find(x => x.isText);
      return Renderer.getHandles(l, State.zoom);
    });
    const br = handles.find(h => h.id === 'br');
    const tl = handles.find(h => h.id === 'tl');
    if (!br) throw new Error('br handle not found');
    const sx = box.x + br.x, sy = box.y + br.y;

    const factor = 30;
    const steps = [];
    for (let k = 1; k <= 6; k++) {
      const e = k === 6 ? factor : 1 + (factor - 1) * (k / 6);
      steps.push({ dx: (br.x - tl.x) * (e - 1), dy: (br.y - tl.y) * (e - 1) });
    }
    await page.evaluate(({ sx, sy, steps }) => {
      const el = document.getElementById('interaction-overlay');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      const opts = { pointerId: 42, isPrimary: true, bubbles: true, cancelable: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy, buttons: 1 }));
      let lastX = sx, lastY = sy;
      for (const s of steps) {
        const nx = sx + s.dx, ny = sy + s.dy;
        lastX = nx; lastY = ny;
        el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: nx, clientY: ny, buttons: 1 }));
      }
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: lastX, clientY: lastY, buttons: 0 }));
      el.setPointerCapture = orig;
    }, { sx, sy, steps });
    await page.waitForTimeout(1000);

    const after = await page.evaluate(() => {
      const l = State.layers.find(x => x.isText);
      const proc = l._processedCanvas;
      let alive = false;
      if (proc) { try { proc.getContext('2d').getImageData(0, 0, 1, 1); alive = true; } catch (e) { alive = 'DEAD: ' + e.name; } }
      return {
        font: l.textFontSize,
        natural: { w: l.naturalWidth, h: l.naturalHeight },
        proc: proc && { w: proc.width, h: proc.height, px: proc.width * proc.height },
        alive,
      };
    });
    console.log('AFTER-PARA', JSON.stringify(after));
    console.log('ERRORS', JSON.stringify(errors));

    expect(after.font).toBeGreaterThan(96);
    expect(after.proc).toBeTruthy();
    expect(after.alive).toBe(true);
    expect(after.proc.px).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(errors).toEqual([]);
  });

  test('scale a single-line (point type) text layer up via the corner handle', async ({ page }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await createProject(page, 'Font Scale Line');
    await addTextLayer(page, 'Hello');
    await page.evaluate(async () => {
      const l = State.layers.find(x => x.isText);
      l.textMode = 'line';
      l.text = 'NEEDAWIDERUNXYZ  '.repeat(3) + 'END';
      l._originalCanvas = null; l._exportOriginalCanvas = null; l._dirty = true;
      const { DB } = await import('/src/app/db.js');
      await DB.saveLayer(l);
    });

    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const l = State.layers.find(x => x.isText);
      l.x = 100; l.y = 100;
      State.selectedId = l.id;
      State.selectedIds = [l.id];
      State.zoom = 2;
      Renderer.resize();
      Renderer.schedule();
      UI.refreshLayerList();
      UI.refreshProperties();
    });
    await page.waitForTimeout(200);

    const box = await page.locator('#interaction-overlay').boundingBox();
    const handles = await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const l = State.layers.find(x => x.isText);
      return Renderer.getHandles(l, State.zoom);
    });
    const br = handles.find(h => h.id === 'br');
    const tl = handles.find(h => h.id === 'tl');
    if (!br) throw new Error('br handle not found');
    const sx = box.x + br.x, sy = box.y + br.y;

    const factor = 16;
    const steps = [];
    for (let k = 1; k <= 4; k++) {
      const e = k === 4 ? factor : 1 + (factor - 1) * (k / 4);
      steps.push({ dx: (br.x - tl.x) * (e - 1), dy: (br.y - tl.y) * (e - 1) });
    }
    await page.evaluate(({ sx, sy, steps }) => {
      const el = document.getElementById('interaction-overlay');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      const opts = { pointerId: 42, isPrimary: true, bubbles: true, cancelable: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy, buttons: 1 }));
      let lastX = sx, lastY = sy;
      for (const s of steps) {
        const nx = sx + s.dx, ny = sy + s.dy;
        lastX = nx; lastY = ny;
        el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: nx, clientY: ny, buttons: 1 }));
      }
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: lastX, clientY: lastY, buttons: 0 }));
      el.setPointerCapture = orig;
    }, { sx, sy, steps });
    await page.waitForTimeout(1000);

    const after = await page.evaluate(() => {
      const l = State.layers.find(x => x.isText);
      const proc = l._processedCanvas;
      let alive = false;
      if (proc) { try { proc.getContext('2d').getImageData(0, 0, 1, 1); alive = true; } catch (e) { alive = 'DEAD: ' + e.name; } }
      return {
        font: l.textFontSize,
        natural: { w: l.naturalWidth, h: l.naturalHeight },
        proc: proc && { w: proc.width, h: proc.height, px: proc.width * proc.height },
        alive,
      };
    });
    console.log('AFTER-LINE', JSON.stringify(after));
    console.log('ERRORS', JSON.stringify(errors));

    expect(after.font).toBeGreaterThan(96);
    expect(after.proc).toBeTruthy();
    expect(after.alive).toBe(true);
    expect(after.proc.px).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(errors).toEqual([]);
  });
});
