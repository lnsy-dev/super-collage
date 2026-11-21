/* ═══════════════════════════════════════════════════════════════════
   SUPER COLLAGE  ·  Application constants
   ═══════════════════════════════════════════════════════════════════ */

export let CANVAS_W = 3300;
export let CANVAS_H = 5100;
// Base padding around the page frame (doc px). The overlay canvas may grow
// beyond this to keep selection handles visible when layers are positioned
// far outside the page ("handles for images should not be masked no matter
// what their position is"). CANVAS_PAD is the *current* padding in use.
export const CANVAS_PAD_BASE = 1000;
export let CANVAS_PAD = CANVAS_PAD_BASE;

export function setCanvasSize(w, h) {
  CANVAS_W = w;
  CANVAS_H = h;
}

export function setCanvasPad(pad) {
  CANVAS_PAD = Math.max(CANVAS_PAD_BASE, Math.ceil(pad));
}

export const PAGE_SIZE_DIMS = {
  // Imperial
  'letter':       { w: 5100, h: 6600,  name: 'Letter',        unit: 'imperial', wIn: 8.5,  hIn: 11 },
  'legal':        { w: 5100, h: 8400,  name: 'Legal',         unit: 'imperial', wIn: 8.5,  hIn: 14 },
  'half-letter':  { w: 3300, h: 5100,  name: 'Half Letter',   unit: 'imperial', wIn: 5.5,  hIn: 8.5 },
  'tabloid':      { w: 6600, h: 10200, name: 'Tabloid',       unit: 'imperial', wIn: 11,   hIn: 17 },
  '4x6':          { w: 2400, h: 3600,  name: '4 × 6',         unit: 'imperial', wIn: 4,    hIn: 6 },
  '4.25x7':       { w: 2550, h: 4200,  name: '4.25 × 7',      unit: 'imperial', wIn: 4.25, hIn: 7 },
  // Wrap cover for a 3.5 × 5.5 notebook: back and front cover side by side.
  'notebook-cover':{ w: 4200, h: 3300,  name: 'Notebook Cover 3.5 × 5.5', unit: 'imperial', wIn: 7, hIn: 5.5 },
  'manga':        { w: 3024, h: 4302,  name: 'Manga',         unit: 'imperial', wIn: 5.04, hIn: 7.17 },
  'business-card':{ w: 2100, h: 1200,  name: 'Business Card', unit: 'imperial', wIn: 3.5,  hIn: 2 },
  // Metric
  'a6':           { w: 2480, h: 3496,  name: 'A6',            unit: 'metric',   wCm: 10.5, hCm: 14.8 },
  'a5':           { w: 3496, h: 4961,  name: 'A5',            unit: 'metric',   wCm: 14.8, hCm: 21.0 },
  'a4':           { w: 4961, h: 7016,  name: 'A4',            unit: 'metric',   wCm: 21.0, hCm: 29.7 },
  'a3':           { w: 7016, h: 9921,  name: 'A3',            unit: 'metric',   wCm: 29.7, hCm: 42.0 },
  'dl':           { w: 2339, h: 4961,  name: 'DL',            unit: 'metric',   wCm: 9.9,  hCm: 21.0 },
};

function fmtIn(v) {
  return Number.isInteger(v) ? v.toString() : v.toFixed(2).replace(/\.?0+$/, '');
}

function fmtCm(v) {
  return v.toFixed(1).replace(/\.0$/, '');
}

export function formatPageSizeLabel(key, unit = 'imperial') {
  const d = PAGE_SIZE_DIMS[key];
  if (!d) return key;
  if (unit === 'metric' && d.wCm != null && d.hCm != null) {
    return `${d.name} (${fmtCm(d.wCm)} × ${fmtCm(d.hCm)} cm)`;
  }
  if (d.wIn != null && d.hIn != null) {
    return `${d.name} (${fmtIn(d.wIn)}" × ${fmtIn(d.hIn)}")`;
  }
  return d.name;
}

export function formatPxDimensions(w, h, unit = 'imperial') {
  if (unit === 'metric') {
    return `${fmtCm(w / 600 * 2.54)} × ${fmtCm(h / 600 * 2.54)} cm`;
  }
  return `${fmtIn(w / 600)}" × ${fmtIn(h / 600)}"`;
}

export function getProjectSizeLabel(project) {
  if (!project) return '';
  const unit = project.pageSizeUnit || 'imperial';
  if (project.pageSize === 'custom' && project.customW && project.customH) {
    return `Custom (${formatPxDimensions(project.customW, project.customH, unit)})`;
  }
  return formatPageSizeLabel(project.pageSize, unit) || formatPageSizeLabel('letter', unit);
}

export const DEFAULT_RISO_COLORS = [
  { name: 'Black',       hex: '#010101', pantone: 'BLACK U' },
  { name: 'Red',         hex: '#f65058', pantone: 'RED 032 U'},
  { name: 'Neon Orange', hex: '#ff7477', pantone: '805 U' },
  { name: 'Yellow',      hex: '#ffe800', pantone: 'YELLOW U' },
  { name: 'Neon Pink',   hex: '#ff48b0', pantone: '806 U' },
  { name: 'Aqua',        hex: '#5ec8e5', pantone: '637 U' },
  { name: 'Blue',        hex: '#0078bf', pantone: '3005 U' },
  { name: 'White',       hex: '#FFFFFF', pantone: '' },
];

export const RISO_COLORS = DEFAULT_RISO_COLORS.map(c => ({ ...c }));

export function setRisoColors(colors) {
  RISO_COLORS.length = 0;
  RISO_COLORS.push(...colors.map(c => ({ ...c })));
}

/* ─── Ink naming helpers ─────────────────────────────────────────────
   Every exported ink must carry a real name; hex strings must never
   reach an export as a color name. */

/**
 * Look up the riso ink name for a hex color in the live RISO_COLORS
 * palette (case-insensitive). Stray out-of-palette layer hexes fall
 * back to the raw `hex` argument unchanged.
 */
export function inkNameForHex(hex) {
  if (typeof hex !== 'string' || hex === '') return hex;
  const upper = hex.toUpperCase();
  const match = RISO_COLORS.find(c => c.hex.toUpperCase() === upper);
  return match ? match.name : hex;
}

/**
 * Return a copy of `colors` in which every entry carries a real name.
 * An entry needs renaming when its name is missing/whitespace-only,
 * equals 'Untitled' (case-insensitive), or equals its own hex
 * (case-insensitive — legacy "Save Color" behavior). Renames use the
 * shared 'Custom N' counter, skipping any name already in use among
 * `colors` (before or after renaming) or in `reserved`. Pure: the
 * input array and its entries are never mutated. Returns
 * `{ colors, changed }`.
 */
export function ensureColorNames(colors, reserved = []) {
  const used = new Set();
  const markUsed = name => used.add(name.toUpperCase());

  for (const c of colors) {
    if (c && typeof c.name === 'string') markUsed(c.name);
  }
  for (const r of reserved) {
    if (typeof r === 'string') markUsed(r);
  }

  const out = colors.map(c => ({ ...c }));
  let counter = 0;
  let changed = false;

  for (const entry of out) {
    const name = entry.name;
    const needsRename = typeof name !== 'string'
      || name.trim() === ''
      || name.toUpperCase() === 'UNTITLED'
      || (typeof entry.hex === 'string' && name.toUpperCase() === entry.hex.toUpperCase());
    if (!needsRename) continue;
    counter += 1;
    let candidate = `Custom ${counter}`;
    while (used.has(candidate.toUpperCase())) {
      counter += 1;
      candidate = `Custom ${counter}`;
    }
    entry.name = candidate;
    markUsed(candidate);
    changed = true;
  }

  return { colors: out, changed };
}

// 8×8 Bayer matrix (values 0-255)
export const BAYER8 = new Uint8Array([
   0,136, 34,170,  2,138, 36,172,
 204, 68,238,102,206, 70,240,104,
  51,187, 17,153, 53,189, 19,155,
 255,119,221, 85,253,121,219, 87,
   3,139, 37,173,  1,137, 35,171,
 207, 71,241,105,205, 69,239,103,
  54,190, 20,156, 52,188, 18,154,
 253,123,217, 89,255,121,221, 85,
]);
