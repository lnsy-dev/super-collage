/* ═══════════════════════════════════════════════════════════════════
   Export Engine
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { CANVAS_W, CANVAS_H, RISO_COLORS } from './constants.js';
import { ImageProcessor, buildGradientWeightMap, buildPatternWeightMap } from './image-processor.js';
import { DB } from './db.js';
import { hexToRgb } from '../utils/color.js';
import { Renderer } from './renderer.js';
import { appendKofiNotice } from './ui.js';
import { buildSheets } from './imposition.js';
import { PageManager } from './page-manager.js';
import { computeViewUnits, computeSpreads } from './spread-manager.js';

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
      if (!plateMap.has(hex)) plateMap.set(hex, { solidLayers: [], gradContributions: [], separationLayers: [] });
      return plateMap.get(hex);
    };
    for (const l of visibleLayers) {
      if (l.isColorSeparation) {
        for (const colorHex of l.separationColors) {
          ensurePlate(colorHex).separationLayers.push({ layer: l, color: colorHex });
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
    const prog = document.getElementById('export-progress');
    const btn = document.getElementById('btn-export-go');
    try {
      const projectSlug = document.getElementById('status-project').textContent
        .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const layout = document.querySelector('input[name="export-layout"]:checked')?.value || '1up';
      const binding = document.querySelector('input[name="export-binding"]:checked')?.value || 'saddle-stitch';
      const bookletLayout = document.querySelector('input[name="export-booklet-layout"]:checked')?.value || 'folio';
      const targetSheetSize = document.getElementById('export-target-size')?.value || 'letter';
      const customW = parseFloat(document.getElementById('export-custom-width')?.value || '0') * 600;
      const customH = parseFloat(document.getElementById('export-custom-height')?.value || '0') * 600;

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

      const plateMap = await this.exportLayers(State.layers, CANVAS_W, CANVAS_H);
      const colorEntries = [...plateMap.entries()];
      const spreadInfo = this._getSpreadSplitInfo();

      for (let ci = 0; ci < colorEntries.length; ci++) {
        const [color, canvas] = colorEntries[ci];
        const colorName = RISO_COLORS.find(c => c.hex === color)?.name || color;
        prog.textContent = `Rendering ${colorName} (${ci + 1}/${colorEntries.length})…`;
        await new Promise(r => setTimeout(r, 0));

        if (spreadInfo) {
          const { left, right } = this._splitCanvasByWidth(canvas, spreadInfo.leftWidth);
          const colorSlug = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          const leftSlug = spreadInfo.leftPage.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          const rightSlug = spreadInfo.rightPage.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

          for (const [side, sideCanvas, sideSlug, sideDims] of [
            ['left', left, leftSlug, { w: spreadInfo.leftWidth, h: spreadInfo.leftPage.height }],
            ['right', right, rightSlug, { w: spreadInfo.rightWidth, h: spreadInfo.rightPage.height }],
          ]) {
            const tiled = this._tileCanvas(sideCanvas, layout, sideDims.w, sideDims.h);
            const blob = await tiled.convertToBlob({ type: 'image/png' });
            const layoutSuffix = layout !== '1up' ? `-${layout}` : '';
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${projectSlug}-${sideSlug}-${colorSlug}${layoutSuffix}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            await new Promise(r => setTimeout(r, 400));
          }
        } else {
          const tiled = this._tileCanvas(canvas, layout, CANVAS_W, CANVAS_H);
          const blob = await tiled.convertToBlob({ type: 'image/png' });
          const colorSlug = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          const layoutSuffix = layout !== '1up' ? `-${layout}` : '';
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `${projectSlug}-${colorSlug}${layoutSuffix}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          await new Promise(r => setTimeout(r, 400));
        }
      }

      for (const l of State.layers) { l._dirty = true; }
      Renderer.schedule();

      prog.textContent = `Done! ${colorEntries.length} plate(s) exported.`;
      appendKofiNotice(prog);
    } catch (err) {
      console.error('Export failed:', err);
      prog.textContent = `Export failed: ${err.message}`;
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
  // both exportBooklet (production downloads) and the e2e harness so the
  // spanning/crop behaviour is exercised in one place.
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
        // Single pages (or non-spread printer pairs): render each page into its
        // own page-sized canvas so content is cropped at the page edge.
        if (leftPage) {
          const plateMap = await this.exportLayers(leftLayers, leftWidth, pageHeight);
          for (const [color, canvas] of plateMap.entries()) {
            ensurePagePlate(color)[pageOrder.indexOf(leftPage.id)] = canvas;
          }
        }
        if (rightPage) {
          const plateMap = await this.exportLayers(rightLayers, rightWidth, pageHeight);
          for (const [color, canvas] of plateMap.entries()) {
            ensurePagePlate(color)[pageOrder.indexOf(rightPage.id)] = canvas;
          }
        }
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
        for (const [color, spreadCanvas] of spreadPlateMap.entries()) {
          const plates = ensurePagePlate(color);
          if (leftPage) {
            const leftIdx = pageOrder.indexOf(leftPage.id);
            if (leftIdx !== -1) {
              const leftPlate = new OffscreenCanvas(leftWidth, pageHeight);
              leftPlate.getContext('2d').drawImage(spreadCanvas, 0, 0, leftWidth, pageHeight, 0, 0, leftWidth, pageHeight);
              plates[leftIdx] = leftPlate;
            }
          }
          if (rightPage) {
            const rightIdx = pageOrder.indexOf(rightPage.id);
            if (rightIdx !== -1) {
              const rightPlate = new OffscreenCanvas(rightWidth, pageHeight);
              rightPlate.getContext('2d').drawImage(spreadCanvas, leftWidth, 0, rightWidth, pageHeight, 0, 0, rightWidth, pageHeight);
              plates[rightIdx] = rightPlate;
            }
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

    return colorPages;
  },

  async exportBooklet({ prog, projectSlug, layout, binding, bookletLayout, targetSheetSize, customTargetW, customTargetH }) {
    // Render spreads rather than individual pages so layers that span the
    // center fold are preserved on both sides of the imposition. Page plates
    // are collected in reader order (pageOrder) so buildSheets imposes them
    // correctly.
    const pageOrder = State.project.pageOrder;
    const colorPages = await this._buildBookletPagePlates(pageOrder, prog);
    const colorEntries = [...colorPages.entries()];

    for (let ci = 0; ci < colorEntries.length; ci++) {
      const [color, pages] = colorEntries[ci];
      const colorName = RISO_COLORS.find(c => c.hex === color)?.name || color;
      prog.textContent = `Imposing ${colorName} (${ci + 1}/${colorEntries.length})…`;
      await new Promise(r => setTimeout(r, 0));

      const outputCanvases = buildSheets(pages, {
        binding: 'saddle-stitch',
        bookletLayout,
        targetSheetSize,
        customTargetW,
        customTargetH,
      });

      for (let si = 0; si < outputCanvases.length; si++) {
        const blob = await outputCanvases[si].convertToBlob({ type: 'image/png' });
        const colorSlug = colorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectSlug}-${colorSlug}-sheet-${si + 1}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        await new Promise(r => setTimeout(r, 400));
      }
    }

    for (const l of State.layers) { l._dirty = true; }
    Renderer.schedule();

    prog.textContent = `Done! ${colorEntries.length} color(s) exported.`;
    appendKofiNotice(prog);
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
