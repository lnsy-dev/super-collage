/* ═══════════════════════════════════════════════════════════════════
   IndexedDB wrapper
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { PAGE_SIZE_DIMS } from './constants.js';

export const DB = {
  _db: null,

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('superCollage', 3);
      req.onupgradeneeded = async e => {
        const db = e.target.result;
        const tx = e.target.transaction;

        if (!db.objectStoreNames.contains('projects'))
          db.createObjectStore('projects', { keyPath: 'id' });

        let layersStore;
        if (!db.objectStoreNames.contains('layers')) {
          layersStore = db.createObjectStore('layers', { keyPath: 'id' });
          layersStore.createIndex('by-project', 'projectId');
          layersStore.createIndex('by-page', 'pageId');
        } else {
          layersStore = tx.objectStore('layers');
          if (!layersStore.indexNames.contains('by-page')) {
            layersStore.createIndex('by-page', 'pageId');
          }
          if (!layersStore.indexNames.contains('by-project')) {
            layersStore.createIndex('by-project', 'projectId');
          }
        }

        if (!db.objectStoreNames.contains('imageBlobs'))
          db.createObjectStore('imageBlobs', { keyPath: 'layerId' });
        if (!db.objectStoreNames.contains('maskBlobs'))
          db.createObjectStore('maskBlobs', { keyPath: 'layerId' });

        if (!db.objectStoreNames.contains('pages')) {
          const pagesStore = db.createObjectStore('pages', { keyPath: 'id' });
          pagesStore.createIndex('by-project', 'projectId');
        }

        // Migrate v2 projects: wrap each project's layers into a single default page.
        if (e.oldVersion < 3) {
          await DB._migrateV2(tx);
        }
      };
      req.onsuccess = e => { DB._db = e.target.result; resolve(); };
      req.onerror = e => reject(e.target.error);
    });
  },

  async _migrateV2(tx) {
    const projectStore = tx.objectStore('projects');
    const layerStore = tx.objectStore('layers');
    const pagesStore = tx.objectStore('pages');

    const projects = await new Promise((res, rej) => {
      const r = projectStore.getAll();
      r.onsuccess = e => res(e.target.result);
      r.onerror = e => rej(e.target.error);
    });

    for (const project of projects) {
      const pageId = crypto.randomUUID();
      const layerOrder = Array.isArray(project.layerOrder) ? project.layerOrder : [];

      // Compute page dimensions the same way project-manager does on open.
      let dims = PAGE_SIZE_DIMS[project.pageSize] || PAGE_SIZE_DIMS['letter'];
      if (project.pageSize === 'custom' && project.customW && project.customH) {
        dims = { w: project.customW, h: project.customH };
      }
      let { w, h } = dims;
      if (project.orientation === 'landscape' && h > w) [w, h] = [h, w];

      const page = {
        id: pageId,
        projectId: project.id,
        name: 'Page 1',
        index: 0,
        width: w,
        height: h,
        layerOrder,
        spread: false,
        spreadPartnerId: null,
        createdAt: project.createdAt || Date.now(),
        updatedAt: project.updatedAt || Date.now(),
      };

      await new Promise((res, rej) => {
        const r = pagesStore.put(page);
        r.onsuccess = () => res();
        r.onerror = e => rej(e.target.error);
      });

      // Update each layer in this project with the new pageId.
      for (const layerId of layerOrder) {
        await new Promise((res, rej) => {
          const r = layerStore.get(layerId);
          r.onsuccess = e => {
            const rec = e.target.result;
            if (rec) {
              rec.pageId = pageId;
              layerStore.put(rec);
            }
            res();
          };
          r.onerror = e => rej(e.target.error);
        });
      }

      // Update project with page metadata.
      project.pageOrder = [pageId];
      project.booklet = project.booklet || {
        binding: 'saddle-stitch',
        targetSheetSize: 'letter',
        pagesPerSheet: 1,
      };
      await new Promise((res, rej) => {
        const r = projectStore.put(project);
        r.onsuccess = () => res();
        r.onerror = e => rej(e.target.error);
      });
    }
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
    const pages = await DB.getByIndex('pages', 'by-project', projectId);
    for (const p of pages) {
      const layers = await DB.getByIndex('layers', 'by-page', p.id);
      for (const l of layers) {
        await DB.del('imageBlobs', l.id);
        await DB.del('maskBlobs', l.id);
        await DB.del('layers', l.id);
      }
      await DB.del('pages', p.id);
    }
    await DB.del('projects', projectId);
  },

  async saveLayer(layer) {
    await DB.put('layers', layer.toRecord());
  },

  async saveMask(layer) {
    const blob = await layer._maskCanvas.convertToBlob({ type: 'image/png' });
    await DB.put('maskBlobs', { layerId: layer.id, blob });
  },
};
