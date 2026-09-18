/* ═══════════════════════════════════════════════════════════════════
   Export Engine
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { CANVAS_W, CANVAS_H, RISO_COLORS } from './constants.js';
import { ImageProcessor, buildGradientWeightMap, buildPatternWeightMap } from './image-processor.js';
import { DB } from './db.js';
import { hexToRgb } from '../utils/color.js';
import { Renderer } from './renderer.js';
import { appendKofiNotice, closeWindowAfterExport } from './ui.js';
import { calculateLayout, computeSheetPlan, renderSheetSide, buildSheets, buildSingleImageSheet } from './imposition.js';
import { PageManager } from './page-manager.js';
import { computeViewUnits, computeSpreads } from './spread-manager.js';
import { isTwoToneShape } from './shape-utils.js';
import { createExportProgress, formatBytes, formatDuration } from './export-progress.js';

export const ExportEngine = {
  // Renders a layer's sourceCanvas (processedCanvas or weightedCanvas) to a full-canvas
  // OffscreenCanvas, applying both painted mask (_maskCanvas) and image masks (imageMaskIds).
  async _renderLayerToBuffer(layer, sourceCanvas, width, height, layerSet = State.layers) {
    const buf = new OffscreenCanvas(width, height);
    const bCtx = buf.getContext('2d');
    bCtx.save();
    bCtx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    bCtx.rotate(layer.rotation * Math.PI / 180);
    bCtx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
    bCtx.translate(-layer.width / 2, -layer.height / 2);
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
  async _renderPlate(color, plate, width, height, layerSet) {
    const ec = new OffscreenCanvas(width, height);
    const ctx = ec.getContext('2d');

    // Solid layers
    for (const layer of plate.solidLayers) {
      if (!layer._processedCanvas && !layer._originalCanvas && !layer.isText) continue;
      const sourceCanvas = await ImageProcessor.processLayer(layer, { forExport: true });
      if (!sourceCanvas) continue;
      ctx.drawImage(await this._renderLayerToBuffer(layer, sourceCanvas, width, height, layerSet), 0, 0);
    }

    // Two-tone shape contributions: each part is processed through the same
    // render chain as the screen (per-ink colorized canvas), so plates match
    // exactly what you see. Only alpha matters after _renderLayerToBuffer.
    for (const { layer, part } of (plate.shapeParts || [])) {
      const sourceCanvas = ImageProcessor.processShapePart(layer, part, layer.naturalWidth, layer.naturalHeight);
      if (!sourceCanvas) continue;
      ctx.drawImage(await this._renderLayerToBuffer(layer, sourceCanvas, width, height, layerSet), 0, 0);
    }

    // Color separation layer contributions
    for (const { layer, color: plateColor } of (plate.separationLayers || [])) {
      const plateCanvas = layer.separationPlates.get(plateColor);
      if (!plateCanvas) continue;
      const scaled = new OffscreenCanvas(layer.width, layer.height);
      const sCtx = scaled.getContext('2d', { willReadFrequently: true });
      sCtx.drawImage(plateCanvas, 0, 0, layer.width, layer.height);
      let px = sCtx.getImageData(0, 0, layer.width, layer.height);
      if (layer.halftoneType === 'grayscale') {
        const d = px.data;
        const { r: cr, g: cg, b: cb } = hexToRgb(plateColor);
        for (let i = 0; i < d.length; i += 4) {
          const gray = d[i];
          d[i] = cr;
          d[i + 1] = cg;
          d[i + 2] = cb;
          d[i + 3] = 255 - gray;
        }
        sCtx.putImageData(px, 0, 0);
      } else {
        const baseAngle = layer.halftoneAngle || 45;
        const offsetAngle = ImageProcessor._separationAngles[plateColor] || 0;
        const angle = (baseAngle + offsetAngle) % 180;
        px = ImageProcessor.applyHalftone(px, layer.width, layer.height, layer.halftoneType, layer.halftoneSize, angle);
        sCtx.putImageData(px, 0, 0);
        const colored = ImageProcessor.colorize(sCtx.getImageData(0, 0, layer.width, layer.height), plateColor, null);
        sCtx.putImageData(colored, 0, 0);
      }
      ctx.drawImage(await this._renderLayerToBuffer(layer, scaled, width, height, layerSet), 0, 0);
    }

    // Gradient / pattern layer contributions (weighted by color dominance)
    for (const { layer, stopIdx } of plate.gradContributions) {
      if (!layer._processedCanvas && !layer._originalCanvas && !layer.isText) continue;
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
      ctx.drawImage(await this._renderLayerToBuffer(layer, weightedCanvas, width, height, layerSet), 0, 0);
    }

    // Remap to greyscale ink on white
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
      prog.begin(colors.length);
      let bytes = 0;

      for (let ci = 0; ci < colors.length; ci++) {
        const color = colors[ci];
        const colorName = RISO_COLORS.find(c => c.hex === color)?.name || color;
        prog.textContent = `Rendering ${colorName} (${ci + 1}/${colors.length})…`;
        await new Promise(r => setTimeout(r, 0));

        const canvas = await this._renderPlate(color, plateMap.get(color), CANVAS_W, CANVAS_H, State.layers);

        const download = async (sideCanvas, name) => {
          const blob = await sideCanvas.convertToBlob({ type: 'image/png' });
          bytes += blob.size;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          await new Promise(r => setTimeout(r, 400));
        };

        const colorSlug = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const layoutSuffix = layout !== '1up' ? `-${layout}` : '';

        if (spreadInfo) {
          const { left, right } = this._splitCanvasByWidth(canvas, spreadInfo.leftWidth);
          const leftSlug = spreadInfo.leftPage.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          const rightSlug = spreadInfo.rightPage.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          await download(buildSingleImageSheet(left, singleImageOptions), `${projectSlug}-${leftSlug}-${colorSlug}${layoutSuffix}.png`);
          await download(buildSingleImageSheet(right, singleImageOptions), `${projectSlug}-${rightSlug}-${colorSlug}${layoutSuffix}.png`);
        } else {
          await download(buildSingleImageSheet(canvas, singleImageOptions), `${projectSlug}-${colorSlug}${layoutSuffix}.png`);
        }

        prog.advance(1, { bytes });
      }

      for (const l of State.layers) { l._dirty = true; }
      Renderer.schedule();

      prog.finish(`Done! ${colors.length} plate(s) exported.`);
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
  // pages stay null so buildSheets renders them as blank white sheets. Used by
  // the e2e harness so the spanning/crop behaviour is exercised in one place
  // with the streaming exporter (which shares _renderSpreadPlates).
  async _buildBookletPagePlates(pageOrder, prog = null) {
    const spreads = computeSpreads(pageOrder, 'saddle-stitch');
    const readerSpreadIds = this._genuineReaderSpreadIds(pageOrder);
    const colorPages = new Map();

    const ensurePagePlate = color => {
      if (!colorPages.has(color)) {
        colorPages.set(color, Array(pageOrder.length).fill(null));
      }
      return colorPages.get(color);
    };

    for (let si = 0; si < spreads.length; si++) {
      if (prog) {
        prog.textContent = `Loading spread ${si + 1} / ${spreads.length}…`;
        await new Promise(r => setTimeout(r, 0));
      }

      const spread = spreads[si];
      const { left, right } = await this._renderSpreadPlates(spread, readerSpreadIds);

      if (spread.leftPageId && left) {
        const leftIdx = pageOrder.indexOf(spread.leftPageId);
        for (const [color, canvas] of left.entries()) {
          if (leftIdx !== -1) ensurePagePlate(color)[leftIdx] = canvas;
        }
      }
      if (spread.rightPageId && right) {
        const rightIdx = pageOrder.indexOf(spread.rightPageId);
        for (const [color, canvas] of right.entries()) {
          if (rightIdx !== -1) ensurePagePlate(color)[rightIdx] = canvas;
        }
      }
    }

    return colorPages;
  },

  // Render both halves of one printer spread. Spreads that are genuine reader
  // spreads with layers crossing the fold render combined and split (so the
  // content bleeds across the fold); every other pairing renders each page
  // into its own page-sized canvas so content crops at the page edge.
  // Returns { left: Map<color,canvas>|null, right: Map<color,canvas>|null }.
  // All hydrated layer bitmaps are released before returning.
  async _renderSpreadPlates(spread, readerSpreadIds) {
    const leftPage = spread.leftPageId ? await DB.get('pages', spread.leftPageId) : null;
    const rightPage = spread.rightPageId ? await DB.get('pages', spread.rightPageId) : null;
    const leftWidth = leftPage?.width || 0;
    const rightWidth = rightPage?.width || 0;
    const pageHeight = Math.max(leftPage?.height || 0, rightPage?.height || 0);

    const leftLayers = leftPage ? await PageManager.loadPageLayers(leftPage.id) : [];
    const rightLayers = rightPage ? await PageManager.loadPageLayers(rightPage.id) : [];
    const spanning = readerSpreadIds.has(spread.id)
      && this._hasSpanningLayers(leftLayers, rightLayers, leftWidth);

    let left = null;
    let right = null;

    if (!spanning) {
      if (leftPage) left = await this.exportLayers(leftLayers, leftWidth, pageHeight);
      if (rightPage) right = await this.exportLayers(rightLayers, rightWidth, pageHeight);
    } else {
      // Genuine reader spread: render combined and split so layers bleed
      // across the fold.
      const spreadWidth = leftWidth + rightWidth;
      const layers = [...leftLayers];
      for (const l of rightLayers) {
        l.x += leftWidth;
        layers.push(l);
      }

      const spreadPlateMap = await this.exportLayers(layers, spreadWidth, pageHeight);
      left = new Map();
      right = new Map();
      for (const [color, spreadCanvas] of spreadPlateMap.entries()) {
        if (leftPage) {
          const leftPlate = new OffscreenCanvas(leftWidth, pageHeight);
          leftPlate.getContext('2d').drawImage(spreadCanvas, 0, 0, leftWidth, pageHeight, 0, 0, leftWidth, pageHeight);
          left.set(color, leftPlate);
        }
        if (rightPage) {
          const rightPlate = new OffscreenCanvas(rightWidth, pageHeight);
          rightPlate.getContext('2d').drawImage(spreadCanvas, leftWidth, 0, rightWidth, pageHeight, 0, 0, rightWidth, pageHeight);
          right.set(color, rightPlate);
        }
      }
    }

    // Release bitmaps so streamed exports keep memory low.
    for (const l of [...leftLayers, ...rightLayers]) {
      l._originalCanvas = null;
      l._processedCanvas = null;
      l._maskCanvas = null;
      l._svgImage = null;
      l.separationPlates?.clear();
    }

    return { left, right };
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
    const sheetLayout = calculateLayout(
      refPage?.width || CANVAS_W,
      refPage?.height || CANVAS_H,
      targetSheetSize, customTargetW, customTargetH
    );
    const plan = computeSheetPlan(pageCount, sheetLayout, binding, bookletLayout, 0);

    prog.begin(plan.length * colors.length);
    const startedAt = performance.now();

    // Saddle-stitch pairing: reader page index → the spread it belongs to.
    const spreads = computeSpreads(pageOrder, 'saddle-stitch');
    const readerSpreadIds = this._genuineReaderSpreadIds(pageOrder);
    const spreadOfPage = new Map();
    spreads.forEach((sp, i) => {
      const li = sp.leftPageId ? pageOrder.indexOf(sp.leftPageId) : -1;
      const ri = sp.rightPageId ? pageOrder.indexOf(sp.rightPageId) : -1;
      if (li !== -1) spreadOfPage.set(li, { index: i, role: 'left' });
      if (ri !== -1) spreadOfPage.set(ri, { index: i, role: 'right' });
    });

    let bytes = 0;
    let done = 0;

    // Spread halves cache. Booklet imposition always places a reader spread's
    // two halves on adjacent sides of the same physical sheet, so keeping the
    // last side's spreads is enough to render every spread exactly once while
    // bounding memory to roughly one sheet's worth of page plates.
    const spreadCache = new Map();    // spreadIndex → { halves, lastSide }

    for (let si = 0; si < plan.length; si++) {
      const side = plan[si];

      // Render the pages this side needs, one page at a time. Spanning
      // spreads render combined and split into cached halves.
      const pagePlates = new Map();     // pageIndex → Map(color → canvas)
      const neededPages = [...new Set(side.cells.map(c => c.pageIndex))]
        .filter(pi => pi !== null && pi !== undefined);

      for (const pi of neededPages) {
        if (this._cancelRequested) return this._reportCancelled(prog, done, bytes);
        prog.textContent = `Sheet ${si + 1} of ${plan.length} — rendering page ${pi + 1} of ${pageCount}…`;
        await new Promise(r => setTimeout(r, 0));

        const spInfo = spreadOfPage.get(pi);
        let half;
        if (spInfo) {
          let entry = spreadCache.get(spInfo.index);
          if (!entry) {
            const halves = await this._renderSpreadPlates(spreads[spInfo.index], readerSpreadIds);
            entry = { halves, lastSide: si };
            spreadCache.set(spInfo.index, entry);
          }
          entry.lastSide = si;
          half = entry.halves[spInfo.role];
        } else {
          half = await this._renderPagePlates(pageOrder, pi);
        }
        if (half) pagePlates.set(pi, half);
      }

      // Compose, encode and download each ink for this side. Inks with no
      // content on this side still download as blank white sheets, keeping
      // the per-ink file set complete for print shops.
      for (const color of colors) {
        if (this._cancelRequested) return this._reportCancelled(prog, done, bytes);
        const colorName = RISO_COLORS.find(c => c.hex === color)?.name || color;
        prog.textContent = `Sheet ${si + 1} of ${plan.length} — ${colorName} ink…`;

        const sideCanvas = renderSheetSide(side, i => pagePlates.get(i)?.get(color) || null);
        const blob = await sideCanvas.convertToBlob({ type: 'image/png' });
        bytes += blob.size;
        const colorSlug = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${projectSlug}-${colorSlug}-sheet-${si + 1}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        await new Promise(r => setTimeout(r, 400));
        done += 1;
        prog.advance(1, { bytes });
      }

      // Release this side's page plates, and spread halves that were last
      // used on a previous side (a spread never reaches later sheets).
      pagePlates.clear();
      for (const [k, entry] of spreadCache) {
        if (entry.lastSide < si) spreadCache.delete(k);
      }
    }

    for (const l of State.layers) { l._dirty = true; }
    Renderer.schedule();

    prog.finish(`Done! ${done} sheets — ${plan.length} sides × ${colors.length} inks · ${pageCount} pages · ${scan.totalLayers} layers · ${formatBytes(bytes)} · ${formatDuration(performance.now() - startedAt)}`);
    appendKofiNotice(prog.element || prog);
    closeWindowAfterExport();
  },

  // Render one reader page's plates (every ink) from its own layers,
  // releasing the hydrated layer bitmaps before returning.
  async _renderPagePlates(pageOrder, pageIndex) {
    const pid = pageOrder[pageIndex];
    const page = await DB.get('pages', pid);
    const layers = await PageManager.loadPageLayers(pid);
    const plates = await this.exportLayers(layers, page?.width || CANVAS_W, page?.height || CANVAS_H);
    for (const l of layers) {
      l._originalCanvas = null;
      l._processedCanvas = null;
      l._maskCanvas = null;
      l._svgImage = null;
      l.separationPlates?.clear();
    }
    return plates;
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
      for (const rec of recs) {
        // Mirror exportLayers' filters: invisible layers and mask layers
        // (rendered as part of their base layer) contribute no ink.
        if (!rec.visible || rec.isMaskFor) continue;
        for (const c of this._plateColorsOfRecord(rec)) {
          if (!c || c === '#FFFFFF' || seen.has(c)) continue;
          seen.add(c);
          colors.push(c);
        }
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

  _reportCancelled(prog, done, bytes) {
    for (const l of State.layers) { l._dirty = true; }
    Renderer.schedule();
    prog.finish(`Export cancelled — ${done} sheet${done === 1 ? '' : 's'} saved${bytes ? ` (${formatBytes(bytes)})` : ''}.`);
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
        prog.textContent = label
          ? `${label}: blending layer ${li + 1} / ${visibleLayers.length}…`
          : `Blending layer ${li + 1} / ${visibleLayers.length}…`;
        await new Promise(r => setTimeout(r, 0));
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
  // rule as _buildBookletPagePlates. Shared by _exportCompositeBooklet and the
  // e2e harness.
  async _buildBookletPageComposites(pageOrder, prog = null) {
    const spreads = computeSpreads(pageOrder, 'saddle-stitch');
    const readerSpreadIds = this._genuineReaderSpreadIds(pageOrder);
    const pageComposites = Array(pageOrder.length).fill(null);

    for (let si = 0; si < spreads.length; si++) {
      const spread = spreads[si];
      const leftPage = spread.leftPageId ? await DB.get('pages', spread.leftPageId) : null;
      const rightPage = spread.rightPageId ? await DB.get('pages', spread.rightPageId) : null;
      const leftWidth = leftPage?.width || 0;
      const rightWidth = rightPage?.width || 0;
      const pageHeight = Math.max(leftPage?.height || 0, rightPage?.height || 0);

      if (prog) {
        prog.textContent = `Loading spread ${si + 1} / ${spreads.length}…`;
        await new Promise(r => setTimeout(r, 0));
      }

      const leftLayers = leftPage ? await PageManager.loadPageLayers(leftPage.id) : [];
      const rightLayers = rightPage ? await PageManager.loadPageLayers(rightPage.id) : [];
      const spanning = readerSpreadIds.has(spread.id)
        && this._hasSpanningLayers(leftLayers, rightLayers, leftWidth);

      if (!spanning) {
        // Single pages: render each into its own page-sized canvas (cropped).
        if (leftPage) {
          const composite = await this._renderComposite(leftLayers, leftWidth, pageHeight, prog, `Page ${pageOrder.indexOf(leftPage.id) + 1}`);
          pageComposites[pageOrder.indexOf(leftPage.id)] = composite;
        }
        if (rightPage) {
          const composite = await this._renderComposite(rightLayers, rightWidth, pageHeight, prog, `Page ${pageOrder.indexOf(rightPage.id) + 1}`);
          pageComposites[pageOrder.indexOf(rightPage.id)] = composite;
        }
      } else {
        // Genuine reader spread: render combined and split across the fold.
        const spreadWidth = leftWidth + rightWidth;
        const layers = [...leftLayers];
        for (const l of rightLayers) {
          l.x += leftWidth;
          layers.push(l);
        }

        const spreadComposite = await this._renderComposite(layers, spreadWidth, pageHeight, prog, `Spread ${si + 1}`);
        if (leftPage) {
          const leftIdx = pageOrder.indexOf(leftPage.id);
          if (leftIdx !== -1) {
            const leftComposite = new OffscreenCanvas(leftWidth, pageHeight);
            leftComposite.getContext('2d').drawImage(spreadComposite, 0, 0, leftWidth, pageHeight, 0, 0, leftWidth, pageHeight);
            pageComposites[leftIdx] = leftComposite;
          }
        }
        if (rightPage) {
          const rightIdx = pageOrder.indexOf(rightPage.id);
          if (rightIdx !== -1) {
            const rightComposite = new OffscreenCanvas(rightWidth, pageHeight);
            rightComposite.getContext('2d').drawImage(spreadComposite, leftWidth, 0, rightWidth, pageHeight, 0, 0, rightWidth, pageHeight);
            pageComposites[rightIdx] = rightComposite;
          }
        }
      }

      // Release bitmaps for this spread to keep memory low.
      for (const l of [...leftLayers, ...rightLayers]) {
        l._originalCanvas = null;
        l._processedCanvas = null;
        l._maskCanvas = null;
        l._svgImage = null;
        l.separationPlates?.clear();
      }
    }

    return pageComposites;
  },

  async _exportCompositeBooklet({ prog, projectSlug, bookletLayout, targetSheetSize, customTargetW, customTargetH }) {
    // Render spreads rather than individual pages so layers that span the
    // center fold are preserved on both sides of the imposition.
    const pageOrder = State.project.pageOrder;
    const pageComposites = await this._buildBookletPageComposites(pageOrder, prog);

    prog.textContent = 'Imposing sheets…';
    await new Promise(r => setTimeout(r, 0));

    const outputCanvases = buildSheets(pageComposites, {
      binding: 'saddle-stitch',
      bookletLayout,
      targetSheetSize,
      customTargetW,
      customTargetH,
    });

    for (let si = 0; si < outputCanvases.length; si++) {
      prog.textContent = `Encoding sheet ${si + 1} / ${outputCanvases.length}…`;
      await new Promise(r => setTimeout(r, 0));
      const blob = await outputCanvases[si].convertToBlob({ type: 'image/png' });
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
