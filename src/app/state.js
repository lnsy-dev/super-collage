/* ═══════════════════════════════════════════════════════════════════
   Application state
   ═══════════════════════════════════════════════════════════════════ */

export const State = {
  db: null,
  project: null,
  layers: [],          // LayerObject[] ordered bottom→top
  selectedId: null,
  selectedIds: [],     // IDs for multi-select (shift+click)
  tool: 'select',
  brushSize: 30,
  zoom: 0.15,
  renderPending: false,
  zoomDebounceTimer: null,
  undoStack: [],
  redoStack: [],
  drag: null,
  lastMaskPt: null,
  shapeMode: 'fill',
  shapeStrokeWidth: 4,
  shapeSides: 6,
  shapeIsStar: false,
  shapeStarRatio: 0.4,
  shapeDrag: null,
};

export function selectedLayer() {
  return State.layers.find(l => l.id === State.selectedId) || null;
}
