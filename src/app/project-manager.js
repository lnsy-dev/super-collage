/* ═══════════════════════════════════════════════════════════════════
   Project Manager
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { ExportEngine } from './export-engine.js';
import { CANVAS_W, CANVAS_H, PAGE_SIZE_DIMS, setCanvasSize, RISO_COLORS, DEFAULT_RISO_COLORS, setRisoColors, formatPageSizeLabel, formatPxDimensions } from './constants.js';
import { PageManager } from './page-manager.js';
import { calculateLayout, calculateBookletLayout, calculateSingleImageLayout } from './imposition.js';
import { computeViewUnits } from './spread-manager.js';

export let _selProjectId = null;

export async function loadEffectivePalette(project = null) {
  const globalSetting = await DB.getSetting('risoColors');
  const globalColors = Array.isArray(globalSetting?.value) ? globalSetting.value : DEFAULT_RISO_COLORS.map(c => ({ ...c }));
  const projectColors = project?.colors || [];
  const projectHexes = new Set(projectColors.map(c => c.hex.toUpperCase()));
  const merged = [
    ...globalColors.filter(c => !projectHexes.has(c.hex.toUpperCase())),
    ...projectColors,
  ];
  setRisoColors(merged);
}

export function showProjectDialog() {
  document.getElementById('project-dialog').classList.remove('hidden');
  // The dialog is only cancellable when a project is already open; otherwise
  // there is nothing to return to, so keep it modal (no close affordance).
  document.getElementById('btn-close-project-dialog').style.display = State.project ? '' : 'none';
  return loadProjectList();
}

export function hideProjectDialog() {
  // Only allow dismissing when a project is open behind the dialog.
  if (!State.project) return;
  document.getElementById('project-dialog').classList.add('hidden');
}

export async function showCreateDialog() {
  document.getElementById('project-dialog').classList.add('hidden');
  document.getElementById('create-project-dialog').classList.remove('hidden');
  document.getElementById('btn-create-project-close').style.display = State.project ? '' : 'none';
  document.getElementById('btn-create-back').style.display = State.project ? '' : 'none';

  // Reset wizard to the first step.
  document.querySelectorAll('.wizard-step').forEach((s, i) => s.classList.toggle('active', i === 0));
  const nextBtn = document.getElementById('btn-create-next');
  if (nextBtn) nextBtn.textContent = 'Next';

  // Restore the user's preferred page-size unit and refresh the size list.
  const savedUnit = (await DB.getSetting('pageSizeUnit'))?.value || 'imperial';
  const unitRadio = document.querySelector(`input[name="create-size-unit"][value="${savedUnit}"]`);
  if (unitRadio) {
    unitRadio.checked = true;
    unitRadio.dispatchEvent(new Event('change'));
  }

  const input = document.getElementById('create-project-name');
  input.value = '';
  input.focus();
}

export function hideCreateDialog() {
  document.getElementById('create-project-dialog').classList.add('hidden');
  if (!State.project) {
    // If no project is open, returning to an empty manager is pointless;
    // keep the create dialog visible instead.
    document.getElementById('create-project-dialog').classList.remove('hidden');
    return;
  }
  document.getElementById('project-dialog').classList.remove('hidden');
}

export async function loadProjectList() {
  _selProjectId = null;
  document.getElementById('btn-open-project').disabled = true;
  const projects = (await DB.getAll('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  if (!projects.length) {
    list.innerHTML = '<div class="project-entry" style="color:var(--dark-gray);justify-content:center;">No projects yet</div>';
    if (!State.project) {
      showCreateDialog();
    }
    return;
  }
  for (const p of projects) {
    const row = document.createElement('div');
    row.className = 'project-entry';
    row.innerHTML = `<span>${p.name}</span><span class="project-date">${new Date(p.updatedAt).toLocaleDateString()}</span>`;
    row.addEventListener('click', () => {
      _selProjectId = p.id;
      list.querySelectorAll('.project-entry').forEach(r => r.classList.toggle('selected', r === row));
      document.getElementById('btn-open-project').disabled = false;
    });
    row.addEventListener('dblclick', () => { _selProjectId = p.id; openProject(p.id); });
    list.appendChild(row);
  }
}

export async function openProject(projectId) {
  document.getElementById('project-dialog').classList.add('hidden');
  const project = await DB.get('projects', projectId);
  if (!project) return;

  // Ensure v2 projects have page metadata even if migration missed them.
  if (!project.pageOrder || !project.pageOrder.length) {
    await PageManager.createPages(projectId, 1, _resolveProjectDims(project).w, _resolveProjectDims(project).h);
    const updated = await DB.get('projects', projectId);
    Object.assign(project, updated);
  }

  State.project = project;
  State.booklet = project.booklet || { binding: 'saddle-stitch', targetSheetSize: 'letter', pagesPerSheet: 1 };
  PageManager.loadViewSettings(project);
  await loadEffectivePalette(project);
  State.layers = [];
  State.selectedId = null;
  State.selectedIds = [];
  State.undoStack = [];
  State.redoStack = [];

  // Cache lightweight page metadata.
  const pages = await DB.getByIndex('pages', 'by-project', projectId);
  const order = project.pageOrder || [];
  pages.sort((a, b) => {
    const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  State.pages = pages;

  document.getElementById('main-app').style.display = 'flex';
  document.getElementById('status-project').textContent = project.name;

  // Compute/update spread metadata for all pages, then refresh the cache.
  await PageManager.recomputeSpreadMeta();
  State.pages = (await DB.getByIndex('pages', 'by-project', projectId)).sort((a, b) => {
    const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Load the editor unit the project was last on (spread or single page),
  // falling back to the first one if that page has since been removed.
  const units = computeViewUnits(project.pageOrder, project.booklet?.binding);
  const startUnit = (project.activeUnitId && units.find(u => u.id === project.activeUnitId))
    || units[0];
  if (startUnit) {
    await PageManager.loadUnit(startUnit.id);
  } else {
    _setProjectCanvasSize(project);
    document.getElementById('canvas-title').textContent = `${project.name} @ 600dpi`;
    UI.fitZoom();
    UI.refreshOrientation();
    UI.refreshLayerList();
    UI.refreshProperties();
    Renderer.schedule();
  }
}

function _resolveProjectDims(project) {
  const unit = project.pageSizeUnit || 'imperial';
  let sizeLabel = formatPageSizeLabel(project.pageSize, unit);
  let dims = PAGE_SIZE_DIMS[project.pageSize];
  if (project.pageSize === 'custom' && project.customW && project.customH) {
    dims = { w: project.customW, h: project.customH };
    sizeLabel = `Custom (${formatPxDimensions(project.customW, project.customH, unit)})`;
  }
  if (!sizeLabel) sizeLabel = formatPageSizeLabel('letter', unit);
  if (!dims) dims = PAGE_SIZE_DIMS['letter'];
  let { w, h } = dims;
  if (project.orientation === 'landscape' && h > w) [w, h] = [h, w];
  return { w, h, sizeLabel };
}

function _setProjectCanvasSize(project) {
  const { w, h } = _resolveProjectDims(project);
  setCanvasSize(w, h);
}

const BOOKLET_LAYOUT_ORDER = ['folio', 'quarto', 'octavo'];
const BOOKLET_PER_SIDE = { folio: 2, quarto: 4, octavo: 8 };
const COPIES_ORDER = [
  { value: '1up', copies: 1 },
  { value: '2up', copies: 2 },
  { value: '4up', copies: 4 },
  { value: '8up', copies: 8 },
];
// Tolerance for "fits unscaled": paper and page dims are exact 600-dpi pixel
// counts, so anything measurably below 1 is a real scale-down.
const FIT_EPSILON = 1e-6;

// True when `bookletLayout`'s fixed grid can hold a `pageW × pageH` page on
// `targetSize` paper without scaling (100%).
function bookletLayoutFits(pageW, pageH, bookletLayout, targetSize, customW = 0, customH = 0) {
  return calculateBookletLayout(pageW, pageH, bookletLayout, targetSize, customW, customH).scale >= 1 - FIT_EPSILON;
}

function singleImageFits(pageW, pageH, copies, targetSize, customW = 0, customH = 0) {
  return calculateSingleImageLayout(pageW, pageH, copies, targetSize, customW, customH).scale >= 1 - FIT_EPSILON;
}

// ── Shared option validation for both export dialogs ─────────────────────
// A (target paper, booklet layout) pair is only offered when every page of
// the layout's fixed grid fits the paper unscaled — small pages stay centered
// on the sheet at 100%, and nothing is ever silently shrunk. Invalid booklet
// layouts and paper options are disabled; when the current selection is one
// of them the nearest valid option is selected instead. Returns
// { targetSize, bookletLayout, notes, customWarning }.
function validateBookletOptions(prefix, pageW, pageH) {
  const sizeSelect = document.getElementById(`${prefix}-target-size`);
  let targetSize = sizeSelect?.value || 'letter';
  const customW = parseFloat(document.getElementById(`${prefix}-custom-width`)?.value || '0') * 600;
  const customH = parseFloat(document.getElementById(`${prefix}-custom-height`)?.value || '0') * 600;
  const customRow = document.getElementById(`${prefix}-custom-size-row`);
  if (customRow) customRow.style.display = targetSize === 'custom' ? '' : 'none';

  const notes = [];
  let bookletLayout = document.querySelector(`input[name="${prefix}-booklet-layout"]:checked`)?.value || 'folio';

  // 1. Disable booklet layouts that cannot fit the selected paper unscaled;
  //    if the selected layout is one of them, fall back to the next-smaller
  //    grid that fits.
  for (const value of BOOKLET_LAYOUT_ORDER) {
    const radio = document.querySelector(`input[name="${prefix}-booklet-layout"][value="${value}"]`);
    if (radio) radio.disabled = !bookletLayoutFits(pageW, pageH, value, targetSize, customW, customH);
  }
  if (!bookletLayoutFits(pageW, pageH, bookletLayout, targetSize, customW, customH)) {
    const fallback = BOOKLET_LAYOUT_ORDER
      .filter(v => BOOKLET_PER_SIDE[v] <= BOOKLET_PER_SIDE[bookletLayout]
        && bookletLayoutFits(pageW, pageH, v, targetSize, customW, customH))
      .pop();
    if (fallback) {
      const radio = document.querySelector(`input[name="${prefix}-booklet-layout"][value="${fallback}"]`);
      if (radio) radio.checked = true;
      notes.push(`${bookletLayout} can't fit unscaled — switched to ${fallback}`);
      bookletLayout = fallback;
    } else {
      notes.push(`${bookletLayout} pages will be scaled down to fit`);
    }
  }

  // 2. Disable papers that cannot fit the selected layout unscaled; if the
  //    selected paper is one of them, auto-select the first fitting one.
  const paperOptions = sizeSelect ? [...sizeSelect.options].filter(o => o.value !== 'custom') : [];
  for (const o of paperOptions) o.disabled = !bookletLayoutFits(pageW, pageH, bookletLayout, o.value);
  if (targetSize !== 'custom' && !bookletLayoutFits(pageW, pageH, bookletLayout, targetSize)) {
    const firstFit = paperOptions.find(o => !o.disabled);
    if (firstFit) {
      sizeSelect.value = firstFit.value;
      notes.push(`${targetSize} paper can't fit unscaled — switched to ${firstFit.value}`);
      targetSize = firstFit.value;
    }
  }

  // 3. A custom paper cannot be disabled from the dropdown — validate its
  //    dimensions instead and let the caller block the export button.
  let customWarning = null;
  if (targetSize === 'custom') {
    const scale = calculateBookletLayout(pageW, pageH, bookletLayout, 'custom', customW, customH).scale;
    if (scale < 1 - FIT_EPSILON) {
      customWarning = `Custom paper too small for ${bookletLayout} — pages would be scaled to ${Math.round(scale * 100)}%`;
    }
  }

  return { targetSize, bookletLayout, customW, customH, notes, customWarning };
}

// Same rule for the single-image copies (1/2/4/8 per sheet): only copies and
// papers that fit unscaled are offered.
function validateSingleImageOptions(prefix, pageW, pageH) {
  const sizeSelect = document.getElementById(`${prefix}-target-size`);
  let targetSize = sizeSelect?.value || 'letter';
  const customW = parseFloat(document.getElementById(`${prefix}-custom-width`)?.value || '0') * 600;
  const customH = parseFloat(document.getElementById(`${prefix}-custom-height`)?.value || '0') * 600;
  const customRow = document.getElementById(`${prefix}-custom-size-row`);
  if (customRow) customRow.style.display = targetSize === 'custom' ? '' : 'none';

  const notes = [];
  let copiesValue = document.querySelector(`input[name="${prefix}-layout"]:checked`)?.value || '1up';

  // 1. Disable copies options that cannot fit unscaled; fall back to fewer
  //    copies per sheet when the selection is one of them.
  for (const { value, copies } of COPIES_ORDER) {
    const radio = document.querySelector(`input[name="${prefix}-layout"][value="${value}"]`);
    if (radio) radio.disabled = !singleImageFits(pageW, pageH, copies, targetSize, customW, customH);
  }
  const selectedCopies = { '1up': 1, '2up': 2, '4up': 4, '8up': 8 }[copiesValue] || 1;
  if (!singleImageFits(pageW, pageH, selectedCopies, targetSize, customW, customH)) {
    const fallback = COPIES_ORDER
      .filter(c => c.copies <= selectedCopies && singleImageFits(pageW, pageH, c.copies, targetSize, customW, customH))
      .pop();
    if (fallback) {
      const radio = document.querySelector(`input[name="${prefix}-layout"][value="${fallback.value}"]`);
      if (radio) radio.checked = true;
      notes.push(`${copiesValue} can't fit unscaled — switched to ${fallback.value}`);
      copiesValue = fallback.value;
    } else {
      notes.push(`${copiesValue} will be scaled down to fit`);
    }
  }

  // 2. Disable papers that cannot fit a single copy unscaled.
  const paperOptions = sizeSelect ? [...sizeSelect.options].filter(o => o.value !== 'custom') : [];
  for (const o of paperOptions) o.disabled = !singleImageFits(pageW, pageH, 1, o.value);
  if (targetSize !== 'custom' && !singleImageFits(pageW, pageH, 1, targetSize)) {
    const firstFit = paperOptions.find(o => !o.disabled);
    if (firstFit) {
      sizeSelect.value = firstFit.value;
      notes.push(`${targetSize} paper can't fit unscaled — switched to ${firstFit.value}`);
      targetSize = firstFit.value;
    }
  }

  // 3. Custom paper dimensions are validated, not disableable.
  let customWarning = null;
  if (targetSize === 'custom') {
    const copies = { '1up': 1, '2up': 2, '4up': 4, '8up': 8 }[copiesValue] || 1;
    const scale = calculateSingleImageLayout(pageW, pageH, copies, 'custom', customW, customH).scale;
    if (scale < 1 - FIT_EPSILON) {
      customWarning = `Custom paper too small — image would be scaled to ${Math.round(scale * 100)}%`;
    }
  }

  return { targetSize, copiesValue, customW, customH, notes, customWarning };
}

function applyExportButton(prefix, customWarning) {
  const btn = document.getElementById(prefix === 'export' ? 'btn-export-go' : 'btn-composite-go');
  if (btn) btn.disabled = !!customWarning;
  const info = document.getElementById(`${prefix}-layout-info`);
  if (info) info.style.color = customWarning ? 'red' : '';
}

function describeFit(scale, rotated, noun = 'pages') {
  const pct = Math.round(scale * 100);
  const base = pct >= 100 ? `${noun} at 100%` : `${noun} scaled to ${pct}%`;
  return rotated ? `${base}, rotated` : base;
}

export function updateExportLayoutInfo() {
  // The binding/booklet-layout rows only matter when there is more than one
  // page. The target-paper row applies to both single images and booklets.
  const isBooklet = State.pages.length > 1;
  const section = document.getElementById('export-imposition-section');
  if (section) section.style.display = isBooklet ? '' : 'none';
  const bindingRow = document.getElementById('export-binding-row');
  if (bindingRow) bindingRow.style.display = 'none';
  const layoutRow = document.getElementById('export-layout-row');
  if (layoutRow) layoutRow.style.display = isBooklet ? 'none' : '';

  const info = document.getElementById('export-layout-info');
  if (!info) return;

  // In spread view the canvas is two pages wide; layout calculation should use a single page.
  let pageW = CANVAS_W, pageH = CANVAS_H;
  if (State.spreadView && State.pageId) {
    const page = State.pages.find(p => p.id === State.pageId);
    if (page) { pageW = page.width; pageH = page.height; }
  }

  if (!isBooklet) {
    // Single image: the Layout radios choose copies per sheet, imposed onto
    // the target paper (upright, centered, stacked vertically when they fit).
    // Only copies and papers that fit unscaled are selectable.
    const { targetSize, copiesValue, customW, customH, notes, customWarning } =
      validateSingleImageOptions('export', pageW, pageH);
    applyExportButton('export', customWarning);
    const copies = { '1up': 1, '2up': 2, '4up': 4, '8up': 8 }[copiesValue] || 1;
    const layout = calculateSingleImageLayout(pageW, pageH, copies, targetSize, customW, customH);
    const orientation = layout.sheetW > layout.sheetH ? 'landscape' : 'portrait';
    let text = `${copies} per sheet, ${orientation}, ${describeFit(layout.scale, layout.imageRotated, 'image')}`;
    if (customWarning) text = customWarning;
    if (notes.length) text += ` — ${notes.join('; ')}`;
    info.textContent = text;
    return;
  }

  // Booklet: only (paper, layout) pairs that fit pages unscaled are offered.
  const { targetSize, bookletLayout, customW, customH, notes, customWarning } =
    validateBookletOptions('export', pageW, pageH);
  applyExportButton('export', customWarning);

  const layout = calculateBookletLayout(pageW, pageH, bookletLayout, targetSize, customW, customH);
  const orientation = layout.sheetW > layout.sheetH ? 'landscape' : 'portrait';
  const perSide = BOOKLET_PER_SIDE[bookletLayout];
  let text = `${State.pages.length} page booklet, ${bookletLayout}, ${perSide} per side, Interleaved, ${orientation}, ${describeFit(layout.scale, layout.pageRotated)}`;
  if (customWarning) text = customWarning;
  if (notes.length) text += ` — ${notes.join('; ')}`;
  info.textContent = text;
}

export function updateCompositeLayoutInfo() {
  const info = document.getElementById('composite-layout-info');

  // The single-page composite export renders the canvas at its own size and
  // ignores the target paper entirely — nothing to validate.
  if (State.pages.length <= 1) {
    applyExportButton('composite', null);
    if (info) info.textContent = '1 page, no imposition — target paper not used';
    return;
  }

  if (!info) return;

  // In spread view the canvas is two pages wide; layout calculation should use a single page.
  let pageW = CANVAS_W, pageH = CANVAS_H;
  if (State.spreadView && State.pageId) {
    const page = State.pages.find(p => p.id === State.pageId);
    if (page) { pageW = page.width; pageH = page.height; }
  }

  // Only (paper, layout) pairs that fit pages unscaled are offered.
  const { targetSize, bookletLayout, customW, customH, notes, customWarning } =
    validateBookletOptions('composite', pageW, pageH);
  applyExportButton('composite', customWarning);

  const layout = calculateBookletLayout(pageW, pageH, bookletLayout, targetSize, customW, customH);
  const orientation = layout.sheetW > layout.sheetH ? 'landscape' : 'portrait';
  const perSide = BOOKLET_PER_SIDE[bookletLayout];
  let text = `${State.pages.length} page booklet, ${bookletLayout}, ${perSide} per side, Interleaved, ${orientation}, ${describeFit(layout.scale, layout.pageRotated)}`;
  if (customWarning) text = customWarning;
  if (notes.length) text += ` — ${notes.join('; ')}`;
  info.textContent = text;
}

export async function showExportDialog() {
  const dimsText = State.spreadView
    ? `Exports the active spread as separate left/right pages at ${CANVAS_W}×${CANVAS_H} px (600 dpi). Each plate: black ink on white.`
    : `Exports one PNG per risograph color at ${CANVAS_W}×${CANVAS_H} px (600 dpi). Each plate: black ink on white.`;
  document.getElementById('export-dims-text').textContent = dimsText;

  // Default the imposition target paper to the project's saved choice.
  const targetSelect = document.getElementById('export-target-size');
  const savedTarget = State.project?.booklet?.targetSheetSize;
  if (targetSelect && savedTarget && [...targetSelect.options].some(o => o.value === savedTarget)) {
    targetSelect.value = savedTarget;
  }

  updateExportLayoutInfo();

  // Collect all plates across the project so the dialog preview is accurate
  // regardless of which page/spread is currently visible.
  const allLayerRecords = [];
  if (State.project?.id) {
    for (const pageId of State.project.pageOrder || []) {
      const recs = await DB.getByIndex('layers', 'by-page', pageId);
      allLayerRecords.push(...recs);
    }
  }
  // Fall back to visible layers on the current page if no project is loaded.
  const layersToInspect = allLayerRecords.length
    ? allLayerRecords.filter(r => r.visible !== false)
    : State.layers.filter(l => l.visible);

  // Collect all plates (solid colors + gradient stop colors + separation colors)
  const plateMap = new Map(); // hex → { name, layerCount }
  for (const l of layersToInspect) {
    if (l.isColorSeparation) {
      for (const c of l.separationColors || []) {
        if (!plateMap.has(c)) {
          const name = RISO_COLORS.find(rc => rc.hex === c)?.name || c;
          plateMap.set(c, { name, layerCount: 0, mode: 'separation' });
        }
        plateMap.get(c).layerCount++;
      }
    } else if (l.colorMode === 'gradient' && l.gradient?.stops?.length >= 2) {
      for (const stop of l.gradient.stops) {
        if (!plateMap.has(stop.color)) {
          const name = RISO_COLORS.find(c => c.hex === stop.color)?.name || stop.color;
          plateMap.set(stop.color, { name, layerCount: 0, mode: 'gradient' });
        }
        plateMap.get(stop.color).layerCount++;
      }
    } else if (l.colorMode === 'pattern' && l.pattern) {
      [l.pattern.color1, l.pattern.color2].forEach(c => {
        if (!plateMap.has(c)) {
          const name = RISO_COLORS.find(rc => rc.hex === c)?.name || c;
          plateMap.set(c, { name, layerCount: 0, mode: 'pattern' });
        }
        plateMap.get(c).layerCount++;
      });
    } else {
      if (!plateMap.has(l.color)) {
        const name = RISO_COLORS.find(c => c.hex === l.color)?.name || l.color;
        plateMap.set(l.color, { name, layerCount: 0, mode: 'solid' });
      }
      plateMap.get(l.color).layerCount++;
    }
  }
  const listEl = document.getElementById('export-color-list');
  listEl.innerHTML = plateMap.size
    ? [...plateMap.entries()].map(([hex, info]) => {
        const label = info.mode !== 'solid' ? `${info.name} (${info.mode})` : info.name;
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="width:14px;height:14px;background:${hex};border:1px solid rgba(0,0,0,0.28);border-radius:2px;flex-shrink:0;"></div>
          <span>${label} — ${info.layerCount} layer(s)</span></div>`;
      }).join('')
    : '<p>No visible layers to export.</p>';
  document.getElementById('export-progress').textContent = '';
  document.getElementById('btn-export-go').disabled = false;
  document.getElementById('export-dialog').classList.remove('hidden');
}

export function showCompositeExportDialog() {
  const dimsText = State.spreadView
    ? `Renders the active spread as separate left/right pages at ${CANVAS_W}×${CANVAS_H} px with subtractive ink mixing (riso simulation).`
    : State.pages.length > 1
      ? `Renders all ${State.pages.length} pages as full-color composites and imposes them into printer-ready booklet sheets.`
      : `Renders all visible layers at ${CANVAS_W}×${CANVAS_H} px with subtractive ink mixing (riso simulation).`;
  document.getElementById('composite-dims-text').textContent = dimsText;
  updateCompositeLayoutInfo();
  document.getElementById('composite-export-progress').textContent = '';
  document.getElementById('btn-composite-go').disabled = false;
  document.getElementById('composite-export-dialog').classList.remove('hidden');
}
