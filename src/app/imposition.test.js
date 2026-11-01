/* ═══════════════════════════════════════════════════════════════════
   Imposition unit tests
   Run with: node --test src/app/imposition.test.js
   ═══════════════════════════════════════════════════════════════════ */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { saddleStitchOrder, calculateLayout, calculateBookletLayout, computeSheetPlan, calculateSingleImageLayout } from './imposition.js';

// Notebook cover: 7" × 5.5" wrap cover (4200 × 3300 px @ 600 dpi).
const COVER_W = 4200, COVER_H = 3300;

describe('saddleStitchOrder', () => {
  it('returns classic zine order for 8 pages', () => {
    // Reader page numbers are 1-indexed; expected outside-inside pairs:
    // sheet 1 front [8,1], back [2,7]; sheet 2 front [6,3], back [4,5]
    assert.deepEqual(saddleStitchOrder(8), [7, 0, 1, 6, 5, 2, 3, 4]);
  });

  it('pads to the next multiple of 4 with null slots', () => {
    assert.deepEqual(saddleStitchOrder(2), [null, 0, 1, null]);
    assert.deepEqual(saddleStitchOrder(5), [null, 0, 1, null, null, 2, 3, 4]);
  });

  it('returns a single sheet order for 4 pages', () => {
    assert.deepEqual(saddleStitchOrder(4), [3, 0, 1, 2]);
  });
});

describe('calculateLayout', () => {
  it('fits two half-letter pages side-by-side on letter', () => {
    const layout = calculateLayout(3300, 5100, 'letter');
    assert.equal(layout.cols, 2);
    assert.equal(layout.rows, 1);
    assert.equal(layout.pagesPerSheet, 2);
    assert.equal(layout.sheetW, 6600);
    assert.equal(layout.sheetH, 5100);
    assert.equal(layout.pageRotated, false);
  });

  it('fits four half-letter pages on tabloid', () => {
    const layout = calculateLayout(3300, 5100, 'tabloid');
    assert.equal(layout.cols, 2);
    assert.equal(layout.rows, 2);
    assert.equal(layout.pagesPerSheet, 4);
    assert.equal(layout.sheetW, 6600);
    assert.equal(layout.sheetH, 10200);
    assert.equal(layout.pageRotated, false);
  });

  it('fits two notebook covers per portrait letter side, stacked vertically', () => {
    const layout = calculateLayout(COVER_W, COVER_H, 'letter');
    assert.equal(layout.cols, 1);
    assert.equal(layout.rows, 2);
    assert.equal(layout.pagesPerSheet, 2);
    assert.equal(layout.sheetW, 5100);
    assert.equal(layout.sheetH, 6600);
    assert.equal(layout.pageRotated, false);
  });
});

describe('calculateBookletLayout', () => {
  // Manga trim: 5.04" × 7.17" (3024 × 4302 px @ 600 dpi).
  const MANGA_W = 3024, MANGA_H = 4302;

  it('folio fits two manga pages side by side on landscape letter at 100%', () => {
    const layout = calculateBookletLayout(MANGA_W, MANGA_H, 'folio', 'letter');
    assert.equal(layout.cols, 2);
    assert.equal(layout.rows, 1);
    assert.equal(layout.sheetW, 6600);
    assert.equal(layout.sheetH, 5100);
    assert.equal(layout.pageRotated, false);
    assert.equal(layout.scale, 1);
  });

  it('folio prefers upright pages: notebook covers stack landscape on tabloid', () => {
    const layout = calculateBookletLayout(COVER_W, COVER_H, 'folio', 'tabloid');
    assert.equal(layout.pageRotated, false);
    // 2 × 4200 = 8400 ≤ 10200 wide, 3300 ≤ 6600 tall.
    assert.equal(layout.scale, 1);
  });

  it('folio fits notebook covers on letter only with rotated pages', () => {
    // 2 × 4200 > 5100 upright; rotated pages (3300 × 4200) fit the 3300 × 5100
    // half-cells of landscape letter exactly.
    const layout = calculateBookletLayout(COVER_W, COVER_H, 'folio', 'letter');
    assert.equal(layout.sheetW, 6600);
    assert.equal(layout.sheetH, 5100);
    assert.equal(layout.pageRotated, true);
    assert.equal(layout.scale, 1);
  });

  it('quarto cannot fit manga pages in a 2×2 grid on letter', () => {
    const layout = calculateBookletLayout(MANGA_W, MANGA_H, 'quarto', 'letter');
    assert.ok(layout.scale < 1);
  });

  it('quarto fits half-letter pages in a 2×2 grid on tabloid at 100%', () => {
    const layout = calculateBookletLayout(3300, 5100, 'quarto', 'tabloid');
    assert.equal(layout.sheetW, 6600);
    assert.equal(layout.sheetH, 10200);
    assert.equal(layout.pageRotated, false);
    assert.equal(layout.scale, 1);
  });

  it('octavo fits manga pages in a 4×2 grid on tabloid only rotated', () => {
    // 4 × 3024 = 12096 > 10200 upright; rotated pages: 4 × 4302 = 17208 —
    // neither fits, so octavo stays unavailable for manga on tabloid.
    const layout = calculateBookletLayout(MANGA_W, MANGA_H, 'octavo', 'tabloid');
    assert.ok(layout.scale < 1);
  });

  it('honours a custom paper size', () => {
    const layout = calculateBookletLayout(MANGA_W, MANGA_H, 'folio', 'custom', 6048, 4302);
    assert.equal(layout.sheetW, 6048);
    assert.equal(layout.sheetH, 4302);
    assert.equal(layout.scale, 1);
  });

  it('reports a sub-1 scale when the custom paper is too small', () => {
    const layout = calculateBookletLayout(MANGA_W, MANGA_H, 'folio', 'custom', 5000, 4000);
    assert.ok(layout.scale < 1);
    assert.ok(layout.scale > 0);
  });
});

describe('computeSheetPlan butted cells', () => {
  const MANGA_W = 3024, MANGA_H = 4302;

  it('butts folio pages at the fold and centers the pair on the sheet', () => {
    const layout = calculateBookletLayout(MANGA_W, MANGA_H, 'folio', 'letter');
    const plan = computeSheetPlan(8, layout, 'saddle-stitch', 'folio', 0);
    const [left, right] = plan[0].cells;
    // No gap at the centre fold: the right page starts where the left ends.
    assert.equal(left.cellX + left.cellW, right.cellX);
    // The pair is centered on the landscape sheet.
    assert.equal(left.cellX, (6600 - 2 * MANGA_W) / 2);
    assert.equal(right.cellX + right.cellW, 6600 - left.cellX);
    // And vertically centered.
    assert.equal(left.cellY, (5100 - MANGA_H) / 2);
    assert.equal(left.cellW, MANGA_W);
    assert.equal(left.cellH, MANGA_H);
  });

  it('keeps half-letter folio pages full-bleed on letter', () => {
    const layout = calculateBookletLayout(3300, 5100, 'folio', 'letter');
    const plan = computeSheetPlan(8, layout, 'saddle-stitch', 'folio', 0);
    const [left, right] = plan[0].cells;
    assert.equal(left.cellX, 0);
    assert.equal(left.cellW, 3300);
    assert.equal(right.cellX, 3300);
    assert.equal(left.cellY, 0);
  });

  it('butts quarto pages at both folds and centers the 2×2 grid', () => {
    // Quarter pages (1650 × 2550) on tabloid quarto: cells are exactly
    // half the sheet, so the grid fills it edge to edge.
    const layout = calculateBookletLayout(1650, 2550, 'quarto', 'tabloid');
    const plan = computeSheetPlan(16, layout, 'saddle-stitch', 'quarto', 0);
    const side = plan[0];
    const tl = side.cells[0], tr = side.cells[1], bl = side.cells[2];
    assert.equal(tl.cellX + tl.cellW, tr.cellX);          // butted horizontally
    assert.equal(tl.cellY + tl.cellH, bl.cellY);          // butted vertically
    assert.equal(tl.cellX, (6600 - 2 * 1650) / 2);        // centered horizontally
    assert.equal(tl.cellY, (10200 - 2 * 2550) / 2);       // centered vertically
  });

  it('scales the butted grid when pages cannot fill their cells', () => {
    const layout = calculateBookletLayout(MANGA_W, MANGA_H, 'quarto', 'letter');
    assert.ok(layout.scale < 1);
    const plan = computeSheetPlan(8, layout, 'saddle-stitch', 'quarto', 0);
    const side = plan[0];
    const tl = side.cells[0], tr = side.cells[1], bl = side.cells[2];
    const drawW = tl.cellW, drawH = tl.cellH;
    assert.equal(tl.cellX + drawW, tr.cellX);             // still butted
    assert.equal(tl.cellY + drawH, bl.cellY);
    assert.equal(tl.cellX, (5100 - 2 * drawW) / 2);       // still centered
    assert.equal(tl.cellY, (6600 - 2 * drawH) / 2);
    // Aspect ratio preserved.
    assert.ok(Math.abs(drawW / drawH - MANGA_W / MANGA_H) < 0.01);
  });
});

describe('calculateSingleImageLayout', () => {
  // 18cm × 12.5cm @ 600 dpi.
  const IMAGE_W = 4252, IMAGE_H = 2953;

  it('stacks two copies vertically on portrait letter', () => {
    const layout = calculateSingleImageLayout(IMAGE_W, IMAGE_H, 2, 'letter');
    assert.equal(layout.sheetW, 5100);
    assert.equal(layout.sheetH, 6600);
    assert.equal(layout.cols, 1);
    assert.equal(layout.rows, 2);
    assert.equal(layout.imageRotated, false);
  });

  it('centers a single copy upright on portrait letter', () => {
    const layout = calculateSingleImageLayout(IMAGE_W, IMAGE_H, 1, 'letter');
    assert.equal(layout.sheetW, 5100);
    assert.equal(layout.sheetH, 6600);
    assert.equal(layout.cols, 1);
    assert.equal(layout.rows, 1);
    assert.equal(layout.imageRotated, false);
  });

  it('prefers a vertical stack when both orientations fit at 100%', () => {
    const layout = calculateSingleImageLayout(3000, 3000, 2, 'letter');
    assert.equal(layout.cols, 1);
    assert.equal(layout.rows, 2);
    assert.equal(layout.imageRotated, false);
  });

  it('turns the sheet landscape when only that orientation fits upright at 100%', () => {
    const layout = calculateSingleImageLayout(6000, 2000, 1, 'letter');
    assert.equal(layout.sheetW, 6600);
    assert.equal(layout.sheetH, 5100);
    assert.equal(layout.cols, 1);
    assert.equal(layout.rows, 1);
    assert.equal(layout.imageRotated, false);
  });

  it('picks the largest scale for four copies (2×2 on landscape letter)', () => {
    const layout = calculateSingleImageLayout(IMAGE_W, IMAGE_H, 4, 'letter');
    assert.equal(layout.cols, 2);
    assert.equal(layout.rows, 2);
    assert.equal(layout.sheetW, 6600);
    assert.equal(layout.sheetH, 5100);
    assert.equal(layout.imageRotated, false);
  });

  it('honours a custom paper size', () => {
    const layout = calculateSingleImageLayout(IMAGE_W, IMAGE_H, 2, 'custom', 5100, 6600);
    assert.equal(layout.sheetW, 5100);
    assert.equal(layout.sheetH, 6600);
    assert.equal(layout.cols, 1);
    assert.equal(layout.rows, 2);
  });

  it('stacks notebook cover copies vertically for 2-up on portrait letter', () => {
    const layout = calculateSingleImageLayout(COVER_W, COVER_H, 2, 'letter');
    assert.equal(layout.sheetW, 5100);
    assert.equal(layout.sheetH, 6600);
    assert.equal(layout.cols, 1);
    assert.equal(layout.rows, 2);
    assert.equal(layout.imageRotated, false);
  });
});
