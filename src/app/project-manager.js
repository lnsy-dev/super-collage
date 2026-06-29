/* ═══════════════════════════════════════════════════════════════════
   Project Manager
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { ExportEngine } from './export-engine.js';
import { CANVAS_W, CANVAS_H, PAGE_SIZE_DIMS, setCanvasSize, RISO_COLORS } from './constants.js';
import { PageManager } from './page-manager.js';
import { calculateLayout } from './imposition.js';
import { computeViewUnits } from './spread-manager.js';

export let _selProjectId = null;

export function showProjectDialog() {
  document.getElementById('project-dialog').classList.remove('hidden');
  // The dialog is only cancellable when a project is already open; otherwise
  // there is nothing to return to, so keep it modal (no close affordance).
  document.getElementById('btn-close-project-dialog').style.display = State.project ? '' : 'none';
  loadProjectList();
}

export function hideProjectDialog() {
  // Only allow dismissing when a project is open behind the dialog.
  if (!State.project) return;
  document.getElementById('project-dialog').classList.add('hidden');
}

export async function loadProjectList() {
  _selProjectId = null;
  document.getElementById('btn-open-project').disabled = true;
  const projects = (await DB.getAll('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  if (!projects.length) {
    list.innerHTML = '<div class="project-entry" style="color:var(--dark-gray);justify-content:center;">No projects yet</div>';
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

  // Load the first editor unit (spread or single page).
  const units = computeViewUnits(project.pageOrder, project.booklet?.binding);
  const firstUnit = units[0];
  if (firstUnit) {
    await PageManager.loadUnit(firstUnit.id);
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
  const pageSizeLabels = { 'letter': '8.5" × 11"', 'legal': '8.5" × 14"', 'half-letter': '5.5" × 8.5"', '4x6': '4" × 6"', '4.25x7': '4.25" × 7"', 'manga': '5.04" × 7.17"', 'business-card': '3.5" × 2"' };
  let sizeLabel = pageSizeLabels[project.pageSize];
  let dims = PAGE_SIZE_DIMS[project.pageSize];
  if (project.pageSize === 'custom' && project.customW && project.customH) {
    dims = { w: project.customW, h: project.customH };
    const fmt = px => { const v = px / 600; return (Math.round(v * 100) / 100).toString(); };
    sizeLabel = `${fmt(project.customW)}" × ${fmt(project.customH)}"`;
  }
  if (!sizeLabel) sizeLabel = '8.5" × 11"';
  if (!dims) dims = PAGE_SIZE_DIMS['letter'];
  let { w, h } = dims;
  if (project.orientation === 'landscape' && h > w) [w, h] = [h, w];
  return { w, h, sizeLabel };
}

function _setProjectCanvasSize(project) {
  const { w, h } = _resolveProjectDims(project);
  setCanvasSize(w, h);
}

export function updateExportLayoutInfo() {
  const targetSize = document.getElementById('export-target-size')?.value || 'letter';
  const customRow = document.getElementById('export-custom-size-row');
  if (customRow) {
    customRow.style.display = targetSize === 'custom' ? '' : 'none';
  }

  const binding = document.querySelector('input[name="export-binding"]:checked')?.value || 'saddle-stitch';
  const bookletRow = document.getElementById('export-booklet-layout-row');
  if (bookletRow) bookletRow.style.display = '';

  const info = document.getElementById('export-layout-info');
  if (!info) return;

  const customW = parseFloat(document.getElementById('export-custom-width')?.value || '0') * 600;
  const customH = parseFloat(document.getElementById('export-custom-height')?.value || '0') * 600;

  // In spread view the canvas is two pages wide; layout calculation should use a single page.
  let pageW = CANVAS_W, pageH = CANVAS_H;
  if (State.spreadView && State.pageId) {
    const page = State.pages.find(p => p.id === State.pageId);
    if (page) { pageW = page.width; pageH = page.height; }
  }
  const layout = calculateLayout(pageW, pageH, targetSize, customW, customH);
  const orientation = layout.sheetW > layout.sheetH ? 'landscape' : 'portrait';

  const bookletLayout = document.querySelector('input[name="export-booklet-layout"]:checked')?.value || 'folio';
  const perSide = bookletLayout === 'folio' ? 2 : bookletLayout === 'quarto' ? 4 : 8;
  info.textContent = `${State.pages.length} page booklet, ${bookletLayout}, ${perSide} per side, Interleaved, ${orientation}`;
}

export function updateCompositeLayoutInfo() {
  const targetSize = document.getElementById('composite-target-size')?.value || 'letter';
  const customRow = document.getElementById('composite-custom-size-row');
  if (customRow) {
    customRow.style.display = targetSize === 'custom' ? '' : 'none';
  }

  const info = document.getElementById('composite-layout-info');
  if (!info) return;

  const customW = parseFloat(document.getElementById('composite-custom-width')?.value || '0') * 600;
  const customH = parseFloat(document.getElementById('composite-custom-height')?.value || '0') * 600;

  // In spread view the canvas is two pages wide; layout calculation should use a single page.
  let pageW = CANVAS_W, pageH = CANVAS_H;
  if (State.spreadView && State.pageId) {
    const page = State.pages.find(p => p.id === State.pageId);
    if (page) { pageW = page.width; pageH = page.height; }
  }
  const layout = calculateLayout(pageW, pageH, targetSize, customW, customH);
  const orientation = layout.sheetW > layout.sheetH ? 'landscape' : 'portrait';

  const bookletLayout = document.querySelector('input[name="composite-booklet-layout"]:checked')?.value || 'folio';
  const perSide = bookletLayout === 'folio' ? 2 : bookletLayout === 'quarto' ? 4 : 8;
  info.textContent = `${State.pages.length} page booklet, ${bookletLayout}, ${perSide} per side, Interleaved, ${orientation}`;
}

export async function showExportDialog() {
  const dimsText = State.spreadView
    ? `Exports the active spread as separate left/right pages at ${CANVAS_W}×${CANVAS_H} px (600 dpi). Each plate: black ink on white.`
    : `Exports one PNG per risograph color at ${CANVAS_W}×${CANVAS_H} px (600 dpi). Each plate: black ink on white.`;
  document.getElementById('export-dims-text').textContent = dimsText;
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
          <div style="width:14px;height:14px;background:${hex};border:1px solid #000;flex-shrink:0;"></div>
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
