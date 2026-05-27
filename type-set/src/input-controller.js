/**
 * InputController
 *
 * Handles all user input events (keyboard, pointer, clipboard, IME)
 * and translates them into TextModel operations.
 */

import { hitTest } from './type-engine.js';

export class InputController {
  #model = null;
  #canvas = null;
  #textarea = null;
  #onModelChange = null;
  #onRenderRequest = null;
  #getLayout = null; // () => { glyphs, fontSize, lineHeightPx }

  #isDragging = false;
  #mouseDownCount = 0;
  #lastMouseDownTime = 0;
  #isComposing = false;

  constructor({ model, canvas, textarea, onModelChange, onRenderRequest, getLayout }) {
    this.#model = model;
    this.#canvas = canvas;
    this.#textarea = textarea;
    this.#onModelChange = onModelChange;
    this.#onRenderRequest = onRenderRequest;
    this.#getLayout = getLayout;

    this._bindEvents();
  }

  destroy() {
    this._unbindEvents();
  }

  get textarea() {
    return this.#textarea;
  }

  /* ── Event Binding ── */

  _bindEvents() {
    this._boundPointerDown = this._onPointerDown.bind(this);
    this._boundPointerMove = this._onPointerMove.bind(this);
    this._boundPointerUp = this._onPointerUp.bind(this);
    this._boundDblClick = this._onDoubleClick.bind(this);
    this._boundClick = this._onClick.bind(this);
    this._boundInput = this._onInput.bind(this);
    this._boundKeyDown = this._onKeyDown.bind(this);
    this._boundCompositionStart = this._onCompositionStart.bind(this);
    this._boundCompositionEnd = this._onCompositionEnd.bind(this);
    this._boundCut = this._onCut.bind(this);
    this._boundCopy = this._onCopy.bind(this);
    this._boundPaste = this._onPaste.bind(this);
    this._boundFocus = this._onFocus.bind(this);
    this._boundBlur = this._onBlur.bind(this);

    this.#canvas.addEventListener('pointerdown', this._boundPointerDown);
    this.#canvas.addEventListener('pointermove', this._boundPointerMove);
    this.#canvas.addEventListener('pointerup', this._boundPointerUp);
    this.#canvas.addEventListener('dblclick', this._boundDblClick);
    this.#canvas.addEventListener('click', this._boundClick);

    this.#textarea.addEventListener('input', this._boundInput);
    this.#textarea.addEventListener('keydown', this._boundKeyDown);
    this.#textarea.addEventListener('compositionstart', this._boundCompositionStart);
    this.#textarea.addEventListener('compositionend', this._boundCompositionEnd);
    this.#textarea.addEventListener('cut', this._boundCut);
    this.#textarea.addEventListener('copy', this._boundCopy);
    this.#textarea.addEventListener('paste', this._boundPaste);
    this.#textarea.addEventListener('focus', this._boundFocus);
    this.#textarea.addEventListener('blur', this._boundBlur);
  }

  _unbindEvents() {
    this.#canvas.removeEventListener('pointerdown', this._boundPointerDown);
    this.#canvas.removeEventListener('pointermove', this._boundPointerMove);
    this.#canvas.removeEventListener('pointerup', this._boundPointerUp);
    this.#canvas.removeEventListener('dblclick', this._boundDblClick);
    this.#canvas.removeEventListener('click', this._boundClick);

    this.#textarea.removeEventListener('input', this._boundInput);
    this.#textarea.removeEventListener('keydown', this._boundKeyDown);
    this.#textarea.removeEventListener('compositionstart', this._boundCompositionStart);
    this.#textarea.removeEventListener('compositionend', this._boundCompositionEnd);
    this.#textarea.removeEventListener('cut', this._boundCut);
    this.#textarea.removeEventListener('copy', this._boundCopy);
    this.#textarea.removeEventListener('paste', this._boundPaste);
    this.#textarea.removeEventListener('focus', this._boundFocus);
    this.#textarea.removeEventListener('blur', this._boundBlur);
  }

  /* ── Focus ── */

  focus() {
    this.#textarea.focus();
  }

  blur() {
    this.#textarea.blur();
  }

  _onFocus() {
    if (this.#onModelChange) this.#onModelChange('focus');
  }

  _onBlur() {
    if (this.#onModelChange) this.#onModelChange('blur');
  }

  /* ── Pointer Events ── */

  _getCanvasCoords(e) {
    const rect = this.#canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _hitTest(x, y) {
    const layout = this.#getLayout();
    if (!layout || !layout.glyphs) return 0;
    return hitTest(layout.glyphs, x, y, layout.lineHeightPx);
  }

  _onPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    this.#canvas.setPointerCapture(e.pointerId);
    this.focus();

    const now = Date.now();
    if (now - this.#lastMouseDownTime < 400) {
      this.#mouseDownCount++;
    } else {
      this.#mouseDownCount = 1;
    }
    this.#lastMouseDownTime = now;

    // Triple-click handled here; dblclick is separate
    if (this.#mouseDownCount === 3) {
      this.#mouseDownCount = 0;
      const { x, y } = this._getCanvasCoords(e);
      const idx = this._hitTest(x, y);
      this.#model.selectLineAt(idx);
      this.#isDragging = false;
      return;
    }

    if (this.#mouseDownCount === 2) {
      // Let the dblclick handler deal with word selection
      this.#isDragging = false;
      return;
    }

    const { x, y } = this._getCanvasCoords(e);
    const idx = this._hitTest(x, y);

    if (e.shiftKey) {
      // Extend selection from anchor to new position
      this.#model.setSelection(this.#model.selection.anchor, idx, 'pointer');
    } else {
      this.#model.setSelection(idx, idx, 'pointer');
    }

    this.#isDragging = true;
    if (this.#onRenderRequest) this.#onRenderRequest();
  }

  _onPointerMove(e) {
    if (!this.#isDragging) return;
    e.preventDefault();
    const { x, y } = this._getCanvasCoords(e);
    const idx = this._hitTest(x, y);
    this.#model.setSelection(this.#model.selection.anchor, idx, 'pointer');
    if (this.#onRenderRequest) this.#onRenderRequest();
  }

  _onPointerUp(e) {
    this.#isDragging = false;
    this.#canvas.releasePointerCapture(e.pointerId);
  }

  _onDoubleClick(e) {
    const { x, y } = this._getCanvasCoords(e);
    const idx = this._hitTest(x, y);
    this.#model.selectWordAt(idx);
    this.#mouseDownCount = 0;
    if (this.#onRenderRequest) this.#onRenderRequest();
  }

  _onClick() {
    this.focus();
  }

  /* ── Keyboard ── */

  _onKeyDown(e) {
    const model = this.#model;
    const hasSelection = model.hasSelection;
    const selStart = model.selStart;
    const selEnd = model.selEnd;

    // Select All
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      model.selectAll();
      if (this.#onRenderRequest) this.#onRenderRequest();
      return;
    }

    // Clipboard
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      this._doCut();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      this._doCopy();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
      // Let the paste event handle it, but keep default for textarea
      return;
    }

    // Arrows
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      this._moveCursor(e.key, e.shiftKey);
      return;
    }

    // Home / End
    if (e.key === 'Home') {
      e.preventDefault();
      const idx = this._findLineStart(model.cursor);
      model.moveCursor(idx, e.shiftKey);
      if (this.#onRenderRequest) this.#onRenderRequest();
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const idx = this._findLineEnd(model.cursor);
      model.moveCursor(idx, e.shiftKey);
      if (this.#onRenderRequest) this.#onRenderRequest();
      return;
    }

    // Escape: collapse selection
    if (e.key === 'Escape') {
      e.preventDefault();
      model.collapseToEnd();
      if (this.#onRenderRequest) this.#onRenderRequest();
      return;
    }

    // Backspace / Delete handled by beforeinput/input, but we need
    // to ensure the textarea stays synced.
    // Enter key inserts newline; let input event handle it.
  }

  _moveCursor(key, shift) {
    const model = this.#model;
    const layout = this.#getLayout();
    const glyphs = layout?.glyphs || [];
    let newIndex = model.cursor;

    if (key === 'ArrowLeft') {
      newIndex = Math.max(0, model.cursor - 1);
    } else if (key === 'ArrowRight') {
      newIndex = Math.min(model.length, model.cursor + 1);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      const g = this._findGlyphAtCursor(model.cursor, glyphs);
      if (g) {
        newIndex = this._findIndexOnAdjacentLine(g.x, g.y, key === 'ArrowDown', layout?.lineHeightPx || 20);
      }
    }

    model.moveCursor(newIndex, shift);
    if (this.#onRenderRequest) this.#onRenderRequest();
  }

  _findGlyphAtCursor(cursor, glyphs) {
    if (cursor >= this.#model.length && glyphs.length > 0) {
      return glyphs[glyphs.length - 1];
    }
    for (const g of glyphs) {
      const gStart = g.charIndex;
      const gEnd = g.charIndex + (g.charCount || 1);
      if (cursor >= gStart && cursor < gEnd) return g;
    }
    return glyphs[glyphs.length - 1] || null;
  }

  _findIndexOnAdjacentLine(x, y, down, lineHeightPx) {
    const layout = this.#getLayout();
    const glyphs = layout?.glyphs || [];
    const targetY = down ? y + lineHeightPx : y - lineHeightPx;

    let closest = down ? this.#model.length : 0;
    let minDist = Infinity;

    for (const g of glyphs) {
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

  _findLineStart(cursor) {
    const text = this.#model.text;
    let i = Math.min(cursor, text.length - 1);
    while (i > 0 && text[i - 1] !== '\n') i--;
    return i;
  }

  _findLineEnd(cursor) {
    const text = this.#model.text;
    let i = cursor;
    while (i < text.length && text[i] !== '\n') i++;
    return i;
  }

  /* ── Text Input ── */

  _onInput(e) {
    if (this.#isComposing) return;
    const newText = this.#textarea.value;
    const oldText = this.#model.text;
    if (newText === oldText) return;

    // Simple replace: we could do a diff, but for now just replace the whole text
    // while preserving runs where possible for prefix/suffix matches.
    this._syncTextToModel(newText);
  }

  _syncTextToModel(newText) {
    const model = this.#model;
    const oldText = model.text;
    if (newText === oldText) return;

    // Find common prefix and suffix to preserve runs
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

    // Adjust runs
    const shifted = [];
    for (const run of model.runs) {
      if (run.end <= start) {
        shifted.push(run);
      } else if (run.start >= oldEnd) {
        shifted.push({ ...run, start: run.start - oldLen + newLen, end: run.end - oldLen + newLen });
      } else {
        // Overlaps changed region: trim or discard
        const newStart = Math.min(run.start, start);
        const newEnd = Math.max(run.end - oldLen + newLen, start);
        if (newEnd > newStart) {
          shifted.push({ ...run, start: newStart, end: newEnd });
        }
      }
    }

    // Update model internals directly to preserve selection semantics
    // We bypass model.text setter so we don't clear runs
    model._setTextAndRuns(newText, shifted);
    model.moveCursor(start + newLen, false, 'input');
    if (this.#onModelChange) this.#onModelChange('text');
  }

  /* ── IME ── */

  _onCompositionStart() {
    this.#isComposing = true;
  }

  _onCompositionEnd(e) {
    this.#isComposing = false;
    // The composition result is already in the textarea; sync it
    this._syncTextToModel(this.#textarea.value);
  }

  /* ── Clipboard ── */

  _onCut(e) {
    e.preventDefault();
    this._doCut();
  }

  _onCopy(e) {
    e.preventDefault();
    this._doCopy();
  }

  _onPaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      this.#model.replaceSelection(text, 'paste');
      this._doSyncTextarea();
      if (this.#onModelChange) this.#onModelChange('text');
    }
  }

  _doCut() {
    const text = this.#model.selectedText;
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {});
      this.#model.replaceSelection('', 'cut');
      this._doSyncTextarea();
      if (this.#onModelChange) this.#onModelChange('text');
    }
  }

  _doCopy() {
    const text = this.#model.selectedText;
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  /* ── Sync ── */

  syncTextarea() {
    this.#doSyncTextarea();
  }

  #doSyncTextarea() {
    const model = this.#model;
    if (this.#textarea.value !== model.text) {
      this.#textarea.value = model.text;
    }
    this.#textarea.selectionStart = model.selStart;
    this.#textarea.selectionEnd = model.selEnd;
  }
}
