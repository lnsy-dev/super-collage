import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addTextLayer,
  addBlankPage, getProjectPageIds, getStoredPages, reopenProject,
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
});
