/**
 * TextModel
 *
 * Single source of truth for text content, selection, and style runs.
 * Replaces fragile parallel arrays (perCharWeight, perCharSpacing, perCharItalic)
 * with a run-based model where each run is a contiguous range with uniform styling.
 */

export class TextModel extends EventTarget {
  #text = '';
  #anchor = 0;
  #focus = 0;
  #runs = []; // { start, end, weight, italic, spacing }

  constructor(text = '') {
    super();
    this.#text = text;
    this.#anchor = text.length;
    this.#focus = text.length;
  }

  /* ── Accessors ── */

  get text() {
    return this.#text;
  }

  set text(value) {
    const oldText = this.#text;
    if (value === oldText) return;
    this.#text = value;
    this.#anchor = value.length;
    this.#focus = value.length;
    // Clear all style runs on full replacement; preserve nothing.
    // Callers that want to preserve styles should use insert/delete.
    this.#runs = [];
    this.#emit('change', { textChanged: true, oldText, newText: value });
  }

  get length() {
    return this.#text.length;
  }

  /* ── Selection ── */

  get selection() {
    return { anchor: this.#anchor, focus: this.#focus };
  }

  get cursor() {
    return this.#focus;
  }

  get hasSelection() {
    return this.#anchor !== this.#focus;
  }

  get selStart() {
    return Math.min(this.#anchor, this.#focus);
  }

  get selEnd() {
    return Math.max(this.#anchor, this.#focus);
  }

  get selectedText() {
    return this.#text.slice(this.selStart, this.selEnd);
  }

  setSelection(anchor, focus, source = 'api') {
    const clampedA = Math.max(0, Math.min(anchor, this.#text.length));
    const clampedF = Math.max(0, Math.min(focus, this.#text.length));
    if (this.#anchor === clampedA && this.#focus === clampedF) return;
    this.#anchor = clampedA;
    this.#focus = clampedF;
    this.#emit('selectionchange', { anchor: this.#anchor, focus: this.#focus, source });
  }

  moveCursor(to, extendSelection = false, source = 'api') {
    const clamped = Math.max(0, Math.min(to, this.#text.length));
    if (extendSelection) {
      this.setSelection(this.#anchor, clamped, source);
    } else {
      this.setSelection(clamped, clamped, source);
    }
  }

  collapseToStart() {
    this.setSelection(this.selStart, this.selStart);
  }

  collapseToEnd() {
    this.setSelection(this.selEnd, this.selEnd);
  }

  selectAll() {
    this.setSelection(0, this.#text.length);
  }

  selectWordAt(index) {
    const text = this.#text;
    let start = Math.max(0, Math.min(index, text.length));
    let end = start;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    while (end < text.length && !/\s/.test(text[end])) end++;
    this.setSelection(start, end);
  }

  selectLineAt(index) {
    const text = this.#text;
    let start = index;
    let end = index;
    while (start > 0 && text[start - 1] !== '\n') start--;
    while (end < text.length && text[end] !== '\n') end++;
    this.setSelection(start, end);
  }

  /* ── Text mutation ── */

  insertText(at, text, source = 'api') {
    if (!text || text.length === 0) return;
    const pos = Math.max(0, Math.min(at, this.#text.length));
    const before = this.#text.slice(0, pos);
    const after = this.#text.slice(pos);
    const oldText = this.#text;
    this.#text = before + text + after;

    // Determine style for inserted text: inherit from the run at insertion point
    const inherited = this.#getRunAt(pos) || {};
    const newRun = {
      start: pos,
      end: pos + text.length,
      weight: inherited.weight || 0,
      italic: inherited.italic || false,
      spacing: inherited.spacing || 0,
    };

    // Shift existing runs
    const len = text.length;
    const shifted = [];
    for (const run of this.#runs) {
      if (run.end <= pos) {
        shifted.push(run);
      } else if (run.start >= pos) {
        shifted.push({ ...run, start: run.start + len, end: run.end + len });
      } else {
        // Run spans insertion point: split it
        shifted.push({ ...run, end: pos });
        shifted.push({ ...run, start: pos + len, end: run.end + len });
      }
    }

    // Insert new run and merge adjacent identical runs
    this.#runs = this.#mergeRuns([...shifted, newRun]);

    // Move cursor after insertion
    this.setSelection(pos + len, pos + len, source);
    this.#emit('change', { textChanged: true, oldText, newText: this.#text });
  }

  deleteRange(start, end, source = 'api') {
    const s = Math.max(0, Math.min(start, this.#text.length));
    const e = Math.max(0, Math.min(end, this.#text.length));
    if (s >= e) return;
    const oldText = this.#text;
    const before = this.#text.slice(0, s);
    const after = this.#text.slice(e);
    this.#text = before + after;
    const len = e - s;

    // Remove or trim runs in deleted range, shift runs after it
    const shifted = [];
    for (const run of this.#runs) {
      if (run.end <= s) {
        shifted.push(run);
      } else if (run.start >= e) {
        shifted.push({ ...run, start: run.start - len, end: run.end - len });
      } else {
        // Overlaps deletion: trim or discard
        const newStart = Math.min(run.start, s);
        const newEnd = Math.max(run.end - len, s);
        if (newEnd > newStart) {
          shifted.push({ ...run, start: newStart, end: newEnd });
        }
      }
    }
    this.#runs = this.#mergeRuns(shifted);

    this.setSelection(s, s, source);
    this.#emit('change', { textChanged: true, oldText, newText: this.#text });
  }

  replaceSelection(text, source = 'api') {
    const s = this.selStart;
    const e = this.selEnd;
    if (s !== e) {
      this.deleteRange(s, e, source);
    }
    this.insertText(s, text, source);
  }

  /* ── Style runs ── */

  get runs() {
    return this.#runs.map(r => ({ ...r }));
  }

  set runs(value) {
    this.#runs = (value || []).map(r => ({ ...r }));
    this.#emit('change', { styleChanged: true });
  }

  getStyleAt(index) {
    const run = this.#getRunAt(index);
    return run || { weight: 0, italic: false, spacing: 0 };
  }

  setRunStyle(start, end, prop, value) {
    const s = Math.max(0, Math.min(start, this.#text.length));
    const e = Math.max(0, Math.min(end, this.#text.length));
    if (s >= e) return;

    const allowed = ['weight', 'italic', 'spacing'];
    if (!allowed.includes(prop)) return;

    const newRuns = [];
    for (const run of this.#runs) {
      if (run.end <= s || run.start >= e) {
        newRuns.push(run);
        continue;
      }
      // Run overlaps [s, e)
      if (run.start < s) {
        newRuns.push({ ...run, end: s });
      }
      const overlapStart = Math.max(run.start, s);
      const overlapEnd = Math.min(run.end, e);
      newRuns.push({ ...run, start: overlapStart, end: overlapEnd, [prop]: value });
      if (run.end > e) {
        newRuns.push({ ...run, start: e, end: run.end });
      }
    }

    // If there were no runs covering [s, e), create one with default+override
    const covered = this.#runs.some(r => r.start < e && r.end > s);
    if (!covered) {
      newRuns.push({ start: s, end: e, weight: 0, italic: false, spacing: 0, [prop]: value });
    }

    this.#runs = this.#mergeRuns(newRuns);
    this.#emit('change', { styleChanged: true });
  }

  clearRunStyle(start, end, prop) {
    this.setRunStyle(start, end, prop, prop === 'italic' ? false : 0);
  }

  /* ── Run helpers ── */

  #getRunAt(index) {
    for (const run of this.#runs) {
      if (index >= run.start && index < run.end) return run;
    }
    return null;
  }

  #mergeRuns(runs) {
    if (runs.length === 0) return [];
    runs.sort((a, b) => a.start - b.start);
    const merged = [{ ...runs[0] }];
    for (let i = 1; i < runs.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = runs[i];
      if (curr.start < prev.end) {
        // Overlap: extend prev if styles match, otherwise just add
        if (
          prev.weight === curr.weight &&
          prev.italic === curr.italic &&
          prev.spacing === curr.spacing
        ) {
          prev.end = Math.max(prev.end, curr.end);
          continue;
        }
      }
      if (
        curr.start === prev.end &&
        prev.weight === curr.weight &&
        prev.italic === curr.italic &&
        prev.spacing === curr.spacing
      ) {
        prev.end = curr.end;
      } else {
        merged.push({ ...curr });
      }
    }
    // Remove zero-length runs and runs with default values
    return merged.filter(r => r.end > r.start && (r.weight || r.italic || r.spacing));
  }

  _setTextAndRuns(text, runs) {
    this.#text = text;
    this.#runs = runs.map(r => ({ ...r }));
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
