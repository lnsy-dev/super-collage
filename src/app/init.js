/* ═══════════════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { Renderer } from './renderer.js';
import { wireControls } from './events.js';
import { showProjectDialog, loadEffectivePalette } from './project-manager.js';
import { setBuildColorLut, rebuildColorSepLut, colorSepLut as exportedColorSepLut } from './color-lut.js';

export let blendSubtractive = null;
export let separateColorsWithLut = null;
export let colorSepLut = null;
export { buildColorLut } from './color-lut.js';

let _initPromise = null;

export function init() {
  if (!_initPromise) {
    _initPromise = _doInit();
  }
  return _initPromise;
}

async function _doInit() {
  const wasmMod = await import('/src/wasm/super_collage.js');
  await wasmMod.default({ module_or_path: '/src/wasm/super_collage_bg.wasm' });
  blendSubtractive = wasmMod.blend_subtractive;
  separateColorsWithLut = wasmMod.separate_colors_with_lut;
  window.blendSubtractive = blendSubtractive;
  window.separateColorsWithLut = separateColorsWithLut;
  setBuildColorLut(wasmMod.build_color_lut);

  await DB.open();
  await loadEffectivePalette();

  // Pre-build the color separation LUT once (7 non-white riso colors, 3-color mix, 16³ grid)
  rebuildColorSepLut();
  colorSepLut = exportedColorSepLut;
  window.colorSepLut = colorSepLut;

  Renderer.init();
  wireControls();
  await showProjectDialog();
  window.__appReady = true;
}
