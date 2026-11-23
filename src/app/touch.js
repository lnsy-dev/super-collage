/* ═══════════════════════════════════════════════════════════════════
   Touch device detection
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Pure decision function for "is this a touch device?" so the signal
 * combination is unit-testable without a DOM.
 *
 * A device counts as touch when any of the usual signals report touch
 * capability: a coarse primary pointer, `ontouchstart` present on the
 * window, or a nonzero `maxTouchPoints`.
 *
 * @param {{ maxTouchPoints?: number, hasCoarsePointer?: boolean, hasTouchStart?: boolean }} signals
 * @returns {boolean}
 */
export function detectTouchDevice({ maxTouchPoints = 0, hasCoarsePointer = false, hasTouchStart = false } = {}) {
  if (hasCoarsePointer) return true;
  if (hasTouchStart) return true;
  return maxTouchPoints > 0;
}

/**
 * Detect touch capability from the live browser environment. Deliberately
 * generous (any one signal is enough) — a false positive only shows the
 * layer multi-select checkbox, which stays harmless on a mouse device.
 *
 * @returns {boolean}
 */
export function isTouchDevice() {
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)')
    : null;
  return detectTouchDevice({
    maxTouchPoints: navigator.maxTouchPoints || 0,
    hasCoarsePointer: Boolean(media && media.matches),
    hasTouchStart: 'ontouchstart' in window,
  });
}
