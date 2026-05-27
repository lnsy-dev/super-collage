/**
 * Shared glyph rendering utility.
 * Eliminates DRY violations between TypeSet._render(), renderTypeSetLayer(),
 * and renderTypeSetToCanvas().
 */

/**
 * Draw a list of glyphs onto a canvas 2D context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} glyphs            – shaped glyphs from type-engine.js
 * @param {Object} options
 * @param {number} options.fontSize – CSS pixel font size
 * @param {string} options.color    – fill color
 * @param {number} [options.scale=1] – additional scale factor (e.g. for export)
 */
export function drawGlyphs(ctx, glyphs, { fontSize, color, scale = 1 } = {}) {
  if (!glyphs || glyphs.length === 0) return;

  ctx.save();
  ctx.fillStyle = color || '#000';
  ctx.textBaseline = 'alphabetic';

  let currentFont = null;
  for (const g of glyphs) {
    if (g.char === '\n') continue;
    const fs = fontSize * scale;
    const fontStr = `${g.fontStyle} ${g.fontWeight} ${fs}px "${g.fontFamily}"`;
    if (fontStr !== currentFont) {
      ctx.font = fontStr;
      currentFont = fontStr;
    }
    ctx.fillText(g.char, g.x * scale, g.y * scale);
  }
  ctx.restore();
}

/**
 * Draw a text cursor (caret) at a given text index.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} glyphs
 * @param {number} index            – character index where cursor should appear
 * @param {Object} options
 * @param {number} options.fontSize
 * @param {number} options.lineHeightPx
 * @param {string} options.color
 * @param {number} [options.lineWidth=2]
 * @param {number} [options.scale=1]
 */
export function drawCursor(ctx, glyphs, index, { fontSize, lineHeightPx, color, lineWidth = 2, scale = 1 } = {}) {
  let x = 0;
  let y = fontSize;

  if (glyphs.length > 0) {
    if (index >= glyphs[glyphs.length - 1].charIndex + (glyphs[glyphs.length - 1].charCount ?? 1)) {
      const last = glyphs[glyphs.length - 1];
      x = last.x + last.advanceWidth + last.spacingOffset;
      y = last.y;
    } else {
      for (const g of glyphs) {
        const gStart = g.charIndex;
        const gEnd = g.charIndex + (g.charCount ?? 1);
        if (index >= gStart && index < gEnd) {
          const ratio = (index - gStart) / (g.charCount || 1);
          x = g.x + (g.advanceWidth + g.spacingOffset) * ratio;
          y = g.y;
          break;
        }
      }
    }
  }

  ctx.save();
  ctx.strokeStyle = color || '#000';
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x * scale, (y - fontSize) * scale);
  ctx.lineTo(x * scale, (y + (lineHeightPx - fontSize)) * scale);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw selection highlight rectangles.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} glyphs
 * @param {number} selStart
 * @param {number} selEnd
 * @param {Object} options
 * @param {number} options.fontSize
 * @param {number} options.lineHeightPx
 * @param {string} [options.fillStyle='rgba(10, 92, 10, 0.2)']
 * @param {number} [options.scale=1]
 */
export function drawSelection(ctx, glyphs, selStart, selEnd, { fontSize, lineHeightPx, fillStyle = 'rgba(10, 92, 10, 0.2)', scale = 1 } = {}) {
  if (selStart === selEnd) return;
  const start = Math.min(selStart, selEnd);
  const end = Math.max(selStart, selEnd);

  ctx.save();
  ctx.fillStyle = fillStyle;

  for (const g of glyphs) {
    const gCharStart = g.charIndex;
    const gCharEnd = g.charIndex + (g.charCount || 1);
    if (gCharEnd <= start || gCharStart >= end) continue;

    ctx.fillRect(
      g.x * scale,
      (g.y - fontSize) * scale,
      (g.advanceWidth + g.spacingOffset) * scale,
      lineHeightPx * scale
    );
  }
  ctx.restore();
}
