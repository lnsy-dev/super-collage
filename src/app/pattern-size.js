/* ═══════════════════════════════════════════════════════════════════
   Pattern-size device-pixel anchoring
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Document pages rasterize at 600 dpi (see constants.js page sizes:
 * Letter is 5100 × 6600 px = 8.5" × 11" at 600 px/inch).
 */
export const EXPORT_DPI = 600;

/**
 * Magazine-quality floor for dot screens (halftone "Dots" and "Grunge").
 *
 * The lpi/dpi math: mass-market magazines screen at roughly 133–150 lpi.
 * At EXPORT_DPI = 600 device pixels per inch, one screen cell spans
 *
 *   600 / 150 = 4 device px   (150 lpi)
 *   600 / 133 ≈ 4.5 device px (133 lpi)
 *
 * Below ~4 device px per cell a 600 dpi halftone can no longer hold a
 * mid-tone dot — the dot itself falls under one device pixel and the
 * screen collapses into sub-pixel noise. So 4 device px (150 lpi, the
 * fine end of the magazine range) is the smallest cell pitch the dot
 * screens render at their lowest knob setting.
 */
export const MIN_CELL_DEVICE_PX = EXPORT_DPI / 150; // = 4 device px @ 600 dpi

/**
 * Minimum dot-screen cell size, in the pixels of a render bitmap, whose
 * on-page pitch still reaches MIN_CELL_DEVICE_PX.
 *
 * `bitmapW` is the render's width in pixels and `pageW` the layer's
 * on-page footprint in 600-dpi document pixels, so the render holds
 * `bitmapW / pageW` bitmap pixels per document device pixel. Solving
 * cell_bitmap × pageW / bitmapW ≥ MIN_CELL_DEVICE_PX gives the floor.
 *
 * A missing/invalid `pageW` falls back to the plain device-pixel floor,
 * which is exact for a render at 1 bitmap px per device px.
 */
export function minCellForRender(bitmapW, pageW) {
  if (!pageW || pageW <= 0) return MIN_CELL_DEVICE_PX;
  return MIN_CELL_DEVICE_PX * bitmapW / pageW;
}
