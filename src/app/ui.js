/* ═══════════════════════════════════════════════════════════════════
   UI
   ═══════════════════════════════════════════════════════════════════ */

import { State, selectedLayer } from './state.js';
import { RISO_COLORS, CANVAS_W, CANVAS_H } from './constants.js';
import { Renderer } from './renderer.js';
import { DB } from './db.js';
import { pushUndo, snapshotLayer } from './undo.js';
import { computeViewUnits } from './spread-manager.js';
import { hasItalic } from 'type-set';

const FONT_WEIGHTS = {
  'IBM Plex Serif':        [100, 200, 300, 400, 500, 600, 700],
  'IBM Plex Sans':         [100, 200, 300, 400, 500, 600, 700],
  'Crimson Text':          [400, 600, 700],
  'Fira Code':             [300, 400, 500, 600, 700],
  'League Gothic':         [400],
  'Atkinson Hyperlegible': [400, 700],
  'Cormorant Garamond':    [300, 400, 500, 600, 700],
  'EB Garamond':           [400, 500, 600, 700, 800],
  'Spectral':              [200, 300, 400, 500, 600, 700, 800],
  'UnifrakturMaguntia':    [400],
};
const WEIGHT_NAMES = { 100:'Thin', 200:'ExtraLight', 300:'Light', 400:'Regular', 500:'Medium', 600:'SemiBold', 700:'Bold', 800:'ExtraBold', 900:'Black' };

export function populateVariantSelect(font, currentWeight, currentStyle) {
  const sel = document.getElementById('prop-text-variant');
  if (!sel) return;
  const weights = FONT_WEIGHTS[font] ?? [100,200,300,400,500,600,700,800,900];
  const variants = [];
  weights.forEach(w => {
    variants.push({ weight: w, style: 'normal', label: `${w} – ${WEIGHT_NAMES[w]}` });
  });
  if (hasItalic(font)) {
    weights.forEach(w => {
      variants.push({ weight: w, style: 'italic', label: `${w} – ${WEIGHT_NAMES[w]} Italic` });
    });
  }
  sel.innerHTML = variants.map(v =>
    `<option value="${v.weight}:${v.style}">${v.label}</option>`
  ).join('');

  const style = hasItalic(font) ? (currentStyle || 'normal') : 'normal';
  let match = variants.find(v => v.weight === currentWeight && v.style === style);
  if (!match) {
    match = variants.filter(v => v.style === 'normal').reduce((a, b) =>
      Math.abs(b.weight - currentWeight) < Math.abs(a.weight - currentWeight) ? b : a
    );
  }
  sel.value = `${match.weight}:${match.style}`;
}

export function appendKofiNotice(parentEl) {
  const existing = parentEl.querySelector('.kofi-notice');
  if (existing) existing.remove();
  const notice = document.createElement('div');
  notice.className = 'kofi-notice';
  notice.style.cssText = 'margin-top:8px;font-size:9px;text-align:center;line-height:1.6;';
  notice.innerHTML = 'Enjoying Super Collage? <a href="https://ko-fi.com/lnsy47369" target="_blank" rel="noopener" style="color:#000;text-decoration:underline;">Support me on Ko-fi</a>';
  parentEl.appendChild(notice);
}

export function showKofiToast() {
  const existing = document.querySelector('.kofi-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'kofi-toast';
  toast.style.cssText = 'position:fixed;bottom:44px;left:50%;transform:translateX(-50%);background:#fff;border:2px solid #000;padding:8px 16px;box-shadow:2px 2px 0 #000;font-size:9px;z-index:9999;text-align:center;white-space:nowrap;';
  toast.innerHTML = 'Enjoying Super Collage? <a href="https://ko-fi.com/lnsy47369" target="_blank" rel="noopener" style="color:#000;text-decoration:underline;">Support me on Ko-fi</a>';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

export function renderGradientBar(layer) {
  const canvas = document.getElementById('gradient-bar-canvas');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth || 160;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const stops = layer.gradient.stops;
  const barGrad = ctx.createLinearGradient(0, 0, w, 0);
  stops.forEach(s => barGrad.addColorStop(Math.max(0, Math.min(1, s.position)), s.color));
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, 0, w, h);
  // Draw stop handles
  stops.forEach(s => {
    const x = s.position * w;
    ctx.beginPath();
    ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, h);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

export function refreshGradientEditor(layer) {
  const isGradient = layer && layer.colorMode === 'gradient';
  document.getElementById('btn-mode-solid')?.classList.toggle('active', !layer || layer.colorMode === 'solid');
  document.getElementById('btn-mode-gradient')?.classList.toggle('active', isGradient);
  const swatches = document.getElementById('color-swatches');
  const editor = document.getElementById('gradient-editor');
  if (!swatches || !editor) return;
  swatches.style.display = (!layer || layer.colorMode === 'solid') ? '' : 'none';
  if (!isGradient) { editor.classList.add('hidden'); return; }
  editor.classList.remove('hidden');

  const g = layer.gradient;
  document.querySelectorAll('.grad-type-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.gradType === g.type));

  const showAngle = g.type === 'linear' || g.type === 'conic';
  const showCenter = g.type === 'circular' || g.type === 'conic';
  const showMulti = g.type === 'multipolar';
  document.getElementById('grad-angle-row').style.display = showAngle ? '' : 'none';
  document.getElementById('grad-center-row').style.display = (showCenter && !showMulti) ? '' : 'none';

  const angleEl = document.getElementById('grad-angle');
  if (angleEl) { angleEl.value = g.angle || 0; document.getElementById('val-grad-angle').textContent = (g.angle || 0) + '°'; }
  const cxEl = document.getElementById('grad-cx');
  if (cxEl) { cxEl.value = Math.round((g.centerX ?? 0.5) * 100); }
  const cyEl = document.getElementById('grad-cy');
  if (cyEl) { cyEl.value = Math.round((g.centerY ?? 0.5) * 100); }

  // Rebuild stop list
  const list = document.getElementById('gradient-stop-list');
  list.innerHTML = '';
  g.stops.forEach((stop, idx) => {
    const wrapper = document.createElement('div');
    // Header row: color swatch + position label + remove button
    const row = document.createElement('div');
    row.className = 'gradient-stop-row';
    const swatch = document.createElement('div');
    swatch.className = 'stop-swatch';
    swatch.style.background = stop.color;
    const posLabel = document.createElement('span');
    posLabel.style.flex = '1';
    posLabel.textContent = Math.round(stop.position * 100) + '%';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'stop-remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.dataset.stopIdx = idx;
    if (g.stops.length <= 2) removeBtn.disabled = true;
    row.append(swatch, posLabel, removeBtn);
    // Riso color picker row
    const risoRow = document.createElement('div');
    risoRow.className = 'stop-riso-swatches';
    RISO_COLORS.forEach(rc => {
      const sw = document.createElement('div');
      sw.className = 'stop-riso-sw' + (rc.hex === stop.color ? ' selected' : '');
      sw.style.background = rc.hex;
      if (rc.hex === '#FFFFFF') sw.style.borderColor = 'var(--black)';
      sw.title = rc.name;
      sw.dataset.stopIdx = idx;
      sw.dataset.risoColor = rc.hex;
      risoRow.appendChild(sw);
    });
    wrapper.append(row, risoRow);
    list.appendChild(wrapper);
  });

  renderGradientBar(layer);
}

export function refreshPatternEditor(layer) {
  const isPattern = layer && layer.colorMode === 'pattern';
  document.getElementById('btn-mode-pattern')?.classList.toggle('active', isPattern);
  const editor = document.getElementById('pattern-editor');
  if (!editor) return;
  if (!isPattern) { editor.classList.add('hidden'); return; }
  editor.classList.remove('hidden');

  const p = layer.pattern;
  document.querySelectorAll('.pat-type-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.patType === p.type));

  const buildSwatches = (containerId, selectedColor, colorKey) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    RISO_COLORS.forEach(rc => {
      const sw = document.createElement('div');
      sw.className = 'pat-color-sw' + (rc.hex === selectedColor ? ' selected' : '');
      sw.style.background = rc.hex;
      if (rc.hex === '#FFFFFF') sw.style.borderColor = 'var(--black)';
      sw.title = rc.name;
      sw.dataset.patColor = rc.hex;
      sw.dataset.patColorKey = colorKey;
      container.appendChild(sw);
    });
  };
  buildSwatches('pat-color1-swatches', p.color1, 'color1');
  buildSwatches('pat-color2-swatches', p.color2, 'color2');

  const sizeEl = document.getElementById('pat-size');
  if (sizeEl) { sizeEl.value = p.size || 20; document.getElementById('val-pat-size').textContent = p.size || 20; }
  const angleEl = document.getElementById('pat-angle');
  if (angleEl) { angleEl.value = p.angle || 0; document.getElementById('val-pat-angle').textContent = (p.angle || 0) + '°'; }
}

export const UI = {
  refreshLayerList() {
    const list = document.getElementById('layer-list');
    list.innerHTML = '';
    if (!State.layers.length) {
      list.innerHTML = '<div style="padding:8px;font-size:8px;color:var(--dark-gray);text-align:center;">No layers</div>';
      return;
    }
    for (let i = State.layers.length - 1; i >= 0; i--) {
      const l = State.layers[i];
      let rowClass = 'layer-row';
      if (State.selectedIds.includes(l.id)) rowClass += ' selected';
      if (l.isMaskFor)          rowClass += ' layer-row--mask';
      if (l.imageMaskIds?.length) rowClass += ' layer-row--masked';
      if (l.locked)      rowClass += ' locked-row';
      const row = document.createElement('div');
      row.className = rowClass;
      row.draggable = !l.locked;
      row.dataset.layerId = l.id;

      const vis = document.createElement('span');
      vis.className = 'layer-vis';
      vis.textContent = l.visible ? '◉' : '○';
      vis.addEventListener('click', e => {
        e.stopPropagation();
        pushUndo(snapshotLayer(l));
        l.visible = !l.visible;
        DB.saveLayer(l);
        this.refreshLayerList();
        Renderer.schedule();
      });

      const dot = document.createElement('div');
      dot.className = 'layer-color-dot';
      if (l.isColorSeparation) {
        const stopsStr = l.separationColors.map((c, i) => `${c} ${Math.round(i / (l.separationColors.length - 1) * 100)}%`).join(', ');
        dot.style.background = `linear-gradient(to right, ${stopsStr})`;
      } else if (l.colorMode === 'gradient' && l.gradient?.stops?.length >= 2) {
        const stopsStr = l.gradient.stops.map(s => `${s.color} ${Math.round(s.position * 100)}%`).join(', ');
        dot.style.background = `linear-gradient(to right, ${stopsStr})`;
      } else if (l.colorMode === 'pattern' && l.pattern) {
        const p = l.pattern;
        if (p.type === 'stripes') {
          dot.style.background = `repeating-linear-gradient(${(p.angle || 0) + 90}deg, ${p.color1}, ${p.color1} ${p.size/2}px, ${p.color2} ${p.size/2}px, ${p.color2} ${p.size}px)`;
        } else {
          dot.style.background = p.color1;
        }
      } else {
        dot.style.background = l.color;
      }

      const name = document.createElement('div');
      name.className = 'layer-name';
      const prefix = l.isText ? 'T ' : l.isMaskFor ? '⬦ ' : '';
      name.textContent = prefix + l.name;
      name.addEventListener('dblclick', e => {
        e.stopPropagation();
        const n = prompt('Layer name:', l.name);
        if (n?.trim()) { pushUndo(snapshotLayer(l)); l.name = n.trim(); DB.saveLayer(l); this.refreshLayerList(); }
      });

      const lock = document.createElement('span');
      lock.className = 'layer-lock' + (l.locked ? ' locked' : '');
      lock.textContent = l.locked ? '🔒' : '🔓';
      lock.title = l.locked ? 'Unlock layer' : 'Lock layer';
      lock.addEventListener('click', e => {
        e.stopPropagation();
        pushUndo(snapshotLayer(l));
        l.locked = !l.locked;
        if (l.locked && State.selectedIds.includes(l.id)) {
          State.selectedIds = State.selectedIds.filter(id => id !== l.id);
          State.selectedId = State.selectedIds[State.selectedIds.length - 1] || null;
          UI.refreshProperties();
          Renderer.drawOverlay();
        }
        DB.saveLayer(l);
        this.refreshLayerList();
      });

      row.append(vis, lock, dot, name);
      row.addEventListener('click', e => {
        if (UI._suppressLayerClick) return;
        if (l.locked) return;
        if (e.shiftKey) {
          const idx = State.selectedIds.indexOf(l.id);
          if (idx === -1) {
            State.selectedIds.push(l.id);
            State.selectedId = l.id;
          } else {
            State.selectedIds.splice(idx, 1);
            State.selectedId = State.selectedIds[State.selectedIds.length - 1] || null;
          }
        } else {
          State.selectedId = l.id;
          State.selectedIds = [l.id];
        }
        this.refreshLayerList();
        this.refreshProperties();
        Renderer.drawOverlay();
      });
      list.appendChild(row);
    }

    const splitBtn = document.getElementById('btn-split-color-separation');
    if (splitBtn) {
      const sel = selectedLayer();
      splitBtn.style.display = (sel && sel.isColorSeparation) ? '' : 'none';
    }
  },

  refreshPageList() {
    const list = document.getElementById('page-list');
    if (!list) return;
    list.innerHTML = '';
    const pages = State.pages || [];

    if (!pages.length) {
      list.innerHTML = '<div style="padding:8px;font-size:8px;color:var(--dark-gray);text-align:center;">No pages</div>';
      return;
    }

    const units = computeViewUnits(State.project.pageOrder, State.project.booklet?.binding);
    const pageById = new Map(pages.map(p => [p.id, p]));

    for (const unit of units) {
      const row = document.createElement('div');
      row.className = 'page-row' + (unit.id === State.unitId ? ' selected' : '');
      row.dataset.unitId = unit.id;
      row.draggable = true;

      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';

      const name = document.createElement('div');
      name.className = 'page-name';

      if (unit.type === 'spread') {
        const leftPage = pageById.get(unit.leftPageId);
        const rightPage = pageById.get(unit.rightPageId);
        const aspect = (leftPage?.width || 1) / (leftPage?.height || 1);
        thumb.style.width = Math.min(24, Math.round(24 * aspect * 2)) + 'px';
        thumb.style.height = Math.min(24, Math.round(18 / aspect)) + 'px';
        name.textContent = `${leftPage?.name || ''} + ${rightPage?.name || ''}`;
        name.addEventListener('dblclick', e => {
          e.stopPropagation();
          const target = leftPage;
          const n = prompt('Page name:', target?.name || '');
          if (n?.trim() && target) {
            window.PageManager.renamePage(target.id, n.trim()).then(() => {
              target.name = n.trim();
              this.refreshPageList();
            });
          }
        });
      } else {
        const page = pageById.get(unit.pageId);
        const aspect = (page?.width || 1) / (page?.height || 1);
        thumb.style.width = Math.min(18, Math.round(24 * aspect)) + 'px';
        thumb.style.height = Math.min(24, Math.round(18 / aspect)) + 'px';
        name.textContent = page?.name || '';
        name.addEventListener('dblclick', e => {
          e.stopPropagation();
          const target = page;
          const n = prompt('Page name:', target?.name || '');
          if (n?.trim() && target) {
            window.PageManager.renamePage(target.id, n.trim()).then(() => {
              target.name = n.trim();
              this.refreshPageList();
            });
          }
        });
      }

      const meta = document.createElement('div');
      meta.className = 'page-spread-meta';
      meta.style.cssText = 'margin-left:auto;font-size:7px;color:var(--dark-gray);';
      meta.textContent = unit.type === 'spread' ? 'S' : '';

      row.append(thumb, name, meta);
      row.addEventListener('click', () => {
        window.PageManager.loadUnit(unit.id).then(() => this.refreshPageList());
      });
      list.appendChild(row);
    }

    const isBooklet = State.project?.booklet?.binding === 'saddle-stitch';
    const addFolioBtn = document.querySelector('[data-action="add-folio"]');
    const removeFolioBtn = document.querySelector('[data-action="remove-folio"]');
    if (addFolioBtn) addFolioBtn.style.display = isBooklet ? '' : 'none';
    if (removeFolioBtn) {
      removeFolioBtn.style.display = isBooklet ? '' : 'none';
      removeFolioBtn.disabled = !isBooklet || (State.project?.pageOrder?.length || 0) < 4;
    }
  },

  _folioThumbUrls: [],
  _selectedFolioPageIds: null,

  async showRemoveFolioDialog() {
    const dialog = document.getElementById('remove-folio-dialog');
    if (!dialog) return;
    this._selectedFolioPageIds = null;
    document.getElementById('btn-confirm-remove-folio').disabled = true;
    await this._refreshFolioChooser();
    dialog.classList.remove('hidden');
  },

  hideRemoveFolioDialog() {
    const dialog = document.getElementById('remove-folio-dialog');
    if (dialog) dialog.classList.add('hidden');
    for (const url of this._folioThumbUrls) URL.revokeObjectURL(url);
    this._folioThumbUrls = [];
    this._selectedFolioPageIds = null;
  },

  async _refreshFolioChooser() {
    const list = document.getElementById('folio-list');
    if (!list) return;
    list.innerHTML = '';
    for (const url of this._folioThumbUrls) URL.revokeObjectURL(url);
    this._folioThumbUrls = [];

    const order = State.project?.pageOrder || [];
    if (order.length < 4) {
      list.innerHTML = '<div style="padding:8px;font-size:8px;color:var(--dark-gray);text-align:center;">Not enough pages to remove a folio.</div>';
      return;
    }

    const pageById = new Map(State.pages.map(p => [p.id, p]));
    const groups = [];
    for (let i = 0; i < order.length; i += 4) {
      groups.push(order.slice(i, i + 4));
    }

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const row = document.createElement('div');
      row.className = 'folio-row';
      row.dataset.pageIds = group.join(',');

      const label = document.createElement('div');
      label.className = 'folio-label';
      label.textContent = `Folio ${gi + 1}`;
      row.appendChild(label);

      const thumbs = document.createElement('div');
      thumbs.className = 'folio-thumbs';

      for (const pageId of group) {
        const page = pageById.get(pageId);
        const thumb = document.createElement('img');
        thumb.className = 'folio-thumb';
        thumb.alt = page?.name || pageId;
        thumb.src = await window.PageManager.renderPageThumbnail(pageId, 48, 64);
        this._folioThumbUrls.push(thumb.src);
        thumbs.appendChild(thumb);
      }

      const names = document.createElement('div');
      names.className = 'folio-names';
      names.textContent = group.map(id => pageById.get(id)?.name || id).join(', ');

      row.appendChild(thumbs);
      row.appendChild(names);
      row.addEventListener('click', () => {
        list.querySelectorAll('.folio-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        this._selectedFolioPageIds = group;
        document.getElementById('btn-confirm-remove-folio').disabled = false;
      });
      list.appendChild(row);
    }
  },

  confirmRemoveFolio() {
    return this._selectedFolioPageIds;
  },

  refreshProperties() {
    const layer = selectedLayer();
    document.getElementById('no-selection-msg').style.display = layer ? 'none' : '';
    document.getElementById('layer-props').style.display = layer ? '' : 'none';
    if (!layer) { document.getElementById('status-layer').textContent = '—'; return; }

    document.getElementById('prop-x').value   = Math.round(layer.x);
    document.getElementById('prop-y').value   = Math.round(layer.y);
    document.getElementById('prop-w').value   = Math.round(layer.width);
    document.getElementById('prop-h').value   = Math.round(layer.height);
    document.getElementById('prop-rot').value = Math.round(layer.rotation);

    // Show/hide text vs image controls
    const textProps = document.getElementById('text-props');
    const imageSection = document.querySelector('#layer-props .prop-section:has(#prop-brightness)');
    const halftoneSection = document.querySelector('#layer-props .prop-section:has(.halftone-opts)');
    if (textProps) textProps.style.display = layer.isText ? '' : 'none';
    if (imageSection) imageSection.style.display = layer.isText ? 'none' : '';
    if (halftoneSection) halftoneSection.style.display = layer.isText ? 'none' : '';

    if (layer.isText) {
      document.getElementById('prop-text').value = layer.text;
      document.getElementById('prop-text-font').value = layer.textFontFamily;
      document.getElementById('prop-text-size').value = layer.textFontSize;
      document.getElementById('prop-text-size-range').value = layer.textFontSize;
      populateVariantSelect(layer.textFontFamily, layer.textFontWeight, layer.textFontStyle);
      document.getElementById('prop-text-spacing').value = layer.textLetterSpacing;
      document.getElementById('prop-text-leading').value = layer.textLineHeight;
      document.getElementById('prop-text-align').value = layer.textAlign;
    }

    const setRange = (id, valId, val) => {
      document.getElementById(id).value = val;
      document.getElementById(valId).textContent = val;
    };
    setRange('prop-brightness', 'val-brightness', layer.brightness);
    setRange('prop-contrast',   'val-contrast',   layer.contrast);
    document.getElementById('btn-invert-image').classList.toggle('active', layer.invert);
    setRange('prop-halftone-size', 'val-halftone-size', layer.halftoneSize);
    setRange('prop-halftone-angle', 'val-halftone-angle', layer.halftoneAngle);

    const isGrayscale = layer.halftoneType === 'grayscale';
    document.getElementById('halftone-size-row').classList.toggle('hidden', isGrayscale);
    document.getElementById('halftone-angle-row')?.classList.toggle('hidden', isGrayscale);

    document.querySelectorAll('.halftone-opt').forEach(b =>
      b.classList.toggle('active', b.dataset.halftone === layer.halftoneType));
    document.querySelectorAll('.color-swatch').forEach(s =>
      s.classList.toggle('selected', s.dataset.color === layer.color));

    refreshGradientEditor(layer);
    refreshPatternEditor(layer);
    document.getElementById('status-layer').textContent = layer.name;

    // Hide color picker UI for color-separation layers
    const colorSection = document.querySelector('#properties-content .prop-section:has(#color-swatches)');
    if (colorSection) {
      colorSection.style.display = layer.isColorSeparation ? 'none' : '';
    }

    // Image mask buttons
    const createMaskBtn = document.getElementById('btn-create-image-mask');
    const createDiffMaskBtn = document.getElementById('btn-create-difference-mask');
    const releaseMaskBtn = document.getElementById('btn-release-image-mask');
    const imageMaskRow = document.getElementById('image-mask-row');
    const [selA, selB] = State.selectedIds.map(id => State.layers.find(x => x.id === id));
    const alreadyLinked = selA && selB && (
      (selA.imageMaskIds || []).includes(selB.id) ||
      (selB.imageMaskIds || []).includes(selA.id)
    );
    const canCreate = State.selectedIds.length === 2 &&
      selA && selB &&
      !selA.isMaskFor && !selB.isMaskFor &&
      !alreadyLinked;
    createMaskBtn.style.display = canCreate ? '' : 'none';
    createDiffMaskBtn.style.display = canCreate ? '' : 'none';
    releaseMaskBtn.style.display = layer.isMaskFor ? '' : 'none';
    imageMaskRow.style.display = (canCreate || layer.isMaskFor) ? '' : 'none';
  },

  refreshZoom() {
    const pct = Math.round(State.zoom * 100) + '%';
    document.getElementById('zoom-display').textContent = pct;
    document.getElementById('status-zoom').textContent = pct;
  },

  setTool(tool) {
    State.tool = tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === tool));
    document.body.className = 'tool-' + tool;
    const names = {
      select: 'Select', move: 'Move',
      'mask-draw': 'Mask Draw', 'mask-erase': 'Mask Erase',
      'shape-rect': 'Rectangle', 'shape-ellipse': 'Ellipse', 'shape-poly': 'Polygon',
    };
    document.getElementById('status-tool').textContent = names[tool] || tool;
    const isShape = tool.startsWith('shape-');
    document.getElementById('shape-options').style.display = isShape ? '' : 'none';
    document.getElementById('poly-options').style.display = (tool === 'shape-poly') ? '' : 'none';
    const isMask = tool === 'mask-draw' || tool === 'mask-erase';
    if (!isMask) document.getElementById('brush-cursor').style.display = 'none';
  },

  fitZoom() {
    const scroll = document.getElementById('canvas-scroll');
    const z = Math.min((scroll.clientWidth - 24) / CANVAS_W, (scroll.clientHeight - 24) / CANVAS_H);
    State.zoom = Math.max(0.04, Math.min(2, z));
    Renderer.resize();
    this.refreshZoom();
  },

  refreshOrientation() {
    const isPortrait = CANVAS_H >= CANVAS_W;
    document.getElementById('btn-portrait').classList.toggle('active', isPortrait);
    document.getElementById('btn-landscape').classList.toggle('active', !isPortrait);
  },
};
