/* ═══════════════════════════════════════════════════════════════════
   Tests for the dot-screen device-pixel anchoring (pattern-size.js).
   Run with: node --test src/app/pattern-size.test.js
   ═══════════════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_DPI,
  MIN_CELL_DEVICE_PX,
  minCellForRender,
} from './pattern-size.js';

const EPS = 1e-9;

test('pages rasterize at 600 dpi', () => {
  assert.equal(EXPORT_DPI, 600);
});

test('magazine anchor: 600 dpi / 150 lpi = 4 device px per cell', () => {
  // 600 device px per inch ÷ 150 cells per inch = 4 device px per cell.
  assert.equal(EXPORT_DPI / 150, 4);
  assert.equal(MIN_CELL_DEVICE_PX, 4);
});

test('magazine anchor covers the 133–150 lpi magazine range', () => {
  // 133 lpi ≈ 4.5 device px, 150 lpi = 4 device px — the floor sits at
  // the fine end of the magazine range, never coarser than 4.5 px.
  assert.ok(EXPORT_DPI / 133 >= MIN_CELL_DEVICE_PX);
  assert.ok(EXPORT_DPI / 133 < MIN_CELL_DEVICE_PX + 1);
});

test('minCellForRender: natural-size layer needs a 4 px cell', () => {
  // A Letter page (5100 px wide at 600 dpi) rendered 1:1: the magazine
  // floor is 4 bitmap px = 4 device px on the page.
  assert.ok(Math.abs(minCellForRender(5100, 5100) - 4) < EPS);
});

test('minCellForRender scales with the bitmap-per-device-pixel ratio', () => {
  // A 2550 px layer footprint rendered into a 765 px preview bitmap holds
  // 0.3 bitmap px per device px; the floor shrinks proportionally so the
  // on-page pitch stays ≥ 4 device px.
  assert.ok(Math.abs(minCellForRender(765, 2550) - 4 * 765 / 2550) < EPS);
  assert.ok(Math.abs(minCellForRender(765, 2550) - 1.2) < EPS);
});

test('minCellForRender: layer smaller than the bitmap keeps the floor at 4+ px', () => {
  // A layer rendered above its on-page density (bitmap px per device px
  // > 1) floors above 4 bitmap px so the on-page pitch never goes under
  // the magazine anchor.
  assert.ok(Math.abs(minCellForRender(3000, 2550) - 4 * 3000 / 2550) < EPS);
  assert.ok(minCellForRender(3000, 2550) > 4);
});

test('minCellForRender falls back to the device floor without a page width', () => {
  assert.ok(Math.abs(minCellForRender(1234, 0) - MIN_CELL_DEVICE_PX) < EPS);
  assert.ok(Math.abs(minCellForRender(1234, -5) - MIN_CELL_DEVICE_PX) < EPS);
});
