/* ═══════════════════════════════════════════════════════════════════
   IndexedDB wrapper
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';

export const DB = {
  _db: null,

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('superCollage', 2);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('projects'))
          db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('layers')) {
          const ls = db.createObjectStore('layers', { keyPath: 'id' });
          ls.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('imageBlobs'))
          db.createObjectStore('imageBlobs', { keyPath: 'layerId' });
        if (!db.objectStoreNames.contains('maskBlobs'))
          db.createObjectStore('maskBlobs', { keyPath: 'layerId' });
      };
      req.onsuccess = e => { DB._db = e.target.result; resolve(); };
      req.onerror = e => reject(e.target.error);
    });
  },

  _req(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = DB._db.transaction(store, mode);
      const s = Array.isArray(store) ? store.map(n => tx.objectStore(n)) : tx.objectStore(store);
      const req = fn(s);
      req.onsuccess = e => res(e.target.result);
      req.onerror = e => rej(e.target.error);
    });
  },

  get: (store, key) => new Promise((res, rej) => {
    const req = DB._db.transaction(store).objectStore(store).get(key);
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  }),

  getAll: (store) => new Promise((res, rej) => {
    const req = DB._db.transaction(store).objectStore(store).getAll();
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  }),

  getByIndex: (store, index, value) => new Promise((res, rej) => {
    const req = DB._db.transaction(store).objectStore(store).index(index).getAll(value);
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  }),

  put: (store, obj) => new Promise((res, rej) => {
    const req = DB._db.transaction(store, 'readwrite').objectStore(store).put(obj);
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  }),

  del: (store, key) => new Promise((res, rej) => {
    const req = DB._db.transaction(store, 'readwrite').objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror = e => rej(e.target.error);
  }),

  async deleteProject(projectId) {
    const layers = await DB.getByIndex('layers', 'by-project', projectId);
    for (const l of layers) {
      await DB.del('imageBlobs', l.id);
      await DB.del('maskBlobs', l.id);
      await DB.del('layers', l.id);
    }
    await DB.del('projects', projectId);
  },

  layerRecord(layer) {
    return {
      id: layer.id, projectId: layer.projectId, name: layer.name, visible: layer.visible, locked: layer.locked || false,
      x: layer.x, y: layer.y, width: layer.width, height: layer.height,
      naturalWidth: layer.naturalWidth, naturalHeight: layer.naturalHeight,
      rotation: layer.rotation, flipH: layer.flipH, flipV: layer.flipV,
      brightness: layer.brightness, contrast: layer.contrast, saturation: layer.saturation, invert: layer.invert,
      halftoneType: layer.halftoneType, halftoneSize: layer.halftoneSize, halftoneAngle: layer.halftoneAngle, color: layer.color,
      colorMode: layer.colorMode,
      gradient: JSON.parse(JSON.stringify(layer.gradient)),
      pattern: JSON.parse(JSON.stringify(layer.pattern)),
      imageMaskIds: layer.imageMaskIds || [],
      isMaskFor:   layer.isMaskFor   || null,
      isSvg: layer.isSvg || false,
      isColorSeparation: layer.isColorSeparation || false,
      separationColors: layer.separationColors || [],
    };
  },

  async saveLayer(layer) {
    await DB.put('layers', DB.layerRecord(layer));
    await DB.put('projects', { ...State.project, updatedAt: Date.now(), layerOrder: State.layers.map(l => l.id) });
  },

  async saveMask(layer) {
    const blob = await layer._maskCanvas.convertToBlob({ type: 'image/png' });
    await DB.put('maskBlobs', { layerId: layer.id, blob });
  },
};
