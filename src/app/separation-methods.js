/* ═══════════════════════════════════════════════════════════════════
   Spectrolite Separation Methods
   Ported from Spectrolite v1.4.5 (browser port of its riso separation
   model — the pixel work runs in WASM, see rust/src/lib.rs):

   · types/transforms/halftone.ts   → AM screen (angle / cellSize / shape)
   · types/transforms/dithering.ts  → 8 error-diffusion methods
   · types/transforms/posterize.ts  → breakpoint → ink ranges
   · types/transforms/cmykish.ts    → CMYK channel → closest inks
   · types/separation.ts            → inkOpacityMultipliers

   Plate convention (project-wide): flat RGBA, R=G=B grayscale,
   0 = full ink, 255 = no ink.
   ═══════════════════════════════════════════════════════════════════ */

/* ─── WASM bindings (set by init.js once the module loads) ─────────── */
let _wasm = {};

export function bindSepMethods(wasmMod) {
  _wasm = {
    halftoneScreen: wasmMod.halftone_screen,
    ditherPlate: wasmMod.dither_plate,
    posterizeToPlates: wasmMod.posterize_to_plates,
    cmykishToPlates: wasmMod.cmykish_to_plates,
    applyInkOpacities: wasmMod.apply_ink_opacities,
  };
  window.spectroliteHalftoneScreen = _wasm.halftoneScreen;
  window.spectroliteDitherPlate = _wasm.ditherPlate;
  window.posterizeToPlates = _wasm.posterizeToPlates;
  window.cmykishToPlates = _wasm.cmykishToPlates;
  window.applyInkOpacities = _wasm.applyInkOpacities;
}

function toImageData(u8, w, h) {
  return new ImageData(new Uint8ClampedArray(u8), w, h);
}

/* ─── Constants (Spectrolite defaults) ─────────────────────────────── */

// Spectrolite ditheringOptions order — WASM method index matches this list.
export const DITHER_METHODS = [
  { id: 'atkinson', name: 'Atkinson' },
  { id: 'jarvis-judice-ninke', name: 'Jarvis Judice Ninke' },
  { id: 'floyd-steinberg', name: 'Floyd Steinberg' },
  { id: 'stucki', name: 'Stucki' },
  { id: 'burkes', name: 'Burkes' },
  { id: 'sierra', name: 'Sierra' },
  { id: 'two-row-sierra', name: 'Two Row Sierra' },
  { id: 'sierra-lite', name: 'Sierra Lite' },
];
export const DEFAULT_DITHER_METHOD = 'atkinson';
export const DEFAULT_DITHER_SCALE = 1;
export const DEFAULT_DITHER_THRESHOLD = 0.5;

// Spectrolite HalftoneChannelConfig.buildWithDefaults: lpi chosen so the
// screen cell is ~8 px at common output DPIs (71 LPI @ 600 dpi for riso).
export const DEFAULT_DPI = 600;
export const DEFAULT_LPI = 71;
export const DEFAULT_CELL_SIZE = Math.round(DEFAULT_DPI / DEFAULT_LPI); // 8
export const DEFAULT_SHAPE = 'circle';

// ColorSeparationMethods available in this port.
//  'lut'       → project's built-in geometric/CIEDE2000 LUT separation
//                (stands in for the proprietary "spectrolite-default")
//  'posterize' → grayscale breakpoints → discrete inks
//  'cmykish'   → CMYK channel tonages → closest palette inks
export const SEP_STYLES = [
  { id: 'lut', name: 'Auto' },
  { id: 'posterize', name: 'Posterize' },
  { id: 'cmykish', name: 'CMYK-ish' },
];

/* ─── Color math helpers ──────────────────────────────────────────── */

export function hexToRgbLocal(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

function srgbChannelToLinear(v) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// sRGB → CIE Lab (D65 white point), enough for deltaLab-style matching.
export function srgbToLab(r, g, b) {
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);
  // linear sRGB → XYZ (D65)
  const X = 0.4124 * R + 0.3576 * G + 0.1805 * B;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
  const wp = { x: 0.95047, y: 1.00000, z: 1.08883 };
  const f = t => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116));
  const fx = f(X / wp.x), fy = f(Y / wp.y), fz = f(Z / wp.z);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function deltaLab(hexA, hexB) {
  const [r1, g1, b1] = hexToRgbLocal(hexA);
  const [r2, g2, b2] = hexToRgbLocal(hexB);
  const l1 = srgbToLab(r1, g1, b1);
  const l2 = srgbToLab(r2, g2, b2);
  const dL = l1.L - l2.L, da = l1.a - l2.a, db = l1.b - l2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function luminanceOf(hex) {
  const [r, g, b] = hexToRgbLocal(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function rgbToHue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return -1; // gray family
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return (h + 360) % 360;
}

// Stand-in for Spectrolite's ink "group" tags (blues/teals, pinks/purples,
// yellows/browns/greens, grays), derived from hue.
function inkGroup(hex) {
  const [r, g, b] = hexToRgbLocal(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.18) return 'grays';
  const h = rgbToHue(r, g, b);
  if (h >= 165 && h < 260) return 'blues'; // blues + teals
  if (h >= 260 || h < 20) return 'pinks';  // pinks + magentas/purples
  if (h >= 260 && h < 345) return 'pinks'; // purples
  return 'yellows';                        // yellows + browns/greens
}

/* ─── Halftone defaults (HalftoningConfig.fromPaletteInks) ────────── */

// Default per-ink screen angles, parallel to `hexes` (plate order).
// Spectrolite sorts the palette light→dark and assigns classic screen
// angles; ours cycles extra angles when the palette has more than 4 inks.
export function defaultSepAngles(hexes) {
  const n = hexes.length;
  const angles = hexes.map(() => 0);
  if (n === 0) return angles;
  const lightToDarkIdx = hexes
    .map((_, i) => i)
    .sort((a, b) => luminanceOf(hexes[b]) - luminanceOf(hexes[a])); // light first
  let anglesLightToDark;
  switch (n) {
    case 1: anglesLightToDark = [45]; break;
    // lighter ink 75°, darker ink 45°
    case 2: anglesLightToDark = [75, 45]; break;
    // lightest 15°, medium 75°, darkest 45°
    case 3: anglesLightToDark = [15, 75, 45]; break;
    // non-CMYK 4-ink palette, light→dark
    case 4: anglesLightToDark = [0, 15, 75, 45]; break;
    // 5+ inks (e.g. our full riso palette): cycle classic + extra angles
    default: anglesLightToDark = [15, 75, 0, 45, 30, 60, 105]; break;
  }
  lightToDarkIdx.forEach((inkIdx, rank) => {
    angles[inkIdx] = anglesLightToDark[rank % anglesLightToDark.length];
  });
  return angles;
}

// Angle for one plate: Spectrolite per-ink default angles when the layer
// has them (sepAngles), otherwise the shared legacy halftoneAngle plus the
// per-hex offset from the legacy `_separationAngles` table.
export function sepAngleFor(layer, colorHex, colorIdx, legacyOffsets) {
  if (Array.isArray(layer.sepAngles) && layer.sepAngles[colorIdx] != null) {
    return ((layer.sepAngles[colorIdx] % 180) + 180) % 180;
  }
  const base = layer.halftoneAngle || 45;
  const offset = (legacyOffsets && legacyOffsets[colorHex]) || 0;
  return (base + offset) % 180;
}

/* ─── Dithering helpers ───────────────────────────────────────────── */

export function ditherMethodIndex(id) {
  const i = DITHER_METHODS.findIndex(m => m.id === id);
  return i < 0 ? 0 : i;
}

/* ─── Separation method config ────────────────────────────────────── */

// Port of PosterizeConfig.getDefaultInkBreakpoints(nInks): breakpoints in
// 0=black..1=white; the last leaves a white range above the threshold.
export function defaultPosterizeBreakpoints(n) {
  if (n === 1) return [0.5];
  return Array.from({ length: n }, (_, i) =>
    i < n - 1 ? (i + 1) / n : 1 - 0.05);
}

// Port of PosterizeConfig.createDefault: dark→light ink ranges.
export function defaultPosterizeConfig(hexes) {
  const darkToLight = hexes.slice().sort((a, b) => luminanceOf(a) - luminanceOf(b));
  return {
    blackpointMinThreshold: 0,
    grayscaleBreakpoints: defaultPosterizeBreakpoints(hexes.length),
    rangeToInkIndex: darkToLight.map(h => hexes.indexOf(h)),
  };
}

// CMYK-ish channel identifiers (Spectrolite: #00ffff / #ff00ff / #ffff00 / #000000)
const CMYK_CHANNELS = [
  { id: 'C', rgb: '#00ffff', groups: ['blues'] },
  { id: 'M', rgb: '#ff00ff', groups: ['pinks'] },
  { id: 'Y', rgb: '#ffff00', groups: ['yellows'] },
  { id: 'K', rgb: '#000000', groups: ['grays'] },
];

// Port of getClosestInks: prefer inks from the channel's color groups,
// otherwise fall back to all inks, ordered by deltaLab distance; the K
// channel just wants the closest (darkest) ink overall.
function closestChannelInk(channel, hexes) {
  const sorted = hexes.slice().sort((a, b) => deltaLab(channel.rgb, a) - deltaLab(channel.rgb, b));
  const inGroup = sorted.filter(h => channel.groups.includes(inkGroup(h)));
  const outGroup = sorted.filter(h => !inGroup.includes(h));
  const ranked = inGroup.concat(outGroup);
  return ranked[0] || sorted[0];
}

// Returns { opacities, channelInkHexes } for C/M/Y/K.
export function defaultCmykishConfig(hexes) {
  return {
    opacities: [1, 1, 1, 1],
    channelInkHexes: CMYK_CHANNELS.map(ch => closestChannelInk(ch, hexes)),
  };
}

export function posterizeConfigFor(layer) {
  return layer.posterizeConfig || defaultPosterizeConfig(layer.separationColors);
}

export function cmykishConfigFor(layer) {
  return layer.cmykishConfig || defaultCmykishConfig(layer.separationColors);
}

/* ─── Plate generation per separation method ──────────────────────── */

// Generate separation plates for a layer's chosen method.  Returns a flat
// Uint8Array of [plate0_rgba, plate1_rgba, …] exactly like
// separate_colors_with_lut, so callers can swap methods transparently.
// Plate i must then map to layer.separationColors[i]:
//   · 'lut'       → separationColors is the palette (minus white)
//   · 'cmykish'   → separationColors IS the C/M/Y/K ink assignment
//                   (set at config time via defaultCmykishConfig)
export function generateSeparationPlates(layer, imageData, width, height) {
  const sepColors = layer.separationColors;
  const style = layer.separationStyle || 'lut';

  if (style === 'posterize') {
    const cfg = posterizeConfigFor(layer);
    const bp = new Float64Array(cfg.grayscaleBreakpoints);
    const rti = new Uint32Array(cfg.rangeToInkIndex.map(i => i | 0));
    return _wasm.posterizeToPlates(imageData, width, height, cfg.blackpointMinThreshold, bp, rti, Math.max(1, sepColors.length));
  }

  if (style === 'cmykish') {
    const cfg = cmykishConfigFor(layer);
    // WASM always returns 4 plates in C/M/Y/K order; the caller is
    // responsible for keeping separationColors in that same order.
    return _wasm.cmykishToPlates(imageData, width, height, new Float64Array(cfg.opacities));
  }

  return window.separateColorsWithLut(imageData, width, height, window.colorSepLut, 16, sepColors.length);
}

export function rebuildLayerSepPlates(layer, sourceCanvas) {
  const nw = sourceCanvas.width, nh = sourceCanvas.height;
  const sCtx = sourceCanvas.getContext('2d');
  const imageData = sCtx.getImageData(0, 0, nw, nh);
  const plateBuffer = generateSeparationPlates(layer, imageData.data, nw, nh);
  const pixelCount = nw * nh;
  const sepColors = layer.separationColors;
  layer.separationPlates = new Map();
  for (let i = 0; i < sepColors.length; i++) {
    const plateCanvas = new OffscreenCanvas(nw, nh);
    const pCtx = plateCanvas.getContext('2d');
    const plateData = new ImageData(
      new Uint8ClampedArray(plateBuffer.buffer, i * pixelCount * 4, pixelCount * 4),
      nw, nh
    );
    pCtx.putImageData(plateData, 0, 0);
    layer.separationPlates.set(sepColors[i], plateCanvas);
  }
}

export { toImageData };
