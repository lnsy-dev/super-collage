/* ═══════════════════════════════════════════════════════════════════
   Font picker — searchable font dropdown.

   The properties panel keeps its original <select id="prop-text-font"> as
   the value holder (other code sets .value on it and listens for change);
   it is hidden from sight and accessibility tree. This module puts a
   button + search popup in front of it, so the ~2000 Google families can
   actually be found: type a few letters and the list narrows with a fuzzy
   subsequence match ("plsrf" finds "Playfair Display"), the rows preview
   each family in its own typeface, and ↑/↓/Enter pick.
   ═══════════════════════════════════════════════════════════════════ */

import { ensurePreviewFont, PREVIEW_TEXT } from './google-fonts.js';

const MAX_RESULTS = 80;
const PREVIEW_CHUNK = 4;

/** Entries shown in the picker: { family, category, bundled }. */
let entries = [];
let select = null;
let pop = null;
let search = null;
let list = null;
let emptyNote = null;
let button = null;
let labelEl = null;
let activeIndex = -1;
let shown = [];
let previewQueue = [];
let previewTimer = null;

/* ── fuzzy matching ──────────────────────────────────────────────── */

/**
 * Score a query against a candidate string, higher is better, -1 for no
 * match. Subsequence match with bonuses for word starts, consecutive runs
 * and full-substring hits; spaces in the query are optional.
 */
export function fuzzyScore(query, candidate) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const lower = candidate.toLowerCase();

  // Substring hit is always the best kind of match.
  const sub = lower.indexOf(q);
  if (sub !== -1) {
    const boundary = sub === 0 || /[\s-]/.test(lower[sub - 1]) ? 60 : 0;
    return 1000 - sub * 4 + boundary + (q.length / lower.length) * 10;
  }

  const needle = q.replace(/\s+/g, '');
  let score = 0;
  let ci = 0;
  let run = 0;
  let matched = 0;
  for (const ch of needle) {
    const idx = lower.indexOf(ch, ci);
    if (idx === -1) return -1;
    if (idx === ci && matched > 0) {
      run++;
      score += 12 + run * 4;          // consecutive characters
    } else {
      run = 0;
    }
    if (idx === 0 || /[\s-]/.test(lower[idx - 1])) score += 20; // word start
    score += 2;
    ci = idx + 1;
    matched++;
  }
  // Prefer shorter candidates when the scores are otherwise close.
  return score - lower.length * 0.5;
}

/** Filter + rank the entries for a query. Bundled fonts win ties. */
export function searchFonts(query) {
  if (!query.trim()) return entries.slice(0, MAX_RESULTS);
  const scored = [];
  for (const e of entries) {
    const score = fuzzyScore(query, e.family);
    if (score >= 0) scored.push({ e, score });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.e.bundled === b.e.bundled ? 0 : (a.e.bundled ? -1 : 1)));
  return scored.slice(0, MAX_RESULTS).map(s => s.e);
}

/* ── DOM ─────────────────────────────────────────────────────────── */

function build() {
  select = document.getElementById('prop-text-font');
  if (!select) return false;
  select.classList.add('visually-hidden');
  select.setAttribute('tabindex', '-1');
  select.setAttribute('aria-hidden', 'true');

  const wrap = document.createElement('div');
  wrap.className = 'font-picker';
  wrap.id = 'font-picker';
  button = document.createElement('button');
  button.type = 'button';
  button.className = 'font-picker-button';
  button.id = 'font-picker-button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  labelEl = document.createElement('span');
  labelEl.className = 'font-picker-label';
  labelEl.id = 'font-picker-label';
  const caret = document.createElement('span');
  caret.className = 'font-picker-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  button.append(labelEl, caret);
  wrap.appendChild(button);
  select.parentElement.insertBefore(wrap, select);

  pop = document.createElement('div');
  pop.className = 'font-picker-pop';
  pop.id = 'font-picker-pop';
  pop.hidden = true;
  search = document.createElement('input');
  search.type = 'text';
  search.className = 'font-picker-search';
  search.id = 'font-picker-search';
  search.placeholder = 'Search fonts…';
  search.spellcheck = false;
  search.autocomplete = 'off';
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-expanded', 'true');
  search.setAttribute('aria-controls', 'font-picker-list');
  list = document.createElement('div');
  list.className = 'font-picker-list';
  list.id = 'font-picker-list';
  list.setAttribute('role', 'listbox');
  emptyNote = document.createElement('div');
  emptyNote.className = 'font-picker-empty';
  emptyNote.textContent = 'No matching fonts';
  emptyNote.hidden = true;
  pop.append(search, list, emptyNote);
  document.body.appendChild(pop);

  button.addEventListener('click', e => { e.preventDefault(); if (pop.hidden) open(); else close(); });
  search.addEventListener('input', () => { activeIndex = -1; render(); });
  search.addEventListener('keydown', onKeyDown);
  list.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the field
  list.addEventListener('click', e => {
    const row = e.target.closest('.font-picker-row');
    if (row) choose(row.dataset.family);
  });
  list.addEventListener('mousemove', e => {
    const row = e.target.closest('.font-picker-row');
    if (!row) return;
    const idx = shown.findIndex(f => f.family === row.dataset.family);
    if (idx !== -1 && idx !== activeIndex) { activeIndex = idx; markActive(); }
  });
  document.addEventListener('mousedown', e => {
    if (pop.hidden) return;
    if (pop.contains(e.target) || wrap.contains(e.target)) return;
    close();
  });
  window.addEventListener('resize', () => { if (!pop.hidden) position(); });
  // The popup is fixed-positioned, so it has to follow its button when the
  // properties panel scrolls underneath it.
  document.addEventListener('scroll', () => { if (!pop.hidden) position(); }, true);
  return true;
}

/** Show the current select value on the button. */
export function setFontPickerValue(family) {
  if (labelEl) labelEl.textContent = family || '';
}

/** Register the bundled families found in the <select>. */
export function addBundledFamilies() {
  if (!select) return;
  const bundled = [...select.options]
    .map(o => o.value)
    .filter(v => v && !entries.some(e => e.family === v))
    .map(v => ({ family: v, category: 'Bundled', bundled: true }));
  entries = bundled.concat(entries.filter(e => !e.bundled));
  setFontPickerValue(select.value);
}

/** Add (or refresh) the Google families offered by the picker. */
export function addGoogleFamilies(families) {
  if (!select) return;
  const known = new Set([...select.options].map(o => o.value));
  const group = select.querySelector('optgroup[data-source="google"]');
  const optgroup = group || document.createElement('optgroup');
  optgroup.label = 'Google Fonts';
  optgroup.dataset.source = 'google';
  for (const { family } of families) {
    if (known.has(family)) continue;
    known.add(family);
    const opt = document.createElement('option');
    opt.value = family;
    opt.textContent = family;
    optgroup.appendChild(opt);
  }
  if (!group) select.appendChild(optgroup);
  entries = entries.filter(e => e.bundled)
    .concat(families.map(f => ({ family: f.family, category: f.category, bundled: false })));
  setFontPickerValue(select.value);
}

/* ── popup ───────────────────────────────────────────────────────── */

function open() {
  if (pop.hidden === false) return;
  pop.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  search.value = '';
  position();
  render();
  search.focus();
}

function close() {
  if (pop.hidden) return;
  pop.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  activeIndex = -1;
  button.focus();
}

function position() {
  const r = button.getBoundingClientRect();
  const width = Math.max(r.width, 240);
  const maxHeight = Math.max(160, Math.min(360, window.innerHeight - r.bottom - 16));
  const below = window.innerHeight - r.bottom;
  const above = r.top;
  const openUp = below < 240 && above > below;
  pop.style.left = Math.min(r.left, window.innerWidth - width - 8) + 'px';
  pop.style.width = width + 'px';
  pop.style.maxHeight = (openUp ? Math.min(360, above - 16) : maxHeight) + 'px';
  pop.style.top = openUp ? '' : r.bottom + 2 + 'px';
  pop.style.bottom = openUp ? (window.innerHeight - r.top + 2) + 'px' : '';
}

function render() {
  shown = searchFonts(search.value);
  list.innerHTML = '';
  activeIndex = shown.length ? 0 : -1;
  shown.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'font-picker-row';
    row.dataset.family = e.family;
    row.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.className = 'font-picker-name';
    name.style.fontFamily = `"${e.family}", var(--font-ui)`;
    name.textContent = PREVIEW_TEXT;
    const cat = document.createElement('span');
    cat.className = 'font-picker-cat';
    cat.textContent = e.category || (e.bundled ? 'Bundled' : 'Google');
    row.append(name, cat);
    row.title = e.family;
    list.appendChild(row);
    if (i === activeIndex) row.classList.add('active');
    queuePreview(e.family);
  });
  emptyNote.hidden = shown.length > 0;
}

function markActive() {
  [...list.children].forEach((row, i) => row.classList.toggle('active', i === activeIndex));
  list.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
}

function onKeyDown(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!shown.length) return;
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    activeIndex = (activeIndex + dir + shown.length) % shown.length;
    markActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const chosen = shown[activeIndex];
    if (chosen) choose(chosen.family);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    close();
  } else if (e.key === 'Tab') {
    close();
  }
}

function choose(family) {
  if (select.value !== family) {
    select.value = family;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  setFontPickerValue(family);
  close();
}

/* ── previews ────────────────────────────────────────────────────── */

/**
 * Loading a webfont is a network round trip, so previews are pulled in
 * small batches off a queue: a fast typist never queues more than one
 * screenful, and the list stays responsive.
 */
function queuePreview(family) {
  if (previewQueue.includes(family)) return;
  previewQueue.push(family);
  if (previewTimer) return;
  const pump = () => {
    const batch = previewQueue.splice(0, PREVIEW_CHUNK);
    for (const f of batch) ensurePreviewFont(f, 400, 'normal');
    previewTimer = previewQueue.length ? setTimeout(pump, 120) : null;
  };
  previewTimer = setTimeout(pump, 200);
}

/** Build the picker. Safe to call once at startup. */
export function initFontPicker() {
  if (build()) addBundledFamilies();
}
