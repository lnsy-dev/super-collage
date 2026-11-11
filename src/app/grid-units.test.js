/* ═══════════════════════════════════════════════════════════════════
   Tests for grid size unit conversion and rescaling (grid-units.js).
   Run with: node --test src/app/grid-units.test.js
   ═══════════════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectGridUnit,
  pxPerUnit,
  unitLabel,
  pxToGridUnit,
  gridUnitToPx,
  formatGridUnitValue,
  defaultGridTargetPx,
} from './grid-units.js';

const EPS = 1e-9;

test('projectGridUnit: metric for pageSizeUnit metric, imperial otherwise', () => {
  assert.equal(projectGridUnit({ pageSizeUnit: 'metric' }), 'metric');
  assert.equal(projectGridUnit({ pageSizeUnit: 'imperial' }), 'imperial');
  assert.equal(projectGridUnit({}), 'imperial');
  assert.equal(projectGridUnit(null), 'imperial');
  assert.equal(projectGridUnit(undefined), 'imperial');
});

test('unitLabel and pxPerUnit match units', () => {
  assert.equal(unitLabel('imperial'), 'inches');
  assert.equal(unitLabel('metric'), 'cm');
  assert.equal(pxPerUnit('imperial'), 600);
  assert.ok(Math.abs(pxPerUnit('metric') - 600 / 2.54) < EPS);
});

test('imperial conversions: 0.25 in <-> 150 px at 600dpi', () => {
  assert.ok(Math.abs(gridUnitToPx(0.25, 'imperial') - 150) < EPS);
  assert.ok(Math.abs(pxToGridUnit(150, 'imperial') - 0.25) < EPS);
  assert.equal(formatGridUnitValue(pxToGridUnit(150, 'imperial')), '0.25');
});

test('metric conversions: 1 cm <-> ~236.2205 px at 600dpi', () => {
  const oneCmPx = 600 / 2.54;
  assert.ok(Math.abs(gridUnitToPx(1, 'metric') - oneCmPx) < EPS);
  assert.ok(Math.abs(pxToGridUnit(oneCmPx, 'metric') - 1) < EPS);
});

test('metric conversions: 0.5 cm default target is round and physical', () => {
  const halfCm = 0.5 * 600 / 2.54;
  assert.ok(Math.abs(gridUnitToPx(0.5, 'metric') - halfCm) < EPS);
  assert.ok(Math.abs(defaultGridTargetPx('metric') - Math.round(halfCm)) <= 1);
  assert.equal(defaultGridTargetPx('imperial'), 150);
});

test('round-trip conversions are stable for common grid sizes', () => {
  for (const v of [0.125, 0.25, 0.5, 1, 2]) {
    const px = gridUnitToPx(v, 'imperial');
    assert.ok(Math.abs(pxToGridUnit(px, 'imperial') - v) < 1e-9);
  }
  for (const v of [0.1, 0.5, 1, 2, 5]) {
    const px = gridUnitToPx(v, 'metric');
    assert.ok(Math.abs(pxToGridUnit(px, 'metric') - v) < 1e-9);
  }
});

test('formatGridUnitValue trims trailing zeros but keeps needed precision', () => {
  assert.equal(formatGridUnitValue(0.25), '0.25');
  assert.equal(formatGridUnitValue(1), '1');
  assert.equal(formatGridUnitValue(0.5), '0.5');
  assert.equal(formatGridUnitValue(0.635), '0.635');
  assert.equal(formatGridUnitValue(1.2300), '1.23');
});
