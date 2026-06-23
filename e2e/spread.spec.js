import { test, expect } from '@playwright/test';
import { clearIndexedDB, gotoApp, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Spreads', () => {
  test('computeSpreads produces full saddle-stitch reader spreads', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeSpreads } = await import('/src/app/spread-manager.js');
      const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const spreads = computeSpreads(ids, 'saddle-stitch');
      return spreads.map(s => s.pageIds);
    });
    expect(result).toEqual([
      ['p8', 'p1'],
      ['p2', 'p7'],
      ['p6', 'p3'],
      ['p4', 'p5'],
    ]);
  });

  test('computeViewUnits exposes only cover and centre spreads', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeViewUnits } = await import('/src/app/spread-manager.js');
      const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const units = computeViewUnits(ids, 'saddle-stitch');
      return units.map(u => ({ type: u.type, ids: u.type === 'spread' ? u.pageIds : [u.pageId] }));
    });
    // 8-page in page-number order: cover (8,1), singles 2,3, centre (4,5), singles 6,7.
    expect(result).toEqual([
      { type: 'spread', ids: ['p8', 'p1'] },
      { type: 'page', ids: ['p2'] },
      { type: 'page', ids: ['p3'] },
      { type: 'spread', ids: ['p4', 'p5'] },
      { type: 'page', ids: ['p6'] },
      { type: 'page', ids: ['p7'] },
    ]);
  });

  test('computeViewUnits returns all singles for no binding', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeViewUnits } = await import('/src/app/spread-manager.js');
      const ids = ['p1', 'p2', 'p3', 'p4'];
      const units = computeViewUnits(ids, 'none');
      return units.map(u => u.type);
    });
    expect(result).toEqual(['page', 'page', 'page', 'page']);
  });

  test('4-page booklet treats every page as a spread', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeViewUnits } = await import('/src/app/spread-manager.js');
      const ids = ['p1', 'p2', 'p3', 'p4'];
      const units = computeViewUnits(ids, 'saddle-stitch');
      return units.map(u => ({ type: u.type, ids: u.pageIds }));
    });
    expect(result).toEqual([
      { type: 'spread', ids: ['p4', 'p1'] },
      { type: 'spread', ids: ['p2', 'p3'] },
    ]);
  });

  test('opening a saddle-stitch project loads the cover spread', async ({ page }) => {
    await createProject(page, 'Cover Spread', { pageCount: 8 });
    await page.waitForTimeout(200);

    const title = await page.locator('#canvas-title').textContent();
    expect(title).toContain('+');
    expect(title).toContain('Page 8');
    expect(title).toContain('Page 1');
  });

  test('page list marks only cover and centre as spreads', async ({ page }) => {
    await createProject(page, 'Spread List', { pageCount: 8 });
    await page.waitForTimeout(200);

    const meta = await page.locator('#page-list .page-spread-meta').allTextContents();
    // Unit order for 8-page saddle-stitch in page-number order: spread, page, page, spread, page, page.
    expect(meta).toEqual(['S', '', '', 'S', '', '']);
  });

  test('clicking the centre spread loads it as one canvas', async ({ page }) => {
    await createProject(page, 'Centre Spread', { pageCount: 8 });
    await page.waitForTimeout(200);

    // Centre spread is the 4th unit in page-number order.
    await page.locator('#page-list .page-row').nth(3).click();
    await expect(page.locator('#canvas-title')).toContainText('Page 4 + Page 5');
  });

  test('clicking a single page unit loads it normally', async ({ page }) => {
    await createProject(page, 'Single Unit', { pageCount: 8 });
    await page.waitForTimeout(200);

    // Click the second unit (single page 2).
    await page.locator('#page-list .page-row').nth(1).click();
    await expect(page.locator('#canvas-title')).toContainText('Page 2');
    await expect(page.locator('#canvas-title')).not.toContainText('+');
  });

});
