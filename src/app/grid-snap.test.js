/* ═══════════════════════════════════════════════════════════════════
   Unit tests for grid snapping (src/app/grid-snap.js).

   Run with:  npm run test:grid

   The critical invariant these tests encode: the grid Renderer.drawGrid
   paints on screen and the positions interactions snap to are THE SAME
   LINES. drawGrid strokes on the display canvas (whose top-left is page
   coordinate 0,0 — layers composite without pad) starting at display
   x = 0 with spacing grid.size * zoom, so the k-th drawn line sits at

       display: k * grid.size * zoom      page: k * grid.size

   Any snapping that does not land on those exact coordinates is a bug —
   historical example: snapping measured from the overlay's padded origin
   (-CANVAS_PAD), which offset every snap by (CANVAS_PAD % gridSize).
   ═══════════════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSnapEnabled,
  snapPageValue,
  snapPagePoint,
  snapOverlayPoint,
  snapMoveCorrection,
  snapDragRect,
} from './grid-snap.js';
import { CANVAS_PAD } from './constants.js';

const EPS = 1e-9;

/** Replicate Renderer.drawGrid's line placement for the standard grid. */
function drawnGridLines(zoom, gridSize, canvasLength) {
  const size = gridSize * zoom;
  const lines = [];
  for (let x = 0; x <= canvasLength; x += size) lines.push(x); // display px
  return lines;
}

/** Deterministic pseudo-random spread of probe values. */
function probeValues(count, span, { centered = true } = {}) {
  const xs = [];
  let s = 1234567;
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const u = s / 0x7fffffff;
    xs.push(centered ? (u - 0.5) * 2 * span : u * span); // centered: around 0
  }
  return xs;
}

const ZOOMS = [0.2, 0.37, 0.5, 1, 1.3, 2];
const GRIDS = [1, 137, 150, 300, 600];
const PAGE_W = 3300, PAGE_H = 5100;

/* ─── isSnapEnabled ───────────────────────────────────────────────── */

test('isSnapEnabled: on only for visible standard grids with positive size', () => {
  assert.equal(isSnapEnabled(true, { size: 150, type: 'standard' }), true);
  assert.equal(isSnapEnabled(false, { size: 150, type: 'standard' }), false, 'grid hidden');
  assert.equal(isSnapEnabled(true, { size: 150, type: 'isometric' }), false, 'isometric is diagonal');
  assert.equal(isSnapEnabled(true, { size: 0, type: 'standard' }), false, 'degenerate size');
  assert.equal(isSnapEnabled(true, null), false, 'no grid object');
});

/* ─── snapPageValue: alignment with the DRAWN grid ─────────────────── */

test('snapPageValue lands exactly on grid lines Renderer.drawGrid paints', () => {
  for (const zoom of ZOOMS) {
    for (const g of GRIDS) {
      const size = g * zoom;
      // drawGrid draws k = 0 .. floor(W / size) lines (its += loop, up to
      // float dust — hence the 1e-6 tolerance when matching).
      const maxK = Math.floor((PAGE_W * zoom) / size);
      for (const v of probeValues(200, PAGE_W, { centered: false })) {
        const snapped = snapPageValue(v, g);
        const k = Math.round(snapped / g);
        assert.ok(k >= 0 && k <= maxK + 1,
          `zoom=${zoom} g=${g}: snap(${v}) = ${snapped} (k=${k}) is off the drawn grid`);
        const drawnX = k * size;
        assert.ok(Math.abs(drawnX - snapped * zoom) < 1e-6 * Math.max(1, k),
          `zoom=${zoom} g=${g}: snap(${v}) = ${snapped} does not map to drawn line ${drawnX}`);
      }
    }
  }
});

test('snapPageValue: result is an exact integer multiple of the grid size', () => {
  for (const g of GRIDS) {
    for (const v of probeValues(300, 8000)) {
      const snapped = snapPageValue(v, g);
      assert.ok(Math.abs(snapped / g - Math.round(snapped / g)) < EPS,
        `snap(${v}, ${g}) = ${snapped} is not a multiple of ${g}`);
    }
  }
});

test('snapPageValue: never moves a coordinate more than half a cell', () => {
  for (const g of GRIDS) {
    for (const v of probeValues(300, 8000)) {
      assert.ok(Math.abs(snapPageValue(v, g) - v) <= g / 2 + EPS,
        `snap(${v}, ${g}) moved by more than half a cell`);
    }
  }
});

test('snapPageValue: is idempotent', () => {
  for (const g of GRIDS) {
    for (const v of probeValues(100, 8000)) {
      const once = snapPageValue(v, g);
      assert.equal(snapPageValue(once, g), once);
    }
  }
});

test('snapPageValue: values already on a line are unchanged; quarter points snap to the nearer line', () => {
  for (const g of GRIDS) {
    // Exact intersections never move:
    for (let k = 0; k <= 20; k++) {
      assert.equal(snapPageValue(k * g, g), k * g);
    }
    // Quarter points always snap toward the nearer line:
    assert.equal(snapPageValue(0.25 * g, g), 0);
    assert.equal(snapPageValue(0.75 * g, g), g);
    assert.equal(snapPageValue(1.25 * g, g), g);
  }
});

test('snapPageValue: symmetric around each grid line (round-half-to-even is not required, ties must not drift)', () => {
  const g = 150;
  // Quarter points always snap toward the nearer line:
  assert.equal(snapPageValue(0.26 * g, g), 0);
  assert.equal(snapPageValue(0.74 * g, g), g);
  assert.equal(snapPageValue(1.26 * g, g), g);
  assert.equal(snapPageValue(1.74 * g, g), 2 * g);
});

/* ─── snapPagePoint ────────────────────────────────────────────────── */

test('snapPagePoint: snaps both axes to grid intersections', () => {
  const r = snapPagePoint(123.4, 678.9, 150, true);
  assert.equal(r.x, 150);
  assert.equal(r.y, 750);
  assert.equal(r.snapped, true);
});

test('snapPagePoint: disabled leaves coordinates untouched and reports it', () => {
  const r = snapPagePoint(123.4, 678.9, 150, false);
  assert.equal(r.x, 123.4);
  assert.equal(r.y, 678.9);
  assert.equal(r.snapped, false);
});

/* ─── snapOverlayPoint: overlay ⇄ page ⇄ drawn lines ──────────────── */

test('snapOverlayPoint: result maps back to a page coordinate that is an exact grid line', () => {
  for (const zoom of ZOOMS) {
    for (const g of GRIDS) {
      // Random overlay points across the real overlay canvas extent,
      // as a real pointer event would produce.
      const span = (PAGE_W + 2 * CANVAS_PAD) * zoom;
      for (const sx of probeValues(150, span, { centered: false })) {
        const sy = probeValues(1, span, { centered: false })[0];
        const r = snapOverlayPoint(sx, sy, zoom, g, true);
        const pageX = r.x / zoom - CANVAS_PAD;
        const pageY = r.y / zoom - CANVAS_PAD;
        assert.ok(Math.abs(pageX / g - Math.round(pageX / g)) < EPS,
          `zoom=${zoom} g=${g}: overlay sx=${sx} snapped to page ${pageX}, not a grid line`);
        assert.ok(Math.abs(pageY / g - Math.round(pageY / g)) < EPS,
          `zoom=${zoom} g=${g}: overlay sy snapped to page ${pageY}, not a grid line`);
      }
    }
  }
});

test('snapOverlayPoint: snapped point sits on a pixel column/row drawGrid actually renders', () => {
  for (const zoom of [0.5, 1.3]) {
    const g = 150;
    const W = Math.round(PAGE_W * zoom);
    const rendered = drawnGridLines(zoom, g, W).map(d => Math.round(d) + 0.5); // exact moveTo calls
    // Probe overlay points that fall over the visible (drawn) page area.
    for (const sx of probeValues(200, W, { centered: false }).map(v => v + CANVAS_PAD * zoom)) {
      const { x } = snapOverlayPoint(sx, 0, zoom, g, true);
      // overlay → display: the overlay canvas is offset by -CANVAS_PAD * zoom
      const displayX = x - CANVAS_PAD * zoom;
      const nearest = rendered.reduce((a, b) => Math.abs(b - displayX) < Math.abs(a - displayX) ? b : a);
      assert.ok(Math.abs(nearest - displayX) < 1.01,
        `snapped display x ${displayX} does not coincide with a rendered grid line (nearest ${nearest})`);
    }
  }
});

test('snapOverlayPoint: round-trips through page space and back for on-grid points', () => {
  const zoom = 0.75, g = 150;
  // An overlay point that is already exactly on a grid intersection maps back unchanged.
  const onGridPageX = 450, onGridPageY = 300;
  const sx = (onGridPageX + CANVAS_PAD) * zoom, sy = (onGridPageY + CANVAS_PAD) * zoom;
  const r = snapOverlayPoint(sx, sy, zoom, g, true);
  assert.ok(Math.abs(r.x - sx) < 1e-6, `x moved: ${r.x} vs ${sx}`);
  assert.ok(Math.abs(r.y - sy) < 1e-6, `y moved: ${r.y} vs ${sy}`);
});

test('snapOverlayPoint: shift is bounded by half a cell on screen', () => {
  for (const zoom of ZOOMS) {
    for (const g of [150, 300]) {
      for (const sx of probeValues(100, 4000 * zoom)) {
        const r = snapOverlayPoint(sx, 0, zoom, g, true);
        assert.ok(Math.abs(r.x - sx) <= (g / 2) * zoom + EPS);
      }
    }
  }
});

test('snapOverlayPoint: disabled / degenerate inputs are identity', () => {
  assert.deepEqual(snapOverlayPoint(11, 22, 1, 150, false), { x: 11, y: 22, snapped: false });
  assert.deepEqual(snapOverlayPoint(11, 22, 1, 0, true), { x: 11, y: 22, snapped: false });
  assert.deepEqual(snapOverlayPoint(11, 22, 0, 150, true), { x: 11, y: 22, snapped: false });
});

/* ─── snapMoveCorrection: layer drags ─────────────────────────────── */

test('snapMoveCorrection: primary layer lands exactly on a grid intersection', () => {
  for (const g of GRIDS) {
    for (const bx of probeValues(50, 3000)) {
      for (const dx of probeValues(20, 900)) {
        const snapX = 450, rawX = snapX + dx;
        const { dx: corr, snapped } = snapMoveCorrection(rawX, 0, g, true);
        assert.equal(snapped, true);
        const finalX = rawX + corr;
        assert.ok(Math.abs(finalX / g - Math.round(finalX / g)) < EPS,
          `final x ${finalX} (start ${snapX}, delta ${dx}) is off-grid`);
        void bx;
      }
    }
  }
});

test('snapMoveCorrection: the SAME correction applies to every co-selected layer (rigid groups)', () => {
  const g = 150, snap = { x: 100.3, y: 220.7 }, es = { x: 512.9, y: 48.1 };
  const dx = 37 / 1.0, dy = -53 / 1.0;
  const { dx: cx, dy: cy } = snapMoveCorrection(snap.x + dx, snap.y + dy, g, true);

  const primary = { x: snap.x + dx + cx, y: snap.y + dy + cy };
  const secondary = { x: es.x + dx + cx, y: es.y + dy + cy };

  // Relative arrangement is preserved EXACTLY, and the primary is on-grid.
  assert.ok(Math.abs((secondary.x - primary.x) - (es.x - snap.x)) < EPS);
  assert.ok(Math.abs((secondary.y - primary.y) - (es.y - snap.y)) < EPS);
  assert.ok(Math.abs(primary.x / g - Math.round(primary.x / g)) < EPS);
  assert.ok(Math.abs(primary.y / g - Math.round(primary.y / g)) < EPS);
});

test('snapMoveCorrection: disabled is a no-op', () => {
  assert.deepEqual(snapMoveCorrection(123.45, 678.9, 150, false), { dx: 0, dy: 0, snapped: false });
  assert.deepEqual(snapMoveCorrection(123.45, 678.9, 0, true), { dx: 0, dy: 0, snapped: false });
});

/* ─── snapDragRect: shape / text box drags ─────────────────────────── */

test('snapDragRect: committed rect position AND size are grid multiples', () => {
  for (const zoom of [0.4, 1, 1.7]) {
    for (const g of [150, 300]) {
      for (const [ax, ay] of probeValues(20, 1200 * zoom).map(v => [v, v * 0.6])) {
        for (const [bx, by] of probeValues(20, 1200 * zoom).map(v => [v + 50, v * 0.3 + 40])) {
          const r = snapDragRect(ax, ay, bx, by, zoom, g, true);
          // Convert the overlay-space rect to page space the way onPointerUp does.
          const cx = Math.min(r.startX, r.endX) / zoom - CANVAS_PAD;
          const cy = Math.min(r.startY, r.endY) / zoom - CANVAS_PAD;
          const cw = Math.abs(r.endX - r.startX) / zoom;
          const ch = Math.abs(r.endY - r.startY) / zoom;
          for (const [label, v] of [['cx', cx], ['cy', cy], ['cw', cw], ['ch', ch]]) {
            assert.ok(Math.abs(v / g - Math.round(v / g)) < EPS,
              `zoom=${zoom} g=${g}: ${label}=${v} is not a grid multiple`);
          }
        }
      }
    }
  }
});

test('snapDragRect: live preview equals commit (snapping the snapped corners is identity)', () => {
  const zoom = 1.1, g = 150;
  const rawStart = { x: (233.7 + CANVAS_PAD) * zoom, y: (641.3 + CANVAS_PAD) * zoom };
  const rawEnd = { x: (918.2 + CANVAS_PAD) * zoom, y: (1102.9 + CANVAS_PAD) * zoom };

  // pointerdown snaps the start corner (as events.js does)…
  const startSnap = snapOverlayPoint(rawStart.x, rawStart.y, zoom, g, true);
  // …pointermove snaps the live corner for the preview…
  const previewEnd = snapOverlayPoint(rawEnd.x, rawEnd.y, zoom, g, true);
  // …pointerup snaps the live corner again for the commit.
  const commitEnd = snapOverlayPoint(previewEnd.x, previewEnd.y, zoom, g, true);

  assert.equal(commitEnd.x, previewEnd.x);
  assert.equal(commitEnd.y, previewEnd.y);
  void startSnap;
});

test('snapDragRect: disabled leaves the rect untouched', () => {
  const r = snapDragRect(10, 20, 33, 47, 1, 150, false);
  assert.deepEqual({ startX: r.startX, startY: r.startY, endX: r.endX, endY: r.endY },
    { startX: 10, startY: 20, endX: 33, endY: 47 });
  assert.equal(r.snapped, false);
});

/* ─── Historical regression: the -CANVAS_PAD origin bug ────────────── */

test('regression: snapping is NOT offset by the overlay pad (CANVAS_PAD % gridSize drift)', () => {
  // With the old formula round((v+1000)/150)*150-1000, page 0 snapped to 50:
  // the drawn line at page 0 and the snap target disagreed by 50px.
  assert.equal(snapPageValue(0, 150), 0, 'page 0 must snap to the drawn line at page 0');
  assert.equal(snapPageValue(50, 150), 0, '50px must snap to 0, not to 50');
  for (const g of [137, 150, 300]) {
    // A coordinate sitting exactly on a drawn line never moves — the old
    // pad-relative formula moved page 0 by (1000 % g).
    assert.equal(snapPageValue(3 * g, g), 3 * g);
  }
});
