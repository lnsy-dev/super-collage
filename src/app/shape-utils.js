/* ═══════════════════════════════════════════════════════════════════
   Shape utilities: geometry, bitmap rendering, and re-rendering for
   shape layers whose border/fill properties have changed.
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { Renderer } from './renderer.js';
import { MaskEngine } from './mask-engine.js';

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

export function renderShapeToCanvas(tool, w, h, layer = null) {
  // Resolve shape properties from the provided layer or fall back to the active tool state.
  const hasFill = layer ? layer.shapeHasFill : (State.shapeMode !== 'outline');
  const hasStroke = layer ? layer.shapeHasStroke : (State.shapeMode === 'outline');
  const strokeWidth = layer ? (layer.shapeStrokeWidth ?? 4) : State.shapeStrokeWidth;
  const sides = layer ? (layer.shapeSides ?? 6) : State.shapeSides;
  const isStar = layer ? (layer.shapeIsStar || false) : State.shapeIsStar;
  const starRatio = layer ? (layer.shapeStarRatio ?? 0.4) : State.shapeStarRatio;
  // Stroke width is stored in screen pixels; convert to document pixels for rendering.
  const docStrokeWidth = hasStroke ? strokeWidth / State.zoom : 0;
  const pad = hasStroke ? Math.ceil(docStrokeWidth / 2) : 0;
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
  drawShapePath(ctx, tool, dw, dh, sides, isStar, starRatio);
  if (hasFill) {
    ctx.fillStyle = 'black';
    ctx.fill();
  }
  if (hasStroke) {
    ctx.strokeStyle = 'black';
    ctx.lineWidth = docStrokeWidth;
    ctx.stroke();
  }
  ctx.restore();
  return canvas;
}

export async function rerenderShapeLayer(layer) {
  if (!layer || !layer.isShape) return;
  const w = layer.naturalWidth;
  const h = layer.naturalHeight;
  if (!w || !h) return;
  layer._originalCanvas = renderShapeToCanvas(layer.shapeType, w, h, layer);
  if (!layer._maskCanvas) {
    MaskEngine.initMask(layer);
  }
  const blob = await layer._originalCanvas.convertToBlob({ type: 'image/png' });
  await DB.put('imageBlobs', { layerId: layer.id, blob });
  await DB.saveLayer(layer);
  layer._dirty = true;
  Renderer.schedule();
}
