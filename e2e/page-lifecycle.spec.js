import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addTextLayer,
  addBlankPage, removePage, getProjectPageIds, getStoredPages, reopenProject,
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
});
