/* ═══════════════════════════════════════════════════════════════════
   Mask Engine
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { clampDims, clampOffscreenCanvas } from './canvas-limits.js';

// Resolution at which mask bitmaps are kept. Masks are pure alpha
// channels sampled at display/export resolution downstream, so keeping
// them near 4K on the long edge preserves full brush precision on
// screen while staying far below browser canvas allocation limits —
// oversized layers previously produced dead 0×0 mask canvases whose
// every save (convertToBlob) threw IndexSizeError.
const MASK_MAX_DIM = 4096;

export const MaskEngine = {
  // Mask bitmap resolution for a layer: natural size clamped to the
  // browser-allocatable envelope, then to MASK_MAX_DIM on the long edge.
  maskDims(layer) {
    const clamped = clampDims(layer.naturalWidth, layer.naturalHeight);
    const long = Math.max(clamped.w, clamped.h);
    if (long > MASK_MAX_DIM) {
      const s = MASK_MAX_DIM / long;
      return { w: Math.max(1, Math.round(clamped.w * s)), h: Math.max(1, Math.round(clamped.h * s)) };
    }
    return { w: clamped.w, h: clamped.h };
  },

  initMask(layer) {
    const { w, h } = this.maskDims(layer);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    layer._maskCanvas = c;
  },

  async loadMask(layer, blob) {
    const bmp = await createImageBitmap(blob);
    const { w, h } = this.maskDims(layer);
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    layer._maskCanvas = c;
  },

  _paint(layer, x, y, radius, isErasing) {
    if (!layer._maskCanvas) this.initMask(layer);
    // Callers work in the layer's natural-image coordinate space; the mask
    // bitmap may be smaller (clamped to browser canvas limits), so scale
    // points and brush radius into mask space before painting.
    const mw = layer._maskCanvas.width, mh = layer._maskCanvas.height;
    const sx = mw / layer.naturalWidth, sy = mh / layer.naturalHeight;
    const mx = x * sx, my = y * sy;
    const mr = Math.max(0.5, radius * (sx + sy) / 2);
    const ctx = layer._maskCanvas.getContext('2d');
    if (isErasing) {
      // Restore visibility: paint opaque white (alpha = 255)
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255,255,255,1)';
    } else {
      // Hide area: punch out alpha (set to 0) via destination-out
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    }
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  },

  paintStroke(layer, x0, y0, x1, y1, radius, isErasing) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.3)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this._paint(layer, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, isErasing);
    }
  },

  clearMask(layer) {
    if (!layer._maskCanvas) this.initMask(layer);
    const ctx = layer._maskCanvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, layer._maskCanvas.width, layer._maskCanvas.height);
  },

  fillMask(layer) {
    // Fill = hide everything: clear alpha to 0 across entire mask
    if (!layer._maskCanvas) this.initMask(layer);
    const ctx = layer._maskCanvas.getContext('2d');
    ctx.clearRect(0, 0, layer._maskCanvas.width, layer._maskCanvas.height);
  },

  invertMask(layer) {
    if (!layer._maskCanvas) this.initMask(layer);
    const ctx = layer._maskCanvas.getContext('2d', { willReadFrequently: true });
    const px = ctx.getImageData(0, 0, layer._maskCanvas.width, layer._maskCanvas.height);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i+3] = 255 - d[i+3]; // invert alpha channel only
    }
    ctx.putImageData(px, 0, 0);
  },
};
