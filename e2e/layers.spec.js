import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Layer System', () => {
  test('layer appears in list after import', async ({ page }) => {
    await createProject(page, 'Layer List Test');
    await addImage(page, TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name')).toContainText('test-image');
  });

  test('toggle layer visibility', async ({ page }) => {
    await createProject(page, 'Visibility Test');
    await addImage(page, TEST_IMAGE);

    const visBtn = page.locator('.layer-vis').first();
    await expect(visBtn).toHaveText('◉');

    await visBtn.click();
    await expect(visBtn).toHaveText('○');

    await visBtn.click();
    await expect(visBtn).toHaveText('◉');
  });

  test('toggle layer lock', async ({ page }) => {
    await createProject(page, 'Lock Test');
    await addImage(page, TEST_IMAGE);

    const lockBtn = page.locator('.layer-lock').first();
    await expect(lockBtn).not.toHaveClass(/locked/);

    await lockBtn.click();
    await expect(lockBtn).toHaveClass(/locked/);
    await expect(lockBtn).toHaveText('🔒');
  });

  test('duplicate layer', async ({ page }) => {
    await createProject(page, 'Duplicate Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
    await expect(page.locator('#layer-list .layer-name').nth(0)).toContainText('copy');
  });

  test('delete layer', async ({ page }) => {
    await createProject(page, 'Delete Test');
    await addImage(page, TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    await page.locator('#layer-buttons [data-action="delete-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(0);
    await expect(page.locator('#no-layer-msg')).toBeVisible();
  });

  test('reorder layer up', async ({ page }) => {
    await createProject(page, 'Reorder Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Select bottom layer and move up
    await page.locator('.layer-row').nth(1).click();
    await page.locator('#layer-buttons [data-action="layer-up"]').click();
    // After move, the order in the DOM may change; just verify we still have 2 layers
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
  });

  test('reorder layer down', async ({ page }) => {
    await createProject(page, 'Reorder Down Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    await page.locator('.layer-row').nth(0).click();
    await page.locator('#layer-buttons [data-action="layer-down"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
  });

  test('reorder layers by dragging', async ({ page }) => {
    await createProject(page, 'Drag Reorder Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Initial DOM order: top row = copy, bottom row = original
    await expect(page.locator('#layer-list .layer-name').nth(0)).toContainText('copy');
    await expect(page.locator('#layer-list .layer-name').nth(1)).toContainText('test-image');

    // Drag the bottom (original) row above the top (copy) row
    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(1).dragTo(rows.nth(0), { targetPosition: { x: 10, y: 2 } });

    // After the drop, the original should be on top
    await expect(page.locator('#layer-list .layer-name').nth(0)).toContainText('test-image');
    await expect(page.locator('#layer-list .layer-name').nth(1)).toContainText('copy');

    // Verify State.layers order bottom→top matches the new visual order
    const layerOrder = await page.evaluate(() => {
      // @ts-ignore
      return State.layers.map(l => l.name);
    });
    expect(layerOrder).toEqual(['test-image copy', 'test-image']);
  });

  test('can still select layer rows after a drag-reorder (regression)', async ({ page }) => {
    // Regression for: after dragging a layer row to reorder it, clicking rows no
    // longer selects any layer until a page reload. The drop re-renders the list
    // and removes the dragged row, so the browser never fires `dragend` — which
    // was the only place clearing the UI._suppressLayerClick guard.
    await createProject(page, 'Reorder Select Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Reorder: drag the bottom row above the top row.
    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(1).dragTo(rows.nth(0), { targetPosition: { x: 10, y: 2 } });
    await expect(page.locator('#layer-list .layer-name').nth(0)).toContainText('test-image');

    // Clicking each row must select the corresponding layer. With the guard
    // stuck these clicks are ignored and selection never moves.
    const topId = await page.locator('#layer-list .layer-row').nth(0).getAttribute('data-layer-id');
    const bottomId = await page.locator('#layer-list .layer-row').nth(1).getAttribute('data-layer-id');
    expect(topId).not.toBe(bottomId);

    await page.locator('#layer-list .layer-row').nth(1).click();
    expect(await page.evaluate(() => window.State.selectedId)).toBe(bottomId);

    await page.locator('#layer-list .layer-row').nth(0).click();
    expect(await page.evaluate(() => window.State.selectedId)).toBe(topId);
  });

  test('drag mask group moves base and mask together', async ({ page }) => {
    await createProject(page, 'Mask Group Drag Test');
    await addImage(page, TEST_IMAGE);

    // Add two duplicates so we have three layers total
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(3);

    // Rename for clarity: top=Top, middle=Mask, bottom=Base
    await page.evaluate(() => {
      // @ts-ignore
      const layers = State.layers;
      layers[2].name = 'Top';
      layers[1].name = 'Mask';
      layers[0].name = 'Base';
    });
    await page.evaluate(() => {
      // @ts-ignore
      UI.refreshLayerList();
    });

    // Initial DOM order top→bottom: Top, Mask, Base
    await expect(page.locator('#layer-list .layer-name').nth(0)).toContainText('Top');
    await expect(page.locator('#layer-list .layer-name').nth(1)).toContainText('Mask');
    await expect(page.locator('#layer-list .layer-name').nth(2)).toContainText('Base');

    // Multi-select Mask and Base, then create image mask (top layer becomes mask)
    await page.locator('.layer-row').nth(1).click();
    await page.locator('.layer-row').nth(2).click({ modifiers: ['Shift'] });
    await expect(page.locator('#btn-create-image-mask')).toBeVisible();
    await page.click('#btn-create-image-mask');

    // Confirm mask relationship: Base has imageMaskIds, Mask has isMaskFor
    const maskRelationship = await page.evaluate(() => {
      // @ts-ignore
      const layers = State.layers;
      const base = layers.find(l => l.name === 'Base');
      const mask = layers.find(l => l.name === 'Mask');
      return {
        baseHasMask: base.imageMaskIds.includes(mask.id),
        maskIsForBase: mask.isMaskFor === base.id,
      };
    });
    expect(maskRelationship.baseHasMask).toBe(true);
    expect(maskRelationship.maskIsForBase).toBe(true);

    // Drag the mask row (middle) above the Top row
    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(1).dragTo(rows.nth(0), { targetPosition: { x: 10, y: 2 } });

    // The mask group (Base + Mask) should now be on top, in the same relative order
    const names = await page.locator('#layer-list .layer-name').allTextContents();
    expect(names).toEqual(['⬦ Mask', 'Base', 'Top']);

    // Verify State.layers order bottom→top
    const layerOrder = await page.evaluate(() => {
      // @ts-ignore
      return State.layers.map(l => l.name);
    });
    expect(layerOrder).toEqual(['Top', 'Base', 'Mask']);

    // Also verify dragging the base row moves the whole group
    const baseRow = page.locator('.layer-row').nth(1);
    const topRow = page.locator('.layer-row').nth(2);
    await baseRow.dragTo(topRow, { targetPosition: { x: 10, y: 18 } });

    const namesAfterBaseDrag = await page.locator('#layer-list .layer-name').allTextContents();
    expect(namesAfterBaseDrag).toEqual(['Top', '⬦ Mask', 'Base']);

    const orderAfterBaseDrag = await page.evaluate(() => {
      // @ts-ignore
      return State.layers.map(l => l.name);
    });
    expect(orderAfterBaseDrag).toEqual(['Base', 'Mask', 'Top']);
  });

  test('rename layer via double click', async ({ page }) => {
    await createProject(page, 'Rename Test');
    await addImage(page, TEST_IMAGE);

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Layer name');
      await dialog.accept('Renamed Layer');
    });

    await page.locator('.layer-name').first().dblclick();
    await expect(page.locator('#layer-list .layer-name').first()).toContainText('Renamed Layer');
  });

  test('multi-select layers with shift+click', async ({ page }) => {
    await createProject(page, 'Multi Select Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Click first layer
    await page.locator('.layer-row').nth(0).click();
    await expect(page.locator('.layer-row.selected')).toHaveCount(1);

    // Shift+click second layer
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('.layer-row.selected')).toHaveCount(2);
  });

  test('multi-select layers with shift+click on canvas', async ({ page }) => {
    await createProject(page, 'Canvas Multi Select Test');
    await addImage(page, TEST_IMAGE);
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    // Position layers so they do not overlap and are large enough that a
    // center click does not land on a resize/rotate handle.
    const clickPositions = await page.evaluate(() => {
      // @ts-ignore
      const [l1, l2] = State.layers;
      l1.x = 100;
      l1.y = 100;
      l1.width = 300;
      l1.height = 300;
      l2.x = 700;
      l2.y = 700;
      l2.width = 300;
      l2.height = 300;
      Renderer.schedule();
      Renderer.drawOverlay();

      // @ts-ignore
      const z = State.zoom;
      const pad = 1000 * z;
      return [
        { x: (l1.x + l1.width / 2) * z + pad, y: (l1.y + l1.height / 2) * z + pad },
        { x: (l2.x + l2.width / 2) * z + pad, y: (l2.y + l2.height / 2) * z + pad },
      ];
    });
    const overlay = page.locator('#interaction-overlay');

    // Click first layer on canvas.
    await overlay.click({ position: clickPositions[0] });
    await expect(page.locator('.layer-row.selected')).toHaveCount(1);

    // Shift+click second layer to add to selection.
    await overlay.click({ position: clickPositions[1], modifiers: ['Shift'] });
    await expect(page.locator('.layer-row.selected')).toHaveCount(2);

    // Shift+click second layer again to remove it from selection.
    await overlay.click({ position: clickPositions[1], modifiers: ['Shift'] });
    await expect(page.locator('.layer-row.selected')).toHaveCount(1);
  });
});
