/* ═══════════════════════════════════════════════════════════════════
   Screentone Manager
   ═══════════════════════════════════════════════════════════════════ */

import { LayerManager } from './layer-manager.js';

let _selectedFilename = null;
let _manifest = null;

export function showScreentoneDialog() {
  const dialog = document.getElementById('screentone-dialog');
  const grid = document.getElementById('screentone-grid');
  const addBtn = document.getElementById('btn-screentone-add');

  _selectedFilename = null;
  addBtn.disabled = true;
  grid.innerHTML = '';
  dialog.classList.remove('hidden');

  loadManifest().then(manifest => {
    _manifest = manifest;
    renderGrid(manifest);
  }).catch(err => {
    console.error('Failed to load screentones:', err);
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;font-size:9px;color:var(--dark-gray);">No screentones found.</div>';
  });
}

export function hideScreentoneDialog() {
  document.getElementById('screentone-dialog').classList.add('hidden');
  _selectedFilename = null;
  _manifest = null;
}

async function loadManifest() {
  const res = await fetch('assets/screentones/manifest.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderGrid(manifest) {
  const grid = document.getElementById('screentone-grid');
  const addBtn = document.getElementById('btn-screentone-add');
  grid.innerHTML = '';

  for (const item of manifest) {
    const el = document.createElement('div');
    el.className = 'screentone-item';
    el.dataset.filename = item.filename;
    el.innerHTML = `
      <img src="assets/screentones/${encodeURIComponent(item.filename)}" alt="${escapeHtml(item.name)}" loading="lazy">
      <div class="screentone-name">${escapeHtml(item.name)}</div>
    `;
    el.addEventListener('click', () => {
      grid.querySelectorAll('.screentone-item').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
      _selectedFilename = item.filename;
      addBtn.disabled = false;
    });
    grid.appendChild(el);
  }
}

export async function addSelectedScreentone() {
  if (!_selectedFilename) return;
  const url = `assets/screentones/${encodeURIComponent(_selectedFilename)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const ext = _selectedFilename.split('.').pop() || 'png';
    const type = blob.type || `image/${ext === 'svg' ? 'svg+xml' : ext}`;
    const file = new File([blob], _selectedFilename, { type });
    await LayerManager.addFromFile(file);
    hideScreentoneDialog();
  } catch (err) {
    console.error('Failed to load screentone:', err);
    alert('Could not load screentone: ' + err.message);
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
