/* ═══════════════════════════════════════════════════════════════════
   Application state
   ═══════════════════════════════════════════════════════════════════ */

export const State = {
  db: null,
  project: null,
  layers: [],          // LayerObject[] ordered bottom→top (active page)
  pages: [],           // lightweight Page metadata cache
  pageId: null,        // active page id (left page when viewing a spread)
  unitId: null,        // active editor unit id (spread or single page)
  spreadView: false,   // when true, the active unit is a spread
  booklet: { binding: 'saddle-stitch', targetSheetSize: 'letter', pagesPerSheet: 1 },
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
  textDrag: null,      // active {startX,startY} while dragging out a new text box
  textEditingId: null, // id of the text layer currently being edited on-canvas
  showMargins: false,
  showGrid: false,
  margins: { top: 300, right: 300, bottom: 300, left: 300 }, // 0.5 in @ 600 dpi
  grid: { size: 150, type: 'standard' }, // 0.25 in @ 600 dpi
  spreadSplitX: 0,
};

export function selectedLayer() {
  return State.layers.find(l => l.id === State.selectedId) || null;
}
