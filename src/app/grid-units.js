/* ═══════════════════════════════════════════════════════════════════
   Grid size units — convert between page pixels (600 dpi) and the
   project measurement unit chosen in the creation wizard.
   ═══════════════════════════════════════════════════════════════════ */

const DPI = 600;
const CM_PER_INCH = 2.54;

/** Project measurement unit: 'imperial' (inches) or 'metric' (cm). */
export function projectGridUnit(project) {
  return project?.pageSizeUnit === 'metric' ? 'metric' : 'imperial';
}

export function pxPerUnit(unit) {
  return unit === 'metric' ? DPI / CM_PER_INCH : DPI;
}

export function unitLabel(unit) {
  return unit === 'metric' ? 'cm' : 'inches';
}

/** Convert a grid size in page pixels to the display/edit unit. */
export function pxToGridUnit(px, unit) {
  return (Number(px) || 0) / pxPerUnit(unit);
}

/** Convert a grid size entered in the display/edit unit to page pixels. */
export function gridUnitToPx(value, unit) {
  return (Number(value) || 0) * pxPerUnit(unit);
}

/** Round a unit value for display, trimming trailing zeros. */
export function formatGridUnitValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  // Show enough precision for common fractions in either unit.
  return n.toFixed(3).replace(/\.?0+$/, '') || '0';
}

/**
 * Default/target grid size in px for auto-adjustment, expressed as a
 * round value in the project's unit (0.25 in or 0.5 cm).
 */
export function defaultGridTargetPx(unit) {
  return Math.round(gridUnitToPx(unit === 'metric' ? 0.5 : 0.25, unit));
}
