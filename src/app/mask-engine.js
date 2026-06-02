/* ═══════════════════════════════════════════════════════════════════
   Mask Engine
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';

export const MaskEngine = {
  initMask(layer) {
    const c = new OffscreenCanvas(layer.naturalWidth, layer.naturalHeight);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, layer.naturalWidth, layer.naturalHeight);
    layer._maskCanvas = c;
  },

  async loadMask(layer, blob) {
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(layer.naturalWidth, layer.naturalHeight);
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    layer._maskCanvas = c;
  },

  _paint(layer, x, y, radius, isErasing) {
    if (!layer._maskCanvas) this.initMask(layer);
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
    ctx.arc(x, y, radius, 0, Math.PI * 2);
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
    ctx.fillRect(0, 0, layer.naturalWidth, layer.naturalHeight);
  },

  fillMask(layer) {
    // Fill = hide everything: clear alpha to 0 across entire mask
    if (!layer._maskCanvas) this.initMask(layer);
    const ctx = layer._maskCanvas.getContext('2d');
    ctx.clearRect(0, 0, layer.naturalWidth, layer.naturalHeight);
  },

  invertMask(layer) {
    if (!layer._maskCanvas) this.initMask(layer);
    const ctx = layer._maskCanvas.getContext('2d', { willReadFrequently: true });
    const px = ctx.getImageData(0, 0, layer.naturalWidth, layer.naturalHeight);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i+3] = 255 - d[i+3]; // invert alpha channel only
    }
    ctx.putImageData(px, 0, 0);
  },
};
