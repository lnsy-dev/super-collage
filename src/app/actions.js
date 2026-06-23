/* ═══════════════════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════════════════ */

import { State, selectedLayer } from './state.js';
import { UI } from './ui.js';
import { Renderer } from './renderer.js';
import { LayerManager } from './layer-manager.js';
import { MaskEngine } from './mask-engine.js';
import { Layer } from './layer.js';
import { undo, redo, pushUndo, snapshotLayer, pushUndoWithMask, pushUndoState } from './undo.js';
import { showProjectDialog, showExportDialog, showCompositeExportDialog } from './project-manager.js';
import { showScreentoneDialog } from './screentone-manager.js';
import { CANVAS_W, CANVAS_H, setCanvasSize } from './constants.js';
import { DB } from './db.js';
import { PageManager } from './page-manager.js';
import { computeViewUnits, findUnitForPage } from './spread-manager.js';

function updateViewMenuLabels() {
  document.getElementById('menu-toggle-margins').textContent = State.showMargins ? 'Hide Margins' : 'View Margins';
  document.getElementById('menu-toggle-grid').textContent = State.showGrid ? 'Hide Grid' : 'View Grid';
}

function showMarginsDialog() {
  const m = State.margins;
  document.getElementById('margin-top').value = (m.top / 600).toFixed(3).replace(/\.?0+$/, '');
  document.getElementById('margin-right').value = (m.right / 600).toFixed(3).replace(/\.?0+$/, '');
  document.getElementById('margin-bottom').value = (m.bottom / 600).toFixed(3).replace(/\.?0+$/, '');
  document.getElementById('margin-left').value = (m.left / 600).toFixed(3).replace(/\.?0+$/, '');
  document.getElementById('margins-dialog').classList.remove('hidden');
}

function showGridDialog() {
  document.getElementById('grid-size').value = (State.grid.size / 600).toFixed(3).replace(/\.?0+$/, '');
  const radios = document.querySelectorAll('input[name="grid-type"]');
  radios.forEach(r => r.checked = r.value === State.grid.type);
  document.getElementById('grid-dialog').classList.remove('hidden');
}

export function applyMargins() {
  const toPx = v => Math.max(0, Math.round((parseFloat(v) || 0) * 600));
  State.margins = {
    top: toPx(document.getElementById('margin-top').value),
    right: toPx(document.getElementById('margin-right').value),
    bottom: toPx(document.getElementById('margin-bottom').value),
    left: toPx(document.getElementById('margin-left').value),
  };
  PageManager.saveViewSettings();
  Renderer.schedule();
}

export function applyGrid() {
  const sizeIn = parseFloat(document.getElementById('grid-size').value);
  State.grid.size = Math.max(1, Math.round((sizeIn || 0.25) * 600));
  const typeRadio = document.querySelector('input[name="grid-type"]:checked');
  State.grid.type = typeRadio?.value === 'isometric' ? 'isometric' : 'standard';
  PageManager.saveViewSettings();
  Renderer.schedule();
}

export { updateViewMenuLabels, showMarginsDialog, showGridDialog };

export async function handleAction(action, value = null) {
  const layer = selectedLayer();
  switch (action) {
    case 'add-image':     document.getElementById('file-input').click(); break;
    case 'add-screentone': showScreentoneDialog(); break;
    case 'add-text': {
      const text = prompt('Enter text:', 'Hello, world!');
      if (text !== null) {
        const { CANVAS_W, CANVAS_H } = await import('./constants.js');
        const w = Math.min(CANVAS_W, 1200);
        const h = Math.min(CANVAS_H, 400);
        await LayerManager.addText(text, Math.round((CANVAS_W - w) / 2), Math.round((CANVAS_H - h) / 2), w, h);
      }
      break;
    }
    case 'import-color-separation': document.getElementById('color-sep-input').click(); break;
    case 'delete-layer':  if (layer) await LayerManager.delete(layer.id); break;
    case 'duplicate-layer': if (layer) await LayerManager.duplicate(layer.id); break;
    case 'layer-up':   if (layer) LayerManager.move(layer.id, 1);  break;
    case 'layer-down': if (layer) LayerManager.move(layer.id, -1); break;
    case 'flip-h':
      if (layer) { pushUndo(snapshotLayer(layer)); layer.flipH = !layer.flipH; layer._dirty = true; DB.saveLayer(layer); Renderer.schedule(); }
      break;
    case 'flip-v':
      if (layer) { pushUndo(snapshotLayer(layer)); layer.flipV = !layer.flipV; layer._dirty = true; DB.saveLayer(layer); Renderer.schedule(); }
      break;
    case 'reset-transform':
      if (layer) {
        pushUndo(snapshotLayer(layer));
        layer.rotation = 0; layer.flipH = false; layer.flipV = false;
        layer.width = layer.naturalWidth; layer.height = layer.naturalHeight;
        layer.x = Math.round((CANVAS_W - layer.width) / 2);
        layer.y = Math.round((CANVAS_H - layer.height) / 2);
        layer._dirty = true;
        DB.saveLayer(layer);
        UI.refreshProperties();
        Renderer.schedule();
      }
      break;
    case 'clear-mask':  if (layer) { pushUndoWithMask(layer); MaskEngine.clearMask(layer); DB.saveMask(layer); Renderer.schedule(); } break;
    case 'fill-mask':   if (layer) { pushUndoWithMask(layer); MaskEngine.fillMask(layer);  DB.saveMask(layer); Renderer.schedule(); } break;
    case 'invert-mask': if (layer) { pushUndoWithMask(layer); MaskEngine.invertMask(layer); DB.saveMask(layer); Renderer.schedule(); } break;
    case 'create-image-mask': {
      if (State.selectedIds.length !== 2) break;
      pushUndoState();
      const [idA, idB] = State.selectedIds;
      const idxA = State.layers.findIndex(l => l.id === idA);
      const idxB = State.layers.findIndex(l => l.id === idB);
      if (idxA === -1 || idxB === -1) break;
      // Higher index = visually on top = becomes the mask
      const [baseIdx, maskIdx] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
      const baseLayer = State.layers[baseIdx];
      const maskLayerObj = State.layers[maskIdx];
      // Set relationship
      if (!baseLayer.imageMaskIds) baseLayer.imageMaskIds = [];
      baseLayer.imageMaskIds.push(maskLayerObj.id);
      maskLayerObj.isMaskFor = baseLayer.id;
      // Place mask layer at end of this base's mask group
      State.layers.splice(maskIdx, 1);
      const newBaseIdx = State.layers.findIndex(l => l.id === baseLayer.id);
      let insertPos = newBaseIdx + 1;
      while (insertPos < State.layers.length && State.layers[insertPos].isMaskFor === baseLayer.id) {
        insertPos++;
      }
      State.layers.splice(insertPos, 0, maskLayerObj);
      // Select the mask layer
      State.selectedId = maskLayerObj.id;
      State.selectedIds = [maskLayerObj.id];
      await DB.saveLayer(baseLayer);
      await DB.saveLayer(maskLayerObj);
      await PageManager.saveActivePage();
      UI.refreshLayerList();
      UI.refreshProperties();
      Renderer.schedule();
      break;
    }
    case 'create-difference-mask': {
      if (State.selectedIds.length !== 2) break;
      pushUndoState();
      const [idA, idB] = State.selectedIds;
      const idxA = State.layers.findIndex(l => l.id === idA);
      const idxB = State.layers.findIndex(l => l.id === idB);
      if (idxA === -1 || idxB === -1) break;
      // Higher index = visually on top = becomes the mask
      const [baseIdx, maskIdx] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
      const baseLayer = State.layers[baseIdx];
      const maskLayerObj = State.layers[maskIdx];

      // Set up image mask relationship (same as create-image-mask)
      if (!baseLayer.imageMaskIds) baseLayer.imageMaskIds = [];
      baseLayer.imageMaskIds.push(maskLayerObj.id);
      maskLayerObj.isMaskFor = baseLayer.id;

      // Place mask layer at end of this base's mask group
      State.layers.splice(maskIdx, 1);
      const newBaseIdx = State.layers.findIndex(l => l.id === baseLayer.id);
      let insertPos = newBaseIdx + 1;
      while (insertPos < State.layers.length && State.layers[insertPos].isMaskFor === baseLayer.id) {
        insertPos++;
      }
      State.layers.splice(insertPos, 0, maskLayerObj);

      // Duplicate the mask layer as a normal visible layer
      const dup = new Layer({
        ...maskLayerObj.toRecord(),
        id: undefined,
        name: maskLayerObj.name + ' (diff)',
        imageMaskIds: [],
        isMaskFor: null,
      });
      // Deep-clone canvases
      if (maskLayerObj._originalCanvas) {
        const orig = new OffscreenCanvas(maskLayerObj._originalCanvas.width, maskLayerObj._originalCanvas.height);
        orig.getContext('2d').drawImage(maskLayerObj._originalCanvas, 0, 0);
        dup._originalCanvas = orig;
      }
      if (maskLayerObj._processedCanvas) {
        const proc = new OffscreenCanvas(maskLayerObj._processedCanvas.width, maskLayerObj._processedCanvas.height);
        proc.getContext('2d').drawImage(maskLayerObj._processedCanvas, 0, 0);
        dup._processedCanvas = proc;
      }
      if (maskLayerObj._maskCanvas) {
        const mc = new OffscreenCanvas(maskLayerObj._maskCanvas.width, maskLayerObj._maskCanvas.height);
        mc.getContext('2d').drawImage(maskLayerObj._maskCanvas, 0, 0);
        dup._maskCanvas = mc;
      }
      dup._dirty = false;

      // Insert duplicate right after the mask group
      State.layers.splice(insertPos + 1, 0, dup);

      // Persist duplicate
      await DB.put('layers', dup.toRecord());
      if (dup._originalCanvas) {
        const blob = await dup._originalCanvas.convertToBlob({ type: 'image/png' });
        await DB.put('imageBlobs', { layerId: dup.id, blob });
      }
      if (dup._maskCanvas) {
        const blob = await dup._maskCanvas.convertToBlob({ type: 'image/png' });
        await DB.put('maskBlobs', { layerId: dup.id, blob });
      }

      await DB.saveLayer(baseLayer);
      await DB.saveLayer(maskLayerObj);
      await PageManager.saveActivePage();

      // Select the duplicated layer so user can change its color immediately
      State.selectedId = dup.id;
      State.selectedIds = [dup.id];
      UI.refreshLayerList();
      UI.refreshProperties();
      Renderer.schedule();
      break;
    }
    case 'release-image-mask': {
      const maskLayerObj = selectedLayer();
      if (!maskLayerObj?.isMaskFor) break;
      pushUndoState();
      const baseLayer = State.layers.find(l => l.id === maskLayerObj.isMaskFor);
      if (baseLayer) {
        baseLayer.imageMaskIds = (baseLayer.imageMaskIds || []).filter(id => id !== maskLayerObj.id);
      }
      maskLayerObj.isMaskFor = null;
      await DB.saveLayer(maskLayerObj);
      if (baseLayer) await DB.saveLayer(baseLayer);
      await PageManager.saveActivePage();
      State.selectedIds = [maskLayerObj.id];
      UI.refreshLayerList();
      UI.refreshProperties();
      Renderer.schedule();
      break;
    }
    case 'zoom-in':  State.zoom = Math.min(2, State.zoom * 1.25); Renderer.resize(); UI.refreshZoom(); break;
    case 'zoom-out': State.zoom = Math.max(0.04, State.zoom / 1.25); Renderer.resize(); UI.refreshZoom(); break;
    case 'zoom-fit': UI.fitZoom(); break;
    case 'zoom-100': State.zoom = 1; Renderer.resize(); UI.refreshZoom(); break;
    case 'orient-portrait':
      if (State.spreadView) break;
      if (CANVAS_W > CANVAS_H) { setCanvasSize(CANVAS_H, CANVAS_W); }
      if (State.project) {
        State.project.orientation = 'portrait';
        PageManager.saveActivePage();
      }
      Renderer.resize(); UI.fitZoom(); UI.refreshOrientation(); break;
    case 'orient-landscape':
      if (State.spreadView) break;
      if (CANVAS_H > CANVAS_W) { setCanvasSize(CANVAS_H, CANVAS_W); }
      if (State.project) {
        State.project.orientation = 'landscape';
        PageManager.saveActivePage();
      }
      Renderer.resize(); UI.fitZoom(); UI.refreshOrientation(); break;
    case 'rotate-page-cw': {
      if (!State.project || State.spreadView) break;
      const oldW = CANVAS_W, oldH = CANVAS_H;
      setCanvasSize(oldH, oldW);
      for (const layer of State.layers) {
        pushUndo(snapshotLayer(layer));
        const cx = layer.x + layer.width / 2;
        const cy = layer.y + layer.height / 2;
        const newCx = cy;
        const newCy = oldW - cx;
        layer.x = newCx - layer.width / 2;
        layer.y = newCy - layer.height / 2;
        layer.rotation = ((layer.rotation + 90) % 360 + 360) % 360;
        layer._dirty = true;
        DB.saveLayer(layer);
      }
      State.project.orientation = CANVAS_H >= CANVAS_W ? 'portrait' : 'landscape';
      PageManager.saveActivePage();
      Renderer.resize(); UI.fitZoom(); UI.refreshOrientation(); Renderer.schedule();
      break;
    }
    case 'rotate-page-ccw': {
      if (!State.project || State.spreadView) break;
      const oldW = CANVAS_W, oldH = CANVAS_H;
      setCanvasSize(oldH, oldW);
      for (const layer of State.layers) {
        pushUndo(snapshotLayer(layer));
        const cx = layer.x + layer.width / 2;
        const cy = layer.y + layer.height / 2;
        const newCx = oldH - cy;
        const newCy = cx;
        layer.x = newCx - layer.width / 2;
        layer.y = newCy - layer.height / 2;
        layer.rotation = ((layer.rotation - 90) % 360 + 360) % 360;
        layer._dirty = true;
        DB.saveLayer(layer);
      }
      State.project.orientation = CANVAS_H >= CANVAS_W ? 'portrait' : 'landscape';
      PageManager.saveActivePage();
      Renderer.resize(); UI.fitZoom(); UI.refreshOrientation(); Renderer.schedule();
      break;
    }
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'new-project':  showProjectDialog(); break;
    case 'open-project': showProjectDialog(); break;
    case 'next-page': {
      const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
      const idx = units.findIndex(u => u.id === State.unitId);
      const next = units[idx + 1];
      if (next) { await PageManager.loadUnit(next.id); UI.refreshPageList(); }
      break;
    }
    case 'prev-page': {
      const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
      const idx = units.findIndex(u => u.id === State.unitId);
      const prev = units[idx - 1];
      if (prev) { await PageManager.loadUnit(prev.id); UI.refreshPageList(); }
      break;
    }
    case 'export': await showExportDialog(); break;
    case 'export-composite': showCompositeExportDialog(); break;
    case 'toggle-margins':
      State.showMargins = !State.showMargins;
      PageManager.saveViewSettings();
      updateViewMenuLabels();
      Renderer.schedule();
      break;
    case 'toggle-grid':
      State.showGrid = !State.showGrid;
      PageManager.saveViewSettings();
      updateViewMenuLabels();
      Renderer.schedule();
      break;
    case 'set-margins':
      showMarginsDialog();
      break;
    case 'set-grid':
      showGridDialog();
      break;
  }
}
