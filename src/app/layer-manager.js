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
import { pushUndoState } from './undo.js';
import { PageManager } from './page-manager.js';

export const LayerManager = {
  async addText(defaultText, x, y, w, h) {
    pushUndoState();
    const layer = new Layer({
      name: 'Text',
      isText: true,
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

  async addShape(shapeCanvas, x, y, w, h) {
    pushUndoState();
    const toolNames = {
      'shape-rect': 'Rectangle', 'shape-ellipse': 'Ellipse',
      'shape-poly': State.shapeIsStar ? 'Star' : 'Polygon',
    };
    const layer = new Layer({
      name: toolNames[State.tool] || 'Shape',
      x, y, width: w, height: h,
      naturalWidth: w, naturalHeight: h,
    });
    layer._originalCanvas = shapeCanvas;
    MaskEngine.initMask(layer);
    State.layers.push(layer);
    State.selectedId = layer.id;
    State.selectedIds = [layer.id];
    const blob = await shapeCanvas.convertToBlob({ type: 'image/png' });
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

    const layer = new Layer({ ...src.toRecord(), id: undefined, name: src.name + ' copy', x: src.x + 20, y: src.y + 20 });

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
};
