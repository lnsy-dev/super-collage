/* ═════════════════════════════════════════════════════════════════════
   Export progress: a metrics readout plus a live stage line for long exports.

   Wraps the export dialog's progress container with:
   - a determinate bar,
   - a status LABEL — which unit is in flight (sheet, ink, plate N of M),
   - a STAGE line — what the exporter is doing right now (reading a page,
     loading layers, rendering layer i of n, encoding, saving a file),
   - a metrics line (plates done/total / elapsed / ETA / output size).

   `textContent` stays a working property so existing
   `prog.textContent = …` status updates keep working unchanged.
   ═════════════════════════════════════════════════════════════════════ */

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export function createExportProgress(container) {
  if (!container) return null;

  const bar = document.createElement('div');
  bar.className = 'export-progress-bar';
  const fill = document.createElement('div');
  fill.className = 'export-progress-fill';
  bar.appendChild(fill);

  const label = document.createElement('div');
  label.className = 'export-progress-label';

  const stageEl = document.createElement('div');
  stageEl.className = 'export-progress-stage';

  const metrics = document.createElement('div');
  metrics.className = 'export-progress-metrics';

  container.textContent = '';
  container.appendChild(bar);
  container.appendChild(label);
  container.appendChild(stageEl);
  container.appendChild(metrics);

  let totalUnits = 0;
  let doneUnits = 0;
  let bytes = 0;
  let startTime = 0;

  const renderMetrics = () => {
    if (!totalUnits) { metrics.textContent = ''; return; }
    const parts = [`${doneUnits} / ${totalUnits} plates`];
    const now = performance.now();
    const elapsed = now - startTime;
    parts.push(`⏱ ${formatDuration(elapsed)}`);
    if (doneUnits > 0 && doneUnits < totalUnits) {
      const eta = (elapsed / doneUnits) * (totalUnits - doneUnits);
      parts.push(`~${formatDuration(eta)} left`);
    }
    if (bytes > 0) parts.push(formatBytes(bytes));
    metrics.textContent = parts.join(' · ');
  };

  return {
    element: container,

    /** Call when an export starts. `total` = number of downloadable plates. */
    begin(total = 0) {
      totalUnits = total;
      doneUnits = 0;
      bytes = 0;
      startTime = performance.now();
      fill.style.width = totalUnits ? '0%' : '100%';
      label.textContent = 'Preparing export…';
      stageEl.textContent = '';
      renderMetrics();
    },

    /** Record `n` finished plates and update the metrics line. */
    advance(n = 1, { bytes: extraBytes = 0 } = {}) {
      doneUnits += n;
      bytes += extraBytes;
      fill.style.width = totalUnits ? `${Math.min(100, (doneUnits / totalUnits) * 100)}%` : '100%';
      renderMetrics();
    },

    /**
     * The fine-grained "right now" line under the label: which page is being
     * read, which layer is rendering, whether we are encoding or saving.
     * Pass '' to clear it.
     */
    stage(text) {
      stageEl.textContent = text || '';
    },

    get stageText() { return stageEl.textContent; },

    /** Reset the counter for a fresh phase (e.g. per-page loop). */
    reset(total) {
      this.begin(total);
    },

    finish(summaryText) {
      fill.style.width = '100%';
      label.textContent = summaryText;
      stageEl.textContent = '';
      const elapsed = performance.now() - startTime;
      const parts = [];
      if (totalUnits) parts.push(`${doneUnits} / ${totalUnits} plates`);
      parts.push(`⏱ ${formatDuration(elapsed)}`);
      if (bytes > 0) parts.push(formatBytes(bytes));
      metrics.textContent = parts.join(' · ');
    },

    fail(text) {
      label.textContent = text;
      stageEl.textContent = '';
    },

    get textContent() { return label.textContent; },
    set textContent(v) { label.textContent = v; },
  };
}
