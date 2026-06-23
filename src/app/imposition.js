/* ═══════════════════════════════════════════════════════════════════
   Imposition — reader pages → printer sheets
   Pure, unit-testable geometry helpers.
   ═══════════════════════════════════════════════════════════════════ */

import { PAGE_SIZE_DIMS } from './constants.js';

export const SHEET_SIZE_DIMS = {
  'letter':  { w: 5100, h: 6600 },
  'legal':   { w: 5100, h: 8400 },
  'tabloid': { w: 6600, h: 10200 },
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
  const layout = calculateLayout(pageW, pageH, targetSheetSize, customTargetW, customTargetH);

  if (binding === 'saddle-stitch') {
    return _buildSaddleStitchSheets(pages, layout, bleed, bookletLayout);
  }

  return _buildGridSheets(pages, layout, bleed);
}

function _buildGridSheets(pages, layout, bleed) {
  const { cols, rows, pagesPerSheet, pageRotated, sheetW, sheetH } = layout;
  const sheets = [];

  for (let i = 0; i < pages.length; i += pagesPerSheet) {
    const sheet = new OffscreenCanvas(sheetW, sheetH);
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, sheetW, sheetH);

    const cellW = sheetW / cols;
    const cellH = sheetH / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = i + r * cols + c;
        if (idx >= pages.length) continue;
        const page = pages[idx];
        if (!page) continue;
        const cellX = c * cellW;
        const cellY = r * cellH;
        _drawPageInCell(ctx, page, cellX, cellY, cellW, cellH, pageRotated, bleed);
      }
    }
    sheets.push(sheet);
  }

  return sheets;
}

function _buildSaddleStitchSheets(pages, layout, bleed, bookletLayout) {
  const spec = BOOKLET_LAYOUTS[bookletLayout] || BOOKLET_LAYOUTS.folio;

  if (spec.zine) {
    return _buildZineSheets(pages, layout, bleed, spec);
  }

  return _buildBookletSheets(pages, layout, bleed, spec);
}

function _buildZineSheets(pages, layout, bleed, spec) {
  // Classic zine folio: 2 pages per side, cover sheet first.
  const order = saddleStitchOrder(pages.length);
  const { sheetW, sheetH, pageRotated } = layout;
  const sheets = [];
  const halfW = sheetW / 2;

  for (let i = 0; i < order.length; i += 2) {
    const leftIdx = order[i];
    const rightIdx = order[i + 1];
    const sheet = new OffscreenCanvas(sheetW, sheetH);
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, sheetW, sheetH);

    if (leftIdx !== null && pages[leftIdx]) {
      _drawPageInCell(ctx, pages[leftIdx], 0, 0, halfW - bleed / 2, sheetH, pageRotated, bleed);
    }
    if (rightIdx !== null && pages[rightIdx]) {
      _drawPageInCell(ctx, pages[rightIdx], halfW + bleed / 2, 0, halfW - bleed / 2, sheetH, pageRotated, bleed);
    }
    sheets.push(sheet);
  }

  return sheets;
}

function _buildBookletSheets(pages, layout, bleed, spec) {
  // Center-out booklet layouts (quarto, octavo) adapted from bookbinder-js.
  const k = spec.perSheet / 2;
  const pageCount = pages.length;
  const padded = Math.ceil(pageCount / spec.perSheet) * spec.perSheet;
  const sheetCount = padded / spec.perSheet;
  const center = padded / 2;
  const { sheetW, sheetH, pageRotated } = layout;

  const innerSheets = [];

  for (let innerS = 0; innerS < sheetCount; innerS++) {
    const frontStart = center - k * (innerS + 1);
    const frontEnd = center - k * innerS;
    const backStart = center + k * innerS;
    const backEnd = center + k * (innerS + 1);

    const block = [];
    for (let i = frontStart; i < frontEnd; i++) {
      block.push(i >= 0 && i < pageCount ? pages[i] : null);
    }
    for (let i = backStart; i < backEnd; i++) {
      block.push(i >= 0 && i < pageCount ? pages[i] : null);
    }

    innerSheets.push(
      _buildBookletSide(block, spec.front, spec.rotations, sheetW, sheetH, spec.cols, spec.rows, bleed, pageRotated),
      _buildBookletSide(block, spec.back, spec.rotations, sheetW, sheetH, spec.cols, spec.rows, bleed, pageRotated)
    );
  }

  // Reverse so outermost sheet is first; keep front/back pairs intact.
  const sheets = [];
  for (let i = innerSheets.length - 2; i >= 0; i -= 2) {
    sheets.push(innerSheets[i], innerSheets[i + 1]);
  }
  return sheets;
}

function _buildBookletSide(block, indices, rotations, sheetW, sheetH, cols, rows, bleed, pageRotated) {
  const sheet = new OffscreenCanvas(sheetW, sheetH);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sheetW, sheetH);

  const cellW = sheetW / cols;
  const cellH = sheetH / rows;

  for (let i = 0; i < indices.length; i++) {
    const page = block[indices[i]];
    if (!page) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const rotation = (rotations[indices[i]] || 0) * Math.PI / 180;
    _drawPageInCell(ctx, page, c * cellW, r * cellH, cellW, cellH, pageRotated, bleed, rotation);
  }

  return sheet;
}

function _drawPageInCell(ctx, page, cellX, cellY, cellW, cellH, pageRotated, bleed, extraRotation = 0) {
  let srcW = pageRotated ? page.height : page.width;
  let srcH = pageRotated ? page.width : page.height;

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
  ctx.drawImage(page, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}


