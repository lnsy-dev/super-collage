/**
 * CanvasRenderer
 *
 * Owns the <canvas> element and all drawing for the type-set component.
 */

import { drawGlyphs, drawCursor, drawSelection } from './render-glyphs.js';

export class CanvasRenderer {
  #canvas = null;
  #ctx = null;
  #dpr = 1;
  #blinkOn = true;
  #blinkInterval = null;
  #container = null;

  constructor(container) {
    this.#container = container;
    this.#canvas = document.createElement('canvas');
    this.#canvas.style.display = 'block';
    this.#canvas.style.width = '100%';
    this.#canvas.style.cursor = 'text';
    container.appendChild(this.#canvas);
    this.#ctx = this.#canvas.getContext('2d');
  }

  get canvas() {
    return this.#canvas;
  }

  get ctx() {
    return this.#ctx;
  }

  destroy() {
    this.stopBlink();
    if (this.#canvas && this.#canvas.parentNode) {
      this.#canvas.parentNode.removeChild(this.#canvas);
    }
    this.#canvas = null;
    this.#ctx = null;
  }

  /* ── Sizing ── */

  resize(cssWidth, cssHeight) {
    this.#dpr = window.devicePixelRatio || 1;
    const w = Math.floor(cssWidth * this.#dpr);
    const h = Math.floor(cssHeight * this.#dpr);
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
    }
    this.#canvas.style.height = cssHeight + 'px';
  }

  /* ── Rendering ── */

  render({ glyphs, selection, cursor, fontSize, lineHeightPx, color, hasFocus, totalHeight, paddingLeft = 0 }) {
    const cssWidth = Math.max(1, Math.floor((this.#container.clientWidth || 800) - paddingLeft * 2));
    const cssHeight = totalHeight + 20;

    this.resize(cssWidth, cssHeight);

    const ctx = this.#ctx;
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (!glyphs || glyphs.length === 0) return;

    drawSelection(ctx, glyphs, selection.start, selection.end, {
      fontSize,
      lineHeightPx,
      scale: 1,
    });

    drawGlyphs(ctx, glyphs, { fontSize, color, scale: 1 });

    if (hasFocus && this.#blinkOn) {
      drawCursor(ctx, glyphs, cursor, {
        fontSize,
        lineHeightPx,
        color,
        scale: 1,
      });
    }
  }

  /* ── Blink ── */

  startBlink() {
    this.stopBlink();
    this.#blinkOn = true;
    this.#blinkInterval = setInterval(() => {
      this.#blinkOn = !this.#blinkOn;
      // Notify owner to re-render
      if (this.onBlink) this.onBlink();
    }, 530);
  }

  stopBlink() {
    if (this.#blinkInterval) {
      clearInterval(this.#blinkInterval);
      this.#blinkInterval = null;
    }
  }

  resetBlink() {
    this.#blinkOn = true;
    if (this.onBlink) this.onBlink();
  }
}
