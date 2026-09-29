/* ═══════════════════════════════════════════════════════════════════
   SVG helpers.

   SVG layers are kept as *vector*: the source file is what gets stored and
   exported, and drawing goes through a live <img> built from it
   (see ImageProcessor). That matters because createImageBitmap() cannot
   decode an SVG blob at all — it rejects with "The source image could not
   be decoded" — so every path that rehydrates an SVG layer from storage
   (open project, import project, duplicate) has to go through here.
   ═══════════════════════════════════════════════════════════════════ */

import { DB } from './db.js';

const SVG_MIME = 'image/svg+xml';

/**
 * Decode an SVG blob into { text, img } — the SVG source and a loaded
 * <img> that can be drawn to a canvas at any size.
 *
 * @param {Blob|string} source the SVG file, or its text
 * @returns {Promise<{text: string, img: HTMLImageElement}>}
 */
export async function loadSvgImage(source) {
  const text = typeof source === 'string' ? source : await source.text();
  const url = URL.createObjectURL(svgBlobFromText(text));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG image failed to load'));
      img.src = url;
    });
    return { text, img };
  } finally {
    // The <img> keeps its own decoded copy once loaded.
    URL.revokeObjectURL(url);
  }
}

/**
 * Rebuild a layer's SVG image from its stored blob.
 *
 * `isSvg` is a *record* flag, but `_svgImage` is in-memory only — anything
 * that flips the flag back on without reloading the file (undo) or drops the
 * image while leaving the layer (flatten) leaves a layer that renders as
 * nothing. The SVG source itself is always still in imageBlobs.
 *
 * @returns {Promise<boolean>} whether the image was rebuilt
 */
export async function rehydrateSvgLayer(layer) {
  if (!layer.isSvg || layer._svgImage) return false;
  const rec = await DB.get('imageBlobs', layer.id);
  // Flatten replaces the stored blob with the rasterised artwork, so the
  // record can say isSvg while the blob is a PNG; decoding that as SVG just
  // throws in the console.
  if (!rec?.blob || rec.blob.type !== SVG_MIME) return false;
  const { text, img } = await loadSvgImage(rec.blob);
  layer._svgText = text;
  layer._svgImage = img;
  return true;
}

/** The stored source for an SVG layer, as text, or null. */
export async function svgSourceOf(layer) {
  const rec = await DB.get('imageBlobs', layer.id);
  if (!rec?.blob || rec.blob.type !== SVG_MIME) return null;
  return rec.blob.text();
}

/** Restore an SVG layer's vector source and put it back in storage. */
export async function restoreSvgLayer(layer, text) {
  const source = text || await svgSourceOf(layer);
  if (!source) return false;
  layer._svgText = source;
  layer._svgImage = (await loadSvgImage(source)).img;
  layer._originalCanvas = null;
  layer._exportOriginalCanvas = null;
  await DB.put('imageBlobs', { layerId: layer.id, blob: svgBlobFromText(source) });
  return true;
}

/** An SVG Blob from SVG source text. */
export function svgBlobFromText(text) {
  return new Blob([text], { type: SVG_MIME });
}
