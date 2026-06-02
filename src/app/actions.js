/* ═══════════════════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════════════════ */

import { State, selectedLayer } from './state.js';
import { UI } from './ui.js';
import { Renderer } from './renderer.js';
import { LayerManager } from './layer-manager.js';
import { MaskEngine } from './mask-engine.js';
import { undo, redo, pushUndo, snapshotLayer } from './undo.js';
import { showProjectDialog, showExportDialog, showCompositeExportDialog } from './project-manager.js';
import { CANVAS_W, CANVAS_H, setCanvasSize } from './constants.js';
import { DB } from './db.js';

export async function handleAction(action) {
  const layer = selectedLayer();
  switch (action) {
    case 'add-image':     document.getElementById('file-input').click(); break;
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
    case 'clear-mask':  if (layer) { MaskEngine.clearMask(layer); DB.saveMask(layer); Renderer.schedule(); } break;
    case 'fill-mask':   if (layer) { MaskEngine.fillMask(layer);  DB.saveMask(layer); Renderer.schedule(); } break;
    case 'invert-mask': if (layer) { MaskEngine.invertMask(layer); DB.saveMask(layer); Renderer.schedule(); } break;
    case 'create-image-mask': {
      if (State.selectedIds.length !== 2) break;
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
      await DB.put('projects', { ...State.project, updatedAt: Date.now(), layerOrder: State.layers.map(l => l.id) });
      UI.refreshLayerList();
      UI.refreshProperties();
      Renderer.schedule();
      break;
    }
    case 'release-image-mask': {
      const maskLayerObj = selectedLayer();
      if (!maskLayerObj?.isMaskFor) break;
      const baseLayer = State.layers.find(l => l.id === maskLayerObj.isMaskFor);
      if (baseLayer) {
        baseLayer.imageMaskIds = (baseLayer.imageMaskIds || []).filter(id => id !== maskLayerObj.id);
      }
      maskLayerObj.isMaskFor = null;
      await DB.saveLayer(maskLayerObj);
      if (baseLayer) await DB.saveLayer(baseLayer);
      await DB.put('projects', { ...State.project, updatedAt: Date.now(), layerOrder: State.layers.map(l => l.id) });
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
      if (CANVAS_W > CANVAS_H) { setCanvasSize(CANVAS_H, CANVAS_W); }
      if (State.project) { State.project.orientation = 'portrait'; DB.put('projects', { ...State.project, updatedAt: Date.now(), layerOrder: State.layers.map(l => l.id) }); }
      Renderer.resize(); UI.fitZoom(); UI.refreshOrientation(); break;
    case 'orient-landscape':
      if (CANVAS_H > CANVAS_W) { setCanvasSize(CANVAS_H, CANVAS_W); }
      if (State.project) { State.project.orientation = 'landscape'; DB.put('projects', { ...State.project, updatedAt: Date.now(), layerOrder: State.layers.map(l => l.id) }); }
      Renderer.resize(); UI.fitZoom(); UI.refreshOrientation(); break;
    case 'rotate-page-cw': {
      if (!State.project) break;
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
      DB.put('projects', { ...State.project, updatedAt: Date.now(), layerOrder: State.layers.map(l => l.id) });
      Renderer.resize(); UI.fitZoom(); UI.refreshOrientation(); Renderer.schedule();
      break;
    }
    case 'rotate-page-ccw': {
      if (!State.project) break;
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
      DB.put('projects', { ...State.project, updatedAt: Date.now(), layerOrder: State.layers.map(l => l.id) });
      Renderer.resize(); UI.fitZoom(); UI.refreshOrientation(); Renderer.schedule();
      break;
    }
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'new-project':  showProjectDialog(); break;
    case 'open-project': showProjectDialog(); break;
    case 'export': showExportDialog(); break;
    case 'export-composite': showCompositeExportDialog(); break;
  }
}
