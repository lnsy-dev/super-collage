// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Panel row resize: extend the Layers view with a bottom-edge grip
   ═══════════════════════════════════════════════════════════════════
   The Layers window carries a slim drag handle on its bottom edge:

   - Drag it down: the Layers view extends and the windows stacked
     below it (pages, properties) move down; when the column outgrows
     the page it scrolls, so everything stays reachable.
   - Drag it up: the view shrinks, clamped at its minimum.
   - The chosen height persists in localStorage across reloads.
*/
import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, reopenProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

const GRIP = '#layers-window .panel-row-handle';

async function winHeight(page) {
  return page.evaluate(() => document.getElementById('layers-window').offsetHeight);
}

async function dragHandle(page, dy) {
  const box = await page.locator(GRIP).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe('Layers view resize handle', () => {
  test('dragging the grip down extends the Layers view and moves the pages window down', async ({ page }) => {
    await createProject(page, 'Layers Row Resize');
    const before = await winHeight(page);
    const pagesBefore = await page.evaluate(() => document.getElementById('pages-window').getBoundingClientRect().top);

    await dragHandle(page, 180);

    const after = await winHeight(page);
    expect(after, 'dragging the grip extends the Layers view').toBeGreaterThan(before + 120);
    // Everything stacked below moves down (or scrolls out of the panel).
    const pagesAfter = await page.evaluate(() => {
      const p = document.getElementById('pages-window').getBoundingClientRect();
      const panel = document.getElementById('right-panel').getBoundingClientRect();
      // When it scrolled out of view its top can be negative relative to
      // the panel's visible top; report the panel-relative position.
      return p.top - panel.top;
    });
    expect(pagesAfter, 'pages window moved down').toBeGreaterThan(pagesBefore);
    // The layer list is uncapped and fills its window.
    const listH = await page.evaluate(() => {
      const list = document.getElementById('layer-list');
      return { maxHeight: getComputedStyle(list).maxHeight, h: list.clientHeight };
    });
    expect(listH.h).toBeGreaterThan(150);
  });

  test('dragging past the minimum clamps and shrinks the view', async ({ page }) => {
    await createProject(page, 'Layers Row Min');
    await dragHandle(page, 150); // start from an extended state
    const extended = await winHeight(page);
    expect(extended).toBeGreaterThanOrEqual(140);
    await dragHandle(page, -400); // straighten out way past the min
    const after = await winHeight(page);
    expect(after).toBeLessThan(extended);
    expect(after).toBeLessThanOrEqual(110); // clamped at ROW_LIMITS min 96 (±1 layout)
    // The layer list still shows (scrollable) and buttons remain clickable.
    await expect(page.locator('#layer-buttons [data-action="delete-layer"]')).toBeVisible();
  });

  test('dragging far past the max clamps at the panel-fraction cap', async ({ page }) => {
    await createProject(page, 'Layers Row Max');
    await dragHandle(page, 1200);
    const capped = await page.evaluate(() => {
      const win = document.getElementById('layers-window');
      const panel = document.getElementById('right-panel');
      return { h: win.offsetHeight, panel: panel.clientHeight };
    });
    expect(capped.h).toBeLessThanOrEqual(capped.panel * 0.92 + 1);
  });

  test('the extended height persists after closing and reopening the project', async ({ page }) => {
    await createProject(page, 'Layers Row Persist');
    await dragHandle(page, 400);
    const before = await winHeight(page);
    expect(before).toBeGreaterThan(300);

    await reopenProject(page, 'Layers Row Persist');
    // The row heights restore after boot once the panel column is laid out.
    await expect.poll(() => winHeight(page), { timeout: 20000 }).toBeGreaterThan(300);
  });
});
