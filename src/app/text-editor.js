/* ═══════════════════════════════════════════════════════════════════
   Text Editor — Adobe-style on-canvas text editing

   While a text layer is being edited, an invisible <textarea> is
   positioned exactly over the layer on the page (matching zoom,
   rotation and flips). The layer's rasterized bitmap is hidden for
   the duration of the edit, so typing is fully live at 60fps — the
   expensive opentype shape + pixel pipeline runs ONCE on commit.
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { CANVAS_PAD } from './constants.js';
import { Renderer } from './renderer.js';
import { DB } from './db.js';
import { UI } from './ui.js';
import { pushUndo, snapshotLayer } from './undo.js';
import { TypeSetRenderer } from 'type-set';

const MIN_W_DOC = 40;   // minimum layer width, document px
const MIN_H_DOC = 20;

export const TextEditor = {
  _layerId: null,
  _host: null,
  _ta: null,
  _isNew: false,
  _textOffset: null,

  active() { return this._layerId !== null; },
  isActive(layer) { return !!layer && this._layerId === layer.id; },
  editingLayer() {
    return this._layerId ? State.layers.find(l => l.id === this._layerId) : null;
  },

  /** Begin in-place editing of a text layer. */
  async beginEdit(layer, { isNew = false } = {}) {
    if (!layer || !layer.isText) return;
    if (this._layerId === layer.id) { this._ta?.focus(); return; }
    if (this._layerId) await this.commit();

    this._layerId = layer.id;
    this._isNew = isNew;
    State.textEditingId = layer.id;
    pushUndo(snapshotLayer(layer));

    // Hide the rasterized bitmap right away — otherwise the stale render
    // lingers under the live editor and text appears doubled/offset.
    Renderer.schedule();

    // Make sure the CSS font faces registered by type-set are ready so the
    // editing caret shows the real typeface.
    try {
      await document.fonts.load(
        `${layer.textFontStyle} ${layer.textFontWeight} ${layer.textFontSize}px "${layer.textFontFamily}"`);
    } catch (_e) { /* fall back to whatever is available */ }

    const wrapper = document.getElementById('canvas-wrapper');
    const host = document.createElement('div');
    host.className = 'text-editor-host';
    const ta = document.createElement('textarea');
    ta.className = 'text-editor-input';
    ta.value = layer.text;
    ta.spellcheck = false;
    host.appendChild(ta);
    wrapper.appendChild(host);
    this._host = host;
    this._ta = ta;
    document.body.classList.add('text-editing');

    ta.addEventListener('input', () => this._onInput());
    ta.addEventListener('keydown', e => this._onKeyDown(e));

    this._sync();

    // Anchor the editor's first-line baseline to the exact position the
    // type-set layout uses, so the text doesn't jump when the rasterized
    // bitmap is swapped for the live editor (and back on commit).
    try {
      await this._alignToLayout(layer);
    } catch (_e) { /* keep default alignment on any layout failure */ }
    ta.focus();
    // New layers start with everything selected for immediate overtyping.
    if (isNew && !ta.value) ta.select();
  },

  /** Position/size the editor to match the layer's current transform. */
  _sync() {
    const layer = this.editingLayer();
    if (!layer || !this._host) return;
    const z = State.zoom;
    const ox = (layer.x + layer.width / 2 + CANVAS_PAD) * z;
    const oy = (layer.y + layer.height / 2 + CANVAS_PAD) * z;
    const style = this._host.style;
    style.left = (ox - CANVAS_PAD * z) + 'px';
    style.top  = (oy - CANVAS_PAD * z) + 'px';
    style.width  = Math.max(4, layer.width * z) + 'px';
    style.height = Math.max(4, layer.height * z) + 'px';
    style.transform =
      `translate(-50%, -50%) rotate(${layer.rotation}deg) ` +
      `scale(${layer.flipH ? -1 : 1}, ${layer.flipV ? -1 : 1})`;
    this._styleTextarea(layer, z);
  },

  _styleTextarea(layer, z) {
    const ta = this._ta;
    ta.style.fontFamily = `"${layer.textFontFamily}", serif`;
    ta.style.fontWeight = layer.textFontWeight;
    ta.style.fontStyle = layer.textFontStyle;
    ta.style.fontSize = (layer.textFontSize * z) + 'px';
    ta.style.lineHeight = String(layer.textLineHeight);
    ta.style.letterSpacing = (layer.textLetterSpacing * z) + 'px';
    ta.style.textAlign = layer.textAlign === 'justify' ? 'justify' : layer.textAlign;
    if (this._textOffset) {
      ta.style.transform = `translate(${this._textOffset.dx}px, ${this._textOffset.dy}px)`;
    }
  },

  /**
   * Compute the translate that puts the editor's first-line baseline where
   * the type-set layout draws it (first baseline at fontSize*lineHeight,
   * first glyph at its layout x). Measured live via a probe element so the
   * text occupies the same pixels in editing and presentation modes.
   */
  async _alignToLayout(layer) {
    const z = State.zoom;
    const renderer = new TypeSetRenderer({
      fontBase: './vendor/type-set/fonts/',
      fontFamily: layer.textFontFamily,
      fontSize: layer.textFontSize,
      fontWeight: layer.textFontWeight,
      fontStyle: layer.textFontStyle,
      letterSpacing: layer.textLetterSpacing,
      lineHeight: layer.textLineHeight,
      textAlign: layer.textAlign,
      text: layer.text,
      useLigatures: true,
      useKerning: true,
      useHyphenation: false,
    });
    await renderer.loadFonts();
    const { glyphs } = await renderer.shapeAndLayout(Math.max(1, layer.naturalWidth));
    const g0 = glyphs.find(g => g.char !== '\n');
    if (!g0) { this._textOffset = { dx: 0, dy: 0 }; this._sync(); return; }

    const targetX = g0.x * z; // layout pen position of first glyph, screen px
    const targetY = g0.y * z; // layout baseline of first glyph, screen px

    const { probeX, probeY } = this._measureCssOrigin(layer, z);
    this._textOffset = { dx: targetX - probeX, dy: targetY - probeY };
    this._sync();
  },

  /**
   * Measure where CSS would place the first line's baseline/pen origin for
   * the same text and styling. A zero-size inline-block aligned to the
   * baseline marks the baseline; its top-left is the line's pen origin.
   */
  _measureCssOrigin(layer, z) {
    const ta = this._ta;
    const mirror = document.createElement('div');
    const ms = mirror.style;
    ms.position = 'absolute';
    ms.visibility = 'hidden';
    ms.left = '-9999px';
    ms.top = '0';
    ms.width = (this._host && this._host.style.width) || ta.style.width;
    ms.fontFamily = ta.style.fontFamily;
    ms.fontWeight = ta.style.fontWeight;
    ms.fontStyle = ta.style.fontStyle;
    ms.fontSize = ta.style.fontSize;
    ms.lineHeight = ta.style.lineHeight;
    ms.letterSpacing = ta.style.letterSpacing;
    ms.textAlign = ta.style.textAlign;
    ms.whiteSpace = 'pre-wrap';
    ms.overflowWrap = 'break-word';
    ms.padding = '0';
    ms.margin = '0';
    ms.border = 'none';

    // Place the probe just before the first visible character so leading
    // blank lines land the probe on the same line the glyphs start on.
    const value = ta.value;
    const firstChar = [...value].findIndex(ch => ch !== '\n');
    const lead = firstChar === -1 ? value : value.slice(0, firstChar);
    const rest = firstChar === -1 ? '' : value.slice(firstChar);

    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
    if (lead) mirror.appendChild(document.createTextNode(lead));
    mirror.appendChild(probe);
    if (rest) mirror.appendChild(document.createTextNode(rest));
    document.body.appendChild(mirror);
    const probeX = probe.offsetLeft;
    const probeY = probe.offsetTop;
    mirror.remove();
    return { probeX, probeY };
  },

  _onInput() {
    const layer = this.editingLayer();
    if (!layer || !this._ta) return;
    layer.text = this._ta.value;
    // Invalidate raster caches; the bitmap re-renders once, on commit.
    layer._originalCanvas = null;
    layer._exportOriginalCanvas = null;
    layer._dirty = true;
    this._autoSize(layer);
    this._sync();
  },

  /** Grow box height / line width to fit content while typing. */
  _autoSize(layer) {
    const ta = this._ta;
    if (layer.textMode === 'line') {
      // Point type: single line that grows horizontally. Enter commits.
      const wDoc = this.measureWidth(layer);
      layer.naturalWidth = layer.width = Math.max(MIN_W_DOC, Math.ceil(wDoc));
      const h = Math.ceil(layer.textFontSize * layer.textLineHeight * 1.25);
      layer.naturalHeight = layer.height = h;
      // Grow to the right (or left when right-aligned) around the anchor point.
      // Keep it simple: keep top-left fixed; users can drag afterwards.
      ta.style.height = (h * State.zoom) + 'px';
    } else {
      // Paragraph box: fixed width, grow height to fit.
      const neededH = ta.scrollHeight / State.zoom;
      const hDoc = Math.max(MIN_H_DOC, Math.ceil(neededH));
      if (Math.abs(hDoc - layer.height) > 1) {
        layer.naturalHeight = layer.height = hDoc;
        layer._originalCanvas = null;
        layer._dirty = true;
      }
    }
  },

  measureWidth(layer) {
    const c = this._measureCtx ??= document.createElement('canvas').getContext('2d');
    c.font = `${layer.textFontStyle} ${layer.textFontWeight} ${layer.textFontSize}px "${layer.textFontFamily}"`;
    let maxW = 0;
    for (const line of (this._ta?.value || '').split('\n')) {
      maxW = Math.max(maxW, c.measureText(line).width);
    }
    return maxW + layer.textLetterSpacing * Math.max(0, (this._ta?.value.length || 0)) + MIN_W_DOC;
  },

  _onKeyDown(e) {
    const layer = this.editingLayer();
    if (!layer) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.commit();
      return;
    }
    if (e.key === 'Enter' && layer.textMode === 'line' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      this.commit();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.commit();
    }
  },

  /** Finish editing: persist, restore the rasterized layer, clean up. */
  async commit() {
    const layer = this.editingLayer();
    if (!layer) return;

    if (this._ta) layer.text = this._ta.value;
    this._teardown();

    if (this._isNew && !(layer.text || '').trim()) {
      // Cancelled empty new layer — remove it entirely.
      State.layers = State.layers.filter(l => l.id !== layer.id);
      if (State.selectedId === layer.id) { State.selectedId = null; State.selectedIds = []; }
      DB.delete('layers', layer.id);
      UI.refreshLayerList();
      UI.refreshProperties();
      Renderer.schedule();
      return;
    }

    layer._originalCanvas = null;
    layer._exportOriginalCanvas = null;
    layer._dirty = true;
    await DB.saveLayer(layer);
    UI.refreshProperties();
    Renderer.schedule();
  },

  _teardown() {
    this._host?.remove();
    this._host = null;
    this._ta = null;
    this._isNew = false;
    this._layerId = null;
    this._textOffset = null;
    State.textEditingId = null;
    document.body.classList.remove('text-editing');
  },
};

// Commit whenever zoom changes so the caret never drifts off the glyphs.
document.addEventListener('sc-zoom', () => { if (TextEditor.active()) TextEditor.commit(); });
