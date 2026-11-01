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

  // Re-anchor whenever a bar resizes (drag, collapse) or the workspace does.
  const ro = new ResizeObserver(syncSidebarHandles);
  ro.observe(ws);
  for (const id of Object.keys(SIDEBAR_LIMITS)) {
    const bar = document.getElementById(id);
    if (bar) ro.observe(bar);
  }
  syncSidebarHandles();
}

function beginSidebarDrag(e, handle, bar) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
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
