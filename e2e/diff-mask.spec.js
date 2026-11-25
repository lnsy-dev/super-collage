// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Difference masks: creation semantics and mask deletion

   Regression coverage for the report:

     "When we create a diff mask, and then delete the original mask,
      the original image still appears until I reload the page, then
      it is missing. I should be able to delete the mask of a diff
      mask. In a diff mask, the original image should remain, the only
      layer that should be created is the mask, then the two layers
      should be linked."

   The model under test:

     - create-difference-mask keeps the original image layer AS ITS OWN
       LAYER (no duplicated "(diff)" copy) and creates only the mask
       layer on top of it;
     - the base and its mask layer are LINKED (they move and scale as
       one unit until Unlink);
     - deleting the mask layer of a difference mask works immediately:
       the original image stays visible in-session (no reload needed)
       AND survives a reload — the deleted mask must not corrupt the
       base's persisted record or blobs.
   ═══════════════════════════════════════════════════════════════════ */
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
  reopenProject,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/** On-screen pixel color at (fx, fy ∈ [0,1]) of the named layer. */
function screenPixelAt(page, layerId, fx, fy) {
  return page.evaluate(([layerId, fxx, fyy]) => {
    const l = window.State.layers.find(x => x.id === layerId);
    if (!l) return null;
    const canvas = document.getElementById('display-canvas');
    const cx = Math.round((l.x + l.width * fxx) * window.State.zoom);
    const cy = Math.round((l.y + l.height * fyy) * window.State.zoom);
    const bx = Math.min(canvas.width - 1, Math.round(cx * window.Renderer._displayScale));
    const by = Math.min(canvas.height - 1, Math.round(cy * window.Renderer._displayScale));
    const d = canvas.getContext('2d').getImageData(bx, by, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }, [layerId, fx, fy]);
}

/** State summary of the page's layers, straight from State + IndexedDB. */
function diffMaskState(page) {
  return page.evaluate(async () => {
    const { DB } = await import('/src/app/db.js');
    const mask = window.State.layers.find(l => l.isMaskFor);
    const base = window.State.layers.find(l => (l.imageMaskIds || []).includes(mask?.id));
    const blobs = await DB.getAll('imageBlobs');
    return {
      layerCount: window.State.layers.length,
      layerIds: window.State.layers.map(l => l.id),
      baseId: base?.id || null,
      maskId: mask?.id || null,
      linked: !!base && !!mask &&
        (base.linkedIds || []).includes(mask.id) &&
        (mask.linkedIds || []).includes(base.id),
      diffCopies: window.State.layers.filter(l => l.name.includes('(diff)')).length,
      blobIds: blobs.map(b => b.layerId),
    };
  });
}

/** Create a project with one image, a duplicate, and a difference mask. */
async function setupDiffMask(page, projectName) {
  await createProject(page, projectName);
  await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 100, 100), { name: 'plate.png' });
  await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

  await page.locator('.layer-row').nth(0).click();
  await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('#btn-create-difference-mask')).toBeVisible();
  await page.click('#btn-create-difference-mask');

  const state = await diffMaskState(page);
  expect(state.layerCount).toBe(2);
  expect(state.linked).toBe(true);
  expect(state.diffCopies).toBe(0);
  return state;
}

/* ═══════════════════════════════════════════════════════════════════
   (B) Difference-mask creation semantics
   ═══════════════════════════════════════════════════════════════════ */

test.describe('Difference mask creation', () => {
  test('original stays its own layer, only the mask is created, pair is linked', async ({ page }) => {
    const state = await setupDiffMask(page, 'Diff Mask Semantics');

    // The original image's record and blob survive untouched.
    expect(state.baseId).toBeTruthy();
    expect(state.maskId).toBeTruthy();
    expect(state.blobIds.sort()).toEqual([state.baseId, state.maskId].sort());

    const baseRecord = await page.evaluate(async (id) => {
      const { DB } = await import('/src/app/db.js');
      const rec = await DB.get('layers', id);
      return {
        name: rec.name, imageMaskIds: rec.imageMaskIds,
        linkedIds: rec.linkedIds, isMaskFor: rec.isMaskFor,
      };
    }, state.baseId);
    expect(baseRecord.imageMaskIds).toEqual([state.maskId]);
    expect(baseRecord.linkedIds).toEqual([state.maskId]);
    expect(baseRecord.isMaskFor).toBe(null);
  });

  test('difference mask pair renders and persists across a reload', async ({ page }) => {
    const state = await setupDiffMask(page, 'Diff Mask Reload');

    await reopenProject(page, 'Diff Mask Reload');
    const reloaded = await diffMaskState(page);

    expect(reloaded.layerCount).toBe(2);
    expect(reloaded.linked).toBe(true);
    expect(reloaded.diffCopies).toBe(0);
    expect(reloaded.baseId).toBeTruthy();
    expect(reloaded.maskId).toBeTruthy();
    expect(reloaded.blobIds.sort()).toEqual([state.baseId, state.maskId].sort());

    // The reloaded layers have live image canvases.
    const canvases = await page.evaluate(([baseId, maskId]) => {
      const base = window.State.layers.find(l => l.id === baseId);
      const mask = window.State.layers.find(l => l.id === maskId);
      return {
        baseImage: !!base?._originalCanvas, maskImage: !!mask?._originalCanvas,
        stillMasked: (base.imageMaskIds || []).includes(maskId) && mask.isMaskFor === baseId,
      };
    }, [reloaded.baseId, reloaded.maskId]);
    expect(canvases.baseImage).toBe(true);
    expect(canvases.maskImage).toBe(true);
    expect(canvases.stillMasked).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   (A) Deleting the mask layer of a difference mask
   ═══════════════════════════════════════════════════════════════════ */

test.describe('Difference mask deletion', () => {
  test('deleting the mask leaves the original visible immediately and after a reload', async ({ page }) => {
    const state = await setupDiffMask(page, 'Diff Mask Delete');

    // While the mask exists it cuts the base (identical opaque ink), so
    // the base shows paper; the deletion must flip it straight back to
    // fully visible with no reload.
    await expect.poll(async () => {
      const pixel = await screenPixelAt(page, state.baseId, 0.5, 0.5);
      return pixel ? pixel.r : -1;
    }, { timeout: 10000 }).toBeGreaterThan(200);

    // Delete the mask layer through the real pipeline.
    await page.evaluate((maskId) => {
      window.State.selectedId = maskId;
      window.State.selectedIds = [maskId];
      window.UI.refreshLayerList();
    }, state.maskId);
    await page.locator('#layer-buttons [data-action="delete-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    // Immediate: the original image is visible again in-session.
    await expect.poll(async () => {
      const pixel = await screenPixelAt(page, state.baseId, 0.5, 0.5);
      return pixel ? pixel.r : -1;
    }, { timeout: 10000 }).toBeLessThan(200);

    // No stale mask relationship survived in the base's record.
    const afterDelete = await page.evaluate(async (baseId) => {
      const { DB } = await import('/src/app/db.js');
      const rec = await DB.get('layers', baseId);
      return { imageMaskIds: rec.imageMaskIds, linkedIds: rec.linkedIds };
    }, state.baseId);
    expect(afterDelete.imageMaskIds).toEqual([]);
    expect(afterDelete.linkedIds).toEqual([]);

    // Reload: the original image is still there — not missing.
    await reopenProject(page, 'Diff Mask Delete');
    const reloaded = await diffMaskState(page);
    expect(reloaded.layerCount).toBe(1);
    expect(reloaded.layerIds).toEqual([state.baseId]);
    expect(reloaded.blobIds).toContain(state.baseId);

    const hasImage = await page.evaluate((baseId) => {
      const base = window.State.layers.find(l => l.id === baseId);
      return !!base?._originalCanvas;
    }, state.baseId);
    expect(hasImage).toBe(true);

    // And it still renders.
    await expect.poll(async () => {
      const pixel = await screenPixelAt(page, state.baseId, 0.5, 0.5);
      return pixel ? pixel.r : -1;
    }, { timeout: 10000 }).toBeLessThan(200);
  });

  test('deleting the mask layer clears both link lists with no self-references', async ({ page }) => {
    const state = await setupDiffMask(page, 'Diff Mask Delete Links');

    await page.evaluate((maskId) => {
      window.State.selectedId = maskId;
      window.State.selectedIds = [maskId];
      window.UI.refreshLayerList();
    }, state.maskId);
    await page.locator('#layer-buttons [data-action="delete-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const records = await page.evaluate(async () => {
      const { DB } = await import('/src/app/db.js');
      return (await DB.getAll('layers')).map(r => ({
        id: r.id, name: r.name, linkedIds: r.linkedIds,
        imageMaskIds: r.imageMaskIds, isMaskFor: r.isMaskFor,
      }));
    });
    expect(records).toHaveLength(1);
    const base = records[0];
    expect(base.id).toBe(state.baseId);
    expect(base.linkedIds).toEqual([]);
    expect(base.imageMaskIds).toEqual([]);
    expect(base.isMaskFor).toBe(null);
  });
});
