/* ═══════════════════════════════════════════════════════════════════
   Unit tests for the pure pixel pipeline (src/app/pixel-pipeline.js).

   Run with:  node --test src/app/pixel-pipeline.test.js

   The critical invariant these tests encode: the extracted pipeline is
   BIT-IDENTICAL to the ImageProcessor math it was moved out of. The
   worker and the main-thread fallback run the same functions, so any
   drift here would silently change rendered plates between environments.
   The canvas-dependent steps (dot halftones, gradient/pattern rasters)
   need OffscreenCanvas and are covered by the e2e parity suite; these
   tests pin the typed-array math with a minimal ImageData shim.
   ═══════════════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toGrayscale, applyBrightness, applyContrast, applyInvert, posterize,
  colorize, runPixelPipeline, scaledPatternSize, halftoneCell, renderRatio,
  fitTarget,
} from './pixel-pipeline.js';

/** Minimal ImageData stand-in: the pipeline only touches width/height/data. */
function fakeImageData(width, height, fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3];
  }
  return { width, height, data };
}

test('toGrayscale uses the 0.299/0.587/0.114 luminance weights', () => {
  const px = fakeImageData(2, 1, [100, 200, 50, 255]);
  toGrayscale(px);
  const expected = Math.round(0.299 * 100 + 0.587 * 200 + 0.114 * 50);
  assert.equal(px.data[0], expected);
  assert.equal(px.data[1], expected);
  assert.equal(px.data[2], expected);
  assert.equal(px.data[3], 255);
});

test('applyBrightness offsets and clamps', () => {
  const px = fakeImageData(1, 1, [100, 250, 5, 255]);
  applyBrightness(px, 10); // offset = 25.5
  // Uint8ClampedArray clamping rounds halves to even: 125.5 → 126, 30.5 → 30.
  assert.equal(px.data[0], 126);
  assert.equal(px.data[1], 255); // clamped
  assert.equal(px.data[2], 30);
});

test('applyContrast pivots at 128 and clamps', () => {
  const px = fakeImageData(2, 1, [128, 128, 128, 255]);
  px.data[4] = 228; px.data[5] = 228; px.data[6] = 228; // pixel 1: bright
  px.data[0] = 28; px.data[1] = 28; px.data[2] = 28;    // pixel 0: dark
  applyContrast(px, 20); // c = 51, factor = (259*(51+255))/(255*(259-51))
  const c = 51;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const cl = (v) => Math.max(0, Math.min(255, factor * (v - 128) + 128));
  assert.equal(px.data[0], 0);  // cl(28), clamped to 0
  assert.equal(px.data[4], 255); // cl(228), clamped to 255
  // Mid-gray stays at the pivot.
  const mid = fakeImageData(1, 1, [128, 128, 128, 255]);
  applyContrast(mid, 20);
  assert.equal(mid.data[0], 128);
  assert.equal(mid.data[3], 255);
});

test('applyInvert flips RGB but not alpha', () => {
  const px = fakeImageData(1, 1, [10, 200, 255, 128]);
  applyInvert(px);
  assert.deepEqual([...px.data.slice(0, 4)], [245, 55, 0, 128]);
});

test('posterize quantizes to levels-1 steps', () => {
  const px = fakeImageData(1, 3, [0, 0, 0, 255]);
  px.data[0] = 10; px.data[4] = 130; px.data[8] = 250;
  posterize(px, 6); // step = 51
  assert.equal(px.data[0], 0);    // round(10/51)*51 = 0
  assert.equal(px.data[4], 153);  // round(130/51)=3 → 153
  assert.equal(px.data[8], 255);  // round(250/51)=5 → 255
});

test('solid colorize maps dark pixels to opaque ink and light pixels out', () => {
  const px = fakeImageData(2, 1, [0, 0, 0, 255]);
  // Values clear of the float-ambiguous 128 boundary (the gray sum lands
  // at 127.999… for exactly-128 channels, so stay well away from it).
  px.data[0] = px.data[1] = px.data[2] = 100;  // gray 100 < 128 → ink
  px.data[4] = px.data[5] = px.data[6] = 150;  // gray 150 ≥ 128 → transparent
  colorize(px, '#f65058', null);
  assert.deepEqual([...px.data.slice(0, 4)], [0xf6, 0x50, 0x58, 255]);
  assert.equal(px.data[7], 0);
});

test('runPixelPipeline solid path composes grayscale→brightness→contrast→colorize', () => {
  const px = fakeImageData(1, 1, [0, 0, 0, 255]);
  px.data[0] = 100; px.data[1] = 100; px.data[2] = 100;
  const p = {
    brightness: 0, contrast: 0, invert: false,
    halftoneType: 'none', color: '#0078bf', colorMode: 'solid',
    colorOverride: false, halftoneSize: 8,
    naturalWidth: 10, naturalHeight: 10, width: 10, height: 10, x: 0, y: 0,
    targetW: 1, targetH: 1, renderRatio: 1,
  };
  // Reference: the same steps run by hand (the ImageProcessor sequence).
  const ref = fakeImageData(1, 1, [0, 0, 0, 255]);
  ref.data[0] = 100; ref.data[1] = 100; ref.data[2] = 100;
  toGrayscale(ref); applyBrightness(ref, 0); applyContrast(ref, 0);
  colorize(ref, '#0078bf', null);
  runPixelPipeline(px, p);
  assert.deepEqual([...px.data], [...ref.data]);
});

test('runPixelPipeline grayscale-halftone branch maps luminance to alpha', () => {
  const px = fakeImageData(1, 1, [0, 0, 0, 255]);
  px.data[0] = 200; px.data[1] = 200; px.data[2] = 200;
  const p = {
    brightness: 0, contrast: 0, invert: false,
    halftoneType: 'grayscale', color: '#010101', colorMode: 'solid',
    colorOverride: false, halftoneSize: 8,
    naturalWidth: 10, naturalHeight: 10, width: 10, height: 10, x: 0, y: 0,
    targetW: 1, targetH: 1, renderRatio: 1,
  };
  runPixelPipeline(px, p);
  const gray = Math.round(0.299 * 200 + 0.587 * 200 + 0.114 * 200);
  assert.equal(px.data[0], 1);
  assert.equal(px.data[1], 1);
  assert.equal(px.data[2], 1);
  assert.equal(px.data[3], Math.round(255 - gray));
});

test('pattern knobs scale with the render ratio', () => {
  assert.equal(scaledPatternSize(8, 1), 8);
  assert.equal(scaledPatternSize(8, 0), 8);
  assert.equal(scaledPatternSize(8, 2), 16);
  const p = { halftoneSize: 8, halftoneType: 'dither', width: 1000 };
  assert.equal(halftoneCell(p, 2, 2000), 16);
  // Non-dot-screen cells are never floored by the magazine anchor.
  const dotP = { halftoneSize: 2, halftoneType: 'magazine', width: 1000 };
  assert.ok(halftoneCell(dotP, 1, 2000) >= 2);
});

test('renderRatio falls back to targetW/naturalWidth', () => {
  assert.equal(renderRatio(3, 1000, 4000), 3);
  assert.equal(renderRatio(0, 1000, 500), 0.5);
  assert.equal(renderRatio(0, 0, 500), 1);
});

test('fitTarget clamps oversized targets into the allocatable envelope', () => {
  const { w, h } = fitTarget(20000, 20000);
  assert.ok(w * h <= (1 << 26), `area ${w * h} must fit the canvas cap`);
  const tiny = fitTarget(0, 0);
  assert.ok(tiny.w >= 1 && tiny.h >= 1);
});
