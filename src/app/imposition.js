/* ═══════════════════════════════════════════════════════════════════
   Imposition — reader pages → printer sheets
   Pure, unit-testable geometry helpers.
   ═══════════════════════════════════════════════════════════════════ */

import { PAGE_SIZE_DIMS } from './constants.js';

export const SHEET_SIZE_DIMS = {
  'letter':  { w: 5100, h: 6600 },
  'legal':   { w: 5100, h: 8400 },
  'tabloid': { w: 6600, h: 10200 },
  'a4':      { w: 4961, h: 7016 },
  'a3':      { w: 7016, h: 9921 },
};

/**
 * Multi-page-per-side saddle-stitch / booklet layouts.
 *
 * Each layout describes how one block of `perSheet` reader pages maps onto
 * the front and back of a single physical sheet. `front` and `back` are arrays
 * of block indices (0-indexed) read left-to-right, top-to-bottom.
 * `rotations` gives clockwise rotation in degrees for each corresponding
 * block index. `cols`/`rows` describe the grid on each sheet side.
 *
 * The blocks are built from the centre of the booklet outward (matching
 * bookbinder-js), and the resulting sheets are then reversed so the outermost
 * sheet is emitted first. The sole exception is the `folio` layout, which uses
 * the classic zine order: cover sheet first, left-to-right, outside-then-inside.
 */
export const BOOKLET_LAYOUTS = {
  // Folio / zine: 2 pages per side, 4 per sheet.
  // Block for sheet s (outer-to-inner): [N-2s-1, N-2s, 2s+1, 2s+2]
  folio: {
    perSheet: 4,
    cols: 2,
    rows: 1,
    zine: true,
    front: [1, 2], // [N, 1]
    back: [3, 0],  // [2, N-1]
    rotations: [0, 0, 0, 0],
  },
  // Quarto: 4 pages per side, 8 per sheet.
  // Adapted from bookbinder-js BOOKLET_LAYOUTS[8].
  quarto: {
    perSheet: 8,
    cols: 2,
    rows: 2,
    front: [5, 2, 6, 1], // [6,3,7,2] 0-indexed
    back: [7, 0, 4, 3],  // [8,1,5,4] 0-indexed
    rotations: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Octavo: 8 pages per side, 16 per sheet.
  // Adapted from bookbinder-js BOOKLET_LAYOUTS[16].
  octavo: {
    perSheet: 16,
    cols: 4,
    rows: 2,
    front: [2, 5, 13, 10, 14, 9, 1, 6],  // [3,6,14,11,15,10,2,7]
    back: [0, 7, 15, 8, 12, 11, 3, 4],  // [1,8,16,9,13,12,4,5]
    rotations: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};

/**
 * Return the saddle-stitch printer order for a given reader page count.
 * Pads to the next multiple of 4 with blank slots (represented by null).
 * Example: 4 pages → [4, 1, 2, 3] (first sheet outside=left=page4, outside=right=page1,
 *                                    inside=left=page2, inside=right=page3)
 */
export function saddleStitchOrder(pageCount) {
  const padded = Math.ceil(pageCount / 4) * 4;
  const order = [];
  for (let sheet = 0; sheet < padded / 4; sheet++) {
    const n = padded;
    const frontLeft = n - sheet * 2;       // biggest on the outside left
    const frontRight = sheet * 2 + 1;      // smallest on the outside right
    const backLeft = sheet * 2 + 2;        // inside left
    const backRight = n - sheet * 2 - 1;   // inside right
    order.push(
      frontLeft > pageCount ? null : frontLeft - 1,
      frontRight > pageCount ? null : frontRight - 1,
      backLeft > pageCount ? null : backLeft - 1,
      backRight > pageCount ? null : backRight - 1
    );
  }
  return order;
}

function getSheetDims(targetSheetSize, customW, customH) {
  if (targetSheetSize === 'custom' && customW && customH) {
    return { w: customW, h: customH };
  }
  return SHEET_SIZE_DIMS[targetSheetSize] || SHEET_SIZE_DIMS['letter'];
}

/**
 * Compute the best N-up layout for page (pageW x pageH) on a sheet (sheetW x sheetH).
 * Tries both orientations of the page AND both orientations of the target sheet,
 * never scaling pages above 100% (pages are drawn at native or rotated-native size,
 * letterboxed if the cell is larger, scaled down only if they cannot fit).
 * Returns { cols, rows, pagesPerSheet, pageRotated, sheetW, sheetH }.
 */
export function calculateLayout(pageW, pageH, targetSheetSize, customTargetW, customTargetH) {
  const dims = getSheetDims(targetSheetSize, customTargetW, customTargetH);

  let best = { cols: 1, rows: 1, pagesPerSheet: 1, pageRotated: false, sheetW: dims.w, sheetH: dims.h };
  let bestScore = -1;

  const sheetConfigs = [
    { w: dims.w, h: dims.h },
    { w: dims.h, h: dims.w }, // rotated sheet
  ];
  const pageConfigs = [
    { w: pageW, h: pageH, rotated: false },
    { w: pageH, h: pageW, rotated: true },
  ];

  for (const sheet of sheetConfigs) {
    for (const page of pageConfigs) {
      const cols = Math.floor(sheet.w / page.w);
      const rows = Math.floor(sheet.h / page.h);
      const count = Math.max(1, cols * rows);
      // If neither orientation fits unscaled, mark as a fallback (low score).
      const fits = cols >= 1 && rows >= 1;
      const usedArea = count * page.w * page.h;
      const sheetArea = sheet.w * sheet.h;
      const efficiency = usedArea / sheetArea;
      // Prefer more pages, then better efficiency, then unrotated page.
      const score = (fits ? count : 0) * 1000 + efficiency + (page.rotated ? 0 : 0.001);
      if (score > bestScore) {
        bestScore = score;
        best = {
          cols: fits ? cols : 1,
          rows: fits ? rows : 1,
          pagesPerSheet: count,
          pageRotated: page.rotated,
          sheetW: sheet.w,
          sheetH: sheet.h,
          pageW,
          pageH,
        };
      }
    }
  }

  return best;
}

/**
 * Compute the best paper orientation and page rotation for a booklet layout.
 * Unlike calculateLayout — which is free to pick any N-up grid — a booklet
 * layout's grid is fixed by its fold structure (folio = 2 cells side by side,
 * quarto = 2×2, octavo = 4×2), so only the paper orientation and the page
 * rotation can vary. Pages are never scaled above 100%; `scale` is 1 when
 * every cell of the grid fits the page unscaled, and below 1 when the paper
 * is too small (callers use that to disallow the combination).
 * Returns { cols, rows, pageRotated, sheetW, sheetH, scale }.
 */
export function calculateBookletLayout(pageW, pageH, bookletLayout, targetSheetSize, customTargetW, customTargetH) {
  const spec = BOOKLET_LAYOUTS[bookletLayout] || BOOKLET_LAYOUTS.folio;
  const dims = getSheetDims(targetSheetSize, customTargetW, customTargetH);

  let best = { cols: spec.cols, rows: spec.rows, pageRotated: false, sheetW: dims.w, sheetH: dims.h, scale: 0 };
  let bestScore = -1;

  const sheetConfigs = [
    { w: dims.w, h: dims.h, natural: true },
    { w: dims.h, h: dims.w, natural: false },
  ];
  const pageConfigs = [
    { w: pageW, h: pageH, rotated: false },
    { w: pageH, h: pageW, rotated: true },
  ];

  for (const sheet of sheetConfigs) {
    for (const page of pageConfigs) {
      const cellW = sheet.w / spec.cols;
      const cellH = sheet.h / spec.rows;
      const scale = Math.min(1, cellW / page.w, cellH / page.h);
      // Prefer the largest scale, then upright pages, then the paper's
      // natural orientation.
      const score = scale * 100 + (page.rotated ? 0 : 10) + (sheet.natural ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = {
          cols: spec.cols,
          rows: spec.rows,
          pageRotated: page.rotated,
          sheetW: sheet.w,
          sheetH: sheet.h,
          pageW,
          pageH,
          scale,
        };
      }
    }
  }

  return best;
}

/**
 * Build printer sheets from an array of page canvases.
 * Options:
 *   binding: 'saddle-stitch'
 *   targetSheetSize: 'letter' | 'legal' | 'tabloid' | 'custom'
 *   customTargetW, customTargetH: number (px @ 600 DPI)
 *   bleed: number (px gutter, default 0)
 *   bookletLayout: 'folio' | 'quarto' | 'octavo' (saddle-stitch only)
 *
 * Returns array of OffscreenCanvas (one per physical sheet side).
 */
export function buildSheets(pages, options = {}) {
  const {
    binding = 'saddle-stitch',
    targetSheetSize = 'letter',
    customTargetW = 0,
    customTargetH = 0,
    bleed = 0,
    bookletLayout = 'folio',
  } = options;

  if (!pages || !pages.length) return [];

  const firstPage = pages.find(p => p);
  if (!firstPage) return [];
  const pageW = firstPage.width;
  const pageH = firstPage.height;
  const layout = binding === 'saddle-stitch'
    ? calculateBookletLayout(pageW, pageH, bookletLayout, targetSheetSize, customTargetW, customTargetH)
    : calculateLayout(pageW, pageH, targetSheetSize, customTargetW, customTargetH);

  const plan = computeSheetPlan(pages.length, layout, binding, bookletLayout, bleed);
  return plan.map(side => renderSheetSide(side, i => pages[i] || null));
}

/**
 * Compute WHERE every reader page lands on every printable sheet side,
 * without rendering anything. One side descriptor per downloadable PNG:
 *   { sheetW, sheetH, pageRotated, bleed, cells: [{ pageIndex, cellX, cellY,
 *     cellW, cellH, extraRotation }] }
 * Cell geometry is final — renderSheetSide draws the cells verbatim, so the
 * plan and buildSheets cannot drift apart. Used by buildSheets and by the
 * streaming plate exporter, which renders pages on demand instead of holding
 * every page plate in memory.
 */
export function computeSheetPlan(pageCount, layout, binding, bookletLayout, bleed = 0) {
  const { sheetW, sheetH, pageRotated } = layout;
  if (binding === 'saddle-stitch') {
    const spec = BOOKLET_LAYOUTS[bookletLayout] || BOOKLET_LAYOUTS.folio;
    if (spec.zine) return _zineSheetPlan(pageCount, spec, layout, bleed);
    return _bookletSheetPlan(pageCount, spec, layout, bleed);
  }
  return _gridSheetPlan(pageCount, layout, bleed);
}

/**
 * Fitted page footprint for a butted booklet grid. `fw × fh` is the page's
 * footprint in sheet space (rotation swaps the axes); the page is scaled down
 * only when it cannot fill its cell at 100%, preserving aspect ratio.
 */
function _buttedDrawSize(layout, cols, rows, bleed) {
  const { sheetW, sheetH, pageRotated, pageW, pageH } = layout;
  const fw = pageRotated ? pageH : pageW;
  const fh = pageRotated ? pageW : pageH;
  const gutter = bleed > 0 ? bleed : 0;
  const cellW = sheetW / cols;
  const cellH = sheetH / rows;
  // Without page dims (layout built by calculateLayout for a plain grid)
  // treat the cell itself as the footprint.
  if (!fw || !fh) return { fw: cellW, fh: cellH, drawW: cellW, drawH: cellH };
  const availW = Math.max(1, cellW - bleed / 2 - gutter);
  const availH = Math.max(1, cellH - gutter);
  const scale = Math.min(1, availW / fw, availH / fh);
  return { fw, fh, drawW: fw * scale, drawH: fh * scale };
}

function _zineSheetPlan(pageCount, spec, layout, bleed) {
  // Classic zine folio: 2 pages per side, cover sheet first. Pages butt
  // against the centre fold — no gap at the fold — and the pair is centered
  // on the sheet both horizontally and vertically.
  const order = saddleStitchOrder(pageCount);
  const { sheetW, sheetH, pageRotated } = layout;
  const halfW = sheetW / 2;
  const { drawW, drawH } = _buttedDrawSize(layout, spec.cols, spec.rows, bleed);
  // Tight cells (plus a bleed gutter for drawPageInCell to trim inside) keep
  // drawPageInCell's own centering from opening a fold gap.
  const cellW = drawW + bleed;
  const cellH = drawH + bleed;
  const cellY = (sheetH - drawH) / 2 - bleed / 2;
  const sides = [];
  for (let i = 0; i < order.length; i += 2) {
    const cells = [];
    if (order[i] !== null) {
      cells.push({
        pageIndex: order[i],
        cellX: halfW - drawW - bleed / 2,
        cellY,
        cellW,
        cellH,
        extraRotation: 0,
      });
    }
    if (order[i + 1] !== null) {
      cells.push({
        pageIndex: order[i + 1],
        cellX: halfW - bleed / 2,
        cellY,
        cellW,
        cellH,
        extraRotation: 0,
      });
    }
    sides.push({ sheetW, sheetH, pageRotated, bleed, cells });
  }
  return sides;
}

function _bookletSheetPlan(pageCount, spec, layout, bleed) {
  // Center-out booklet layouts (quarto, octavo) adapted from bookbinder-js.
  // Pages butt against their fold neighbours (both axes) and the whole grid
  // is centered on the sheet.
  const k = spec.perSheet / 2;
  const padded = Math.ceil(pageCount / spec.perSheet) * spec.perSheet;
  const sheetCount = padded / spec.perSheet;
  const center = padded / 2;
  const { sheetW, sheetH, pageRotated } = layout;
  const { drawW, drawH } = _buttedDrawSize(layout, spec.cols, spec.rows, bleed);
  const originX = (sheetW - spec.cols * drawW) / 2;
  const originY = (sheetH - spec.rows * drawH) / 2;

  const mkSideCells = (block, indices) => indices.map((blockPos, i) => ({
    // `blockPos` indexes the front+back block of reader page slots; rotations
    // are keyed by the same block position (bookbinder-js convention).
    pageIndex: block[blockPos],
    cellX: originX + (i % spec.cols) * drawW - bleed / 2,
    cellY: originY + Math.floor(i / spec.cols) * drawH - bleed / 2,
    cellW: drawW + bleed,
    cellH: drawH + bleed,
    extraRotation: (spec.rotations[blockPos] || 0) * Math.PI / 180,
  }));

  const innerSides = [];
  for (let innerS = 0; innerS < sheetCount; innerS++) {
    const frontStart = center - k * (innerS + 1);
    const frontEnd = center - k * innerS;
    const backStart = center + k * innerS;
    const backEnd = center + k * (innerS + 1);

    const block = [];
    for (let i = frontStart; i < frontEnd; i++) block.push(i >= 0 && i < pageCount ? i : null);
    for (let i = backStart; i < backEnd; i++) block.push(i >= 0 && i < pageCount ? i : null);

    innerSides.push(
      { sheetW, sheetH, pageRotated, bleed, cells: mkSideCells(block, spec.front) },
      { sheetW, sheetH, pageRotated, bleed, cells: mkSideCells(block, spec.back) }
    );
  }

  // Reverse so outermost sheet is first; keep front/back pairs intact.
  const sides = [];
  for (let i = innerSides.length - 2; i >= 0; i -= 2) {
    sides.push(innerSides[i], innerSides[i + 1]);
  }
  return sides;
}

function _gridSheetPlan(pageCount, layout, bleed) {
  const { cols, rows, pagesPerSheet, sheetW, sheetH, pageRotated } = layout;
  const cellW = sheetW / cols;
  const cellH = sheetH / rows;
  const sides = [];
  for (let i = 0; i < pageCount; i += pagesPerSheet) {
    const cells = [];
    for (let j = 0; j < pagesPerSheet && i + j < pageCount; j++) {
      cells.push({
        pageIndex: i + j,
        cellX: (j % cols) * cellW,
        cellY: Math.floor(j / cols) * cellH,
        cellW,
        cellH,
        extraRotation: 0,
      });
    }
    sides.push({ sheetW, sheetH, pageRotated, bleed, cells });
  }
  return sides;
}

/**
 * Allocate one white sheet-side canvas for a planned side. The streaming
 * exporter draws plates onto this one cell at a time, so no page plates have
 * to be held at the same time.
 */
export function newSheetCanvas(side) {
  const sheet = new OffscreenCanvas(side.sheetW, side.sheetH);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, side.sheetW, side.sheetH);
  return sheet;
}

/**
 * Render one planned sheet side to an OffscreenCanvas. `getPage(pageIndex)`
 * supplies each cell's plate canvas (or null/undefined for a blank cell).
 */
export function renderSheetSide(side, getPage) {
  const { pageRotated, bleed, cells } = side;
  const sheet = newSheetCanvas(side);
  const ctx = sheet.getContext('2d');
  for (const cell of cells) {
    const page = getPage(cell.pageIndex);
    if (!page) continue;
    drawPageInCell(ctx, page, cell, pageRotated, bleed, cell.extraRotation);
  }
  return sheet;
}

/**
 * Draw a page (or one half of a spread) into a sheet cell: fitted, centered,
 * scaled down only when it cannot fit. `src` optionally restricts drawing to a
 * source rectangle, which is how a spread plate is cropped back to one page
 * without allocating an intermediate canvas.
 */
export function drawPageInCell(ctx, page, cell, pageRotated, bleed = 0, extraRotation = 0, src = null) {
  const { cellX, cellY, cellW, cellH } = cell;
  let srcW = src ? src.w : (pageRotated ? page.height : page.width);
  let srcH = src ? src.h : (pageRotated ? page.width : page.height);

  // Account for extra cell rotation: 90°/270° swaps the fitted width/height.
  if (Math.abs(Math.sin(extraRotation)) > 0.5) {
    [srcW, srcH] = [srcH, srcW];
  }

  // Reserve bleed gutters proportionally.
  const gutterX = (cellW > 0 && bleed > 0 ? bleed : 0);
  const gutterY = (cellH > 0 && bleed > 0 ? bleed : 0);
  const availW = Math.max(1, cellW - gutterX);
  const availH = Math.max(1, cellH - gutterY);

  // Scale down only if the page cannot fit; never upscale.
  const scale = Math.min(1, availW / srcW, availH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;

  const x = cellX + (cellW - drawW) / 2;
  const y = cellY + (cellH - drawH) / 2;

  ctx.save();
  ctx.translate(x + drawW / 2, y + drawH / 2);
  ctx.rotate(extraRotation);
  if (pageRotated) ctx.rotate(Math.PI / 2);
  if (src) ctx.drawImage(page, src.x, src.y, src.w, src.h, -drawW / 2, -drawH / 2, drawW, drawH);
  else ctx.drawImage(page, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

/**
 * Compute the best grid for `copies` copies of one image on a target paper.
 * Like calculateLayout, this is the "adjust to the paper" step used when a
 * single image is exported: it tries both orientations of the paper and both
 * orientations of the image, plus every column×row factor pair of `copies`,
 * never scaling the image above 100%. Scores prefer the largest image scale,
 * then the upright image, then the paper's natural orientation, then a
 * vertical arrangement (rows ≥ cols) so copies stack top-to-bottom.
 * Returns { cols, rows, imageRotated, sheetW, sheetH }.
 */
export function calculateSingleImageLayout(imageW, imageH, copies, targetSheetSize, customTargetW, customTargetH) {
  const dims = getSheetDims(targetSheetSize, customTargetW, customTargetH);
  const n = Math.max(1, Math.floor(copies) || 1);

  let best = { cols: 1, rows: n, imageRotated: false, sheetW: dims.w, sheetH: dims.h, scale: 0 };
  let bestScore = -1;
  let bestScale = 0;

  const sheetConfigs = [
    { w: dims.w, h: dims.h, natural: true },
    { w: dims.h, h: dims.w, natural: false },
  ];
  const imageConfigs = [
    { w: imageW, h: imageH, rotated: false },
    { w: imageH, h: imageW, rotated: true },
  ];

  for (const sheet of sheetConfigs) {
    for (const image of imageConfigs) {
      for (let cols = 1; cols <= n; cols++) {
        if (n % cols) continue;
        const rows = n / cols;
        const scale = Math.min(1, sheet.w / cols / image.w, sheet.h / rows / image.h);
        const score = scale * 100
          + (image.rotated ? 0 : 10)
          + (sheet.natural ? 5 : 0)
          + (rows >= cols ? 1 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestScale = scale;
          best = { cols, rows, imageRotated: image.rotated, sheetW: sheet.w, sheetH: sheet.h };
        }
      }
    }
  }

  return { ...best, scale: bestScale };
}

/**
 * Tile `copies` copies of one image onto a sheet of the target paper — the
 * single-image counterpart of buildSheets. The image is drawn upright when it
 * fits, letterboxed and centered in its cell, scaled down only if it cannot
 * fit. Returns one OffscreenCanvas sized to the paper.
 */
export function buildSingleImageSheet(image, options = {}) {
  const {
    copies = 1,
    targetSheetSize = 'letter',
    customTargetW = 0,
    customTargetH = 0,
  } = options;

  const layout = calculateSingleImageLayout(image.width, image.height, copies, targetSheetSize, customTargetW, customTargetH);
  const sheet = new OffscreenCanvas(layout.sheetW, layout.sheetH);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, layout.sheetW, layout.sheetH);

  const cellW = layout.sheetW / layout.cols;
  const cellH = layout.sheetH / layout.rows;
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      drawPageInCell(ctx, image, { cellX: c * cellW, cellY: r * cellH, cellW, cellH }, layout.imageRotated, 0);
    }
  }
  return sheet;
}


