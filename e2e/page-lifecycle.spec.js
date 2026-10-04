import { test, expect } from '@playwright/test';
import fs from 'fs/promises';
import sharp from 'sharp';
import {
  clearIndexedDB, createProject, addTextLayer, addSolidColorImage,
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

/** Size and ink position of a downloaded plate, read from the PNG itself. */
async function plateSignature(download) {
  const buf = await fs.readFile(await download.path());
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  let ink = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    const row = y * info.width;
    for (let x = 0; x < info.width; x++) {
      if (data[row + x] < 128) {
        ink++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { width: info.width, height: info.height, ink, minX, minY, maxX, maxY };
}

/**
 * Run the user-facing export flow and collect every plate it downloads,
 * however many that is — a plate that should not be there has to show up
 * as an extra entry, so the run is followed to its Done! report.
 */
async function exportPlatesViaDialog(page) {
  await page.click('.menu-item[data-menu="file"]');
  await page.click('[data-action="export"]');
  await expect(page.locator('#export-dialog')).toBeVisible();
  await page.selectOption('#export-target-size', 'letter');

  const downloads = [];
  page.on('download', d => downloads.push(d));
  await page.click('#btn-export-go');
  await expect(page.locator('#export-progress .export-progress-label'))
    .toContainText('Done!', { timeout: 30000 });

  return { names: downloads.map(d => d.suggestedFilename()), downloads };
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

/* ─── ADD / REMOVE / EXPORT REGRESSION ─────────────────────────────
   One run through the whole workflow a user performs: build pages with
   different plate content, strip pages away with the Pages panel, then
   export what is left through the real export dialog and look at the
   downloaded PNGs. */

test.describe('add / remove / export regression', () => {
  test('export carries the surviving page only, before and after a reload', async ({ page }) => {
    await createProject(page, 'Export Regression', { pageSize: 'half-letter', pageCount: 1 });

    /** Append a page and fill it with full-bleed art in its own ink. */
    const addFullBleedPage = async (color) => {
      await addBlankPage(page);
      const ids = await getProjectPageIds(page);
      await loadPageById(page, ids[ids.length - 1]);
      await addSolidColorImage(page, '#000000', { width: 3300, height: 5100 });
      await setLayerColorDirect(page, color);
      await page.evaluate(() => window.PageManager.saveActivePage());
    };

    // Pages 2–4 hold full-bleed art; page 5's colour separation comes next.
    await addSolidColorImage(page, '#000000', { width: 3300, height: 5100 });
    await setLayerColorDirect(page, '#0078bf');
    await page.evaluate(() => window.PageManager.saveActivePage());
    await addFullBleedPage('#f65058');
    await addBlankPage(page);
    const sepPageId = (await getProjectPageIds(page))[2];
    await loadPageById(page, sepPageId);
    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');
    await page.setInputFiles('#color-sep-input', {
      name: 'sep.png', mimeType: 'image/png', buffer: createMultiColorPngBuffer(120, 120),
    });
    await page.waitForFunction(() => window.State.layers.some(l => l.isColorSeparation), null, { timeout: 20000 });
    await page.evaluate(() => window.PageManager.saveActivePage());
    await addFullBleedPage('#00a95c');

    // The page that survives: a single small square, well inside the page.
    await addBlankPage(page);
    const survivorId = (await getProjectPageIds(page))[4];
    await loadPageById(page, survivorId);
    await addSolidColorImage(page, '#000000', { width: 600, height: 600 });
    await setLayerColorDirect(page, '#5ec8e5');
    await page.evaluate(async () => {
      const l = window.State.layers.find(x => x.id === window.State.selectedId);
      l.x = 1200; l.y = 2000;
      l._dirty = true;
      await window.DB.saveLayer(l);
      await window.PageManager.saveActivePage();
    });
    expect(await getProjectPageIds(page)).toHaveLength(5);
    const doomedIds = (await getProjectPageIds(page)).slice(0, 4);

    // ── Strip the first folio through the Pages panel ──
    await page.click('[data-action="remove-folio"]');
    await expect(page.locator('#remove-folio-dialog')).toBeVisible();
    await page.locator('.folio-row').first().click();
    await page.click('#btn-confirm-remove-folio');
    await expect(page.locator('#remove-folio-dialog')).toBeHidden();

    // The dialog closes before the records are swept, so wait for the
    // removal to land rather than assuming it already has.
    await expect.poll(() => getProjectPageIds(page), { timeout: 15000 }).toEqual([survivorId]);
    await expect.poll(() => listedPages(page)).toEqual(['Page 5']);
    expect(await page.evaluate(() => window.State.pageId)).toBe(survivorId);
    const leftover = await page.evaluate(async ({ pageId, doomed }) => {
      const { DB } = await import('/src/app/db.js');
      const recs = await DB.getByIndex('layers', 'by-page', pageId);
      const doomedLayers = [];
      for (const id of doomed) {
        doomedLayers.push((await DB.getByIndex('layers', 'by-page', id)).length);
      }
      return {
        layers: recs.length,
        doomedPages: await Promise.all(doomed.map(id => DB.get('pages', id))),
        doomedLayers,
      };
    }, { pageId: survivorId, doomed: doomedIds });
    expect(leftover.layers).toBe(1);
    expect(leftover.doomedPages.every(p => p === undefined)).toBe(true);
    expect(leftover.doomedLayers).toEqual([0, 0, 0, 0]);

    // ── Export what is left, through the real dialog ──
    // A 3300×5100 page centred on a 5100×6600 letter sheet, so the square
    // at page (1200, 2000)–(1800, 2600) lands at (2100, 2750)–(2700, 3350).
    const first = await exportPlatesViaDialog(page);
    expect(first.names.length).toBeGreaterThan(0);
    for (const n of first.names) expect(n).toMatch(/^export-regression-.*\.png$/);
    for (const d of first.downloads) {
      const sig = await plateSignature(d);
      expect(sig.width).toBe(5100);
      expect(sig.height).toBe(6600);
      expect(sig.ink).toBeGreaterThan(0);
      // Only the small square — no full-bleed ink from a removed page.
      expect(sig.ink / (sig.width * sig.height)).toBeLessThan(0.02);
      expect(Math.abs(sig.minX - 2100)).toBeLessThan(20);
      expect(Math.abs(sig.minY - 2750)).toBeLessThan(20);
      expect(Math.abs(sig.maxX - 2700)).toBeLessThan(20);
      expect(Math.abs(sig.maxY - 3350)).toBeLessThan(20);
    }

    // ── Same again after a reload ──
    await reopenProject(page, 'Export Regression');
    expect(await getProjectPageIds(page)).toEqual([survivorId]);
    expect(await page.evaluate(() => window.State.pageId)).toBe(survivorId);

    const second = await exportPlatesViaDialog(page);
    expect(second.names).toEqual(first.names);
    for (const d of second.downloads) {
      const sig = await plateSignature(d);
      expect(sig.ink).toBeGreaterThan(0);
      expect(sig.ink / (sig.width * sig.height)).toBeLessThan(0.02);
      expect(Math.abs(sig.minY - 2750)).toBeLessThan(20);
    }
  });
});
