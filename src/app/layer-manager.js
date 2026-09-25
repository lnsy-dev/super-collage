/* ═══════════════════════════════════════════════════════════════════
   Layer Manager
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { Layer } from './layer.js';
import { ImageProcessor } from './image-processor.js';
import { Renderer } from './renderer.js';
import { hexToRgb } from '../utils/color.js';
import { RISO_COLORS, CANVAS_W, CANVAS_H } from './constants.js';
import { UI } from './ui.js';
import { MaskEngine } from './mask-engine.js';
import { renderShapeLayerBitmap, isTwoToneShape, effectiveShapeColor, rerenderShapeLayer } from './shape-utils.js';
import { pushUndoState, pushUndoWithMask } from './undo.js';
import { PageManager } from './page-manager.js';
import { computeViewUnits } from './spread-manager.js';
import { ProjectIO } from './project-io.js';

export const LayerManager = {
  async addText(defaultText, x, y, w, h, { textMode = 'box' } = {}) {
    pushUndoState();
    const layer = new Layer({
      name: 'Text',
      isText: true,
      textMode,
      text: defaultText,
      x, y, width: w, height: h,
      naturalWidth: w, naturalHeight: h,
    });
    layer._dirty = true;

    State.layers.push(layer);
    State.selectedId = layer.id;
    State.selectedIds = [layer.id];

    await DB.put('layers', layer.toRecord());
    await PageManager.saveActivePage();

    document.getElementById('no-layer-msg').style.display = 'none';
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
    return layer;
  },

  // Creates a shape layer from tool state + the given shape properties
  // (shapeStrokeWidth is expected in DOCUMENT pixels — see events.js),
  // renders its bitmap from geometry, and persists it.
  async addShape(shapeProps = {}, x, y, w, h) {
    pushUndoState();
    const toolNames = {
      'shape-rect': 'Rectangle', 'shape-ellipse': 'Ellipse',
      'shape-poly': State.shapeIsStar ? 'Star' : 'Polygon',
    };
    const layer = new Layer({
      name: toolNames[State.tool] || 'Shape',
      x, y, width: w, height: h,
      naturalWidth: w, naturalHeight: h,
      isShape: true,
      shapeType: State.tool,
      shapeHasFill: shapeProps.shapeHasFill ?? State.shapeMode !== 'outline',
      shapeHasStroke: shapeProps.shapeHasStroke ?? State.shapeMode === 'outline',
      shapeStrokeWidth: shapeProps.shapeStrokeWidth ?? Math.max(1, State.shapeStrokeWidth / State.zoom),
      shapeStrokeColor: '#010101',
      shapeFillColor: '#010101',
      shapeSides: shapeProps.shapeSides ?? State.shapeSides,
      shapeIsStar: shapeProps.shapeIsStar ?? State.shapeIsStar,
      shapeStarRatio: shapeProps.shapeStarRatio ?? State.shapeStarRatio,
    });
    layer._originalCanvas = renderShapeLayerBitmap(layer);
    MaskEngine.initMask(layer);
    State.layers.push(layer);
    State.selectedId = layer.id;
    State.selectedIds = [layer.id];
    const blob = await layer._originalCanvas.convertToBlob({ type: 'image/png' });
    await DB.put('layers', layer.toRecord());
    await DB.put('imageBlobs', { layerId: layer.id, blob });
    await DB.put('maskBlobs', { layerId: layer.id, blob: await layer._maskCanvas.convertToBlob({ type: 'image/png' }) });
    await PageManager.saveActivePage();
    document.getElementById('no-layer-msg').style.display = 'none';
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  async addFromFile(file) {
    pushUndoState();
    // Use the active page's dimensions for scaling/centering so layers imported
    // in spread view are positioned relative to their page, not the spread canvas.
    const activePage = State.pages?.find(p => p.id === State.pageId);
    const pageW = activePage ? activePage.width : CANVAS_W;
    const pageH = activePage ? activePage.height : CANVAS_H;

    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
    if (isSvg) {
      const text = await file.text();
      const svgBlob = new Blob([text], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      URL.revokeObjectURL(url);
      // Browser intrinsic size is at 96 DPI; scale to document 600 DPI
      const dpiScale = 600 / 96;
      const nw = Math.round(img.naturalWidth * dpiScale);
      const nh = Math.round(img.naturalHeight * dpiScale);
      const scale = Math.min(1, pageW / nw, pageH / nh);
      const w = Math.round(nw * scale), h = Math.round(nh * scale);
      const layer = new Layer({
        name: file.name.replace(/\.[^.]+$/, ''),
        x: Math.round((pageW - w) / 2),
        y: Math.round((pageH - h) / 2),
        width: w, height: h,
        naturalWidth: nw, naturalHeight: nh,
        isSvg: true,
      });
      layer._svgImage = img;
      layer._svgText = text;
      MaskEngine.initMask(layer);

      State.layers.push(layer);
      State.selectedId = layer.id;
      State.selectedIds = [layer.id];

      await DB.put('layers', layer.toRecord());
      await DB.put('imageBlobs', { layerId: layer.id, blob: file });
      await DB.put('maskBlobs', { layerId: layer.id, blob: await layer._maskCanvas.convertToBlob({ type: 'image/png' }) });
      await PageManager.saveActivePage();

      document.getElementById('no-layer-msg').style.display = 'none';
      UI.refreshLayerList();
      UI.refreshProperties();
      Renderer.schedule();
      return;
    }

    const bmp = await createImageBitmap(file);
    const nw = bmp.width, nh = bmp.height;
    const scale = Math.min(1, pageW / nw, pageH / nh);
    const w = Math.round(nw * scale), h = Math.round(nh * scale);
    const layer = new Layer({
      name: file.name.replace(/\.[^.]+$/, ''),
      x: Math.round((pageW - w) / 2),
      y: Math.round((pageH - h) / 2),
      width: w, height: h,
      naturalWidth: nw, naturalHeight: nh,
    });
    const orig = new OffscreenCanvas(nw, nh);
    const ctx = orig.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, nw, nh);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    layer._originalCanvas = orig;
    MaskEngine.initMask(layer);

    State.layers.push(layer);
    State.selectedId = layer.id;
    State.selectedIds = [layer.id];

    await DB.put('layers', layer.toRecord());
    await DB.put('imageBlobs', { layerId: layer.id, blob: file });
    await DB.put('maskBlobs', { layerId: layer.id, blob: await layer._maskCanvas.convertToBlob({ type: 'image/png' }) });
    await PageManager.saveActivePage();

    document.getElementById('no-layer-msg').style.display = 'none';
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  async addColorSeparation(file) {
    pushUndoState();
    const MAX_SEP_DIM = 1500; // cap decomposition resolution for speed

    const dialog = document.getElementById('color-sep-loading-dialog');
    const statusEl = document.getElementById('color-sep-status');
    const previewEl = document.getElementById('color-sep-preview');

    // Show preview
    const previewUrl = URL.createObjectURL(file);
    previewEl.src = previewUrl;
    previewEl.style.display = 'block';
    statusEl.textContent = 'Preparing image…';
    dialog.classList.remove('hidden');

    // Let browser paint the modal before heavy work
    await new Promise(r => setTimeout(r, 50));

    try {
      const bmp = await createImageBitmap(file);
      const origW = bmp.width, origH = bmp.height;
      const scale = Math.min(1, CANVAS_W / origW, CANVAS_H / origH);
      const w = Math.round(origW * scale), h = Math.round(origH * scale);

      // Cap source resolution for decomposition to keep WASM fast
      let srcW = origW, srcH = origH;
      if (Math.max(srcW, srcH) > MAX_SEP_DIM) {
        const ds = MAX_SEP_DIM / Math.max(srcW, srcH);
        srcW = Math.round(srcW * ds);
        srcH = Math.round(srcH * ds);
      }

      statusEl.textContent = `Decomposing ${srcW}×${srcH} into riso plates…`;
      await new Promise(r => setTimeout(r, 10));

      // Extract RGBA data at capped resolution
      const sourceCanvas = new OffscreenCanvas(srcW, srcH);
      const sCtx = sourceCanvas.getContext('2d');
      sCtx.fillStyle = 'white';
      sCtx.fillRect(0, 0, srcW, srcH);
      sCtx.drawImage(bmp, 0, 0, srcW, srcH);
      bmp.close();
      const imageData = sCtx.getImageData(0, 0, srcW, srcH);

      // Build riso color array (exclude white)
      const risoColors = [];
      for (const rc of RISO_COLORS) {
        if (rc.hex === '#FFFFFF') continue;
        const { r, g, b } = hexToRgb(rc.hex);
        risoColors.push(r, g, b);
      }

      // Run WASM decomposition using pre-built LUT (fast, non-blocking)
      const numColors = RISO_COLORS.filter(c => c.hex !== '#FFFFFF').length;
      const plateBuffer = window.separateColorsWithLut(imageData.data, srcW, srcH, window.colorSepLut, 16, numColors);
      const pixelCount = srcW * srcH;
      const numPlates = RISO_COLORS.length - 1; // exclude white

      statusEl.textContent = 'Building plates…';
      await new Promise(r => setTimeout(r, 10));

      const separationColors = RISO_COLORS.filter(c => c.hex !== '#FFFFFF').map(c => c.hex);
      const separationPlates = new Map();

      for (let i = 0; i < numPlates; i++) {
        const plateCanvas = new OffscreenCanvas(srcW, srcH);
        const pCtx = plateCanvas.getContext('2d');
        const plateData = new ImageData(
          new Uint8ClampedArray(plateBuffer.buffer, i * pixelCount * 4, pixelCount * 4),
          srcW, srcH
        );
        pCtx.putImageData(plateData, 0, 0);
        separationPlates.set(separationColors[i], plateCanvas);
      }

      const layer = new Layer({
        name: 'Sep: ' + file.name.replace(/\.[^.]+$/, ''),
        x: Math.round((CANVAS_W - w) / 2),
        y: Math.round((CANVAS_H - h) / 2),
        width: w, height: h,
        naturalWidth: srcW, naturalHeight: srcH,
        isColorSeparation: true,
        separationColors,
        halftoneType: 'grayscale',
        halftoneSize: 12,
        halftoneAngle: 45,
      });
      layer.separationPlates = separationPlates;
      // Store source image so we can rebuild plates on load
      layer._originalCanvas = sourceCanvas;
      MaskEngine.initMask(layer);

      State.layers.push(layer);
      State.selectedId = layer.id;
      State.selectedIds = [layer.id];

      await DB.put('layers', layer.toRecord());
      await DB.put('imageBlobs', { layerId: layer.id, blob: file });
      await DB.put('maskBlobs', { layerId: layer.id, blob: await layer._maskCanvas.convertToBlob({ type: 'image/png' }) });
      await PageManager.saveActivePage();

      document.getElementById('no-layer-msg').style.display = 'none';
      UI.refreshLayerList();
      UI.refreshProperties();
      Renderer.schedule();
    } finally {
      dialog.classList.add('hidden');
      previewEl.style.display = 'none';
      previewEl.src = '';
      URL.revokeObjectURL(previewUrl);
    }
  },

  /**
   * Rebuild a decoded image blob at a layer's natural size (white base +
   * downscaled draw), the same way PageManager.hydrateLayer restores
   * _originalCanvas from a stored imageBlobs record.
   */
  async _originalCanvasFromBlob(blob, layer) {
    const bmp = await createImageBitmap(blob);
    const w = layer.naturalWidth, h = layer.naturalHeight;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return canvas;
  },

  /**
   * Rebuild color-separation plates from a freshly imported layer's
   * _originalCanvas (mirrors PageManager._rebuildSeparationPlates).
   */
  _rebuildImportedSeparationPlates(layer) {
    const source = layer._originalCanvas;
    if (!source) return;
    const sCtx = source.getContext('2d');
    const nw = source.width, nh = source.height;
    const imageData = sCtx.getImageData(0, 0, nw, nh);
    const risoColors = [];
    for (const rc of RISO_COLORS) {
      if (rc.hex === '#FFFFFF') continue;
      const { r, g, b } = hexToRgb(rc.hex);
      risoColors.push(r, g, b);
    }
    const numColors = RISO_COLORS.filter(c => c.hex !== '#FFFFFF').length;
    const plateBuffer = window.separateColorsWithLut(imageData.data, nw, nh, window.colorSepLut, 16, numColors);
    const pixelCount = nw * nh;
    const numPlates = RISO_COLORS.length - 1;
    const separationColors = RISO_COLORS.filter(c => c.hex !== '#FFFFFF').map(c => c.hex);
    layer.separationPlates = new Map();
    for (let i = 0; i < numPlates; i++) {
      const plateCanvas = new OffscreenCanvas(nw, nh);
      const pCtx = plateCanvas.getContext('2d');
      const plateData = new ImageData(
        new Uint8ClampedArray(plateBuffer.buffer, i * pixelCount * 4, pixelCount * 4),
        nw, nh
      );
      pCtx.putImageData(plateData, 0, 0);
      layer.separationPlates.set(separationColors[i], plateCanvas);
    }
  },

  /**
   * Import Menu Project: rebuild a downloaded project zip's FIRST page as
   * layers on the CURRENT page. Every imported layer gets a fresh id, the
   * current project/page, one shared importedGroupId, and symmetric
   * all-pairs linkedIds so the whole group moves/scales as a unit until it
   * is split apart. The group is scaled (only if oversized) and centered on
   * the canvas like an imported image; naturalWidth/naturalHeight are left
   * untouched. Invalid or empty zips alert and add nothing.
   */
  async importProjectAsLayers(file) {
    // Parse first — invalid zips must not touch state.
    let parsed;
    try {
      parsed = await ProjectIO.parseZip(file);
    } catch (err) {
      console.error(err);
      alert('Could not import project: ' + (err?.message || 'not a Super Collage project file.'));
      return [];
    }

    const srcPages = parsed.pages || [];
    const firstPage = srcPages[0] || null;
    let pageLayers = firstPage
      ? parsed.layerEntries.filter(e => e.record.pageId === firstPage.id)
      : [];
    if (!pageLayers.length && parsed.layerEntries.length) {
      // Degenerate manifest (layers without a matching page record) —
      // import everything rather than nothing.
      pageLayers = parsed.layerEntries;
    }
    if (!pageLayers.length) {
      alert('That project has no layers on its first page — nothing to import.');
      return [];
    }

    pushUndoState();

    // Progress modal, same pattern as color separation.
    const dialog = document.getElementById('color-sep-loading-dialog');
    const statusEl = document.getElementById('color-sep-status');
    const previewEl = document.getElementById('color-sep-preview');
    if (dialog && statusEl) {
      if (previewEl) previewEl.style.display = 'none';
      statusEl.textContent = 'Importing project as layers…';
      dialog.classList.remove('hidden');
      await new Promise(r => setTimeout(r, 50));
    }

    const importedGroupId = crypto.randomUUID();
    const imported = [];
    try {
      // Fit + center the source group's bounding box on the current canvas,
      // exactly like an oversized imported image is handled. Natural sizes
      // are deliberately not scaled.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const e of pageLayers) {
        const r = e.record;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }
      const fit = Math.min(1, CANVAS_W / (maxX - minX), CANVAS_H / (maxY - minY));
      const offX = (CANVAS_W - (maxX - minX) * fit) / 2 - minX * fit;
      const offY = (CANVAS_H - (maxY - minY) * fit) / 2 - minY * fit;

      const idMap = new Map();
      const idOf = srcId => {
        if (!idMap.has(srcId)) idMap.set(srcId, crypto.randomUUID());
        return idMap.get(srcId);
      };
      const projectId = State.project.id;
      const pageId = State.pageId;

      for (const e of pageLayers) {
        const src = e.record;
        const layer = new Layer({
          ...src,
          id: idOf(src.id),
          projectId,
          pageId,
          x: src.x * fit + offX,
          y: src.y * fit + offY,
          width: src.width * fit,
          height: src.height * fit,
          name: src.name || 'Imported Layer',
          importedGroupId,
          linkedIds: [],
        });
        layer._importedImageBlob = e.imageBlob || null;

        if (!layer.isText && e.imageBlob) {
          if (layer.isSvg) {
            const text = await e.imageBlob.text();
            layer._svgText = text;
            const svgBlob = new Blob([text], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(svgBlob);
            const img = new Image();
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
            URL.revokeObjectURL(url);
            layer._svgImage = img;
          } else {
            layer._originalCanvas = await this._originalCanvasFromBlob(e.imageBlob, layer);
            if (layer.isColorSeparation) this._rebuildImportedSeparationPlates(layer);
          }
        }

        if (e.maskBlob) {
          await MaskEngine.loadMask(layer, e.maskBlob);
        } else {
          MaskEngine.initMask(layer);
        }

        imported.push(layer);
      }

      // Remap in-group mask relationships to the fresh ids.
      for (const layer of imported) {
        layer.imageMaskIds = (layer.imageMaskIds || []).map(id => idMap.get(id)).filter(Boolean);
        layer.isMaskFor = layer.isMaskFor ? (idMap.get(layer.isMaskFor) || null) : null;
      }

      // Symmetric all-pairs linking so the whole group moves/scales as one.
      for (const layer of imported) {
        layer.linkedIds = imported.filter(m => m.id !== layer.id).map(m => m.id);
      }

      for (const layer of imported) {
        State.layers.push(layer);
      }
      State.selectedId = imported[imported.length - 1].id;
      State.selectedIds = imported.map(l => l.id);

      for (const layer of imported) {
        layer._dirty = true;
        await DB.put('layers', layer.toRecord());
        if (!layer.isText && layer._importedImageBlob) {
          await DB.put('imageBlobs', { layerId: layer.id, blob: layer._importedImageBlob });
        }
        await DB.saveMask(layer); // text layers have no _maskCanvas: no-op
      }

      await PageManager.saveActivePage();
      document.getElementById('no-layer-msg').style.display = 'none';
      UI.refreshLayerList();
      UI.refreshProperties();
      Renderer.schedule();
    } finally {
      if (dialog) dialog.classList.add('hidden');
      if (previewEl) {
        previewEl.style.display = 'none';
        previewEl.src = '';
      }
    }

    return imported.map(l => l.id);
  },

  async delete(layerId) {
    pushUndoState();
    const idx = State.layers.findIndex(l => l.id === layerId);
    if (idx === -1) return;
    const toDelete = State.layers[idx];
    // Clean up mask relationships on the paired layer(s)
    for (const maskId of (toDelete.imageMaskIds || [])) {
      const maskLayer = State.layers.find(l => l.id === maskId);
      if (maskLayer) { maskLayer.isMaskFor = null; await DB.saveLayer(maskLayer); }
    }
    if (toDelete.isMaskFor) {
      const baseLayer = State.layers.find(l => l.id === toDelete.isMaskFor);
      if (baseLayer) {
        baseLayer.imageMaskIds = (baseLayer.imageMaskIds || []).filter(id => id !== toDelete.id);
        await DB.saveLayer(baseLayer);
      }
    }
    State.layers.splice(idx, 1);
    // Remove this layer from any remaining layers' link lists.
    for (const l of State.layers) {
      if ((l.linkedIds || []).includes(layerId)) {
        l.linkedIds = l.linkedIds.filter(id => id !== layerId);
        await DB.saveLayer(l);
      }
    }
    if (State.selectedId === layerId) {
      State.selectedId = State.layers[Math.min(idx, State.layers.length - 1)]?.id || null;
      State.selectedIds = State.selectedId ? [State.selectedId] : [];
    } else {
      State.selectedIds = State.selectedIds.filter(id => id !== layerId);
    }
    await DB.del('layers', layerId);
    await DB.del('imageBlobs', layerId);
    await DB.del('maskBlobs', layerId);
    await PageManager.saveActivePage();
    if (!State.layers.length) document.getElementById('no-layer-msg').style.display = '';
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  async duplicate(layerId) {
    pushUndoState();
    const src = State.layers.find(l => l.id === layerId);
    if (!src) return;

    const layer = new Layer({ ...src.toRecord(), id: undefined, name: src.name + ' copy', x: src.x + 20, y: src.y + 20, linkedIds: [] });

    if (src.isText) {
      // Text layers have no image blob — just mark dirty so the renderer re-renders text
      layer._dirty = true;
      MaskEngine.initMask(layer);
    } else {
      const imgRec = await DB.get('imageBlobs', layerId);
      if (!imgRec) return;

      const bmp = await createImageBitmap(imgRec.blob);
      const orig = new OffscreenCanvas(layer.naturalWidth, layer.naturalHeight);
      const ctx = orig.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, layer.naturalWidth, layer.naturalHeight);
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      layer._originalCanvas = orig;

      // Rebuild separation plates for color separation layers
      if (src.isColorSeparation) {
        const imageData = orig.getContext('2d').getImageData(0, 0, layer.naturalWidth, layer.naturalHeight);
        const numColors = RISO_COLORS.filter(c => c.hex !== '#FFFFFF').length;
        const plateBuffer = window.separateColorsWithLut(imageData.data, layer.naturalWidth, layer.naturalHeight, window.colorSepLut, 16, numColors);
        const pixelCount = layer.naturalWidth * layer.naturalHeight;
        const numPlates = numColors;
        const separationColors = RISO_COLORS.filter(c => c.hex !== '#FFFFFF').map(c => c.hex);
        for (let i = 0; i < numPlates; i++) {
          const plateCanvas = new OffscreenCanvas(layer.naturalWidth, layer.naturalHeight);
          const pCtx = plateCanvas.getContext('2d');
          pCtx.putImageData(new ImageData(
            new Uint8ClampedArray(plateBuffer.buffer, i * pixelCount * 4, pixelCount * 4),
            layer.naturalWidth, layer.naturalHeight
          ), 0, 0);
          layer.separationPlates.set(separationColors[i], plateCanvas);
        }
      }

      if (src._maskCanvas) {
        const mc = new OffscreenCanvas(layer.naturalWidth, layer.naturalHeight);
        mc.getContext('2d').drawImage(src._maskCanvas, 0, 0);
        layer._maskCanvas = mc;
      } else {
        MaskEngine.initMask(layer);
      }

      await DB.put('imageBlobs', { layerId: layer.id, blob: imgRec.blob });
      await DB.put('maskBlobs', { layerId: layer.id, blob: await layer._maskCanvas.convertToBlob({ type: 'image/png' }) });
    }

    const insertIdx = State.layers.findIndex(l => l.id === layerId);
    State.layers.splice(insertIdx + 1, 0, layer);
    State.selectedId = layer.id;
    State.selectedIds = [layer.id];
    await DB.put('layers', layer.toRecord());
    await PageManager.saveActivePage();
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  async splitColorSeparation(layerId) {
    pushUndoState();
    const src = State.layers.find(l => l.id === layerId);
    if (!src || !src.isColorSeparation) return;

    // Clean up mask relationships the same way delete() does.
    for (const maskId of (src.imageMaskIds || [])) {
      const maskLayer = State.layers.find(l => l.id === maskId);
      if (maskLayer) { maskLayer.isMaskFor = null; await DB.saveLayer(maskLayer); }
    }
    if (src.isMaskFor) {
      const baseLayer = State.layers.find(l => l.id === src.isMaskFor);
      if (baseLayer) {
        baseLayer.imageMaskIds = (baseLayer.imageMaskIds || []).filter(id => id !== src.id);
        await DB.saveLayer(baseLayer);
      }
    }

    const sourceIdx = State.layers.findIndex(l => l.id === layerId);
    const newLayers = [];

    for (const colorHex of src.separationColors) {
      const plate = src.separationPlates.get(colorHex);
      if (!plate) continue;

      const colorInfo = RISO_COLORS.find(c => c.hex === colorHex);
      const colorName = colorInfo?.name || colorHex;
      const rec = src.toRecord();

      const newLayer = new Layer({
        ...rec,
        id: undefined,
        name: src.name + ' ' + colorName,
        isColorSeparation: false,
        color: colorHex,
        colorMode: 'solid',
        halftoneType: rec.halftoneType,
        halftoneSize: rec.halftoneSize,
        halftoneAngle: (rec.halftoneAngle + (ImageProcessor._separationAngles[colorHex] || 0)) % 180,
        separationColors: [],
        linkedIds: [],
      });
      newLayer.naturalWidth = plate.width;
      newLayer.naturalHeight = plate.height;

      const orig = new OffscreenCanvas(plate.width, plate.height);
      orig.getContext('2d').drawImage(plate, 0, 0);
      newLayer._originalCanvas = orig;

      if (src._maskCanvas) {
        const mc = new OffscreenCanvas(src._maskCanvas.width, src._maskCanvas.height);
        mc.getContext('2d').drawImage(src._maskCanvas, 0, 0);
        newLayer._maskCanvas = mc;
      } else {
        MaskEngine.initMask(newLayer);
      }
      newLayer._dirty = true;

      await DB.put('layers', newLayer.toRecord());
      await DB.put('imageBlobs', { layerId: newLayer.id, blob: await orig.convertToBlob({ type: 'image/png' }) });
      await DB.put('maskBlobs', { layerId: newLayer.id, blob: await newLayer._maskCanvas.convertToBlob({ type: 'image/png' }) });

      newLayers.push(newLayer);
    }

    // Remove the original color-separation layer.
    State.layers.splice(sourceIdx, 1);
    await DB.del('layers', layerId);
    await DB.del('imageBlobs', layerId);
    await DB.del('maskBlobs', layerId);

    // Insert the new per-color layers at the original stacking position.
    State.layers.splice(sourceIdx, 0, ...newLayers);

    State.selectedId = newLayers[0]?.id || null;
    State.selectedIds = newLayers[0] ? [newLayers[0].id] : [];

    await PageManager.saveActivePage();
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  // Splits a two-tone shape (distinct fill + border inks) into two separate
  // parametric shape layers — one carrying only the fill body (inked with
  // shapeFillColor), one carrying only the border ring (inked with
  // shapeStrokeColor). Both keep the source geometry, so the parts stay
  // aligned, and each remains a fully editable shape (resize, recolor,
  // border width, etc.). Mirrors splitColorSeparation for images.
  async splitTwoToneShape(layerId) {
    pushUndoState();
    const src = State.layers.find(l => l.id === layerId);
    if (!src || !isTwoToneShape(src)) return;

    // Clean up mask relationships the same way delete() does.
    for (const maskId of (src.imageMaskIds || [])) {
      const maskLayer = State.layers.find(l => l.id === maskId);
      if (maskLayer) { maskLayer.isMaskFor = null; await DB.saveLayer(maskLayer); }
    }
    if (src.isMaskFor) {
      const baseLayer = State.layers.find(l => l.id === src.isMaskFor);
      if (baseLayer) {
        baseLayer.imageMaskIds = (baseLayer.imageMaskIds || []).filter(id => id !== src.id);
        await DB.saveLayer(baseLayer);
      }
    }

    const sourceIdx = State.layers.findIndex(l => l.id === layerId);
    const newLayers = [];

    const partSpecs = [
      { suffix: ' Fill', apply: rec => { rec.shapeHasStroke = false; } },
      { suffix: ' Border', apply: rec => { rec.shapeHasFill = false; } },
    ];
    for (const { suffix, apply } of partSpecs) {
      const rec = src.toRecord();
      apply(rec);
      const newLayer = new Layer({
        ...rec,
        id: undefined,
        name: src.name + suffix,
        linkedIds: [],
      });
      // Sync the main ink color and regenerate the bitmap from geometry.
      newLayer.color = effectiveShapeColor(newLayer);
      newLayer._dirty = true;
      if (src._maskCanvas) {
        const mc = new OffscreenCanvas(src._maskCanvas.width, src._maskCanvas.height);
        mc.getContext('2d').drawImage(src._maskCanvas, 0, 0);
        newLayer._maskCanvas = mc;
      } else {
        MaskEngine.initMask(newLayer);
      }
      // Renders this part's bitmap from geometry and persists the layer record
      // + artwork blob. The single-ink pipeline now colorizes it correctly.
      await rerenderShapeLayer(newLayer);
      await DB.put('maskBlobs', { layerId: newLayer.id, blob: await newLayer._maskCanvas.convertToBlob({ type: 'image/png' }) });
      newLayers.push(newLayer);
    }

    // Remove the original two-tone shape.
    State.layers.splice(sourceIdx, 1);
    await DB.del('layers', layerId);
    await DB.del('imageBlobs', layerId);
    await DB.del('maskBlobs', layerId);

    // Insert the fill/border layers at the original stacking position.
    State.layers.splice(sourceIdx, 0, ...newLayers);

    State.selectedId = newLayers[0]?.id || null;
    State.selectedIds = newLayers[0] ? [newLayers[0].id] : [];

    await PageManager.saveActivePage();
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  // Spawns a sibling shape layer carrying only the requested part ('fill'
  // body or 'border' ring) with the same geometry as the source shape.
  // Shapes are one-part-per-layer — each ink lives on its own layer — so
  // switching a fill shape to Border adds an outline layer above it while
  // the inside stays on its original layer, and adding Fill to an outline
  // gives it a body underneath. Selecting the part a layer already has is a
  // no-op.
  async spawnShapePart(layerId, part) {
    pushUndoState();
    const src = State.layers.find(l => l.id === layerId);
    if (!src || !src.isShape) return;
    const wantFill = part === 'fill';
    if (wantFill ? src.shapeHasFill : src.shapeHasStroke) return;

    const rec = src.toRecord();
    rec.shapeHasFill = wantFill;
    rec.shapeHasStroke = !wantFill;
    if (!wantFill && !rec.shapeStrokeWidth) rec.shapeStrokeWidth = 4;

    const newLayer = new Layer({
      ...rec,
      id: undefined,
      name: src.name + (wantFill ? ' Fill' : ' Border'),
      linkedIds: [],
    });
    // Sync the main ink color and render this part's bitmap from geometry.
    newLayer.color = effectiveShapeColor(newLayer);
    newLayer._dirty = true;
    if (src._maskCanvas) {
      const mc = new OffscreenCanvas(src._maskCanvas.width, src._maskCanvas.height);
      mc.getContext('2d').drawImage(src._maskCanvas, 0, 0);
      newLayer._maskCanvas = mc;
    } else {
      MaskEngine.initMask(newLayer);
    }
    await rerenderShapeLayer(newLayer);
    await DB.put('maskBlobs', { layerId: newLayer.id, blob: await newLayer._maskCanvas.convertToBlob({ type: 'image/png' }) });

    // Insert adjacent to the source: outlines stack above their body,
    // bodies sit beneath their outline.
    const insertIdx = State.layers.indexOf(src) + (wantFill ? 0 : 1);
    State.layers.splice(insertIdx, 0, newLayer);
    State.selectedId = newLayer.id;
    State.selectedIds = [newLayer.id];

    await PageManager.saveActivePage();
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  move(layerId, delta) {
    pushUndoState();
    const layer = State.layers.find(l => l.id === layerId);
    if (!layer) return;
    // Resolve to base layer of this group
    const baseId = layer.isMaskFor || layer.id;
    const base = State.layers.find(l => l.id === baseId);
    const groupIds = new Set([baseId, ...((base?.imageMaskIds) || [])]);

    if (groupIds.size > 1) {
      const indices = [...groupIds]
        .map(id => State.layers.findIndex(l => l.id === id))
        .filter(i => i !== -1)
        .sort((a, b) => a - b);
      const minIdx = indices[0];
      const count = indices[indices.length - 1] - minIdx + 1;
      const group = State.layers.splice(minIdx, count);
      const targetIdx = Math.max(0, Math.min(State.layers.length, minIdx + delta));
      State.layers.splice(targetIdx, 0, ...group);
    } else {
      const idx = State.layers.findIndex(l => l.id === layerId);
      if (idx === -1) return;
      const newIdx = Math.max(0, Math.min(State.layers.length - 1, idx + delta));
      if (newIdx === idx) return;
      const [l] = State.layers.splice(idx, 1);
      State.layers.splice(newIdx, 0, l);
    }

    PageManager.saveActivePage();
    UI.refreshLayerList();
    Renderer.schedule();
  },

  moveToIndex(layerId, targetStateIndex) {
    const layer = State.layers.find(l => l.id === layerId);
    if (!layer) return;
    // Resolve to base layer of this group
    const baseId = layer.isMaskFor || layer.id;
    const base = State.layers.find(l => l.id === baseId);
    const groupIds = new Set([baseId, ...((base?.imageMaskIds) || [])]);

    const indices = [...groupIds]
      .map(id => State.layers.findIndex(l => l.id === id))
      .filter(i => i !== -1)
      .sort((a, b) => a - b);
    const sourceStart = indices[0];
    const sourceEnd = indices[indices.length - 1] + 1; // exclusive
    const count = sourceEnd - sourceStart;

    // Dropping inside the same group is a no-op
    if (targetStateIndex >= sourceStart && targetStateIndex <= sourceEnd) return;

    pushUndoState();
    const group = State.layers.splice(sourceStart, count);

    // targetStateIndex was computed against the original array; adjust for removed group
    let insertIdx = targetStateIndex;
    if (targetStateIndex > sourceStart) insertIdx -= count;
    insertIdx = Math.max(0, Math.min(State.layers.length, insertIdx));

    State.layers.splice(insertIdx, 0, ...group);

    PageManager.saveActivePage();
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  async moveToPage(layerId, targetPageId) {
    const layer = State.layers.find(l => l.id === layerId);
    if (!layer || layer.pageId === targetPageId) return;

    // Resolve to the base layer of this mask group so image-mask relationships
    // stay intact. Both the base and all of its masks move together.
    const baseId = layer.isMaskFor || layer.id;
    const base = State.layers.find(l => l.id === baseId);
    const groupIds = new Set([baseId, ...((base?.imageMaskIds) || [])]);

    const groupLayers = [];
    for (const id of groupIds) {
      const l = State.layers.find(x => x.id === id);
      if (l) groupLayers.push(l);
    }

    // Detect same-spread moves so we can keep the layer in the active view.
    let sameSpreadRightPageId = null;
    if (State.spreadView && State.unitId && State.project?.pageOrder) {
      const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
      const unit = units.find(u => u.id === State.unitId);
      if (unit?.type === 'spread') sameSpreadRightPageId = unit.rightPageId;
    }
    const sameSpread = State.spreadView &&
      (targetPageId === State.pageId || targetPageId === sameSpreadRightPageId);

    // Normalize coordinates from spread-view memory back to stored page-relative
    // coordinates before changing pageId. In spread view, right-page layers have
    // their x shifted by the left page's width.
    for (const l of groupLayers) {
      if (State.spreadView && l.pageId !== State.pageId) {
        l.x -= State.spreadSplitX;
      }
      l.pageId = targetPageId;
    }

    const movedIds = new Set(groupLayers.map(l => l.id));

    if (sameSpread) {
      // Moving within the current spread: shift x so the layer appears on the
      // correct side of the canvas and let saveActivePage persist both pages.
      for (const l of groupLayers) {
        if (targetPageId === sameSpreadRightPageId) {
          l.x += State.spreadSplitX;
        }
        await DB.saveLayer(l);
      }
      await PageManager.saveActivePage();
    } else {
      // Moving to a different unit: remove from the active layer stack and
      // update both source and target page records independently.
      for (const l of groupLayers) {
        await DB.saveLayer(l);
      }
      State.layers = State.layers.filter(l => !movedIds.has(l.id));

      // Rewrite the source page's layerOrder from the remaining layers.
      await PageManager.saveActivePage();

      // Append the moved layers to the target page's layerOrder.
      const targetPage = await DB.get('pages', targetPageId);
      if (targetPage) {
        targetPage.layerOrder = targetPage.layerOrder || [];
        for (const l of groupLayers) {
          if (!targetPage.layerOrder.includes(l.id)) targetPage.layerOrder.push(l.id);
        }
        targetPage.updatedAt = Date.now();
        await DB.put('pages', targetPage);
      }

      State.selectedIds = State.selectedIds.filter(id => !movedIds.has(id));
      State.selectedId = State.selectedIds[State.selectedIds.length - 1] || null;
      if (!State.layers.length) document.getElementById('no-layer-msg').style.display = '';
    }

    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  async flatten(layerId) {
    const layer = State.layers.find(l => l.id === layerId);
    if (!layer) return;

    // Resolve to the base layer of a mask group; can't flatten a mask layer alone.
    let baseLayer = layer;
    if (baseLayer.isMaskFor) {
      baseLayer = State.layers.find(l => l.id === baseLayer.isMaskFor);
      if (!baseLayer) return;
    }

    // Snapshot the layer record BEFORE flattening so undo can restore the
    // original (possibly live-text) content. A reference-based state snapshot
    // wouldn't help here: flatten mutates the layer instance in place.
    pushUndoWithMask(baseLayer);

    // Text layers are flattened by converting them to standard pixel layers:
    // their rendered output is baked into an _originalCanvas first.
    if (baseLayer.isText) {
      if (!await this._bakeTextToRaster(baseLayer)) return;
    } else if (baseLayer.isSvg || baseLayer.isColorSeparation || !baseLayer._originalCanvas) {
      // Only raster image/shape layers can be flattened.
      return;
    }

    const nw = baseLayer.naturalWidth;
    const nh = baseLayer.naturalHeight;
    if (!nw || !nh) return;

    // Build visibility map (0 = hidden, 255 = visible) in base natural space.
    const visibility = new Uint8Array(nw * nh).fill(255);

    // Manual mask
    if (baseLayer._maskCanvas) {
      const maskData = baseLayer._maskCanvas.getContext('2d').getImageData(0, 0, nw, nh).data;
      for (let i = 0; i < visibility.length; i++) {
        visibility[i] = maskData[i * 4 + 3];
      }
    }

    // Image masks
    if (baseLayer.imageMaskIds?.length) {
      const maskLayers = baseLayer.imageMaskIds
        .map(id => State.layers.find(l => l.id === id))
        .filter(ml => ml);

      for (const maskLayer of maskLayers) {
        await ImageProcessor.processLayer(maskLayer, { forExport: true });
        if (!maskLayer._processedCanvas) continue;

        const maskMap = new OffscreenCanvas(nw, nh);
        const mCtx = maskMap.getContext('2d');
        mCtx.save();
        mCtx.setTransform(1, 0, 0, 1, 0, 0);

        // Map page coordinates into the base layer's natural coordinate space.
        const cx = baseLayer.x + baseLayer.width / 2;
        const cy = baseLayer.y + baseLayer.height / 2;
        mCtx.translate(-cx, -cy);
        mCtx.rotate(-baseLayer.rotation * Math.PI / 180);
        mCtx.scale(baseLayer.flipH ? -1 : 1, baseLayer.flipV ? -1 : 1);
        mCtx.translate(baseLayer.width / 2, baseLayer.height / 2);
        mCtx.scale(nw / baseLayer.width, nh / baseLayer.height);

        // Draw the mask layer at its page position and size.
        mCtx.translate(maskLayer.x + maskLayer.width / 2, maskLayer.y + maskLayer.height / 2);
        mCtx.rotate(maskLayer.rotation * Math.PI / 180);
        mCtx.scale(maskLayer.flipH ? -1 : 1, maskLayer.flipV ? -1 : 1);
        mCtx.translate(-maskLayer.width / 2, -maskLayer.height / 2);
        mCtx.drawImage(maskLayer._processedCanvas, 0, 0, maskLayer.width, maskLayer.height);
        // If the mask layer has its own painted mask (e.g. a linked difference
        // layer), restrict the mask effect to the painted-visible area.
        if (maskLayer._maskCanvas) {
          mCtx.globalCompositeOperation = 'destination-in';
          mCtx.drawImage(maskLayer._maskCanvas, 0, 0, maskLayer.width, maskLayer.height);
        }
        mCtx.restore();

        const maskData = mCtx.getImageData(0, 0, nw, nh).data;
        for (let i = 0; i < visibility.length; i++) {
          if (maskData[i * 4 + 3] > 128) visibility[i] = 0;
        }
      }
    }

    // Apply visibility map to the original canvas: hidden pixels become white.
    const orig = new OffscreenCanvas(nw, nh);
    const oCtx = orig.getContext('2d');
    oCtx.drawImage(baseLayer._originalCanvas, 0, 0);
    const origData = oCtx.getImageData(0, 0, nw, nh);
    for (let i = 0; i < visibility.length; i++) {
      if (visibility[i] < 128) {
        const idx = i * 4;
        origData.data[idx] = origData.data[idx + 1] = origData.data[idx + 2] = 255;
      }
    }
    oCtx.putImageData(origData, 0, 0);

    // Compute bounding box of visible (non-white) pixels.
    const bbox = this._computeBoundingBox(origData.data, nw, nh, 128);
    if (!bbox) return; // Fully transparent after flattening; leave unchanged for safety.

    // Crop the original canvas to the visible bounding box.
    const cropped = new OffscreenCanvas(bbox.w, bbox.h);
    cropped.getContext('2d').drawImage(orig, -bbox.x, -bbox.y);

    // Update layer geometry so the cropped content stays in the same place on the page.
    const oldCx = baseLayer.x + baseLayer.width / 2;
    const oldCy = baseLayer.y + baseLayer.height / 2;
    const cu = bbox.x + bbox.w / 2;
    const cv = bbox.y + bbox.h / 2;
    const ddx = (cu - nw / 2) * (baseLayer.width / nw);
    const ddy = (cv - nh / 2) * (baseLayer.height / nh);
    const rad = baseLayer.rotation * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const fh = baseLayer.flipH ? -1 : 1;
    const fv = baseLayer.flipV ? -1 : 1;
    const newPageCx = oldCx + cos * fh * ddx - sin * fv * ddy;
    const newPageCy = oldCy + sin * fh * ddx + cos * fv * ddy;

    baseLayer.naturalWidth = bbox.w;
    baseLayer.naturalHeight = bbox.h;
    baseLayer.width = bbox.w * (baseLayer.width / nw);
    baseLayer.height = bbox.h * (baseLayer.height / nh);
    baseLayer.x = newPageCx - baseLayer.width / 2;
    baseLayer.y = newPageCy - baseLayer.height / 2;

    baseLayer._originalCanvas = cropped;
    baseLayer._processedCanvas = null;
    baseLayer._maskCanvas = null;
    baseLayer._dirty = true;

    // Delete the now-baked image mask layers and clear the relationships.
    const maskIds = [...(baseLayer.imageMaskIds || [])];
    baseLayer.imageMaskIds = [];
    const deletedIds = new Set();
    for (const maskId of maskIds) {
      const idx = State.layers.findIndex(l => l.id === maskId);
      if (idx !== -1) {
        State.layers[idx].isMaskFor = null;
        State.layers.splice(idx, 1);
        deletedIds.add(maskId);
        await DB.del('layers', maskId);
        await DB.del('imageBlobs', maskId);
        await DB.del('maskBlobs', maskId);
      }
    }

    // Remove deleted mask layers from any link lists.
    for (const l of State.layers) {
      const before = l.linkedIds?.length || 0;
      l.linkedIds = (l.linkedIds || []).filter(id => !deletedIds.has(id));
      if ((l.linkedIds?.length || 0) !== before) await DB.saveLayer(l);
    }

    if (deletedIds.size) {
      State.selectedIds = State.selectedIds.filter(id => !deletedIds.has(id));
      State.selectedId = State.selectedIds[State.selectedIds.length - 1] || baseLayer.id;
      State.selectedIds = State.selectedIds.length ? State.selectedIds : [baseLayer.id];
    } else {
      State.selectedId = baseLayer.id;
      State.selectedIds = [baseLayer.id];
    }

    await DB.put('imageBlobs', { layerId: baseLayer.id, blob: await cropped.convertToBlob({ type: 'image/png' }) });
    await DB.del('maskBlobs', baseLayer.id);
    await DB.saveLayer(baseLayer);
    await PageManager.saveActivePage();

    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  /**
   * Bake a live text layer's rendered output into a raster _originalCanvas and
   * convert it into a standard (non-text) pixel layer. Returns true on success.
   * After this, normal flatten logic (mask baking + crop) applies unchanged.
   */
  async _bakeTextToRaster(layer) {
    const nw = layer.naturalWidth;
    const nh = layer.naturalHeight;
    if (!nw || !nh) return false;

    // Render at export quality: full pipeline (grayscale/brightness/halftone/
    // colorize) applied, transparent background.
    const proc = await ImageProcessor.processLayer(layer, { forExport: true });
    if (!proc) return false;

    // Composite onto white so the canvas matches how raster image layers
    // store their artwork (flatten's bbox detection relies on this).
    const orig = new OffscreenCanvas(nw, nh);
    const ctx = orig.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, nw, nh);
    ctx.drawImage(proc, 0, 0);

    layer._originalCanvas = orig;
    layer._exportOriginalCanvas = null;
    layer.isText = false;
    return true;
  },

  /**
   * Merge two or more selected layers into a single raster layer.
   * The layers are composited as they appear on the page, then cropped
   * to the bounding box of their combined visible content.
   */
  async merge(layerIds) {
    pushUndoState();
    const idSet = new Set(layerIds);
    const layers = State.layers.filter(l => idSet.has(l.id) && !l.isMaskFor);
    if (layers.length < 2) return;
    // Composite in stacking order (bottom first)
    layers.sort((a, b) => State.layers.indexOf(a) - State.layers.indexOf(b));

    // Make sure every layer has an up-to-date processed canvas at export quality.
    // Note: processLayer(forExport) returns the canvas without caching it.
    for (const l of layers) {
      const proc = await ImageProcessor.processLayer(l, { forExport: true });
      if (!proc) return;
      l._processedCanvas = proc;
    }

    // Union axis-aligned bounding box of the (possibly rotated) layers, in page units.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of layers) {
      const angle = l.rotation * Math.PI / 180;
      const cos = Math.abs(Math.cos(angle));
      const sin = Math.abs(Math.sin(angle));
      const hw = l.width / 2, hh = l.height / 2;
      const ex = hw * cos + hh * sin;
      const ey = hw * sin + hh * cos;
      const ccx = l.x + l.width / 2, ccy = l.y + l.height / 2;
      minX = Math.min(minX, ccx - ex);
      minY = Math.min(minY, ccy - ey);
      maxX = Math.max(maxX, ccx + ex);
      maxY = Math.max(maxY, ccy + ey);
    }

    // Choose a composite resolution that preserves the sharpest source,
    // capped so the intermediate bitmap stays reasonably sized.
    let scale = Math.max(...layers.map(l => (l.naturalWidth > 0 ? l.naturalWidth / l.width : 1)));
    scale = Math.min(scale, Math.sqrt((4096 * 4096) / Math.max(1, (maxX - minX) * (maxY - minY))));
    scale = Math.max(scale, 0.05);

    const bw = Math.max(1, Math.ceil((maxX - minX) * scale));
    const bh = Math.max(1, Math.ceil((maxY - minY) * scale));
    const comp = new OffscreenCanvas(bw, bh);
    const mctx = comp.getContext('2d');
    mctx.fillStyle = '#fff';
    mctx.fillRect(0, 0, bw, bh);

    for (const l of layers) {
      if (!l.visible) continue;
      mctx.save();
      mctx.translate(-minX * scale, -minY * scale);
      if (l.imageMaskIds?.length) {
        await Renderer._compositeLayerWithImageMask(mctx, l, scale, layers);
      } else {
        Renderer._applyTransform(mctx, l, scale);
        Renderer._compositeLayer(mctx, l, scale);
      }
      mctx.restore();
    }

    // Crop to the bounding box of non-white content.
    const imgData = mctx.getImageData(0, 0, bw, bh);
    const bbox = this._computeBoundingBox(imgData.data, bw, bh);
    if (!bbox) return; // nothing visible; leave layers unchanged
    const cropped = new OffscreenCanvas(bbox.w, bbox.h);
    cropped.getContext('2d').drawImage(comp, -bbox.x, -bbox.y);

    // Build the merged layer, keeping the composited content at its page position.
    const pw = bbox.w / scale, ph = bbox.h / scale;
    const centerX = minX + (bbox.x + bbox.w / 2) / scale;
    const centerY = minY + (bbox.y + bbox.h / 2) / scale;
    const mergedNames = layers.map(l => l.name).join(' + ');
    const merged = new Layer({
      name: mergedNames.length > 60 ? 'Merged (' + layers.length + ')' : mergedNames,
      x: centerX - pw / 2,
      y: centerY - ph / 2,
      width: pw,
      height: ph,
      naturalWidth: bbox.w,
      naturalHeight: bbox.h,
    });
    merged._originalCanvas = cropped;
    MaskEngine.initMask(merged);
    merged._dirty = true;

    // Insert at the stacking position of the topmost merged layer.
    const topIdx = Math.max(...layers.map(l => State.layers.indexOf(l)));

    // Remove the merged-away layers, cleaning up mask relationships and links.
    const removedIds = new Set();
    for (const l of layers) {
      const groupIds = [l.id, ...(l.imageMaskIds || [])];
      for (const gid of groupIds) {
        const gl = State.layers.find(x => x.id === gid);
        if (!gl) continue;
        if (gl.isMaskFor) {
          const base = State.layers.find(x => x.id === gl.isMaskFor);
          if (base) base.imageMaskIds = (base.imageMaskIds || []).filter(id => id !== gl.id);
        }
        removedIds.add(gid);
        State.layers.splice(State.layers.indexOf(gl), 1);
      }
    }
    for (const gid of removedIds) {
      await DB.del('layers', gid);
      await DB.del('imageBlobs', gid);
      await DB.del('maskBlobs', gid);
    }
    for (const l of State.layers) {
      const before = l.linkedIds?.length || 0;
      l.linkedIds = (l.linkedIds || []).filter(id => !removedIds.has(id));
      if ((l.linkedIds?.length || 0) !== before) await DB.saveLayer(l);
    }

    const insertIdx = Math.min(topIdx, State.layers.length);
    State.layers.splice(insertIdx, 0, merged);
    State.selectedId = merged.id;
    State.selectedIds = [merged.id];

    await DB.put('layers', merged.toRecord());
    await DB.put('imageBlobs', { layerId: merged.id, blob: await cropped.convertToBlob({ type: 'image/png' }) });
    await DB.put('maskBlobs', { layerId: merged.id, blob: await merged._maskCanvas.convertToBlob({ type: 'image/png' }) });
    await PageManager.saveActivePage();

    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  },

  _computeBoundingBox(data, w, h, threshold = 128) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i] < threshold) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  },
};
