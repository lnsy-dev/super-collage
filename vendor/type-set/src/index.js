/**
 * type-set
 *
 * Portable canvas typography library.
 */

export { TypeSetElement } from './type-set.js';
export {
  TypeSetRenderer,
  renderTextToCanvas,
  renderTextToSVG,
  renderTextToPNG,
} from './type-renderer.js';
export {
  loadFont,
  loadCustomFont,
  loadFontFromBuffer,
  getFont,
  setFontBase,
  getFontBase,
  registerFont,
  shapeText,
  applyKerning,
  layoutGlyphs,
  hitTest,
  exportGlyphSVG,
} from './type-engine.js';
export {
  FONT_FILES,
  FONT_WEIGHTS,
  hasItalic,
  snapWeight,
  getFontUrl,
} from './font-data.js';
export { hyphenateWord, buildHyphenMap } from './hyphenate.js';
