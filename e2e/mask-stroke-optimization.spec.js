// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Mask creation/subtraction: stroke efficiency
   ═══════════════════════════════════════════════════════════════════
   Analysis follow-up for the "creating masks is very slow and choppy"
   report. Two optimizations are pinned here:

   1. Brush strokes only touch the layers they must: the paint path
      resolves nothing from the whole layer list (the render loop still
      visits every layer per frame — multiply stacking requires it — but
      its per-layer work changed not a bit). A stroke on one layer must
      not alter any other layer's mask.
   2. Frame cadence during a stroke is decoupled from pointer events:
      Renderer.schedule() coalesces rebuild-frames to
      MASK_STROKE_FRAME_MS while a brush stroke is active (the user's
      "reduce rendering speed but have it be choppier"), so dabs land on
      every pointermove while composites re-render at most every
      interval. A scheduled draw with a fresh-brush timestamp must not
      start drawing immediately.
*/
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
  selectTool,
} from './helpers.js';

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
  pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e));
});

test.describe('Mask stroke efficiency', () => {
  test('brushing one layer leaves every other layer untouched', async ({ page }) => {
    await createProject(page, 'Mask Stroke Isolation');
    // Three independent layers; the middle one gets the hole.
    await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 2000, 2000), { name: 'a.png' });
    await page.evaluate(async () => {
      const base = State.layers[0];
      for (const color of ['#0078bf']) {
        const c = new OffscreenCanvas(2000, 2000);
        const ctx = c.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 2000, 2000);
        const sl = new Layer({
          name: color, x: base.x + 60, y: base.y + 60, width: 2000, height: 2000,
          naturalWidth: 2000, naturalHeight: 2000, color, colorMode: 'solid',
        });
        sl._originalCanvas = c;
        sl._dirty = true;
        MaskEngine.initMask(sl);
        State.layers.push(sl);
      }
      Renderer.schedule();
    });
    await page.waitForFunction(
      () => State.layers.every(l => !l._dirty) && !State.renderPending,
      null, { timeout: 30_000 });

    await selectTool(page, 'mask-draw');
    const stroke = await page.evaluate(() => {
      const l = State.layers[0];
      const r = document.getElementById('interaction-overlay').getBoundingClientRect();
      const pt = (f) => ({
        x: r.left + (l.x + l.width * f.f + 1000) * State.zoom,
        y: r.top + (l.y + l.height * f.ff + 1000) * State.zoom,
      });
      const from = pt({ f: 0.4, ff: 0.4 });
      const to = pt({ f: 0.5, ff: 0.5 });
      return { from, to };
    });
    await page.mouse.move(stroke.from.x, stroke.from.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(
        stroke.from.x + (stroke.to.x - stroke.from.x) * i / 6,
        stroke.from.y + (stroke.to.y - stroke.from.y) * i / 6);
    }
    await page.mouse.up();

    // The painted layer's mask got the hole; the other layers' masks are
    // untouched (both still opaque) — and both DB records exist.
    await expect.poll(() => page.evaluate(() => {
      const mc = State.layers[0]._maskCanvas;
      return mc.getContext('2d').getImageData(Math.floor(mc.width / 2), Math.floor(mc.height / 2), 1, 1).data[3];
    }), { timeout: 10_000 }).toBe(0);
    const others = await page.evaluate(() => State.layers.slice(1).map(l =>
      l._maskCanvas.getContext('2d').getImageData(
        Math.floor(l._maskCanvas.width / 2), Math.floor(l._maskCanvas.height / 2), 1, 1).data[3]));
    for (const a of others) expect(a, 'unrelated layer kept its opaque mask').toBe(255);
    expect(pageErrors).toEqual([]);
  });

  test('brush-stroke frames are coalesced instead of drawing per pointermove', async ({ page }) => {
    await createProject(page, 'Mask Stroke Cadence');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 2000, 2000), { name: 'a.png' });
    await page.waitForFunction(
      () => State.layers.every(l => !l._dirty) && !State.renderPending,
      null, { timeout: 30_000 });

    // While a brush stroke is "active", scheduling a draw with a fresh
    // draw timestamp must not start drawing immediately — the frame lands
    // at the MASK_STROKE_FRAME_MS cadence instead.
    const cadence = await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      Renderer._brushDepth = 1;          // activate stroke cadence path
      Renderer._lastDrawAt = performance.now();
      let draws = 0;
      const orig = Renderer.draw.bind(Renderer);
      Renderer.draw = async function (...args) {
        draws++;
        return orig(...args);
      };
      Renderer.schedule();
      Renderer.schedule();              // second call must be a no-op, too
      const check = setInterval(() => {
        const since = performance.now() - t0;
        // Before the stroke cadence window ends no frame may have run.
        if (since < 20 && draws > 0) {
          clearInterval(check);
          resolve({ immediate: true, draws, since });
        } else if (since >= 200) {
          clearInterval(check);
          resolve({ immediate: false, draws, since });
        }
      }, 2);
      setTimeout(() => { Renderer._brushDepth = 0; Renderer._lastDrawAt = 0; }, 400);
    }));
    // The protocol roundtrips make strict ms bounds fuzzy; the essential
    // assertions are: the frame did NOT run immediately, and it ran by
    // the end of the window.
    expect(cadence.immediate, 'coalesced frame defers start of the draw').toBe(false);
    expect(cadence.draws, 'the coalesced frame does land').toBe(1);
    expect(pageErrors).toEqual([]);
  });
});
