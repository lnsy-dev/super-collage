/**
 * TypeSetRenderer
 *
 * Headless, DOM-free typography renderer. Can rasterize text to any canvas
 * or produce SVG/PNG output. Used by the <type-set> element and by consumers
 * such as super-collage that need a layer/image pipeline.
 */

import {
  loadFont,
  loadCustomFont,
  getFont,
  shapeText,
  applyKerning,
  layoutGlyphs,
  exportGlyphSVG,
  setFontBase,
  getFontBase,
} from './type-engine.js';
import { buildHyphenMap } from './hyphenate.js';
import { FONT_FILES, FONT_WEIGHTS, hasItalic, snapWeight, getFontUrl } from './font-data.js';

const DEFAULTS = {
  fontFamily: 'IBM Plex Serif',
  fontSize: 48,
  fontWeight: 400,
  fontStyle: 'normal',
  letterSpacing: 0,
  lineHeight: 1.2,
  color: '#000000',
  textAlign: 'left',
};

export class TypeSetRenderer {
  constructor(options = {}) {
    this._fontBase = options.fontBase ?? getFontBase() ?? '';
    if (this._fontBase) setFontBase(this._fontBase);

    this.fontFamily = options.fontFamily ?? DEFAULTS.fontFamily;
    this.fontSize = parseFloat(options.fontSize ?? DEFAULTS.fontSize);
    this.fontWeight = String(options.fontWeight ?? DEFAULTS.fontWeight);
    this.fontStyle = options.fontStyle ?? DEFAULTS.fontStyle;
    this.letterSpacing = parseFloat(options.letterSpacing ?? DEFAULTS.letterSpacing);
    this.lineHeight = parseFloat(options.lineHeight ?? DEFAULTS.lineHeight);
    this.color = options.color ?? DEFAULTS.color;
    this.textAlign = options.textAlign ?? DEFAULTS.textAlign;
    this.text = options.text ?? '';

    this.useLigatures = options.useLigatures !== false;
    this.useKerning = options.useKerning !== false;
    this.useHyphenation = options.useHyphenation !== false;

    // Per-character styling. Arrays/maps should be supplied by the caller.
    this.perCharSpacing = options.perCharSpacing ?? new Float64Array(this.text.length);
    this.perCharWeight = options.perCharWeight ?? new Float64Array(this.text.length);
    this.perCharItalic = options.perCharItalic ?? new Set();

    this.customFontUrl = options.customFontUrl ?? null;
    this.weightSpecificFonts = options.weightSpecificFonts ?? {};
  }

  /**
   * Configure the base URL used to resolve relative built-in font paths.
   */
  setFontBase(base) {
    this._fontBase = base;
    setFontBase(base);
  }

  get fontBase() {
    return this._fontBase;
  }

  set fontBase(base) {
    this._fontBase = base;
    setFontBase(base);
  }

  /**
   * Load all fonts required by the current text and style configuration.
   */
  async loadFonts() {
    const family = this.fontFamily;
    const base = this.fontBase;
    const weights = new Set([this.fontWeight]);
    for (let i = 0; i < this.text.length; i++) {
      const w = this.perCharWeight[i];
      if (w) weights.add(String(w));
    }

    const hasWeightSpecific = [...weights].some(w =>
      this.weightSpecificFonts[w]?.normal || this.weightSpecificFonts[w]?.italic
    );

    if (this.customFontUrl && !hasWeightSpecific) {
      await loadCustomFont(family, this.customFontUrl);
      return;
    }

    if (this.customFontUrl) {
      await loadCustomFont(family, this.customFontUrl);
    }

    for (const weight of weights) {
      const customNormal = this.weightSpecificFonts[weight]?.normal;
      const customItalic = this.weightSpecificFonts[weight]?.italic;

      if (customNormal) {
        await loadFont(family, weight, 'normal', customNormal, true);
      } else if (!this.customFontUrl) {
        const normalUrl = getFontUrl(family, weight, 'normal');
        if (normalUrl) await loadFont(family, weight, 'normal', normalUrl);
      }

      if (customItalic) {
        await loadFont(family, weight, 'italic', customItalic, true);
      } else if (!this.customFontUrl) {
        const italicUrl = getFontUrl(family, weight, 'italic');
        if (italicUrl) await loadFont(family, weight, 'italic', italicUrl);
      }
    }
  }

  /**
   * Build glyph runs, apply kerning/spacing, and run line layout.
   * Returns { glyphs, totalHeight }.
   */
  async shapeAndLayout(maxWidth) {
    const fontSize = this.fontSize;
    const lineHeightPx = fontSize * this.lineHeight;
    const family = this.fontFamily;
    const globalWeight = String(snapWeight(family, this.fontWeight));

    // Build style runs based on per-character weight + italic
    const runs = [];
    let currentRun = null;

    for (let i = 0; i < this.text.length; i++) {
      const char = this.text[i];
      const weight = String(this.perCharWeight[i] || globalWeight);
      const style = this.perCharItalic.has(i) ? 'italic' : 'normal';

      if (!currentRun || currentRun.weight !== weight || currentRun.style !== style) {
        currentRun = { start: i, weight, style, text: '' };
        runs.push(currentRun);
      }
      currentRun.text += char;
      currentRun.end = i + 1;
    }

    // Shape each run with its corresponding font
    const glyphs = [];
    for (const run of runs) {
      const font = getFont(family, run.weight, run.style)
        || getFont(family, run.weight, 'normal')
        || getFont(family, globalWeight, run.style)
        || getFont(family, globalWeight, 'normal');
      if (!font) continue;

      const runGlyphs = shapeText(run.text, font, fontSize, this.useLigatures);

      for (const g of runGlyphs) {
        g.charIndex += run.start;
        g.fontFamily = family;
        g.fontWeight = run.weight;
        g.fontStyle = run.style;
      }

      if (this.useKerning) {
        applyKerning(runGlyphs, font, fontSize);
      }

      glyphs.push(...runGlyphs);
    }

    // Apply spacing: global + per-char
    for (const g of glyphs) {
      const extra = this.perCharSpacing[g.charIndex] || 0;
      g.spacingOffset = this.letterSpacing + extra;
    }

    const hyphenMap = this.useHyphenation ? await buildHyphenMap(this.text) : null;
    const totalHeight = layoutGlyphs(glyphs, maxWidth, lineHeightPx, {
      textAlign: this.textAlign,
      hyphenMap,
      text: this.text,
      fontSize,
    });

    return { glyphs, totalHeight };
  }

  /**
   * Render the configured text into the supplied canvas.
   * The canvas is sized to the supplied width and computed height.
   *
   * @param {HTMLCanvasElement|OffscreenCanvas} canvas
   * @param {object} options
   * @param {number} options.width - CSS pixel width for layout
   * @param {number} [options.height] - optional fixed height; computed if omitted
   * @param {boolean} [options.clear=true] - clear canvas before drawing
   * @param {number} [options.padding=0] - padding inside the layout area
   * @param {number} [options.dpr] - device pixel ratio; defaults to window.devicePixelRatio in browsers
   * @returns {Promise<{canvas: HTMLCanvasElement|OffscreenCanvas, glyphs: object[], totalHeight: number}>}
   */
  async renderToCanvas(canvas, options = {}) {
    const width = (options.width ?? canvas.width) || 800;
    const padding = options.padding ?? 0;
    const maxWidth = Math.max(1, width - padding * 2);

    await this.loadFonts();
    const { glyphs, totalHeight } = await this.shapeAndLayout(maxWidth);

    const height = options.height ?? Math.ceil(totalHeight + 20);
    const dpr = options.dpr ?? (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    if (canvas.style) {
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (options.clear !== false) {
      ctx.clearRect(0, 0, width, height);
    }

    if (glyphs.length === 0) {
      return { canvas, glyphs, totalHeight };
    }

    ctx.fillStyle = this.color;
    ctx.textBaseline = 'alphabetic';

    let currentFont = null;
    for (const g of glyphs) {
      if (g.char === '\n') continue;
      const fontStr = `${g.fontStyle} ${g.fontWeight} ${this.fontSize}px "${g.fontFamily}"`;
      if (fontStr !== currentFont) {
        ctx.font = fontStr;
        currentFont = fontStr;
      }
      ctx.fillText(g.char, g.x + padding, g.y + padding);
    }

    return { canvas, glyphs, totalHeight };
  }

  /**
   * Produce an SVG string of the configured text.
   *
   * @param {object} options
   * @param {number} options.width
   * @param {number} [options.height]
   * @param {number} [options.padding=0]
   * @returns {Promise<string>}
   */
  async renderToSVG(options = {}) {
    const width = options.width ?? 800;
    const padding = options.padding ?? 0;
    const maxWidth = Math.max(1, width - padding * 2);

    await this.loadFonts();
    const { glyphs, totalHeight } = await this.shapeAndLayout(maxWidth);
    const height = options.height ?? Math.ceil(totalHeight + 20);

    // Offset glyphs by padding for SVG output
    if (padding !== 0) {
      for (const g of glyphs) {
        g.x += padding;
        g.y += padding;
      }
    }

    return exportGlyphSVG(glyphs, this.fontSize, this.color, width, height);
  }

  /**
   * Produce a PNG Blob of the configured text.
   *
   * @param {object} options
   * @param {number} options.width
   * @param {number} [options.dpi=96]
   * @param {string} [options.backgroundColor='transparent']
   * @returns {Promise<Blob>}
   */
  async renderToPNG(options = {}) {
    const width = options.width ?? 800;
    const dpi = options.dpi ?? 96;
    const scale = dpi / 96;

    const tmp = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas');

    await this.renderToCanvas(tmp, { width, clear: true });

    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const cssWidth = tmp.width / dpr;
    const cssHeight = tmp.height / dpr;

    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(Math.ceil(cssWidth * scale), Math.ceil(cssHeight * scale))
      : document.createElement('canvas');
    canvas.width = Math.ceil(cssWidth * scale);
    canvas.height = Math.ceil(cssHeight * scale);

    const ctx = canvas.getContext('2d');

    if (options.backgroundColor) {
      ctx.fillStyle = options.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  _toOptions() {
    return {
      fontBase: this.fontBase,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      fontWeight: this.fontWeight,
      fontStyle: this.fontStyle,
      letterSpacing: this.letterSpacing,
      lineHeight: this.lineHeight,
      color: this.color,
      textAlign: this.textAlign,
      text: this.text,
      useLigatures: this.useLigatures,
      useKerning: this.useKerning,
      useHyphenation: this.useHyphenation,
      customFontUrl: this.customFontUrl,
      weightSpecificFonts: this.weightSpecificFonts,
    };
  }
}

// Convenience standalone function for the simplest case.
export async function renderTextToCanvas(canvas, options) {
  const renderer = new TypeSetRenderer(options);
  return renderer.renderToCanvas(canvas, options);
}

export async function renderTextToSVG(options) {
  const renderer = new TypeSetRenderer(options);
  return renderer.renderToSVG(options);
}

export async function renderTextToPNG(options) {
  const renderer = new TypeSetRenderer(options);
  return renderer.renderToPNG(options);
}

export { FONT_FILES, FONT_WEIGHTS, hasItalic, snapWeight, getFontUrl };
