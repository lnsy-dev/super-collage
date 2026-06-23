/* ═══════════════════════════════════════════════════════════════════
   Spread Manager — compute and navigate reader/printer spreads

   Spreads are derived from the project page order and binding; they
   are not persisted independently. Individual pages remain the unit
   of storage, but the editor can load a spread as a single canvas.

   For saddle-stitch booklets only the cover spread and the exact
   centre spread are treated as spreads; all other pages are edited
   individually. For example:
     4 pages  → spreads (4,1) and (2,3)
     8 pages  → spreads (8,1) and (4,5); pages 2,7,6,3 are singles
     12 pages → spreads (12,1) and (6,7); the rest are singles
     16 pages → spreads (16,1) and (8,9); the rest are singles
   ═══════════════════════════════════════════════════════════════════ */

import { saddleStitchOrder } from './imposition.js';

/**
 * Compute the full set of saddle-stitch reader spreads.
 *
 * Returns an array of spread objects:
 *   {
 *     id: string,
 *     leftPageId: string,
 *     rightPageId: string,
 *     pageIds: [string, string],
 *     index: number,
 *   }
 *
 * For 8 pages this produces: (8,1), (2,7), (6,3), (4,5).
 */
export function computeSpreads(pageOrder, binding = 'none') {
  if (!pageOrder || !pageOrder.length) return [];

  if (binding === 'saddle-stitch') {
    const order = saddleStitchOrder(pageOrder.length);
    const spreads = [];
    for (let i = 0; i < order.length; i += 2) {
      const leftIdx = order[i];
      const rightIdx = order[i + 1];
      const leftPageId = leftIdx !== null ? pageOrder[leftIdx] : null;
      const rightPageId = rightIdx !== null ? pageOrder[rightIdx] : null;
      const pageIds = [leftPageId, rightPageId].filter(Boolean);
      spreads.push({
        id: pageIds.join(':'),
        leftPageId,
        rightPageId,
        pageIds,
        index: spreads.length,
      });
    }
    return spreads;
  }

  // Default / no binding: sequential pairs.
  const spreads = [];
  for (let i = 0; i < pageOrder.length; i += 2) {
    const leftPageId = pageOrder[i];
    const rightPageId = pageOrder[i + 1] || null;
    const pageIds = [leftPageId, rightPageId].filter(Boolean);
    spreads.push({
      id: pageIds.join(':'),
      leftPageId,
      rightPageId,
      pageIds,
      index: spreads.length,
    });
  }
  return spreads;
}

/**
 * Compute the editor view units for a project.
 *
 * A unit is either:
 *   { type: 'spread', id, leftPageId, rightPageId, pageIds, index }
 *   { type: 'page',   id, pageId, index }
 *
 * For saddle-stitch, only the cover spread and the exact centre spread
 * are returned as spread units; every other page is a single-page unit.
 * For 'none' binding every page is a single-page unit.
 *
 * Units are returned in page-number order (i.e. the order pages appear
 * in pageOrder).
 */
export function computeViewUnits(pageOrder, binding = 'none') {
  if (!pageOrder || !pageOrder.length) return [];

  if (binding !== 'saddle-stitch') {
    return pageOrder.map((pageId, index) => ({
      type: 'page',
      id: pageId,
      pageId,
      index,
    }));
  }

  const fullSpreads = computeSpreads(pageOrder, 'saddle-stitch');
  if (fullSpreads.length === 0) {
    return pageOrder.map((pageId, index) => ({
      type: 'page',
      id: pageId,
      pageId,
      index,
    }));
  }

  // Only perfect spreads (both pages exist) qualify as view units.
  const validSpreads = fullSpreads.filter(s => s.leftPageId && s.rightPageId);
  const coverSpread = validSpreads[0] || null;
  const centerSpread = validSpreads[validSpreads.length - 1] || null;
  const spreadPageIds = new Set([
    ...(coverSpread?.pageIds || []),
    ...(centerSpread?.pageIds || []),
  ]);

  const units = [];
  for (const pageId of pageOrder) {
    if (!spreadPageIds.has(pageId)) {
      units.push({ type: 'page', id: pageId, pageId, index: units.length });
      continue;
    }
    // Only emit a spread unit once, when we hit its lower-index page.
    if (coverSpread && coverSpread.pageIds.includes(pageId)) {
      const alreadyAdded = units.some(u => u.type === 'spread' && u.id === coverSpread.id);
      if (!alreadyAdded) {
        units.push({ type: 'spread', ...coverSpread, index: units.length });
      }
    } else if (centerSpread && centerSpread.pageIds.includes(pageId)) {
      const alreadyAdded = units.some(u => u.type === 'spread' && u.id === centerSpread.id);
      if (!alreadyAdded) {
        units.push({ type: 'spread', ...centerSpread, index: units.length });
      }
    }
  }
  return units;
}

/**
 * Find the view unit that contains a given page id.
 */
export function findUnitForPage(units, pageId) {
  return units.find(u => u.pageId === pageId || u.pageIds?.includes(pageId)) || null;
}

/**
 * Return the next/previous view unit relative to the current one.
 */
export function nextUnit(units, currentId) {
  const idx = units.findIndex(u => u.id === currentId);
  if (idx === -1) return units[0] || null;
  return units[idx + 1] || units[units.length - 1] || null;
}

export function prevUnit(units, currentId) {
  const idx = units.findIndex(u => u.id === currentId);
  if (idx === -1) return units[0] || null;
  return units[idx - 1] || units[0] || null;
}

/**
 * Build a lightweight lookup: pageId -> { unitId, side: 'left'|'right' }.
 */
export function buildSpreadLookup(units) {
  const lookup = new Map();
  for (const unit of units) {
    if (unit.type !== 'spread') continue;
    if (unit.leftPageId) lookup.set(unit.leftPageId, { unitId: unit.id, side: 'left' });
    if (unit.rightPageId) lookup.set(unit.rightPageId, { unitId: unit.id, side: 'right' });
  }
  return lookup;
}

export const SpreadManager = {
  computeSpreads,
  computeViewUnits,
  findUnitForPage,
  nextUnit,
  prevUnit,
  buildSpreadLookup,
};
