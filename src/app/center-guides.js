/* ═══════════════════════════════════════════════════════════════════
   Center guide positions (View → View Vertical/Horizontal Center)

   Pure geometry for the optional center guidelines Renderer.drawCenterGuides
   paints on the display canvas. Positions are in PAGE coordinates (the
   600 dpi document space whose origin is the paper's top-left corner);
   the renderer scales them by zoom, so the guides stay glued to the
   paper when the user zooms or pans.

   The center is the center of the PAPER, never of the viewport or of
   the display canvas' backing store. In spread view the document shows
   two pages side by side divided at spreadSplitX, so the "vertical
   center" guide is drawn at each page's own center rather than at the
   fold. ═════════════════════════════════════════════════════════════ */

/**
 * X positions (page px) of the vertical center guide(s) for a document
 * of width `pageW`. In spread view (`spreadSplitX` > 0) each side of the
 * fold gets its own page-center guide; otherwise the single guide sits
 * at the page's horizontal center.
 */
export function verticalCenterGuideXs(pageW, spreadSplitX = 0) {
  if (!(pageW > 0)) return [];
  if (spreadSplitX > 0) {
    return [spreadSplitX / 2, (spreadSplitX + pageW) / 2];
  }
  return [pageW / 2];
}

/**
 * Y positions (page px) of the horizontal center guide for a document of
 * height `pageH`. Spread pages share one height, so there is always a
 * single guide.
 */
export function horizontalCenterGuideYs(pageH) {
  if (!(pageH > 0)) return [];
  return [pageH / 2];
}
