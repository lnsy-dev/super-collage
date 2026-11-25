/* ═══════════════════════════════════════════════════════════════════
   Unit tests for layer linking (src/app/layer-link-utils.js) and the
   Layer record's link/mask array handling (src/app/layer.js).

   Run with:  node --test src/app/layer-link.test.js

   The invariants these tests encode:
     - A Layer built from another layer's toRecord() must never SHARE
       the source's linkedIds/imageMaskIds arrays: a link added to the
       copy used to land in the original too (the mask layer of a diff
       mask ended up linked to itself), and deleting one of the pair
       left the survivor referencing the deleted id.
     - getPaintGroup: brushing the mask layer of a difference mask (or
       its masked base) paints only that layer's canvas — the base's
       own pixels and the base's other mask layers must never be
       rewritten by a paint stroke on the other half of the pair.
     - Brushing a plain linked layer still paints its whole link group
       (legacy diff-copy ↔ mask sync).
   ═══════════════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Layer } from './layer.js';
import { State } from './state.js';
import {
  linkLayers, unlinkLayers, isLinkedTo,
  getPaintGroup, getScaleGroup, allSelectedAreLinked,
} from './layer-link-utils.js';

function resetState() {
  State.layers = [];
  State.project = null;
  State.pageId = null;
}

function imageLayer(name) {
  return new Layer({ name, width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 });
}

/* ── Layer record arrays are cloned, never aliased ──────────────── */

test('Layer built from another layer\'s record clones linkedIds', () => {
  const src = imageLayer('src');
  const copy = new Layer({ ...src.toRecord(), id: undefined });
  assert.notEqual(copy.linkedIds, src.linkedIds);
  linkLayers(copy, src);
  // The copy is linked to the source; the source's own list must not
  // have grown a self-reference through a shared array.
  assert.deepEqual(src.linkedIds, [copy.id]);
  assert.deepEqual(copy.linkedIds, [src.id]);
});

test('Layer built from another layer\'s record clones imageMaskIds', () => {
  const base = imageLayer('base');
  const mask = imageLayer('mask');
  base.imageMaskIds.push(mask.id);
  mask.isMaskFor = base.id;
  const dup = new Layer({ ...base.toRecord(), id: undefined });
  assert.notEqual(dup.imageMaskIds, base.imageMaskIds);
  dup.imageMaskIds.push('other-id');
  assert.deepEqual(base.imageMaskIds, [mask.id]);
});

test('Layer drops self-references from loaded linkedIds', () => {
  const l = new Layer({ name: 'x', id: 'fixed-id', linkedIds: ['fixed-id', 'other-id'] });
  assert.deepEqual(l.linkedIds, ['other-id']);
});

test('unlinkLayers leaves no self-references behind', () => {
  resetState();
  const a = imageLayer('a');
  const b = imageLayer('b');
  State.layers = [a, b];
  linkLayers(a, b);
  unlinkLayers(a, b);
  assert.deepEqual(a.linkedIds, []);
  assert.deepEqual(b.linkedIds, []);
});

/* ── Difference-mask pair helpers ───────────────────────────────── */

/**
 * Build the new-model difference-mask state: base + mask layer with
 * the image-mask relationship and a base↔mask link, like
 * create-difference-mask sets it up.
 */
function setupDiffMaskPair() {
  resetState();
  const base = imageLayer('base');
  const mask = imageLayer('cover');
  State.layers = [base, mask];
  base.imageMaskIds.push(mask.id);
  mask.isMaskFor = base.id;
  linkLayers(base, mask);
  return { base, mask };
}

test('difference-mask pair scales as one unit in both directions', () => {
  const { base, mask } = setupDiffMaskPair();
  assert.deepEqual(getScaleGroup(base), [mask]);
  assert.deepEqual(getScaleGroup(mask), [base]);
});

test('painting the mask layer of a difference mask leaves the base alone', () => {
  const { base, mask } = setupDiffMaskPair();
  assert.deepEqual(getPaintGroup(mask), [mask]);
  assert.deepEqual(getPaintGroup(base), [base]);
});

test('painting the mask layer of a difference mask ignores sibling masks', () => {
  const { base, mask } = setupDiffMaskPair();
  // Fan a second mask of the same base out of the (now shared) base:
  // both masks are linked to the base, so the link closure of one mask
  // reaches the other — painting must still not cross.
  const mask2 = imageLayer('cover 2');
  State.layers.push(mask2);
  base.imageMaskIds.push(mask2.id);
  mask2.isMaskFor = base.id;
  linkLayers(base, mask2);
  assert.deepEqual(getPaintGroup(mask), [mask]);
  assert.deepEqual(getPaintGroup(mask2), [mask2]);
  // Scaling still reaches the whole family through the base.
  const scaleGroup = getScaleGroup(mask);
  assert.equal(scaleGroup.includes(base), true);
  assert.equal(scaleGroup.includes(mask2), true);
});

test('painting the mask layer ignores layers linked to the base only', () => {
  const { base, mask } = setupDiffMaskPair();
  // A user link between the base and a decorative layer must not make
  // a brush stroke on the mask layer paint the decoration's canvas.
  const decor = imageLayer('decor');
  State.layers.push(decor);
  linkLayers(base, decor);
  assert.deepEqual(getPaintGroup(mask), [mask]);
});

/* ── Legacy diff-copy ↔ mask sync still paints together ─────────── */

test('legacy diff copy and its mask paint together', () => {
  resetState();
  const base = imageLayer('base');
  const mask = imageLayer('cover');
  const diff = new Layer({ name: 'cover (diff)', width: 100, height: 100 });
  State.layers = [base, mask, diff];
  base.imageMaskIds.push(mask.id);
  mask.isMaskFor = base.id;
  linkLayers(diff, mask);
  const paintGroup = getPaintGroup(diff);
  assert.equal(paintGroup.includes(diff), true);
  assert.equal(paintGroup.includes(mask), true);
  assert.equal(paintGroup.includes(base), false);
});

/* ── Link button state helpers ──────────────────────────────────── */

test('allSelectedAreLinked tracks pairwise links', () => {
  resetState();
  const a = imageLayer('a');
  const b = imageLayer('b');
  State.layers = [a, b];
  assert.equal(allSelectedAreLinked([a.id, b.id]), false);
  linkLayers(a, b);
  assert.equal(allSelectedAreLinked([a.id, b.id]), true);
  assert.equal(isLinkedTo(a, b), true);
  unlinkLayers(a, b);
  assert.equal(isLinkedTo(a, b), false);
});
