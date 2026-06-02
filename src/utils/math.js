/* ═══════════════════════════════════════════════════════════════════
   Math utilities
   ═══════════════════════════════════════════════════════════════════ */

/**
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t 0-1
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * @param {number} v
 * @param {number} grid
 * @returns {number}
 */
export function snapToGrid(v, grid) {
  return Math.round(v / grid) * grid;
}

/**
 * @param {number} deg
 * @returns {number} radians
 */
export function degToRad(deg) {
  return deg * Math.PI / 180;
}
