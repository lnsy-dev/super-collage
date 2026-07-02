/* ═══════════════════════════════════════════════════════════════════
   Project I/O — download / upload a whole project as a .zip

   A project round-trips 1:1: its `projects` record, every `pages` record,
   every `layers` record (full Layer.toRecord()), and every image/mask blob
   are packed into a single zip via JSZip. Uploading rebuilds all of that in
   IndexedDB under fresh IDs, so `PageManager.hydrateLayer` reproduces the
   exact same document (images + locations, masks, gradients, patterns,
   colors, color separation, text, multi-page).
   ═══════════════════════════════════════════════════════════════════ */

import { DB } from './db.js';
import { PageManager } from './page-manager.js';

const FORMAT = 'super-collage-project';
const VERSION = 1;

function _getJSZip() {
  const JSZip = (typeof window !== 'undefined' && window.JSZip) || null;
  if (!JSZip) throw new Error('JSZip is not loaded (expected window.JSZip).');
  return JSZip;
}

function _slug(name) {
  return (name || 'project')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function _extForType(type) {
  if (!type) return 'bin';
  if (type.includes('svg')) return 'svg';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  return 'bin';
}

export const ProjectIO = {
  /**
   * Read a project and everything under it out of IndexedDB.
   * Returns { project, pages, layers, blobs } where blobs maps
   * layerId → { image: Blob|null, mask: Blob|null }.
   */
  async _collect(projectId) {
    const project = await DB.get('projects', projectId);
    if (!project) throw new Error('Project not found: ' + projectId);

    const pages = await DB.getByIndex('pages', 'by-project', projectId);

    const layers = [];
    const blobs = {};
    for (const page of pages) {
      const pageLayers = await DB.getByIndex('layers', 'by-page', page.id);
      for (const rec of pageLayers) {
        layers.push(rec);
        const imgRec = await DB.get('imageBlobs', rec.id);
        const maskRec = await DB.get('maskBlobs', rec.id);
        blobs[rec.id] = {
          image: imgRec?.blob || null,
          mask: maskRec?.blob || null,
        };
      }
    }
    return { project, pages, layers, blobs };
  },

  /**
   * Build a zip Blob for the given project.
   */
  async buildZipBlob(projectId) {
    const JSZip = _getJSZip();
    const { project, pages, layers, blobs } = await this._collect(projectId);
    const zip = new JSZip();

    const manifest = {
      format: FORMAT,
      version: VERSION,
      exportedAt: Date.now(),
      project,
      pages,
      layers: [],
    };

    const imagesDir = zip.folder('images');
    const masksDir = zip.folder('masks');

    for (const rec of layers) {
      const entry = { record: rec, image: null, mask: null };
      const b = blobs[rec.id] || {};
      if (b.image) {
        const type = b.image.type || 'image/png';
        const path = `images/${rec.id}.${_extForType(type)}`;
        imagesDir.file(`${rec.id}.${_extForType(type)}`, b.image);
        entry.image = { path, type };
      }
      if (b.mask) {
        const type = b.mask.type || 'image/png';
        const path = `masks/${rec.id}.png`;
        masksDir.file(`${rec.id}.png`, b.mask);
        entry.mask = { path, type };
      }
      manifest.layers.push(entry);
    }

    zip.file('project.json', JSON.stringify(manifest, null, 2));
    return zip.generateAsync({ type: 'blob' });
  },

  /**
   * Flush any in-memory edits, build the zip, and trigger a browser download.
   */
  async downloadProject(projectId) {
    // Persist the active page/spread so unsaved in-memory edits are included.
    try { await PageManager.saveActivePage(); } catch { /* no active page */ }

    const project = await DB.get('projects', projectId);
    const blob = await this.buildZipBlob(projectId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${_slug(project?.name)}.zip`;
    a.click();
    // Revoke on the next tick so the click has a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  /**
   * Parse a project zip and write it into IndexedDB under fresh IDs.
   * Returns the new projectId. Never overwrites an existing project.
   */
  async importZip(fileOrBlob) {
    const JSZip = _getJSZip();
    const zip = await JSZip.loadAsync(fileOrBlob);

    const manifestFile = zip.file('project.json');
    if (!manifestFile) throw new Error('Invalid project file: project.json missing.');
    const manifest = JSON.parse(await manifestFile.async('string'));
    if (manifest.format !== FORMAT) {
      throw new Error('Unrecognized project format: ' + manifest.format);
    }

    // ── Build ID remaps so the import is collision-free and repeatable. ──
    const newProjectId = crypto.randomUUID();
    const pageIdMap = new Map();
    const layerIdMap = new Map();
    for (const page of manifest.pages || []) pageIdMap.set(page.id, crypto.randomUUID());
    for (const entry of manifest.layers || []) layerIdMap.set(entry.record.id, crypto.randomUUID());

    const now = Date.now();

    // ── Project record ──
    const project = { ...manifest.project };
    project.id = newProjectId;
    project.pageOrder = (project.pageOrder || []).map(id => pageIdMap.get(id)).filter(Boolean);
    project.createdAt = now;
    project.updatedAt = now;
    await DB.put('projects', project);

    // ── Pages ──
    for (const srcPage of manifest.pages || []) {
      const page = { ...srcPage };
      page.id = pageIdMap.get(srcPage.id);
      page.projectId = newProjectId;
      page.spreadPartnerId = srcPage.spreadPartnerId ? (pageIdMap.get(srcPage.spreadPartnerId) || null) : null;
      page.layerOrder = (srcPage.layerOrder || []).map(id => layerIdMap.get(id)).filter(Boolean);
      page.createdAt = now;
      page.updatedAt = now;
      await DB.put('pages', page);
    }

    // ── Layers (+ blobs) ──
    for (const entry of manifest.layers || []) {
      const rec = { ...entry.record };
      const newId = layerIdMap.get(entry.record.id);
      rec.id = newId;
      rec.projectId = newProjectId;
      rec.pageId = rec.pageId ? (pageIdMap.get(rec.pageId) || null) : null;
      rec.imageMaskIds = (rec.imageMaskIds || []).map(id => layerIdMap.get(id)).filter(Boolean);
      rec.isMaskFor = rec.isMaskFor ? (layerIdMap.get(rec.isMaskFor) || null) : null;
      await DB.put('layers', rec);

      if (entry.image?.path) {
        const f = zip.file(entry.image.path);
        if (f) {
          const buf = await f.async('arraybuffer');
          const blob = new Blob([buf], { type: entry.image.type || 'image/png' });
          await DB.put('imageBlobs', { layerId: newId, blob });
        }
      }
      if (entry.mask?.path) {
        const f = zip.file(entry.mask.path);
        if (f) {
          const buf = await f.async('arraybuffer');
          const blob = new Blob([buf], { type: entry.mask.type || 'image/png' });
          await DB.put('maskBlobs', { layerId: newId, blob });
        }
      }
    }

    return newProjectId;
  },
};

// Convenience for tests / debugging.
if (typeof window !== 'undefined') {
  window.ProjectIO = ProjectIO;
}
