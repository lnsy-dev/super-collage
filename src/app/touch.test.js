import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTouchDevice } from './touch.js';

test('detectTouchDevice: no touch signals means not a touch device', () => {
  assert.equal(detectTouchDevice({}), false);
  assert.equal(detectTouchDevice(), false);
  assert.equal(
    detectTouchDevice({ maxTouchPoints: 0, hasCoarsePointer: false, hasTouchStart: false }),
    false,
  );
});

test('detectTouchDevice: coarse primary pointer alone marks a touch device', () => {
  assert.equal(detectTouchDevice({ hasCoarsePointer: true }), true);
});

test('detectTouchDevice: ontouchstart alone marks a touch device', () => {
  assert.equal(detectTouchDevice({ hasTouchStart: true }), true);
});

test('detectTouchDevice: maxTouchPoints > 0 alone marks a touch device', () => {
  assert.equal(detectTouchDevice({ maxTouchPoints: 1 }), true);
  assert.equal(detectTouchDevice({ maxTouchPoints: 10 }), true);
});

test('detectTouchDevice: any single signal is sufficient (generous OR)', () => {
  assert.equal(
    detectTouchDevice({ maxTouchPoints: 5, hasCoarsePointer: false, hasTouchStart: false }),
    true,
  );
  assert.equal(
    detectTouchDevice({ maxTouchPoints: 0, hasCoarsePointer: true, hasTouchStart: false }),
    true,
  );
  assert.equal(
    detectTouchDevice({ maxTouchPoints: 0, hasCoarsePointer: false, hasTouchStart: true }),
    true,
  );
});

test('detectTouchDevice: mouse-only device with several exact signals stays false', () => {
  assert.equal(
    detectTouchDevice({ maxTouchPoints: 0, hasCoarsePointer: false, hasTouchStart: false }),
    false,
  );
});
