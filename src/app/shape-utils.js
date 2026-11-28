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

// The pure geometry + bitmap half lives in shape-bitmap.js so the process
// worker can import it without pulling in DOM-bound modules; re-exported
// here so existing import sites keep working.
export {
  drawShapePath,
  isTwoToneShape,
  shapeStrokeWidthDoc,
  renderShapeLayerBitmap,
  effectiveShapeColor,
} from './shape-bitmap.js';

import {
  renderShapeLayerBitmap,
  isTwoToneShape,
  effectiveShapeColor,
} from './shape-bitmap.js';

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
