import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Panel sub-menu scrolling', () => {
  test('layer and page button bars scroll horizontally when panel is too narrow', async ({ page }) => {
    await createProject(page, 'Submenu Scroll Test');

    // Make the right panel narrow enough that all buttons cannot fit.
    await page.evaluate(() => {
      const panel = document.getElementById('right-panel');
      if (!panel) return;
      panel.style.width = '120px';
      panel.style.minWidth = '120px';
      panel.style.flexBasis = '120px';
    });

    const layerButtons = page.locator('#layer-buttons');
    const pageButtons = page.locator('#page-buttons');

    await expect(layerButtons).toBeVisible();
    await expect(pageButtons).toBeVisible();

    const layerMetrics = await layerButtons.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        flexWrap: cs.flexWrap,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });

    expect(layerMetrics.overflowX).toBe('auto');
    expect(layerMetrics.overflowY).toBe('hidden');
    expect(layerMetrics.flexWrap).toBe('nowrap');
    expect(layerMetrics.scrollWidth).toBeGreaterThan(layerMetrics.clientWidth);

    const pageMetrics = await pageButtons.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        flexWrap: cs.flexWrap,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });

    expect(pageMetrics.overflowX).toBe('auto');
    expect(pageMetrics.overflowY).toBe('hidden');
    expect(pageMetrics.flexWrap).toBe('nowrap');
    expect(pageMetrics.scrollWidth).toBeGreaterThan(pageMetrics.clientWidth);

    // Controls remain reachable by scrolling the bar.
    const deleteVisibleAfterScroll = await layerButtons.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      const btn = el.querySelector('[data-action="delete-layer"]');
      if (!btn) return false;
      const br = btn.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return br.left >= er.left - 1 && br.right <= er.right + 1;
    });
    expect(deleteVisibleAfterScroll).toBe(true);
  });
});
