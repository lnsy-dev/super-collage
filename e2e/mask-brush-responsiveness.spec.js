// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Mask brush responsiveness on projects with many difference masks
   ═══════════════════════════════════════════════════════════════════
   Regression coverage for the report:

     "If there are many layers of diffed masks and I try to use the
      brush to add to the mask the software is not responsive."

   "Diffed masks" are difference-mask layers: a base layer with N
   image-mask layers (isMaskFor) linked to it — one per difference
   mask, each carrying its own painted mask canvas. One difference-
   mask click creates only that mask layer (the original image stays
   its own layer), so a fan-out leaves the BASE layer masked through
   *several* image-mask layers (imageMaskIds = [m1, m2, …]) — every
   one of them contributing its own slice buffer, alpha inversion and
   bitmask application to the compositing cost of every redraw.

   The stack here mirrors the real workflow: a solid base plate plus a
   fan of linked mask layers created through the real pipeline.

   Each brush dab bumps the painted mask revision, which invalidates
   the brushed mask's composites and the base's image-mask composite
   cache — so a brush stroke is effectively a per-frame worst case for
   masked rendering. The tests assert:

     1. the stroke WORKS end to end (the painted hole lands in the
        brushed mask layer only and shows on screen through the real
        pipeline);
     2. per-redraw frame time during the stroke stays in a bound that
        keeps the UI responsive, under CPU throttling (emulating weak
        hardware, like performance.spec.js).
*/
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
  throttleCPU,
} from './helpers.js';

// Deterministic plate colors: red base, cyan diff copies. On screen the
// punched hole must expose the base between receiver colors.
const BASE_PNG = () => createSolidPngBuffer('#cc0000', 2000, 2000);
const DIFF_COLOR = '#00a95c';

/* ─── Shared helpers ────────────────────────────────────────────── */

/**
 * Fan `pairs` difference masks out of the single imported image layer
 * through the real pipeline (duplicate-layer + create-difference-mask
 * handleAction). Returns baseId + the mask layer ids in creation order:
 * every mask is a linked isMaskFor layer of the base; the original
 * image stays its own layer and no "(diff)" copies exist.
 */
async function buildDiffMaskStack(page, pairs) {
  return page.evaluate(async ({ pairs: n }) => {
    const baseId = State.layers[0].id;
    for (let i = 0; i < n; i++) {
      await LayerManager.duplicate(baseId); // the copy is selected after this
      State.selectedId = baseId;
      State.selectedIds = [baseId, State.layers[1].id];
      await handleAction('create-difference-mask');
      await PageManager.queueIdle();
    }
    Renderer.schedule();
    return {
      baseId,
      masks: State.layers.filter(l => l.isMaskFor === baseId).map(l => l.id),
    };
  }, { pairs });
}

/**
 * Record every Renderer.draw's start time (page performance.now()) and
 * duration while it runs, so the test can filter to the frames that
 * started during the actual mouse stroke.
 */
async function installDrawProfiler(page) {
  await page.evaluate(() => {
    window.__strokeProf = { draws: [] };
    const orig = Renderer.draw.bind(Renderer);
    Renderer.draw = async function (...args) {
      const t0 = performance.now();
      try {
        return await orig(...args);
      } finally {
        window.__strokeProf.draws.push({ t0, ms: performance.now() - t0 });
      }
    };
  });
}

const pageNow = page => page.evaluate(() => performance.now());

function profilerStats(draws) {
  const sorted = [...draws].map(d => d.ms).sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return {
    count: sorted.length,
    median: at(0.5),
    p95: sorted.length > 1 ? at(0.95) : sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/** Client point (fx, fy ∈ [0,1] of a layer) on the interaction overlay. */
async function layerPointOnOverlay(page, layerId, fx, fy) {
  return page.evaluate(({ layerId, fx, fy }) => {
    const l = State.layers.find(x => x.id === layerId);
    const rect = document.getElementById('interaction-overlay').getBoundingClientRect();
    return {
      x: rect.left + (l.x + l.width * fx + 1000) * State.zoom,
      y: rect.top + (l.y + l.height * fy + 1000) * State.zoom,
    };
  }, { layerId, fx, fy });
}

/** Drag a brush stroke from `from` to `to` through the real pointer
 *  pipeline. Returns the page-side [tDown, tUp] window. */
async function dragBrushStroke(page, from, to, moves = 24) {
  const tDown = await pageNow(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= moves; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * i / moves,
      from.y + (to.y - from.y) * i / moves);
  }
  await page.mouse.up();
  const tUp = await pageNow(page);
  return { tDown, tUp };
}

/** Alpha of a pixel (fx, fy ∈ [0,1]) in a layer's painted mask. */
function maskAlpha(page, layerId, fx, fy) {
  return page.evaluate(([layerId, fxx, fyy]) => {
    const l = State.layers.find(x => x.id === layerId);
    const mc = l?._maskCanvas;
    if (!mc) return -1;
    const mx = Math.min(mc.width - 1, Math.round(mc.width * fxx));
    const my = Math.min(mc.height - 1, Math.round(mc.height * fyy));
    return mc.getContext('2d').getImageData(mx, my, 1, 1).data[3];
  }, [layerId, fx, fy]);
}

/** On-screen pixel color at (fx, fy ∈ [0,1] of the base layer). */
function screenPixelAt(page, layerId, fx, fy) {
  return page.evaluate(([layerId, fxx, fyy]) => {
    const l = State.layers.find(x => x.id === layerId);
    const canvas = document.getElementById('display-canvas');
    // The canvas's backing store is capped at high zoom and scaled by
    // _displayScale; document px → backing px through that scale.
    const cx = Math.round((l.x + l.width * fxx) * State.zoom);
    const cy = Math.round((l.y + l.height * fyy) * State.zoom);
    const bx = Math.min(canvas.width - 1, Math.round(cx * Renderer._displayScale));
    const by = Math.min(canvas.height - 1, Math.round(cy * Renderer._displayScale));
    const d = canvas.getContext('2d').getImageData(bx, by, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }, [layerId, fx, fy]);
}

/**
 * Recolor the base plate so its pixels are clearly distinct from paper
 * (red). The mask layers do not render as layers — only their ink cuts
 * the base — so there is nothing else to recolor.
 */
async function recolorStack(page, stack) {
  await page.evaluate(({ baseId }) => {
    for (const l of State.layers) {
      if (l.id !== baseId) continue;
      l.color = '#cc0000';
      l.colorMode = 'solid';
      l._dirty = true;
    }
    Renderer.schedule();
  }, { baseId: stack.baseId });
}

/** Select a layer by id through the selection pipeline. */
async function selectLayer(page, id) {
  await page.evaluate((lid) => {
    State.selectedId = lid;
    State.selectedIds = [lid];
    UI.refreshLayerList();
    UI.refreshProperties();
  }, id);
}

/**
 * Set the tool programmatically. Equivalent to the toolbar button's own
 * UI.setTool call, without the pointer input that can hang while the
 * still-draining post-setup render queue holds the main thread.
 */
async function selectToolQuiet(page, toolName) {
  await page.evaluate((t) => { UI.setTool(t); }, toolName);
  await page.waitForFunction((t) => State.tool === t &&
    document.getElementById('status-tool').textContent !== '', toolName,
    { timeout: 30_000 });
}

/** Recolor-diff dirty state needs a settled repaint. */
async function settle(page, ms = 500) {
  await page.evaluate(() => Renderer.schedule());
  await page.waitForTimeout(ms);
}

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
  pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e));
});

/* ══════════════════════════════════════════════════════════════════
   1. Brush + many diffed masks stays responsive
   ══════════════════════════════════════════════════════════════════ */

test.describe('Mask brush responsiveness', () => {
  test('brushing a mask with a fan of difference masks paints through and stays responsive', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'CPU throttling via CDP is not available in Firefox');
    const MASKS = 5;
    const CPU_THROTTLE = 4;
    // Per-frame redraw budget during the stroke (ms of Renderer.draw),
    // measured under 4× CPU throttling — the emulation for the reported
    // environment. Calibrated against the unresponsive build (see the
    // task work log); the bound sits far below its worst frames.
    const MAX_MEDIAN_DRAW_MS = 150;
    const MAX_P95_DRAW_MS = 400;

    await createProject(page, 'Brush Many Diff Masks');
    await addImageFromBuffer(page, BASE_PNG(), { name: 'plate.png' });
    const stack = await buildDiffMaskStack(page, MASKS);
    await recolorStack(page, stack);
    // Heavy fan-out setup — give the real pipeline's actions room.
    page.setDefaultTimeout(30_000);
    expect(stack.masks).toHaveLength(MASKS);

    // Weak-hardware emulation, as performance.spec.js does.
    await throttleCPU(page, CPU_THROTTLE);

    // Let the fan-out's recolor dirty state settle so the stroke starts
    // from a quiescent renderer (initial builds outside the measurement).
    await page.waitForFunction(
      () => State.layers.every(l => !l._dirty) && !State.renderPending,
      null, { timeout: 60_000 },
    );
    await page.waitForTimeout(500);
    await installDrawProfiler(page);

    // Paint on the FIRST mask layer: only its own canvas is painted (the
    // masked base and the sibling masks are never painted by a stroke on
    // a mask), and the base re-composites through all MASKS masks.
    await selectLayer(page, stack.masks[0]);
    await selectToolQuiet(page, 'mask-draw');

    const FX = 0.35, FY = 0.35;
    const from = await layerPointOnOverlay(page, stack.baseId, FX, FY);
    const to = await layerPointOnOverlay(page, stack.baseId, FX + 0.04, FY + 0.04);
    const { tDown, tUp } = await dragBrushStroke(page, from, to);

    // Let the stroke's last scheduled redraw land before reading results.
    await page.waitForTimeout(800);

    const draws = await page.evaluate(() => [...window.__strokeProf.draws]);
    const strokeDraws = draws.filter(d => d.t0 >= tDown && d.t0 <= tUp);
    const stats = profilerStats(strokeDraws);
    expect(stats.count, 'stroke produced a stream of redraws').toBeGreaterThan(3);
    expect(stats.median, 'median stroke redraw stays responsive').toBeLessThan(MAX_MEDIAN_DRAW_MS);
    expect(stats.p95, 'worst stroke redraws stay bounded').toBeLessThan(MAX_P95_DRAW_MS);

    // ── Correctness of the stroke itself ────────────────────────────
    // The hole lands ONLY in the brushed mask layer; the untouched
    // masks keep their opaque canvases.
    await expect.poll(() => maskAlpha(page, stack.masks[0], FX, FY), { timeout: 10000 }).toBe(0);
    expect(await maskAlpha(page, stack.masks[MASKS - 1], FX, FY)).toBe(255);

    // On screen: the sibling masks still cut the base at the hole, so
    // the punched spot shows paper — proof the composite of all MASKS
    // masks ran through the real pipeline without breaking.
    const punched = await screenPixelAt(page, stack.baseId, FX, FY);
    expect(punched.r).toBeGreaterThan(200);
    expect(punched.g).toBeGreaterThan(200);
    expect(punched.b).toBeGreaterThan(200);

    expect(pageErrors.length, 'no uncaught page errors during the stroke').toBe(0);
  });

  /* ── Functional guard: image-mask compositing through the mask
        pipeline still hides exactly the masked-out area ──────────── */
  test('difference mask brush hole shows through the base layer render', async ({ page }) => {
    await createProject(page, 'Brush Diff Render');
    await addImageFromBuffer(page, BASE_PNG(), { name: 'plate.png' });
    const stack = await buildDiffMaskStack(page, 1);
    await recolorStack(page, stack);
    await page.waitForFunction(
      () => State.layers.every(l => !l._dirty) && !State.renderPending,
      null, { timeout: 60_000 },
    );
    await page.waitForTimeout(300);

    await selectLayer(page, stack.masks[0]);
    await selectToolQuiet(page, 'mask-draw');

    const FX = 0.5, FY = 0.5;
    const from = await layerPointOnOverlay(page, stack.baseId, FX, FY);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.up();

    // The hole lands in the mask layer's own canvas — and in nothing
    // else: the base's own painted mask must not be painted by a stroke
    // on its mask layer.
    await expect.poll(() => maskAlpha(page, stack.masks[0], FX, FY), { timeout: 10000 }).toBe(0);

    // Un-masking the base's one mask exposes the base plate — red shows
    // where the hole was punched.
    await settle(page, 300);
    const pixel = await screenPixelAt(page, stack.baseId, FX, FY);
    expect(pixel.r).toBeGreaterThan(150);
    expect(pixel.g).toBeLessThan(150);

    const baseCanvasPunched = await maskAlpha(page, stack.baseId, FX, FY);
    expect(baseCanvasPunched).toBe(255);
    expect(pageErrors.length).toBe(0);
  });
});
