/* ═══════════════════════════════════════════════════════════════════
   Imposition unit tests
   Run with: node --test src/app/imposition.test.js
   ═══════════════════════════════════════════════════════════════════ */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { saddleStitchOrder, calculateLayout, calculateSingleImageLayout } from './imposition.js';

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
});
