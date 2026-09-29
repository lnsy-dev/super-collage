/* ═══════════════════════════════════════════════════════════════════
   SVG helpers.

   SVG layers are kept as *vector*: the source file is what gets stored and
   exported, and drawing goes through a live <img> built from it
   (see ImageProcessor). That matters because createImageBitmap() cannot
   decode an SVG blob at all — it rejects with "The source image could not
   be decoded" — so every path that rehydrates an SVG layer from storage
   (open project, import project, duplicate) has to go through here.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Decode an SVG blob into { text, img } — the SVG source and a loaded
 * <img> that can be drawn to a canvas at any size.
 *
 * @param {Blob|string} source the SVG file, or its text
 * @returns {Promise<{text: string, img: HTMLImageElement}>}
 */
export async function loadSvgImage(source) {
  const text = typeof source === 'string' ? source : await source.text();
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
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
