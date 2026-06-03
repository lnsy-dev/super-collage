/* ═══════════════════════════════════════════════════════════════════
   Project Manager
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { Layer } from './layer.js';
import { ImageProcessor } from './image-processor.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { ExportEngine } from './export-engine.js';
import { CANVAS_W, CANVAS_H, PAGE_SIZE_DIMS, setCanvasSize, RISO_COLORS } from './constants.js';
import { hexToRgb } from '../utils/color.js';
import { MaskEngine } from './mask-engine.js';

export let _selProjectId = null;

export function showProjectDialog() {
  document.getElementById('project-dialog').classList.remove('hidden');
  loadProjectList();
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
  State.project = project;
  State.layers = [];
  State.selectedId = null;
  State.selectedIds = [];
  State.undoStack = [];
  State.redoStack = [];

  const layerRecords = await DB.getByIndex('layers', 'by-project', projectId);
  const order = project.layerOrder || [];
  layerRecords.sort((a, b) => {
    const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const rec of layerRecords) {
    const layer = Layer.fromRecord(rec);
    const imgRec = await DB.get('imageBlobs', layer.id);
    if (imgRec?.blob) {
      if (layer.isSvg) {
        const text = await imgRec.blob.text();
        layer._svgText = text;
        const svgBlob = new Blob([text], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        URL.revokeObjectURL(url);
        layer._svgImage = img;
      } else if (layer.isColorSeparation) {
        const bmp = await createImageBitmap(imgRec.blob);
        const nw = layer.naturalWidth, nh = layer.naturalHeight;
        const sourceCanvas = new OffscreenCanvas(nw, nh);
        const sCtx = sourceCanvas.getContext('2d');
        sCtx.fillStyle = 'white';
        sCtx.fillRect(0, 0, nw, nh);
        sCtx.drawImage(bmp, 0, 0);
        bmp.close();
        layer._originalCanvas = sourceCanvas;

        const imageData = sCtx.getImageData(0, 0, nw, nh);
        const risoColors = [];
        for (const rc of RISO_COLORS) {
          if (rc.hex === '#FFFFFF') continue;
          const { r, g, b } = hexToRgb(rc.hex);
          risoColors.push(r, g, b);
        }
        const plateBuffer = window.separateColorsWithLut(imageData.data, nw, nh, window.colorSepLut, 16);
        const pixelCount = nw * nh;
        const numPlates = RISO_COLORS.length - 1;
        const separationColors = RISO_COLORS.filter(c => c.hex !== '#FFFFFF').map(c => c.hex);
        for (let i = 0; i < numPlates; i++) {
          const plateCanvas = new OffscreenCanvas(nw, nh);
          const pCtx = plateCanvas.getContext('2d');
          const plateData = new ImageData(
            new Uint8ClampedArray(plateBuffer.buffer, i * pixelCount * 4, pixelCount * 4),
            nw, nh
          );
          pCtx.putImageData(plateData, 0, 0);
          layer.separationPlates.set(separationColors[i], plateCanvas);
        }
      } else {
        const bmp = await createImageBitmap(imgRec.blob);
        const orig = new OffscreenCanvas(layer.naturalWidth, layer.naturalHeight);
        const ctx = orig.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, layer.naturalWidth, layer.naturalHeight);
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        layer._originalCanvas = orig;
      }
    }
    const maskRec = await DB.get('maskBlobs', layer.id);
    if (maskRec?.blob) {
      await MaskEngine.loadMask(layer, maskRec.blob);
    } else {
      MaskEngine.initMask(layer);
    }
    layer._dirty = true;
    State.layers.push(layer);
  }

  document.getElementById('main-app').style.display = 'flex';
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
  setCanvasSize(dims.w, dims.h);
  if (project.orientation === 'landscape' && CANVAS_H > CANVAS_W) { setCanvasSize(CANVAS_H, CANVAS_W); }
  if (project.orientation === 'portrait'  && CANVAS_W > CANVAS_H) { setCanvasSize(CANVAS_H, CANVAS_W); }
  document.getElementById('canvas-title').textContent = `${project.name} — ${sizeLabel} @ 600dpi`;
  document.getElementById('status-project').textContent = project.name;
  document.getElementById('no-layer-msg').style.display = State.layers.length ? 'none' : '';

  UI.fitZoom();
  UI.refreshOrientation();
  UI.refreshLayerList();
  UI.refreshProperties();
  Renderer.schedule();
}

export function showExportDialog() {
  document.getElementById('export-dims-text').textContent = `Exports one PNG per risograph color at ${CANVAS_W}×${CANVAS_H} px (600 dpi). Each plate: black ink on white.`;
  const visibleLayers = State.layers.filter(l => l.visible);
  // Collect all plates (solid colors + gradient stop colors)
  const plateMap = new Map(); // hex → { name, layerCount }
  for (const l of visibleLayers) {
    if (l.isColorSeparation) {
      for (const c of l.separationColors) {
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
  document.getElementById('composite-dims-text').textContent = `Renders all visible layers at ${CANVAS_W}×${CANVAS_H} px with subtractive ink mixing (riso simulation).`;
  document.getElementById('composite-export-progress').textContent = '';
  document.getElementById('btn-composite-go').disabled = false;
  document.getElementById('composite-export-dialog').classList.remove('hidden');
}
