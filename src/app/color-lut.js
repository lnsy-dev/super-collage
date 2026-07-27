/* ═══════════════════════════════════════════════════════════════════
   Color Separation LUT
   ═══════════════════════════════════════════════════════════════════ */

import { RISO_COLORS } from './constants.js';
import { hexToRgb } from '../utils/color.js';

export let buildColorLut = null;
export let colorSepLut = null;

export function setBuildColorLut(fn) {
  buildColorLut = fn;
}

export function rebuildColorSepLut() {
  const risoColors = [];
  for (const rc of RISO_COLORS) {
    if (rc.hex === '#FFFFFF') continue;
    const { r, g, b } = hexToRgb(rc.hex);
    risoColors.push(r, g, b);
    if (risoColors.length >= 21) break; // LUT supports at most 7 non-white colors
  }
  colorSepLut = buildColorLut(new Uint8Array(risoColors), 3, 16);
  window.colorSepLut = colorSepLut;
}
