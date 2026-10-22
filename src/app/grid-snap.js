/* ═══════════════════════════════════════════════════════════════════
   Grid snapping — single source of truth for aligning pointer
   interactions to the grid that Renderer.drawGrid paints on screen.

   ── ALIGNMENT CONTRACT ─────────────────────────────────────────────
   Renderer.drawGrid() strokes lines on the DISPLAY canvas starting at
   display coordinate (0, 0) with spacing grid.size * zoom. The display
   canvas's top-left corner is page coordinate (0, 0): layers are
   composited with _applyTransform(..., isOverlay = false), which adds
   NO pad. Therefore the visible grid lines sit exactly at

       page.x = k * grid.size,  page.y = m * grid.size   (k, m ∈ ℤ)

   The interaction overlay is a larger canvas shifted by -CANVAS_PAD * zoom
   (Renderer.resize), so an overlay-screen point (sx, sy) maps to page
   coordinates (sx / zoom - CANVAS_PAD, sy / zoom - CANVAS_PAD) — the same
   conversion the app's overlayToPage() uses.

   Every snapped result MUST land on those page coordinates. Any change to
   the grid's drawn origin (Renderer.drawGrid) or the pad offset
   (Renderer.resize / constants.CANVAS_PAD) must be mirrored here, and the
   tests in src/app/grid-snap.test.js + e2e/grid-snap.spec.js enforce it.
   ═══════════════════════════════════════════════════════════════════ */

import { CANVAS_PAD } from './constants.js';

/** Snap only for the rectangular grid; isometric lines are diagonal. */
export function isSnapEnabled(showGrid, grid) {
  return !!(showGrid && grid && grid.type === 'standard' && grid.size > 0);
}

/**
 * Snap one page-space coordinate to the nearest grid line.
 * Measured from page 0 — the display-canvas origin where drawGrid
 * paints its first line — NOT from the overlay's padded origin.
 */
export function snapPageValue(v, gridSize) {
  return Math.round(v / gridSize) * gridSize;
}

/**
 * Snap a page-space point to the nearest grid intersection.
 * Returns { x, y, snapped } — snapped is false (values untouched) when
 * snapping is disabled, so callers can branch without duplicating checks.
 */
export function snapPagePoint(x, y, gridSize, enabled = true) {
  if (!enabled || !(gridSize > 0)) return { x, y, snapped: false };
  return { x: snapPageValue(x, gridSize), y: snapPageValue(y, gridSize), snapped: true };
}

/**
 * Snap an overlay-canvas (screen) point to the nearest visible grid
 * intersection. Overlay → page → snap → back to overlay coordinates.
 * No-op when snapping is disabled.
 */
export function snapOverlayPoint(sx, sy, zoom, gridSize, enabled = true) {
  if (!enabled || !(gridSize > 0) || !(zoom > 0)) return { x: sx, y: sy, snapped: false };
  const pageX = sx / zoom - CANVAS_PAD;
  const pageY = sy / zoom - CANVAS_PAD;
  return {
    x: (snapPageValue(pageX, gridSize) + CANVAS_PAD) * zoom,
    y: (snapPageValue(pageY, gridSize) + CANVAS_PAD) * zoom,
    snapped: true,
  };
}

/**
 * Snap a drag-to-move result. The primary layer lands on the grid; the
 * SAME correction delta is returned so every co-selected layer moves by
 * the identical (snapped) delta and the selection stays rigid.
 *
 * @param {number} rawX  primary layer's un-snapped page x (snapshot + delta)
 * @param {number} rawY  primary layer's un-snapped page y
 * @returns {{ dx: number, dy: number, snapped: boolean }} correction to add
 *          to the raw position of the primary AND every co-moved layer.
 */
export function snapMoveCorrection(rawX, rawY, gridSize, enabled = true) {
  if (!enabled || !(gridSize > 0)) return { dx: 0, dy: 0, snapped: false };
  return {
    dx: snapPageValue(rawX, gridSize) - rawX,
    dy: snapPageValue(rawY, gridSize) - rawY,
    snapped: true,
  };
}

/**
 * Snap a shape/text drag rectangle. Both drag corners snap to grid
 * intersections, so the committed rect's position AND its width/height
 * are exact grid multiples. Input/output are overlay-screen coordinates
 * (the space drawShapePreview draws in), so preview == commit exactly.
 */
export function snapDragRect(startX, startY, endX, endY, zoom, gridSize, enabled = true) {
  const a = snapOverlayPoint(startX, startY, zoom, gridSize, enabled);
  const b = snapOverlayPoint(endX, endY, zoom, gridSize, enabled);
  return { startX: a.x, startY: a.y, endX: b.x, endY: b.y, snapped: a.snapped && b.snapped };
}
