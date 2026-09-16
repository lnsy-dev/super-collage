import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, selectTool } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Zoom Controls', () => {
  test('zoom in increases zoom level', async ({ page }) => {
    await createProject(page, 'Zoom In Test');
    await addImage(page, TEST_IMAGE);

    const initialZoom = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    await page.locator('#zoom-controls [data-action="zoom-in"]').click();

    const newZoom = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    expect(newZoom).toBeGreaterThan(initialZoom);
  });

  test('zoom out decreases zoom level', async ({ page }) => {
    await createProject(page, 'Zoom Out Test');
    await addImage(page, TEST_IMAGE);

    // First zoom in so we can zoom out
    await page.locator('#zoom-controls [data-action="zoom-in"]').click();
    const zoomedIn = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    await page.locator('#zoom-controls [data-action="zoom-out"]').click();

    const zoomedOut = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    expect(zoomedOut).toBeLessThan(zoomedIn);
  });

  test('fit to window sets reasonable zoom', async ({ page }) => {
    await createProject(page, 'Zoom Fit Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#zoom-controls [data-action="zoom-fit"]').click();

    const zoom = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThanOrEqual(2);
  });

  test('actual size sets zoom to 100%', async ({ page }) => {
    await createProject(page, 'Zoom 100 Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#zoom-controls [data-action="zoom-100"]').click();

    const zoom = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    expect(zoom).toBe(1);
    await expect(page.locator('#zoom-display')).toHaveText('100%');
    await expect(page.locator('#status-zoom')).toHaveText('100%');
  });

  test('zoom display updates after zoom change', async ({ page }) => {
    await createProject(page, 'Zoom Display Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#zoom-controls [data-action="zoom-100"]').click();
    await expect(page.locator('#zoom-display')).toHaveText('100%');

    await page.locator('#zoom-controls [data-action="zoom-in"]').click();
    const zoomText = await page.locator('#zoom-display').textContent();
    expect(zoomText).not.toBe('100%');
  });
});

test.describe('Zoom Tool', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('z key activates the zoom tool, shift+z too', async ({ page }) => {
    await createProject(page, 'Zoom Tool Key');

    await page.keyboard.press('z');
    await expect(page.locator('#status-tool')).toHaveText('Zoom');
    await expect(page.locator('.tool-btn[data-tool="zoom"]')).toHaveClass(/active/);

    // Switch away and back via shift+z — still the zoom tool.
    await page.keyboard.press('v');
    await expect(page.locator('#status-tool')).toHaveText('Select');
    await page.keyboard.press('Shift+z');
    await expect(page.locator('#status-tool')).toHaveText('Zoom');
  });

  test('clicking zooms in around the clicked point', async ({ page }) => {
    await createProject(page, 'Zoom Tool In');
    await addImage(page, TEST_IMAGE);

    await selectTool(page, 'zoom');

    // At 100% the canvas is much larger than the viewport, so there is room
    // to scroll in every direction and the anchor can hold exactly.
    await page.locator('#zoom-controls [data-action="zoom-100"]').click();
    const initialZoom = await page.evaluate(() => State.zoom);

    const box = await page.locator('#canvas-scroll').boundingBox();
    const vx = box.width * 0.4, vy = box.height * 0.4;
    const clickX = box.x + vx, clickY = box.y + vy;

    // Page-space point under the click before zooming.
    const pagePtBefore = await page.evaluate(({ cx, cy }) => {
      const r = window.overlayCanvas.getBoundingClientRect();
      return {
        px: (cx - r.left) / State.zoom - 1000,
        py: (cy - r.top) / State.zoom - 1000,
      };
    }, { cx: clickX, cy: clickY });

    await page.mouse.click(clickX, clickY);

    const after = await page.evaluate(({ px, py }) => {
      const sRect = document.getElementById('canvas-scroll').getBoundingClientRect();
      const r = window.overlayCanvas.getBoundingClientRect();
      return {
        zoom: State.zoom,
        // Where that same page point now sits within the scroll viewport.
        nvx: r.left + (px + 1000) * State.zoom - sRect.left,
        nvy: r.top + (py + 1000) * State.zoom - sRect.top,
      };
    }, pagePtBefore);

    expect(after.zoom).toBeCloseTo(initialZoom * 1.25, 5);
    // The clicked page point should still be (near) the cursor.
    expect(after.nvx).toBeCloseTo(vx, 0);
    expect(after.nvy).toBeCloseTo(vy, 0);
  });

  test('shift+click zooms out around the clicked point', async ({ page }) => {
    await createProject(page, 'Zoom Tool Out');
    await addImage(page, TEST_IMAGE);

    await selectTool(page, 'zoom');
    await page.locator('#zoom-controls [data-action="zoom-100"]').click();
    const initialZoom = await page.evaluate(() => State.zoom);

    const box = await page.locator('#canvas-scroll').boundingBox();
    const clickX = box.x + box.width * 0.6;
    const clickY = box.y + box.height * 0.6;

    await page.keyboard.down('Shift');
    await page.mouse.click(clickX, clickY);
    await page.keyboard.up('Shift');

    const newZoom = await page.evaluate(() => State.zoom);
    expect(newZoom).toBeCloseTo(initialZoom / 1.25, 5);
  });

  test('zoom tool never changes selection or layers', async ({ page }) => {
    await createProject(page, 'Zoom Tool Inert');
    await addImage(page, TEST_IMAGE);

    await selectTool(page, 'zoom');
    const before = await page.evaluate(() => ({
      selectedId: State.selectedId,
      count: State.layers.length,
      undo: State.undoStack.length,
    }));

    const box = await page.locator('#canvas-scroll').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const after = await page.evaluate(() => ({
      selectedId: State.selectedId,
      count: State.layers.length,
      undo: State.undoStack.length,
    }));
    expect(after.count).toBe(before.count);
    expect(after.undo).toBe(before.undo);
    expect(after.selectedId).toBe(before.selectedId);
  });
});
