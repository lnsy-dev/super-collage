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

/**
 * The document canvas backing stores are capped: at high zoom the CSS-size
 * backing store used to scale with the page (a letter page at 2× would be
 * 10200×13200 ≈ 134 megapixels per canvas, reallocated and fully repainted on
 * every zoom step — the source of "zooming slows the app down"). Above the
 * cap the backing store is at a proportionally smaller resolution and the
 * context is scaled up, so document coordinates still map 1:1 to screen px.
 * Past the cap the backing dimensions stop growing, so zooming no longer
 * reallocates anything at all.
 *
 * The caps only bite on very large pages/zooms: every page type at zoom ≤ 1
 * keeps its previous full-resolution 1:1 backing store.
 */
const CANVAS_MAX_EDGE   = 8192;
const CANVAS_MAX_PIXELS = 40 * 1024 * 1024; // ~40 MP per canvas
// Draw cadence while a mask brush stroke is active (see schedule()): dabs
// land on every pointermove, but the mask composites only re-render at
// this interval. Lower number = smoother preview, higher CPU.
const MASK_STROKE_FRAME_MS = 32;

function capScale(cssW, cssH) {
  const edge = Math.min(1, CANVAS_MAX_EDGE / Math.max(cssW, cssH));
  const area = Math.min(1, Math.sqrt(CANVAS_MAX_PIXELS / (cssW * cssH)));
  return Math.max(0.05, Math.min(edge, area));
}

/* Render-cache invalidation keys: the caches below store *references to the
   source bitmaps* (_processedCanvas / _maskCanvas are replaced wholesale
   whenever a layer is re-processed) plus the mask revision counters, and
   compare them with plain === on reuse. Reference identity is the exact
   invalidation signal — no registry bookkeeping involved. */
function sameRefs(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const Renderer = {

  _displayScale: 1,  // backing px per CSS px on the document canvas
  _overlayScale: 1,  // backing px per CSS px on the interaction overlay
  _lastFullPaintAt: 0,
  // Active brush strokes (mask-draw / mask-erase pointer sessions). While
  // > 0, per-frame composite rebuilds switch to viewport-slice caches:
  // every dab invalidates the painted-mask composites, so a stroke would
  // otherwise re-render full megapixel-class buffers per frame per masked
  // layer — which made the brush stop responding on projects with many
  // diffed masks.
  _brushDepth: 0,
  // Wall timestamp of the last completed draw; used by schedule()'s
  // brush-stroke frame coalescing.
  _lastDrawAt: 0,
  // Offline counters used by the zoom-performance test suite:
  // how often each composite cache had to be rebuilt, how many zoom
  // steps were served with the cheap preview blit instead of a full repaint,
  // and how often the backing stores were actually reallocated (zoom
  // bursts must coalesce into one settle-time reallocation; the reported
  // "zoomed-in projects crash the whole computer" came from allocating
  // megapixel-class backing stores per zoom step, outpacing the GC).
  _stats: { imageMaskBuilds: 0, paintedMaskBuilds: 0, previewBlits: 0, backingReallocs: 0 },

  init() { this.resize(); },

  // Brush-stroke session tracking: see _brushDepth above.
  beginBrushStroke() {
    // Mask painting composites at State.zoom; if a zoom step is still pending
    // the backing store would be at the old scale, causing the layer to jump.
    if (State.zoomDebounceTimer) this._settleZoom();
    this._brushDepth++;
  },
  endBrushStroke() { if (this._brushDepth > 0) this._brushDepth--; },

  // CSS-pixel size of the document area (independent of the backing scale)
  _docSize() {
    return {
      w: Math.round(CANVAS_W * State.zoom),
      h: Math.round(CANVAS_H * State.zoom),
    };
  },

  resize() {
    const z = State.zoom;
    const dw = Math.round(CANVAS_W * z);
    const dh = Math.round(CANVAS_H * z);
    const ow = Math.round((CANVAS_W + CANVAS_PAD * 2) * z);
    const oh = Math.round((CANVAS_H + CANVAS_PAD * 2) * z);
    const padPx = Math.round(CANVAS_PAD * z);

    // A zoom step resizes the CSS box immediately so the browser can stretch
    // the existing backing store as a cheap preview. The backing-store
    // reallocation and per-layer quality reprocess are debounced to settle —
    // but while zoom is pending, any draw (scroll, mask brush strokes) would
    // composite State.zoom geometry into the old-sized backing store and make
    // layers appear to jump. Callers that need correct interactive rendering
    // (e.g. mask brush strokes) force a settle via _settleZoom() first.
    displayCanvas.style.width = dw + 'px';
    displayCanvas.style.height = dh + 'px';
    overlayCanvas.style.width = ow + 'px';
    overlayCanvas.style.height = oh + 'px';
    overlayCanvas.style.top = -padPx + 'px';
    overlayCanvas.style.left = -padPx + 'px';
    this._overlaySize = { w: ow, h: oh };

    // On-canvas text editing caret must track zoom — commit the edit.
    document.dispatchEvent(new CustomEvent('sc-zoom'));

    if (State.zoomDebounceTimer) clearTimeout(State.zoomDebounceTimer);
    State.zoomDebounceTimer = setTimeout(() => this._settleZoom(), 150);
  },

  /**
   * Realize the backing stores at the current State.zoom. Safe to call when
   * no settle is pending. Used by the zoom debounce and by interactions that
   * require the backing store and State.zoom to be consistent immediately
   * (mask brush strokes), preventing visual jumps while zoomed/scrolled.
   */
  _settleZoom() {
    if (State.zoomDebounceTimer) {
      clearTimeout(State.zoomDebounceTimer);
      State.zoomDebounceTimer = null;
    }
    const zz = State.zoom;
    const w = Math.round(CANVAS_W * zz);
    const h = Math.round(CANVAS_H * zz);
    const oW = Math.round((CANVAS_W + CANVAS_PAD * 2) * zz);
    const oH = Math.round((CANVAS_H + CANVAS_PAD * 2) * zz);
    const dScale = capScale(w, h);
    const oScale = capScale(oW, oH);
    this._displayScale = dScale;
    this._overlayScale = oScale;
    const dw = Math.max(1, Math.round(w * dScale));
    const dh = Math.max(1, Math.round(h * dScale));
    const ow = Math.max(1, Math.round(oW * oScale));
    const oh = Math.max(1, Math.round(oH * oScale));
    if (displayCanvas.width !== dw || displayCanvas.height !== dh ||
        overlayCanvas.width !== ow || overlayCanvas.height !== oh) {
      displayCanvas.width = dw;
      displayCanvas.height = dh;
      overlayCanvas.width = ow;
      overlayCanvas.height = oh;
      this._stats.backingReallocs++;
    }
    for (const layer of State.layers) {
      if (!layer._processedAtZoom) { layer._zoomRefreshNeeded = true; continue; }
      const ratio = zz / layer._processedAtZoom;
      if (ratio > 1.3 || ratio < 0.7) {
        layer._zoomRefreshNeeded = true;
      }
    }
    this._lastFullPaintAt = performance.now();
    this.schedule();
  },

  // Reset the scaled document-coordinate transform on a display-area context
  _beginDocTransform(ctx, scale) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  },

  schedule() {
    if (State.renderPending) return;
    State.renderPending = true;
    // Brush strokes coalesce frames: dabs keep landing in the mask bitmap
    // on every pointermove (cheap), while the mask-composite rebuilds only
    // rendered at MASK_STROKE_FRAME_MS — an intentionally choppier but
    // smooth-feeding preview, so a heavy frame can't starve the input
    // loop that makes masks feel slow.
    const delay = this._brushDepth > 0
      ? Math.max(0, MASK_STROKE_FRAME_MS - (performance.now() - this._lastDrawAt))
      : 0;
    const run = async () => {
      await this.draw();
      State.renderPending = false;
      this._lastDrawAt = performance.now();
    };
    if (delay > 0) setTimeout(() => requestAnimationFrame(run), delay);
    else requestAnimationFrame(run);
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

  /**
   * Whether a layer's screen bounds fall entirely outside the viewport
   * rect (computed once per draw and passed in). Derived purely from
   * geometry — no DOM reads per layer (culling used to re-read
   * canvas-scroll geometry per layer per frame, one forced-layout pass
   * per intersect test).
   */
  _layerCulledByClip(layer, z, clip) {
    const b = this._getLayerScreenBounds(layer, z);
    return b.right < clip.left || b.left > clip.left + clip.width ||
      b.bottom < clip.top || b.top > clip.top + clip.height;
  },

  /**
   * Visible viewport mapped into display-canvas coordinates and clamped to
   * the canvas ({left, top, width, height}), or null when there is nothing
   * meaningful to clip to. A small margin around the slice keeps antialiased
   * slice borders seamless while panning.
   */
  _getViewportClipRect() {
    const scroll = document.getElementById('canvas-scroll');
    if (!scroll) return null;
    const canvasOffsetLeft = displayCanvas.offsetLeft + (displayCanvas.offsetParent?.offsetLeft ?? 0);
    const canvasOffsetTop  = displayCanvas.offsetTop  + (displayCanvas.offsetParent?.offsetTop  ?? 0);
    const x0 = scroll.scrollLeft - canvasOffsetLeft;
    const y0 = scroll.scrollTop  - canvasOffsetTop;
    const x1 = x0 + scroll.clientWidth;
    const y1 = y0 + scroll.clientHeight;
    const MARGIN = 8;
    // The clip rect must live in CSS/z-space like every other drawLayers
    // coordinate; the backing store is scaled by _displayScale, so its px
    // extent is larger in CSS terms than displayCanvas.width suggests.
    const cssW = displayCanvas.width / this._displayScale;
    const cssH = displayCanvas.height / this._displayScale;
    const left = Math.max(0, Math.floor(x0 - MARGIN));
    const top = Math.max(0, Math.floor(y0 - MARGIN));
    const right = Math.min(cssW, Math.ceil(x1 + MARGIN));
    const bottom = Math.min(cssH, Math.ceil(y1 + MARGIN));
    const width = right - left, height = bottom - top;
    if (width <= 0 || height <= 0) return null;
    return { left, top, width, height };
  },

  /**
   * Visible viewport in display-canvas coordinates, UNCLAMPED to the
   * canvas — scroll positions past the document must still cull layers
   * that live inside the canvas (the viewport "overlooks" it there).
   * Read once per draw and passed to per-layer tests so no per-layer
   * forced-layout reads remain; culling used to re-read the scroll
   * container geometry per layer per frame.
   */
  _viewportRect() {
    const scroll = document.getElementById('canvas-scroll');
    if (!scroll) return null;
    const canvasOffsetLeft = displayCanvas.offsetLeft + (displayCanvas.offsetParent?.offsetLeft ?? 0);
    const canvasOffsetTop  = displayCanvas.offsetTop  + (displayCanvas.offsetParent?.offsetTop  ?? 0);
    return {
      left: scroll.scrollLeft - canvasOffsetLeft,
      top: scroll.scrollTop - canvasOffsetTop,
      width: scroll.clientWidth,
      height: scroll.clientHeight,
    };
  },

  /**
   * Screen-space extent of a layer ({left, top, width, height} in canvas
   * coordinates) used as the compositing extent: the layer's rotated
   * bounding box, shrunk to the visible viewport slice when a clip rect is
   * available. Returns null when the slice is empty. Draws without a clip
   * (export, off-screen analysis, merge previews) pass clip = null and get
   * the exact full bounding box — the pre-existing uncullable behavior.
   */
  _layerViewportSlice(layer, z, clip) {
    const b = this._getLayerScreenBounds(layer, z);
    if (!clip) {
      return { left: b.left, top: b.top, width: b.width, height: b.height };
    }
    const left = Math.max(b.left, clip.left);
    const top = Math.max(b.top, clip.top);
    const right = Math.min(b.right, clip.left + clip.width);
    const bottom = Math.min(b.bottom, clip.top + clip.height);
    if (right <= left || bottom <= top) return null;
    return {
      left,
      top,
      width: Math.ceil(right - left) + 1,
      height: Math.ceil(bottom - top) + 1,
    };
  },

  async draw() {
    this._beginDocTransform(dCtx, this._displayScale);
    await this.drawLayers(dCtx, State.layers, this._docSize().w, this._docSize().h, State.zoom);
    if (State.showMargins) this.drawMargins();
    if (State.showGrid) this.drawGrid();
    this.drawOverlay();
  },

  async drawLayers(targetCtx, layers, width, height, zoom, skipCulling = false) {
    // Reset composite mode — ensures white paper fill is correct regardless of prior state
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.clearRect(0, 0, width, height);
    targetCtx.fillStyle = '#fff';
    targetCtx.fillRect(0, 0, width, height);
    // Culling: for on-screen draws only the visible viewport slice needs
    // content (scrolling reschedules a draw, so the rest of the canvas is
    // always repainted as it re-enters view). Clipping the context keeps
    // every full-page blit from being rasterized outside the viewport, and
    // lets masked layers build their intermediate buffers at slice size.
    // Culling reads the scroll viewport ONCE (unclamped to the canvas:
    // scroll positions past the document still overlook canvas content)
    // and per-layer tests avoid any forced-layout reads.
    const clipRect = skipCulling ? null : this._getViewportClipRect();
    const viewRect = skipCulling ? null : this._viewportRect();

    for (const layer of layers) {
      if (!layer.visible) continue;
      if (layer.isMaskFor) continue; // rendered as part of the masked layer below it
      // A text layer being edited on-canvas is represented by its live editor
      // overlay; skip its (stale) rasterization until the edit commits.
      if (layer.id === State.textEditingId) continue;
      if (viewRect && this._layerCulledByClip(layer, zoom, viewRect)) continue;
      if (layer._dirty || layer._zoomRefreshNeeded) await ImageProcessor.processLayer(layer);
      if (!layer._processedCanvas) continue;
      targetCtx.save();
      if (clipRect) {
        targetCtx.beginPath();
        targetCtx.rect(clipRect.left, clipRect.top, clipRect.width, clipRect.height);
        targetCtx.clip();
      }
      if (layer.imageMaskIds?.length) {
        await this._compositeLayerWithImageMask(targetCtx, layer, zoom, layers, clipRect);
      } else {
        this._applyTransform(targetCtx, layer, zoom);
        this._compositeLayer(targetCtx, layer, zoom, clipRect);
      }
      targetCtx.restore();
    }
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

  /**
   * Painted-mask composite of a layer (processed pixels ∩ mask alpha),
   * cached on the layer in the `layer._maskComposite` slot. Two cache
   * shapes share that slot:
   *   - Slice mode (while a brush stroke is active and a viewport clip is
   *     available): the composite is rebuilt *per frame* whenever the mask
   *     revision moved (every dab bumps it), so it is built at viewport-
   *     *slice* size with the layer transform baked in. Rebuilding the
   *     full processed bitmap megapixel-class (up to 4K×4K) per brush
   *     frame per masked layer is what made brushes unresponsive on
   *     projects with many diffed masks. Reused while the slice origin
   *     and the zoom fidelity band hold (same band as the image-mask
   *     composite).
   *   - Full mode: the previous zoom-invariant full-bitmap composite
   *     (unchanged), used outside brush strokes and for export / off-screen
   *     draws; a full-mode cache survives zoom and pan as before.
   * Both carry source references (processed canvas + mask canvas + mask
   * revision) that make them self-invalidating.
   */
  _paintedCompFor(layer, z, rect = null) {
    const sliceMode = !!(rect && this._brushDepth > 0);
    const rev = layer._maskRev || 0;
    const cache = layer._maskComposite;
    if (
      cache &&
      cache._isSlice === sliceMode &&
      cache._srcRef === layer._processedCanvas &&
      cache._srcMask === layer._maskCanvas &&
      cache._srcMaskRev === rev
    ) {
      if (!sliceMode) return cache; // full mode is zoom-invariant
      const ratio = z / cache._zoomRef;
      if (
        cache._boundsLeft === rect.left && cache._boundsTop === rect.top &&
        !(ratio > 1.3 || ratio < 0.7)
      ) {
        return cache;
      }
    }
    const comp = sliceMode
      ? this._buildSliceMaskComposite(layer, z, rect)
      : this._buildPaintedMaskComposite(layer);
    layer._maskComposite = comp;
    this._stats.paintedMaskBuilds++;
    return comp;
  },

  /**
   * Slice-mode painted-mask composite: covers exactly the z-space rect
   * (origin at rect.left/top) the image-mask/painted compositing will
   * blit it into, so callers re-use it with drawImage(comp, rect coords)
   * and no further scaling.
   */
  _buildSliceMaskComposite(layer, z, rect) {
    const cache = new OffscreenCanvas(Math.ceil(rect.width), Math.ceil(rect.height));
    const cCtx = cache.getContext('2d');
    cCtx.imageSmoothingQuality = layer.isText ? 'high' : 'medium';
    cCtx.translate(
      ((layer.x + layer.width / 2) * z) - rect.left,
      ((layer.y + layer.height / 2) * z) - rect.top
    );
    cCtx.rotate(layer.rotation * Math.PI / 180);
    cCtx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
    cCtx.translate(-layer.width / 2 * z, -layer.height / 2 * z);
    cCtx.drawImage(layer._processedCanvas, 0, 0, layer.width * z, layer.height * z);
    cCtx.globalCompositeOperation = 'destination-in';
    cCtx.drawImage(layer._maskCanvas, 0, 0, layer.width * z, layer.height * z);
    // Source references make the cache self-invalidating; _isSlice marks
    // the shape so it is never confused with the full-mode cache.
    cache._srcRef = layer._processedCanvas;
    cache._srcMask = layer._maskCanvas;
    cache._srcMaskRev = layer._maskRev || 0;
    cache._zoomRef = z;
    cache._boundsLeft = rect.left;
    cache._boundsTop = rect.top;
    cache._isSlice = true;
    return cache;
  },

  /**
   * Full-mode painted-mask composite: built at the layer's *processed*
   * resolution and zoom-invariant, so every zoom-level redraw is a single
   * scaled drawImage. Used outside brush strokes and for export /
   * off-screen draws.
   */
  _buildPaintedMaskComposite(layer) {
    const sw = layer._processedCanvas.width;
    const sh = layer._processedCanvas.height;
    const cache = new OffscreenCanvas(sw, sh);
    const cCtx = cache.getContext('2d');
    cCtx.imageSmoothingQuality = layer.isText ? 'high' : 'medium';
    cCtx.drawImage(layer._processedCanvas, 0, 0);
    cCtx.globalCompositeOperation = 'destination-in';
    cCtx.drawImage(layer._maskCanvas, 0, 0, sw, sh);
    // Source references make the cache self-invalidating; _isSlice marks
    // the shape so it is never confused with the slice-mode cache.
    cache._srcRef = layer._processedCanvas;
    cache._srcMask = layer._maskCanvas;
    cache._srcMaskRev = layer._maskRev || 0;
    cache._isSlice = false;
    return cache;
  },

  _compositeLayer(ctx, layer, z, clip = null) {
    const dw = layer.width * z, dh = layer.height * z;
    ctx.globalCompositeOperation = 'multiply';
    const quality = ctx.imageSmoothingQuality;
    if (layer.isText) ctx.imageSmoothingQuality = 'high';
    if (!layer._maskCanvas) {
      // The caller's viewport clip (when set) makes the browser rasterize
      // only the visible slice of this full-layer blit.
      ctx.drawImage(layer._processedCanvas, 0, 0, dw, dh);
      ctx.imageSmoothingQuality = quality;
      return;
    }
    let rect = null;
    if (clip) {
      // Painted-mask compositing here draws through an intermediate buffer;
      // size it to the visible slice instead of the whole layer. Combined
      // with the zoom-invariant composite above, painting keeps buffer
      // rebuild AND per-frame rasterization bounded to the viewport.
      rect = this._layerViewportSlice(layer, z, clip);
      if (!rect) { ctx.imageSmoothingQuality = quality; return; }
    }
    // Dispatch to the right cache shape: slice-mode (per-frame brush
    // rebuilds, direct blit below) or the zoom-invariant full mode.
    const comp = this._paintedCompFor(layer, z, rect);
    if (comp._isSlice) {
      // Slice-mode composite already has the layer transform baked for
      // this slice: blit it straight into place in canvas coordinates.
      // rect is in CSS/z-space, so the blit must re-apply the document
      // scale the caller drew under (drawLayers wraps every composite
      // in save/restore).
      ctx.save();
      ctx.setTransform(this._displayScale, 0, 0, this._displayScale, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.imageSmoothingQuality = layer.isText ? 'high' : quality;
      ctx.drawImage(comp, rect.left, rect.top);
      ctx.restore();
    } else {
      ctx.drawImage(comp, 0, 0, dw, dh);
    }
    ctx.imageSmoothingQuality = quality;
  },

  async _compositeLayerWithImageMask(ctx, layer, z, layerSet = State.layers, clip = null) {
    const maskLayers = (layer.imageMaskIds || [])
      .map(id => layerSet.find(l => l.id === id))
      .filter(ml => ml);

    if (!maskLayers.length) {
      // No valid mask layers — fall back to normal rendering
      this._applyTransform(ctx, layer, z);
      this._compositeLayer(ctx, layer, z, clip);
      return;
    }

    // Compositing extent: the layer's rotated bbox, shrunk to the visible
    // viewport slice when a clip rect is available — the old full-bbox
    // buffers (two per mask per frame, rasterized and read back fully) were
    // a major share of the per-mask-paint cost at high zoom.
    const b = this._layerViewportSlice(layer, z, clip);
    if (!b) return;
    const cw = b.width, ch = b.height;

    // The composition below (base layer + alpha-inverted masks) is
    // zoom-invariant: recompute it only when a source bitmap changed or when
    // the cached zoom is far enough away to lose visible fidelity (>1.3× or
    // <0.7×, matching the processed-layer reprocess threshold). The per-frame
    // cost then falls to a single scaled drawImage, which keeps deep-zoom
    // redraws cheap instead of allocating buffers and running per-pixel alpha
    // inversion loops on every frame.
    const currentRefs = () => [
      layer._processedCanvas ?? null, layer._maskCanvas ?? null, layer._maskRev || 0,
      ...maskLayers.flatMap(ml => [
        ml._processedCanvas ?? null, ml._maskCanvas ?? null, ml._maskRev || 0,
      ]),
    ];
    let cache = layer._imageMaskComposite;
    // The cache covers the compositing slice it was built for: its origin
    // (which moves on scroll/pan) must match, otherwise the stale buffer
    // would be blitted at the wrong place. Zoom drift within the band only
    // rescales the same content, which is the fidelity band's job.
    if (
      cache && sameRefs(cache._srcRefs, currentRefs()) &&
      cache._boundsLeft === b.left && cache._boundsTop === b.top
    ) {
      const ratio = z / cache._zoomRef;
      if (!(ratio > 1.3 || ratio < 0.7)) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(cache, b.left, b.top, cw, ch);
        return;
      }
      // zoom moved beyond the fidelity band — recompute geometry below
    } else {
      cache = null;
    }

    // Make sure every mask layer has a processed bitmap before building.
    for (const maskLayer of maskLayers) {
      if (maskLayer._dirty) await ImageProcessor.processLayer(maskLayer);
    }

    // Buffer A: render base layer at tight bounds (source-over on transparent),
    // at the current zoom's fidelity level
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
    // Slice-size matching the bounds computed above (origin -b.left/top):
    // every drawImage below lands in this same coordinate space.
    if (layer._maskCanvas) {
      // Painted-mask composite is cached on the source bitmaps; during
      // brush strokes it is rebuilt per frame at slice size, outside
      // strokes it is the zoom-invariant full composite drawn scaled.
      const comp = this._paintedCompFor(layer, z, b);
      if (comp._isSlice) {
        lCtx.drawImage(comp, 0, 0);
      } else {
        lCtx.drawImage(comp, 0, 0, dw, dh);
      }
    } else {
      lCtx.drawImage(layer._processedCanvas, 0, 0, dw, dh);
    }
    lCtx.restore();

    // Apply each mask sequentially — each further clips the base layer
    for (const maskLayer of maskLayers) {
      if (!maskLayer._processedCanvas) continue;
      if (maskLayer._dirty) await ImageProcessor.processLayer(maskLayer);
      if (!maskLayer._processedCanvas) continue;

      // Inverted-alpha mask slice (show-base where no ink), cached
      // per mask layer during brush strokes: only masks whose bitmap
      // actually changed are rebuilt each frame, instead of re-reading
      // and inverting every mask's pixels per frame.
      lCtx.globalCompositeOperation = 'destination-in';
      lCtx.drawImage(this._maskAlphaBufFor(maskLayer, z, b), 0, 0);
    }

    // Composite the masked result onto the main canvas using multiply.
    // Source references are recorded AFTER processing so the stored key
    // reflects the canvases the cache was actually built from.
    cache = layerBuf;
    cache._srcRefs = currentRefs();
    cache._zoomRef = z;
    cache._boundsLeft = b.left;
    cache._boundsTop = b.top;
    layer._imageMaskComposite = cache;
    this._stats.imageMaskBuilds++;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(cache, b.left, b.top);
  },

  /**
   * Buffer for one image-mask layer, in the z-space rect `rect` (origin at
   * rect.left/top): the mask layer's ink, restricted to its own painted
   * mask when present, with the ALPHA INVERTED so it masks the base via
   * destination-in (ink cuts the base away, no ink shows it).
   *
   * During brush strokes the result is cached per mask layer, keyed on its
   * source bitmaps + mask revision + slice origin + zoom band. Together
   * with reusing painted-mask composites this reduces per-stroke-frame
   * mask work from "every mask of the group, with per-pixel readback" to
   * "only the mask being painted", which used to make the brush stop
   * responding on projects with many diffed masks.
   *
   * The inversion is a canvas composite rather than a JS loop: a fully
   * opaque source fill through 'xor' (Porter-Duff XOR: α = αs·(1−αd) with
   * αs = 1) leaves α = 1 − αd — exactly what the old
   * `d[i+3] = 255 - d[i+3]` loop did, without the megapixel
   * getImageData/putImageData round trips. Only the alpha channel is
   * consumed downstream (destination-in), so the fill color is irrelevant.
   */
  _maskAlphaBufFor(maskLayer, z, rect) {
    const cacheable = !!(rect && this._brushDepth > 0);
    const rev = maskLayer._maskRev || 0;
    const cache = cacheable ? maskLayer._maskAlphaSlice : null;
    if (
      cache &&
      cache._srcRef === maskLayer._processedCanvas &&
      cache._srcMask === maskLayer._maskCanvas &&
      cache._srcMaskRev === rev
    ) {
      const ratio = z / cache._zoomRef;
      if (
        cache._boundsLeft === rect.left && cache._boundsTop === rect.top &&
        !(ratio > 1.3 || ratio < 0.7)
      ) {
        return cache.buf;
      }
    }

    // Render the mask layer, restricted to its painted-visible area, then
    // invert the alpha through an XOR fill (see above).
    const buf = new OffscreenCanvas(Math.ceil(rect.width), Math.ceil(rect.height));
    const mCtx = buf.getContext('2d');
    mCtx.save();
    mCtx.translate(
      ((maskLayer.x + maskLayer.width / 2) * z) - rect.left,
      ((maskLayer.y + maskLayer.height / 2) * z) - rect.top
    );
    mCtx.rotate(maskLayer.rotation * Math.PI / 180);
    mCtx.scale(maskLayer.flipH ? -1 : 1, maskLayer.flipV ? -1 : 1);
    mCtx.translate(-maskLayer.width / 2 * z, -maskLayer.height / 2 * z);
    mCtx.drawImage(maskLayer._processedCanvas, 0, 0, maskLayer.width * z, maskLayer.height * z);
    // If the mask layer has its own painted mask (e.g. a linked difference
    // layer), restrict the mask effect to the painted-visible area.
    if (maskLayer._maskCanvas) {
      mCtx.globalCompositeOperation = 'destination-in';
      mCtx.drawImage(maskLayer._maskCanvas, 0, 0, maskLayer.width * z, maskLayer.height * z);
    }
    mCtx.restore();
    mCtx.globalCompositeOperation = 'xor';
    mCtx.fillStyle = '#fff';
    mCtx.fillRect(0, 0, buf.width, buf.height);

    if (cacheable) {
      maskLayer._maskAlphaSlice = {
        buf,
        _srcRef: maskLayer._processedCanvas,
        _srcMask: maskLayer._maskCanvas,
        _srcMaskRev: rev,
        _zoomRef: z,
        _boundsLeft: rect.left,
        _boundsTop: rect.top,
      };
    }
    return buf;
  },

  // Backing stores may be scaled below the CSS size at high zoom; these
  // helpers give drawing code the CSS-pixel document dimensions so geometry
  // math stays in document coordinates regardless of the backing scale.
  _displayDocW() { return displayCanvas.width / this._displayScale; },
  _displayDocH() { return displayCanvas.height / this._displayScale; },

  drawMargins() {
    const z = State.zoom;
    dCtx.save();
    dCtx.strokeStyle = '#87CEEB';
    dCtx.lineWidth = 1;
    dCtx.beginPath();
    if (State.spreadView && State.spreadSplitX > 0) {
      const split = State.spreadSplitX * z;
      // Center split line
      dCtx.moveTo(split, 0);
      dCtx.lineTo(split, this._displayDocH());
      // Left page margins
      const m = State.margins;
      const lLeft = m.left * z;
      const lTop = m.top * z;
      const lRight = split - m.right * z;
      const lBottom = this._displayDocH() - m.bottom * z;
      dCtx.rect(lLeft, lTop, lRight - lLeft, lBottom - lTop);
      // Right page margins
      const rLeft = split + m.left * z;
      const rTop = m.top * z;
      const rRight = this._displayDocW() - m.right * z;
      const rBottom = this._displayDocH() - m.bottom * z;
      dCtx.rect(rLeft, rTop, rRight - rLeft, rBottom - rTop);
    } else {
      const m = State.margins;
      const x = m.left * z;
      const y = m.top * z;
      const w = this._displayDocW() - (m.left + m.right) * z;
      const h = this._displayDocH() - (m.top + m.bottom) * z;
      dCtx.rect(x, y, w, h);
    }
    dCtx.stroke();
    dCtx.restore();
  },

  drawGrid() {
    const z = State.zoom;
    const size = State.grid.size * z;
    if (size <= 0) return;
    const W = this._displayDocW(), H = this._displayDocH();
    dCtx.save();
    dCtx.strokeStyle = 'rgba(135, 206, 235, 0.35)';
    dCtx.lineWidth = 1;
    dCtx.beginPath();
    if (State.grid.type === 'isometric') {
      this._drawIsometricGrid(size, W, H);
    } else {
      for (let x = 0; x <= W; x += size) {
        dCtx.moveTo(Math.round(x) + 0.5, 0);
        dCtx.lineTo(Math.round(x) + 0.5, H);
      }
      for (let y = 0; y <= H; y += size) {
        dCtx.moveTo(0, Math.round(y) + 0.5);
        dCtx.lineTo(W, Math.round(y) + 0.5);
      }
    }
    dCtx.stroke();
    dCtx.restore();
  },

  _drawIsometricGrid(size, W, H) {
    const diag = Math.sqrt(W * W + H * H) + size;
    const toRad = a => a * Math.PI / 180;
    const families = [0, 60, 120];
    for (const angle of families) {
      const theta = toRad(angle);
      const dx = Math.cos(theta), dy = Math.sin(theta);
      const nx = -dy, ny = dx; // unit normal
      // Perpendicular distance range that covers the rectangle
      const d0 = 0 * nx + 0 * ny;
      const d1 = W * nx + 0 * ny;
      const d2 = 0 * nx + H * ny;
      const d3 = W * nx + H * ny;
      const minD = Math.min(d0, d1, d2, d3);
      const maxD = Math.max(d0, d1, d2, d3);
      const kMin = Math.floor(minD / size) - 1;
      const kMax = Math.ceil(maxD / size) + 1;
      for (let k = kMin; k <= kMax; k++) {
        const c = k * size;
        const cx = c * nx, cy = c * ny;
        dCtx.moveTo(cx - dx * diag, cy - dy * diag);
        dCtx.lineTo(cx + dx * diag, cy + dy * diag);
      }
    }
  },

  // Reset a context bound to the interaction overlay to document
  // coordinates. The overlay backing store can be capped at high zoom, so
  // callers (including preview drawing in events.js) must re-apply this
  // transform rather than assuming a 1:1 identity mapping.
  resetOverlayTransform(ctx) {
    ctx.setTransform(this._overlayScale, 0, 0, this._overlayScale, 0, 0);
    const ow = this._overlaySize?.w ?? overlayCanvas.width;
    const oh = this._overlaySize?.h ?? overlayCanvas.height;
    ctx.clearRect(0, 0, ow, oh);
  },

  drawOverlay() {
    this.resetOverlayTransform(oCtx);
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

  hitTestHandle(mx, my, layer, tol = 8) {
    for (const h of this.getHandles(layer, State.zoom)) {
      if (Math.abs(mx - h.x) < tol && Math.abs(my - h.y) < tol) return h;
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
