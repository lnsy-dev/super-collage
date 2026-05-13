// @ts-check
import { expect } from '@playwright/test';

/**
 * Clean up the IndexedDB database used by the app.
 * Navigates to the app first, then clears the database.
 * Call this in beforeEach to ensure test isolation.
 */
export async function clearIndexedDB(page) {
  // Must navigate to an actual page (not about:blank) before accessing IndexedDB
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('superCollage');
      req.onsuccess = () => resolve(undefined);
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        // Force close any open connections and retry
        resolve(undefined);
      };
    });
  });
}

/**
 * Navigate to the app and wait for the project dialog to appear.
 */
export async function gotoApp(page) {
  await page.goto('/');
  await expect(page.locator('#project-dialog')).toBeVisible();
}

/**
 * Create a new project from the project dialog.
 */
export async function createProject(page, name, { pageSize = 'half-letter', orientation = 'portrait' } = {}) {
  await gotoApp(page);
  await page.fill('#new-project-name', name);
  await page.locator(`label:has(input[name="new-page-size"][value="${pageSize}"])`).click();
  await page.click('#btn-create-project');
  // Wait for main app to be visible
  await expect(page.locator('#main-app')).toBeVisible();
  if (orientation === 'landscape') {
    await page.locator('#zoom-controls [data-action="orient-landscape"]').click();
  }
}

/**
 * Add an image to the current project using the hidden file input.
 */
export async function addImage(page, imagePath) {
  // Directly set files on the hidden input — the menu approach requires opening dropdowns
  await page.setInputFiles('#file-input', imagePath);
  // Wait for layer to appear in list
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
}

/**
 * Get the currently selected layer id from the page state.
 */
export async function getSelectedLayerId(page) {
  return page.evaluate(() => {
    // @ts-ignore
    return State?.selectedId;
  });
}

/**
 * Get the number of layers.
 */
export async function getLayerCount(page) {
  return page.locator('#layer-list .layer-row').count();
}

/**
 * Select a tool by its data-tool attribute.
 */
export async function selectTool(page, toolName) {
  await page.click(`.tool-btn[data-tool="${toolName}"]`);
  await expect(page.locator(`#status-tool`)).toContainText(
    toolName === 'select' ? 'Select' :
    toolName === 'move' ? 'Move' :
    toolName === 'mask-draw' ? 'Mask Draw' :
    toolName === 'mask-erase' ? 'Mask Erase' :
    toolName === 'shape-rect' ? 'Rectangle' :
    toolName === 'shape-ellipse' ? 'Ellipse' :
    toolName === 'shape-poly' ? 'Polygon' : toolName
  );
}

/**
 * Helper: read a canvas element's pixel data.
 */
export async function getCanvasPixel(page, canvasSelector, x, y) {
  return page.evaluate(({ selector, x, y }) => {
    const canvas = document.querySelector(selector);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(x, y, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }, { selector: canvasSelector, x, y });
}

/**
 * Throttle CPU via Chrome DevTools Protocol to emulate a low-spec machine.
 * @param {import('@playwright/test').Page} page
 * @param {number} rate - Throttling rate (1 = normal, 2 = 2x slower, 4 = 4x slower)
 */
export async function throttleCPU(page, rate = 4) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate });
}
