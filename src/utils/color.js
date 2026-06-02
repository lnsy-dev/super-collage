/* ═══════════════════════════════════════════════════════════════════
   Color utilities
   ═══════════════════════════════════════════════════════════════════ */

/**
 * @param {string} hex - '#RRGGBB'
 * @returns {{r:number,g:number,b:number}}
 */
export function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} '#RRGGBB'
 */
export function rgbToHex(r, g, b) {
  const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} 0-255
 */
export function rgbToGray(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}
