/* ═══════════════════════════════════════════════════════════════════
   Tile planning — split a page into render tiles
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Plan a cols×rows grid of tiles covering width×height exactly, with no
 * gaps or overlaps. Tile origins and sizes are integers; when width/height
 * don't divide evenly the edge tiles absorb the remainder, so the tiles
 * always partition the image. cols/rows of 1 yields a single whole-image
 * tile (the untiled rendering path).
 *
 * Page-space compositing (image-mask buffers, flatten passes, composite
 * blending) is per-pixel independent, so rendering it tile by tile and
 * stitching the tiles into the final canvas is bit-identical to rendering
 * the whole page in one buffer — while the largest intermediate buffer is
 * a tile, not the page.
 */
export function planTiles(width, height, cols = 2, rows = 2) {
  const tiles = [];
  const c0 = Math.max(1, Math.floor(cols));
  const r0 = Math.max(1, Math.floor(rows));
  for (let r = 0; r < r0; r++) {
    const y = Math.round((height * r) / r0);
    const yEnd = Math.round((height * (r + 1)) / r0);
    for (let c = 0; c < c0; c++) {
      const x = Math.round((width * c) / c0);
      const xEnd = Math.round((width * (c + 1)) / c0);
      if (xEnd > x && yEnd > y) {
        tiles.push({ x, y, w: xEnd - x, h: yEnd - y });
      }
    }
  }
  return tiles;
}
