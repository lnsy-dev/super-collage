import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, selectTool, addImageFromBuffer, createSolidPngBuffer } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/* helpers -------------------------------------------------------------- */

// A solid-image layer sized so the OLD full-layer composite buffer
// (layer.width × zoom by layer.height × zoom) exceeded the 2M-px spy
// threshold at zoom 2 — that per-frame allocation was the choppiness.
const LAYER_W = 1024, LAYER_H = 1024;

async function setImageLayer(page, hex) {
  await addImageFromBuffer(
    page, createSolidPngBuffer(hex, LAYER_W, LAYER_H), { name: `solid-${hex}.png` });
  await page.waitForFunction(() => {
    const l = window.State.layers[0];
    return l && !!l._processedCanvas;
  }, null, { timeout: 15000 });
}

/** The canvas is the full page at zoom scale (no overlay padding); the
 *  scroll container positions it via a margin (offsetLeft/Top). */
async function canvasOffset(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('display-canvas');
    return {
      offX: canvas.offsetLeft + (canvas.offsetParent?.offsetLeft ?? 0),
      offY: canvas.offsetTop + (canvas.offsetParent?.offsetTop ?? 0),
    };
  });
}

/** Center the visible viewport on a page-space point. */
async function centerViewportOn(page, px, py) {
  const off = await canvasOffset(page);
  await page.evaluate(({ px, py, offX, offY }) => {
    const scroll = document.getElementById('canvas-scroll');
    const z = window.State.zoom;
    scroll.scrollLeft = Math.max(0, Math.min(offX + px * z - scroll.clientWidth / 2, scroll.scrollWidth - scroll.clientWidth));
    scroll.scrollTop = Math.max(0, Math.min(offY + py * z - scroll.clientHeight / 2, scroll.scrollHeight - scroll.clientHeight));
  }, { px, py, offX: off.offX, offY: off.offY });
  await page.waitForTimeout(200); // scroll -> schedule -> rAF draw
}

async function zoomTo(page, target = 2) {
  await page.evaluate((target) => {
    window.State.zoom = target;
    window.Renderer.resize();
  }, target);
  await page.waitForTimeout(400); // resize debounce + scheduled draw
}

/** Dirty layers only reprocess once they intersect the viewport; center the
 *  viewport on a point and wait for the reprocessing to settle. */
async function centerAndWait(page, px, py) {
  await centerViewportOn(page, px, py);
  await page.waitForFunction(() => !window.State.layers.some(l => l._dirty),
    null, { timeout: 15000 });
  await page.waitForTimeout(100); // let the post-process repaint land
}

async function installAllocSpy(page) {
  await page.evaluate(() => {
    const Real = window.OffscreenCanvas;
    window.__allocSpy = { recording: false, big: [] };
    window.OffscreenCanvas = function (w, h, ...rest) {
      if (window.__allocSpy.recording && w * h >= 2_000_000) {
        window.__allocSpy.big.push({ w, h });
      }
      return new Real(w, h, ...rest);
    };
    window.OffscreenCanvas.prototype = Real.prototype;
  });
}

async function allocRecord(page, fn) {
  await page.evaluate(() => { window.__allocSpy.big = []; window.__allocSpy.recording = true; });
  await fn();
  await page.evaluate(() => { window.__allocSpy.recording = false; });
  return page.evaluate(() => window.__allocSpy.big);
}

async function layerCenter(page) {
  return page.evaluate(() => {
    const l = window.State.layers[0];
    return { px: l.x + l.width / 2, py: l.y + l.height / 2 };
  });
}

/** Mouse (screen) point over a page-space position — the overlay is the input surface. */
async function screenPoint(page, px, py) {
  return page.evaluate(async ({ px, py }) => {
    const z = window.State.zoom;
    const canvas = document.getElementById('display-canvas');
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + px * z, y: rect.top + py * z };
  }, { px, py });
}

/* tests ---------------------------------------------------------------- */

test.describe('Zoomed-in rendering culling (mask painting)', () => {
  test('mask painting at high zoom stops allocating full-layer composite buffers', async ({ page }) => {
    await createProject(page, 'Culling Alloc Test');
    await setImageLayer(page, '#010101');
    await zoomTo(page);
    const center = await layerCenter(page);
    await centerAndWait(page, center.px, center.py);
    await selectTool(page, 'mask-draw');
    await installAllocSpy(page);
    const pt = await screenPoint(page, center.px, center.py);

    // Paint a mask stroke, recording allocations while the app redraws.
    const bigAllocs = await allocRecord(page, async () => {
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(pt.x - 128 + i * 8, pt.y + i * 4);
        await page.waitForTimeout(40);
      }
      await page.mouse.up();
      await page.waitForTimeout(200);
    });

    // The paint must have happened…
    const maskAlpha = await page.evaluate(() => {
      const l = window.State.layers[0];
      const d = l._maskCanvas.getContext('2d').getImageData(
        Math.floor(l._maskCanvas.width / 2), Math.floor(l._maskCanvas.height / 2), 1, 1).data;
      return d[3];
    });
    expect(maskAlpha).toBe(0);
    // …without a single multi-megapixel offscreen allocation: the sliced
    // composite buffer fits the viewport, not the whole zoomed layer.
    expect(bigAllocs).toEqual([]);
  });

  test('clipped on-screen draw matches an uncullable full draw inside the viewport', async ({ page }) => {
    await createProject(page, 'Culling Fidelity Test');
    await setImageLayer(page, '#f65058');
    await zoomTo(page);
    const center = await layerCenter(page);
    await centerAndWait(page, center.px, center.py);
    // Punch a painted-mask hole, so the sliced compositing path actually runs.
    await selectTool(page, 'mask-draw');
    const base = await layerCenter(page);
    const pt = await screenPoint(page, base.px - 100, base.py);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 60, pt.y + 30);
    await page.mouse.move(pt.x + 120, pt.y - 20);
    await page.mouse.up();
    // Move the viewport a bit so the live slice does not coincide with the
    // painted area's viewport-center position.
    await centerAndWait(page, base.px - 250, base.py - 130);

    const diffs = await page.evaluate(async ({ px, py }) => {
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
      // Reference: uncullable full draw into a scratch canvas.
      const ref = new OffscreenCanvas(Math.round(CANVAS_W * window.State.zoom), Math.round(CANVAS_H * window.State.zoom));
      const refCtx = ref.getContext('2d', { willReadFrequently: true });
      await window.Renderer.drawLayers(refCtx, window.State.layers, ref.width, ref.height, window.State.zoom, true);
      // Actual: the live clipped display draw.
      const display = document.getElementById('display-canvas');
      const scroll = document.getElementById('canvas-scroll');
      const offX = display.offsetLeft + (display.offsetParent?.offsetLeft ?? 0);
      const offY = display.offsetTop + (display.offsetParent?.offsetTop ?? 0);
      // Sample the drawn viewport, inset from the slice margins.
      const vx = scroll.scrollLeft - offX + 16;
      const vy = scroll.scrollTop - offY + 16;
      const vw = scroll.clientWidth - 32;
      const vh = scroll.clientHeight - 32;
      const live = display.getContext('2d', { willReadFrequently: true }).getImageData(vx, vy, vw, vh).data;
      const exp = refCtx.getImageData(vx, vy, vw, vh).data;
      let mismatch = 0, worst = 0;
      for (let i = 0; i < live.length; i++) {
        const d = Math.abs(live[i] - exp[i]);
        if (d > 0) { mismatch++; worst = Math.max(worst, d); }
      }
      return { mismatch, worst, pixels: live.length / 4 };
    }, { px: 0, py: 0 });
    expect(diffs.pixels).toBeGreaterThan(0);
    expect(diffs.worst).toBeLessThanOrEqual(1); // antialiased sampled edge rounding at most
  });

  test('scrolling to a far region renders that region (no stale blank edges)', async ({ page }) => {
    await createProject(page, 'Culling Scroll Test');
    // Solid black ink: prints opaque and dark over paper, so any blank
    // (paper-white) patch is a rendering miss, not pale-ink blending.
    await setImageLayer(page, '#010101');
    await zoomTo(page);
    // Jump the viewport straight to the layer's 75% quadrant — canvas
    // content the earlier frames never drew, reached purely by scrolling.
    const probe = await page.evaluate(() => {
      const l = window.State.layers[0];
      return {
        px: l.x + l.width * 0.75,
        py: l.y + l.height * 0.75,
        zoom: window.State.zoom,
      };
    });
    await centerAndWait(page, probe.px, probe.py);
    await page.evaluate(async () => { await window.Renderer.draw(); });
    await page.waitForTimeout(500);

    const rgb = await page.evaluate(() => {
      const canvas = document.getElementById('display-canvas');
      const scroll = document.getElementById('canvas-scroll');
      const offX = canvas.offsetLeft + (canvas.offsetParent?.offsetLeft ?? 0);
      const offY = canvas.offsetTop + (canvas.offsetParent?.offsetTop ?? 0);
      const vx = scroll.scrollLeft - offX;
      const vy = scroll.scrollTop - offY;
      const ds = window.Renderer?._displayScale || 1;
      const sampleX = Math.round((vx + scroll.clientWidth / 2 - 10) * ds);
      const sampleY = Math.round((vy + scroll.clientHeight / 2 - 10) * ds);
      const size = Math.max(1, Math.round(20 * ds));
      // A patch at the viewport center — deep inside the drawn slice.
      const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(
        sampleX, sampleY, size, size).data;
      let inked = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] + d[i + 1] + d[i + 2] < 720) inked++; // not pure white paper
      }
      return { inked, total: d.length / 4 };
    });
    // The layer's 75% quadrant prints ink there — a mostly-inked patch,
    // not a blank paper rectangle.
    expect(rgb.inked).toBeGreaterThan(rgb.total * 0.6);
  });
});
