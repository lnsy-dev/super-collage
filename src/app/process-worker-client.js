/* ═══════════════════════════════════════════════════════════════════
   Process Worker Client

   Main-thread RPC to the pixel-pipeline worker. Callers hand over
   freshly created ImageBitmaps/OffscreenCanvas clones — transferred
   sources are detached — and get back promises for the results.

   Availability: the worker is created lazily on first use. If creation
   fails, the worker script errors, or a job faults, the client marks
   itself unavailable and rejects in-flight jobs; callers fall back to
   running the identical pipeline inline on the main thread (see
   pixel-pipeline.js — the same code, bit-identical output). A safety
   timeout turns a wedged worker into a fallback instead of a hung
   draw frame.
   ═══════════════════════════════════════════════════════════════════ */

const JOB_TIMEOUT_MS = 120_000;

class ProcessWorkerUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'ProcessWorkerUnavailableError'; }
}

class ProcessWorkerClient {
  constructor() {
    this.worker = null;
    this.available = null; // null = not yet tried, true/false = known
    this._seq = 1;
    this._pending = new Map();
    // Observable job counters (e2e assertions use these to prove the
    // worker path is actually taken instead of the inline fallback).
    this.stats = { resolved: 0, failed: 0 };
  }

  _ensure() {
    if (this.worker) return this.worker;
    if (this.available === false) return null;
    try {
      const worker = new Worker(new URL('./worker/process-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => this._onMessage(e.data);
      worker.onerror = () => this._failAll('process worker script error');
      worker.onmessageerror = () => this._failAll('process worker message decode error');
      this.worker = worker;
      this.available = true;
      return worker;
    } catch (_err) {
      // Workers unavailable in this environment — every job takes the
      // inline fallback path.
      this.available = false;
      return null;
    }
  }

  _onMessage(data) {
    const pending = data && this._pending.get(data.id);
    if (!pending) return;
    this._pending.delete(data.id);
    clearTimeout(pending.timer);
    if (data.ok) {
      this.stats.resolved++;
      pending.resolve(data);
    } else {
      this.stats.failed++;
      pending.reject(new Error(data.error || 'process worker job failed'));
    }
  }

  _failAll(reason) {
    this.available = false;
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ProcessWorkerUnavailableError(reason));
    }
    this._pending.clear();
    // A broken worker stays broken; drop it so future calls short-circuit.
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }

  _post(kind, payload, parts, transfer) {
    const worker = this._ensure();
    if (!worker) return Promise.reject(new ProcessWorkerUnavailableError('worker unavailable'));
    const id = this._seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        // One wedged job is enough to stop trusting this worker: callers
        // fall back to the inline pipeline instead of hanging a draw frame.
        this._failAll('process worker job timed out');
        reject(new ProcessWorkerUnavailableError('process worker job timed out'));
      }, JOB_TIMEOUT_MS);
      this._pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ id, kind, payload, parts }, transfer || []);
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        this._failAll('process worker postMessage failed: ' + (err && err.message || err));
        reject(new ProcessWorkerUnavailableError('postMessage failed'));
      }
    });
  }

  /**
   * Run the pixel pipeline for `parts` (=[{bitmap, color}]) under `params`
   * (plain cloneable object) and resolve with the finished bitmap (an
   * ImageBitmap — usable anywhere the processed canvas was; Chromium
   * refuses to transfer context-bearing OffscreenCanvases, so canvases
   * cross the boundary as bitmaps). The source bitmaps are transferred
   * (detached on the caller side).
   */
  process(parts, params) {
    return this._post('process', params, parts, parts.map(p => p.bitmap))
      .then(data => data.bitmap);
  }

  /**
   * PNG-encode a canvas without blocking the main thread on the encoder.
   * The canvas is cloned and detached into an ImageBitmap (transferring a
   * context-bearing canvas is rejected by Chromium); the worker redraws
   * it into its own canvas for convertToBlob.
   */
  encodeCanvas(canvas) {
    const clone = new OffscreenCanvas(canvas.width, canvas.height);
    clone.getContext('2d').drawImage(canvas, 0, 0);
    const bmp = clone.transferToImageBitmap();
    return this._post('encode', { bitmap: bmp }, null, [bmp])
      .then(data => data.blob);
  }

  /**
   * Read full-canvas ImageData off the main thread: the canvas is cloned
   * and detached into a bitmap; the worker does the getImageData readback.
   */
  readImageData(canvas) {
    const clone = new OffscreenCanvas(canvas.width, canvas.height);
    clone.getContext('2d').drawImage(canvas, 0, 0);
    const bmp = clone.transferToImageBitmap();
    return this._post('read', { bitmap: bmp }, null, [bmp])
      .then(data => data.imageData);
  }
}

export const processWorkerClient = new ProcessWorkerClient();
export { ProcessWorkerUnavailableError };
