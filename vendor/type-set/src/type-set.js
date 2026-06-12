/**
 * TypeSet Custom HTML Element
 *
 * Canvas-based typography editor with per-glyph control via opentype.js.
 * Built on top of the headless TypeSetRenderer so the same engine can be
 * reused by consumers such as super-collage.
 */

import { TypeSetRenderer } from './type-renderer.js';
import { getFont, loadFont, loadCustomFont } from './type-engine.js';
import {
  FONT_WEIGHTS,
  hasItalic,
  snapWeight,
  getFontUrl,
} from './font-data.js';

const DEFAULTS = {
  'font-family': 'IBM Plex Serif',
  'font-size': '48',
  'font-weight': '400',
  'font-style': 'normal',
  'letter-spacing': '0',
  'line-height': '1.2',
  'color': '#0a5c0a',
  'text-align': 'left',
};

function _getWeightSpecificFontsHash(element) {
  const parts = [];
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  for (const w of weights) {
    const normal = element.getAttribute(`font-${w}`);
    const italic = element.getAttribute(`font-${w}-italic`);
    if (normal) parts.push(`${w}:n:${normal}`);
    if (italic) parts.push(`${w}:i:${italic}`);
  }
  return parts.join('|');
}

function _buildWeightSpecificFontsMap(element) {
  const map = {};
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  for (const w of weights) {
    const normal = element.getAttribute(`font-${w}`);
    const italic = element.getAttribute(`font-${w}-italic`);
    if (normal || italic) {
      map[w] = {};
      if (normal) map[w].normal = normal;
      if (italic) map[w].italic = italic;
    }
  }
  return map;
}

export class TypeSetElement extends HTMLElement {
  static get observedAttributes() {
    return [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'letter-spacing',
      'line-height',
      'color',
      'text-align',
      'font-base',
      'font',
      ...[100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap(w => [`font-${w}`, `font-${w}-italic`]),
    ];
  }

  constructor() {
    super();
    this.renderer = new TypeSetRenderer();
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;

    this.innerHTML = '';

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.cursor = 'text';
    this.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.textarea = document.createElement('textarea');
    this.textarea.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;left:-9999px;';
    this.appendChild(this.textarea);

    this._text = 'The quick brown fox jumps over the lazy dog.';
    this.textarea.value = this._text;
    this.cursorIndex = this._text.length;
    this.selectionStart = this.cursorIndex;
    this.selectionEnd = this.cursorIndex;
    this.glyphs = [];
    this.totalHeight = 0;

    this.currentFamily = DEFAULTS['font-family'];
    this.currentWeight = DEFAULTS['font-weight'];
    this.globalWeight = DEFAULTS['font-weight'];
    this.globalLetterSpacing = parseFloat(DEFAULTS['letter-spacing']);
    this.perCharSpacing = new Float64Array(this._text.length);
    this.perCharWeight = new Float64Array(this._text.length);
    this.perCharItalic = new Set();
    this.useLigatures = true;
    this.useKerning = true;
    this.lineHeightMultiplier = parseFloat(DEFAULTS['line-height']);
    this.textAlign = DEFAULTS['text-align'];
    this.useHyphenation = true;
    this._prevCustomFont = null;
    this._prevWeightSpecificHash = '';

    this.blinkOn = true;
    this.blinkInterval = null;
    this.isDragging = false;
    this._mouseDownCount = 0;
    this._lastMouseDownTime = 0;

    this.canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this._onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this._onMouseUp.bind(this));
    this.canvas.addEventListener('dblclick', this._onDoubleClick.bind(this));
    this.canvas.addEventListener('click', () => this.textarea.focus());

    this.textarea.addEventListener('input', this._onTextInput.bind(this));
    this.textarea.addEventListener('keydown', this._onKeyDown.bind(this));
    this.textarea.addEventListener('focus', () => this.classList.add('has-focus'));
    this.textarea.addEventListener('blur', () => this.classList.remove('has-focus'));

    this._resizeObserver = new ResizeObserver(() => {
      if (this._resizeTimeout) clearTimeout(this._resizeTimeout);
      this._resizeTimeout = setTimeout(() => this._shapeAndLayout(), 50);
    });
    this._resizeObserver.observe(this);

    this._syncRendererFromAttributes();
    this._loadFonts().then(() => this._startBlink());
  }

  disconnectedCallback() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this.blinkInterval) clearInterval(this.blinkInterval);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this._initialized) return;
    if (oldValue === newValue) return;
    this._onAttrChange();
  }

  _getFontBase() {
    return this.getAttribute('font-base') || '';
  }

  _syncRendererFromAttributes() {
    const family = this.getAttribute('font-family') || DEFAULTS['font-family'];
    const weight = snapWeight(family, this.getAttribute('font-weight') || DEFAULTS['font-weight']);

    this.renderer.setFontBase(this._getFontBase());
    this.renderer.fontFamily = family;
    this.renderer.fontSize = parseFloat(this.getAttribute('font-size') || DEFAULTS['font-size']);
    this.renderer.fontWeight = String(weight);
    this.renderer.fontStyle = this.getAttribute('font-style') || DEFAULTS['font-style'];
    this.renderer.letterSpacing = parseFloat(this.getAttribute('letter-spacing') || DEFAULTS['letter-spacing']);
    this.renderer.lineHeight = parseFloat(this.getAttribute('line-height') || DEFAULTS['line-height']);
    this.renderer.color = this.getAttribute('color') || DEFAULTS['color'];
    this.renderer.textAlign = this.getAttribute('text-align') || DEFAULTS['text-align'];
    this.renderer.text = this._text;
    this.renderer.perCharSpacing = this.perCharSpacing;
    this.renderer.perCharWeight = this.perCharWeight;
    this.renderer.perCharItalic = this.perCharItalic;
    this.renderer.useLigatures = this.useLigatures;
    this.renderer.useKerning = this.useKerning;
    this.renderer.useHyphenation = this.useHyphenation;
    this.renderer.customFontUrl = this.getAttribute('font');
    this.renderer.weightSpecificFonts = _buildWeightSpecificFontsMap(this);

    this.currentFamily = family;
    this.currentWeight = String(weight);
    this.globalWeight = String(weight);
    this.globalLetterSpacing = this.renderer.letterSpacing;
    this.lineHeightMultiplier = this.renderer.lineHeight;
    this.textAlign = this.renderer.textAlign;
  }

  async _loadFonts() {
    await this.renderer.loadFonts();
    this._shapeAndLayout();
  }

  get text() {
    return this._text;
  }

  set text(value) {
    this._text = value;
    this.textarea.value = value;
    const newArr = new Float64Array(value.length);
    newArr.set(this.perCharSpacing.subarray(0, Math.min(this.perCharSpacing.length, value.length)));
    this.perCharSpacing = newArr;
    const newWeight = new Float64Array(value.length);
    newWeight.set(this.perCharWeight.subarray(0, Math.min(this.perCharWeight.length, value.length)));
    this.perCharWeight = newWeight;
    this.perCharItalic = new Set();
    this.renderer.text = value;
    this.renderer.perCharSpacing = this.perCharSpacing;
    this.renderer.perCharWeight = this.perCharWeight;
    this.renderer.perCharItalic = this.perCharItalic;
    this._shapeAndLayout();
    this.event('typeset-change', { text: value });
  }

  _onAttrChange() {
    const family = this.getAttribute('font-family') || DEFAULTS['font-family'];
    const weight = this.getAttribute('font-weight') || DEFAULTS['font-weight'];
    const spacing = parseFloat(this.getAttribute('letter-spacing') || DEFAULTS['letter-spacing']);
    const lineHeight = parseFloat(this.getAttribute('line-height') || DEFAULTS['line-height']);
    const textAlign = this.getAttribute('text-align') || DEFAULTS['text-align'];
    const customFont = this.getAttribute('font');
    const weightSpecificHash = _getWeightSpecificFontsHash(this);

    this.globalLetterSpacing = spacing;
    this.lineHeightMultiplier = lineHeight;
    this.textAlign = textAlign;

    const snappedWeight = String(snapWeight(family, weight));
    const familyChanged = this.currentFamily !== family;
    const weightChanged = this.currentWeight !== snappedWeight;
    const customFontChanged = this._prevCustomFont !== customFont;
    const weightSpecificChanged = this._prevWeightSpecificHash !== weightSpecificHash;

    this.currentFamily = family;
    this.currentWeight = snappedWeight;
    this.globalWeight = snappedWeight;

    this._syncRendererFromAttributes();

    if (customFontChanged || familyChanged || weightChanged || weightSpecificChanged) {
      this._prevCustomFont = customFont;
      this._prevWeightSpecificHash = weightSpecificHash;
      this._loadFonts();
    } else {
      this._shapeAndLayout();
    }
  }

  async _shapeAndLayout() {
    this._syncRendererFromAttributes();

    const style = getComputedStyle(this);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const maxWidth = Math.max((this.clientWidth || 800) - paddingLeft - paddingRight, 1);

    const { glyphs, totalHeight } = await this.renderer.shapeAndLayout(maxWidth);
    this.glyphs = glyphs;
    this.totalHeight = totalHeight;
    this._render();
  }

  _render() {
    if (!this.canvas) return;

    this.classList.toggle('has-selection', this.hasSelection);

    const dpr = window.devicePixelRatio || 1;
    const style = getComputedStyle(this);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const cssWidth = Math.max((this.clientWidth || 800) - paddingLeft - paddingRight, 1);
    const cssHeight = this.totalHeight + 20;

    if (this.canvas.width !== Math.floor(cssWidth * dpr) || this.canvas.height !== Math.floor(cssHeight * dpr)) {
      this.canvas.width = Math.floor(cssWidth * dpr);
      this.canvas.height = Math.floor(cssHeight * dpr);
    }
    this.canvas.style.height = cssHeight + 'px';

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (this.glyphs.length === 0) return;

    const fontSize = parseFloat(this.getAttribute('font-size') || DEFAULTS['font-size']);
    const color = this.getAttribute('color') || DEFAULTS['color'];

    this._drawSelection(ctx);

    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';

    let currentFont = null;
    for (const g of this.glyphs) {
      if (g.char === '\n') continue;
      const fontStr = `${g.fontStyle} ${g.fontWeight} ${fontSize}px "${g.fontFamily}"`;
      if (fontStr !== currentFont) {
        ctx.font = fontStr;
        currentFont = fontStr;
      }
      ctx.fillText(g.char, g.x, g.y);
    }

    if (this.blinkOn && document.activeElement === this.textarea) {
      this._drawCursor(ctx);
    }
  }

  _drawSelection(ctx) {
    if (this.selectionStart === this.selectionEnd) return;
    const selStart = Math.min(this.selectionStart, this.selectionEnd);
    const selEnd = Math.max(this.selectionStart, this.selectionEnd);
    const fontSize = parseFloat(this.getAttribute('font-size') || DEFAULTS['font-size']);
    const lineHeightPx = fontSize * this.lineHeightMultiplier;

    ctx.fillStyle = 'rgba(10, 92, 10, 0.2)';

    for (const g of this.glyphs) {
      const gCharStart = g.charIndex;
      const gCharEnd = g.charIndex + (g.charCount || 1);
      if (gCharEnd <= selStart || gCharStart >= selEnd) continue;

      ctx.fillRect(g.x, g.y - fontSize, g.advanceWidth + g.spacingOffset, lineHeightPx);
    }
  }

  _drawCursor(ctx) {
    const idx = this.cursorIndex;
    const fontSize = parseFloat(this.getAttribute('font-size') || DEFAULTS['font-size']);
    const lineHeightPx = fontSize * this.lineHeightMultiplier;

    let x = 0;
    let y = fontSize;

    if (this.glyphs.length > 0) {
      if (idx >= this._text.length) {
        const last = this.glyphs[this.glyphs.length - 1];
        x = last.x + last.advanceWidth + last.spacingOffset;
        y = last.y;
      } else {
        for (const g of this.glyphs) {
          const gStart = g.charIndex;
          const gEnd = g.charIndex + (g.charCount || 1);
          if (idx >= gStart && idx < gEnd) {
            const ratio = (idx - gStart) / (g.charCount || 1);
            x = g.x + (g.advanceWidth + g.spacingOffset) * ratio;
            y = g.y;
            break;
          }
        }
      }
    }

    ctx.strokeStyle = this.getAttribute('color') || DEFAULTS['color'];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - fontSize);
    ctx.lineTo(x, y + (lineHeightPx - fontSize));
    ctx.stroke();
  }

  _startBlink() {
    if (this.blinkInterval) clearInterval(this.blinkInterval);
    this.blinkInterval = setInterval(() => {
      this.blinkOn = !this.blinkOn;
      this._render();
    }, 530);
  }

  _getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onMouseDown(e) {
    const now = Date.now();
    if (now - this._lastMouseDownTime < 400) {
      this._mouseDownCount++;
    } else {
      this._mouseDownCount = 1;
    }
    this._lastMouseDownTime = now;

    if (this._mouseDownCount === 3) {
      this._mouseDownCount = 0;
      this._selectAllText();
      return;
    }

    if (this._mouseDownCount === 2) {
      return;
    }

    this.isDragging = true;
    const { x, y } = this._getCanvasCoords(e);
    const fontSize = parseFloat(this.getAttribute('font-size') || DEFAULTS['font-size']);
    const lineHeightPx = fontSize * this.lineHeightMultiplier;

    this.cursorIndex = this._hitTest(x, y, lineHeightPx);
    this.selectionStart = this.cursorIndex;
    this.selectionEnd = this.cursorIndex;
    this.blinkOn = true;
    this._render();
    this.textarea.focus();
  }

  _onMouseMove(e) {
    if (!this.isDragging) return;
    const { x, y } = this._getCanvasCoords(e);
    const fontSize = parseFloat(this.getAttribute('font-size') || DEFAULTS['font-size']);
    const lineHeightPx = fontSize * this.lineHeightMultiplier;

    this.selectionEnd = this._hitTest(x, y, lineHeightPx);
    this.cursorIndex = this.selectionEnd;
    this._render();
  }

  _onMouseUp() {
    this.isDragging = false;
  }

  _onDoubleClick(e) {
    const { x, y } = this._getCanvasCoords(e);
    const fontSize = parseFloat(this.getAttribute('font-size') || DEFAULTS['font-size']);
    const lineHeightPx = fontSize * this.lineHeightMultiplier;
    const idx = this._hitTest(x, y, lineHeightPx);

    const text = this._text;
    let wordStart = idx;
    let wordEnd = idx;

    while (wordStart > 0 && !/\s/.test(text[wordStart - 1])) {
      wordStart--;
    }
    while (wordEnd < text.length && !/\s/.test(text[wordEnd])) {
      wordEnd++;
    }

    this.textarea.selectionStart = wordStart;
    this.textarea.selectionEnd = wordEnd;
    this.selectionStart = wordStart;
    this.selectionEnd = wordEnd;
    this.cursorIndex = wordEnd;
    this.blinkOn = false;
    this.textarea.focus();
    this._render();
  }

  _selectAllText() {
    this.textarea.selectionStart = 0;
    this.textarea.selectionEnd = this._text.length;
    this.selectionStart = 0;
    this.selectionEnd = this._text.length;
    this.cursorIndex = this._text.length;
    this.blinkOn = false;
    this.textarea.focus();
    this._render();
  }

  _onTextInput() {
    const oldText = this._text;
    const newText = this.textarea.value;

    if (newText !== oldText) {
      let start = 0;
      while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
        start++;
      }

      let oldEnd = oldText.length;
      let newEnd = newText.length;
      while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }

      const oldLen = oldEnd - start;
      const newLen = newEnd - start;

      const newSet = new Set();
      for (const idx of this.perCharItalic) {
        if (idx < start) {
          newSet.add(idx);
        } else if (idx >= oldEnd) {
          newSet.add(idx - oldLen + newLen);
        }
      }
      this.perCharItalic = newSet;

      const newSpacing = new Float64Array(newText.length);
      for (let i = 0; i < start; i++) newSpacing[i] = this.perCharSpacing[i] || 0;
      for (let i = oldEnd; i < oldText.length; i++) {
        const newIdx = i - oldLen + newLen;
        if (newIdx >= 0 && newIdx < newText.length) {
          newSpacing[newIdx] = this.perCharSpacing[i] || 0;
        }
      }
      this.perCharSpacing = newSpacing;

      const newWeight = new Float64Array(newText.length);
      for (let i = 0; i < start; i++) newWeight[i] = this.perCharWeight[i] || 0;
      for (let i = oldEnd; i < oldText.length; i++) {
        const newIdx = i - oldLen + newLen;
        if (newIdx >= 0 && newIdx < newText.length) {
          newWeight[newIdx] = this.perCharWeight[i] || 0;
        }
      }
      this.perCharWeight = newWeight;

      this._text = newText;
      this.renderer.text = newText;
      this.renderer.perCharSpacing = this.perCharSpacing;
      this.renderer.perCharWeight = this.perCharWeight;
      this.renderer.perCharItalic = this.perCharItalic;
      this.cursorIndex = this.textarea.selectionStart;
      this.selectionStart = this.cursorIndex;
      this.selectionEnd = this.cursorIndex;
      this._shapeAndLayout();
      this.event('typeset-change', { text: newText });
    }
  }

  _onKeyDown(e) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      this._moveCursor(e.key, e.shiftKey);
      return;
    }
    if (e.key === 'Escape') {
      this.selectionStart = this.cursorIndex;
      this.selectionEnd = this.cursorIndex;
      this._render();
    }
  }

  _moveCursor(key, shift) {
    let newIndex = this.cursorIndex;

    if (key === 'ArrowLeft') {
      newIndex = Math.max(0, this.cursorIndex - 1);
    } else if (key === 'ArrowRight') {
      newIndex = Math.min(this._text.length, this.cursorIndex + 1);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      const g = this.cursorIndex < this._text.length
        ? this.glyphs.find(g => this.cursorIndex >= g.charIndex && this.cursorIndex < g.charIndex + (g.charCount || 1))
        : this.glyphs[this.glyphs.length - 1];
      if (g) {
        newIndex = this._findIndexOnAdjacentLine(g.x, g.y, key === 'ArrowDown');
      }
    }

    this.cursorIndex = newIndex;
    if (shift) {
      this.selectionEnd = newIndex;
    } else {
      this.selectionStart = newIndex;
      this.selectionEnd = newIndex;
    }
    this.blinkOn = true;
    this._render();
  }

  _findIndexOnAdjacentLine(x, y, down) {
    const fontSize = parseFloat(this.getAttribute('font-size') || DEFAULTS['font-size']);
    const lineHeightPx = fontSize * this.lineHeightMultiplier;
    const targetY = down ? y + lineHeightPx : y - lineHeightPx;

    let closest = down ? this._text.length : 0;
    let minDist = Infinity;

    for (const g of this.glyphs) {
      if (Math.abs(g.y - targetY) < lineHeightPx / 2) {
        const dist = Math.abs(g.x - x);
        if (dist < minDist) {
          minDist = dist;
          closest = g.charIndex;
        }
      }
    }

    return closest;
  }

  _hitTest(clickX, clickY, lineHeightPx) {
    if (this.glyphs.length === 0) return 0;

    const firstLineY = this.glyphs[0].y;

    if (clickY < firstLineY - lineHeightPx / 2) {
      return 0;
    }

    const targetLine = Math.max(0, Math.round((clickY - firstLineY) / lineHeightPx));

    const lineGlyphs = this.glyphs.filter(g =>
      Math.abs(g.y - (firstLineY + targetLine * lineHeightPx)) < lineHeightPx / 2
    );

    if (lineGlyphs.length === 0) {
      const last = this.glyphs[this.glyphs.length - 1];
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

  get hasSelection() {
    return this.selectionStart !== this.selectionEnd;
  }

  get selStart() {
    return Math.min(this.selectionStart, this.selectionEnd);
  }

  get selEnd() {
    return Math.max(this.selectionStart, this.selectionEnd);
  }

  setSpacing(value) {
    const num = parseFloat(value);
    if (this.hasSelection) {
      for (let i = this.selStart; i < this.selEnd && i < this._text.length; i++) {
        this.perCharSpacing[i] = num;
      }
    } else {
      this.globalLetterSpacing = num;
      this.setAttribute('letter-spacing', String(num));
      this.perCharSpacing = new Float64Array(this._text.length);
    }
    this.renderer.perCharSpacing = this.perCharSpacing;
    this._shapeAndLayout();
  }

  clearSpacing() {
    if (this.hasSelection) {
      for (let i = this.selStart; i < this.selEnd && i < this._text.length; i++) {
        this.perCharSpacing[i] = 0;
      }
    } else {
      this.globalLetterSpacing = 0;
      this.setAttribute('letter-spacing', '0');
      this.perCharSpacing = new Float64Array(this._text.length);
    }
    this.renderer.perCharSpacing = this.perCharSpacing;
    this._shapeAndLayout();
  }

  toggleItalic() {
    if (!this.hasSelection) return;

    const [start, end] = [this.selStart, this.selEnd];
    let allItalic = true;
    for (let i = start; i < end; i++) {
      if (!this.perCharItalic.has(i)) {
        allItalic = false;
        break;
      }
    }

    if (allItalic) {
      for (let i = start; i < end; i++) this.perCharItalic.delete(i);
    } else {
      for (let i = start; i < end; i++) this.perCharItalic.add(i);
    }

    this.renderer.perCharItalic = this.perCharItalic;
    this._shapeAndLayout();
  }

  async _loadFontForWeight(weight) {
    const customFontUrl = this.getAttribute('font');
    const weightSpecific = this.getAttribute(`font-${weight}`);
    const italicSpecific = this.getAttribute(`font-${weight}-italic`);

    if (weightSpecific) {
      await loadFont(this.currentFamily, String(weight), 'normal', weightSpecific, true);
    } else if (customFontUrl) {
      await loadCustomFont(this.currentFamily, customFontUrl);
    } else {
      const base = this._getFontBase();
      const normalUrl = getFontUrl(this.currentFamily, weight, 'normal', base);
      if (normalUrl) await loadFont(this.currentFamily, weight, 'normal', normalUrl);
    }

    if (italicSpecific) {
      await loadFont(this.currentFamily, String(weight), 'italic', italicSpecific, true);
    } else if (!customFontUrl && !weightSpecific) {
      const base = this._getFontBase();
      const italicUrl = getFontUrl(this.currentFamily, weight, 'italic', base);
      if (italicUrl) await loadFont(this.currentFamily, weight, 'italic', italicUrl);
    }
  }

  async setWeight(value) {
    const weight = snapWeight(this.currentFamily, value);
    if (this.hasSelection) {
      await this._loadFontForWeight(weight);
      for (let i = this.selStart; i < this.selEnd && i < this._text.length; i++) {
        this.perCharWeight[i] = weight;
      }
      this.renderer.perCharWeight = this.perCharWeight;
      this._shapeAndLayout();
    } else {
      this.globalWeight = String(weight);
      this.setAttribute('font-weight', String(weight));
    }
  }

  clearWeight() {
    if (this.hasSelection) {
      for (let i = this.selStart; i < this.selEnd && i < this._text.length; i++) {
        this.perCharWeight[i] = 0;
      }
      this.renderer.perCharWeight = this.perCharWeight;
      this._shapeAndLayout();
    } else {
      this.globalWeight = DEFAULTS['font-weight'];
      this.setAttribute('font-weight', DEFAULTS['font-weight']);
    }
  }

  setLigatures(enabled) {
    this.useLigatures = enabled;
    this.renderer.useLigatures = enabled;
    this._shapeAndLayout();
  }

  setKerning(enabled) {
    this.useKerning = enabled;
    this.renderer.useKerning = enabled;
    this._shapeAndLayout();
  }

  setHyphenation(enabled) {
    this.useHyphenation = enabled;
    this.renderer.useHyphenation = enabled;
    this._shapeAndLayout();
  }

  async exportSVG() {
    this._syncRendererFromAttributes();
    const width = this.clientWidth || 800;
    return this.renderer.renderToSVG({ width });
  }

  async exportPNG(dpi = 600) {
    this._syncRendererFromAttributes();
    const width = this.clientWidth || 800;
    return this.renderer.renderToPNG({ width, dpi });
  }

  async downloadSVG(filename = 'typeset.svg') {
    const svg = await this.exportSVG();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    this._downloadBlob(blob, filename);
  }

  async downloadPNG(filename = 'typeset.png', dpi = 600) {
    const blob = await this.exportPNG(dpi);
    this._downloadBlob(blob, filename);
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  event(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }
}

// Expose font data for UI consumers
export { FONT_WEIGHTS, hasItalic, snapWeight };

if (typeof window !== 'undefined' && !customElements.get('type-set')) {
  customElements.define('type-set', TypeSetElement);
}

export default TypeSetElement;
