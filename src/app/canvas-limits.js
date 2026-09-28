/* ═══════════════════════════════════════════════════════════════════
   Canvas allocation guards
   ═══════════════════════════════════════════════════════════════════
   Chromium caps a single canvas's backing store at 2^28 pixels of
   area (268,435,456 px², i.e. the 16384×16384 square) with each side
   additionally capped at 65,535 px. Over-limit canvases don't fail to
   construct — they silently allocate a dead 0×0 backing store, so
   every later readback or encode (convertToBlob, getImageData,
   drawImage of one into another canvas) throws:

     IndexSizeError: Failed to execute 'convertToBlob' on
     'OffscreenCanvas': The size of the OffscreenCanvas is zero.

   This module is the one place that knows about those limits:
   - clampDims() shrinks requested dimensions into the safe envelope
     (used by masks, which are alpha-only, so downscaling them loses
     nothing the renderer/export needs — they're sampled at display
     resolution anyway).
   - isAllocatable() lets callers detect before allocating whether a
     canvas at natural resolution would be dead on arrival.
   - clampOffscreenCanvas() builds an OffscreenCanvas safely or
     returns null when the caller must fall back to lower resolution.

   Display rendering and export rendering both resample layer bitmaps
   to independent target sizes, so bitmaps below natural resolution
   render and export correctly — just sampled, never crashed.
 */

// 2^28 px² — Chromium's per-canvas backing-store area cap.
export const MAX_CANVAS_PIXELS = 268435456;
// Chromium's per-side cap (well above the area cap in practice).
export const MAX_CANVAS_SIDE = 65535;

export function clampDims(width, height) {
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));
  if (w * h <= MAX_CANVAS_PIXELS && w <= MAX_CANVAS_SIDE && h <= MAX_CANVAS_SIDE) return { w, h, clamped: false };
  // Scale down to fit the area cap, respecting the per-side cap too.
  let scale = Math.min(
    Math.sqrt(MAX_CANVAS_PIXELS / (w * h)),
    MAX_CANVAS_SIDE / w,
    MAX_CANVAS_SIDE / h,
  );
  w = Math.max(1, Math.floor(w * scale));
  h = Math.max(1, Math.floor(h * scale));
  return { w, h, clamped: true };
}

export function isAllocatable(width, height) {
  return width > 0 && height > 0 &&
    width * height <= MAX_CANVAS_PIXELS &&
    width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE;
}

/**
 * Create an OffscreenCanvas at the requested size, or null if that size
 * exceeds the browser's canvas allocation limits (a canvas constructed
 * anyway would be a dead 0×0 backing store whose every readback throws).
 */
export function clampOffscreenCanvas(width, height) {
  if (!isAllocatable(width, height)) return null;
  return new OffscreenCanvas(width, height);
}
