/* ═══════════════════════════════════════════════════════════════════
   UI
   ═══════════════════════════════════════════════════════════════════ */

import { State, selectedLayer } from './state.js';
import { RISO_COLORS, CANVAS_W, CANVAS_H } from './constants.js';
import { Renderer } from './renderer.js';
import { DB } from './db.js';

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

      const vis = document.createElement('span');
      vis.className = 'layer-vis';
      vis.textContent = l.visible ? '◉' : '○';
      vis.addEventListener('click', e => {
        e.stopPropagation();
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
      name.textContent = (l.isMaskFor ? '⬦ ' : '') + l.name;
      name.addEventListener('dblclick', e => {
        e.stopPropagation();
        const n = prompt('Layer name:', l.name);
        if (n?.trim()) { l.name = n.trim(); DB.saveLayer(l); this.refreshLayerList(); }
      });

      const lock = document.createElement('span');
      lock.className = 'layer-lock' + (l.locked ? ' locked' : '');
      lock.textContent = l.locked ? '🔒' : '🔓';
      lock.title = l.locked ? 'Unlock layer' : 'Lock layer';
      lock.addEventListener('click', e => {
        e.stopPropagation();
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

    const setRange = (id, valId, val) => {
      document.getElementById(id).value = val;
      document.getElementById(valId).textContent = val;
    };
    setRange('prop-brightness', 'val-brightness', layer.brightness);
    setRange('prop-contrast',   'val-contrast',   layer.contrast);
    document.getElementById('btn-invert-image').classList.toggle('active', layer.invert);
    setRange('prop-halftone-size', 'val-halftone-size', layer.halftoneSize);
    setRange('prop-halftone-angle', 'val-halftone-angle', layer.halftoneAngle);
    setRange('prop-hatch-height', 'val-hatch-height', layer.hatchLineHeight ?? 10);
    setRange('prop-hatch-length', 'val-hatch-length', layer.hatchLineLength ?? 60);

    const isHatch = layer.halftoneType === 'crosshatch';
    const isGrayscale = layer.halftoneType === 'grayscale';
    document.getElementById('halftone-size-row').classList.toggle('hidden', isHatch || isGrayscale);
    document.getElementById('hatch-height-row').classList.toggle('hidden', !isHatch);
    document.getElementById('hatch-length-row').classList.toggle('hidden', !isHatch);
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
