/* ═══════════════════════════════════════════════════════════════════
   Unit tests for center guide geometry (src/app/center-guides.js).

   Run with:  node --test src/app/center-guides.test.js

   The invariant these tests encode: the View menu's "View Vertical
   Center" / "View Horizontal Center" guides land on the center of the
   PAPER (page coordinates), and in spread view on each page's own
   center — never at the fold, never at a viewport-derived position.
   Renderer.drawCenterGuides scales these positions by zoom, so any
   error here shows up on screen at every zoom level.
   ═══════════════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verticalCenterGuideXs,
  horizontalCenterGuideYs,
} from './center-guides.js';

const EPS = 1e-9;

test('vertical guide sits at the horizontal center of the page', () => {
  // half-letter portrait at 600 dpi: 3300 × 5100 px
  assert.deepEqual(verticalCenterGuideXs(3300), [1650]);
  // letter portrait: 5100 × 6600 px
  assert.deepEqual(verticalCenterGuideXs(5100), [2550]);
});

test('vertical guide centers odd-sized pages without drifting', () => {
  assert.deepEqual(verticalCenterGuideXs(3301), [1650.5]);
  assert.ok(Math.abs(verticalCenterGuideXs(3301)[0] - 3301 / 2) < EPS);
});

test('vertical guide in spread view centers each page, not the fold', () => {
  // Two half-letter pages side by side: fold at 3300, spread width 6600.
  const xs = verticalCenterGuideXs(6600, 3300);
  assert.deepEqual(xs, [1650, 4950]);
  // The fold itself (3300) is NOT a guide position.
  assert.ok(!xs.some(x => Math.abs(x - 3300) < EPS));
  // Each guide is half a page away from the fold.
  assert.ok(Math.abs((xs[0] + xs[1]) / 2 - 3300) < EPS);
});

test('vertical guide handles unequal spread halves', () => {
  // Fold at 2000 in a 5200-wide spread: left page 2000, right page 3200.
  const xs = verticalCenterGuideXs(5200, 2000);
  assert.deepEqual(xs, [1000, 3600]);
});

test('vertical guide returns no positions for a zero-width page', () => {
  assert.deepEqual(verticalCenterGuideXs(0), []);
  assert.deepEqual(verticalCenterGuideXs(0, 0), []);
});

test('horizontal guide sits at the vertical center of the page', () => {
  assert.deepEqual(horizontalCenterGuideYs(5100), [2550]);
  assert.deepEqual(horizontalCenterGuideYs(6600), [3300]);
});

test('horizontal guide centers odd-sized pages without drifting', () => {
  assert.ok(Math.abs(horizontalCenterGuideYs(5101)[0] - 5101 / 2) < EPS);
});

test('horizontal guide returns no positions for a zero-height page', () => {
  assert.deepEqual(horizontalCenterGuideYs(0), []);
});

test('spread view leaves the horizontal guide at the shared center', () => {
  // Spreads share one height; the split only affects vertical guides.
  assert.deepEqual(horizontalCenterGuideYs(5100), [2550]);
});
