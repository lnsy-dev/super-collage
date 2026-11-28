/* ═══════════════════════════════════════════════════════════════════
   Process Worker

   Runs the layer pixel pipeline off the main thread. Pure ES module —
   no import map needed (relative imports only), no DOM access: inputs
   arrive as transferred ImageBitmaps plus a plain params object (the
   shape of Layer.toRecord plus target fields), outputs leave as
   transferred OffscreenCanvas / Blob / ImageData.

   Job kinds:
     process  → composeProcessedCanvas(parts, params) → ImageBitmap
     encode   → canvas drawn from the sent bitmap → convertToBlob → Blob
     read     → getImageData of a canvas drawn from the sent bitmap

   Transfer note: Chromium refuses to transfer an OffscreenCanvas once it
   has a rendering context ("could not be transferred because it had a
   rendering context"), so every canvas crosses the boundary as a
   transferToImageBitmap()/createImageBitmap() ImageBitmap — always
   transferable, zero-copy — and the receiving side draws it into a
   fresh OffscreenCanvas when it needs canvas APIs.

   Follow-ups that stay on the main thread for now (see plan):
   wasm-based separation styling and export blending (need their own
   wasm init here) and text shaping (document.fonts dependency).
   ═══════════════════════════════════════════════════════════════════ */

import { composeProcessedCanvas } from '../pixel-pipeline.js';

self.onmessage = (e) => {
  const { id, kind, payload, parts } = e.data || {};
  try {
    if (kind === 'process') {
      const canvas = composeProcessedCanvas(parts, payload);
      const bmp = canvas.transferToImageBitmap();
      self.postMessage({ id, ok: true, bitmap: bmp }, [bmp]);
      return;
    }
    if (kind === 'encode') {
      const canvas = new OffscreenCanvas(payload.bitmap.width, payload.bitmap.height);
      canvas.getContext('2d').drawImage(payload.bitmap, 0, 0);
      canvas.convertToBlob({ type: 'image/png' })
        .then(blob => self.postMessage({ id, ok: true, blob }))
        .catch(err => self.postMessage({ id, ok: false, error: String(err && err.message || err) }));
      return;
    }
    if (kind === 'read') {
      const canvas = new OffscreenCanvas(payload.bitmap.width, payload.bitmap.height);
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(payload.bitmap, 0, 0);
      const px = canvas.getContext('2d', { willReadFrequently: true })
        .getImageData(0, 0, canvas.width, canvas.height);
      self.postMessage({ id, ok: true, imageData: px }, [px.data.buffer]);
      return;
    }
    self.postMessage({ id, ok: false, error: 'unknown job kind: ' + kind });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
