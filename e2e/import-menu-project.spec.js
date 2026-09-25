import { test, expect } from '@playwright/test';
import {
  clearIndexedDB,
  createProject,
  addImageFromBuffer,
  createSolidPngBuffer,
  createShapePngBuffer,
  createMultiColorPngBuffer,
} from './helpers.js';

let dialogMessages = [];

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
  // The import flow alerts on invalid zips — record + auto-dismiss so tests
  // don't hang (single handler; a second one would double-handle dialogs).
  dialogMessages = [];
  page.on('dialog', async d => { dialogMessages.push(d.message()); await d.accept(); });
});

/* ─── helpers ───────────────────────────────────────────────────────── */

// Build a source project zip the same way e2e/project-io.spec.js does:
// real layers in a real project, persisted to IndexedDB, then zipped via
// window.ProjectIO.buildZipBlob. Each def is extra props for one layer
// ({ color, colorMode, x, y, ... }) plus an optional `page` index (default
// 0) saying which source page it lands on.
async function buildSourceZip(page, layerDefs, { pageCount = 1 } = {}) {
  await createProject(page, 'Import Source', { pageSize: 'half-letter' });
  if (pageCount > 1) {
    await page.evaluate(async (n) => {
      const p0 = window.State.pages[0];
      for (let i = 1; i < n; i++) {
        await window.PageManager.addBlankPageToProject(window.State.project.id, p0.width, p0.height);
      }
    }, pageCount);
  }
  for (let p = 0; p < pageCount; p++) {
    await loadPage(page, p);
    for (const def of layerDefs.filter(d => (d.page || 0) === p)) {
      await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: `src-${Math.random().toString(36).slice(2)}.png` });
      await page.evaluate(async (d) => {
        const l = window.State.layers[window.State.layers.length - 1];
        Object.assign(l, d);
        l._dirty = true;
        await window.DB.saveLayer(l);
      }, def);
    }
    await page.evaluate(() => window.PageManager.saveActivePage());
  }

  const zipB64 = await page.evaluate(async () => {
    const blob = await window.ProjectIO.buildZipBlob(window.State.project.id);
    const buf = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  });
  const zipBuffer = Buffer.from(zipB64, 'base64');

  // Fresh document to import into (source project stays in the DB but the
  // current page is now empty and belongs to the new project).
  await clearIndexedDB(page);
  await createProject(page, 'Import Target', { pageSize: 'half-letter' });
  return zipBuffer;
}

async function loadPage(page, index) {
  await page.evaluate(async (i) => {
    const pid = window.State.project.pageOrder[i];
    const { PageManager } = await import('/src/app/page-manager.js');
    if (pid !== window.State.pageId) await PageManager.loadPage(pid);
  }, index);
}

async function importZip(page, zipBuffer, { expectLayers = null } = {}) {
  await page.setInputFiles('#import-project-layers-input', {
    name: 'source-project.zip',
    mimeType: 'application/zip',
    buffer: zipBuffer,
  });
  if (expectLayers != null) {
    await page.waitForFunction(
      (n) => window.State.layers.length === n,
      expectLayers,
      { timeout: 15000 }
    );
  } else {
    // No-op path: give the import a moment to (not) land.
    await page.waitForTimeout(500);
  }
}

function groupInfo(page) {
  return page.evaluate(() => {
    const layers = window.State.layers;
    const members = layers.filter(l => l.importedGroupId);
    return {
      total: layers.length,
      members,
      gids: [...new Set(members.map(l => l.importedGroupId))],
      linkSymmetryOk: members.every(m =>
        m.linkedIds.length === members.length - 1 &&
        members.every(o => o.id === m.id || m.linkedIds.includes(o.id))
      ),
    };
  });
}

/* ─── tests ─────────────────────────────────────────────────────────── */

test.describe('Import Menu Project', () => {

  test('menu command imports source layers as one linked, centered group', async ({ page }) => {
    const zip = await buildSourceZip(page, [
      { color: '#f65058', colorMode: 'solid', x: 100, y: 100, width: 300, height: 200 },
      { color: '#0078bf', colorMode: 'solid', x: 500, y: 400, width: 200, height: 200 },
      { color: '#00a95c', colorMode: 'gradient', x: 900, y: 200, width: 250, height: 250,
        gradient: { type: 'radial', angle: 0, centerX: 0.5, centerY: 0.5, stops: [
          { color: '#010101', position: 0 }, { color: '#0078bf', position: 1 }], poles: [] } },
    ]);

    await importZip(page, zip, { expectLayers: 3 });

    const info = await groupInfo(page);
    expect(info.total).toBe(3);
    expect(info.members.length).toBe(3);
    expect(info.gids.length).toBe(1);           // one shared importedGroupId
    expect(info.linkSymmetryOk).toBe(true);      // all-pairs symmetric linking

    // Colors and color modes preserved.
    const members = info.members;
    expect(members.map(m => m.color).sort()).toEqual(
      ['#f65058', '#0078bf', '#00a95c'].sort());
    expect(members.filter(m => m.colorMode === 'gradient').length).toBe(1);
    expect(members.filter(m => m.colorMode === 'gradient')[0].gradient.type).toBe('radial');

    // Group bbox fits inside the canvas and is centered on it.
    const box = await page.evaluate(async () => {
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
      const ms = window.State.layers.filter(l => l.importedGroupId);
      const xs = ms.map(m => m.x), ys = ms.map(m => m.y);
      const xe = ms.map(m => m.x + m.width), ye = ms.map(m => m.y + m.height);
      return {
        minX: Math.min(...xs), minY: Math.min(...ys),
        maxX: Math.max(...xe), maxY: Math.max(...ye),
        CANVAS_W, CANVAS_H,
      };
    });
    expect(box.minX).toBeGreaterThanOrEqual(0);
    expect(box.minY).toBeGreaterThanOrEqual(0);
    expect(box.maxX).toBeLessThanOrEqual(box.CANVAS_W);
    expect(box.maxY).toBeLessThanOrEqual(box.CANVAS_H);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(box.CANVAS_W / 2, 0);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(box.CANVAS_H / 2, 0);
  });

  test('invalid zip (wrong format) alerts and adds zero layers', async ({ page }) => {
    await createProject(page, 'Invalid Target', { pageSize: 'half-letter' });

    const zip = Buffer.from('PK\x03\x04definitely-not-a-project');
    await importZip(page, zip);

    expect(dialogMessages.length).toBe(1);
    expect(dialogMessages[0]).toContain('Could not import project');
    const info = await groupInfo(page);
    expect(info.total).toBe(0);
  });

  test('split button unpacks an imported group; members move independently after', async ({ page }) => {
    const zip = await buildSourceZip(page, [
      { color: '#f65058', colorMode: 'solid', x: 100, y: 100, width: 300, height: 200 },
      { color: '#0078bf', colorMode: 'solid', x: 500, y: 400, width: 200, height: 200 },
    ]);
    await importZip(page, zip, { expectLayers: 2 });

    // Select ONE imported member via the layer list → split button visible.
    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await expect(page.locator('#btn-split-color-separation')).toBeVisible();

    // Click it: group unpacks in place.
    await page.click('#btn-split-color-separation');
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const layers = window.State.layers;
      return {
        count: layers.length,
        anyGid: layers.some(l => l.importedGroupId),
        anyLinks: layers.some(l => (l.linkedIds || []).length > 0),
      };
    });
    expect(after.count).toBe(2);        // no layers deleted
    expect(after.anyGid).toBe(false);   // importedGroupId cleared on all members
    expect(after.anyLinks).toBe(false); // every linkedIds pair among members cleared

    // Members are independent now: drag one, the other must not move.
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const [a, b] = window.State.layers;
      a.x = 200; a.y = 200;
      window.State.selectedId = a.id;
      window.State.selectedIds = [a.id];
      window.State.zoom = 4;
      Renderer.resize();
      Renderer.schedule();
      window.UI.refreshLayerList();
    });
    await page.waitForTimeout(100);

    const box = await page.locator('#interaction-overlay').boundingBox();
    if (!box) throw new Error('Canvas not found');
    const target = await page.evaluate(async () => {
      const { CANVAS_PAD } = await import('/src/app/constants.js');
      const a = window.State.layers[0];
      const z = window.State.zoom;
      return { sx: (a.x + a.width / 2 + CANVAS_PAD) * z, sy: (a.y + a.height / 2 + CANVAS_PAD) * z };
    });
    const before = await page.evaluate(() => {
      const [a, b] = window.State.layers;
      return { ax: a.x, bx: b.x, by: b.y };
    });

    const startX = box.x + target.sx;
    const startY = box.y + target.sy;
    await page.evaluate(({ sx, sy, ex, ey }) => {
      const el = document.getElementById('interaction-overlay');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      const opts = { pointerId: 7, isPrimary: true, bubbles: true, cancelable: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ex, clientY: ey, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ex, clientY: ey, buttons: 0 }));
      el.setPointerCapture = orig;
    }, { sx: startX, sy: startY, ex: startX + 120, ey: startY + 80 });
    await page.waitForTimeout(100);

    const moved = await page.evaluate(() => {
      const [a, b] = window.State.layers;
      return { ax: a.x, bx: b.x, by: b.y };
    });
    expect(moved.ax).toBeGreaterThan(before.ax + 20); // dragged member moved
    expect(moved.bx).toBe(before.bx);                 // sibling untouched
    expect(moved.by).toBe(before.by);
  });

  test('multi-page source stacks all pages vertically as one group', async ({ page }) => {
    const zip = await buildSourceZip(page, [
      { color: '#f65058', colorMode: 'solid', page: 0, x: 100, y: 100, width: 300, height: 200 },
      { color: '#0078bf', colorMode: 'solid', page: 1, x: 150, y: 150, width: 250, height: 180 },
    ], { pageCount: 2 });
    await importZip(page, zip, { expectLayers: 2 });

    const info = await groupInfo(page);
    expect(info.total).toBe(2);
    expect(info.gids.length).toBe(1);        // pages share ONE importedGroupId
    expect(info.linkSymmetryOk).toBe(true);  // full linking across pages

    // Second-page layers sit below the first page's extent.
    const box = await page.evaluate(async () => {
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
      const byColor = Object.fromEntries(
        window.State.layers.map(l => [l.color, { top: l.y, bottom: l.y + l.height, x: l.x, w: l.width }])
      );
      return { byColor, CANVAS_W, CANVAS_H };
    });
    const first = box.byColor['#f65058'];
    const second = box.byColor['#0078bf'];
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second.top).toBeGreaterThan(first.bottom);
    // Whole stack still fits and is centered on the canvas.
    const minY = Math.min(first.top, second.top);
    const maxY = Math.max(first.bottom, second.bottom);
    const minX = Math.min(first.x, second.x);
    const maxX = Math.max(first.x + first.w, second.x + second.w);
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(maxY).toBeLessThanOrEqual(box.CANVAS_H);
    expect(minX).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(box.CANVAS_W);
    expect((minY + maxY) / 2).toBeCloseTo(box.CANVAS_H / 2, 0);
    expect((minX + maxX) / 2).toBeCloseTo(box.CANVAS_W / 2, 0);

    // Split still unpacks everything (members, links, group id).
    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await expect(page.locator('#btn-split-color-separation')).toBeVisible();
    await page.click('#btn-split-color-separation');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      count: window.State.layers.length,
      anyGid: window.State.layers.some(l => l.importedGroupId),
      anyLinks: window.State.layers.some(l => (l.linkedIds || []).length > 0),
    }));
    expect(after.count).toBe(2);
    expect(after.anyGid).toBe(false);
    expect(after.anyLinks).toBe(false);
  });

  test('imported group moves as one when one member is dragged', async ({ page }) => {
    const zip = await buildSourceZip(page, [
      { color: '#f65058', colorMode: 'solid', x: 100, y: 100, width: 300, height: 200 },
      { color: '#0078bf', colorMode: 'solid', x: 500, y: 400, width: 200, height: 200 },
    ]);
    await importZip(page, zip, { expectLayers: 2 });

    // Select ONE member via the layer list, then drag it on the canvas.
    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(1).click();
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      window.State.zoom = 4;
      Renderer.resize();
      Renderer.schedule();
    });
    await page.waitForTimeout(100);

    const start = await page.evaluate(async () => {
      const { CANVAS_PAD } = await import('/src/app/constants.js');
      const m = window.State.layers.find(l => l.color === '#0078bf');
      const z = window.State.zoom;
      return { sx: (m.x + m.width / 2 + CANVAS_PAD) * z, sy: (m.y + m.height / 2 + CANVAS_PAD) * z };
    });
    const box = await page.locator('#interaction-overlay').boundingBox();
    if (!box) throw new Error('Canvas not found');
    const before = await page.evaluate(() => window.State.layers.map(l => ({
      id: l.id, x: l.x, y: l.y, color: l.color, colorMode: l.colorMode,
    })));

    await page.evaluate(({ sx, sy, ex, ey }) => {
      const el = document.getElementById('interaction-overlay');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      const opts = { pointerId: 11, isPrimary: true, bubbles: true, cancelable: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ex, clientY: ey, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ex, clientY: ey, buttons: 0 }));
      el.setPointerCapture = orig;
    }, { sx: box.x + start.sx, sy: box.y + start.sy, ex: box.x + start.sx + 200, ey: box.y + start.sy + 120 });
    await page.waitForTimeout(150);

    const after = await page.evaluate(() => window.State.layers.map(l => ({
      id: l.id, x: l.x, y: l.y, color: l.color, colorMode: l.colorMode,
    })));
    const byId = (arr, id) => arr.find(l => l.id === id);
    const d = after.map((l, i) => ({ dx: l.x - before[i].x, dy: l.y - before[i].y }));

    // The dragged member moved, and the other member moved by the SAME delta.
    expect(Math.hypot(d[1].dx, d[1].dy)).toBeGreaterThan(20);
    expect(d[0].dx).toBeCloseTo(d[1].dx, 0);
    expect(d[0].dy).toBeCloseTo(d[1].dy, 0);

    // Colors survived the transform untouched.
    for (let i = 0; i < after.length; i++) {
      expect(after[i].color).toBe(before[i].color);
      expect(after[i].colorMode).toBe(before[i].colorMode);
    }
  });

  test('properties-panel width change scales every member by the same factor', async ({ page }) => {
    const zip = await buildSourceZip(page, [
      { color: '#f65058', colorMode: 'solid', x: 100, y: 100, width: 300, height: 200 },
      { color: '#0078bf', colorMode: 'solid', x: 500, y: 400, width: 200, height: 200 },
    ]);
    await importZip(page, zip, { expectLayers: 2 });

    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await page.waitForTimeout(150);

    const sel = await page.evaluate(() => ({
      selectedId: window.State.selectedId,
      members: window.State.layers.map(l => ({
        id: l.id, w: l.width, cx: l.x + l.width / 2, color: l.color, colorMode: l.colorMode,
      })),
    }));
    const before = sel.members;

    await page.fill('#prop-w', '600');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const after = await page.evaluate(() => window.State.layers.map(l => ({
      id: l.id, w: l.width, cx: l.x + l.width / 2, color: l.color, colorMode: l.colorMode,
    })));

    // Every member scaled by the same factor; the edited member is 600.
    const primBefore = before.find(l => l.id === sel.selectedId);
    const primAfter = after.find(l => l.id === sel.selectedId);
    const otherBefore = before.find(l => l.id !== sel.selectedId);
    const otherAfter = after.find(l => l.id !== sel.selectedId);
    expect(primAfter.w).toBe(600);
    const f0 = primAfter.w / primBefore.w;
    const f1 = otherAfter.w / otherBefore.w;
    expect(f1).toBeCloseTo(f0, 1);
    expect(f0).toBeGreaterThan(1.5);

    // Layout preserved: both centers stayed fixed (primary center kept too,
    // or the group's arrangement would shift on every numeric resize).
    expect(primAfter.cx).toBeCloseTo(primBefore.cx, 0);
    expect(otherAfter.cx).toBeCloseTo(otherBefore.cx, 0);

    // Colors survived.
    for (let i = 0; i < after.length; i++) {
      const b = before.find(l => l.id === after[i].id);
      expect(after[i].color).toBe(b.color);
      expect(after[i].colorMode).toBe(b.colorMode);
    }
  });

  test('rotating one member applies the same delta to all members', async ({ page }) => {
    const zip = await buildSourceZip(page, [
      { color: '#f65058', colorMode: 'solid', x: 100, y: 100, width: 300, height: 200 },
      { color: '#0078bf', colorMode: 'solid', x: 500, y: 400, width: 200, height: 200 },
    ]);
    await importZip(page, zip, { expectLayers: 2 });

    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      window.State.zoom = 4;
      Renderer.resize();
      Renderer.schedule();
    });
    await page.waitForTimeout(100);

    const start = await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const m = window.State.layers.find(l => window.State.selectedIds.includes(l.id));
      const handles = Renderer.getHandles(m, window.State.zoom);
      const rot = handles.find(h => h.id === 'rotate');
      if (!rot) throw new Error('rotate handle not found');
      return { sx: rot.x, sy: rot.y };
    });
    const box = await page.locator('#interaction-overlay').boundingBox();
    if (!box) throw new Error('Canvas not found');
    const before = await page.evaluate(() => window.State.layers.map(l => ({
      rot: l.rotation, color: l.color, colorMode: l.colorMode,
    })));

    await page.evaluate(({ sx, sy, ex, ey }) => {
      const el = document.getElementById('interaction-overlay');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      const opts = { pointerId: 12, isPrimary: true, bubbles: true, cancelable: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ex, clientY: ey, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ex, clientY: ey, buttons: 0 }));
      el.setPointerCapture = orig;
    }, { sx: box.x + start.sx, sy: box.y + start.sy, ex: box.x + start.sx + 150, ey: box.y + start.sy - 150 });
    await page.waitForTimeout(150);

    const after = await page.evaluate(() => window.State.layers.map(l => ({
      rot: l.rotation, color: l.color, colorMode: l.colorMode,
    })));
    const delta = after.map((l, i) => l.rot - before[i].rot);

    // Rotation actually happened, and BOTH members got the same delta.
    expect(Math.abs(delta[0])).toBeGreaterThan(3);
    expect(delta[1]).toBeCloseTo(delta[0], 0);

    // Colors survived.
    for (let i = 0; i < after.length; i++) {
      expect(after[i].color).toBe(before[i].color);
      expect(after[i].colorMode).toBe(before[i].colorMode);
    }
  });

  test('empty source project (no layers) is a friendly no-op', async ({ page }) => {
    const zip = await buildSourceZip(page, []);
    await importZip(page, zip);

    // Friendly explanation, nothing added.
    expect(dialogMessages.some(m => m.includes('nothing'))).toBe(true);
    const info = await groupInfo(page);
    expect(info.total).toBe(0);
  });

  test('image-mask relationships survive import and still mask on canvas', async ({ page }) => {
    await createProject(page, 'Mask Source', { pageSize: 'half-letter' });
    // Base: solid ink. Mask: triangle-shaped ink that will cut the base.
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 160, 160), { name: 'base.png' });
    await addImageFromBuffer(page, createShapePngBuffer('triangle', 160, 160), { name: 'maskimg.png' });
    await page.evaluate(async () => {
      const layers = window.State.layers;
      const a = layers[layers.length - 2], b = layers[layers.length - 1];
      a.color = '#f65058'; a._dirty = true; await window.DB.saveLayer(a);
      window.State.selectedIds = [a.id, b.id];
      window.State.selectedId = b.id;
      await window.handleAction('create-image-mask');
      await window.PageManager.saveActivePage();
    });
    await page.waitForFunction(() => window.State.layers.some(l => l.isMaskFor));
    const srcIds = await page.evaluate(() => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length > 0);
      const mask = window.State.layers.find(l => l.isMaskFor);
      return { baseId: base.id, maskId: mask.id };
    });

    const zipB64 = await page.evaluate(async () => {
      const blob = await window.ProjectIO.buildZipBlob(window.State.project.id);
      const buf = await blob.arrayBuffer();
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    });
    await clearIndexedDB(page);
    await createProject(page, 'Mask Target', { pageSize: 'half-letter' });
    await page.setInputFiles('#import-project-layers-input', {
      name: 'masked.zip', mimeType: 'application/zip', buffer: Buffer.from(zipB64, 'base64'),
    });
    await page.waitForFunction(() => window.State.layers.length === 2, null, { timeout: 15000 });

    // Fresh ids: neither imported layer keeps a source id, and the
    // relationship points at the imported partner.
    const rel = await page.evaluate(() => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length > 0);
      const mask = window.State.layers.find(l => l.isMaskFor);
      return {
        base: base ? { id: base.id, masks: base.imageMaskIds.slice() } : null,
        mask: mask ? { id: mask.id, isMaskFor: mask.isMaskFor } : null,
        gids: [...new Set(window.State.layers.filter(l => l.importedGroupId).map(l => l.importedGroupId))],
      };
    });
    expect(rel.base).toBeTruthy();
    expect(rel.mask).toBeTruthy();
    expect(rel.base.id).not.toBe(srcIds.baseId);
    expect(rel.mask.id).not.toBe(srcIds.maskId);
    expect(rel.base.masks).toEqual([rel.mask.id]);
    expect(rel.mask.isMaskFor).toBe(rel.base.id);
    expect(rel.gids.length).toBe(1);

    // Masking still applies on canvas: render the page through the real
    // drawLayers path — the mask's triangle ink must cut the base away in the
    // center (white paper shows) while the base shows at the corner (red ink).
    const pixels = await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length > 0);
      const c = new OffscreenCanvas(CANVAS_W, CANVAS_H);
      const ctx = c.getContext('2d');
      await Renderer.drawLayers(ctx, window.State.layers, CANVAS_W, CANVAS_H, 1, true);
      const at = (fx, fy) => {
        const d = ctx.getImageData(Math.round(base.x + fx * base.width), Math.round(base.y + fy * base.height), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      return { center: at(0.5, 0.5), corner: at(0.08, 0.08) };
    });
    // Center: mask ink cut the base → white paper.
    expect(pixels.center[0]).toBeGreaterThan(240);
    expect(pixels.center[1]).toBeGreaterThan(240);
    expect(pixels.center[2]).toBeGreaterThan(240);
    // Corner: base's red ink survives (multiply over white keeps it red).
    expect(pixels.corner[0]).toBeGreaterThan(180);
    expect(pixels.corner[1]).toBeLessThan(150);
    expect(pixels.corner[2]).toBeLessThan(150);
  });

  test('color-separation source imports with plates rebuilt and splits after', async ({ page }) => {
    await createProject(page, 'Sep Source', { pageSize: 'half-letter' });
    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');
    await page.setInputFiles('#color-sep-input', {
      name: 'sep.png', mimeType: 'image/png', buffer: createMultiColorPngBuffer(120, 120),
    });
    await page.waitForFunction(() => window.State.layers.some(l => l.isColorSeparation), null, { timeout: 20000 });

    const zipB64 = await page.evaluate(async () => {
      const blob = await window.ProjectIO.buildZipBlob(window.State.project.id);
      const buf = await blob.arrayBuffer();
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    });
    await clearIndexedDB(page);
    await createProject(page, 'Sep Target', { pageSize: 'half-letter' });
    await page.setInputFiles('#import-project-layers-input', {
      name: 'sep.zip', mimeType: 'application/zip', buffer: Buffer.from(zipB64, 'base64'),
    });
    await page.waitForFunction(() => window.State.layers.some(l => l.isColorSeparation), null, { timeout: 20000 });

    // Plates rebuilt from the imported blob (same count as separationColors).
    const sep = await page.evaluate(() => {
      const l = window.State.layers.find(x => x.isColorSeparation);
      return { colors: l.separationColors.length, plates: l.separationPlates.size, hasOrig: !!l._originalCanvas };
    });
    expect(sep.plates).toBe(sep.colors);
    expect(sep.plates).toBeGreaterThan(0);
    expect(sep.hasOrig).toBe(true);

    // split-color-separation still works on the imported layer.
    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await expect(page.locator('#btn-split-color-separation')).toBeVisible();
    const before = await page.evaluate(() => window.State.layers.length);
    await page.click('#btn-split-color-separation');
    await page.waitForFunction((n) => window.State.layers.length > n, before, { timeout: 15000 });
    const afterSplit = await page.evaluate(() => ({
      n: window.State.layers.length,
      sepLeft: window.State.layers.some(l => l.isColorSeparation),
    }));
    expect(afterSplit.n).toBeGreaterThan(before);
    expect(afterSplit.sepLeft).toBe(false);
  });

  test('missing image blob file in zip degrades gracefully', async ({ page }) => {
    const zip = await buildSourceZip(page, [
      { color: '#f65058', colorMode: 'solid', x: 100, y: 100, width: 300, height: 200 },
      { color: '#0078bf', colorMode: 'solid', x: 500, y: 400, width: 200, height: 200 },
    ]);

    // Remove ONE layer's image file from the zip (browser-side JSZip).
    const brokenB64 = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const zip = await window.JSZip.loadAsync(bytes);
      const manifest = JSON.parse(await zip.file('project.json').async('string'));
      const victim = manifest.layers.find(e => e.image && e.image.path);
      zip.remove(victim.image.path);
      const out = await zip.generateAsync({ type: 'base64' });
      return out;
    }, zip.toString('base64'));

    // Import must not crash and must still add BOTH layer records.
    await page.setInputFiles('#import-project-layers-input', {
      name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from(brokenB64, 'base64'),
    });
    await page.waitForFunction(() => window.State.layers.length === 2, null, { timeout: 15000 });

    const state = await page.evaluate(async () => {
      const layers = window.State.layers;
      const blobs = [];
      for (const l of layers) {
        const rec = await window.DB.get('imageBlobs', l.id);
        blobs.push({ color: l.color, hasBlob: !!(rec && rec.blob), gid: !!l.importedGroupId });
      }
      return { blobs, gids: [...new Set(layers.map(l => l.importedGroupId).filter(Boolean))] };
    });
    expect(state.blobs.length).toBe(2);
    expect(state.blobs.filter(b => b.hasBlob).length).toBe(1); // only the intact one
    expect(state.blobs.filter(b => b.gid).length).toBe(2);     // still one group
    expect(state.gids.length).toBe(1);
  });

  test('missing project.json alerts and adds zero layers', async ({ page }) => {
    await createProject(page, 'No Manifest Target', { pageSize: 'half-letter' });

    // Build a zip in the browser that has no project.json at all.
    const buf = await page.evaluate(async () => {
      const zip = new window.JSZip();
      zip.file('readme.txt', 'nothing to see');
      const blob = await zip.generateAsync({ type: 'blob' });
      const arr = new Uint8Array(await blob.arrayBuffer());
      return Array.from(arr);
    });
    await importZip(page, Buffer.from(buf));

    expect(dialogMessages.length).toBe(1);
    expect(dialogMessages[0]).toContain('Could not import project');
    const info = await groupInfo(page);
    expect(info.total).toBe(0);
  });
});
