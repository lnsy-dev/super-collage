/* ═══════════════════════════════════════════════════════════════════
   Color Layer — paint bucket tool
   ═══════════════════════════════════════════════════════════════════

   A filling tool that behaves like an ink Mixed paint bucket:

   • The toolbar shows a swatch with the currently mixed ink when the
     tool is active; clicking it (or clicking the active tool button
     again) opens the "Mix Ink" window, which lists every risograph
     color with a coverage slider and simulates their subtractive mix.

   • Clicking the canvas flood-fills the region under the cursor,
     taking the *entire* composite image into account: white areas
     fill to the page edges, colored/black areas likewise. The first
     fill spawns a "Color Layer" tinted with the mixed ink; every
     further bucket click adds its region to that same fill layer,
     growing its bitmap to the union of all filled regions.

   • Double-clicking fills the entire layer (whole page) regardless
     of what is drawn on it.

   • The eyedropper samples the composited page color under the cursor
     (overlapping inks included) and sets the bucket's ink mix to the
     simulated mix that best reproduces it, then hands over to the
     fill bucket.

   The mixed ink is stored in State.bucketColor; per-ink coverage
   (0–100%) lives in State.bucketInks keyed by palette hex.
   ═══════════════════════════════════════════════════════════════════ */

import { State, selectedLayer } from './state.js';
import { RISO_COLORS, CANVAS_W, CANVAS_H } from './constants.js';
import { Layer } from './layer.js';
import { MaskEngine } from './mask-engine.js';
import { Renderer } from './renderer.js';
import { DB } from './db.js';
import { PageManager } from './page-manager.js';
import { UI } from './ui.js';
import { pushUndoState, pushUndoWithRaster } from './undo.js';
import { hexToRgb, rgbToHex } from '../utils/color.js';

// The composite raster is analyzed at a reduced resolution to keep the
// flood fill fast on 600 dpi pages; the region mask is upscaled onto the
// new layer, so its edges stay soft by a page pixel or two at most.
const ANALYSIS_MAX_DIM = 1600;
// Sum-of-channel-differences tolerated when matching the clicked region
// (so antialiased edges and paper/ink noise still join the region).
const FILL_TOLERANCE = 60;
// A single click fills after this delay; a second click inside the
// window cancels it and the following dblclick does a full-page fill.
const DOUBLE_CLICK_WINDOW = 220;

const fillTint = (v, ink, amount) => v * (1 - amount * (1 - ink / 255));

/**
 * Simulate the subtractive mix of risograph inks. Each ink contributes
 * a coverage (0-100); inks multiply over paper, matching the alpha
 * weighted multiply used by blend_subtractive in the WASM module, so a
 * 100% coverage stack looks like the same inks printed on top of each
 * other.
 * @param {Array<{hex: string, amount: number}>} inks
 */
export function mixInks(inks) {
  let r = 255, g = 255, b = 255;
  for (const { hex, amount } of inks) {
    if (hex.toUpperCase() === '#FFFFFF') continue;
    const a = Math.max(0, Math.min(100, amount)) / 100;
    if (a <= 0) continue;
    const { r: ir, g: ig, b: ib } = hexToRgb(hex);
    r = fillTint(r, ir, a);
    g = fillTint(g, ig, a);
    b = fillTint(b, ib, a);
  }
  return rgbToHex(r, g, b);
}

/** Current mixed ink from the per-ink coverage state. */
export function currentBucketColor() {
  const inks = Object.entries(State.bucketInks)
    .map(([hex, amount]) => ({ hex, amount }));
  return mixInks(inks);
}

function inkAmount(hex) {
  return State.bucketInks[hex] ?? 0;
}

/* ─── SWATCH SYNC ─────────────────────────────────────────────────── */

function bucketSwatchEl() {
  return document.getElementById('bucket-color-swatch');
}

/** Keep the toolbar swatch in sync with the mixed ink. */
export function syncBucketSwatch() {
  const el = bucketSwatchEl();
  if (!el) return;
  State.bucketColor = currentBucketColor();
  el.style.background = State.bucketColor;
}

/* ─── MIX INK DIALOG ─────────────────────────────────────────────── */

function updateMixPreview() {
  const swatch = document.getElementById('bucket-mix-swatch');
  const hexLabel = document.getElementById('bucket-mix-hex');
  const mixed = currentBucketColor();
  State.bucketColor = mixed;
  if (swatch) swatch.style.background = mixed;
  if (hexLabel) hexLabel.textContent = mixed.toUpperCase();
  syncBucketSwatch();
}

function buildInkSliders() {
  const wrap = document.getElementById('bucket-ink-sliders');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const c of RISO_COLORS) {
    if (c.hex.toUpperCase() === '#FFFFFF') continue; // paper: not an ink
    const row = document.createElement('div');
    row.className = 'bucket-ink-row';
    row.innerHTML =
      `<span class="bucket-ink-swatch" style="background:${c.hex}"></span>` +
      `<span class="bucket-ink-name">${c.name}</span>` +
      `<input type="range" class="bucket-ink-slider" min="0" max="100" step="1"` +
      ` value="${inkAmount(c.hex)}" data-hex="${c.hex}">` +
      `<span class="bucket-ink-val">${inkAmount(c.hex)}%</span>`;
    const slider = row.querySelector('.bucket-ink-slider');
    const val = row.querySelector('.bucket-ink-val');
    slider.addEventListener('input', () => {
      State.bucketInks[c.hex] = Number(slider.value);
      val.textContent = `${slider.value}%`;
      updateMixPreview();
    });
    wrap.appendChild(row);
  }
}

export function showBucketMixDialog() {
  buildInkSliders();
  document.getElementById('paint-bucket-dialog')?.classList.remove('hidden');
  updateMixPreview();
}

export function hideBucketMixDialog() {
  document.getElementById('paint-bucket-dialog')?.classList.add('hidden');
}

export function resetBucketInks() {
  State.bucketInks = { '#010101': 100 };
  buildInkSliders();
  updateMixPreview();
}

/* ─── FLOOD FILL ─────────────────────────────────────────────────── */

/**
 * Render the whole page composite (paper + every visible layer) at a
 * reduced resolution and flood-fill from the page-space seed point.
 * @returns {{scale:number, w:number, h:number, fill:FloodFillResult}|null}
 */
async function analyzeRegion(pageX, pageY) {
  const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(CANVAS_W, CANVAS_H));
  const w = Math.round(CANVAS_W * scale), h = Math.round(CANVAS_H * scale);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  // skipCulling + zoom=scale: drawLayers scales layer page coordinates by the
  // zoom factor, so at zoom = scale the composite is exactly the page rendered
  // into an (w x h) raster — page point p maps to pixel p * scale.
  await Renderer.drawLayers(ctx, State.layers, w, h, scale, true);
  const data = ctx.getImageData(0, 0, w, h).data;

  const sx = Math.round(pageX * scale), sy = Math.round(pageY * scale);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

  const fill = floodFill(data, w, h, sx, sy, FILL_TOLERANCE);
  return fill ? { scale, w, h, fill } : null;
}

/**
 * 4-neighbour flood fill over the composite raster.
 * @returns {{inside:Uint8Array, minx,maxx,miny,maxy}|null}
 */
function floodFill(data, w, h, sx, sy, tolerance) {
  const seed = (sy * w + sx) * 4;
  const tr = data[seed], tg = data[seed + 1], tb = data[seed + 2];

  const match = i => {
    const p = i * 4;
    return Math.abs(data[p] - tr) + Math.abs(data[p + 1] - tg) + Math.abs(data[p + 2] - tb) <= tolerance;
  };

  const inside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0, minx = sx, maxx = sx, miny = sy, maxy = sy;

  stack[sp++] = sy * w + sx;
  inside[sy * w + sx] = 1;
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w, y = (i / w) | 0;
    if (x < minx) minx = x; else if (x > maxx) maxx = x;
    if (y < miny) miny = y; else if (y > maxy) maxy = y;
    if (x > 0 && !inside[i - 1] && match(i - 1))          { inside[i - 1] = 1; stack[sp++] = i - 1; }
    if (x < w - 1 && !inside[i + 1] && match(i + 1))      { inside[i + 1] = 1; stack[sp++] = i + 1; }
    if (y > 0 && !inside[i - w] && match(i - w))          { inside[i - w] = 1; stack[sp++] = i - w; }
    if (y < h - 1 && !inside[i + w] && match(i + w))      { inside[i + w] = 1; stack[sp++] = i + w; }
  }
  return { inside, minx, maxx, miny, maxy };
}

/**
 * Build the region bitmap: black inside the filled region, white outside.
 * ImageProcessor.colorize turns the black pixels into the layer's ink
 * color and drops the white ones, so the layer renders as exactly the
 * filled shape. Over an existing fill layer it is drawn with 'multiply',
 * which unions the ink (old black stays black, new ink inks).
 */
function buildRegionCanvas(regionPixels, bw, bh) {
  const canvas = new OffscreenCanvas(bw, bh);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(bw, bh);
  const d = img.data;
  for (let i = 0; i < regionPixels.length; i++) {
    const p = i * 4;
    if (regionPixels[i]) { d[p] = 0; d[p + 1] = 0; d[p + 2] = 0; d[p + 3] = 255; }
    else                 { d[p] = 255; d[p + 1] = 255; d[p + 2] = 255; d[p + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * The fill layer currently receiving bucket clicks: the selected layer,
 * when it is one we created with this tool.
 */
function findFillColorLayer() {
  const sel = selectedLayer();
  if (sel && sel.isColorFill && !sel.locked && sel._originalCanvas) return sel;
  return null;
}

/**
 * Add the fill region to an existing Color Layer: the layer bitmap grows
 * to the union bounding box, keeps its pixels, and gains the new ink
 * inside the region (holes in the old fill stay holes, untouched).
 */
function mergeIntoFillLayer(layer, region) {
  // Page-space bounding boxes: the layer's current content vs the new fill.
  const lx = layer.x, ly = layer.y, lw = layer.width, lh = layer.height;
  const ux = Math.min(lx, region.pageX), uy = Math.min(ly, region.pageY);
  const ur = Math.max(lx + lw, region.pageX + region.pageW);
  const ub = Math.max(ly + lh, region.pageY + region.pageH);
  const uw = ur - ux, uh = ub - uy;
  // New natural bitmap spans the union at the analysis scale.
  const natW = Math.max(1, Math.round(uw * region.scale));
  const natH = Math.max(1, Math.round(uh * region.scale));
  const canvas = new OffscreenCanvas(natW, natH);
  const ctx = canvas.getContext('2d');
  // Existing ink, scaled into place within the union.
  ctx.drawImage(layer._originalCanvas,
    (lx - ux) / uw * natW, (ly - uy) / uh * natH,
    lw / uw * natW, lh / uh * natH);
  // New ink via multiply: white (paper) in the region mask is a no-op,
  // black (ink) inks the pixel — the union of both fills.
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(region.canvas,
    (region.pageX - ux) / uw * natW, (region.pageY - uy) / uh * natH,
    region.pageW / uw * natW, region.pageH / uh * natH);
  ctx.globalCompositeOperation = 'source-over';

  layer._originalCanvas = canvas;
  layer.x = ux; layer.y = uy; layer.width = uw; layer.height = uh;
  layer.naturalWidth = natW; layer.naturalHeight = natH;
  layer.color = State.bucketColor;
  layer._dirty = true;
}

/**
 * Place a flood-filled region: merges into the selected Color Layer when
 * there is one using the same ink, otherwise creates a new one.
 * @param {{scale:number, pageX:number, pageY:number, pageW:number, pageH:number,
 *           regionPixels:Uint8Array}} region
 */
async function commitFill(region) {
  // One region bitmap is shared by both paths.
  const canvas = buildRegionCanvas(region.regionPixels.pixels, region.regionPixels.bw, region.regionPixels.bh);
  region = { ...region, canvas };
  const target = findFillColorLayer();
  if (target && target.color === State.bucketColor) {
    pushUndoWithRaster(target);
    mergeIntoFillLayer(target, region);
    await DB.put('layers', target.toRecord());
    await DB.put('imageBlobs', { layerId: target.id, blob: await target._originalCanvas.convertToBlob({ type: 'image/png' }) });
    await PageManager.saveActivePage();
    UI.refreshProperties();
    Renderer.schedule();
    return target;
  }
  pushUndoState();
  const layer = buildColorLayer(region);
  await commitColorLayer(layer);
  return layer;
}

/**
 * Build a new "Color Layer" showing exactly the filled region.
 */
function buildColorLayer(region) {
  const layer = new Layer({
    name: 'Color Layer',
    isColorFill: true,
    x: region.pageX, y: region.pageY, width: region.pageW, height: region.pageH,
    naturalWidth: region.bw, naturalHeight: region.bh,
    color: State.bucketColor,
  });
  layer._originalCanvas = region.canvas;
  MaskEngine.initMask(layer);
  return layer;
}

async function commitColorLayer(layer) {
  State.layers.push(layer);
  State.selectedId = layer.id;
  State.selectedIds = [layer.id];

  await DB.put('layers', layer.toRecord());
  await DB.put('imageBlobs', { layerId: layer.id, blob: await layer._originalCanvas.convertToBlob({ type: 'image/png' }) });
  await DB.put('maskBlobs', { layerId: layer.id, blob: await layer._maskCanvas.convertToBlob({ type: 'image/png' }) });
  await PageManager.saveActivePage();

  document.getElementById('no-layer-msg').style.display = 'none';
  UI.refreshLayerList();
  UI.refreshProperties();
  Renderer.schedule();
}

let fillBusy = false;

/** Flood-fill the region under the click and place it on a Color Layer. */
export async function fillRegionAtPage(pageX, pageY) {
  if (!State.project || fillBusy) return;
  if (pageX < 0 || pageY < 0 || pageX >= CANVAS_W || pageY >= CANVAS_H) return;
  fillBusy = true;
  try {
    const result = await analyzeRegion(pageX, pageY);
    if (!result) return;
    const { scale, fill, w: aw, h: ah } = result;
    const minx = fill.minx, miny = fill.miny;
    const bw = fill.maxx - minx + 1, bh = fill.maxy - miny + 1;
    // Extract the bbox sub-rectangle of the region mask.
    const regionPixels = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      regionPixels.set(fill.inside.subarray((miny + y) * aw + minx, (miny + y) * aw + minx + bw), y * bw);
    }
    await commitFill({
      scale,
      pageX: Math.round(minx / scale), pageY: Math.round(miny / scale),
      pageW: Math.round(bw / scale), pageH: Math.round(bh / scale),
      bw, bh,
      regionPixels: { pixels: regionPixels, bw, bh },
    });
  } catch (err) {
    console.error('Color Layer fill failed:', err);
  } finally {
    fillBusy = false;
  }
}

/** Fill the entire layer (whole page) regardless of what is drawn on it. */
export async function fillEntireLayer() {
  if (!State.project || fillBusy) return;
  fillBusy = true;
  try {
    const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(CANVAS_W, CANVAS_H));
    const bw = Math.round(CANVAS_W * scale), bh = Math.round(CANVAS_H * scale);
    // Solid ink over the whole page (colorize turns it all into the ink color).
    const regionPixels = new Uint8Array(bw * bh).fill(1);
    await commitFill({
      scale,
      pageX: 0, pageY: 0,
      pageW: Math.round(CANVAS_W), pageH: Math.round(CANVAS_H),
      bw, bh,
      regionPixels: { pixels: regionPixels, bw, bh },
    });
  } catch (err) {
    console.error('Color Layer fill-all failed:', err);
  } finally {
    fillBusy = false;
  }
}

/* ─── EYEDROPPER ────────────────────────────────────────────────────
   Samples the composited page color under the cursor (the same white
   paper + multiply stack the flood fill sees, so two overlapping inks
   sample as their combined printed color) and fits a per-ink coverage
   mix that reproduces it, including partial-coverage shading. */

/**
 * Render the composite page at the analysis scale and return the color
 * at the page-space point, as '#RRGGBB'.
 */
export async function sampleColorAtPage(pageX, pageY) {
  if (!State.project) return null;
  if (pageX < 0 || pageY < 0 || pageX >= CANVAS_W || pageY >= CANVAS_H) return null;
  const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(CANVAS_W, CANVAS_H));
  const w = Math.round(CANVAS_W * scale), h = Math.round(CANVAS_H * scale);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  await Renderer.drawLayers(ctx, State.layers, w, h, scale, true);
  const sx = Math.max(0, Math.min(w - 1, Math.round(pageX * scale)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(pageY * scale)));
  const d = ctx.getImageData(sx, sy, 1, 1).data;
  return rgbToHex(d[0], d[1], d[2]);
}

/**
 * Fit per-ink coverages (0-100, integers) whose simulated mix best
 * reproduces the given color. The mix is multiplicative per channel, so
 * the inverse is not unique, and greedy per-coordinate search gets
 * trapped in local basins (e.g. trading aqua against black). Instead:
 * enumerate every subset of ≤3 inks (3 output channels ⇒ no exact mix
 * needs more), seed each subset from its coverage corners, and refine
 * by coordinate descent within the subset. Any mix built from ≤3 inks —
 * including partial-coverage shading — is found exactly this way;
 * otherwise the closest subset wins. Ties prefer fewer inks.
 * @returns {{hex: string, inks: Object<string, number>}}
 */
export function fitInksToColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const target = [r, g, b];
  const inks = RISO_COLORS
    .filter(c => c.hex.toUpperCase() !== '#FFFFFF')
    .map(c => {
      const { r, g, b } = hexToRgb(c.hex);
      return { hex: c.hex, rgb: [r, g, b] };
    });
  const n = inks.length;

  const mixCost = cov => {
    let err = 0;
    for (let k = 0; k < 3; k++) {
      let v = 255;
      for (let i = 0; i < n; i++) {
        const a = cov[i] / 100;
        if (a > 0) v *= 1 - a * (1 - inks[i].rgb[k] / 255);
      }
      err += (v - target[k]) * (v - target[k]);
    }
    return err;
  };

  // Greedy 1D refinement of each coverage in the subset; clamped to [0, 100].
  const descend = (cov, idxs) => {
    let best = mixCost(cov);
    let step = 50;
    while (step >= 1) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const i of idxs) {
          for (const dir of [1, -1]) {
            const old = cov[i];
            const nv = Math.max(0, Math.min(100, old + dir * step));
            if (nv === old) continue;
            cov[i] = nv;
            const err = mixCost(cov);
            if (err < best - 1e-9) { best = err; improved = true; }
            else cov[i] = old;
          }
        }
      }
      step = step > 2 ? Math.round(step / 2) : step - 1;
    }
    return best;
  };

  let bestErr = Infinity;
  let bestCov = new Array(n).fill(0);
  const consider = cov => {
    // Tiny sparsity bonus: prefer fewer inks when errors tie.
    const err = mixCost(cov) + 0.01 * cov.filter(v => v > 0).length;
    if (err < bestErr) { bestErr = err; bestCov = cov.slice(); }
  };

  for (let mask = 0; mask < (1 << n); mask++) {
    // Subset size ≤ 3: three output channels never need more inks.
    let size = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) size++;
    if (size > 3) continue;
    const idxs = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) idxs.push(i);
    // Coverage corners of the subset as seeds.
    for (let combo = 0; combo < (1 << idxs.length); combo++) {
      const cov = new Array(n).fill(0);
      idxs.forEach((ix, j) => { if (combo & (1 << j)) cov[ix] = 100; });
      descend(cov, idxs);
      consider(cov);
      if (mixCost(cov) < 1e-9) { mask = 1 << n; break; } // exact fit found
    }
  }

  const inksOut = {};
  inks.forEach((ink, i) => { inksOut[ink.hex] = Math.round(bestCov[i]); });
  const achieved = mixInks(Object.entries(inksOut).map(([h, amount]) => ({ hex: h, amount })));
  return { hex: achieved, inks: inksOut };
}

/** Apply a fitted mix to the bucket state, swatches, and open mixer UI. */
function applyInks(inks) {
  State.bucketInks = inks;
  updateMixPreview();
  buildInkSliders();
}

/**
 * Eyedropper: sample the composite color at the page point and set the
 * bucket's ink mix to the closest simulated mix. Keeps the current tool;
 * the caller decides whether to hand over to the fill bucket.
 */
export async function pickInkAtPage(pageX, pageY) {
  try {
    const hex = await sampleColorAtPage(pageX, pageY);
    if (!hex) return null;
    const fit = fitInksToColor(hex);
    applyInks(fit.inks);
    return fit;
  } catch (err) {
    console.error('Eyedropper failed:', err);
    return null;
  }
}

/* ─── INPUT SCHEDULING ──────────────────────────────────────────────
   A single click must fill its region, but the second click of a
   double-click must not (the dblclick handler promotes it to a full
   layer fill instead). Each pointerdown (re)schedules the region fill
   DOUBLE_CLICK_WINDOW ahead; a fast second click replaces it, and
   onDoubleClick cancels the pending fill before filling everything. */

let pendingClickTimer = null;

export function onBucketPointerDown(pageX, pageY) {
  if (pendingClickTimer) clearTimeout(pendingClickTimer);
  pendingClickTimer = setTimeout(() => {
    pendingClickTimer = null;
    fillRegionAtPage(pageX, pageY);
  }, DOUBLE_CLICK_WINDOW);
}

export function onBucketDoubleClick() {
  if (pendingClickTimer) {
    clearTimeout(pendingClickTimer);
    pendingClickTimer = null;
  }
  fillEntireLayer();
}

/** Drop a still-pending region fill (e.g. when the tool switches). */
export function cancelBucketPending() {
  if (pendingClickTimer) {
    clearTimeout(pendingClickTimer);
    pendingClickTimer = null;
  }
}

/** Namespace for e2e tests and external wiring. */
export const BucketTool = {
  onPointerDown: onBucketPointerDown,
  onDoubleClick: onBucketDoubleClick,
  cancelPending: cancelBucketPending,
  showMixDialog: showBucketMixDialog,
  hideMixDialog: hideBucketMixDialog,
  syncSwatch: syncBucketSwatch,
  fillRegionAtPage,
  fillEntireLayer,
  pickInk: pickInkAtPage,
  fitInksToColor,
  sampleColorAtPage,
};

// Paint the toolbar swatch with the initial ink on load.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', syncBucketSwatch, { once: true });
} else {
  syncBucketSwatch();
}
