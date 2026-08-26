/* ═══════════════════════════════════════════════════════════════════
   Shape utilities: geometry and bitmap rendering for shape layers.

   Shapes are parametric: their artwork is ALWAYS regenerated from the
   layer record (type, sides, star ratio, traced path, stroke width)
   rather than baked into stored blobs. Every consumer — screen render,
   plate export, project load — goes through the same functions here,
   so a shape cannot render differently in one place than another.

   Ink colors are NOT baked into bitmaps. Bitmaps are black artwork on
   white; colorization happens in ImageProcessor via the standard render
   chain. Two-tone shapes are split into a 'fill' channel and a 'stroke'
   channel, each colorized with its own riso ink.
   ═══════════════════════════════════════════════════════════════════ */

import { DB } from './db.js';
import { Renderer } from './renderer.js';
import { MaskEngine } from './mask-engine.js';

export function drawShapePath(ctx, tool, w, h, sides, isStar, starRatio, layer = null) {
  if (tool === 'custom-path' && layer?.shapePath) {
    for (const contour of layer.shapePath) {
      contour.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
    }
    return;
  }
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

/**
 * A shape is "two-tone" when both fill and border are enabled with distinct
 * colors. Such shapes render through two per-ink channels (see
 * ImageProcessor.processShapePart) instead of the single-ink pipeline.
 */
export function isTwoToneShape(layer) {
  return !!(layer && layer.isShape && layer.shapeHasFill && layer.shapeHasStroke &&
    layer.shapeFillColor && layer.shapeStrokeColor &&
    layer.shapeFillColor.toLowerCase() !== layer.shapeStrokeColor.toLowerCase());
}

/**
 * Border width in DOCUMENT pixels. Converted once at creation time from the
 * screen-pixel tool setting; rendering never scales it by the current zoom,
 * so a shape's printed border does not change as you zoom around.
 */
export function shapeStrokeWidthDoc(layer) {
  return Math.max(1, layer?.shapeStrokeWidth ?? 4);
}

/**
 * Render one channel of a shape layer as black artwork on a white background.
 *
 *   part = 'union'  → fill body + border ring (the layer's full silhouette),
 *                     honoring shapeHasFill / shapeHasStroke
 *   part = 'fill'   → fill body only
 *   part = 'stroke' → border ring only
 *
 * All channels of a layer share identical geometry (translation/padding), so
 * the fill and stroke plates line up when overprinted.
 */
export function renderShapeLayerBitmap(layer, part = 'union') {
  const w = layer.naturalWidth || Math.ceil(layer.width);
  const h = layer.naturalHeight || Math.ceil(layer.height);
  if (!w || !h) return null;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  // White background → colorize() maps white (gray≥128) to transparent,
  // black shape pixels (gray<128) to the channel's riso ink.
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  const docStrokeWidth = shapeStrokeWidthDoc(layer);
  const pad = layer.shapeHasStroke ? Math.ceil(docStrokeWidth / 2) : 0;
  ctx.save();
  if (layer.shapeType === 'custom-path') {
    // Traced outlines are stored in full-canvas coordinates; don't inset them
    // (a small stroke overshoot at the edges is preferable to misalignment).
    ctx.beginPath();
    drawShapePath(ctx, 'custom-path', w, h, layer.shapeSides, layer.shapeIsStar, layer.shapeStarRatio, layer);
  } else {
    ctx.translate(pad, pad);
    ctx.beginPath();
    drawShapePath(ctx, layer.shapeType, w - pad * 2, h - pad * 2, layer.shapeSides, layer.shapeIsStar, layer.shapeStarRatio, layer);
  }
  const doFill = part === 'fill' || (part === 'union' && layer.shapeHasFill);
  const doStroke = part === 'stroke' || (part === 'union' && layer.shapeHasStroke);
  if (doFill) {
    ctx.fillStyle = '#000000';
    ctx.fill();
  }
  if (doStroke) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = docStrokeWidth;
    ctx.stroke();
  }
  ctx.restore();
  return canvas;
}

/**
 * The single ink color used when a shape is NOT rendered two-tone:
 * the body color if filled, otherwise the border color.
 */
export function effectiveShapeColor(layer) {
  if (!layer) return '#010101';
  return (layer.shapeHasFill && layer.shapeFillColor) ? layer.shapeFillColor
    : (layer.shapeStrokeColor || layer.color || '#010101');
}

/**
 * Regenerate a shape layer's artwork from its geometry and persist it.
 * Called whenever shape properties change and when restoring undo snapshots.
 */
export async function rerenderShapeLayer(layer) {
  if (!layer || !layer.isShape) return;
  const bitmap = renderShapeLayerBitmap(layer, 'union');
  if (!bitmap) return;
  // Keep the layer's main ink color in sync for the single-color pipeline.
  if (!isTwoToneShape(layer)) {
    layer.color = effectiveShapeColor(layer);
  } else {
    layer.color = layer.shapeFillColor || layer.color;
  }
  layer._originalCanvas = bitmap;
  if (!layer._maskCanvas) {
    MaskEngine.initMask(layer);
  }
  const blob = await bitmap.convertToBlob({ type: 'image/png' });
  await DB.put('imageBlobs', { layerId: layer.id, blob });
  await DB.saveLayer(layer);
  layer._dirty = true;
  Renderer.schedule();
}
