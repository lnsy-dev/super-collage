/* ═══════════════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { Renderer } from './renderer.js';
import { wireControls } from './events.js';
import { showProjectDialog } from './project-manager.js';
import { CANVAS_W, CANVAS_H, RISO_COLORS, setCanvasSize } from './constants.js';
import { hexToRgb } from '../utils/color.js';

export let blendSubtractive = null;
export let separateColorsWithLut = null;
export let buildColorLut = null;
export let colorSepLut = null;

export async function init() {
  const wasmMod = await import('/src/wasm/super_collage.js');
  await wasmMod.default({ module_or_path: '/src/wasm/super_collage_bg.wasm' });
  blendSubtractive = wasmMod.blend_subtractive;
  separateColorsWithLut = wasmMod.separate_colors_with_lut;
  buildColorLut = wasmMod.build_color_lut;
  window.blendSubtractive = blendSubtractive;
  window.separateColorsWithLut = separateColorsWithLut;
  window.buildColorLut = buildColorLut;

  // Pre-build the color separation LUT once (7 non-white riso colors, 3-color mix, 16³ grid)
  const risoColors = [];
  for (const rc of RISO_COLORS) {
    if (rc.hex === '#FFFFFF') continue;
    const { r, g, b } = hexToRgb(rc.hex);
    risoColors.push(r, g, b);
  }
  colorSepLut = buildColorLut(new Uint8Array(risoColors), 3, 16);
  window.colorSepLut = colorSepLut;

  await DB.open();
  Renderer.init();
  wireControls();
  showProjectDialog();
}
