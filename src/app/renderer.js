/* ═══════════════════════════════════════════════════════════════════
   Renderer & Transform
   ═══════════════════════════════════════════════════════════════════ */

import { State, selectedLayer } from './state.js';
import { CANVAS_W, CANVAS_H, CANVAS_PAD } from './constants.js';
import { ImageProcessor } from './image-processor.js';

const displayCanvas   = document.getElementById('display-canvas');
const dCtx            = displayCanvas.getContext('2d');
export const overlayCanvas = document.getElementById('interaction-overlay');
const oCtx            = overlayCanvas.getContext('2d');
const maskOverlayCanvas = document.getElementById('mask-canvas-overlay');
const mCtx            = maskOverlayCanvas.getContext('2d');

export const Renderer = {

  init() { this.resize(); },

  resize() {
    const z = State.zoom;
    const dw = Math.round(CANVAS_W * z);
    const dh = Math.round(CANVAS_H * z);
    const ow = Math.round((CANVAS_W + CANVAS_PAD * 2) * z);
    const oh = Math.round((CANVAS_H + CANVAS_PAD * 2) * z);
    displayCanvas.width = dw; displayCanvas.height = dh;
    displayCanvas.style.width = dw + 'px'; displayCanvas.style.height = dh + 'px';
    overlayCanvas.width = ow; overlayCanvas.height = oh;
    overlayCanvas.style.width = ow + 'px'; overlayCanvas.style.height = oh + 'px';
    const padPx = Math.round(CANVAS_PAD * z);
    overlayCanvas.style.top = -padPx + 'px';
    overlayCanvas.style.left = -padPx + 'px';
    maskOverlayCanvas.width = dw; maskOverlayCanvas.height = dh;
    maskOverlayCanvas.style.width = dw + 'px'; maskOverlayCanvas.style.height = dh + 'px';

    if (State.zoomDebounceTimer) clearTimeout(State.zoomDebounceTimer);
    State.zoomDebounceTimer = setTimeout(() => {
      for (const layer of State.layers) {
        if (!layer._processedAtZoom) { layer._dirty = true; continue; }
        const ratio = State.zoom / layer._processedAtZoom;
        if (ratio > 1.3 || ratio < 0.7) {
          layer._dirty = true;
        }
      }
      this.schedule();
    }, 150);

    this.schedule();
  },

  schedule() {
    if (State.renderPending) return;
    State.renderPending = true;
    requestAnimationFrame(async () => { await this.draw(); State.renderPending = false; });
  },

  _getLayerScreenBounds(layer, z) {
    const cx = (layer.x + layer.width / 2) * z;
    const cy = (layer.y + layer.height / 2) * z;
    const hw = layer.width / 2 * z;
    const hh = layer.height / 2 * z;
    const angle = layer.rotation * Math.PI / 180;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const halfDiagW = hw * cos + hh * sin;
    const halfDiagH = hw * sin + hh * cos;
    return {
      left: cx - halfDiagW,
      top: cy - halfDiagH,
      right: cx + halfDiagW,
      bottom: cy + halfDiagH,
      width: Math.ceil(halfDiagW * 2),
      height: Math.ceil(halfDiagH * 2),
    };
  },

  _layerIntersectsViewport(layer, z) {
    const scroll = document.getElementById('canvas-scroll');
    if (!scroll) return true;
    // Layer bounds are relative to the canvas top-left.
    // Convert to scroll-container space by adding the canvas's offset within the container.
    const canvasOffsetLeft = displayCanvas.offsetLeft + (displayCanvas.offsetParent?.offsetLeft ?? 0);
    const canvasOffsetTop  = displayCanvas.offsetTop  + (displayCanvas.offsetParent?.offsetTop  ?? 0);
    const b = this._getLayerScreenBounds(layer, z);
    const layerLeft   = b.left   + canvasOffsetLeft;
    const layerTop    = b.top    + canvasOffsetTop;
    const layerRight  = b.right  + canvasOffsetLeft;
    const layerBottom = b.bottom + canvasOffsetTop;
    const viewLeft   = scroll.scrollLeft;
    const viewTop    = scroll.scrollTop;
    const viewRight  = viewLeft + scroll.clientWidth;
    const viewBottom = viewTop  + scroll.clientHeight;
    return !(layerRight < viewLeft || layerLeft > viewRight || layerBottom < viewTop || layerTop > viewBottom);
  },

  async draw() {
    const z = State.zoom;
    const w = displayCanvas.width, h = displayCanvas.height;
    // Reset composite mode — ensures white paper fill is correct regardless of prior state
    dCtx.globalCompositeOperation = 'source-over';
    dCtx.clearRect(0, 0, w, h);
    dCtx.fillStyle = '#fff';
    dCtx.fillRect(0, 0, w, h);

    for (const layer of State.layers) {
      if (!layer.visible) continue;
      if (layer.isMaskFor) continue; // rendered as part of the masked layer below it
      if (!this._layerIntersectsViewport(layer, z)) continue;
      if (layer._dirty) await ImageProcessor.processLayer(layer);
      if (!layer._processedCanvas) continue;
      dCtx.save();
      if (layer.imageMaskIds?.length) {
        this._compositeLayerWithImageMask(dCtx, layer, z);
      } else {
        this._applyTransform(dCtx, layer, z);
        this._compositeLayer(dCtx, layer, z);
      }
      dCtx.restore();
    }

    this.drawOverlay();
  },

  _applyTransform(ctx, layer, scale, isOverlay = false) {
    const pad = isOverlay ? CANVAS_PAD * scale : 0;
    const cx = (layer.x + layer.width / 2) * scale;
    const cy = (layer.y + layer.height / 2) * scale;
    ctx.translate(cx + pad, cy + pad);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
    ctx.translate(-layer.width / 2 * scale, -layer.height / 2 * scale);
  },

  _compositeLayer(ctx, layer, z) {
    const dw = layer.width * z, dh = layer.height * z;
    ctx.globalCompositeOperation = 'multiply';
    const quality = ctx.imageSmoothingQuality;
    if (layer.isText) ctx.imageSmoothingQuality = 'high';
    if (!layer._maskCanvas) {
      ctx.drawImage(layer._processedCanvas, 0, 0, dw, dh);
    } else {
      const tmp = new OffscreenCanvas(Math.ceil(dw), Math.ceil(dh));
      const tCtx = tmp.getContext('2d');
      tCtx.imageSmoothingQuality = layer.isText ? 'high' : quality;
      tCtx.drawImage(layer._processedCanvas, 0, 0, dw, dh);
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.drawImage(layer._maskCanvas, 0, 0, dw, dh);
      ctx.drawImage(tmp, 0, 0);
    }
    ctx.imageSmoothingQuality = quality;
  },

  async _compositeLayerWithImageMask(ctx, layer, z) {
    const maskLayers = (layer.imageMaskIds || [])
      .map(id => State.layers.find(l => l.id === id))
      .filter(ml => ml);

    if (!maskLayers.length) {
      // No valid mask layers — fall back to normal rendering
      this._applyTransform(ctx, layer, z);
      this._compositeLayer(ctx, layer, z);
      return;
    }

    const b = this._getLayerScreenBounds(layer, z);
    const cw = b.width, ch = b.height;

    // Buffer A: render base layer at tight bounds (source-over on transparent)
    const layerBuf = new OffscreenCanvas(cw, ch);
    const lCtx = layerBuf.getContext('2d');
    lCtx.save();
    lCtx.translate(
      ((layer.x + layer.width / 2) * z) - b.left,
      ((layer.y + layer.height / 2) * z) - b.top
    );
    lCtx.rotate(layer.rotation * Math.PI / 180);
    lCtx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
    lCtx.translate(-layer.width / 2 * z, -layer.height / 2 * z);
    const dw = layer.width * z, dh = layer.height * z;
    if (layer.isText) lCtx.imageSmoothingQuality = 'high';
    if (layer._maskCanvas) {
      const tmp = new OffscreenCanvas(Math.ceil(dw), Math.ceil(dh));
      const tCtx = tmp.getContext('2d');
      tCtx.imageSmoothingQuality = layer.isText ? 'high' : lCtx.imageSmoothingQuality;
      tCtx.drawImage(layer._processedCanvas, 0, 0, dw, dh);
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.drawImage(layer._maskCanvas, 0, 0, dw, dh);
      lCtx.drawImage(tmp, 0, 0);
    } else {
      lCtx.drawImage(layer._processedCanvas, 0, 0, dw, dh);
    }
    lCtx.restore();

    // Apply each mask sequentially — each further clips the base layer
    for (const maskLayer of maskLayers) {
      if (maskLayer._dirty) await ImageProcessor.processLayer(maskLayer);
      if (!maskLayer._processedCanvas) continue;

      // Buffer B: render mask layer into a full-size buffer, then convert to alpha channel
      // Black (lum=0) → alpha=255 (show base), white/transparent → alpha=0 (hide base)
      const maskBuf = new OffscreenCanvas(cw, ch);
      const mCtx = maskBuf.getContext('2d');
      mCtx.save();
      mCtx.translate(
        ((maskLayer.x + maskLayer.width / 2) * z) - b.left,
        ((maskLayer.y + maskLayer.height / 2) * z) - b.top
      );
      mCtx.rotate(maskLayer.rotation * Math.PI / 180);
      mCtx.scale(maskLayer.flipH ? -1 : 1, maskLayer.flipV ? -1 : 1);
      mCtx.translate(-maskLayer.width / 2 * z, -maskLayer.height / 2 * z);
      mCtx.drawImage(maskLayer._processedCanvas, 0, 0, maskLayer.width * z, maskLayer.height * z);
      mCtx.restore();

      // Invert alpha: ink pixels (alpha=255) become transparent (cuts away base),
      // no-ink pixels (alpha=0) become opaque (reveals base).
      const imgData = mCtx.getImageData(0, 0, cw, ch);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = 255 - d[i + 3];
      }
      mCtx.putImageData(imgData, 0, 0);

      // Apply alpha mask to base layer buffer
      lCtx.globalCompositeOperation = 'destination-in';
      lCtx.drawImage(maskBuf, 0, 0);
    }

    // Composite the masked result onto the main canvas using multiply
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(layerBuf, b.left, b.top);
  },

  drawOverlay() {
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const layer = selectedLayer();
    if (!layer) return;
    const z = State.zoom;
    const handles = this.getHandles(layer, z);

    // Dashed selection rect
    oCtx.save();
    this._applyTransform(oCtx, layer, z, true);
    oCtx.strokeStyle = '#0055ff';
    oCtx.lineWidth = 1;
    oCtx.setLineDash([4, 3]);
    oCtx.strokeRect(0, 0, layer.width * z, layer.height * z);
    oCtx.restore();
    oCtx.setLineDash([]);

    // Rotation handle line
    const tmH = handles.find(h => h.id === 'tm');
    const rotH = handles.find(h => h.id === 'rotate');
    if (tmH && rotH) {
      oCtx.beginPath();
      oCtx.moveTo(tmH.x, tmH.y);
      oCtx.lineTo(rotH.x, rotH.y);
      oCtx.strokeStyle = '#0055ff';
      oCtx.lineWidth = 1;
      oCtx.stroke();
    }

    // Handles
    for (const h of handles) {
      oCtx.fillStyle = h.id === 'rotate' ? '#00aaff' : '#fff';
      oCtx.strokeStyle = '#000';
      oCtx.lineWidth = 1.5;
      oCtx.fillRect(h.x - 5, h.y - 5, 10, 10);
      oCtx.strokeRect(h.x - 5, h.y - 5, 10, 10);
    }
  },

  getHandles(layer, z) {
    const { x, y, width: lw, height: lh, rotation, flipH, flipV } = layer;
    const pad = CANVAS_PAD * z;
    const cx = (x + lw / 2) * z + pad, cy = (y + lh / 2) * z + pad;
    const hw = lw / 2 * z, hh = lh / 2 * z;
    const rawPts = [
      { id: 'tl', lx: -hw, ly: -hh },
      { id: 'tm', lx:   0, ly: -hh },
      { id: 'tr', lx:  hw, ly: -hh },
      { id: 'ml', lx: -hw, ly:   0 },
      { id: 'mr', lx:  hw, ly:   0 },
      { id: 'bl', lx: -hw, ly:  hh },
      { id: 'bm', lx:   0, ly:  hh },
      { id: 'br', lx:  hw, ly:  hh },
      { id: 'rotate', lx: 0, ly: -hh - 22 },
    ];
    const angle = rotation * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return rawPts.map(p => {
      const fx = flipH ? -p.lx : p.lx;
      const fy = flipV ? -p.ly : p.ly;
      return {
        id: p.id,
        x: cx + fx * cos - fy * sin,
        y: cy + fx * sin + fy * cos,
      };
    });
  },

  hitTestHandle(mx, my, layer) {
    for (const h of this.getHandles(layer, State.zoom)) {
      if (Math.abs(mx - h.x) < 8 && Math.abs(my - h.y) < 8) return h;
    }
    return null;
  },

  hitTestLayer(mx, my) {
    for (let i = State.layers.length - 1; i >= 0; i--) {
      const l = State.layers[i];
      if (!l.visible || l.locked) continue;
      const local = Transform.toLocal(mx, my, l, State.zoom);
      if (local.x >= 0 && local.x <= l.width && local.y >= 0 && local.y <= l.height) return l;
    }
    return null;
  },
};

/* ─── TRANSFORM MATH ─────────────────────────────────────────────── */
export const Transform = {
  toLocal(mx, my, layer, zoom) {
    const pad = CANVAS_PAD * zoom;
    const cx = (layer.x + layer.width / 2) * zoom + pad;
    const cy = (layer.y + layer.height / 2) * zoom + pad;
    const dx = mx - cx, dy = my - cy;
    const angle = -layer.rotation * Math.PI / 180;
    let rx = dx * Math.cos(angle) - dy * Math.sin(angle);
    let ry = dx * Math.sin(angle) + dy * Math.cos(angle);
    if (layer.flipH) rx = -rx;
    if (layer.flipV) ry = -ry;
    return { x: rx / zoom + layer.width / 2, y: ry / zoom + layer.height / 2 };
  },
};
