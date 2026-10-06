import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, getProjectPageIds, loadPageById,
  addImageFromBuffer, createSolidPngBuffer, setLayerColorDirect,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

// Three inks, one solid layer each. Small artwork keeps the test quick: the
// per-plate cost that matters here is the page-sized canvas work, not the
// source bitmap size.
const INKS = ['#FF0000', '#00FF00', '#0000FF'];

/** Give every page one layer per ink, so each page carries all three plates. */
async function buildThreeInkPages(page) {
  const pageIds = await getProjectPageIds(page);
  for (const id of pageIds) {
    await loadPageById(page, id);
    for (const ink of INKS) {
      await addImageFromBuffer(page, createSolidPngBuffer('#000000', 900, 900), { name: 'ink.png' });
      await setLayerColorDirect(page, ink);
    }
    await page.evaluate(() => window.PageManager.saveActivePage());
  }
  return pageIds;
}

test.describe('Streaming export', () => {
  test('renders one plate at a time and decodes only what each plate needs', async ({ page }) => {
    test.setTimeout(180000);
    await createProject(page, 'Streaming Export', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await buildThreeInkPages(page);
    expect(pageIds).toHaveLength(4);

    // Count layer decodes: the streaming path hydrates a layer once per ink it
    // prints in, instead of hydrating every layer on a page for every plate.
    await page.evaluate(async () => {
      const { PageManager } = await import('/src/app/page-manager.js');
      window.__hydrations = 0;
      const hydrate = PageManager.hydrateLayer.bind(PageManager);
      PageManager.hydrateLayer = async (rec) => {
        window.__hydrations++;
        return hydrate(rec);
      };
    });

    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();
    await page.locator('input[name="export-booklet-layout"][value="folio"]').click();
    await page.selectOption('#export-target-size', 'letter');

    const downloads = [];
    page.on('download', d => downloads.push(d));
    await page.click('#btn-export-go');
    await expect(page.locator('#export-progress .export-progress-label'))
      .toContainText('Done!', { timeout: 150000 });

    // 4 pages impose as one sheet: 2 sides × 3 inks.
    expect(downloads.length).toBe(6);
    for (const d of downloads) expect(d.suggestedFilename()).toMatch(/\.png$/);

    const stats = await page.evaluate(async () => {
      const { ExportEngine } = await import('/src/app/export-engine.js');
      return { peak: ExportEngine._peakLivePlates, hydrations: window.__hydrations };
    });

    // The invariant this test exists for: a plate is drawn and released before
    // the next one is rendered, whatever the book length or ink count.
    expect(stats.peak).toBeLessThanOrEqual(1);
    // One decode per layer — each layer prints in exactly one ink here.
    expect(stats.hydrations).toBe(pageIds.length * INKS.length);
  });
});
