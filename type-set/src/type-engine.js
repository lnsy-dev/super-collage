/**
 * Type Engine
 *
 * Font loading, glyph shaping, text layout, and vector export
 * powered by opentype.js.
 */

import opentype from 'opentype.js';

const fontRegistry = new Map();
const cssFontCache = new Set();
const customFontFaceCache = new Set();

const LIGATURE_SEQUENCES = ['ffi', 'ffl', 'fi', 'fl', 'ff'];

function findLigatureGlyph(font, seq) {
  const names = {
    'fi':  ['fi', 'f_i', 'f_i.liga'],
    'fl':  ['fl', 'f_l', 'f_l.liga'],
    'ffi': ['ffi', 'f_f_i', 'f_f_i.liga'],
    'ffl': ['ffl', 'f_f_l', 'f_f_l.liga'],
    'ff':  ['ff', 'f_f', 'f_f.liga'],
  }[seq] || [seq];

  for (const name of names) {
    for (let j = 0; j < font.numGlyphs; j++) {
      const g = font.glyphs.get(j);
      if (g.name === name) return g;
    }
  }
  return null;
}

export async function loadFont(family, weight, style, url, force = false) {
  const key = `${family}:${weight}:${style}`;
  if (!force && fontRegistry.has(key)) {
    return fontRegistry.get(key);
  }

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const font = opentype.parse(buffer);
  fontRegistry.set(key, font);

  const cssKey = `${key}:${url}`;
  if (!cssFontCache.has(cssKey)) {
    const face = new FontFace(family, `url(${url})`, { weight, style });
    await face.load();
    document.fonts.add(face);
    cssFontCache.add(cssKey);
  }

  return font;
}

export async function loadCustomFont(family, url) {
  const cacheKey = `${family}:${url}`;

  // Return early if this exact family+url combo was already loaded
  if (customFontFaceCache.has(cacheKey)) {
    return fontRegistry.get(`${family}:400:normal`);
  }

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const font = opentype.parse(buffer);

  // Register for all common weight/style combos so the fallback chain finds it
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const styles = ['normal', 'italic'];

  for (const weight of weights) {
    for (const style of styles) {
      fontRegistry.set(`${family}:${weight}:${style}`, font);
    }
  }

  const face = new FontFace(family, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  customFontFaceCache.add(cacheKey);

  return font;
}

export function getFont(family, weight, style) {
  return fontRegistry.get(`${family}:${weight}:${style}`) || null;
}

/**
 * Shape text into glyphs with optional ligature substitution.
 * Each glyph tracks its starting character index and how many chars it represents.
 */
export function shapeText(text, font, fontSize, useLigatures = true) {
  if (!font) return [];

  const scale = fontSize / font.unitsPerEm;
  const glyphs = [];
  let i = 0;

  while (i < text.length) {
    let matched = false;

    if (useLigatures) {
      for (const seq of LIGATURE_SEQUENCES) {
        if (i + seq.length <= text.length && text.slice(i, i + seq.length) === seq) {
          const lig = findLigatureGlyph(font, seq);
          if (lig) {
            glyphs.push({
              char: seq,
              glyphIndex: lig.index,
              advanceWidth: (lig.advanceWidth || font.unitsPerEm) * scale,
              leftBearing: (lig.leftSideBearing || 0) * scale,
              path: lig.path,
              spacingOffset: 0,
              kerningOverride: 0,
              charIndex: i,
              charCount: seq.length,
            });
            i += seq.length;
            matched = true;
            break;
          }
        }
      }
    }

    if (!matched) {
      const char = text[i];
      const glyphIndex = font.charToGlyphIndex(char);
      const glyph = font.glyphs.get(glyphIndex);
      glyphs.push({
        char,
        glyphIndex,
        advanceWidth: (glyph.advanceWidth || font.unitsPerEm) * scale,
        leftBearing: (glyph.leftSideBearing || 0) * scale,
        path: glyph.path,
        spacingOffset: 0,
        kerningOverride: 0,
        charIndex: i,
        charCount: 1,
      });
      i++;
    }
  }

  return glyphs;
}

export function applyKerning(glyphs, font, fontSize) {
  if (!font || glyphs.length < 2) return;
  const scale = fontSize / font.unitsPerEm;

  for (let i = 1; i < glyphs.length; i++) {
    const prev = glyphs[i - 1];
    const curr = glyphs[i];
    const kerning = font.getKerningValue(
      font.glyphs.get(prev.glyphIndex),
      font.glyphs.get(curr.glyphIndex)
    );
    curr.kerning = (kerning || 0) * scale;
  }
}

export function layoutGlyphs(glyphs, maxWidth, lineHeightPx, options = {}) {
  const {
    textAlign = 'left',
    hyphenMap = null,
    text = '',
    fontSize = 48,
    startY = 0,
  } = options;

  function getGlyphWidth(idx, prevIdxInLine) {
    const g = glyphs[idx];
    const prev = prevIdxInLine !== null ? glyphs[prevIdxInLine] : null;
    const kerning = prev ? (g.kerning || 0) + g.kerningOverride : 0;
    return g.advanceWidth + g.spacingOffset + kerning;
  }

  // ── Pass 1: build lines (arrays of glyph indices) ──
  const lines = [];
  let currentLine = [];
  let currentLineWidth = 0;
  let lastWordStart = 0; // index in glyphs array
  let i = 0;

  while (i < glyphs.length) {
    const g = glyphs[i];
    const prevInLine = currentLine.length > 0 ? currentLine[currentLine.length - 1] : null;
    const width = getGlyphWidth(i, prevInLine);
    const isWordBreak = g.char === ' ' || g.char === '\n';

    if (isWordBreak) {
      lastWordStart = i + 1;
    }

    if (g.char === '\n') {
      currentLine.push(i);
      currentLineWidth += width;
      lines.push({ glyphs: currentLine, width: currentLineWidth });
      currentLine = [];
      currentLineWidth = 0;
      lastWordStart = i + 1;
      i++;
      continue;
    }

    if (currentLineWidth + width > maxWidth && currentLine.length > 0) {
      let didHyphenate = false;

      // ── try hyphenation ──
      if (hyphenMap && lastWordStart < i) {
        const wordStartGlyph = glyphs[lastWordStart];
        const wordEndGlyph = glyphs[i];
        const wordStartChar = wordStartGlyph.charIndex;
        const wordEndChar = wordEndGlyph.charIndex + (wordEndGlyph.charCount || 1);
        const wordText = text.slice(wordStartChar, wordEndChar);

        const syllables = hyphenMap.get(wordText);
        if (syllables && syllables.length > 1) {
          const font = getFont(wordStartGlyph.fontFamily, wordStartGlyph.fontWeight, wordStartGlyph.fontStyle);
          if (font) {
            for (let s = syllables.length - 1; s >= 1; s--) {
              const prefixText = syllables.slice(0, s).join('');
              const suffixText = syllables.slice(s).join('');
              const prefixWithHyphen = prefixText + '-';

              const prefixGlyphs = shapeText(prefixWithHyphen, font, fontSize, false);
              applyKerning(prefixGlyphs, font, fontSize);
              const baseSpacing = wordStartGlyph.spacingOffset || 0;
              for (const pg of prefixGlyphs) {
                pg.spacingOffset = baseSpacing;
                pg.fontFamily = wordStartGlyph.fontFamily;
                pg.fontWeight = wordStartGlyph.fontWeight;
                pg.fontStyle = wordStartGlyph.fontStyle;
              }

              let prefixWidth = 0;
              for (let p = 0; p < prefixGlyphs.length; p++) {
                const pgPrev = p > 0 ? prefixGlyphs[p - 1] : null;
                const pgKern = pgPrev ? (prefixGlyphs[p].kerning || 0) + prefixGlyphs[p].kerningOverride : 0;
                prefixWidth += prefixGlyphs[p].advanceWidth + prefixGlyphs[p].spacingOffset + pgKern;
              }

              if (currentLineWidth + prefixWidth <= maxWidth) {
                // build suffix glyphs
                const suffixGlyphs = shapeText(suffixText, font, fontSize, false);
                applyKerning(suffixGlyphs, font, fontSize);
                for (const sg of suffixGlyphs) {
                  sg.spacingOffset = baseSpacing;
                  sg.fontFamily = wordStartGlyph.fontFamily;
                  sg.fontWeight = wordStartGlyph.fontWeight;
                  sg.fontStyle = wordStartGlyph.fontStyle;
                }

                // set char indices
                for (let p = 0; p < prefixGlyphs.length - 1; p++) {
                  prefixGlyphs[p].charIndex = wordStartChar + p;
                  prefixGlyphs[p].charCount = 1;
                }
                const hyphenGlyph = prefixGlyphs[prefixGlyphs.length - 1];
                hyphenGlyph.charIndex = wordStartChar + prefixText.length - 1;
                hyphenGlyph.charCount = 0;

                for (let p = 0; p < suffixGlyphs.length; p++) {
                  suffixGlyphs[p].charIndex = wordStartChar + prefixText.length + p;
                  suffixGlyphs[p].charCount = 1;
                }

                // splice into main array
                const deleteCount = i - lastWordStart + 1;
                glyphs.splice(lastWordStart, deleteCount, ...prefixGlyphs);
                const suffixStart = lastWordStart + prefixGlyphs.length;
                glyphs.splice(suffixStart, 0, ...suffixGlyphs);

                // rebuild current line: remove old word, add prefix
                while (currentLine.length > 0 && currentLine[currentLine.length - 1] >= lastWordStart) {
                  currentLine.pop();
                }
                currentLineWidth = 0;
                for (let li = 0; li < currentLine.length; li++) {
                  const linePrev = li > 0 ? currentLine[li - 1] : null;
                  currentLineWidth += getGlyphWidth(currentLine[li], linePrev);
                }
                for (let p = 0; p < prefixGlyphs.length; p++) {
                  const pgIdx = lastWordStart + p;
                  const linePrev = currentLine.length > 0 ? currentLine[currentLine.length - 1] : null;
                  currentLine.push(pgIdx);
                  currentLineWidth += getGlyphWidth(pgIdx, linePrev);
                }

                lines.push({ glyphs: currentLine, width: currentLineWidth });

                // start new line with suffix
                currentLine = [];
                currentLineWidth = 0;
                for (let p = 0; p < suffixGlyphs.length; p++) {
                  const sgIdx = suffixStart + p;
                  const linePrev = currentLine.length > 0 ? currentLine[currentLine.length - 1] : null;
                  currentLine.push(sgIdx);
                  currentLineWidth += getGlyphWidth(sgIdx, linePrev);
                }

                i = suffixStart + suffixGlyphs.length;
                lastWordStart = suffixStart;
                didHyphenate = true;
                break;
              }
            }
          }
        }
      }

      if (!didHyphenate) {
        // normal word wrap
        const wrappedWord = [];
        let wrappedWordWidth = 0;

        if (lastWordStart < i) {
          // remove overflowing word from current line
          while (currentLine.length > 0 && currentLine[currentLine.length - 1] >= lastWordStart) {
            currentLine.pop();
          }
          currentLineWidth = 0;
          for (let li = 0; li < currentLine.length; li++) {
            const linePrev = li > 0 ? currentLine[li - 1] : null;
            currentLineWidth += getGlyphWidth(currentLine[li], linePrev);
          }
          // build wrapped word for next line
          for (let j = lastWordStart; j < i; j++) {
            const wPrev = wrappedWord.length > 0 ? wrappedWord[wrappedWord.length - 1] : null;
            wrappedWord.push(j);
            wrappedWordWidth += getGlyphWidth(j, wPrev);
          }
        }

        lines.push({ glyphs: currentLine, width: currentLineWidth });
        currentLine = wrappedWord;
        currentLineWidth = wrappedWordWidth;

        const linePrev = currentLine.length > 0 ? currentLine[currentLine.length - 1] : null;
        currentLine.push(i);
        currentLineWidth += getGlyphWidth(i, linePrev);
        i++;
        continue;
      }
    } else {
      currentLine.push(i);
      currentLineWidth += width;
      i++;
    }
  }

  if (currentLine.length > 0) {
    lines.push({ glyphs: currentLine, width: currentLineWidth });
  }

  // ── Pass 2: position glyphs with alignment ──
  let y = startY + lineHeightPx;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const isLastLine = li === lines.length - 1;
    let lineX = 0;

    const extra = maxWidth - line.width;

    if (textAlign === 'right') {
      lineX = Math.max(0, extra);
    } else if (textAlign === 'center') {
      lineX = Math.max(0, extra / 2);
    } else if (textAlign === 'justify' && !isLastLine && line.width > 0 && extra > 0) {
      const spaceCount = line.glyphs.filter(gi => glyphs[gi].char === ' ').length;
      if (spaceCount > 0) {
        const spacePerGap = extra / spaceCount;
        let accumulated = 0;
        for (let gi = 0; gi < line.glyphs.length; gi++) {
          const glyphIdx = line.glyphs[gi];
          const g = glyphs[glyphIdx];
          const prevIdx = gi > 0 ? line.glyphs[gi - 1] : null;
          const kerning = prevIdx !== null ? (g.kerning || 0) + g.kerningOverride : 0;
          const gw = g.advanceWidth + g.spacingOffset + kerning;
          g.x = lineX + accumulated;
          g.y = y;
          lineX += gw;
          if (g.char === ' ') {
            accumulated += spacePerGap;
          }
        }
        y += lineHeightPx;
        continue;
      }
    }

    // left align (or fallback)
    for (let gi = 0; gi < line.glyphs.length; gi++) {
      const glyphIdx = line.glyphs[gi];
      const g = glyphs[glyphIdx];
      const prevIdx = gi > 0 ? line.glyphs[gi - 1] : null;
      const kerning = prevIdx !== null ? (g.kerning || 0) + g.kerningOverride : 0;
      const gw = g.advanceWidth + g.spacingOffset + kerning;
      g.x = lineX;
      g.y = y;
      lineX += gw;
    }
    y += lineHeightPx;
  }

  return y;
}

export function hitTest(glyphs, clickX, clickY, lineHeightPx) {
  if (glyphs.length === 0) return 0;

  const firstLineY = glyphs[0].y;

  if (clickY < firstLineY - lineHeightPx / 2) {
    return 0;
  }

  const targetLine = Math.max(0, Math.round((clickY - firstLineY) / lineHeightPx));

  const lineGlyphs = glyphs.filter(g =>
    Math.abs(g.y - (firstLineY + targetLine * lineHeightPx)) < lineHeightPx / 2
  );

  if (lineGlyphs.length === 0) {
    const last = glyphs[glyphs.length - 1];
    return last.charIndex + (last.charCount ?? 1);
  }

  let closest = lineGlyphs[0];
  let minDist = Infinity;

  for (const g of lineGlyphs) {
    const centerX = g.x + (g.advanceWidth + g.spacingOffset) / 2;
    const dist = Math.abs(clickX - centerX);
    if (dist < minDist) {
      minDist = dist;
      closest = g;
    }
  }

  const centerX = closest.x + (closest.advanceWidth + closest.spacingOffset) / 2;
  if (clickX < centerX) {
    return closest.charIndex;
  }
  return closest.charIndex + (closest.charCount ?? 1);
}

export function exportGlyphSVG(glyphs, fontSize, color, width, height) {
  const paths = [];

  for (const g of glyphs) {
    if (!g.path) continue;
    const scale = fontSize / g.path.unitsPerEm;
    const cmds = g.path.commands.map((cmd) => {
      const s = { type: cmd.type };
      if ('x' in cmd) s.x = cmd.x * scale + g.x;
      if ('y' in cmd) s.y = cmd.y * scale + g.y;
      if ('x1' in cmd) s.x1 = cmd.x1 * scale + g.x;
      if ('y1' in cmd) s.y1 = cmd.y1 * scale + g.y;
      if ('x2' in cmd) s.x2 = cmd.x2 * scale + g.x;
      if ('y2' in cmd) s.y2 = cmd.y2 * scale + g.y;
      return s;
    });

    let d = '';
    for (const cmd of cmds) {
      switch (cmd.type) {
        case 'M': d += `M${cmd.x},${cmd.y} `; break;
        case 'L': d += `L${cmd.x},${cmd.y} `; break;
        case 'C': d += `C${cmd.x1},${cmd.y1} ${cmd.x2},${cmd.y2} ${cmd.x},${cmd.y} `; break;
        case 'Q': d += `Q${cmd.x1},${cmd.y1} ${cmd.x},${cmd.y} `; break;
        case 'Z': d += 'Z '; break;
      }
    }

    if (d) paths.push(`<path d="${d.trim()}"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}">\n` +
    `<g fill="${color}">\n${paths.join('\n')}\n</g>\n` +
    `</svg>`;
}
