/**
 * TypeSet Custom HTML Element
 *
 * Canvas-based typography editor with per-glyph control via opentype.js.
 * Refactored to use TextModel, InputController, and CanvasRenderer modules.
 */

import DataroomElement from 'dataroom-js';
import {
  loadFont,
  loadCustomFont,
  getFont,
  shapeText,
  applyKerning,
  layoutGlyphs,
  hitTest,
  exportGlyphSVG,
} from './type-engine.js';
import { buildHyphenMap } from './hyphenate.js';
import { TextModel } from './text-model.js';
import { InputController } from './input-controller.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { drawGlyphs, drawCursor, drawSelection } from './render-glyphs.js';

const DEFAULTS = {
  'font-family': 'IBM Plex Serif',
  'font-size': '18',
  'font-weight': '400',
  'font-style': 'normal',
  'letter-spacing': '0',
  'line-height': '1.2',
  'color': '#0a5c0a',
  'text-align': 'left',
};

const FONT_FILES = {
  'IBM Plex Serif': {
    100: { normal: 'ibm-plex-serif-latin-100-normal.woff', italic: 'ibm-plex-serif-latin-100-italic.woff' },
    200: { normal: 'ibm-plex-serif-latin-200-normal.woff', italic: 'ibm-plex-serif-latin-200-italic.woff' },
    300: { normal: 'ibm-plex-serif-latin-300-normal.woff', italic: 'ibm-plex-serif-latin-300-italic.woff' },
    400: { normal: 'ibm-plex-serif-latin-400-normal.woff', italic: 'ibm-plex-serif-latin-400-italic.woff' },
    500: { normal: 'ibm-plex-serif-latin-500-normal.woff', italic: 'ibm-plex-serif-latin-500-italic.woff' },
    600: { normal: 'ibm-plex-serif-latin-600-normal.woff', italic: 'ibm-plex-serif-latin-600-italic.woff' },
    700: { normal: 'ibm-plex-serif-latin-700-normal.woff', italic: 'ibm-plex-serif-latin-700-italic.woff' },
  },
  'IBM Plex Sans': {
    100: { normal: 'ibm-plex-sans-latin-100-normal.woff', italic: 'ibm-plex-sans-latin-100-italic.woff' },
    200: { normal: 'ibm-plex-sans-latin-200-normal.woff', italic: 'ibm-plex-sans-latin-200-italic.woff' },
    300: { normal: 'ibm-plex-sans-latin-300-normal.woff', italic: 'ibm-plex-sans-latin-300-italic.woff' },
    400: { normal: 'ibm-plex-sans-latin-400-normal.woff', italic: 'ibm-plex-sans-latin-400-italic.woff' },
    500: { normal: 'ibm-plex-sans-latin-500-normal.woff', italic: 'ibm-plex-sans-latin-500-italic.woff' },
    600: { normal: 'ibm-plex-sans-latin-600-normal.woff', italic: 'ibm-plex-sans-latin-600-italic.woff' },
    700: { normal: 'ibm-plex-sans-latin-700-normal.woff', italic: 'ibm-plex-sans-latin-700-italic.woff' },
  },
  'Crimson Text': {
    400: { normal: 'crimson-text-latin-400-normal.woff', italic: 'crimson-text-latin-400-italic.woff' },
    600: { normal: 'crimson-text-latin-600-normal.woff', italic: 'crimson-text-latin-600-italic.woff' },
    700: { normal: 'crimson-text-latin-700-normal.woff', italic: 'crimson-text-latin-700-italic.woff' },
  },
  'Fira Code': {
    300: { normal: 'fira-code-latin-300-normal.woff' },
    400: { normal: 'fira-code-latin-400-normal.woff' },
    500: { normal: 'fira-code-latin-500-normal.woff' },
    600: { normal: 'fira-code-latin-600-normal.woff' },
    700: { normal: 'fira-code-latin-700-normal.woff' },
  },
  'League Gothic': {
    400: { normal: 'league-gothic-latin-400-normal.woff' },
  },
  'Atkinson Hyperlegible': {
    400: { normal: 'atkinson-hyperlegible-latin-400-normal.woff', italic: 'atkinson-hyperlegible-latin-400-italic.woff' },
    700: { normal: 'atkinson-hyperlegible-latin-700-normal.woff', italic: 'atkinson-hyperlegible-latin-700-italic.woff' },
  },
  'Cormorant Garamond': {
    300: { normal: 'cormorant-garamond-latin-300-normal.woff', italic: 'cormorant-garamond-latin-300-italic.woff' },
    400: { normal: 'cormorant-garamond-latin-400-normal.woff', italic: 'cormorant-garamond-latin-400-italic.woff' },
    500: { normal: 'cormorant-garamond-latin-500-normal.woff', italic: 'cormorant-garamond-latin-500-italic.woff' },
    600: { normal: 'cormorant-garamond-latin-600-normal.woff', italic: 'cormorant-garamond-latin-600-italic.woff' },
    700: { normal: 'cormorant-garamond-latin-700-normal.woff', italic: 'cormorant-garamond-latin-700-italic.woff' },
  },
  'EB Garamond': {
    400: { normal: 'eb-garamond-latin-400-normal.woff', italic: 'eb-garamond-latin-400-italic.woff' },
    500: { normal: 'eb-garamond-latin-500-normal.woff', italic: 'eb-garamond-latin-500-italic.woff' },
    600: { normal: 'eb-garamond-latin-600-normal.woff', italic: 'eb-garamond-latin-600-italic.woff' },
    700: { normal: 'eb-garamond-latin-700-normal.woff', italic: 'eb-garamond-latin-700-italic.woff' },
    800: { normal: 'eb-garamond-latin-800-normal.woff', italic: 'eb-garamond-latin-800-italic.woff' },
  },
  'Spectral': {
    200: { normal: 'spectral-latin-200-normal.woff', italic: 'spectral-latin-200-italic.woff' },
    300: { normal: 'spectral-latin-300-normal.woff', italic: 'spectral-latin-300-italic.woff' },
    400: { normal: 'spectral-latin-400-normal.woff', italic: 'spectral-latin-400-italic.woff' },
    500: { normal: 'spectral-latin-500-normal.woff', italic: 'spectral-latin-500-italic.woff' },
    600: { normal: 'spectral-latin-600-normal.woff', italic: 'spectral-latin-600-italic.woff' },
    700: { normal: 'spectral-latin-700-normal.woff', italic: 'spectral-latin-700-italic.woff' },
    800: { normal: 'spectral-latin-800-normal.woff', italic: 'spectral-latin-800-italic.woff' },
  },
  'UnifrakturMaguntia': {
    400: { normal: 'unifrakturmaguntia-latin-400-normal.woff' },
  },
};

export const FONT_WEIGHTS = {
  'IBM Plex Serif': [100, 200, 300, 400, 500, 600, 700],
  'IBM Plex Sans': [100, 200, 300, 400, 500, 600, 700],
  'Crimson Text': [400, 600, 700],
  'Fira Code': [300, 400, 500, 600, 700],
  'League Gothic': [400],
  'Atkinson Hyperlegible': [400, 700],
  'Cormorant Garamond': [300, 400, 500, 600, 700],
  'EB Garamond': [400, 500, 600, 700, 800],
  'Spectral': [200, 300, 400, 500, 600, 700, 800],
  'UnifrakturMaguntia': [400],
};

export function hasItalic(family) {
  const map = FONT_FILES[family];
  if (!map) return false;
  const first = Object.values(map)[0];
  return !!first.italic;
}

export function snapWeight(family, weight) {
  const available = FONT_WEIGHTS[family];
  if (!available) return weight;
  const num = typeof weight === 'string' ? parseInt(weight, 10) : weight;
  return available.reduce((prev, curr) =>
    Math.abs(curr - num) < Math.abs(prev - num) ? curr : prev
  );
}

function getFontUrl(family, weight, style, base = './fonts/') {
  const map = FONT_FILES[family];
  if (!map) return null;
  const weightMap = map[weight];
  if (!weightMap) return null;
  const path = weightMap[style] || weightMap.normal || null;
  if (!path) return null;
  const prefix = base.endsWith('/') ? base : base + '/';
  return prefix + path;
}

/* ────────────────────────────────────────────────────────────────── */

class TypeSet extends DataroomElement {
  #model = null;
  #input = null;
  #renderer = null;
  #resizeObserver = null;
  #resizeTimeout = null;

  #currentFamily = DEFAULTS['font-family'];
  #currentWeight = DEFAULTS['font-weight'];
  #globalWeight = DEFAULTS['font-weight'];
  #globalItalic = DEFAULTS['font-style'];
  #globalLetterSpacing = parseFloat(DEFAULTS['letter-spacing']);
  #lineHeightMultiplier = parseFloat(DEFAULTS['line-height']);
  #textAlign = DEFAULTS['text-align'];
  #useLigatures = true;
  #useKerning = true;
  #useHyphenation = true;

  #glyphs = [];
  #totalHeight = 0;
  #fontSize = parseFloat(DEFAULTS['font-size']);
  #lineHeightPx = this.#fontSize * this.#lineHeightMultiplier;

  #prevCustomFont = null;
  #prevWeightSpecificHash = '';

  constructor() {
    super();
  }

  async initialize() {
    this.innerHTML = '';

    this.#model = new TextModel('The quick brown fox jumps over the lazy dog.');
    this.#model.addEventListener('change', () => this._onModelChange());
    this.#model.addEventListener('selectionchange', () => this._onSelectionChange());

    this.#renderer = new CanvasRenderer(this);
    this.#renderer.onBlink = () => this._render();

    const textarea = document.createElement('textarea');
    textarea.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;left:-9999px;';
    this.appendChild(textarea);

    this.#input = new InputController({
      model: this.#model,
      canvas: this.#renderer.canvas,
      textarea,
      onModelChange: (reason) => this._onInputChange(reason),
      onRenderRequest: () => this._render(),
      getLayout: () => ({ glyphs: this.#glyphs, fontSize: this.#fontSize, lineHeightPx: this.#lineHeightPx }),
    });

    this.#resizeObserver = new ResizeObserver(() => {
      if (this.#resizeTimeout) clearTimeout(this.#resizeTimeout);
      this.#resizeTimeout = setTimeout(() => this._shapeAndLayout(), 50);
    });
    this.#resizeObserver.observe(this);

    this.on('NODE-CHANGED', () => this._onAttrChange());

    await this._loadFonts();
    this.#renderer.startBlink();
  }

  disconnectedCallback() {
    if (this.#renderer) this.#renderer.destroy();
    if (this.#input) this.#input.destroy();
    if (this.#resizeObserver) this.#resizeObserver.disconnect();
    if (this.#resizeTimeout) clearTimeout(this.#resizeTimeout);
  }

  /* ── Public API ── */

  get text() {
    return this.#model.text;
  }

  set text(value) {
    this.#model.text = value;
    this._syncTextarea();
    this._shapeAndLayout();
    this.event('typeset-change', { text: value });
  }

  get glyphs() {
    return this.#glyphs;
  }

  get totalHeight() {
    return this.#totalHeight;
  }

  get hasSelection() {
    return this.#model.hasSelection;
  }

  get selStart() {
    return this.#model.selStart;
  }

  get selEnd() {
    return this.#model.selEnd;
  }

  get cursorIndex() {
    return this.#model.cursor;
  }

  get textarea() {
    return this.#input?.textarea;
  }

  // Style runs (replaces perCharWeight/Spacing/Italic)
  get runs() {
    return this.#model.runs;
  }

  set runs(value) {
    this.#model.runs = value;
    this._shapeAndLayout();
  }

  get globalLetterSpacing() {
    return this.#globalLetterSpacing;
  }

  get lineHeightMultiplier() {
    return this.#lineHeightMultiplier;
  }

  get textAlign() {
    return this.#textAlign;
  }

  get useLigatures() {
    return this.#useLigatures;
  }

  set useLigatures(value) {
    this.#useLigatures = value;
  }

  get useKerning() {
    return this.#useKerning;
  }

  set useKerning(value) {
    this.#useKerning = value;
  }

  get useHyphenation() {
    return this.#useHyphenation;
  }

  set useHyphenation(value) {
    this.#useHyphenation = value;
  }

  /* ── Internal ── */

  _getFontBase() {
    return this.getAttribute('font-base') || './fonts/';
  }

  _fontSizePx() {
    const val = parseFloat(this.getAttribute('font-size') || DEFAULTS['font-size']);
    // Backward compatibility: values >= 50 were stored as px (old format),
    // values < 50 are pt (new format). 1pt @ 600dpi = 600/72 px.
    return val >= 50 ? val : val * (600 / 72);
  }

  _getWeightSpecificFontsHash() {
    const parts = [];
    const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
    for (const w of weights) {
      const normal = this.getAttribute(`font-${w}`);
      const italic = this.getAttribute(`font-${w}-italic`);
      if (normal) parts.push(`${w}:n:${normal}`);
      if (italic) parts.push(`${w}:i:${italic}`);
    }
    return parts.join('|');
  }

  async _loadFonts() {
    const family = this.#currentFamily;
    const base = this._getFontBase();
    const customFontUrl = this.getAttribute('font');

    // Collect distinct weights from global + runs
    const weights = new Set([this.#globalWeight]);
    for (const run of this.#model.runs) {
      if (run.weight) weights.add(String(run.weight));
    }

    let hasWeightSpecific = false;
    for (const weight of weights) {
      if (this.getAttribute(`font-${weight}`) || this.getAttribute(`font-${weight}-italic`)) {
        hasWeightSpecific = true;
        break;
      }
    }

    if (customFontUrl && !hasWeightSpecific) {
      this.#prevCustomFont = customFontUrl;
      await loadCustomFont(family, customFontUrl);
      this._shapeAndLayout();
      return;
    }

    if (customFontUrl) {
      await loadCustomFont(family, customFontUrl);
    }

    for (const weight of weights) {
      const customNormal = this.getAttribute(`font-${weight}`);
      const customItalic = this.getAttribute(`font-${weight}-italic`);

      if (customNormal) {
        await loadFont(family, weight, 'normal', customNormal, true);
      } else if (!customFontUrl) {
        const normalUrl = getFontUrl(family, weight, 'normal', base);
        if (normalUrl) await loadFont(family, weight, 'normal', normalUrl);
      }

      if (customItalic) {
        await loadFont(family, weight, 'italic', customItalic, true);
      } else if (!customFontUrl) {
        const italicUrl = getFontUrl(family, weight, 'italic', base);
        if (italicUrl) await loadFont(family, weight, 'italic', italicUrl);
      }
    }

    this._shapeAndLayout();
  }

  _onAttrChange() {
    const family = this.getAttribute('font-family') || DEFAULTS['font-family'];
    const weight = this.getAttribute('font-weight') || DEFAULTS['font-weight'];
    const style = this.getAttribute('font-style') || DEFAULTS['font-style'];
    const spacing = parseFloat(this.getAttribute('letter-spacing') || DEFAULTS['letter-spacing']);
    const lineHeight = parseFloat(this.getAttribute('line-height') || DEFAULTS['line-height']);
    const textAlign = this.getAttribute('text-align') || DEFAULTS['text-align'];
    const customFont = this.getAttribute('font');
    const weightSpecificHash = this._getWeightSpecificFontsHash();

    this.#globalLetterSpacing = spacing;
    this.#lineHeightMultiplier = lineHeight;
    this.#textAlign = textAlign;

    const snappedWeight = String(snapWeight(family, weight));
    const familyChanged = this.#currentFamily !== family;
    const weightChanged = this.#currentWeight !== snappedWeight;
    const styleChanged = this.#globalItalic !== style;
    const customFontChanged = this.#prevCustomFont !== customFont;
    const weightSpecificChanged = this.#prevWeightSpecificHash !== weightSpecificHash;

    this.#currentFamily = family;
    this.#currentWeight = snappedWeight;
    this.#globalWeight = snappedWeight;
    this.#globalItalic = style;

    if (customFontChanged || familyChanged || weightChanged || weightSpecificChanged) {
      this._loadFonts();
    } else {
      this._shapeAndLayout();
    }
  }

  _shapeAndLayout() {
    this.#fontSize = this._fontSizePx();
    this.#lineHeightPx = this.#fontSize * this.#lineHeightMultiplier;
    const family = this.#currentFamily;
    const text = this.#model.text;

    // Build style runs from model runs + global defaults
    const runs = [];
    let currentRun = null;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const style = this.#model.getStyleAt(i);
      const weight = String(style.weight || this.#globalWeight);
      const italic = style.italic ? 'italic' : (this.#globalItalic || 'normal');
      const spacing = (style.spacing || 0) + this.#globalLetterSpacing;

      if (!currentRun || currentRun.weight !== weight || currentRun.style !== italic) {
        currentRun = { start: i, weight, style: italic, text: '', spacing };
        runs.push(currentRun);
      }
      currentRun.text += char;
      currentRun.end = i + 1;
    }

    // Shape each run
    this.#glyphs = [];
    for (const run of runs) {
      const font = getFont(family, run.weight, run.style)
        || getFont(family, run.weight, 'normal')
        || getFont(family, this.#globalWeight, run.style)
        || getFont(family, this.#globalWeight, 'normal');
      if (!font) continue;

      const runGlyphs = shapeText(run.text, font, this.#fontSize, this.#useLigatures);

      for (const g of runGlyphs) {
        g.charIndex += run.start;
        g.fontFamily = family;
        g.fontWeight = run.weight;
        g.fontStyle = run.style;
      }

      if (this.#useKerning) {
        applyKerning(runGlyphs, font, this.#fontSize);
      }

      // Apply per-run spacing offset
      for (const g of runGlyphs) {
        g.spacingOffset = run.spacing || 0;
      }

      this.#glyphs.push(...runGlyphs);
    }

    const style = getComputedStyle(this);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const maxWidth = Math.max((this.clientWidth || 800) - paddingLeft - paddingRight, 1);
    const hyphenMap = this.#useHyphenation ? buildHyphenMap(text) : null;

    this.#totalHeight = layoutGlyphs(this.#glyphs, maxWidth, this.#lineHeightPx, {
      textAlign: this.#textAlign,
      hyphenMap,
      text,
      fontSize: this.#fontSize,
    });

    this._render();
    this.event('typeset-layout');
  }

  _render() {
    if (!this.#renderer) return;

    const sel = this.#model.selection;
    const hasFocus = document.activeElement === this.#input?.textarea;

    this.#renderer.render({
      glyphs: this.#glyphs,
      selection: { start: this.#model.selStart, end: this.#model.selEnd },
      cursor: this.#model.cursor,
      fontSize: this.#fontSize,
      lineHeightPx: this.#lineHeightPx,
      color: this.getAttribute('color') || DEFAULTS['color'],
      hasFocus,
      totalHeight: this.#totalHeight,
      paddingLeft: parseFloat(getComputedStyle(this).paddingLeft) || 0,
    });
  }

  _onModelChange() {
    this._shapeAndLayout();
    this.event('typeset-change', { text: this.#model.text });
  }

  _onSelectionChange() {
    this.#renderer?.resetBlink();
    this._syncTextarea();
    this._render();
  }

  _onInputChange(reason) {
    if (reason === 'text') {
      this._shapeAndLayout();
      this.event('typeset-change', { text: this.#model.text });
    }
    this._syncTextarea();
  }

  _syncTextarea() {
    this.#input?.syncTextarea();
  }

  /* ── Style API (public, used by TextEngine / UI) ── */

  setSpacing(value) {
    const num = parseFloat(value);
    if (this.#model.hasSelection) {
      this.#model.setRunStyle(this.#model.selStart, this.#model.selEnd, 'spacing', num);
    } else {
      this.#globalLetterSpacing = num;
      this.setAttribute('letter-spacing', String(num));
    }
    this._shapeAndLayout();
  }

  clearSpacing() {
    if (this.#model.hasSelection) {
      this.#model.clearRunStyle(this.#model.selStart, this.#model.selEnd, 'spacing');
    } else {
      this.#globalLetterSpacing = 0;
      this.setAttribute('letter-spacing', '0');
      // Clear all spacing runs
      const runs = this.#model.runs;
      for (const run of runs) {
        if (run.spacing) {
          this.#model.setRunStyle(run.start, run.end, 'spacing', 0);
        }
      }
    }
    this._shapeAndLayout();
  }

  toggleItalic() {
    if (!this.#model.hasSelection) return;
    const [start, end] = [this.#model.selStart, this.#model.selEnd];
    // Check if all selected chars are italic
    let allItalic = true;
    for (let i = start; i < end; i++) {
      const style = this.#model.getStyleAt(i);
      if (!style.italic) {
        allItalic = false;
        break;
      }
    }
    this.#model.setRunStyle(start, end, 'italic', !allItalic);
    this._shapeAndLayout();
  }

  async _loadFontForWeight(weight) {
    const customFontUrl = this.getAttribute('font');
    const weightSpecific = this.getAttribute(`font-${weight}`);
    const italicSpecific = this.getAttribute(`font-${weight}-italic`);

    if (weightSpecific) {
      await loadFont(this.#currentFamily, String(weight), 'normal', weightSpecific, true);
    } else if (customFontUrl) {
      await loadCustomFont(this.#currentFamily, customFontUrl);
    } else {
      const base = this._getFontBase();
      const normalUrl = getFontUrl(this.#currentFamily, weight, 'normal', base);
      if (normalUrl) await loadFont(this.#currentFamily, weight, 'normal', normalUrl);
    }

    if (italicSpecific) {
      await loadFont(this.#currentFamily, String(weight), 'italic', italicSpecific, true);
    } else if (!customFontUrl && !weightSpecific) {
      const base = this._getFontBase();
      const italicUrl = getFontUrl(this.#currentFamily, weight, 'italic', base);
      if (italicUrl) await loadFont(this.#currentFamily, weight, 'italic', italicUrl);
    }
  }

  async setWeight(value) {
    const weight = snapWeight(this.#currentFamily, value);
    if (this.#model.hasSelection) {
      await this._loadFontForWeight(weight);
      this.#model.setRunStyle(this.#model.selStart, this.#model.selEnd, 'weight', weight);
      this._shapeAndLayout();
    } else {
      this.#globalWeight = String(weight);
      this.setAttribute('font-weight', String(weight));
    }
  }

  clearWeight() {
    if (this.#model.hasSelection) {
      this.#model.clearRunStyle(this.#model.selStart, this.#model.selEnd, 'weight');
      this._shapeAndLayout();
    } else {
      this.#globalWeight = DEFAULTS['font-weight'];
      this.setAttribute('font-weight', DEFAULTS['font-weight']);
    }
  }

  setLigatures(enabled) {
    this.#useLigatures = enabled;
    this._shapeAndLayout();
  }

  setKerning(enabled) {
    this.#useKerning = enabled;
    this._shapeAndLayout();
  }

  setHyphenation(enabled) {
    this.#useHyphenation = enabled;
    this._shapeAndLayout();
  }

  /* ── Export ── */

  async exportSVG() {
    const fontSize = this._fontSizePx();
    const color = this.getAttribute('color') || DEFAULTS['color'];
    const width = this.clientWidth || 800;
    const height = this.#totalHeight + 20;
    return exportGlyphSVG(this.#glyphs, fontSize, color, width, height);
  }
}

// Expose font data for UI
window.TYPESET_FONTS = { FONT_WEIGHTS, hasItalic, snapWeight };

if (!customElements.get('type-set')) {
  customElements.define('type-set', TypeSet);
}

export default TypeSet;
