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
  }
  // The WASM LUT stores one weight byte per ink per cell, so it accepts
  // palettes of any size; mixed colors separate into overlapping ink
  // plates that blend back into the target color when printed.
  colorSepLut = buildColorLut(new Uint8Array(risoColors), 3, 16);
  window.colorSepLut = colorSepLut;
}
