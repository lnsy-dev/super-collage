/* ═══════════════════════════════════════════════════════════════════
   Undo / Redo
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { UI } from './ui.js';
import { Renderer } from './renderer.js';


export function snapshotLayer(layer) { return layer.toRecord(); }

export function pushUndo(snap) {
  State.undoStack.push(snap);
  if (State.undoStack.length > 50) State.undoStack.shift();
  State.redoStack = [];
}

export function pushUndoWithMask(layer) {
  const snap = snapshotLayer(layer);
  if (layer._maskCanvas) {
    try {
      const ctx = layer._maskCanvas.getContext('2d');
      snap._maskImageData = ctx.getImageData(0, 0, layer._maskCanvas.width, layer._maskCanvas.height);
    } catch (_e) {
      // ignore
    }
  }
  pushUndo(snap);
}

export function pushUndoState() {
  State.undoStack.push({
    _type: 'state',
    layers: [...State.layers],
    selectedId: State.selectedId,
    selectedIds: [...State.selectedIds],
  });
  if (State.undoStack.length > 50) State.undoStack.shift();
  State.redoStack = [];
}

export async function applySnapshot(layer, snap) {
  Object.assign(layer, {
    x: snap.x, y: snap.y, width: snap.width, height: snap.height,
    rotation: snap.rotation, flipH: snap.flipH, flipV: snap.flipV,
    brightness: snap.brightness, contrast: snap.contrast, saturation: snap.saturation, invert: snap.invert,
    halftoneType: snap.halftoneType, halftoneSize: snap.halftoneSize, halftoneAngle: snap.halftoneAngle,
    color: snap.color,
    colorMode: snap.colorMode || 'solid',
    gradient: snap.gradient ? JSON.parse(JSON.stringify(snap.gradient)) : layer.gradient,
    pattern: snap.pattern ? JSON.parse(JSON.stringify(snap.pattern)) : layer.pattern,
    name: snap.name,
    visible: snap.visible,
    locked: snap.locked,
    naturalWidth: snap.naturalWidth,
    naturalHeight: snap.naturalHeight,
    imageMaskIds: snap.imageMaskIds ? [...snap.imageMaskIds] : [],
    isMaskFor: snap.isMaskFor,
    isSvg: snap.isSvg,
    isColorSeparation: snap.isColorSeparation,
    separationColors: snap.separationColors ? [...snap.separationColors] : [],
    isText: snap.isText,
    text: snap.text,
    textFontFamily: snap.textFontFamily,
    textFontSize: snap.textFontSize,
    textFontWeight: snap.textFontWeight,
    textFontStyle: snap.textFontStyle,
    textLetterSpacing: snap.textLetterSpacing,
    textLineHeight: snap.textLineHeight,
    textAlign: snap.textAlign,
  });

  // Restore mask canvas if image data was saved
  if (snap._maskImageData && layer._maskCanvas) {
    try {
      const ctx = layer._maskCanvas.getContext('2d');
      ctx.putImageData(snap._maskImageData, 0, 0);
      DB.saveMask(layer);
    } catch (_e) {
      // ignore
    }
  }

  if (layer.isText) {
    layer._originalCanvas = null;
    layer._exportOriginalCanvas = null;
  }
  layer._dirty = true;
  UI.refreshProperties();
  Renderer.schedule();
  DB.saveLayer(layer);
}

function applyStateSnapshot(snap) {
  // Restore the exact layer instances (preserving canvas data)
  State.layers = [...snap.layers];
  State.selectedId = snap.selectedId;
  State.selectedIds = [...snap.selectedIds];
  UI.refreshLayerList();
  UI.refreshProperties();
  Renderer.schedule();
  // Persist restored order and selection
  if (State.project) {
    DB.put('projects', { ...State.project, updatedAt: Date.now(), layerOrder: State.layers.map(l => l.id) });
  }
}

export function undo() {
  if (!State.undoStack.length) return;
  const snap = State.undoStack.pop();

  if (snap._type === 'state') {
    // Push current state onto redo stack
    State.redoStack.push({
      _type: 'state',
      layers: [...State.layers],
      selectedId: State.selectedId,
      selectedIds: [...State.selectedIds],
    });
    applyStateSnapshot(snap);
    return;
  }

  const layer = State.layers.find(l => l.id === snap.id);
  if (!layer) return;
  State.redoStack.push(snapshotLayer(layer));
  applySnapshot(layer, snap);
}

export function redo() {
  if (!State.redoStack.length) return;
  const snap = State.redoStack.pop();

  if (snap._type === 'state') {
    // Push current state onto undo stack
    State.undoStack.push({
      _type: 'state',
      layers: [...State.layers],
      selectedId: State.selectedId,
      selectedIds: [...State.selectedIds],
    });
    applyStateSnapshot(snap);
    return;
  }

  const layer = State.layers.find(l => l.id === snap.id);
  if (!layer) return;
  State.undoStack.push(snapshotLayer(layer));
  applySnapshot(layer, snap);
}
