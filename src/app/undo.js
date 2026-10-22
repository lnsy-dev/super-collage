/* ═══════════════════════════════════════════════════════════════════
   Undo / Redo
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { UI } from './ui.js';
import { Renderer } from './renderer.js';
import { PageManager } from './page-manager.js';
import { rerenderShapeLayer } from './shape-utils.js';
import { restoreSvgLayer } from './svg-utils.js';


export function snapshotLayer(layer) { return layer.toRecord(); }

export function pushUndo(snap) {
  State.undoStack.push(snap);
  if (State.undoStack.length > 50) State.undoStack.shift();
  State.redoStack = [];
}

export function pushUndoWithMask(layer) {
  const snap = snapshotLayer(layer);
  // An SVG layer's vector source is not part of its record (it lives in the
  // imageBlobs blob, which flatten overwrites with the rasterised artwork),
  // so carry it in the snapshot for undo to put back.
  if (layer.isSvg && layer._svgText) snap._svgText = layer._svgText;
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

/** Attach the layer's source bitmap to a snapshot as raw ImageData. */
export function attachRaster(snap, layer) {
  const oc = layer._originalCanvas;
  if (!oc) return snap;
  try {
    const ctx = oc.getContext('2d');
    snap._originalImageData = ctx.getImageData(0, 0, oc.width, oc.height);
  } catch (_e) {
    // ignore
  }
  return snap;
}

/**
 * Snapshot a layer record plus its baked source pixels, for tools that
 * mutate the pixel data in place (Color Layer fills). Undone/redoed twins
 * of such snapshots must carry the pixels too — see undo()/redo().
 */
export function pushUndoWithRaster(layer) {
  pushUndo(attachRaster(snapshotLayer(layer), layer));
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
    separationStyle: snap.separationStyle || 'lut',
    halftoneShape: snap.halftoneShape || 'circle',
    ditherMethod: snap.ditherMethod || 'atkinson',
    ditherScale: snap.ditherScale ?? 1,
    ditherThreshold: snap.ditherThreshold ?? 0.5,
    sepAngles: snap.sepAngles ? [...snap.sepAngles] : null,
    posterizeConfig: snap.posterizeConfig ? JSON.parse(JSON.stringify(snap.posterizeConfig)) : null,
    cmykishConfig: snap.cmykishConfig ? JSON.parse(JSON.stringify(snap.cmykishConfig)) : null,
    inkOpacities: snap.inkOpacities ? [...snap.inkOpacities] : null,
    sepPaletteDefault: snap.sepPaletteDefault ? [...snap.sepPaletteDefault] : null,
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
    linkedIds: snap.linkedIds ? [...snap.linkedIds] : [],
    importedGroupId: snap.importedGroupId ?? null,
    isMaskFor: snap.isMaskFor,
    isSvg: snap.isSvg,
    isColorSeparation: snap.isColorSeparation,
    isColorFill: snap.isColorFill || false,
    separationColors: snap.separationColors ? [...snap.separationColors] : [],
    isShape: snap.isShape || false,
    shapeType: snap.shapeType,
    shapeHasFill: snap.shapeHasFill,
    shapeHasStroke: snap.shapeHasStroke,
    shapeStrokeWidth: snap.shapeStrokeWidth,
    shapeStrokeColor: snap.shapeStrokeColor,
    shapeFillColor: snap.shapeFillColor,
    shapeSides: snap.shapeSides,
    shapeIsStar: snap.shapeIsStar,
    shapeStarRatio: snap.shapeStarRatio,
    shapePath: snap.shapePath ? JSON.parse(JSON.stringify(snap.shapePath)) : null,
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

  // Restore baked source pixels if the snapshot carried them (Color Layer
  // fills merge pixels in place; the record alone can't rebuild them). The
  // stored image blob is rewritten too, so a reload shows the same state.
  if (snap._originalImageData) {
    const data = snap._originalImageData;
    const c = new OffscreenCanvas(data.width, data.height);
    c.getContext('2d').putImageData(data, 0, 0);
    layer._originalCanvas = c;
    DB.put('imageBlobs', { layerId: layer.id, blob: await c.convertToBlob({ type: 'image/png' }) })
      .catch(err => console.error('image blob restore failed:', err));
  }

  if (layer.isText) {
    layer._originalCanvas = null;
    layer._exportOriginalCanvas = null;
  }
  if (layer.isShape) {
    await rerenderShapeLayer(layer);
  }
  if (layer.isSvg) {
    // Undoing a flatten flips isSvg back on. The <img> has to be rebuilt and
    // the SVG source put back in storage, or the layer would render as
    // nothing now and break again on the next open.
    await restoreSvgLayer(layer, snap._svgText);
  }
  layer._dirty = true;
  UI.refreshProperties();
  UI.refreshLayerList();
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
    PageManager.saveActivePage();
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
  // Raster-carrying snapshots (Color Layer fills) must keep their pixels in
  // the redo twin, or redo would restore geometry but lose the baked fill.
  State.redoStack.push(snap._originalImageData
    ? attachRaster(snapshotLayer(layer), layer)
    : snapshotLayer(layer));
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
  // Mirror of undo(): raster snapshots keep their pixels in the undo twin.
  State.undoStack.push(snap._originalImageData
    ? attachRaster(snapshotLayer(layer), layer)
    : snapshotLayer(layer));
  applySnapshot(layer, snap);
}
