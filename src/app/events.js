/* ═══════════════════════════════════════════════════════════════════
   Events & Interaction
   ═══════════════════════════════════════════════════════════════════ */

import { State, selectedLayer } from './state.js';
import { UI, renderGradientBar, refreshGradientEditor, refreshPatternEditor, showKofiToast, populateVariantSelect } from './ui.js';
import { Renderer, Transform, overlayCanvas } from './renderer.js';
import { MaskEngine } from './mask-engine.js';
import { LayerManager } from './layer-manager.js';
import { ImageProcessor } from './image-processor.js';
import { undo, redo, pushUndo, snapshotLayer, pushUndoWithMask } from './undo.js';
import { handleAction, applyMargins, applyGrid, updateViewMenuLabels } from './actions.js';
import { CANVAS_W, CANVAS_H, CANVAS_PAD, RISO_COLORS, PAGE_SIZE_DIMS } from './constants.js';
import { showProjectDialog, _selProjectId, openProject, loadProjectList, updateExportLayoutInfo, updateCompositeLayoutInfo } from './project-manager.js';
import { PageManager } from './page-manager.js';
import { DB } from './db.js';

/* ─── MULTI-TOUCH POINTER TRACKING ─────────────────────────────────
   Tracks every active pointer on the canvas overlay so we can detect a
   two-finger gesture and pan the viewport instead of manipulating layers. */
const activePointers = new Map();
let panState = null;
// While a multi-touch gesture is active, suppress single-pointer actions until
// every finger has lifted, so a leftover finger after a pan doesn't paint/drag.
let suppressUntilLift = false;

function pointersMidpoint() {
  let sx = 0, sy = 0;
  for (const p of activePointers.values()) { sx += p.x; sy += p.y; }
  const n = activePointers.size || 1;
  return { x: sx / n, y: sy / n };
}

function beginPan() {
  // Abort any in-progress single-pointer interaction — the gesture is a pan.
  State.drag = null;
  State.shapeDrag = null;
  State.lastMaskPt = null;
  suppressUntilLift = true;
  Renderer.drawOverlay();
  const scroll = document.getElementById('canvas-scroll');
  const mid = pointersMidpoint();
  panState = {
    startMidX: mid.x, startMidY: mid.y,
    startScrollLeft: scroll.scrollLeft,
    startScrollTop: scroll.scrollTop,
  };
}

export function drawShapePath(ctx, tool, w, h, sides, isStar, starRatio) {
  if (tool === 'shape-rect') {
    ctx.rect(0, 0, w, h);
  } else if (tool === 'shape-ellipse') {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (tool === 'shape-poly') {
    const cx = w / 2, cy = h / 2;
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR * starRatio;
    const n = Math.max(3, Math.round(sides));
    const points = isStar ? n * 2 : n;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
      const r = (isStar && i % 2 === 1) ? innerR : outerR;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
}

export function renderShapeToCanvas(tool, w, h) {
  const sw = State.shapeStrokeWidth;
  const isFill = State.shapeMode === 'fill';
  const pad = isFill ? 0 : Math.ceil(sw / 2);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  // White background → colorize() maps white (gray≥128) to transparent,
  // black shape pixels (gray<128) to the riso ink color.
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(pad, pad);
  const dw = w - pad * 2, dh = h - pad * 2;
  ctx.beginPath();
  drawShapePath(ctx, tool, dw, dh, State.shapeSides, State.shapeIsStar, State.shapeStarRatio);
  if (isFill) {
    ctx.fillStyle = 'black';
    ctx.fill();
  } else {
    ctx.strokeStyle = 'black';
    ctx.lineWidth = sw;
    ctx.stroke();
  }
  ctx.restore();
  return canvas;
}

export function drawShapePreview(x0, y0, x1, y1) {
  Renderer.drawOverlay();
  const ctx = overlayCanvas.getContext('2d');
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (w < 2 || h < 2) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  drawShapePath(ctx, State.tool, w, h, State.shapeSides, State.shapeIsStar, State.shapeStarRatio);
  ctx.strokeStyle = 'rgba(0,120,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.restore();
}

export function getCanvasXY(e) {
  const rect = overlayCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// Returns snapshots of all selected layers except the primary one.
export function getExtraSnaps(primaryId) {
  return State.selectedIds
    .filter(id => id !== primaryId)
    .map(id => {
      const l = State.layers.find(x => x.id === id);
      return l ? { id: l.id, x: l.x, y: l.y, width: l.width, height: l.height, rotation: l.rotation } : null;
    })
    .filter(Boolean);
}

function onPointerDown(e) {
  e.preventDefault();
  overlayCanvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // Second finger down → switch to two-finger viewport panning.
  if (activePointers.size >= 2) {
    beginPan();
    return;
  }

  const { x, y } = getCanvasXY(e);
  const layer = selectedLayer();

  if (State.tool.startsWith('shape-')) {
    State.shapeDrag = { startX: x, startY: y };
    return;
  }

  if (State.tool === 'mask-draw' || State.tool === 'mask-erase') {
    if (!layer) return;
    pushUndoWithMask(layer);
    const local = Transform.toLocal(x, y, layer, State.zoom);
    const lx = local.x * (layer.naturalWidth / layer.width);
    const ly = local.y * (layer.naturalHeight / layer.height);
    MaskEngine._paint(layer, lx, ly, State.brushSize / 2, State.tool === 'mask-erase');
    State.lastMaskPt = { x: lx, y: ly };
    Renderer.schedule();
    return;
  }

  if (layer && !layer.locked) {
    // Coarse pointers (finger) need a larger handle hit area than a mouse.
    const tol = e.pointerType === 'touch' ? 16 : (e.pointerType === 'pen' ? 11 : 8);
    const handle = Renderer.hitTestHandle(x, y, layer, tol);
    if (handle) {
      pushUndo(snapshotLayer(layer));
      const extraSnaps = getExtraSnaps(layer.id);
      extraSnaps.forEach(es => {
        const el = State.layers.find(l => l.id === es.id);
        if (el) pushUndo(snapshotLayer(el));
      });
      const dragState = {
        type: handle.id === 'rotate' ? 'rotate' : 'resize',
        handleId: handle.id,
        startX: x, startY: y,
        layerSnap: { ...layer },
        extraSnaps,
      };
      if (handle.id === 'rotate') {
        const cx = (layer.x + layer.width / 2) * State.zoom;
        const cy = (layer.y + layer.height / 2) * State.zoom;
        dragState.startAngle = Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90;
        dragState.extraSnapRotations = extraSnaps.map(es => es.rotation);
      }
      State.drag = dragState;
      return;
    }
  }

  const hit = Renderer.hitTestLayer(x, y);
  if (hit) {
    if (e.shiftKey) {
      const idx = State.selectedIds.indexOf(hit.id);
      if (idx === -1) {
        State.selectedIds.push(hit.id);
        State.selectedId = hit.id;
      } else {
        State.selectedIds.splice(idx, 1);
        State.selectedId = State.selectedIds[State.selectedIds.length - 1] || null;
      }
    } else {
      State.selectedId = hit.id;
      State.selectedIds = [hit.id];
    }
    // Only start a drag if the hit layer is still selected after toggle/select.
    if (State.selectedIds.includes(hit.id)) {
      pushUndo(snapshotLayer(hit));
      const extraSnaps = getExtraSnaps(hit.id);
      extraSnaps.forEach(es => {
        const el = State.layers.find(l => l.id === es.id);
        if (el) pushUndo(snapshotLayer(el));
      });
      State.drag = { type: 'move', startX: x, startY: y, layerSnap: { x: hit.x, y: hit.y }, extraSnaps };
    }
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.drawOverlay();
  } else {
    State.selectedId = null;
    State.selectedIds = [];
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.drawOverlay();
  }
}

function onPointerMove(e) {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  // Two-finger pan: scroll the viewport by the midpoint delta.
  if (panState) {
    const scroll = document.getElementById('canvas-scroll');
    const mid = pointersMidpoint();
    scroll.scrollLeft = panState.startScrollLeft - (mid.x - panState.startMidX);
    scroll.scrollTop  = panState.startScrollTop  - (mid.y - panState.startMidY);
    return;
  }

  // A multi-touch gesture is winding down — ignore the leftover finger.
  if (suppressUntilLift) return;

  const { x, y } = getCanvasXY(e);
  document.getElementById('status-pos').textContent =
    Math.round(x / State.zoom - CANVAS_PAD) + ', ' + Math.round(y / State.zoom - CANVAS_PAD);

  if (State.tool === 'mask-draw' || State.tool === 'mask-erase') {
    const wrapperRect = document.getElementById('canvas-wrapper').getBoundingClientRect();
    const bc = document.getElementById('brush-cursor');
    bc.style.left = (e.clientX - wrapperRect.left) + 'px';
    bc.style.top  = (e.clientY - wrapperRect.top)  + 'px';
  }

  if (State.shapeDrag && (e.buttons & 1)) {
    drawShapePreview(State.shapeDrag.startX, State.shapeDrag.startY, x, y);
    return;
  }

  if ((State.tool === 'mask-draw' || State.tool === 'mask-erase') && (e.buttons & 1)) {
    const layer = selectedLayer();
    if (!layer) return;
    const local = Transform.toLocal(x, y, layer, State.zoom);
    const lx = local.x * (layer.naturalWidth / layer.width);
    const ly = local.y * (layer.naturalHeight / layer.height);
    const isErasing = State.tool === 'mask-erase';
    if (State.lastMaskPt) {
      MaskEngine.paintStroke(layer, State.lastMaskPt.x, State.lastMaskPt.y, lx, ly, State.brushSize / 2, isErasing);
    } else {
      MaskEngine._paint(layer, lx, ly, State.brushSize / 2, isErasing);
    }
    State.lastMaskPt = { x: lx, y: ly };
    Renderer.schedule();
    return;
  }

  if (!State.drag) return;
  const layer = selectedLayer();
  if (!layer) return;
  const z = State.zoom;
  const dx = x - State.drag.startX;
  const dy = y - State.drag.startY;
  const snap = State.drag.layerSnap;

  if (State.drag.type === 'move') {
    layer.x = snap.x + dx / z;
    layer.y = snap.y + dy / z;
    // Move all other selected layers by the same delta
    for (const es of (State.drag.extraSnaps || [])) {
      const el = State.layers.find(l => l.id === es.id);
      if (el) { el.x = es.x + dx / z; el.y = es.y + dy / z; }
    }
  } else if (State.drag.type === 'rotate') {
    const cx = (layer.x + layer.width / 2) * z;
    const cy = (layer.y + layer.height / 2) * z;
    const angle = Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90;
    layer.rotation = e.shiftKey ? Math.round(angle / 15) * 15 : angle;
    // Apply the same rotation delta to all other selected layers
    const rotDelta = angle - (State.drag.startAngle || 0);
    const extraRotations = State.drag.extraSnapRotations || [];
    (State.drag.extraSnaps || []).forEach((es, i) => {
      const el = State.layers.find(l => l.id === es.id);
      if (!el) return;
      const newRot = (extraRotations[i] ?? es.rotation) + rotDelta;
      el.rotation = e.shiftKey ? Math.round(newRot / 15) * 15 : newRot;
    });
  } else if (State.drag.type === 'resize') {
    const dxF = dx / z, dyF = dy / z;
    const id = State.drag.handleId;
    const ar = snap.width / snap.height; // original aspect ratio
    const corners = ['tl', 'tr', 'bl', 'br'];
    if (corners.includes(id)) {
      // Corner handles: preserve aspect ratio, driven by the larger drag axis
      if (id === 'br') {
        const newW = Math.max(10, snap.width + dxF);
        const newH = Math.max(10, newW / ar);
        layer.width = newW; layer.height = newH;
      } else if (id === 'tl') {
        const newW = Math.max(10, snap.width - dxF);
        const newH = Math.max(10, newW / ar);
        layer.x = snap.x + (snap.width - newW);
        layer.y = snap.y + (snap.height - newH);
        layer.width = newW; layer.height = newH;
      } else if (id === 'tr') {
        const newW = Math.max(10, snap.width + dxF);
        const newH = Math.max(10, newW / ar);
        layer.y = snap.y + (snap.height - newH);
        layer.width = newW; layer.height = newH;
      } else if (id === 'bl') {
        const newW = Math.max(10, snap.width - dxF);
        const newH = Math.max(10, newW / ar);
        layer.x = snap.x + (snap.width - newW);
        layer.width = newW; layer.height = newH;
      }
    } else {
      // Edge handles: free resize (no ratio constraint)
      if (id === 'mr') { layer.width = Math.max(10, snap.width + dxF); }
      else if (id === 'ml') { layer.x = snap.x + dxF; layer.width = Math.max(10, snap.width - dxF); }
      else if (id === 'bm') { layer.height = Math.max(10, snap.height + dyF); }
      else if (id === 'tm') { layer.y = snap.y + dyF; layer.height = Math.max(10, snap.height - dyF); }
    }
    if (layer.isText) {
      layer.naturalWidth = layer.width;
      layer.naturalHeight = layer.height;
    }
    // Apply same scale factor and position delta to all other selected layers
    const scaleX = layer.width / snap.width;
    const scaleY = layer.height / snap.height;
    const posDx = layer.x - snap.x;
    const posDy = layer.y - snap.y;
    for (const es of (State.drag.extraSnaps || [])) {
      const el = State.layers.find(l => l.id === es.id);
      if (!el) continue;
      el.width  = Math.max(10, es.width  * scaleX);
      el.height = Math.max(10, es.height * scaleY);
      el.x = es.x + posDx;
      el.y = es.y + posDy;
      if (el.isText) {
        el.naturalWidth = el.width;
        el.naturalHeight = el.height;
      }
    }
  }

  UI.refreshProperties();
  Renderer.schedule();
}

async function onPointerUp(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) suppressUntilLift = false;

  // End (or step down from) a two-finger pan.
  if (panState) {
    if (activePointers.size < 2) panState = null;
    return;
  }

  if (State.shapeDrag) {
    const { x, y } = getCanvasXY(e);
    const { startX, startY } = State.shapeDrag;
    State.shapeDrag = null;
    Renderer.drawOverlay();
    const sw = Math.abs(x - startX), sh = Math.abs(y - startY);
    if (sw >= 4 && sh >= 4) {
      const cx = Math.round(Math.min(startX, x) / State.zoom - CANVAS_PAD);
      const cy = Math.round(Math.min(startY, y) / State.zoom - CANVAS_PAD);
      const cw = Math.max(1, Math.round(sw / State.zoom));
      const ch = Math.max(1, Math.round(sh / State.zoom));
      const shapeCanvas = renderShapeToCanvas(State.tool, cw, ch);
      await LayerManager.addShape(shapeCanvas, cx, cy, cw, ch);
      UI.setTool('move');
    }
    return;
  }
  if (State.tool === 'mask-draw' || State.tool === 'mask-erase') {
    State.lastMaskPt = null;
    const layer = selectedLayer();
    if (layer && (e.type !== 'pointerleave' || e.buttons === 0)) DB.saveMask(layer);
    return;
  }
  if (State.drag) {
    const layer = selectedLayer();
    if (layer) DB.saveLayer(layer);
    for (const es of (State.drag.extraSnaps || [])) {
      const el = State.layers.find(l => l.id === es.id);
      if (el) DB.saveLayer(el);
    }
    if (State.drag.type === 'resize') {
      // Re-render text layers only after the user releases the handle,
      // keeping drag interactions fast on large pages.
      if (layer && layer.isText) {
        layer.naturalWidth = layer.width;
        layer.naturalHeight = layer.height;
        layer._dirty = true;
      }
      for (const es of (State.drag.extraSnaps || [])) {
        const el = State.layers.find(l => l.id === es.id);
        if (el && el.isText) {
          el.naturalWidth = el.width;
          el.naturalHeight = el.height;
          el._dirty = true;
        }
      }
      Renderer.schedule();
    }
  }
  State.drag = null;
}

export function wireControls() {
  // Re-render when user scrolls so viewport culling re-evaluates
  document.getElementById('canvas-scroll').addEventListener('scroll', () => Renderer.schedule(), { passive: true });

  // Canvas pointer events
  overlayCanvas.addEventListener('pointerdown', onPointerDown);
  overlayCanvas.addEventListener('pointermove', onPointerMove);
  overlayCanvas.addEventListener('pointerup',   onPointerUp);
  overlayCanvas.addEventListener('pointercancel', onPointerUp);
  overlayCanvas.addEventListener('pointerleave', e => { if (!(e.buttons & 1)) onPointerUp(e); });

  /* ─── LAYER LIST DRAG-AND-DROP REORDERING ──────────────────────── */
  const layerList = document.getElementById('layer-list');
  let draggedLayerId = null;

  function clearDragIndicators() {
    layerList.querySelectorAll('.layer-row').forEach(r => {
      r.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  }

  layerList.addEventListener('dragstart', e => {
    const row = e.target.closest('.layer-row');
    if (!row) return;
    const layer = State.layers.find(l => l.id === row.dataset.layerId);
    if (!layer || layer.locked) {
      e.preventDefault();
      return;
    }
    draggedLayerId = layer.id;
    UI._suppressLayerClick = true;
    e.dataTransfer.setData('text/plain', layer.id);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });

  layerList.addEventListener('dragend', e => {
    const row = e.target.closest('.layer-row');
    if (row) row.classList.remove('dragging');
    clearDragIndicators();
    draggedLayerId = null;
    // Delay clearing the click guard so any post-drag click is ignored
    setTimeout(() => { UI._suppressLayerClick = false; }, 0);
  });

  layerList.addEventListener('dragover', e => {
    e.preventDefault();
    if (!draggedLayerId) return;
    e.dataTransfer.dropEffect = 'move';

    const row = e.target.closest('.layer-row');
    clearDragIndicators();
    if (!row) return;

    const rect = row.getBoundingClientRect();
    const overTop = e.clientY < rect.top + rect.height / 2;
    row.classList.add(overTop ? 'drag-over-top' : 'drag-over-bottom');
  });

  layerList.addEventListener('dragleave', e => {
    const row = e.target.closest('.layer-row');
    if (row && !layerList.contains(e.relatedTarget)) {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    }
  });

  layerList.addEventListener('drop', e => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain') || draggedLayerId;
    const row = e.target.closest('.layer-row');
    clearDragIndicators();
    draggedLayerId = null;
    if (!sourceId) return;

    const N = State.layers.length;
    let targetStateIndex;
    if (row) {
      const domIdx = [...layerList.querySelectorAll('.layer-row')].indexOf(row);
      const overTop = e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      const slot = overTop ? domIdx : domIdx + 1;
      targetStateIndex = N - slot;
    } else {
      // Dropped in empty list space → move to bottom (index 0 in State.layers)
      targetStateIndex = 0;
    }

    LayerManager.moveToIndex(sourceId, targetStateIndex);
  });

  /* ─── PAGE LIST DRAG-AND-DROP REORDERING ─────────────────────────── */
  const pageList = document.getElementById('page-list');
  let draggedPageId = null;

  function clearPageDragIndicators() {
    pageList.querySelectorAll('.page-row').forEach(r => {
      r.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  }

  pageList.addEventListener('dragstart', e => {
    const row = e.target.closest('.page-row');
    if (!row) return;
    draggedPageId = row.dataset.pageId;
    UI._suppressLayerClick = true;
    e.dataTransfer.setData('text/plain', draggedPageId);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });

  pageList.addEventListener('dragend', e => {
    const row = e.target.closest('.page-row');
    if (row) row.classList.remove('dragging');
    clearPageDragIndicators();
    draggedPageId = null;
    setTimeout(() => { UI._suppressLayerClick = false; }, 0);
  });

  pageList.addEventListener('dragover', e => {
    e.preventDefault();
    if (!draggedPageId) return;
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest('.page-row');
    clearPageDragIndicators();
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const overTop = e.clientY < rect.top + rect.height / 2;
    row.classList.add(overTop ? 'drag-over-top' : 'drag-over-bottom');
  });

  pageList.addEventListener('dragleave', e => {
    const row = e.target.closest('.page-row');
    if (row && !pageList.contains(e.relatedTarget)) {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    }
  });

  pageList.addEventListener('drop', e => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain') || draggedPageId;
    const row = e.target.closest('.page-row');
    clearPageDragIndicators();
    draggedPageId = null;
    if (!sourceId) return;

    const rows = [...pageList.querySelectorAll('.page-row')];
    const sourceIdx = rows.findIndex(r => r.dataset.pageId === sourceId);
    if (sourceIdx === -1) return;

    let targetIdx;
    if (row) {
      const domIdx = rows.indexOf(row);
      const overTop = e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      targetIdx = overTop ? domIdx : domIdx + 1;
    } else {
      targetIdx = rows.length;
    }

    if (targetIdx === sourceIdx || targetIdx === sourceIdx + 1) return;

    const order = State.project.pageOrder.filter(id => id !== sourceId);
    let insertIdx = targetIdx;
    if (targetIdx > sourceIdx) insertIdx--;
    insertIdx = Math.max(0, Math.min(order.length, insertIdx));
    order.splice(insertIdx, 0, sourceId);

    PageManager.reorderPages(order).then(() => {
      State.pages.sort((a, b) => {
        const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
        return ai - bi;
      });
      UI.refreshPageList();
    });
  });

  document.querySelectorAll('.close-box').forEach(box => {
    box.addEventListener('click', () => {
      document.getElementById('main-app').style.display = 'none';
      showProjectDialog();
    });
  });

  function numField(id, field) {
    document.getElementById(id).addEventListener('change', e => {
      const l = selectedLayer(); if (!l) return;
      pushUndo(snapshotLayer(l));
      l[field] = parseFloat(e.target.value) || 0;
      if (l.isText && (field === 'width' || field === 'height')) {
        l.naturalWidth = l.width;
        l.naturalHeight = l.height;
        l._dirty = true;
      }
      DB.saveLayer(l);
      Renderer.schedule();
    });
  }
  function rangeField(id, field, valId) {
    let pushed = false;
    document.getElementById(id).addEventListener('input', e => {
      const l = selectedLayer(); if (!l) return;
      if (!pushed) { pushUndo(snapshotLayer(l)); pushed = true; }
      l[field] = parseFloat(e.target.value);
      document.getElementById(valId).textContent = e.target.value;
      l._dirty = true;
      Renderer.schedule();
    });
    document.getElementById(id).addEventListener('change', () => {
      pushed = false;
      const l = selectedLayer(); if (l) DB.saveLayer(l);
    });
  }

  numField('prop-x', 'x'); numField('prop-y', 'y');
  numField('prop-w', 'width'); numField('prop-h', 'height');
  numField('prop-rot', 'rotation');
  rangeField('prop-brightness', 'brightness', 'val-brightness');
  rangeField('prop-contrast',   'contrast',   'val-contrast');

  document.getElementById('btn-invert-image').addEventListener('click', () => {
    const l = selectedLayer(); if (!l) return;
    pushUndo(snapshotLayer(l));
    l.invert = !l.invert;
    l._dirty = true;
    UI.refreshProperties();
    Renderer.schedule();
    DB.saveLayer(l);
  });
  rangeField('prop-halftone-size', 'halftoneSize', 'val-halftone-size');
  rangeField('prop-halftone-angle', 'halftoneAngle', 'val-halftone-angle');

  document.querySelectorAll('.halftone-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const l = selectedLayer(); if (!l) return;
      pushUndo(snapshotLayer(l));
      l.halftoneType = btn.dataset.halftone;
      l._dirty = true;
      document.querySelectorAll('.halftone-opt').forEach(b => b.classList.toggle('active', b === btn));
      const isGrayscale = btn.dataset.halftone === 'grayscale';
      document.getElementById('halftone-size-row').classList.toggle('hidden', isGrayscale);
      document.getElementById('halftone-angle-row')?.classList.toggle('hidden', isGrayscale);
      DB.saveLayer(l);
      Renderer.schedule();
    });
  });

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const l = selectedLayer(); if (!l) return;
      pushUndo(snapshotLayer(l));
      l.color = sw.dataset.color;
      l._dirty = true;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s === sw));
      DB.saveLayer(l);
      UI.refreshLayerList();
      Renderer.schedule();
    });
  });

  // Text layer property controls
  function updateTextField(field, value, parser = v => v) {
    const l = selectedLayer(); if (!l || !l.isText) return;
    pushUndo(snapshotLayer(l));
    l[field] = parser(value);
    l._originalCanvas = null;
    l._exportOriginalCanvas = null;
    l._dirty = true;
    DB.saveLayer(l);
    Renderer.schedule();
  }

  document.getElementById('prop-text')?.addEventListener('input', e => {
    updateTextField('text', e.target.value);
  });
  document.getElementById('prop-text-font')?.addEventListener('change', e => {
    const font = e.target.value;
    updateTextField('textFontFamily', font);
    const layer = selectedLayer();
    populateVariantSelect(font, layer?.textFontWeight ?? 400, layer?.textFontStyle);
    const [weight, style] = document.getElementById('prop-text-variant').value.split(':');
    updateTextField('textFontWeight', weight, parseInt);
    updateTextField('textFontStyle', style);
  });
  document.getElementById('prop-text-size-range')?.addEventListener('input', e => {
    document.getElementById('prop-text-size').value = e.target.value;
    updateTextField('textFontSize', e.target.value, parseFloat);
  });
  document.getElementById('prop-text-size')?.addEventListener('change', e => {
    document.getElementById('prop-text-size-range').value = e.target.value;
    updateTextField('textFontSize', e.target.value, parseFloat);
  });
  document.getElementById('prop-text-variant')?.addEventListener('change', e => {
    const [weight, style] = e.target.value.split(':');
    updateTextField('textFontWeight', weight, parseInt);
    updateTextField('textFontStyle', style);
  });
  document.getElementById('prop-text-spacing')?.addEventListener('change', e => {
    updateTextField('textLetterSpacing', e.target.value, parseFloat);
  });
  document.getElementById('prop-text-leading')?.addEventListener('change', e => {
    updateTextField('textLineHeight', e.target.value, parseFloat);
  });
  document.getElementById('prop-text-align')?.addEventListener('change', e => {
    updateTextField('textAlign', e.target.value);
  });

  document.getElementById('brush-size-input').addEventListener('input', e => {
    State.brushSize = parseInt(e.target.value);
    document.getElementById('brush-size-val').textContent = State.brushSize;
    updateBrushCursorSize();
  });

  /* ── Brush cursor ── */
  const brushCursor = document.getElementById('brush-cursor');

  function isMaskTool() {
    return State.tool === 'mask-draw' || State.tool === 'mask-erase';
  }

  function updateBrushCursorSize() {
    const px = State.brushSize * State.zoom;
    brushCursor.style.width  = px + 'px';
    brushCursor.style.height = px + 'px';
  }

  overlayCanvas.addEventListener('mousemove', e => {
    if (!isMaskTool()) return;
    const wrapperRect = document.getElementById('canvas-wrapper').getBoundingClientRect();
    brushCursor.style.left = (e.clientX - wrapperRect.left)  + 'px';
    brushCursor.style.top  = (e.clientY - wrapperRect.top)   + 'px';
  });

  overlayCanvas.addEventListener('mouseenter', e => {
    if (!isMaskTool()) return;
    updateBrushCursorSize();
    brushCursor.style.display = 'block';
  });

  overlayCanvas.addEventListener('mouseleave', () => {
    brushCursor.style.display = 'none';
  });

  // Shape tool options
  document.getElementById('shape-fill-btn').addEventListener('click', () => {
    State.shapeMode = 'fill';
    document.getElementById('shape-fill-btn').classList.add('active');
    document.getElementById('shape-outline-btn').classList.remove('active');
    document.getElementById('shape-stroke-row').style.display = 'none';
  });
  document.getElementById('shape-outline-btn').addEventListener('click', () => {
    State.shapeMode = 'outline';
    document.getElementById('shape-outline-btn').classList.add('active');
    document.getElementById('shape-fill-btn').classList.remove('active');
    document.getElementById('shape-stroke-row').style.display = '';
  });
  document.getElementById('shape-stroke-input').addEventListener('input', e => {
    State.shapeStrokeWidth = parseInt(e.target.value);
    document.getElementById('shape-stroke-val').textContent = State.shapeStrokeWidth;
  });
  document.getElementById('poly-sides-input').addEventListener('input', e => {
    State.shapeSides = Math.max(3, Math.min(20, parseInt(e.target.value) || 6));
  });
  document.getElementById('poly-star-toggle').addEventListener('change', e => {
    State.shapeIsStar = e.target.checked;
    document.getElementById('star-ratio-row').style.display = State.shapeIsStar ? '' : 'none';
  });
  document.getElementById('star-ratio-input').addEventListener('input', e => {
    State.shapeStarRatio = parseInt(e.target.value) / 100;
    document.getElementById('star-ratio-val').textContent = e.target.value + '%';
  });

  // ── Gradient: mode toggle ─────────────────────────────────────────
  document.getElementById('btn-mode-solid').addEventListener('click', () => {
    const l = selectedLayer(); if (!l) return;
    pushUndo(snapshotLayer(l));
    l.colorMode = 'solid'; l._dirty = true;
    DB.saveLayer(l); UI.refreshLayerList(); UI.refreshProperties(); Renderer.schedule();
  });
  document.getElementById('btn-mode-gradient').addEventListener('click', () => {
    const l = selectedLayer(); if (!l) return;
    pushUndo(snapshotLayer(l));
    l.colorMode = 'gradient'; l._dirty = true;
    DB.saveLayer(l); UI.refreshLayerList(); UI.refreshProperties(); Renderer.schedule();
  });
  document.getElementById('btn-mode-pattern').addEventListener('click', () => {
    const l = selectedLayer(); if (!l) return;
    pushUndo(snapshotLayer(l));
    l.colorMode = 'pattern'; l._dirty = true;
    DB.saveLayer(l); UI.refreshLayerList(); UI.refreshProperties(); Renderer.schedule();
  });

  // ── Gradient: type buttons ────────────────────────────────────────
  document.querySelectorAll('.grad-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const l = selectedLayer(); if (!l) return;
      pushUndo(snapshotLayer(l));
      l.gradient.type = btn.dataset.gradType; l._dirty = true;
      document.querySelectorAll('.grad-type-btn').forEach(b => b.classList.toggle('active', b === btn));
      refreshGradientEditor(l); DB.saveLayer(l); Renderer.schedule();
    });
  });

  // ── Gradient: angle slider ────────────────────────────────────────
  let gradAnglePushed = false;
  document.getElementById('grad-angle').addEventListener('input', e => {
    const l = selectedLayer(); if (!l) return;
    if (!gradAnglePushed) { pushUndo(snapshotLayer(l)); gradAnglePushed = true; }
    l.gradient.angle = parseInt(e.target.value);
    document.getElementById('val-grad-angle').textContent = l.gradient.angle + '°';
    l._dirty = true; renderGradientBar(l); Renderer.schedule();
  });
  document.getElementById('grad-angle').addEventListener('change', () => {
    gradAnglePushed = false;
    const l = selectedLayer(); if (l) DB.saveLayer(l);
  });

  // ── Gradient: center sliders ──────────────────────────────────────
  let gradCxPushed = false;
  document.getElementById('grad-cx').addEventListener('input', e => {
    const l = selectedLayer(); if (!l) return;
    if (!gradCxPushed) { pushUndo(snapshotLayer(l)); gradCxPushed = true; }
    l.gradient.centerX = parseInt(e.target.value) / 100;
    l._dirty = true; renderGradientBar(l); Renderer.schedule();
  });
  document.getElementById('grad-cx').addEventListener('change', () => {
    gradCxPushed = false;
    const l = selectedLayer(); if (l) DB.saveLayer(l);
  });
  let gradCyPushed = false;
  document.getElementById('grad-cy').addEventListener('input', e => {
    const l = selectedLayer(); if (!l) return;
    if (!gradCyPushed) { pushUndo(snapshotLayer(l)); gradCyPushed = true; }
    l.gradient.centerY = parseInt(e.target.value) / 100;
    l._dirty = true; renderGradientBar(l); Renderer.schedule();
  });
  document.getElementById('grad-cy').addEventListener('change', () => {
    gradCyPushed = false;
    const l = selectedLayer(); if (l) DB.saveLayer(l);
  });

  // ── Gradient: add stop ────────────────────────────────────────────
  document.getElementById('btn-add-stop').addEventListener('click', () => {
    const l = selectedLayer(); if (!l) return;
    pushUndo(snapshotLayer(l));
    const stops = l.gradient.stops;
    // Insert new stop between last two
    const last = stops[stops.length - 1].position;
    const prev = stops[stops.length - 2].position;
    stops.splice(stops.length - 1, 0, { color: RISO_COLORS[0].hex, position: (last + prev) / 2 });
    l._dirty = true; refreshGradientEditor(l); DB.saveLayer(l); Renderer.schedule();
  });

  // ── Gradient: stop list event delegation ─────────────────────────
  document.getElementById('gradient-stop-list').addEventListener('click', e => {
    const risoSw = e.target.closest('.stop-riso-sw');
    if (risoSw) {
      const l = selectedLayer(); if (!l) return;
      pushUndo(snapshotLayer(l));
      const idx = parseInt(risoSw.dataset.stopIdx);
      l.gradient.stops[idx].color = risoSw.dataset.risoColor;
      l._dirty = true; refreshGradientEditor(l); DB.saveLayer(l); Renderer.schedule();
      return;
    }
    const removeBtn = e.target.closest('.stop-remove-btn');
    if (removeBtn && !removeBtn.disabled) {
      const l = selectedLayer(); if (!l) return;
      pushUndo(snapshotLayer(l));
      const idx = parseInt(removeBtn.dataset.stopIdx);
      if (l.gradient.stops.length > 2) {
        l.gradient.stops.splice(idx, 1);
        l._dirty = true; refreshGradientEditor(l); DB.saveLayer(l); Renderer.schedule();
      }
    }
  });

  // ── Gradient bar: drag to reposition stops ────────────────────────
  const gradBarCanvas = document.getElementById('gradient-bar-canvas');
  let gradDrag = null;
  gradBarCanvas.addEventListener('pointerdown', e => {
    const l = selectedLayer(); if (!l || l.colorMode !== 'gradient') return;
    const rect = gradBarCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = gradBarCanvas.offsetWidth || 160;
    const stops = l.gradient.stops;
    let hitIdx = -1, minDist = Infinity;
    stops.forEach((s, i) => {
      const d = Math.abs(s.position * w - x);
      if (d < 10 && d < minDist) { minDist = d; hitIdx = i; }
    });
    if (hitIdx === -1) return;
    pushUndo(snapshotLayer(l));
    gradBarCanvas.setPointerCapture(e.pointerId);
    gradDrag = { stopIdx: hitIdx };
    e.preventDefault();
  });
  gradBarCanvas.addEventListener('pointermove', e => {
    if (!gradDrag) return;
    const l = selectedLayer(); if (!l) return;
    const rect = gradBarCanvas.getBoundingClientRect();
    const w = gradBarCanvas.offsetWidth || 160;
    const x = Math.max(0, Math.min(w, e.clientX - rect.left));
    l.gradient.stops[gradDrag.stopIdx].position = x / w;
    l.gradient.stops.sort((a, b) => a.position - b.position);
    l._dirty = true; refreshGradientEditor(l); Renderer.schedule();
  });
  gradBarCanvas.addEventListener('pointerup', () => {
    if (gradDrag) { const l = selectedLayer(); if (l) DB.saveLayer(l); gradDrag = null; }
  });
  gradBarCanvas.addEventListener('pointercancel', () => {
    if (gradDrag) { const l = selectedLayer(); if (l) DB.saveLayer(l); gradDrag = null; }
  });

  // ── Pattern: type buttons ─────────────────────────────────────────
  document.querySelectorAll('.pat-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const l = selectedLayer(); if (!l) return;
      pushUndo(snapshotLayer(l));
      l.pattern.type = btn.dataset.patType; l._dirty = true;
      document.querySelectorAll('.pat-type-btn').forEach(b => b.classList.toggle('active', b === btn));
      refreshPatternEditor(l); DB.saveLayer(l); Renderer.schedule();
    });
  });

  // ── Pattern: color swatches ───────────────────────────────────────
  document.getElementById('pat-color1-swatches').addEventListener('click', e => {
    const sw = e.target.closest('.pat-color-sw');
    if (!sw) return;
    const l = selectedLayer(); if (!l) return;
    pushUndo(snapshotLayer(l));
    l.pattern.color1 = sw.dataset.patColor; l._dirty = true;
    refreshPatternEditor(l); DB.saveLayer(l); UI.refreshLayerList(); Renderer.schedule();
  });
  document.getElementById('pat-color2-swatches').addEventListener('click', e => {
    const sw = e.target.closest('.pat-color-sw');
    if (!sw) return;
    const l = selectedLayer(); if (!l) return;
    pushUndo(snapshotLayer(l));
    l.pattern.color2 = sw.dataset.patColor; l._dirty = true;
    refreshPatternEditor(l); DB.saveLayer(l); UI.refreshLayerList(); Renderer.schedule();
  });

  // ── Pattern: size slider ──────────────────────────────────────────
  let patSizePushed = false;
  document.getElementById('pat-size').addEventListener('input', e => {
    const l = selectedLayer(); if (!l) return;
    if (!patSizePushed) { pushUndo(snapshotLayer(l)); patSizePushed = true; }
    l.pattern.size = parseInt(e.target.value);
    document.getElementById('val-pat-size').textContent = l.pattern.size;
  });
  document.getElementById('pat-size').addEventListener('change', e => {
    patSizePushed = false;
    const l = selectedLayer(); if (!l) return;
    l._dirty = true; Renderer.schedule(); DB.saveLayer(l);
  });

  // ── Pattern: angle slider ─────────────────────────────────────────
  let patAnglePushed = false;
  document.getElementById('pat-angle').addEventListener('input', e => {
    const l = selectedLayer(); if (!l) return;
    if (!patAnglePushed) { pushUndo(snapshotLayer(l)); patAnglePushed = true; }
    l.pattern.angle = parseInt(e.target.value);
    document.getElementById('val-pat-angle').textContent = l.pattern.angle + '°';
  });
  document.getElementById('pat-angle').addEventListener('change', e => {
    patAnglePushed = false;
    const l = selectedLayer(); if (!l) return;
    l._dirty = true; Renderer.schedule(); DB.saveLayer(l);
  });

  // ── Custom size toggles ───────────────────────────────────────────
  document.querySelectorAll('input[name="new-page-size"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isCustom = document.querySelector('input[name="new-page-size"]:checked')?.value === 'custom';
      document.getElementById('custom-size-row').style.display = isCustom ? 'flex' : 'none';
    });
  });

  // ── Project dialog buttons ────────────────────────────────────────
  document.getElementById('btn-create-project').addEventListener('click', async e => {
    const btn = e.currentTarget;
    const name = document.getElementById('new-project-name').value.trim();
    if (!name) { document.getElementById('new-project-name').focus(); return; }
    btn.disabled = true;
    try {
      const pageSize = document.querySelector('input[name="new-page-size"]:checked')?.value || 'letter';
      const pageCount = parseInt(document.querySelector('input[name="new-page-count"]:checked')?.value || '1', 10);
      const project = {
        id: crypto.randomUUID(),
        name,
        pageSize,
        pageOrder: [],
        booklet: { binding: 'saddle-stitch', targetSheetSize: 'letter', pagesPerSheet: 1 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      let dims = PAGE_SIZE_DIMS[pageSize];
      if (pageSize === 'custom') {
        const wIn = parseFloat(document.getElementById('custom-width').value);
        const hIn = parseFloat(document.getElementById('custom-height').value);
        if (!wIn || !hIn || wIn < 1 || hIn < 1 || wIn > 100 || hIn > 100) {
          alert('Please enter valid dimensions between 1 and 100 inches.');
          return;
        }
        project.customW = Math.round(wIn * 600);
        project.customH = Math.round(hIn * 600);
        dims = { w: project.customW, h: project.customH };
      }
      if (!dims) dims = PAGE_SIZE_DIMS['letter'];

      await DB.put('projects', project);

      // Create requested number of blank pages.
      const pages = await PageManager.createPages(project.id, pageCount, dims.w, dims.h);
      project.pageOrder = pages.map(p => p.id);
      await DB.put('projects', project);

      document.getElementById('new-project-name').value = '';
      await openProject(project.id);
      showKofiToast();
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-open-project').addEventListener('click', () => {
    if (_selProjectId) openProject(_selProjectId);
  });

  document.getElementById('btn-delete-project').addEventListener('click', async () => {
    if (!_selProjectId) return;
    if (!confirm('Delete this project and all its layers? This cannot be undone.')) return;
    await DB.deleteProject(_selProjectId);
    if (State.project?.id === _selProjectId) { State.project = null; State.layers = []; State.selectedId = null; }
    await loadProjectList();
  });

  document.getElementById('new-project-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-create-project').click(); }
  });

  // ── Export dialog controls ────────────────────────────────────────
  document.getElementById('export-target-size')?.addEventListener('change', updateExportLayoutInfo);
  document.getElementById('export-custom-width')?.addEventListener('change', updateExportLayoutInfo);
  document.getElementById('export-custom-height')?.addEventListener('change', updateExportLayoutInfo);
  document.querySelectorAll('input[name="export-binding"]').forEach(r =>
    r.addEventListener('change', updateExportLayoutInfo));
  document.querySelectorAll('input[name="export-booklet-layout"]').forEach(r =>
    r.addEventListener('change', updateExportLayoutInfo));

  // ── Composite export dialog controls ──────────────────────────────
  document.getElementById('composite-target-size')?.addEventListener('change', updateCompositeLayoutInfo);
  document.getElementById('composite-custom-width')?.addEventListener('change', updateCompositeLayoutInfo);
  document.getElementById('composite-custom-height')?.addEventListener('change', updateCompositeLayoutInfo);
  document.querySelectorAll('input[name="composite-booklet-layout"]').forEach(r =>
    r.addEventListener('change', updateCompositeLayoutInfo));

  // ── Export dialog buttons ─────────────────────────────────────────
  document.getElementById('btn-export-cancel').addEventListener('click', () =>
    document.getElementById('export-dialog').classList.add('hidden'));

  document.getElementById('btn-export-go').addEventListener('click', async () => {
    document.getElementById('btn-export-go').disabled = true;
    await ExportEngine.export();
  });

  document.getElementById('btn-composite-cancel').addEventListener('click', () =>
    document.getElementById('composite-export-dialog').classList.add('hidden'));

  document.getElementById('btn-composite-go').addEventListener('click', async () => {
    document.getElementById('btn-composite-go').disabled = true;
    await ExportEngine.exportComposite();
  });

  // ── Menus ─────────────────────────────────────────────────────────
  document.querySelectorAll('.menu-item[data-menu]').forEach(item => {
    item.addEventListener('click', e => {
      const wasActive = item.classList.contains('active');
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
      if (!wasActive) item.classList.add('active');
      e.stopPropagation();
    });
  });
  document.addEventListener('click', () =>
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active')));

  document.querySelectorAll('.menu-entry[data-action]').forEach(el => {
    el.addEventListener('click', e => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
      handleAction(el.dataset.action);
      e.stopPropagation();
    });
  });

  // Update View menu labels when the menu opens
  document.querySelector('.menu-item[data-menu="view"]')?.addEventListener('click', () => {
    updateViewMenuLabels();
  });

  // ── Margin / Grid dialogs ─────────────────────────────────────────
  function hideDialog(id) { document.getElementById(id).classList.add('hidden'); }
  document.getElementById('btn-margins-ok')?.addEventListener('click', () => { applyMargins(); hideDialog('margins-dialog'); });
  document.getElementById('btn-margins-cancel')?.addEventListener('click', () => hideDialog('margins-dialog'));
  document.getElementById('margins-dialog')?.addEventListener('click', e => { if (e.target === document.getElementById('margins-dialog')) hideDialog('margins-dialog'); });
  document.getElementById('btn-grid-ok')?.addEventListener('click', () => { applyGrid(); hideDialog('grid-dialog'); });
  document.getElementById('btn-grid-cancel')?.addEventListener('click', () => hideDialog('grid-dialog'));
  document.getElementById('grid-dialog')?.addEventListener('click', e => { if (e.target === document.getElementById('grid-dialog')) hideDialog('grid-dialog'); });

  // ── Toolbar & panel buttons ───────────────────────────────────────
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn =>
    btn.addEventListener('click', () => UI.setTool(btn.dataset.tool)));

  // All data-action buttons outside menus
  document.querySelectorAll('[data-action]:not(.menu-entry):not(.tool-btn):not(.halftone-opt):not(.color-swatch)').forEach(el =>
    el.addEventListener('click', () => handleAction(el.dataset.action)));

  // ── File input & drag/drop ────────────────────────────────────────
  document.getElementById('file-input').addEventListener('change', async e => {
    for (const file of e.target.files) await LayerManager.addFromFile(file);
    e.target.value = '';
  });

  document.getElementById('color-sep-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) await LayerManager.addColorSeparation(file);
    e.target.value = '';
  });

  const wrapper = document.getElementById('canvas-wrapper');
  wrapper.addEventListener('dragover', e => e.preventDefault());
  wrapper.addEventListener('drop', async e => {
    e.preventDefault();
    if (!State.project) return;
    for (const file of e.dataTransfer.files)
      if (file.type.startsWith('image/')) await LayerManager.addFromFile(file);
  });

  // ── Paste from clipboard ─────────────────────────────────────────
  document.addEventListener('paste', async e => {
    if (!State.project) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf('image') === -1) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      e.preventDefault();
      const file = new File([blob], 'Pasted Image.png', { type: blob.type });
      await LayerManager.addFromFile(file);
      break;
    }
  });

  // ── Keyboard shortcuts ───────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd) {
      if (e.key === 'v' || e.key === 'V') UI.setTool('select');
      if (e.key === 'm' || e.key === 'M') UI.setTool('move');
      if (e.key === 'b' || e.key === 'B') UI.setTool('mask-draw');
      if (e.key === 'e' || e.key === 'E') UI.setTool('mask-erase');
      if (e.key === 'r' || e.key === 'R') UI.setTool('shape-rect');
      if (e.key === 'o' || e.key === 'O') UI.setTool('shape-ellipse');
      if (e.key === 'p' || e.key === 'P') UI.setTool('shape-poly');
      return;
    }
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); }
    if (e.key === 'i') { e.preventDefault(); handleAction('add-image'); }
    if (e.key === 'e') { e.preventDefault(); handleAction('export'); }
    if (e.key === 'd') { e.preventDefault(); handleAction('duplicate-layer'); }
    if (e.key === ']') { e.preventDefault(); handleAction('layer-up'); }
    if (e.key === '[') { e.preventDefault(); handleAction('layer-down'); }
    if (e.key === '=' || e.key === '+') { e.preventDefault(); handleAction('zoom-in'); }
    if (e.key === '-') { e.preventDefault(); handleAction('zoom-out'); }
    if (e.key === '0') { e.preventDefault(); handleAction('zoom-fit'); }
    if (e.key === '1') { e.preventDefault(); handleAction('zoom-100'); }
  });
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey) {
      if (State.tool === 'select' || State.tool === 'move') { e.preventDefault(); handleAction('delete-layer'); }
    }
  });
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
    if (State.tool !== 'select' && State.tool !== 'move') return;
    const ids = State.selectedIds.length ? State.selectedIds : (State.selectedId ? [State.selectedId] : []);
    if (!ids.length) return;
    e.preventDefault();
    const dist = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -dist : e.key === 'ArrowRight' ? dist : 0;
    const dy = e.key === 'ArrowUp' ? -dist : e.key === 'ArrowDown' ? dist : 0;
    for (const id of ids) {
      const layer = State.layers.find(l => l.id === id);
      if (!layer) continue;
      pushUndo(snapshotLayer(layer));
      layer.x += dx;
      layer.y += dy;
      DB.saveLayer(layer);
    }
    Renderer.schedule();
  });
}
