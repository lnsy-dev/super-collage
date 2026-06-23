/* ═══════════════════════════════════════════════════════════════════
   Imposition unit tests
   Run with: node --test src/app/imposition.test.js
   ═══════════════════════════════════════════════════════════════════ */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { saddleStitchOrder, calculateLayout } from './imposition.js';

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
