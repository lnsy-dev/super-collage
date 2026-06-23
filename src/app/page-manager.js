/* ═══════════════════════════════════════════════════════════════════
   Page Manager — pagination / booklet support
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { Layer } from './layer.js';
import { ImageProcessor } from './image-processor.js';
import { MaskEngine } from './mask-engine.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { CANVAS_W, CANVAS_H, setCanvasSize, RISO_COLORS } from './constants.js';
import { hexToRgb } from '../utils/color.js';
import { SpreadManager, computeViewUnits, findUnitForPage } from './spread-manager.js';

export const PageManager = {
  loadViewSettings(project) {
    const vs = project?.viewSettings || {};
    State.showMargins = !!vs.showMargins;
    State.showGrid = !!vs.showGrid;
    State.margins = vs.margins || { top: 300, right: 300, bottom: 300, left: 300 };
    State.grid = vs.grid || { size: 150, type: 'standard' };
    State.spreadSplitX = 0;
  },

  async saveViewSettings() {
    if (!State.project) return;
    State.project.viewSettings = {
      showMargins: State.showMargins,
      showGrid: State.showGrid,
      margins: { ...State.margins },
      grid: { ...State.grid },
    };
    await DB.put('projects', { ...State.project, updatedAt: Date.now() });
  },

  async createPage(projectId, name, width, height, options = {}) {
    const page = {
      id: crypto.randomUUID(),
      projectId,
      name,
      index: options.index ?? ((State.project?.pageOrder?.length) || 0),
      width,
      height,
      layerOrder: [],
      spread: false,
      spreadPartnerId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await DB.put('pages', page);
    return page;
  },

  async createPages(projectId, count, width, height) {
    const pages = [];
    for (let i = 0; i < count; i++) {
      const page = await this.createPage(projectId, `Page ${i + 1}`, width, height, { index: i });
      pages.push(page);
    }
    return pages;
  },

  async addBlankPageToProject(projectId, width, height) {
    const nextIndex = State.project?.pageOrder?.length || 0;
    const page = await this.createPage(projectId, `Page ${nextIndex + 1}`, width, height, { index: nextIndex });
    State.project.pageOrder.push(page.id);
    await DB.put('projects', { ...State.project, updatedAt: Date.now() });
    await this.recomputeSpreadMeta();
    return page;
  },

  async loadPage(pageId) {
    if (State.pageId === pageId && !State.spreadView) return;

    // Save current unit state before leaving.
    await this.saveActivePage();
    this._dehydrateLayers(State.layers);

    const page = await DB.get('pages', pageId);
    if (!page) return;

    State.pageId = page.id;
    State.unitId = null;
    State.spreadView = false;
    State.layers = [];
    State.selectedId = null;
    State.selectedIds = [];
    State.undoStack = [];
    State.redoStack = [];

    setCanvasSize(page.width, page.height);

    const layerRecords = await DB.getByIndex('layers', 'by-page', pageId);
    const order = page.layerOrder || [];
    layerRecords.sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    for (const rec of layerRecords) {
      const layer = await this.hydrateLayer(rec);
      if (layer) State.layers.push(layer);
    }

    this._refreshAfterPageSwitch(page);
  },

  async loadUnit(unitId) {
    if (!State.project || !State.project.pageOrder) return;
    if (State.unitId === unitId) return;

    const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    // Save current unit state before leaving.
    await this.saveActivePage();
    this._dehydrateLayers(State.layers);

    if (unit.type === 'page') {
      const page = await DB.get('pages', unit.pageId);
      if (!page) return;

      State.pageId = page.id;
      State.unitId = unit.id;
      State.spreadView = false;
      State.spreadSplitX = 0;
      State.layers = [];
      State.selectedId = null;
      State.selectedIds = [];
      State.undoStack = [];
      State.redoStack = [];

      setCanvasSize(page.width, page.height);

      const layerRecords = await DB.getByIndex('layers', 'by-page', page.id);
      const order = page.layerOrder || [];
      layerRecords.sort((a, b) => {
        const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
      for (const rec of layerRecords) {
        const layer = await this.hydrateLayer(rec);
        if (layer) State.layers.push(layer);
      }

      this._refreshAfterPageSwitch(page);
      return;
    }

    // Spread unit.
    const leftPage = await DB.get('pages', unit.leftPageId);
    const rightPage = await DB.get('pages', unit.rightPageId);
    if (!leftPage || !rightPage) return;

    State.pageId = leftPage.id;
    State.unitId = unit.id;
    State.spreadView = true;
    State.spreadSplitX = leftPage.width;
    State.layers = [];
    State.selectedId = null;
    State.selectedIds = [];
    State.undoStack = [];
    State.redoStack = [];

    setCanvasSize(leftPage.width + rightPage.width, Math.max(leftPage.height, rightPage.height));

    const leftRecords = await DB.getByIndex('layers', 'by-page', leftPage.id);
    const leftOrder = leftPage.layerOrder || [];
    leftRecords.sort((a, b) => {
      const ai = leftOrder.indexOf(a.id), bi = leftOrder.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    for (const rec of leftRecords) {
      const layer = await this.hydrateLayer(rec);
      if (layer) State.layers.push(layer);
    }

    const rightRecords = await DB.getByIndex('layers', 'by-page', rightPage.id);
    const rightOrder = rightPage.layerOrder || [];
    rightRecords.sort((a, b) => {
      const ai = rightOrder.indexOf(a.id), bi = rightOrder.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    for (const rec of rightRecords) {
      const layer = await this.hydrateLayer(rec);
      if (!layer) continue;
      layer.x += leftPage.width;
      State.layers.push(layer);
    }

    this._refreshAfterPageSwitch(leftPage, rightPage);
  },

  async loadPageLayers(pageId) {
    const layerRecords = await DB.getByIndex('layers', 'by-page', pageId);
    const page = await DB.get('pages', pageId);
    const order = page?.layerOrder || [];
    layerRecords.sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    const layers = [];
    for (const rec of layerRecords) {
      const layer = await this.hydrateLayer(rec);
      if (layer) layers.push(layer);
    }
    return layers;
  },

  async hydrateLayer(rec) {
    const layer = Layer.fromRecord(rec);
    if (layer.isText) {
      MaskEngine.initMask(layer);
      layer._dirty = true;
      return layer;
    }

    const imgRec = await DB.get('imageBlobs', layer.id);
    if (imgRec?.blob) {
      if (layer.isSvg) {
        const text = await imgRec.blob.text();
        layer._svgText = text;
        const svgBlob = new Blob([text], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        URL.revokeObjectURL(url);
        layer._svgImage = img;
      } else if (layer.isColorSeparation) {
        await this._rebuildSeparationPlates(layer, imgRec.blob);
      } else {
        const bmp = await createImageBitmap(imgRec.blob);
        const orig = new OffscreenCanvas(layer.naturalWidth, layer.naturalHeight);
        const ctx = orig.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, layer.naturalWidth, layer.naturalHeight);
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        layer._originalCanvas = orig;
      }
    }

    const maskRec = await DB.get('maskBlobs', layer.id);
    if (maskRec?.blob) {
      await MaskEngine.loadMask(layer, maskRec.blob);
    } else {
      MaskEngine.initMask(layer);
    }
    layer._dirty = true;
    return layer;
  },

  async _rebuildSeparationPlates(layer, blob) {
    const bmp = await createImageBitmap(blob);
    const nw = layer.naturalWidth, nh = layer.naturalHeight;
    const sourceCanvas = new OffscreenCanvas(nw, nh);
    const sCtx = sourceCanvas.getContext('2d');
    sCtx.fillStyle = 'white';
    sCtx.fillRect(0, 0, nw, nh);
    sCtx.drawImage(bmp, 0, 0);
    bmp.close();
    layer._originalCanvas = sourceCanvas;

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

  _dehydrateLayers(layers) {
    for (const layer of layers) {
      layer._originalCanvas = null;
      layer._processedCanvas = null;
      layer._maskCanvas = null;
      layer._svgImage = null;
      layer.separationPlates?.clear();
    }
  },

  async saveActivePage() {
    if (!State.pageId || !State.project) return;

    if (State.spreadView && State.unitId) {
      const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
      const unit = units.find(u => u.id === State.unitId);
      if (!unit || unit.type !== 'spread') return;

      const leftPage = await DB.get('pages', unit.leftPageId);
      const rightPage = await DB.get('pages', unit.rightPageId);
      if (!leftPage || !rightPage) return;

      // Save left page order as-is.
      leftPage.layerOrder = State.layers
        .filter(l => l.pageId === leftPage.id)
        .map(l => l.id);
      leftPage.updatedAt = Date.now();
      await DB.put('pages', leftPage);

      // Save right page order, normalizing x back to right-page coordinates.
      const rightLayers = State.layers.filter(l => l.pageId === rightPage.id);
      rightPage.layerOrder = rightLayers.map(l => l.id);
      rightPage.updatedAt = Date.now();
      await DB.put('pages', rightPage);

      // Persist normalized right-page layer coordinates.
      for (const layer of rightLayers) {
        layer.x -= leftPage.width;
        await DB.saveLayer(layer);
        layer.x += leftPage.width;
      }

      await DB.put('projects', { ...State.project, updatedAt: Date.now() });
      return;
    }

    const page = await DB.get('pages', State.pageId);
    if (!page) return;
    page.layerOrder = State.layers.map(l => l.id);
    page.updatedAt = Date.now();
    await DB.put('pages', page);
    await DB.put('projects', { ...State.project, updatedAt: Date.now() });
  },

  async saveProjectMeta() {
    if (!State.project) return;
    await DB.put('projects', { ...State.project, updatedAt: Date.now() });
  },

  async reorderPages(newOrder) {
    if (!State.project) return;
    State.project.pageOrder = [...newOrder];
    for (let i = 0; i < newOrder.length; i++) {
      const page = await DB.get('pages', newOrder[i]);
      if (page) { page.index = i; await DB.put('pages', page); }
    }
    await this.saveProjectMeta();
    await this.recomputeSpreadMeta();
  },

  async deletePage(pageId) {
    if (!State.project) return;
    const layers = await DB.getByIndex('layers', 'by-page', pageId);
    for (const l of layers) {
      await DB.del('imageBlobs', l.id);
      await DB.del('maskBlobs', l.id);
      await DB.del('layers', l.id);
    }
    await DB.del('pages', pageId);

    const idx = State.project.pageOrder.indexOf(pageId);
    State.project.pageOrder = State.project.pageOrder.filter(id => id !== pageId);

    const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
    const currentUnit = State.unitId ? units.find(u => u.id === State.unitId) : null;
    const inCurrentUnit = currentUnit &&
      (currentUnit.pageId === pageId || currentUnit.pageIds?.includes(pageId));
    if (State.pageId === pageId || inCurrentUnit) {
      // Switch to nearest remaining unit.
      State.spreadView = false;
      State.unitId = null;
      const newIdx = Math.max(0, Math.min(idx, State.project.pageOrder.length - 1));
      const nextId = State.project.pageOrder[newIdx];
      if (nextId) {
        const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
        const unit = findUnitForPage(units, nextId);
        if (unit) await this.loadUnit(unit.id);
      } else {
        State.pageId = null;
        State.layers = [];
        State.selectedId = null;
        State.selectedIds = [];
      }
    }
    await this.saveProjectMeta();
    return State.project.pageOrder;
  },

  async duplicatePage(pageId) {
    const page = await DB.get('pages', pageId);
    if (!page || !State.project) return;
    const newPage = {
      ...page,
      id: crypto.randomUUID(),
      name: page.name + ' copy',
      layerOrder: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const layers = await DB.getByIndex('layers', 'by-page', pageId);
    for (const rec of layers) {
      const newLayer = Layer.fromRecord({ ...rec, id: undefined, pageId: newPage.id, name: rec.name + ' copy' });
      const imgRec = await DB.get('imageBlobs', rec.id);
      if (imgRec?.blob) await DB.put('imageBlobs', { layerId: newLayer.id, blob: imgRec.blob });
      const maskRec = await DB.get('maskBlobs', rec.id);
      if (maskRec?.blob) await DB.put('maskBlobs', { layerId: newLayer.id, blob: maskRec.blob });
      await DB.put('layers', newLayer.toRecord());
      newPage.layerOrder.push(newLayer.id);
    }

    const insertIdx = State.project.pageOrder.indexOf(pageId);
    State.project.pageOrder.splice(insertIdx + 1, 0, newPage.id);
    await DB.put('pages', newPage);
    await this.saveProjectMeta();
    await this.recomputeSpreadMeta();
    return newPage;
  },

  async renamePage(pageId, name) {
    const page = await DB.get('pages', pageId);
    if (!page) return;
    page.name = name;
    page.updatedAt = Date.now();
    await DB.put('pages', page);
  },

  async setBooklet(booklet) {
    if (!State.project) return;
    State.project.booklet = { ...State.project.booklet, ...booklet };
    await this.saveProjectMeta();
    await this.recomputeSpreadMeta();
  },

  async recomputeSpreadMeta() {
    if (!State.project || !State.project.pageOrder) return;
    const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
    const lookup = SpreadManager.buildSpreadLookup(units);

    for (const pageId of State.project.pageOrder) {
      const page = await DB.get('pages', pageId);
      if (!page) continue;
      const info = lookup.get(pageId);
      if (info) {
        page.spread = true;
        const unit = units.find(u => u.id === info.unitId);
        page.spreadPartnerId = info.side === 'left' ? unit.rightPageId : unit.leftPageId;
        page.spreadSide = info.side;
      } else {
        page.spread = false;
        page.spreadPartnerId = null;
        page.spreadSide = null;
      }
      page.updatedAt = Date.now();
      await DB.put('pages', page);
    }
  },

  _refreshAfterPageSwitch(page, rightPage = null) {
    if (rightPage) {
      const totalW = page.width + rightPage.width;
      const maxH = Math.max(page.height, rightPage.height);
      document.getElementById('canvas-title').textContent =
        `${State.project.name} — ${page.name} + ${rightPage.name} — ${this._fmtPx(totalW)}" × ${this._fmtPx(maxH)}" @ 600dpi`;
    } else {
      document.getElementById('canvas-title').textContent =
        `${State.project.name} — ${page.name} — ${this._fmtPx(page.width)}" × ${this._fmtPx(page.height)}" @ 600dpi`;
    }
    document.getElementById('no-layer-msg').style.display = State.layers.length ? 'none' : '';
    UI.fitZoom();
    UI.refreshOrientation();
    UI.refreshLayerList();
    UI.refreshProperties();
    if (typeof UI.refreshPageList === 'function') UI.refreshPageList();
    Renderer.schedule();
  },

  _fmtPx(px) {
    const v = px / 600;
    return (Math.round(v * 100) / 100).toString();
  },
};
