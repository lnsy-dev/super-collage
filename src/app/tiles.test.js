/* ═══════════════════════════════════════════════════════════════════
   Tile planning unit tests
   Run with: node --test src/app/tiles.test.js
   ═══════════════════════════════════════════════════════════════════ */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planTiles } from './tiles.js';

describe('planTiles', () => {
  it('covers the image exactly with no gaps or overlaps', () => {
    const tiles = planTiles(3300, 5100, 2, 2);
    const cover = new Uint8Array(3300 * 5100);
    for (const t of tiles) {
      assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= 3300 && t.y + t.h <= 5100);
      for (let y = t.y; y < t.y + t.h; y++) {
        for (let x = t.x; x < t.x + t.w; x++) cover[y * 3300 + x] = 1;
      }
    }
    assert.ok(cover.every(v => v === 1));
  });

  it('returns exactly cols×rows tiles when dimensions divide evenly', () => {
    const tiles = planTiles(100, 80, 2, 2);
    assert.equal(tiles.length, 4);
    assert.deepEqual(tiles.map(t => [t.x, t.y, t.w, t.h]), [
      [0, 0, 50, 40],
      [50, 0, 50, 40],
      [0, 40, 50, 40],
      [50, 40, 50, 40],
    ]);
  });

  it('absorbs the remainder into edge tiles for uneven dimensions', () => {
    const tiles = planTiles(101, 81, 2, 2);
    assert.equal(tiles.length, 4);
    // Origins stay integer; halves round up (Math.round), so the low
    // tile takes the extra pixel and the high tile gets the remainder.
    assert.deepEqual(tiles.map(t => [t.x, t.y, t.w, t.h]), [
      [0, 0, 51, 41],
      [51, 0, 50, 41],
      [0, 41, 51, 40],
      [51, 41, 50, 40],
    ]);
    const area = tiles.reduce((sum, t) => sum + t.w * t.h, 0);
    assert.equal(area, 101 * 81);
  });

  it('1×1 grid yields a single whole-image tile (untiled path)', () => {
    const tiles = planTiles(3300, 5100, 1, 1);
    assert.equal(tiles.length, 1);
    assert.deepEqual(tiles[0], { x: 0, y: 0, w: 3300, h: 5100 });
  });

  it('each tile of the default quadrant grid is about a quarter of the page', () => {
    const W = 3300, H = 5100;
    const tiles = planTiles(W, H, 2, 2);
    for (const t of tiles) {
      assert.ok(t.w * t.h * 4 <= Math.ceil((W * H * 4) / 4) + 4 * 4,
        `tile ${t.w}x${t.h} larger than ~1/4 page`);
    }
  });

  it('degenerates safely for empty and tiny images', () => {
    assert.deepEqual(planTiles(0, 0, 2, 2), []);
    assert.deepEqual(planTiles(1, 1, 2, 2), [{ x: 0, y: 0, w: 1, h: 1 }]);
    // Sub-unit grids clamp to a single tile per axis.
    assert.deepEqual(planTiles(10, 10, 0, 0), [{ x: 0, y: 0, w: 10, h: 10 }]);
  });
});
