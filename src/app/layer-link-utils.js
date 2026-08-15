/* ═══════════════════════════════════════════════════════════════════
   Layer Link helpers
   Links between layers are stored as a symmetric `linkedIds` array on
   each Layer. These helpers make it easy to query and mutate links.
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';

export function isLinkedTo(a, b) {
  if (!a || !b || a.id === b.id) return false;
  return (a.linkedIds || []).includes(b.id) && (b.linkedIds || []).includes(a.id);
}

export function linkLayers(a, b) {
  if (!a || !b || a.id === b.id) return;
  if (!a.linkedIds) a.linkedIds = [];
  if (!b.linkedIds) b.linkedIds = [];
  if (!a.linkedIds.includes(b.id)) a.linkedIds.push(b.id);
  if (!b.linkedIds.includes(a.id)) b.linkedIds.push(a.id);
}

export function unlinkLayers(a, b) {
  if (!a || !b) return;
  a.linkedIds = (a.linkedIds || []).filter(id => id !== b.id);
  b.linkedIds = (b.linkedIds || []).filter(id => id !== a.id);
}

export function getLinkedLayers(layer) {
  if (!layer || !layer.linkedIds?.length) return [];
  return layer.linkedIds
    .map(id => State.layers.find(l => l.id === id))
    .filter(l => l && l.id !== layer.id && !l.locked);
}

export function getLinkGroup(layer) {
  if (!layer) return [];
  const group = [layer];
  for (const l of getLinkedLayers(layer)) {
    if (!group.includes(l)) group.push(l);
  }
  return group;
}

export function allSelectedAreLinked(selectedIds) {
  if (!selectedIds || selectedIds.length < 2) return false;
  const layers = selectedIds
    .map(id => State.layers.find(l => l.id === id))
    .filter(Boolean);
  if (layers.length !== selectedIds.length) return false;
  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      if (!isLinkedTo(layers[i], layers[j])) return false;
    }
  }
  return true;
}

export function unlinkLayerFromAll(layer) {
  if (!layer || !layer.linkedIds?.length) return;
  for (const linked of getLinkedLayers(layer)) {
    linked.linkedIds = (linked.linkedIds || []).filter(id => id !== layer.id);
  }
  layer.linkedIds = [];
}

// True when a and b are already paired in a difference-mask group:
// one is the base, the other is either its mask layer or a diff layer
// linked to that mask layer.
export function areDifferenceMaskPair(a, b) {
  if (!a || !b || a.id === b.id) return false;
  // Direct image-mask relationship
  if ((a.imageMaskIds || []).includes(b.id) || (b.imageMaskIds || []).includes(a.id)) return true;
  // One is a mask for the other
  if (a.isMaskFor === b.id || b.isMaskFor === a.id) return true;
  // One is a mask layer linked to the other (mask + diff)
  if (a.isMaskFor && (a.linkedIds || []).includes(b.id)) return true;
  if (b.isMaskFor && (b.linkedIds || []).includes(a.id)) return true;
  // One is linked to a mask layer that masks the other (base + diff)
  for (const layer of [a, b]) {
    const other = layer === a ? b : a;
    for (const linkedId of (layer.linkedIds || [])) {
      const linked = State.layers.find(l => l.id === linkedId);
      if (linked?.isMaskFor === other.id) return true;
      if (linked?.imageMaskIds?.includes(other.id)) return true;
    }
  }
  return false;
}
