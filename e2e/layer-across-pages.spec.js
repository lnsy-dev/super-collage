import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, loadPageById, getProjectPageIds } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Drag layers across pages', () => {
  test('drag layer from page 1 to page 2', async ({ page }) => {
    await createProject(page, 'Cross Page Drag', { pageCount: 1 });

    // Add a second page so we have two single-page units.
    await page.evaluate(async () => {
      const p0 = window.State.pages[0];
      await window.PageManager.addBlankPageToProject(window.State.project.id, p0.width, p0.height);
      window.UI.refreshPageList();
    });
    await expect(page.locator('#page-list .page-row')).toHaveCount(2);
    const pageIds = await getProjectPageIds(page);
    expect(pageIds.length).toBe(2);

    // Add an image to page 1.
    await addImage(page, TEST_IMAGE);
    const layerId = await page.evaluate(() => window.State.selectedId);
    expect(layerId).toBeTruthy();

    // Drag the layer row onto the second page row.
    const layerRow = page.locator('#layer-list .layer-row').first();
    const pageRow = page.locator('#page-list .page-row').nth(1);
    await layerRow.dragTo(pageRow, { targetPosition: { x: 10, y: 10 } });

    // Page 1 should now be empty.
    await loadPageById(page, pageIds[0]);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(0);

    // Page 2 should contain the moved layer.
    await loadPageById(page, pageIds[1]);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    // Persisted pageId should match page 2.
    const persistedPageId = await page.evaluate(async (id) => {
      const { DB } = await import('/src/app/db.js');
      const rec = await DB.get('layers', id);
      return rec?.pageId;
    }, layerId);
    expect(persistedPageId).toBe(pageIds[1]);
  });

  test('drag layer onto right half of spread row lands on right page', async ({ page }) => {
    // 4-page saddle-stitch gives two spread rows: cover (4,1) and centre (2,3).
    await createProject(page, 'Spread Drop', { pageCount: 4 });
    const pageIds = await getProjectPageIds(page);
    expect(pageIds.length).toBe(4);

    // Add an image to the cover spread (it lands on the left page, page 4).
    await addImage(page, TEST_IMAGE);
    const layerId = await page.evaluate(() => window.State.selectedId);

    // Drag onto the right side of the second spread row (centre spread, page 3).
    const layerRow = page.locator('#layer-list .layer-row').first();
    const centreSpreadRow = page.locator('#page-list .page-row').nth(1);
    const box = await centreSpreadRow.boundingBox();
    expect(box).toBeTruthy();
    await layerRow.dragTo(centreSpreadRow, {
      targetPosition: { x: Math.round(box.width * 0.75), y: Math.round(box.height / 2) },
    });

    // The cover spread (left page) should now be empty.
    await page.locator('#page-list .page-row').first().click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(0);

    // Clicking the second spread row should show the moved layer.
    await page.locator('#page-list .page-row').nth(1).click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const persistedPageId = await page.evaluate(async (id) => {
      const { DB } = await import('/src/app/db.js');
      const rec = await DB.get('layers', id);
      return rec?.pageId;
    }, layerId);
    expect(persistedPageId).toBe(pageIds[2]); // page 3 is index 2
  });

  test('drag layer to other page of same spread keeps it in view', async ({ page }) => {
    // 4-page saddle-stitch gives two spread rows: cover (4,1) and centre (2,3).
    await createProject(page, 'Same Spread Drop', { pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    // Load the centre spread and add an image (lands on left page, page 2).
    await page.locator('#page-list .page-row').nth(1).click();
    await expect(page.locator('#canvas-title')).toContainText('Page 2 + Page 3');
    await addImage(page, TEST_IMAGE);
    const layerId = await page.evaluate(() => window.State.selectedId);

    // Drag onto the right half of the same spread row to move to page 3.
    const layerRow = page.locator('#layer-list .layer-row').first();
    const centreSpreadRow = page.locator('#page-list .page-row').nth(1);
    const box = await centreSpreadRow.boundingBox();
    expect(box).toBeTruthy();
    await layerRow.dragTo(centreSpreadRow, {
      targetPosition: { x: Math.round(box.width * 0.75), y: Math.round(box.height / 2) },
    });

    // The layer should still be listed because we are still viewing the spread.
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    const persistedPageId = await page.evaluate(async (id) => {
      const { DB } = await import('/src/app/db.js');
      const rec = await DB.get('layers', id);
      return rec?.pageId;
    }, layerId);
    expect(persistedPageId).toBe(pageIds[2]); // page 3 is index 2
  });

  test('drag layer with image mask moves both layers to target page', async ({ page }) => {
    await createProject(page, 'Mask Cross Page', { pageCount: 1 });
    await page.evaluate(async () => {
      const p0 = window.State.pages[0];
      await window.PageManager.addBlankPageToProject(window.State.project.id, p0.width, p0.height);
      window.UI.refreshPageList();
    });
    await expect(page.locator('#page-list .page-row')).toHaveCount(2);
    const pageIds = await getProjectPageIds(page);

    // Add two images to page 1 and create an image mask relationship.
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
    await page.evaluate(async () => {
      const layers = window.State.layers;
      const base = layers[0];
      const mask = layers[1];
      window.State.selectedIds = [base.id, mask.id];
      window.State.selectedId = mask.id;
      await window.handleAction('create-image-mask');
    });

    const beforeState = await page.evaluate(() => {
      const base = window.State.layers.find(l => l.imageMaskIds?.length);
      const mask = window.State.layers.find(l => l.isMaskFor);
      return { baseId: base?.id, maskId: mask?.id, basePageId: base?.pageId };
    });
    expect(beforeState.baseId).toBeTruthy();
    expect(beforeState.maskId).toBeTruthy();

    // Drag the mask row onto page 2.
    const maskRow = page.locator('#layer-list .layer-row').first();
    const page2Row = page.locator('#page-list .page-row').nth(1);
    await maskRow.dragTo(page2Row, { targetPosition: { x: 10, y: 10 } });

    // Page 1 should now be empty.
    await loadPageById(page, pageIds[0]);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(0);

    // Page 2 should contain both layers and preserve the mask relationship.
    await loadPageById(page, pageIds[1]);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    const afterState = await page.evaluate(async ({ baseId, maskId }) => {
      const { DB } = await import('/src/app/db.js');
      const baseRec = await DB.get('layers', baseId);
      const maskRec = await DB.get('layers', maskId);
      return {
        basePageId: baseRec?.pageId,
        maskPageId: maskRec?.pageId,
        baseHasMask: baseRec?.imageMaskIds?.includes(maskId),
        maskIsForBase: maskRec?.isMaskFor === baseId,
      };
    }, beforeState);
    expect(afterState.basePageId).toBe(pageIds[1]);
    expect(afterState.maskPageId).toBe(pageIds[1]);
    expect(afterState.baseHasMask).toBe(true);
    expect(afterState.maskIsForBase).toBe(true);
  });
});
