/* ═══════════════════════════════════════════════════════════════════
   Image blob decode helper
   ═══════════════════════════════════════════════════════════════════
   createImageBitmap() can resolve with a *partially decoded* bitmap for
   very large images — observed with a 4096×2867 alpha mask PNG that
   repeatedly decoded white while the stored blob was correct
   (createImageBitmap → drawImage kept sampling alpha 255 where the saved
   bitmap had a painted hole; the same blob decoded through an <img>
   always drew correctly, and the very same createImageBitmap later
   decoded correctly too). Every path that turns a stored blob into
   pixels (mask rehydrate, original canvas restore, separation plates)
   must decode through an <img> + decode(), which does not resolve
   before the full decode completes.
 */

/**
 * Decode an image blob fully, guaranteeing the pixels are ready to draw.
 *
 * @param {Blob} blob
 * @returns {Promise<HTMLImageElement>} a loaded image; use .naturalWidth/
 *   .naturalHeight and draw it directly with drawImage()
 */
export async function decodeImageBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    // img.decode() only resolves once the image is fully decoded, so the
    // createImageBitmap partial-decode race is impossible here.
    await img.decode();
    return img;
  } finally {
    // The image data outlives the object URL once decode() has resolved.
    URL.revokeObjectURL(url);
  }
}
