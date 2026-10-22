/* ═══════════════════════════════════════════════════════════════════
   Export Engine
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { CANVAS_W, CANVAS_H, RISO_COLORS } from './constants.js';
import { ImageProcessor, buildGradientWeightMap, buildPatternWeightMap } from './image-processor.js';
import { DB } from './db.js';
import { Renderer } from './renderer.js';
import { appendKofiNotice, closeWindowAfterExport } from './ui.js';
import { calculateLayout, calculateBookletLayout, computeSheetPlan, newSheetCanvas, drawPageInCell, buildSingleImageSheet } from './imposition.js';
import { PageManager } from './page-manager.js';
import { computeViewUnits, computeSpreads } from './spread-manager.js';
import { isTwoToneShape } from './shape-utils.js';
import { createExportProgress, formatBytes, formatDuration } from './export-progress.js';

export const ExportEngine = {
  // Put a context into the layer's own coordinate space: origin at its
  // top-left corner, with rotation and flips applied.
  _applyLayerTransform(ctx, layer) {
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
    ctx.translate(-layer.width / 2, -layer.height / 2);
  },

  // Renders a layer's sourceCanvas (processedCanvas or weightedCanvas) to a full-canvas
  // OffscreenCanvas, applying both painted mask (_maskCanvas) and image masks (imageMaskIds).
  async _renderLayerToBuffer(layer, sourceCanvas, width, height, layerSet = State.layers) {
    const buf = new OffscreenCanvas(width, height);
    const bCtx = buf.getContext('2d');
    bCtx.save();
    this._applyLayerTransform(bCtx, layer);
    if (layer._maskCanvas) {
      const tmp = new OffscreenCanvas(layer.width, layer.height);
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(sourceCanvas, 0, 0, layer.width, layer.height);
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.drawImage(layer._maskCanvas, 0, 0, layer.width, layer.height);
      bCtx.drawImage(tmp, 0, 0);
    } else {
      bCtx.drawImage(sourceCanvas, 0, 0, layer.width, layer.height);
    }
    bCtx.restore();
    for (const maskId of (layer.imageMaskIds || [])) {
      const maskLayer = layerSet.find(l => l.id === maskId);
      if (!maskLayer) continue;
      const maskCanvas = await ImageProcessor.processLayer(maskLayer, { forExport: true });
      if (!maskCanvas) continue;
      const maskBuf = new OffscreenCanvas(width, height);
      const mCtx = maskBuf.getContext('2d');
      mCtx.save();
      mCtx.translate(maskLayer.x + maskLayer.width / 2, maskLayer.y + maskLayer.height / 2);
      mCtx.rotate(maskLayer.rotation * Math.PI / 180);
      mCtx.scale(maskLayer.flipH ? -1 : 1, maskLayer.flipV ? -1 : 1);
      mCtx.translate(-maskLayer.width / 2, -maskLayer.height / 2);
      mCtx.drawImage(maskCanvas, 0, 0, maskLayer.width, maskLayer.height);
      // If the mask layer has its own painted mask (e.g. a linked difference
      // layer), restrict the mask effect to the painted-visible area.
      if (maskLayer._maskCanvas) {
        mCtx.globalCompositeOperation = 'destination-in';
        mCtx.drawImage(maskLayer._maskCanvas, 0, 0, maskLayer.width, maskLayer.height);
      }
      mCtx.restore();
      const maskImgData = mCtx.getImageData(0, 0, width, height);
      const md = maskImgData.data;
      for (let i = 0; i < md.length; i += 4) md[i + 3] = 255 - md[i + 3];
      mCtx.putImageData(maskImgData, 0, 0);
      bCtx.globalCompositeOperation = 'destination-in';
      bCtx.drawImage(maskBuf, 0, 0);
    }
    return buf;
  },

  // Paint one prepared layer onto a plate canvas. A page-sized intermediate is
  // only built when an image mask has to be composited in page space; an
  // unmasked layer (or one with just a painted mask) goes straight through the
  // layer transform, so no full-page copy is allocated per layer per plate.
  async _drawLayerOnPlate(ctx, layer, sourceCanvas, width, height, layerSet) {
    const imageMaskIds = layer.imageMaskIds || [];
    if (!layer._maskCanvas && !imageMaskIds.length) {
      ctx.save();
      this._applyLayerTransform(ctx, layer);
      ctx.drawImage(sourceCanvas, 0, 0, layer.width, layer.height);
      ctx.restore();
      return;
    }
    if (!imageMaskIds.length) {
      // Painted mask: isolate it in a layer-sized buffer first, so
      // destination-in cannot clear the plate outside the layer.
      const tmp = new OffscreenCanvas(layer.width, layer.height);
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(sourceCanvas, 0, 0, layer.width, layer.height);
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.drawImage(layer._maskCanvas, 0, 0, layer.width, layer.height);
      ctx.save();
      this._applyLayerTransform(ctx, layer);
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
      return;
    }
    ctx.drawImage(await this._renderLayerToBuffer(layer, sourceCanvas, width, height, layerSet), 0, 0);
  },

  _tileCanvas(src, layout, pageWidth, pageHeight) {
    if (layout === '1up') return src;
    let cols, rows;
    if (layout === '8up') { cols = 4; rows = 2; }
    else if (layout === '4up') { cols = 2; rows = 2; }
    else { cols = 2; rows = 1; }
    const out = new OffscreenCanvas(pageWidth * cols, pageHeight * rows);
    const ctx = out.getContext('2d');
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        ctx.drawImage(src, c * pageWidth, r * pageHeight);
    return out;
  },

  _getSpreadSplitInfo() {
    if (!State.spreadView || !State.unitId) return null;
    const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
    const unit = units.find(u => u.id === State.unitId);
    if (!unit || unit.type !== 'spread') return null;
    const leftPage = State.pages.find(p => p.id === unit.leftPageId);
    const rightPage = State.pages.find(p => p.id === unit.rightPageId);
    if (!leftPage || !rightPage) return null;
    return { leftPage, rightPage, leftWidth: leftPage.width, rightWidth: rightPage.width };
  },

  _splitCanvasByWidth(src, leftWidth) {
    const rightWidth = src.width - leftWidth;
    const height = src.height;
    const left = new OffscreenCanvas(leftWidth, height);
    left.getContext('2d').drawImage(src, 0, 0, leftWidth, height, 0, 0, leftWidth, height);
    const right = new OffscreenCanvas(rightWidth, height);
    right.getContext('2d').drawImage(src, leftWidth, 0, rightWidth, height, 0, 0, rightWidth, height);
    return { left, right };
  },

  _buildPlateMap(visibleLayers) {
    const plateMap = new Map();
    const ensurePlate = hex => {
      if (!plateMap.has(hex)) plateMap.set(hex, { solidLayers: [], gradContributions: [], separationLayers: [], shapeParts: [] });
      return plateMap.get(hex);
    };
    for (const l of visibleLayers) {
      if (l.isColorSeparation) {
        for (const colorHex of l.separationColors) {
          ensurePlate(colorHex).separationLayers.push({ layer: l, color: colorHex });
        }
      } else if (isTwoToneShape(l)) {
        // Two-tone shapes split across their own color plates: the body prints
        // with the fill ink, the border ring with the border ink.
        if (l.shapeHasFill && l.shapeFillColor) {
          ensurePlate(l.shapeFillColor).shapeParts.push({ layer: l, part: 'fill' });
        }
        if (l.shapeHasStroke && l.shapeStrokeColor) {
          ensurePlate(l.shapeStrokeColor).shapeParts.push({ layer: l, part: 'stroke' });
        }
      } else if (l.colorMode === 'gradient' && l.gradient?.stops?.length >= 2) {
        l.gradient.stops.forEach((stop, idx) => {
          ensurePlate(stop.color).gradContributions.push({ layer: l, stopIdx: idx });
        });
      } else if (l.colorMode === 'pattern' && l.pattern) {
        ensurePlate(l.pattern.color1).gradContributions.push({ layer: l, stopIdx: 0 });
        ensurePlate(l.pattern.color2).gradContributions.push({ layer: l, stopIdx: 1 });
      } else {
        ensurePlate(l.color).solidLayers.push(l);
      }
    }
    return plateMap;
  },

  // Renders one color plate for a given layer set and dimensions.
  // Returns an OffscreenCanvas (greyscale ink on white).
  // `progress`, when given, is awaited with a stage string before every
  // contribution: "rendering layer 3 of 7 · grunge.png".
  async _renderPlate(color, plate, width, height, layerSet, progress = null) {
    const ec = new OffscreenCanvas(width, height);
    const ctx = ec.getContext('2d');

    const totalSteps =
      plate.solidLayers.length +
      (plate.shapeParts || []).length +
      (plate.separationLayers || []).length +
      plate.gradContributions.length;
    let step = 0;
    const tick = async layer => {
      step += 1;
      if (progress) await progress(`rendering layer ${step} of ${totalSteps} · ${layer?.name || 'layer'}`);
    };

    // Solid layers
    for (const layer of plate.solidLayers) {
      if (!layer._processedCanvas && !layer._originalCanvas && !layer.isText) continue;
      await tick(layer);
      const sourceCanvas = await ImageProcessor.processLayer(layer, { forExport: true });
      if (!sourceCanvas) continue;
      await this._drawLayerOnPlate(ctx, layer, sourceCanvas, width, height, layerSet);
    }

    // Two-tone shape contributions: each part is processed through the same
    // render chain as the screen (per-ink colorized canvas), so plates match
    // exactly what you see. Only alpha matters after _renderLayerToBuffer.
    for (const { layer, part } of (plate.shapeParts || [])) {
      await tick(layer);
      const sourceCanvas = ImageProcessor.processShapePart(layer, part, layer.naturalWidth, layer.naturalHeight);
      if (!sourceCanvas) continue;
      await this._drawLayerOnPlate(ctx, layer, sourceCanvas, width, height, layerSet);
    }

    // Color separation layer contributions
    for (const { layer, color: plateColor } of (plate.separationLayers || [])) {
      await tick(layer);
      const plateCanvas = layer.separationPlates.get(plateColor);
      if (!plateCanvas) continue;
      const scaled = new OffscreenCanvas(layer.width, layer.height);
      const sCtx = scaled.getContext('2d', { willReadFrequently: true });
      sCtx.drawImage(plateCanvas, 0, 0, layer.width, layer.height);
      let px = sCtx.getImageData(0, 0, layer.width, layer.height);
      const colorIdx = layer.separationColors?.indexOf(plateColor) ?? -1;
      // Shared Spectrolite-style plate styling (grayscale alpha, AM screen,
      // error-diffusion dithering, or legacy Bayer/magazine/grunge).
      px = ImageProcessor._styleSepPlate(px, layer, plateColor, colorIdx, layer.width, layer.height);
      sCtx.putImageData(px, 0, 0);
      await this._drawLayerOnPlate(ctx, layer, scaled, width, height, layerSet);
    }

    // Gradient / pattern layer contributions (weighted by color dominance)
    for (const { layer, stopIdx } of plate.gradContributions) {
      if (!layer._processedCanvas && !layer._originalCanvas && !layer.isText) continue;
      await tick(layer);
      const sourceCanvas = await ImageProcessor.processLayer(layer, { forExport: true });
      if (!sourceCanvas) continue;
      const nw = layer.naturalWidth, nh = layer.naturalHeight;
      const weightMap = layer.colorMode === 'pattern' && layer.pattern
        ? buildPatternWeightMap(nw, nh, layer.pattern, stopIdx)
        : buildGradientWeightMap(nw, nh, layer.gradient, stopIdx);
      const weightedCanvas = new OffscreenCanvas(nw, nh);
      const wCtx = weightedCanvas.getContext('2d', { willReadFrequently: true });
      wCtx.drawImage(sourceCanvas, 0, 0);
      const imgData = wCtx.getImageData(0, 0, nw, nh);
      const d = imgData.data;
      for (let i = 0; i < nw * nh; i++) {
        d[i*4 + 3] = Math.round(d[i*4 + 3] * weightMap[i]);
      }
      wCtx.putImageData(imgData, 0, 0);
      await this._drawLayerOnPlate(ctx, layer, weightedCanvas, width, height, layerSet);
    }

    // Remap to greyscale ink on white
    if (progress) await progress(`flattening ${color} ink on white…`);
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const grey = 255 - d[i+3];
      d[i] = grey; d[i+1] = grey; d[i+2] = grey; d[i+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return ec;
  },

  // Exports a single layer set (one page) and returns a Map color -> plate canvas.
  async exportLayers(layers, width, height) {
    const visibleLayers = layers.filter(l => l.visible && !l.isMaskFor);
    if (!visibleLayers.length) return new Map();

    const plateMap = this._buildPlateMap(visibleLayers);
    const result = new Map();
    for (const [color, plate] of plateMap.entries()) {
      if (color === '#FFFFFF') continue;
      const canvas = await this._renderPlate(color, plate, width, height, layers);
      result.set(color, canvas);
    }
    return result;
  },

  // ── Streaming primitives ───────────────────────────────────────
  // The exporters walk ONE page and ONE ink at a time: each step decides
  // what to render from layer RECORDS, hydrates only that ink's layers, draws
  // the finished plate onto the sheet and lets it go. Peak memory is one
  // sheet plus one page plate, no matter how many pages or inks the book has.

  // Report the export's current sub-step. The progress widget shows it on its
  // own stage line under the label; a plain element (the composite dialog)
  // gets it as its text, exactly as before. The yield lets the browser paint
  // the update before the next chunk of work starts.
  async _stage(prog, text) {
    if (!prog) return;
    if (typeof prog.stage === 'function') prog.stage(text);
    else prog.textContent = text;
    await new Promise(r => setTimeout(r, 0));
  },

  // Drop the bitmaps a hydration pass decoded. The layer objects are thrown
  // away right after, so this only exists to stop the backing stores from
  // pinning memory until the next GC.
  _releaseLayers(layers) {
    for (const l of layers) {
      l._originalCanvas = null;
      l._exportOriginalCanvas = null;
      l._processedCanvas = null;
      l._maskCanvas = null;
      l._svgImage = null;
      l.separationPlates?.clear();
    }
  },

  // Reader page index → the printer spread half it belongs to.
  _spreadIndexOfPages(pageOrder, spreads) {
    const spreadOfPage = new Map();
    spreads.forEach((sp, i) => {
      const li = sp.leftPageId ? pageOrder.indexOf(sp.leftPageId) : -1;
      const ri = sp.rightPageId ? pageOrder.indexOf(sp.rightPageId) : -1;
      if (li !== -1) spreadOfPage.set(li, { index: i, role: 'left' });
      if (ri !== -1) spreadOfPage.set(ri, { index: i, role: 'right' });
    });
    return spreadOfPage;
  },

  // Work out how one reader page has to be rendered for a single pass:
  // alone (content cropped at its own edges) or as one half of a reader
  // spread, where layers crossing the fold are composited across both pages
  // and the result cropped back to this page's half. Returns null when the
  // page has no layer records at all.
  // Reads layer records only — no bitmap is decoded to make this decision.
  async _resolveInkTarget(pageOrder, pageIndex, spreads, spreadOfPage, readerSpreadIds) {
    const pid = pageOrder[pageIndex];
    if (!pid) return null;
    const spInfo = spreadOfPage.get(pageIndex);
    if (!spInfo) {
      const page = await DB.get('pages', pid);
      const recs = await PageManager.loadPageLayerRecords(pid);
      if (!page || !recs.length) return null;
      return { recs, width: page.width, height: page.height, xOffsets: null, src: null };
    }

    const spread = spreads[spInfo.index];
    const leftPage = spread.leftPageId ? await DB.get('pages', spread.leftPageId) : null;
    const rightPage = spread.rightPageId ? await DB.get('pages', spread.rightPageId) : null;
    if (!leftPage && !rightPage) return null;
    const leftWidth = leftPage?.width || 0;
    const pageHeight = Math.max(leftPage?.height || 0, rightPage?.height || 0);

    const leftRecs = leftPage ? await PageManager.loadPageLayerRecords(leftPage.id) : [];
    const rightRecs = rightPage ? await PageManager.loadPageLayerRecords(rightPage.id) : [];
    const isLeft = spInfo.role === 'left';
    const sidePage = isLeft ? leftPage : rightPage;
    if (!sidePage) return null;

    const spanning = readerSpreadIds.has(spread.id)
      && this._hasSpanningLayers(leftRecs, rightRecs, leftWidth);

    if (!spanning) {
      const recs = isLeft ? leftRecs : rightRecs;
      if (!recs.length) return null;
      return { recs, width: sidePage.width, height: pageHeight, xOffsets: null, src: null };
    }

    // Spanning: both pages share one canvas, the right page shifted across the
    // fold, and this page's half is cropped out of it when drawing.
    const recs = [...leftRecs, ...rightRecs];
    if (!recs.length) return null;
    const xOffsets = new Map();
    if (rightPage) for (const r of rightRecs) xOffsets.set(r.id, leftWidth);
    return {
      recs,
      width: leftWidth + (rightPage?.width || 0),
      height: pageHeight,
      xOffsets,
      src: {
        x: isLeft ? 0 : leftWidth,
        y: 0,
        w: isLeft ? leftWidth : (rightPage?.width || 0),
        h: pageHeight,
      },
    };
  },

  // Hydrate exactly the layers one plate draws (plus any image-mask layers
  // they reference), and point the plate at the hydrated objects.
  async _hydratePlate(recs, plate, progress = null) {
    const byId = new Map(recs.map(r => [r.id, r]));
    const wanted = [];
    const seen = new Set();
    const want = rec => {
      if (!rec || seen.has(rec.id)) return;
      seen.add(rec.id);
      wanted.push(rec);
    };
    for (const l of plate.solidLayers) want(l);
    for (const { layer } of plate.shapeParts) want(layer);
    for (const { layer } of plate.separationLayers) want(layer);
    for (const { layer } of plate.gradContributions) want(layer);
    for (const rec of [...wanted]) {
      for (const maskId of (rec.imageMaskIds || [])) want(byId.get(maskId));
    }

    if (progress) await progress(`loading ${wanted.length} layer${wanted.length === 1 ? '' : 's'}…`);

    const byHydratedId = new Map();
    for (const rec of wanted) {
      const layer = await PageManager.hydrateLayer(rec);
      if (layer) byHydratedId.set(rec.id, layer);
    }
    // Swap each plate entry from its layer record to the hydrated layer.
    const live = rec => byHydratedId.get(rec?.id);
    return {
      layers: [...byHydratedId.values()],
      plate: {
        solidLayers: plate.solidLayers.map(live).filter(Boolean),
        shapeParts: plate.shapeParts.map(p => ({ layer: live(p.layer), part: p.part })).filter(p => p.layer),
        separationLayers: plate.separationLayers.map(p => ({ layer: live(p.layer), color: p.color })).filter(p => p.layer),
        gradContributions: plate.gradContributions.map(p => ({ layer: live(p.layer), stopIdx: p.stopIdx })).filter(p => p.layer),
      },
    };
  },

  // Render one ink for the layer records of one page (or of one reader
  // spread). Returns a plate canvas, or null when this page prints nothing in
  // this ink — nothing is decoded in that case. Every bitmap the pass touched
  // is released before returning.
  async _renderInkPlate(target, color, progress = null) {
    const visible = target.recs.filter(r => r.visible && !r.isMaskFor);
    if (!visible.length) return null;
    const plate = this._buildPlateMap(visible).get(color);
    if (!plate) return null;

    const { layers, plate: livePlate } = await this._hydratePlate(target.recs, plate, progress);
    try {
      if (target.xOffsets) {
        for (const l of layers) {
          const dx = target.xOffsets.get(l.id) || 0;
          if (dx) l.x += dx;
        }
      }
      return await this._renderPlate(color, livePlate, target.width, target.height, layers, progress);
    } finally {
      this._releaseLayers(layers);
    }
  },

  // One plate for one resolved target and one ink, ready to draw into a sheet
  // cell. Returns { canvas, src } or null. Only the returned canvas is alive:
  // the caller draws it and drops it before asking for the next one.
  async _renderInkForTarget(target, color, progress = null) {
    if (!target) return null;
    const canvas = await this._renderInkPlate(target, color, progress);
    if (!canvas) return null;
    this._plateHeld();
    return { canvas, src: target.src };
  },

  // Same, for callers that have not resolved the target yet. The exporters
  // resolve once per sheet side and reuse the target across inks.
  async _renderInkForPage(pageOrder, pageIndex, color, spreads, spreadOfPage, readerSpreadIds, progress = null) {
    const target = await this._resolveInkTarget(pageOrder, pageIndex, spreads, spreadOfPage, readerSpreadIds);
    return this._renderInkForTarget(target, color, progress);
  },

  // Resolve every cell a sheet side needs, once. Targets are layer RECORDS
  // only — no bitmaps — so the whole side costs nothing to keep around while
  // each ink is rendered in turn.
  async _resolveSideTargets(side, pageOrder, spreads, spreadOfPage, readerSpreadIds, prog = null) {
    const targets = [];
    for (const cell of side.cells) {
      const pageIndex = cell.pageIndex;
      if (pageIndex === null || pageIndex === undefined) continue;
      await this._stage(prog, `reading page ${pageIndex + 1} of ${pageOrder.length}…`);
      const target = await this._resolveInkTarget(pageOrder, pageIndex, spreads, spreadOfPage, readerSpreadIds);
      if (target) targets.push({ cell, pageIndex, target });
    }
    return targets;
  },

  // Same walk, but blending every ink into one full-colour composite.
  async _renderCompositeForPage(pageOrder, pageIndex, spreads, spreadOfPage, readerSpreadIds, prog = null) {
    const target = await this._resolveInkTarget(pageOrder, pageIndex, spreads, spreadOfPage, readerSpreadIds);
    return this._renderCompositeForTarget(target, pageIndex, prog);
  },

  async _renderCompositeForTarget(target, pageIndex, prog = null) {
    if (!target) return null;
    const layers = [];
    for (const rec of target.recs) {
      const layer = await PageManager.hydrateLayer(rec);
      if (!layer) continue;
      const dx = target.xOffsets?.get(rec.id) || 0;
      if (dx) layer.x += dx;
      layers.push(layer);
    }
    try {
      if (!layers.length) return null;
      const canvas = await this._renderComposite(layers, target.width, target.height, prog, `Page ${pageIndex + 1}`);
      this._plateHeld();
      return { canvas, src: target.src };
    } finally {
      this._releaseLayers(layers);
    }
  },

  // Instrumentation for the streaming invariant: plates alive at once. The
  // exporters must never exceed 1 — a larger value means a plate is being
  // held across pages instead of being drawn and released.
  _plateHeld() {
    this._livePlates = (this._livePlates || 0) + 1;
    this._peakLivePlates = Math.max(this._peakLivePlates || 0, this._livePlates);
  },

  _plateDrawn() {
    this._livePlates = Math.max(0, (this._livePlates || 0) - 1);
  },

  async export() {
    const progEl = document.getElementById('export-progress');
    const prog = createExportProgress(progEl);
    const btn = document.getElementById('btn-export-go');
    this._cancelRequested = false;
    try {
      const projectSlug = document.getElementById('status-project').textContent
        .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const layout = document.querySelector('input[name="export-layout"]:checked')?.value || '1up';
      const binding = document.querySelector('input[name="export-binding"]:checked')?.value || 'saddle-stitch';
      const bookletLayout = document.querySelector('input[name="export-booklet-layout"]:checked')?.value || 'folio';
      const targetSheetSize = document.getElementById('export-target-size')?.value || 'letter';
      const customW = parseFloat(document.getElementById('export-custom-width')?.value || '0') * 600;
      const customH = parseFloat(document.getElementById('export-custom-height')?.value || '0') * 600;

      if (State.project) {
        State.project.booklet = { ...(State.project.booklet || {}), targetSheetSize };
        await DB.put('projects', State.project);
      }

      if (State.pages.length > 1) {
        await this.exportBooklet({
          prog,
          projectSlug,
          layout,
          binding,
          bookletLayout,
          targetSheetSize,
          customTargetW: customW,
          customTargetH: customH,
        });
        return;
      }

      const visibleLayers = State.layers.filter(l => l.visible && !l.isMaskFor);
      const plateMap = this._buildPlateMap(visibleLayers);
      // Stream one ink at a time: render the plate, download it, release it.
      // Only the current plate canvas is ever held in memory.
      const colors = [...plateMap.keys()].filter(c => c !== '#FFFFFF');
      const spreadInfo = this._getSpreadSplitInfo();
      // Single-image exports adjust to the target paper like booklet exports:
      // the layout radios choose copies per sheet, imposed by buildSingleImageSheet.
      const copies = { '1up': 1, '2up': 2, '4up': 4, '8up': 8 }[layout] || 1;
      const singleImageOptions = {
        copies,
        targetSheetSize,
        customTargetW: customW,
        customTargetH: customH,
      };

      const startedAt = performance.now();
      // One progress unit per downloadable file — a spread view splits every
      // ink into a left and a right sheet.
      const filesPerPlate = spreadInfo ? 2 : 1;
      const totalFiles = colors.length * filesPerPlate;
      prog.begin(totalFiles);
      let bytes = 0;
      let files = 0;

      for (let ci = 0; ci < colors.length; ci++) {
        const color = colors[ci];
        const colorName = RISO_COLORS.find(c => c.hex === color)?.name || color;
        const plate = plateMap.get(color);
        const stageFor = text => this._stage(prog, `${colorName} — ${text}`);
        const layerCount = plate
          ? plate.solidLayers.length + plate.shapeParts.length + plate.separationLayers.length + plate.gradContributions.length
          : 0;

        prog.textContent = `Plate ${files + 1} of ${totalFiles} · ${colorName} ink`;
        await stageFor(`rendering ${layerCount} layer${layerCount === 1 ? '' : 's'}…`);

        const canvas = await this._renderPlate(color, plate, CANVAS_W, CANVAS_H, State.layers, stageFor);

        const download = async (sideCanvas, name) => {
          await stageFor(`encoding ${name}…`);
          const blob = await sideCanvas.convertToBlob({ type: 'image/png' });
          bytes += blob.size;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = name;
          await stageFor(`saving ${name}…`);
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          await new Promise(r => setTimeout(r, 400));
          files += 1;
          prog.advance(1, { bytes: blob.size });
          if (files < totalFiles) prog.textContent = `Plate ${files + 1} of ${totalFiles} · ${colorName} ink`;
        };

        const colorSlug = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const layoutSuffix = layout !== '1up' ? `-${layout}` : '';

        if (spreadInfo) {
          const { left, right } = this._splitCanvasByWidth(canvas, spreadInfo.leftWidth);
          const leftSlug = spreadInfo.leftPage.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          const rightSlug = spreadInfo.rightPage.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          await stageFor('splitting spread…');
          await download(buildSingleImageSheet(left, singleImageOptions), `${projectSlug}-${leftSlug}-${colorSlug}${layoutSuffix}.png`);
          await download(buildSingleImageSheet(right, singleImageOptions), `${projectSlug}-${rightSlug}-${colorSlug}${layoutSuffix}.png`);
        } else {
          await stageFor(`imposing ${copies}-up sheet…`);
          await download(buildSingleImageSheet(canvas, singleImageOptions), `${projectSlug}-${colorSlug}${layoutSuffix}.png`);
        }
      }

      for (const l of State.layers) { l._dirty = true; }
      Renderer.schedule();

      prog.finish(`Done! ${files} plate${files === 1 ? '' : 's'} exported · ${formatBytes(bytes)} · ${formatDuration(performance.now() - startedAt)}`);
      appendKofiNotice(progEl);
      closeWindowAfterExport();
    } catch (err) {
      console.error('Export failed:', err);
      prog?.fail(`Export failed: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  },

  // True when a layer crosses the fold of a genuine reader spread: a left-page
  // layer extending past its right edge, or a right-page layer (already
  // normalised to right-page coords) extending past its left edge.
  _hasSpanningLayers(leftLayers, rightLayers, leftWidth) {
    for (const l of leftLayers) {
      if (l.x + l.width > leftWidth + 1) return true;
    }
    for (const l of rightLayers) {
      if (l.x < -1) return true;
    }
    return false;
  },

  // The set of printer-spread ids that are also genuine reader spreads (cover +
  // centre for saddle-stitch). Only these may let a layer span the fold; every
  // other printer-spread pairing is two unrelated single pages whose content
  // must be cropped at each page edge.
  _genuineReaderSpreadIds(pageOrder) {
    return new Set(
      computeViewUnits(pageOrder, State.project.booklet?.binding)
        .filter(u => u.type === 'spread')
        .map(u => u.id)
    );
  },

  // Build per-color page plates in reader order for a saddle-stitch booklet.
  // Returns Map<colorHex, Array(pageOrder.length) of canvas|null>. Missing
  // pages stay null so buildSheets renders them as blank white sheets. Kept
  // for the e2e harness, which needs every plate in memory at once; the real
  // exporters never call it and stream one plate at a time instead.
  async _buildBookletPagePlates(pageOrder, prog = null) {
    const spreads = computeSpreads(pageOrder, 'saddle-stitch');
    const readerSpreadIds = this._genuineReaderSpreadIds(pageOrder);
    const spreadOfPage = this._spreadIndexOfPages(pageOrder, spreads);
    const colorPages = new Map();

    const ensurePagePlate = color => {
      if (!colorPages.has(color)) {
        colorPages.set(color, Array(pageOrder.length).fill(null));
      }
      return colorPages.get(color);
    };

    for (let pi = 0; pi < pageOrder.length; pi++) {
      if (prog) {
        prog.textContent = `Loading page ${pi + 1} / ${pageOrder.length}…`;
        await new Promise(r => setTimeout(r, 0));
      }
      const target = await this._resolveInkTarget(pageOrder, pi, spreads, spreadOfPage, readerSpreadIds);
      if (!target) continue;
      for (const color of this._inkColorsOf(target.recs)) {
        const canvas = await this._renderInkPlate(target, color);
        if (canvas) ensurePagePlate(color)[pi] = canvas;
      }
    }

    return colorPages;
  },

  // Every ink the given layer records print in, white excluded, in
  // first-seen order. Same derivation as _buildPlateMap, without decoding.
  _inkColorsOf(recs) {
    const seen = new Set();
    const out = [];
    for (const rec of recs) {
      if (!rec.visible || rec.isMaskFor) continue;
      for (const c of this._plateColorsOfRecord(rec)) {
        if (!c || c === '#FFFFFF' || seen.has(c)) continue;
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  },

  async exportBooklet({ prog, projectSlug, layout, binding, bookletLayout, targetSheetSize, customTargetW, customTargetH }) {
    // Streamed export: pages are rendered and imposed ONE SHEET SIDE at a
    // time, so only the current side's page plates are ever in memory (the
    // previous implementation held every page's plates for every ink before
    // the first download — gigabytes on long multi-page documents).
    const pageOrder = State.project.pageOrder;
    const pageCount = pageOrder.length;

    // Cheap pre-flight over layer records only (no bitmap decoding): the
    // global ink list, the total layer count for the metrics readout, and the
    // reference page for the sheet layout (matches the previous behavior of
    // sizing imposition from the first page with content).
    const scan = await this._scanPages(pageOrder);
    const colors = scan.colors;

    const refPage = scan.firstContentPage;
    // Booklet grids are fixed by the fold structure (folio 2-up, quarto 2×2,
    // octavo 4×2), so the layout must be computed for that grid — not the
    // free N-up grid — or cells end up smaller than the page and every page
    // is silently shrunk. Only the paper orientation / page rotation vary.
    const refW = refPage?.width || CANVAS_W;
    const refH = refPage?.height || CANVAS_H;
    const sheetLayout = binding === 'saddle-stitch'
      ? calculateBookletLayout(refW, refH, bookletLayout, targetSheetSize, customTargetW, customTargetH)
      : calculateLayout(refW, refH, targetSheetSize, customTargetW, customTargetH);
    const plan = computeSheetPlan(pageCount, sheetLayout, binding, bookletLayout, 0);

    const totalPlates = plan.length * colors.length;
    prog.begin(totalPlates);
    const startedAt = performance.now();

    // Saddle-stitch pairing: reader page index → the spread it belongs to.
    const spreads = computeSpreads(pageOrder, 'saddle-stitch');
    const readerSpreadIds = this._genuineReaderSpreadIds(pageOrder);
    const spreadOfPage = this._spreadIndexOfPages(pageOrder, spreads);

    let bytes = 0;
    let done = 0;
    this._peakLivePlates = 0;
    this._livePlates = 0;

    for (let si = 0; si < plan.length; si++) {
      const side = plan[si];
      prog.textContent = `Sheet ${si + 1} of ${plan.length} · preparing`;
      // Resolve this side's pages once; the targets hold layer records only,
      // so every ink below reuses them without decoding anything twice. The
      // stage line names each page as its records are read.
      const sideTargets = await this._resolveSideTargets(side, pageOrder, spreads, spreadOfPage, readerSpreadIds, prog);

      // Compose, encode and download each ink for this side. Inks with no
      // content on this side still download as blank white sheets, keeping
      // the per-ink file set complete for print shops.
      for (const color of colors) {
        if (this._cancelRequested) return this._reportCancelled(prog, { done, total: totalPlates, bytes, startedAt });
        const colorName = RISO_COLORS.find(c => c.hex === color)?.name || color;
        const colorSlug = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const fileName = `${projectSlug}-${colorSlug}-sheet-${si + 1}.png`;
        prog.textContent = `Sheet ${si + 1} of ${plan.length} · ${colorName} ink · plate ${done + 1} of ${totalPlates}`;
        await new Promise(r => setTimeout(r, 0));

        const sideCanvas = newSheetCanvas(side);
        const sideCtx = sideCanvas.getContext('2d');

        // One page, one plate: draw it into its cell and drop it before the
        // next page is touched. Nothing but this sheet survives the loop. The
        // stage line follows each page through content check → layer load →
        // layer render → draw.
        for (const { cell, pageIndex: pi, target } of sideTargets) {
          if (this._cancelRequested) return this._reportCancelled(prog, { done, total: totalPlates, bytes, startedAt });
          const pageOf = text => this._stage(prog, `${colorName} · page ${pi + 1} of ${pageCount} — ${text}`);

          await pageOf('checking content…');
          const plate = await this._renderInkForTarget(target, color, pageOf);
          if (!plate) {
            await pageOf('nothing printed in this ink');
            continue;
          }
          drawPageInCell(sideCtx, plate.canvas, cell, side.pageRotated, side.bleed, cell.extraRotation, plate.src);
          plate.canvas = null;
          this._plateDrawn();
        }

        await this._stage(prog, `encoding ${fileName}…`);
        const blob = await sideCanvas.convertToBlob({ type: 'image/png' });
        bytes += blob.size;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        await this._stage(prog, `saving ${fileName}…`);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        await new Promise(r => setTimeout(r, 400));
        done += 1;
        prog.advance(1, { bytes: blob.size });
      }
    }

    for (const l of State.layers) { l._dirty = true; }
    Renderer.schedule();

    prog.finish(`Done! ${done} sheets — ${plan.length} sides × ${colors.length} inks · ${pageCount} pages · ${scan.totalLayers} layers · ${formatBytes(bytes)} · ${formatDuration(performance.now() - startedAt)}`);
    appendKofiNotice(prog.element || prog);
    closeWindowAfterExport();
  },

  // Cheap pre-flight over layer RECORDS only — no bitmap decoding. Collects
  // the global ink list in first-seen page order (white never prints), the
  // total layer count, and the first page with content (the sheet layout
  // reference page, matching the previous first-non-empty-plate behavior).
  async _scanPages(pageOrder) {
    const colors = [];
    const seen = new Set();
    let totalLayers = 0;
    let firstContentPage = null;
    for (const pid of pageOrder) {
      const recs = await DB.getByIndex('layers', 'by-page', pid);
      totalLayers += recs.length;
      if (recs.length && !firstContentPage) {
        firstContentPage = await DB.get('pages', pid);
      }
      for (const c of this._inkColorsOf(recs)) {
        if (seen.has(c)) continue;
        seen.add(c);
        colors.push(c);
      }
    }
    return { colors, totalLayers, firstContentPage };
  },

  // Ink list contributed by one layer record — mirrors _buildPlateMap's
  // color derivation, but works on raw DB records (no hydration).
  _plateColorsOfRecord(rec) {
    if (rec.isColorSeparation) return rec.separationColors || [];
    if (isTwoToneShape(rec)) {
      const out = [];
      if (rec.shapeHasFill && rec.shapeFillColor) out.push(rec.shapeFillColor);
      if (rec.shapeHasStroke && rec.shapeStrokeColor) out.push(rec.shapeStrokeColor);
      return out;
    }
    if (rec.colorMode === 'gradient' && rec.gradient?.stops?.length >= 2) {
      return rec.gradient.stops.map(s => s.color);
    }
    if (rec.colorMode === 'pattern' && rec.pattern) {
      return [rec.pattern.color1, rec.pattern.color2];
    }
    return rec.color ? [rec.color] : [];
  },

  _reportCancelled(prog, { done, total = 0, bytes = 0, startedAt = 0 }) {
    for (const l of State.layers) { l._dirty = true; }
    Renderer.schedule();
    const parts = [`Export cancelled — ${done}${total ? ` of ${total}` : ''} plate${done === 1 ? '' : 's'} saved`];
    if (bytes) parts.push(formatBytes(bytes));
    if (startedAt) parts.push(formatDuration(performance.now() - startedAt));
    prog.finish(`${parts.join(' · ')}.`);
  },

  // Ask the active export to stop after the current plate. Checked between
  // units of work, so cancellation lands within a second or two.
  requestCancel() {
    this._cancelRequested = true;
  },

  async _renderComposite(layers, width, height, prog = null, label = '') {
    let accumulator = new Uint8Array(width * height * 4).fill(255);

    // Exclude mask layers — they render as part of their paired base layer
    const visibleLayers = layers.filter(l => l.visible && !l.isMaskFor && (l._processedCanvas || l._originalCanvas || l.isColorSeparation || l.isText));
    for (let li = 0; li < visibleLayers.length; li++) {
      const layer = visibleLayers[li];
      if (prog) {
        await this._stage(prog, label
          ? `${label}: blending layer ${li + 1} / ${visibleLayers.length}…`
          : `Blending layer ${li + 1} / ${visibleLayers.length}…`);
      }

      const sourceCanvas = await ImageProcessor.processLayer(layer, { forExport: true });
      if (!sourceCanvas) continue;
      const layerBuf = await this._renderLayerToBuffer(layer, sourceCanvas, width, height, layers);
      const layerData = layerBuf.getContext('2d').getImageData(0, 0, width, height);
      accumulator = window.blendSubtractive(accumulator, new Uint8Array(layerData.data.buffer));
    }

    const outCanvas = new OffscreenCanvas(width, height);
    const outCtx = outCanvas.getContext('2d');
    const imgData = new ImageData(new Uint8ClampedArray(accumulator.buffer), width, height);
    outCtx.putImageData(imgData, 0, 0);
    return outCanvas;
  },

  async exportComposite() {
    const prog = document.getElementById('composite-export-progress');
    const projectSlug = document.getElementById('status-project').textContent.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const compositeLayout = document.querySelector('input[name="composite-layout"]:checked')?.value || '1up';
    const bookletLayout = document.querySelector('input[name="composite-booklet-layout"]:checked')?.value || 'folio';
    const targetSheetSize = document.getElementById('composite-target-size')?.value || 'letter';
    const customW = parseFloat(document.getElementById('composite-custom-width')?.value || '0') * 600;
    const customH = parseFloat(document.getElementById('composite-custom-height')?.value || '0') * 600;

    try {
      if (State.pages.length > 1) {
        await this._exportCompositeBooklet({
          prog,
          projectSlug,
          bookletLayout,
          targetSheetSize,
          customTargetW: customW,
          customTargetH: customH,
        });
      } else {
        await this._exportCompositeSingle({
          prog,
          projectSlug,
          compositeLayout,
        });
      }
    } catch (err) {
      console.error('Composite export failed:', err);
      prog.textContent = `Export failed: ${err.message}`;
    } finally {
      for (const l of State.layers) { l._dirty = true; }
      Renderer.schedule();
      prog.textContent = 'Done!';
      appendKofiNotice(prog);
      document.getElementById('btn-composite-go').disabled = false;
    }
  },

  async _exportCompositeSingle({ prog, projectSlug, compositeLayout }) {
    const outCanvas = await this._renderComposite(State.layers, CANVAS_W, CANVAS_H, prog);
    const compositeLayoutSuffix = compositeLayout !== '1up' ? `-${compositeLayout}` : '';

    prog.textContent = 'Encoding PNG…';
    await new Promise(r => setTimeout(r, 0));

    const spreadInfo = this._getSpreadSplitInfo();
    if (spreadInfo) {
      const { left, right } = this._splitCanvasByWidth(outCanvas, spreadInfo.leftWidth);
      const leftSlug = spreadInfo.leftPage.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const rightSlug = spreadInfo.rightPage.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      for (const [sideCanvas, sideSlug, sideDims] of [
        [left, leftSlug, { w: spreadInfo.leftWidth, h: spreadInfo.leftPage.height }],
        [right, rightSlug, { w: spreadInfo.rightWidth, h: spreadInfo.rightPage.height }],
      ]) {
        const tiled = this._tileCanvas(sideCanvas, compositeLayout, sideDims.w, sideDims.h);
        const blob = await tiled.convertToBlob({ type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${projectSlug}-${sideSlug}-composite${compositeLayoutSuffix}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        await new Promise(r => setTimeout(r, 400));
      }
    } else {
      const tiledComposite = this._tileCanvas(outCanvas, compositeLayout, CANVAS_W, CANVAS_H);
      const blob = await tiledComposite.convertToBlob({ type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${projectSlug}-composite${compositeLayoutSuffix}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  },

  // Build per-page full-colour composites in reader order for a saddle-stitch
  // booklet. Returns Array(pageOrder.length) of canvas|null. Same spanning/crop
  // rule as _buildBookletPagePlates. Kept for the e2e harness, which needs every
  // composite in memory at once; the exporter streams them instead.
  async _buildBookletPageComposites(pageOrder, prog = null) {
    const spreads = computeSpreads(pageOrder, 'saddle-stitch');
    const readerSpreadIds = this._genuineReaderSpreadIds(pageOrder);
    const spreadOfPage = this._spreadIndexOfPages(pageOrder, spreads);
    const pageComposites = Array(pageOrder.length).fill(null);

    for (let pi = 0; pi < pageOrder.length; pi++) {
      if (prog) {
        prog.textContent = `Loading page ${pi + 1} / ${pageOrder.length}…`;
        await new Promise(r => setTimeout(r, 0));
      }
      const { canvas } = await this._renderCompositeForPage(pageOrder, pi, spreads, spreadOfPage, readerSpreadIds, prog) || {};
      if (canvas) pageComposites[pi] = canvas;
    }

    return pageComposites;
  },

  async _exportCompositeBooklet({ prog, projectSlug, bookletLayout, targetSheetSize, customTargetW, customTargetH }) {
    // Rendered and imposed ONE SHEET SIDE at a time: pages are composited one
    // at a time into the sheet and released, so a booklet never holds every
    // page composite (and every finished sheet) at once. Spreads render
    // combined so layers crossing the centre fold survive the imposition.
    const pageOrder = State.project.pageOrder;
    const scan = await this._scanPages(pageOrder);
    const refPage = scan.firstContentPage;
    const sheetLayout = calculateBookletLayout(
      refPage?.width || CANVAS_W,
      refPage?.height || CANVAS_H,
      bookletLayout,
      targetSheetSize, customTargetW, customTargetH
    );
    const plan = computeSheetPlan(pageOrder.length, sheetLayout, 'saddle-stitch', bookletLayout, 0);

    const spreads = computeSpreads(pageOrder, 'saddle-stitch');
    const readerSpreadIds = this._genuineReaderSpreadIds(pageOrder);
    const spreadOfPage = this._spreadIndexOfPages(pageOrder, spreads);
    this._peakLivePlates = 0;
    this._livePlates = 0;

    for (let si = 0; si < plan.length; si++) {
      const side = plan[si];
      const sideTargets = await this._resolveSideTargets(side, pageOrder, spreads, spreadOfPage, readerSpreadIds, prog);
      const sheet = newSheetCanvas(side);
      const ctx = sheet.getContext('2d');

      for (const { cell, pageIndex: pi, target } of sideTargets) {
        prog.textContent = `Sheet ${si + 1} / ${plan.length} — page ${pi + 1} / ${pageOrder.length}…`;
        await new Promise(r => setTimeout(r, 0));

        const composite = await this._renderCompositeForTarget(target, pi, prog);
        if (!composite) continue;
        drawPageInCell(ctx, composite.canvas, cell, side.pageRotated, side.bleed, cell.extraRotation, composite.src);
        composite.canvas = null;
        this._plateDrawn();
      }

      prog.textContent = `Encoding sheet ${si + 1} / ${plan.length}…`;
      await new Promise(r => setTimeout(r, 0));
      const blob = await sheet.convertToBlob({ type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectSlug}-composite-sheet-${si + 1}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      await new Promise(r => setTimeout(r, 400));
    }
  },
};
