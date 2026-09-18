/* ═══════════════════════════════════════════════════════════════════
   Export progress: a small metrics readout for long-running exports.

   Wraps the export dialog's progress container with a determinate bar,
   a status label and a live metrics line (elapsed / ETA / output size).
   `textContent` stays a working property so existing
   `prog.textContent = …` status updates keep working unchanged.
   ═══════════════════════════════════════════════════════════════════ */

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

  const metrics = document.createElement('div');
  metrics.className = 'export-progress-metrics';

  container.textContent = '';
  container.appendChild(bar);
  container.appendChild(label);
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
      renderMetrics();
    },

    /** Record `n` finished plates and update the metrics line. */
    advance(n = 1, { bytes: extraBytes = 0 } = {}) {
      doneUnits += n;
      bytes += extraBytes;
      fill.style.width = totalUnits ? `${Math.min(100, (doneUnits / totalUnits) * 100)}%` : '100%';
      renderMetrics();
    },

    /** Reset the counter for a fresh phase (e.g. per-page loop). */
    reset(total) {
      this.begin(total);
    },

    finish(summaryText) {
      fill.style.width = '100%';
      label.textContent = summaryText;
      const elapsed = performance.now() - startTime;
      const parts = [`⏱ ${formatDuration(elapsed)}`];
      if (bytes > 0) parts.push(formatBytes(bytes));
      metrics.textContent = parts.join(' · ');
    },

    fail(text) {
      label.textContent = text;
    },

    get textContent() { return label.textContent; },
    set textContent(v) { label.textContent = v; },
  };
}
