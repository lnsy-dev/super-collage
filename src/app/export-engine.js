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

export const ExportEngine = {
  // Renders a layer's sourceCanvas (processedCanvas or weightedCanvas) to a full-canvas
  // OffscreenCanvas, applying both painted mask (_maskCanvas) and image masks (imageMaskIds).
  async _renderLayerToBuffer(layer, sourceCanvas) {
    const buf = new OffscreenCanvas(CANVAS_W, CANVAS_H);
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
      const maskLayer = State.layers.find(l => l.id === maskId);
      if (!maskLayer) continue;
      const maskCanvas = await ImageProcessor.processLayer(maskLayer, { forExport: true });
      if (!maskCanvas) continue;
      const maskBuf = new OffscreenCanvas(CANVAS_W, CANVAS_H);
      const mCtx = maskBuf.getContext('2d');
      mCtx.save();
      mCtx.translate(maskLayer.x + maskLayer.width / 2, maskLayer.y + maskLayer.height / 2);
      mCtx.rotate(maskLayer.rotation * Math.PI / 180);
      mCtx.scale(maskLayer.flipH ? -1 : 1, maskLayer.flipV ? -1 : 1);
      mCtx.translate(-maskLayer.width / 2, -maskLayer.height / 2);
      mCtx.drawImage(maskCanvas, 0, 0, maskLayer.width, maskLayer.height);
      mCtx.restore();
      const maskImgData = mCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      const md = maskImgData.data;
      for (let i = 0; i < md.length; i += 4) md[i + 3] = 255 - md[i + 3];
      mCtx.putImageData(maskImgData, 0, 0);
      bCtx.globalCompositeOperation = 'destination-in';
      bCtx.drawImage(maskBuf, 0, 0);
    }
    return buf;
  },

  _tileCanvas(src, layout) {
    if (layout === '1up') return src;
    let cols, rows;
    if (layout === '8up') { cols = 4; rows = 2; }
    else if (layout === '4up') { cols = 2; rows = 2; }
    else { cols = 2; rows = 1; }
    const out = new OffscreenCanvas(CANVAS_W * cols, CANVAS_H * rows);
    const ctx = out.getContext('2d');
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        ctx.drawImage(src, c * CANVAS_W, r * CANVAS_H);
    return out;
  },

  async export() {
    const prog = document.getElementById('export-progress');
    // Exclude mask layers — they render as part of their paired base layer
    const visibleLayers = State.layers.filter(l => l.visible && !l.isMaskFor);
    if (!visibleLayers.length) return;

    // Build plate map: color → { solidLayers[], gradContributions[] }
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

    const colorEntries = [...plateMap.entries()];
    const projectSlug = document.getElementById('status-project').textContent
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    for (let ci = 0; ci < colorEntries.length; ci++) {
      const [color, plate] = colorEntries[ci];
      if (color === '#FFFFFF') continue; // white = no ink, skip plate
      const colorName = RISO_COLORS.find(c => c.hex === color)?.name || color;
      prog.textContent = `Rendering ${colorName} (${ci + 1}/${colorEntries.length})…`;
      await new Promise(r => setTimeout(r, 0));

      const ec = new OffscreenCanvas(CANVAS_W, CANVAS_H);
      const ctx = ec.getContext('2d');

      // Solid layers
      for (const layer of plate.solidLayers) {
        if (!layer._processedCanvas && !layer._originalCanvas) continue;
        const sourceCanvas = await ImageProcessor.processLayer(layer, { forExport: true }) || layer._processedCanvas;
        if (!sourceCanvas) continue;
        ctx.drawImage(await this._renderLayerToBuffer(layer, sourceCanvas), 0, 0);
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
        ctx.drawImage(await this._renderLayerToBuffer(layer, scaled), 0, 0);
      }

      // Gradient / pattern layer contributions (weighted by color dominance)
      for (const { layer, stopIdx } of plate.gradContributions) {
        if (!layer._processedCanvas && !layer._originalCanvas) continue;
        const sourceCanvas = await ImageProcessor.processLayer(layer, { forExport: true }) || layer._processedCanvas;
        if (!sourceCanvas) continue;
        const nw = layer.naturalWidth, nh = layer.naturalHeight;
        const weightMap = layer.colorMode === 'pattern' && layer.pattern
          ? buildPatternWeightMap(nw, nh, layer.pattern, stopIdx)
          : buildGradientWeightMap(nw, nh, layer.gradient, stopIdx);
        // Create weight-modulated copy of processed canvas
        const weightedCanvas = new OffscreenCanvas(nw, nh);
        const wCtx = weightedCanvas.getContext('2d', { willReadFrequently: true });
        wCtx.drawImage(sourceCanvas, 0, 0);
        const imgData = wCtx.getImageData(0, 0, nw, nh);
        const d = imgData.data;
        for (let i = 0; i < nw * nh; i++) {
          d[i*4 + 3] = Math.round(d[i*4 + 3] * weightMap[i]);
        }
        wCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(await this._renderLayerToBuffer(layer, weightedCanvas), 0, 0);
      }

      // Remap to greyscale ink on white (solid layers stay binary; gradients get smooth greyscale)
      const imgData = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const grey = 255 - d[i+3];
        d[i] = grey; d[i+1] = grey; d[i+2] = grey; d[i+3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);

      const layout = document.querySelector('input[name="export-layout"]:checked')?.value || '1up';
      const tiled = this._tileCanvas(ec, layout);
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

    // Restore display-resolution caches after export
    for (const l of State.layers) { l._dirty = true; }
    Renderer.schedule();

    prog.textContent = `Done! ${colorEntries.length} plate(s) exported.`;
    appendKofiNotice(prog);
    document.getElementById('btn-export-go').disabled = false;
  },

  async exportComposite() {
    const prog = document.getElementById('composite-export-progress');
    // Start with white paper
    let accumulator = new Uint8Array(CANVAS_W * CANVAS_H * 4).fill(255);

    // Exclude mask layers — they render as part of their paired base layer
    const visibleLayers = State.layers.filter(l => l.visible && !l.isMaskFor && (l._processedCanvas || l._originalCanvas || l.isColorSeparation || l.isText));
    for (let li = 0; li < visibleLayers.length; li++) {
      const layer = visibleLayers[li];
      prog.textContent = `Blending layer ${li + 1} / ${visibleLayers.length}…`;
      await new Promise(r => setTimeout(r, 0));

      const sourceCanvas = await ImageProcessor.processLayer(layer, { forExport: true }) || layer._processedCanvas;
      if (!sourceCanvas) continue;
      const layerBuf = await this._renderLayerToBuffer(layer, sourceCanvas);
      const layerData = layerBuf.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H);
      accumulator = window.blendSubtractive(accumulator, new Uint8Array(layerData.data.buffer));
    }

    prog.textContent = 'Encoding PNG…';
    await new Promise(r => setTimeout(r, 0));

    const outCanvas = new OffscreenCanvas(CANVAS_W, CANVAS_H);
    const outCtx = outCanvas.getContext('2d');
    const imgData = new ImageData(new Uint8ClampedArray(accumulator.buffer), CANVAS_W, CANVAS_H);
    outCtx.putImageData(imgData, 0, 0);
    const compositeLayout = document.querySelector('input[name="composite-layout"]:checked')?.value || '1up';
    const tiledComposite = this._tileCanvas(outCanvas, compositeLayout);
    const blob = await tiledComposite.convertToBlob({ type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const projectSlug = document.getElementById('status-project').textContent.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const compositeLayoutSuffix = compositeLayout !== '1up' ? `-${compositeLayout}` : '';
    a.href = url; a.download = `${projectSlug}-composite${compositeLayoutSuffix}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    // Restore display-resolution caches after export
    for (const l of State.layers) { l._dirty = true; }
    Renderer.schedule();

    prog.textContent = 'Done!';
    appendKofiNotice(prog);
    document.getElementById('btn-composite-go').disabled = false;
  },
};
