import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addTextLayer,
  addBlankPage, removePage, getProjectPageIds, getStoredPages, reopenProject,
  addImageFromBuffer, createSolidPngBuffer, createMultiColorPngBuffer,
  setLayerColorDirect, loadPageById, runExportSinglePlate,
} from './helpers.js';

/* ─── PAGE LIFECYCLE ─────────────────────────────────────────────
   Adding pages is bookkeeping in the page list, pageOrder, and the
   stored page records — none of it is visible art, so these tests
   assert the order, the identity, and what each page actually shows. */

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/** Page names as listed in the Pages panel, in display order. */
function listedPages(page) {
  return page.locator('#page-list .page-row .page-name').allTextContents();
}

/** The text content of the layers on the page currently open. */
function currentPageText(page) {
  return page.evaluate(() => window.State.layers.map(l => l.text));
}

test.describe('Page lifecycle', () => {
  test.describe('adding pages', () => {
    test('each added page gets its own identity, in creation order', async ({ page }) => {
      await createProject(page, 'Page Add Test');
      expect(await getProjectPageIds(page)).toHaveLength(1);

      for (let i = 0; i < 4; i++) await addBlankPage(page);

      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(5);
      // Every page is a distinct record, not a copy of the first one.
      expect(new Set(ids).size).toBe(5);

      const stored = await getStoredPages(page);
      expect(stored.map(p => p.id)).toEqual(ids);
      expect(stored.map(p => p.index)).toEqual([0, 1, 2, 3, 4]);
      expect(stored.map(p => p.name)).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5']);
      const first = stored[0];
      expect(stored.every(p => p.width === first.width && p.height === first.height)).toBe(true);

      // The panel lists them in creation order. Saddle-stitch pairs the two
      // outer pages of a 5-page book, so "Page 4 + Page 5" is one row.
      await expect(page.locator('#page-list .page-row')).toHaveCount(4);
      expect(await listedPages(page)).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4 + Page 5']);
    });

    test('switching pages shows that page, not another one', async ({ page }) => {
      await createProject(page, 'Page Switch Test');
      await addTextLayer(page, 'Art on page one');

      await addBlankPage(page);
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(2);
      expect(await listedPages(page)).toEqual(['Page 1', 'Page 2']);

      // The new page starts empty: the editor is still on page 1.
      await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

      const rows = page.locator('#page-list .page-row');
      await rows.nth(1).click();
      await expect(page.locator('#canvas-title')).toContainText('Page 2');
      expect(await page.evaluate(() => window.State.pageId)).toBe(ids[1]);
      await expect(page.locator('#layer-list .layer-row')).toHaveCount(0);

      await addTextLayer(page, 'Art on page two');
      await expect.poll(() => currentPageText(page)).toEqual(['Art on page two']);

      // Back to page 1 — the second page's art stayed put.
      await rows.nth(0).click();
      await expect(page.locator('#canvas-title')).toContainText('Page 1');
      await expect.poll(() => currentPageText(page)).toEqual(['Art on page one']);

      await rows.nth(1).click();
      await expect(page.locator('#canvas-title')).toContainText('Page 2');
      await expect.poll(() => currentPageText(page)).toEqual(['Art on page two']);
    });

    test('page order and the active page survive a reload', async ({ page }) => {
      await createProject(page, 'Page Reload Test');
      await addBlankPage(page);
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(2);

      // Make the second page active — not the one a fresh open lands on.
      await page.locator('#page-list .page-row').nth(1).click();
      await expect(page.locator('#canvas-title')).toContainText('Page 2');
      expect(await page.evaluate(() => window.State.pageId)).toBe(ids[1]);

      await reopenProject(page, 'Page Reload Test');

      expect(await getProjectPageIds(page)).toEqual(ids);
      const stored = await getStoredPages(page);
      expect(stored.map(p => p.id)).toEqual(ids);
      expect(stored.map(p => p.name)).toEqual(['Page 1', 'Page 2']);
      expect(await listedPages(page)).toEqual(['Page 1', 'Page 2']);
      await expect(page.locator('#page-list .page-row.selected')).toHaveCount(1);

      // Still looking at page 2 after the reload.
      await expect(page.locator('#canvas-title')).toContainText('Page 2');
      expect(await page.evaluate(() => window.State.pageId)).toBe(ids[1]);
    });
  });

  test.describe('removing a non-active page', () => {
    test('the page disappears while the open page keeps its art', async ({ page }) => {
      await createProject(page, 'Remove Inactive Test');
      await addTextLayer(page, 'Art one');
      await addBlankPage(page);
      await addBlankPage(page);
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(3);

      await page.locator('#page-list .page-row').filter({ hasText: 'Page 2 + Page 3' }).click();
      expect(await listedPages(page)).toEqual(['Page 1', 'Page 2 + Page 3']);
      // Back to page 1 — the page we will delete sits in the other unit.
      await page.locator('#page-list .page-row').filter({ hasText: 'Page 1' }).click();
      await expect(page.locator('#canvas-title')).toContainText('Page 1');
      expect(await page.evaluate(() => window.State.pageId)).toBe(ids[0]);

      // Delete the page we are not looking at.
      await removePage(page, ids[2]);

      expect(await getProjectPageIds(page)).toEqual([ids[0], ids[1]]);
      expect(await listedPages(page)).toEqual(['Page 1', 'Page 2']);

      // The stored page is gone, blobs and all; the survivors are untouched.
      const stored = await getStoredPages(page);
      expect(stored.map(p => p.id)).toEqual([ids[0], ids[1]]);
      expect(stored.map(p => p.name)).toEqual(['Page 1', 'Page 2']);
      const deletedLayers = await page.evaluate(async (id) => {
        const { DB } = await import('/src/app/db.js');
        return (await DB.getByIndex('layers', 'by-page', id)).length;
      }, ids[2]);
      expect(deletedLayers).toBe(0);

      // Still on page 1 with its own art — removing a page never jumps away.
      await expect(page.locator('#canvas-title')).toContainText('Page 1');
      await expect.poll(() => currentPageText(page)).toEqual(['Art one']);

      // The neighbours keep their order and their content.
      await page.locator('#page-list .page-row').nth(1).click();
      await expect(page.locator('#canvas-title')).toContainText('Page 2');
      await expect.poll(() => currentPageText(page)).toEqual([]);
      await page.locator('#page-list .page-row').nth(0).click();
      await expect.poll(() => currentPageText(page)).toEqual(['Art one']);
    });

    test('the removed page does not come back after a reload', async ({ page }) => {
      await createProject(page, 'Remove Inactive Reload Test');
      await addBlankPage(page);
      await addBlankPage(page);
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(3);
      expect(await listedPages(page)).toEqual(['Page 1', 'Page 2 + Page 3']);

      await removePage(page, ids[1]);

      await reopenProject(page, 'Remove Inactive Reload Test');

      expect(await getProjectPageIds(page)).toEqual([ids[0], ids[2]]);
      const stored = await getStoredPages(page);
      expect(stored.map(p => p.name)).toEqual(['Page 1', 'Page 3']);
      expect(await listedPages(page)).toEqual(['Page 1', 'Page 3']);
    });
  });

  test.describe('removing the active page', () => {
    test('the editor moves to a remaining page and shows that page’s art', async ({ page }) => {
      await createProject(page, 'Remove Active Test');
      await addTextLayer(page, 'Art on page one');
      await addBlankPage(page);
      await addBlankPage(page);
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(3);

      // Page 1 is the open unit.
      await expect(page.locator('#canvas-title')).toContainText('Page 1');
      await expect.poll(() => currentPageText(page)).toEqual(['Art on page one']);

      await removePage(page, ids[0]);

      // A valid page is still selected — never the one that was deleted.
      expect(await getProjectPageIds(page)).toEqual([ids[1], ids[2]]);
      const activeId = await page.evaluate(() => window.State.pageId);
      expect(ids).toContain(activeId);
      expect(activeId).toBe(ids[1]);
      await expect(page.locator('#canvas-title')).not.toContainText('Page 1');
      await expect(page.locator('#canvas-title')).toContainText('Page 2');
      // Page 1’s art is gone with the page; page 2 shows its own (empty) content.
      await expect.poll(() => currentPageText(page)).toEqual([]);
      expect(await listedPages(page)).toEqual(['Page 2', 'Page 3']);
    });

    test('removing the other page of the open spread keeps the editor valid', async ({ page }) => {
      await createProject(page, 'Remove Spread Page Test');
      await addBlankPage(page);
      await addBlankPage(page);
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(3);
      expect(await listedPages(page)).toEqual(['Page 1', 'Page 2 + Page 3']);

      // Open the spread; art lands on its left page.
      await page.locator('#page-list .page-row').filter({ hasText: 'Page 2 + Page 3' }).click();
      await expect(page.locator('#canvas-title')).toContainText('Page 2 + Page 3');
      await addTextLayer(page, 'Art on page two');
      await expect.poll(() => currentPageText(page)).toEqual(['Art on page two']);

      // Delete the right-hand page out from under the open spread.
      await removePage(page, ids[2]);

      expect(await getProjectPageIds(page)).toEqual([ids[0], ids[1]]);
      expect(await page.evaluate(() => window.State.pageId)).toBe(ids[1]);
      await expect(page.locator('#canvas-title')).toContainText('Page 2');
      await expect(page.locator('#canvas-title')).not.toContainText('Page 3');
      // The surviving page keeps its own art, and nothing of the deleted page.
      await expect.poll(() => currentPageText(page)).toEqual(['Art on page two']);

      // The selection survives a reload and still shows that same page.
      await reopenProject(page, 'Remove Spread Page Test');
      expect(await getProjectPageIds(page)).toEqual([ids[0], ids[1]]);
      expect(await page.evaluate(() => window.State.pageId)).toBe(ids[1]);
      await expect(page.locator('#canvas-title')).toContainText('Page 2');
      await expect.poll(() => currentPageText(page)).toEqual(['Art on page two']);
      expect(await listedPages(page)).toEqual(['Page 1', 'Page 2']);
    });
  });

  test.describe('the one-page minimum', () => {
    test('the last page cannot be removed and stays valid after a reload', async ({ page }) => {
      await createProject(page, 'Last Page Test');
      await addTextLayer(page, 'Only art');
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(1);

      // The panel offers no way to take a folio away from one page.
      await expect(page.locator('[data-action="remove-folio"]')).toBeDisabled();

      // Even the direct page delete leaves the project alone.
      await removePage(page, ids[0]);
      expect(await getProjectPageIds(page)).toEqual(ids);
      expect(await listedPages(page)).toEqual(['Page 1']);
      await expect(page.locator('#canvas-title')).toContainText('Page 1');
      await expect.poll(() => currentPageText(page)).toEqual(['Only art']);
      await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

      await reopenProject(page, 'Last Page Test');

      expect(await getProjectPageIds(page)).toEqual(ids);
      expect(await listedPages(page)).toEqual(['Page 1']);
      await expect(page.locator('#canvas-title')).toContainText('Page 1');
      await expect.poll(() => currentPageText(page)).toEqual(['Only art']);
    });

    test('removing down to one page keeps that page usable', async ({ page }) => {
      await createProject(page, 'Down To One Test');
      await addTextLayer(page, 'Keeper');
      for (let i = 0; i < 3; i++) await addBlankPage(page);
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(4);
      // Four pages are exactly one folio — not removable without emptying the project.
      await expect(page.locator('[data-action="remove-folio"]')).toBeDisabled();

      for (const id of ids.slice(1)) await removePage(page, id);

      expect(await getProjectPageIds(page)).toEqual([ids[0]]);
      expect(await listedPages(page)).toEqual(['Page 1']);
      await expect(page.locator('[data-action="remove-folio"]')).toBeDisabled();
      await expect.poll(() => currentPageText(page)).toEqual(['Keeper']);

      await reopenProject(page, 'Down To One Test');

      expect(await getProjectPageIds(page)).toEqual([ids[0]]);
      expect(await listedPages(page)).toEqual(['Page 1']);
      await expect.poll(() => currentPageText(page)).toEqual(['Keeper']);
    });

    test('a four-page folio cannot be removed out from under the project', async ({ page }) => {
      await createProject(page, 'Folio Floor Test', { pageCount: 4 });
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(4);

      // Removing the only folio would leave the project with no pages at all.
      await expect(page.locator('[data-action="remove-folio"]')).toBeDisabled();

      await page.evaluate(async (pageIds) => {
        await window.PageManager.removeFolio(pageIds);
      }, ids);

      expect(await getProjectPageIds(page)).toEqual(ids);
      expect((await getStoredPages(page)).map(p => p.name))
        .toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4']);

      // A fifth page makes the folio removable again.
      await addBlankPage(page);
      await expect(page.locator('[data-action="remove-folio"]')).toBeEnabled();
    });
  });

  test.describe('page data integrity', () => {
    test('a removed page takes its art with it; a new page starts clean', async ({ page }) => {
      await createProject(page, 'Integrity Test');

      // ── Page 1: a plain layer, a hole-punched mask, a colour separation ──
      await addImageFromBuffer(page, createSolidPngBuffer('#000000', 220, 220), { name: 'keep.png' });
      await setLayerColorDirect(page, '#8a8a8a');
      const keepId = await page.evaluate(() => window.State.selectedId);

      await addImageFromBuffer(page, createSolidPngBuffer('#000000', 200, 200), { name: 'masked.png' });
      const maskedId = await page.evaluate(() => window.State.selectedId);
      await setLayerColorDirect(page, '#5ec8e5');
      await page.evaluate(async () => {
        const l = window.State.layers.find(x => x.id === window.State.selectedId);
        window.MaskEngine._paint(l, l.naturalWidth / 2, l.naturalHeight / 2, l.naturalWidth / 3, false);
        l._dirty = true;
        await window.DB.saveLayer(l);
        await window.DB.saveMask(l);
      });

      await page.click('.menu-item[data-menu="file"]');
      await page.click('.menu-entry[data-action="import-color-separation"]');
      await page.setInputFiles('#color-sep-input', {
        name: 'sep.png', mimeType: 'image/png', buffer: createMultiColorPngBuffer(120, 120),
      });
      await page.waitForFunction(() => window.State.layers.some(l => l.isColorSeparation), null, { timeout: 20000 });
      const sepId = await page.evaluate(() => window.State.layers.find(l => l.isColorSeparation)?.id);
      const sepColors = await page.evaluate(() =>
        window.State.layers.find(l => l.isColorSeparation)?.separationColors);
      expect(sepColors.length).toBeGreaterThan(1);

      const pageOneIds = await page.evaluate(() => window.State.layers.map(l => l.id));
      expect(pageOneIds).toEqual([keepId, maskedId, sepId]);
      await page.evaluate(() => window.PageManager.saveActivePage());

      // ── Page 2: art that must not survive ──
      await addBlankPage(page);
      const ids = await getProjectPageIds(page);
      expect(ids).toHaveLength(2);
      await loadPageById(page, ids[1]);
      await addImageFromBuffer(page, createSolidPngBuffer('#000000', 300, 300), { name: 'doomed.png' });
      const doomedId = await page.evaluate(() => window.State.selectedId);
      await setLayerColorDirect(page, '#ff48b0');
      await page.evaluate(() => window.PageManager.saveActivePage());

      // The inks each page exports on its own, before anything is removed.
      const platesPageTwoRaw = await runExportSinglePlate(page);
      const platesPageTwo = Object.keys(platesPageTwoRaw).sort();
      await loadPageById(page, ids[0]);
      const platesPageOneRaw = await runExportSinglePlate(page);
      const platesPageOne = Object.keys(platesPageOneRaw).sort();
      await loadPageById(page, ids[1]);
      expect(platesPageOne.length).toBeGreaterThan(0);
      expect(JSON.stringify(platesPageTwoRaw)).not.toBe(JSON.stringify(platesPageOneRaw));

      // ── Delete page 2, then add a page of its own ──
      await removePage(page, ids[1]);
      await addBlankPage(page);
      const newIds = await getProjectPageIds(page);
      expect(newIds).toHaveLength(2);
      expect(newIds[0]).toBe(ids[0]);

      // Page 1 still has exactly its own layers.
      await loadPageById(page, newIds[0]);
      expect(await page.evaluate(() => window.State.layers.map(l => l.id))).toEqual(pageOneIds);

      const storedOnOne = await page.evaluate(async (pageId) => {
        const { DB } = await import('/src/app/db.js');
        const recs = await DB.getByIndex('layers', 'by-page', pageId);
        const out = [];
        for (const rec of recs) {
          const mask = await DB.get('maskBlobs', rec.id);
          const image = await DB.get('imageBlobs', rec.id);
          out.push({
            id: rec.id, pageId: rec.pageId, color: rec.color,
            separationColors: rec.separationColors || null,
            hasMask: !!mask, hasImage: !!image,
          });
        }
        return out.sort((a, b) => a.id.localeCompare(b.id));
      }, newIds[0]);
      const byId = Object.fromEntries(storedOnOne.map(l => [l.id, l]));
      for (const id of pageOneIds) expect(byId[id].pageId).toBe(newIds[0]);
      expect(byId[keepId].color).toBe('#8a8a8a');
      expect(byId[keepId].hasImage).toBe(true);
      expect(byId[maskedId].hasMask).toBe(true); // the drawn mask stayed with its layer
      expect(byId[sepId].separationColors).toEqual(sepColors);

      // The deleted page's layer and its blobs are gone.
      const leftovers = await page.evaluate(async ({ doomedId, doomedPageId }) => {
        const { DB } = await import('/src/app/db.js');
        return {
          record: await DB.get('layers', doomedId),
          image: await DB.get('imageBlobs', doomedId),
          mask: await DB.get('maskBlobs', doomedId),
          layersOnPage: (await DB.getByIndex('layers', 'by-page', doomedPageId)).length,
        };
      }, { doomedId, doomedPageId: ids[1] });
      expect(leftovers.record).toBeUndefined();
      expect(leftovers.image).toBeUndefined();
      expect(leftovers.mask).toBeUndefined();
      expect(leftovers.layersOnPage).toBe(0);

      // The new page is genuinely empty — no stale content from the removed one.
      await loadPageById(page, newIds[1]);
      await expect(page.locator('#layer-list .layer-row')).toHaveCount(0);
      expect(await page.evaluate(() => window.State.layers.length)).toBe(0);

      // Exporting page 1 gives exactly the inks it gave before the removal —
      // the removed page contributes nothing.
      await loadPageById(page, newIds[0]);
      const platesAfterRaw = await runExportSinglePlate(page);
      expect(Object.keys(platesAfterRaw).sort()).toEqual(platesPageOne);
      expect(JSON.stringify(platesAfterRaw)).toBe(JSON.stringify(platesPageOneRaw));

      // ── Everything above still holds after a reload ──
      await reopenProject(page, 'Integrity Test');
      expect(await getProjectPageIds(page)).toEqual(newIds);

      await loadPageById(page, newIds[0]);
      expect(await page.evaluate(() => window.State.layers.map(l => l.id))).toEqual(pageOneIds);
      const afterReload = await page.evaluate(async ({ pageId, maskedId }) => {
        const { DB } = await import('/src/app/db.js');
        const recs = await DB.getByIndex('layers', 'by-page', pageId);
        const sep = recs.find(r => r.isColorSeparation);
        const masked = recs.find(r => r.id === maskedId);
        return { count: recs.length, sepColors: sep?.separationColors || [], hasMask: !!masked };
      }, { pageId: newIds[0], maskedId });
      expect(afterReload.count).toBe(3);
      expect(afterReload.sepColors).toEqual(sepColors);
      expect(afterReload.hasMask).toBe(true);

      await loadPageById(page, newIds[1]);
      expect(await page.evaluate(() => window.State.layers.length)).toBe(0);
    });
  });
});
