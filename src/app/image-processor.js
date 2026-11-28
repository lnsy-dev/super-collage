/* ═══════════════════════════════════════════════════════════════════
   Image Processing Pipeline
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { hexToRgb } from '../utils/color.js';
import { isTwoToneShape, renderShapeLayerBitmap } from './shape-bitmap.js';
import { TypeSetRenderer } from 'type-set';
import { sepAngleFor, ditherMethodIndex, toImageData, sepPlateToCanvas } from './separation-methods.js';
import { clampDims } from './canvas-limits.js';
import {
  fitTarget,
  runPixelPipeline,
  shapePartFromBitmap,
  composeProcessedCanvas,
  halftoneCell as pipelineHalftoneCell,
  scaledPatternSize as pipelineScaledPatternSize,
  renderRatio as pipelineRenderRatio,
  toGrayscale as pixelToGrayscale,
  applyBrightness as pixelApplyBrightness,
  applyContrast as pixelApplyContrast,
  applyInvert as pixelApplyInvert,
  posterize as pixelPosterize,
  applyHalftone as pixelApplyHalftone,
  bayerDither as pixelBayerDither,
  magazineDots as pixelMagazineDots,
  grungeDots as pixelGrungeDots,
  colorize as pixelColorize,
  generateGradientCanvas, generateStretchedGradientCanvas, generatePatternCanvas,
  buildGradientWeightMap, buildPatternWeightMap,
} from './pixel-pipeline.js';
import { processWorkerClient } from './process-worker-client.js';

// Re-exported for existing import sites (export-engine.js weight maps,
// gradient/pattern generators).
export {
  generateGradientCanvas, generateStretchedGradientCanvas, generatePatternCanvas,
  buildGradientWeightMap, buildPatternWeightMap,
};


/* ─── IMAGE PROCESSING PIPELINE ─────────────────────────────────── */
export const ImageProcessor = {

  _processCallCount: 0,

  getDisplayResolution(layer) {
    const nw = layer.naturalWidth, nh = layer.naturalHeight;
    const displayW = layer.width * State.zoom;
    const displayH = layer.height * State.zoom;
    const dpr = window.devicePixelRatio || 1;
    const quality = 1.5;
    let targetW = Math.min(nw, Math.max(64, Math.ceil(displayW * dpr * quality)));
    let targetH = Math.round(nh * (targetW / nw));
    const altH = Math.min(nh, Math.max(64, Math.ceil(displayH * dpr * quality)));
    const altW = Math.round(nw * (altH / nh));
    if (altW * altH < targetW * targetH) {
      targetW = altW;
      targetH = altH;
    }
    return { w: targetW, h: targetH };
  },

  /**
   * Process a layer, serialized per layer. Concurrent requests for the
   * same layer (a draw frame racing an export/merge call) queue behind
   * the in-flight one and then re-run against current state — the last
   * caller wins and the layer's cache flags always end consistent. This
   * replaces a latest-wins token scheme whose discarded losers could
   * leave a layer `_dirty` with no follow-up frame scheduled (masks
   * would then never process: their only processing site is the masked
   * base's composite, which the cache early-return skips once built).
   */
  async processLayer(layer, opts = {}) {
    while (layer._processing) {
      try {
        await layer._processing;
      } catch (_e) {
        // The prior attempt failed; exit the loop and re-run for ourself.
      }
    }
    const job = this._processLayerUnlocked(layer, opts);
    layer._processing = job;
    try {
      return await job;
    } finally {
      if (layer._processing === job) layer._processing = null;
    }
  },

  async _processLayerUnlocked(layer, { forExport = false, colorOverride = null, pixelWidth = 0, pixelHeight = 0, patternScale = 0 } = {}) {
    if (layer.isText) {
      return await this.processTextLayer(layer, forExport);
    }
    if (layer.isColorSeparation) {
      return this.processColorSeparation(layer, forExport, pixelWidth, pixelHeight, patternScale);
    }
    if (!layer._originalCanvas && !(layer.isSvg && layer._svgImage)) return null;
    this._processCallCount++;
    const nw = layer.naturalWidth, nh = layer.naturalHeight;
    // The job runs asynchronously: the layer's knobs (or its source
    // bitmap) can change while it is in flight. A stale result must not
    // be applied — worse, it must not clear a _dirty flag set after the
    // job started (a recolor landing mid-job would otherwise be silenced
    // by the import-time black build and the layer would render stale
    // ink forever). So after each job, recompute the request and compare:
    // on any drift, re-run with fresh state (bounded; the final attempt
    // applies regardless, and _zoomRefreshNeeded/band logic re-syncs later).
    for (let attempt = 0; ; attempt++) {
      let targetW, targetH;
      if (layer.isSvg) {
        if (forExport) {
          targetW = layer.width;
          targetH = layer.height;
        } else {
          const displayW = layer.width * State.zoom;
          const displayH = layer.height * State.zoom;
          const dpr = window.devicePixelRatio || 1;
          const quality = 1.5;
          let tw = Math.max(64, Math.ceil(displayW * dpr * quality));
          let th = Math.round(layer.height * (tw / layer.width));
          const altTh = Math.max(64, Math.ceil(displayH * dpr * quality));
          const altTw = Math.round(layer.width * (altTh / layer.height));
          if (altTw * altTh < tw * th) {
            tw = altTw;
            th = altTh;
          }
          targetW = tw;
          targetH = th;
        }
      } else if (forExport) {
        targetW = nw;
        targetH = nh;
      } else {
        const res = this.getDisplayResolution(layer);
        targetW = res.w;
        targetH = res.h;
      }
      // Caller-requested composite resolution: merging renders patterned
      // content (dither cells, screens, dots) at the exact size it will be
      // composited at, so the pattern is rasterized at final scale and then
      // blitted 1:1 instead of being resampled after the fact.
      if (pixelWidth > 0 && pixelHeight > 0) {
        targetW = pixelWidth;
        targetH = pixelHeight;
      }
      // Export/display targets derive from geometry that can outgrow the
      // browser canvas cap (resized text/SVG layers); allocate live only.
      ({ w: targetW, h: targetH } = fitTarget(targetW, targetH));
      // Pattern knobs (dither cells, dot grids, screens) are anchored to the
      // layer's natural-resolution pixels; a render at a different bitmap
      // resolution scales them by targetW/naturalWidth so the pattern keeps
      // its on-page size. The merge composite passes its own ratio via
      // patternScale; everything else derives it from the resolved target.
      const renderRatio = this._renderRatio(patternScale, nw, targetW);
      // A zoom-band refresh (_zoomRefreshNeeded, set when the zoom settled
      // outside a layer's processed fidelity band) is NOT a content change:
      // when the processed resolution lands identical across the crossing
      // (display targets stop growing at the natural-size cap), reprocessing
      // would only allocate a fresh canvas holding identical pixels — churn
      // that also invalidates every composite cache keyed on this bitmap.
      // Real content changes ride the regular _dirty flag and reprocess.
      if (!forExport && !layer.isSvg && layer._zoomRefreshNeeded && !layer._dirty &&
          layer._processedCanvas &&
          layer._processedCanvas.width === targetW &&
          layer._processedCanvas.height === targetH) {
        layer._processedAtZoom = State.zoom;
        layer._zoomRefreshNeeded = false;
        return layer._processedCanvas;
      }
      const params = this._pipelineParams(layer, targetW, targetH, colorOverride, renderRatio);
      const srcAtDispatch = layer.isSvg ? layer._svgImage : layer._originalCanvas;
      let parts = await this._prepareSourceParts(layer, targetW, targetH);
      if (!parts) return null;
      let out = null;
      if (processWorkerClient.available !== false) {
        try {
          out = await processWorkerClient.process(parts, params);
        } catch (err) {
          console.warn('[process-worker] job failed, falling back inline:', err && err.message || err);
          out = null; // worker unavailable/wedged — fall back inline below
        }
      }
      if (!out) {
        // Inline fallback: identical code, main thread. Any prior worker
        // attempt transferred (detached) the bitmaps, so always re-prepare
        // fresh sources for the inline run.
        parts = await this._prepareSourceParts(layer, targetW, targetH);
        if (!parts) return null;
        out = composeProcessedCanvas(parts, params);
      }
      // Superseded check: recompute the request the job WOULD be given now
      // and compare with what it was given. Identical params + an unchanged
      // source bitmap mean this result is current and safe to apply (and to
      // clear _dirty). Anything else re-runs the loop with fresh state.
      const stable = attempt >= 2 || (
        layer._originalCanvas !== null &&
        (layer.isSvg ? layer._svgImage : layer._originalCanvas) === srcAtDispatch &&
        JSON.stringify(this._pipelineParams(layer, targetW, targetH, colorOverride,
          this._renderRatio(patternScale, nw, targetW))) === JSON.stringify(params));
      if (!stable) {
        for (const p of parts) {
          try { p.bitmap.close(); } catch (_e) { /* already detached */ }
        }
        continue;
      }
      if (typeof out.getContext !== 'function') {
        // The worker result crossed the boundary as an ImageBitmap
        // (Chromium refuses to transfer context-bearing OffscreenCanvases).
        // Normalize back into an OffscreenCanvas so every consumer of
        // _processedCanvas can keep treating it as a canvas (getContext,
        // convertToBlob) exactly as before the worker existed.
        const asCanvas = new OffscreenCanvas(out.width, out.height);
        asCanvas.getContext('2d').drawImage(out, 0, 0);
        out.close();
        out = asCanvas;
      }
      if (forExport) {
        return out;
      }
      layer._processedCanvas = out;
      layer._processedAtZoom = State.zoom;
      layer._dirty = false;
      layer._zoomRefreshNeeded = false;
      return out;
    }
  },

  /**
   * Plain, structured-cloneable params for the pixel pipeline: the
   * layer record's processing knobs plus the computed target fields.
   * `p.color` resolves the export color override up front; `p.colorOverride`
   * keeps the chain's "override always colorizes solid" behavior.
   */
  _pipelineParams(layer, targetW, targetH, colorOverride, renderRatio) {
    const p = layer.toRecord();
    p.targetW = targetW;
    p.targetH = targetH;
    p.renderRatio = renderRatio;
    p.colorOverride = !!colorOverride;
    if (colorOverride) p.color = colorOverride;
    p.mode = isTwoToneShape(layer) ? 'twoToneShape' : 'generic';
    return p;
  },

  /**
   * Source bitmaps for the pipeline, one per ink channel:
   *   - two-tone shapes: freshly rendered fill-body and stroke-ring
   *     bitmaps (renderShapeLayerBitmap), matching processShapePart;
   *   - SVG: the vector image white-based onto a target-sized clone (the
   *     worker cannot rasterize the live <img> element);
   *   - everything else: the layer's _originalCanvas.
   * Returned bitmaps are fresh ImageBitmaps the caller may transfer.
   */
  async _prepareSourceParts(layer, targetW, targetH) {
    const parts = [];
    if (isTwoToneShape(layer)) {
      const fill = renderShapeLayerBitmap(layer, 'fill');
      const stroke = renderShapeLayerBitmap(layer, 'stroke');
      if (!fill || !stroke) return null;
      parts.push({ bitmap: await createImageBitmap(fill), color: layer.shapeFillColor });
      parts.push({ bitmap: await createImageBitmap(stroke), color: layer.shapeStrokeColor });
    } else if (layer.isSvg && layer._svgImage) {
      const temp = new OffscreenCanvas(targetW, targetH);
      const tCtx = temp.getContext('2d', { willReadFrequently: true });
      tCtx.fillStyle = 'white';
      tCtx.fillRect(0, 0, targetW, targetH);
      tCtx.drawImage(layer._svgImage, 0, 0, targetW, targetH);
      parts.push({ bitmap: await createImageBitmap(temp), color: layer.color });
    } else {
      if (!layer._originalCanvas) return null;
      parts.push({ bitmap: await createImageBitmap(layer._originalCanvas), color: layer.color });
    }
    return parts;
  },

  /**
   * Render one channel of a shape layer through the standard solid-ink render
   * chain and return a transparent-background RGBA canvas in that channel's
   * riso ink. Shared by screen rendering (processLayer) and plate export so
   * both use identical output by construction.
   */
  processShapePart(layer, part, targetW, targetH, patternScale = 1) {
    const src = renderShapeLayerBitmap(layer, part);
    if (!src) return null;
    const p = this._pipelineParams(layer, targetW, targetH, null,
      this._renderRatio(patternScale, layer.naturalWidth, targetW));
    return shapePartFromBitmap(src, part === 'fill' ? layer.shapeFillColor : layer.shapeStrokeColor, p);
  },

  toGrayscale(px) {
    return pixelToGrayscale(px);
  },

  applyBrightness(px, brightness) {
    return pixelApplyBrightness(px, brightness);
  },

  applyContrast(px, contrast) {
    return pixelApplyContrast(px, contrast);
  },

  applyInvert(px) {
    return pixelApplyInvert(px);
  },

  posterize(px, levels) {
    return pixelPosterize(px, levels);
  },

  applyHalftone(px, w, h, type, size, angle) {
    return pixelApplyHalftone(px, w, h, type, size, angle);
  },

  bayerDither(px, w, h, cellSize) {
    return pixelBayerDither(px, w, h, cellSize);
  },

  magazineDots(px, w, h, cellSize, angleDeg) {
    return pixelMagazineDots(px, w, h, cellSize, angleDeg);
  },

  grungeDots(px, w, h, cellSize, angleDeg) {
    return pixelGrungeDots(px, w, h, cellSize, angleDeg);
  },

  colorize(px, hex, layer) {
    return pixelColorize(px, hex, layer);
  },

  async processTextLayer(layer, forExport) {
    // Supersample text for display so zoomed-out previews stay sharp.
    // Export renders at 1x (full canvas coords); display renders at 2x for sharpness.
    const layoutW = layer.naturalWidth;
    const layoutH = layer.naturalHeight;
    const renderScale = forExport ? 1 : 2;
    // A text box resized past the browser's canvas envelope used to
    // allocate dead 0×0 canvases here (their readbacks threw the
    // resize-then-flatten crash). Clamp the target into the allocatable
    // envelope and shrink the supersample scale to match, keeping the
    // text layout in layout units.
    const fit = clampDims(
      Math.max(1, Math.round(layoutW * renderScale)),
      Math.max(1, Math.round(layoutH * renderScale)),
    );
    const shrink = Math.min(
      1,
      fit.w / Math.max(1, Math.round(layoutW * renderScale)),
      fit.h / Math.max(1, Math.round(layoutH * renderScale)),
    );
    const targetW = Math.max(1, Math.round(layoutW * renderScale * shrink));
    const targetH = Math.max(1, Math.round(layoutH * renderScale * shrink));
    const drawScale = renderScale * shrink;
    // Pattern knobs are anchored to natural-resolution pixels; the display
    // path renders at 2x and export at 1x, so scale the knob with the
    // render ratio to keep the pattern's on-page size consistent.
    const renderRatio = this._renderRatio(0, layer.naturalWidth, targetW);

    // Use separate base-render caches for display (2x) and export (1x) to prevent invalidation.
    const cacheKey = forExport ? '_exportOriginalCanvas' : '_originalCanvas';

    if (!layer[cacheKey] ||
        layer[cacheKey].width !== targetW ||
        layer[cacheKey].height !== targetH) {
      // The npm type-set shapes italic runs from per-char styling only,
      // so a layer-wide italic is expressed as a per-char set.
      const perCharItalic = layer.textFontStyle === 'italic'
        ? new Set(layer.text.split('').map((_c, i) => i))
        : undefined;
      const renderer = new TypeSetRenderer({
        fontBase: './vendor/type-set/fonts/',
        fontFamily: layer.textFontFamily,
        fontSize: layer.textFontSize,
        fontWeight: layer.textFontWeight,
        fontStyle: layer.textFontStyle,
        perCharItalic,
        letterSpacing: layer.textLetterSpacing,
        lineHeight: layer.textLineHeight,
        textAlign: layer.textAlign,
        text: layer.text,
        color: '#000000',
        useLigatures: true,
        useKerning: true,
        useHyphenation: false,
      });
      const canvas = new OffscreenCanvas(targetW, targetH);
      await renderer.renderToCanvas(canvas, { width: layoutW, height: layoutH, clear: true, dpr: drawScale });
      const tCtx = canvas.getContext('2d');
      tCtx.globalCompositeOperation = 'destination-over';
      tCtx.fillStyle = 'white';
      tCtx.fillRect(0, 0, canvas.width, canvas.height);
      tCtx.globalCompositeOperation = 'source-over';
      layer[cacheKey] = canvas;
    }

    // ── FAST PATH ────────────────────────────────────────────────
    // Plain black text with no brightness/contrast/invert/halftone needs
    // no colorize/halftone math. Just one tight pass converting the
    // white background to transparency (alpha = 255 - luminance),
    // matching the full pipeline's output at a fraction of the cost.
    const plainInk = (layer.color === '#010101' || layer.color === '#000000')
      && layer.colorMode === 'solid'
      && !layer.brightness && !layer.contrast && !layer.invert
      && layer.halftoneType === 'none';
    if (plainInk) {
      const out = new OffscreenCanvas(targetW, targetH);
      const oCtx = out.getContext('2d', { willReadFrequently: true });
      oCtx.drawImage(layer[cacheKey], 0, 0, targetW, targetH);
      const px = oCtx.getImageData(0, 0, targetW, targetH);
      const d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = 255 - d[i]; // white bg → transparent, ink → opaque
      }
      oCtx.putImageData(px, 0, 0);
      if (forExport) return out;
      layer._processedCanvas = out;
      layer._processedAtZoom = State.zoom;
      layer._dirty = false;
      layer._zoomRefreshNeeded = false;
      return out;
    }

    const work = new OffscreenCanvas(targetW, targetH);
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(layer[cacheKey], 0, 0, targetW, targetH);

    let px = ctx.getImageData(0, 0, targetW, targetH);
    px = this.toGrayscale(px);
    px = this.applyBrightness(px, layer.brightness);
    px = this.applyContrast(px, layer.contrast);
    if (layer.invert) px = this.applyInvert(px);

    if (layer.halftoneType === 'grayscale') {
      const d = px.data;
      const { r: cr, g: cg, b: cb } = hexToRgb(layer.color);
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = Math.round(255 - gray);
      }
    } else {
      if (layer.halftoneType !== 'none') {
        px = this.posterize(px, 6);
        px = this.applyHalftone(px, targetW, targetH, layer.halftoneType,
          this._halftoneCell(layer, renderRatio, targetW), layer.halftoneAngle);
      }
      px = this.colorize(px, layer.color, layer);
    }

    ctx.putImageData(px, 0, 0);

    if (forExport) return work;
    layer._processedCanvas = work;
    layer._processedAtZoom = State.zoom;
    layer._dirty = false;
    layer._zoomRefreshNeeded = false;
    return work;
  },

  // Per-color screen angles to minimize moiré when multiple plates overlap
  _separationAngles: {
    '#010101': 45, '#f65058': 75, '#ff7477': 15,
    '#ffe800': 90, '#ff48b0': 105, '#5ec8e5': 30, '#0078bf': 60,
  },

  /**
   * Scale a pattern-size knob (halftone/dither cell, dot grid spacing)
   * from the layer's natural-resolution pixels to a render at
   * `patternScale` × that resolution. Patterned output (dither cells,
   * screens, dots) is anchored to natural pixels: rendering the same
   * layer at a different bitmap resolution must scale the pattern with
   * the bitmap or the on-page pattern size changes.
   */
  _scaledPatternSize(size, patternScale) {
    return pipelineScaledPatternSize(size, patternScale);
  },

  /**
   * Effective halftone cell size (bitmap px) for a render.
   *
   * The knob is anchored to the layer's natural-resolution pixels and
   * scaled by the render ratio (`patternScale`). Dot screens (magazine
   * "Dots" and "Grunge") are additionally floored at the magazine-size
   * anchor: pages rasterize at 600 dpi and a magazine screen (133–150 lpi)
   * spans ~4 device px per cell (600/150 = 4), so knob settings below that
   * keep rendering at the magazine pitch instead of collapsing into
   * sub-pixel noise (see pattern-size.js for the lpi/dpi math).
   */
  _halftoneCell(layer, patternScale, targetW) {
    return pipelineHalftoneCell(layer, patternScale, targetW);
  },

  /**
   * Render-ratio fallback for pattern knobs: callers that render at a
   * different bitmap resolution than the layer's natural size (previews,
   * custom composite targets) scale the knobs by targetW/naturalWidth so
   * patterns keep their on-page size. Callers that already computed a
   * ratio (e.g. the merge composite) pass it explicitly.
   */
  _renderRatio(patternScale, naturalWidth, targetW) {
    return pipelineRenderRatio(patternScale, naturalWidth, targetW);
  },

  // Spectrolite-style per-plate styling, shared by preview
  // (processColorSeparation) and export (export-engine).
  // Input: grayscale separation plate (0 = full ink, 255 = no ink).
  // Returns a colorized ImageData ready for compositing.
  _styleSepPlate(px, layer, colorHex, colorIdx, targetW, targetH, patternScale = 1) {
    const type = layer.halftoneType;

    // Spectrolite inkOpacityMultipliers: rescale the grayscale ink amount
    // before any post-processing.
    const ops = layer.inkOpacities;
    if (ops && ops[colorIdx] != null && ops[colorIdx] !== 1 && window.applyInkOpacities) {
      const scaled = window.applyInkOpacities(px.data, targetW, targetH, 1,
        new Float64Array([ops[colorIdx]]));
      px = toImageData(scaled, targetW, targetH);
    }

    if (type === 'grayscale') {
      // Continuous tone: plate value becomes the ink's alpha coverage.
      const d = px.data;
      const { r: cr, g: cg, b: cb } = hexToRgb(colorHex);
      for (let i = 0; i < d.length; i += 4) {
        const gray = d[i]; // R = G = B in plate
        d[i] = cr;
        d[i + 1] = cg;
        d[i + 2] = cb;
        d[i + 3] = 255 - gray; // darker plate = more opaque ink
      }
      return px;
    }

    if (type === 'screen') {
      // Spectrolite AM screen: per-ink angle + cell size (halftoneSize px)
      // + circle/square dot.  Screens the raw grayscale — no posterize.
      const angle = sepAngleFor(layer, colorHex, colorIdx, this._separationAngles);
      const cellSize = Math.max(2, this._scaledPatternSize(layer.halftoneSize, patternScale));
      const screened = window.spectroliteHalftoneScreen(px.data, targetW, targetH,
        cellSize, angle, layer.halftoneShape || 'circle');
      return this.colorize(toImageData(screened, targetW, targetH), colorHex, null);
    }

    if (type === 'errordiff') {
      // Spectrolite error-diffusion dithering: kernel + scale + threshold,
      // applied to the raw grayscale plate. ditherScale is chunky-dot size
      // in plate pixels, so it scales with the render ratio too.
      const mi = ditherMethodIndex(layer.ditherMethod);
      const ditherScale = (layer.ditherScale ?? 1) * (patternScale && patternScale !== 1 ? patternScale : 1);
      const dithered = window.spectroliteDitherPlate(px.data, targetW, targetH,
        mi, ditherScale, layer.ditherThreshold ?? 0.5);
      return this.colorize(toImageData(dithered, targetW, targetH), colorHex, null);
    }

    // Legacy screen types: coarse posterize + Bayer/magazine/grunge dots.
    const baseAngle = layer.halftoneAngle || 45;
    const offsetAngle = this._separationAngles[colorHex] || 0;
    const angle = (baseAngle + offsetAngle) % 180;
    px = this.posterize(px, 6);
    px = this.applyHalftone(px, targetW, targetH, type, this._halftoneCell(layer, patternScale, targetW), angle);
    return this.colorize(px, colorHex, null);
  },

  processColorSeparation(layer, forExport, pixelWidth = 0, pixelHeight = 0, patternScale = 0) {
    const nw = layer.naturalWidth, nh = layer.naturalHeight;
    let targetW, targetH;
    if (pixelWidth > 0 && pixelHeight > 0) {
      // Caller-requested composite resolution (see processLayer).
      targetW = pixelWidth;
      targetH = pixelHeight;
    } else if (forExport) {
      targetW = nw;
      targetH = nh;
    } else {
      const res = this.getDisplayResolution(layer);
      targetW = res.w;
      targetH = res.h;
    }
    // Pattern knobs are anchored to natural-resolution pixels; scale them
    // with the render ratio so patterns keep their on-page size (see
    // processLayer). The merge composite passes its own ratio.
    patternScale = this._renderRatio(patternScale, nw, targetW);
    const work = new OffscreenCanvas(targetW, targetH);
    const ctx = work.getContext('2d');

    layer.separationColors.forEach((colorHex, colorIdx) => {
      const plateStore = layer.separationPlates.get(colorHex);
      if (!plateStore) return;

      // Plates are stored grayscale (1 byte/px); expand one plate at a
      // time instead of keeping every ink's RGBA canvas alive.
      const plateCanvas = sepPlateToCanvas(plateStore);
      const styledCanvas = new OffscreenCanvas(targetW, targetH);
      const pCtx = styledCanvas.getContext('2d', { willReadFrequently: true });
      pCtx.drawImage(plateCanvas, 0, 0, targetW, targetH);

      let px = pCtx.getImageData(0, 0, targetW, targetH);
      px = this._styleSepPlate(px, layer, colorHex, colorIdx, targetW, targetH, patternScale);
      pCtx.putImageData(px, 0, 0);

      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(styledCanvas, 0, 0);
    });

    if (forExport) return work;
    layer._processedCanvas = work;
    layer._processedAtZoom = State.zoom;
    layer._dirty = false;
    layer._zoomRefreshNeeded = false;
    return work;
  },
};

