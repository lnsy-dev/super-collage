import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

const RIGHT_HANDLE = '#right-sidebar-handle';

async function workspaceBox(page) {
  return page.locator('#workspace').boundingBox();
}

async function barWidth(page, selector) {
  return page.evaluate(sel => document.querySelector(sel).offsetWidth, selector);
}

/** Drag a handle horizontally by dx from its vertical center. */
async function dragHandle(page, selector, dx) {
  const box = await page.locator(selector).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 6 });
  await page.mouse.up();
}

test.describe('Sidebar resize & collapse handles', () => {
  test('handles sit in the vertical middle of the workspace', async ({ page }) => {
    await createProject(page, 'Handle Placement');

    const ws = await workspaceBox(page);
    const wsCenterY = ws.y + ws.height / 2;
    for (const sel of [RIGHT_HANDLE]) {
      const box = await page.locator(sel).boundingBox();
      expect(box).not.toBeNull();
      const centerY = box.y + box.height / 2;
      expect(Math.abs(centerY - wsCenterY)).toBeLessThanOrEqual(2);
    }
  });

  test('dragging the right handle resizes the right sidebar', async ({ page }) => {
    await createProject(page, 'Right Resize');
    expect(await barWidth(page, '#right-panel')).toBe(336);

    // Drag the handle left: the right sidebar grows.
    await dragHandle(page, RIGHT_HANDLE, -100);
    const grown = await barWidth(page, '#right-panel');
    expect(grown).toBeGreaterThanOrEqual(430);
    expect(grown).toBeLessThanOrEqual(436);

    // Drag the handle right: the right sidebar shrinks.
    await dragHandle(page, RIGHT_HANDLE, 60);
    const shrunk = await barWidth(page, '#right-panel');
    expect(Math.abs(shrunk - (grown - 60))).toBeLessThanOrEqual(2);
  });

  test('dragging the right sidebar past the max clamps at 520px', async ({ page }) => {
    await createProject(page, 'Right Clamp');
    await dragHandle(page, RIGHT_HANDLE, -600);
    expect(await barWidth(page, '#right-panel')).toBe(520);
  });

  test('clicking the right handle toggles the right sidebar', async ({ page }) => {
    await createProject(page, 'Right Toggle');
    expect(await barWidth(page, '#right-panel')).toBe(336);

    // Click: collapse to zero width.
    const box = await page.locator(RIGHT_HANDLE).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => barWidth(page, '#right-panel')).toBe(0);
    await expect(page.locator('#right-panel')).toHaveClass(/collapsed/);

    // Click again (re-query: after collapsing, the handle shifts toward the
    // workspace edge as the canvas widens): restore the remembered width.
    const box2 = await page.locator(RIGHT_HANDLE).boundingBox();
    await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await expect.poll(() => barWidth(page, '#right-panel')).toBe(336);
  });

});
