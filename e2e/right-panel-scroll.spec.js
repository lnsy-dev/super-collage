// @ts-check
import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

const GRIP = '#layers-window .panel-row-handle';

async function dragHandle(page, dy) {
  const box = await page.locator(GRIP).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe('Right panel scroll after layer resize', () => {
  test('properties keep full content height and panel scrolls', async ({ page }) => {
    await createProject(page, 'Right Panel Scroll');
    // Make the properties content tall so it must not be clipped.
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.height = '600px';
      el.textContent = 'TALL PROPS';
      document.getElementById('properties-content').appendChild(el);
    });

    await dragHandle(page, 180);
    await page.waitForTimeout(500);

    const info = await page.evaluate(() => {
      const panel = document.getElementById('right-panel');
      return {
        scrollable: panel.scrollHeight > panel.clientHeight,
        propsH: document.getElementById('properties-window').offsetHeight,
        propsContentH: document.getElementById('properties-content').scrollHeight,
      };
    });
    expect(info.scrollable, 'panel should be scrollable after resizing layers').toBe(true);
    expect(info.propsH, 'properties window should not clip its content').toBeGreaterThanOrEqual(info.propsContentH);
  });
});
