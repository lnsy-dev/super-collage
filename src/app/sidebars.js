/* ═══════════════════════════════════════════════════════════════════
   Sidebar resize & collapse handles
   ═══════════════════════════════════════════════════════════════════
   The tool palette (#toolbar-window, left) and the panel column
   (#right-panel, right) each get a grip handle sitting in the vertical
   middle of their canvas-facing edge:

   - Drag it to resize the side bar.
   - Click it to toggle (collapse / restore) that side bar.

   The handles float over the workspace gaps (they consume no layout
   width themselves) and are re-anchored to their bar's edge whenever
   the bars change size or the workspace is resized.
 */

const SIDEBAR_LIMITS = {
  'toolbar-window': { min: 52, max: 160 },
  'right-panel': { min: 200, max: 520 },
};

/** Pointer travel below this is a click, not a drag. */
const CLICK_SLOP = 4;

function syncSidebarHandles() {
  const ws = document.getElementById('workspace');
  if (!ws) return;
  const wsRect = ws.getBoundingClientRect();
  let any = false;
  ws.querySelectorAll('.sidebar-handle').forEach(handle => {
    const bar = document.getElementById(handle.dataset.bar);
    if (!bar) return;
    const side = handle.dataset.side || 'left';
    const barRect = bar.getBoundingClientRect();
    // Center the grip on the bar's canvas-facing edge.
    const edge = side === 'left' ? barRect.right : barRect.left;
    const left = edge - wsRect.left - handle.offsetWidth / 2;
    if (isNaN(left)) return;
    handle.style.left = `${Math.round(left)}px`;
    handle.classList.add('synced');
  });
}

export function wireSidebars() {
  const ws = document.getElementById('workspace');
  if (!ws) return;

  document.querySelectorAll('.sidebar-handle').forEach(handle => {
    const bar = document.getElementById(handle.dataset.bar);
    if (!bar) return;
    handle.addEventListener('pointerdown', e => beginSidebarDrag(e, handle, bar));
  });
  document.querySelectorAll('.panel-row-handle').forEach(handle => {
    const win = document.getElementById(handle.dataset.window);
    if (!win) return;
    handle.addEventListener('pointerdown', e => beginRowDrag(e, handle, win));
  });

  // Re-anchor whenever a bar resizes (drag, collapse) or the workspace does.
  const ro = new ResizeObserver(syncSidebarHandles);
  ro.observe(ws);
  for (const id of Object.keys(SIDEBAR_LIMITS)) {
    const bar = document.getElementById(id);
    if (bar) ro.observe(bar);
  }
  const rightPanel = document.getElementById('right-panel');
  if (rightPanel) ro.observe(rightPanel);
  syncSidebarHandles();
  restoreRowHeights();
  // Panels unhide when a project opens; the saved row heights apply once
  // their column gains its real size.
  const rowRo = new ResizeObserver(() => restoreRowHeights());
  for (const winId of Object.keys(ROW_LIMITS)) {
    const win = document.getElementById(winId);
    if (win) rowRo.observe(win);
  }
}

const ROW_LIMITS = {
  // Extending the Layers view: min keeps the layer list + buttons usable,
  // max scales with the right panel so a tall column can host a tall list.
  'layers-window': { min: 96, panelFraction: 0.92 },
};

/**
 * Drag handle that changes a stacked panel window's HEIGHT (e.g. the
 * Layers view grip): it extends the windows downward and everything
 * below it in the column simply moves down (the column scrolls when it
 * outgrows the panel). The chosen height persists in localStorage so the
 * expanded Layers view survives reloads.
 */
function beginRowDrag(e, handle, win) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault();

  const limits = ROW_LIMITS[win.id] || { min: 80, panelFraction: 0.9 };
  const startY = e.clientY;
  let startHeight = win.offsetHeight;
  let moved = false;
  let appliedH = null;

  handle.setPointerCapture(e.pointerId);
  handle.classList.add('dragging');

  const onMove = ev => {
    const dy = ev.clientY - startY;
    if (Math.abs(dy) > 3) moved = true;
    // Sibling panel windows below/above share the column: the cap keep
    // the whole column reachable, and the panel scrolls for the rest.
    const panel = win.parentElement;
    const max = Math.max(limits.min, Math.round(panel.clientHeight * limits.panelFraction));
    let h = Math.max(limits.min, Math.min(max, startHeight + dy));
    if (h === appliedH) return;
    appliedH = h;
    applyRowHeight(win, h);
  };

  const onUp = () => {
    handle.classList.remove('dragging');
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    if (moved && appliedH != null) {
      try {
        localStorage.setItem('ui-' + win.id + '-height', String(appliedH));
      } catch (_e) { /* storage may be unavailable; session-only then */ }
    }
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

/** Set a stacked panel window's height and let its list fill it. */
function applyRowHeight(win, h) {
  win.style.height = `${h}px`;
  win.style.flex = '0 0 auto';
  const list = win.querySelector('#layer-list');
  if (list) { list.style.maxHeight = 'none'; }
  // The panel column scrolls once the resized columns exceed its height so
  // the windows below (pages, properties) stay reachable, moved downward.
  const panel = win.parentElement;
  if (panel) panel.classList.add('has-expanded-row');
}

/** Restore a saved row height (window name + px in localStorage). Panels
 *  hidden at wiring time have no measurable height yet, so re-tries run
 *  through the resize observer until their column is laid out. */
const ROW_RESTORED = new Set();

function restoreRowHeights() {
  for (const winId of Object.keys(ROW_LIMITS)) {
    if (ROW_RESTORED.has(winId)) continue;
    let saved = parseInt(localStorage.getItem('ui-' + winId + '-height'), 10);
    if (!Number.isFinite(saved)) continue;
    const win = document.getElementById(winId);
    if (!win) continue;
    const limits = ROW_LIMITS[winId];
    const panel = win.parentElement;
    if (!panel || panel.clientHeight <= 0) continue; // hidden: retry via observer
    const max = Math.round(panel.clientHeight * limits.panelFraction);
    applyRowHeight(win, Math.max(limits.min, Math.min(max, saved)));
    ROW_RESTORED.add(winId);
  }
}

function beginSidebarDrag(e, handle, bar) {  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault();

  const side = handle.dataset.side || 'left';
  const limits = SIDEBAR_LIMITS[bar.id] || { min: 0, max: 800 };
  const collapsed = bar.classList.contains('collapsed');
  // From a collapsed bar (width 0) a drag first re-opens it at the min width.
  const startWidth = collapsed ? 0 : bar.offsetWidth;
  const startX = e.clientX;
  let moved = false;
  let lastWidth = startWidth;

  document.body.classList.add('sidebar-resizing');
  handle.setPointerCapture(e.pointerId);

  const onMove = ev => {
    const dx = ev.clientX - startX;
    if (Math.abs(dx) > CLICK_SLOP) moved = true;
    let w = side === 'left' ? startWidth + dx : startWidth - dx;
    w = Math.max(limits.min, Math.min(limits.max, w));
    if (w < limits.min) return; // still in the collapsed click zone
    if (Math.abs(w - lastWidth) >= 1 || bar.classList.contains('collapsed')) {
      lastWidth = w;
      bar.classList.remove('collapsed');
      applyWidth(bar, w);
      syncSidebarHandles();
    }
  };

  const onUp = () => {
    document.body.classList.remove('sidebar-resizing');
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    if (!moved) {
      toggleSidebar(bar, limits);
      syncSidebarHandles();
    }
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

function applyWidth(bar, w) {
  bar.style.width = `${w}px`;
  bar.style.minWidth = `${w}px`;
}

export function toggleSidebar(bar, limits = SIDEBAR_LIMITS[bar.id]) {
  if (bar.classList.contains('collapsed')) {
    bar.classList.remove('collapsed');
    const restored = parseInt(bar.dataset.lastWidth, 10) || (limits ? limits.min : bar.offsetWidth);
    applyWidth(bar, Math.min(restored, limits ? limits.max : restored));
  } else {
    bar.dataset.lastWidth = String(bar.offsetWidth);
    bar.classList.add('collapsed');
  }
}
