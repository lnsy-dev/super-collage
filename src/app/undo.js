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

export function applySnapshot(layer, snap) {
  Object.assign(layer, {
    x: snap.x, y: snap.y, width: snap.width, height: snap.height,
    rotation: snap.rotation, flipH: snap.flipH, flipV: snap.flipV,
    brightness: snap.brightness, contrast: snap.contrast, saturation: snap.saturation, invert: snap.invert,
    halftoneType: snap.halftoneType, halftoneSize: snap.halftoneSize, halftoneAngle: snap.halftoneAngle,
    hatchLineHeight: snap.hatchLineHeight, hatchLineLength: snap.hatchLineLength,
    color: snap.color,
    colorMode: snap.colorMode || 'solid',
    gradient: snap.gradient ? JSON.parse(JSON.stringify(snap.gradient)) : layer.gradient,
    pattern: snap.pattern ? JSON.parse(JSON.stringify(snap.pattern)) : layer.pattern,
  });
  layer._dirty = true;
  UI.refreshProperties();
  Renderer.schedule();
  DB.saveLayer(layer);
}

export function undo() {
  if (!State.undoStack.length) return;
  const snap = State.undoStack.pop();
  const layer = State.layers.find(l => l.id === snap.id);
  if (!layer) return;
  State.redoStack.push(snapshotLayer(layer));
  applySnapshot(layer, snap);
}

export function redo() {
  if (!State.redoStack.length) return;
  const snap = State.redoStack.pop();
  const layer = State.layers.find(l => l.id === snap.id);
  if (!layer) return;
  State.undoStack.push(snapshotLayer(layer));
  applySnapshot(layer, snap);
}
