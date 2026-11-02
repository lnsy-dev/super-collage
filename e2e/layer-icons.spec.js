// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Layer icons & toggles sizing
   ═══════════════════════════════════════════════════════════════════
   The layer row's visibility toggle, lock toggle and color dot were
   too easy to miss-tap; their sizes are pinned here (visibility/lock
   toggle glyphs ≥ 18 px, color dot ≥ 10 px) while the row's toggles
   still work.
*/
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Layer icons & toggles size', () => {
  test('layer row toggles render at the enlarged size and still function', async ({ page }) => {
    await createProject(page, 'Layer Icon Size');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 2000, 2000), { name: 'sized.png' });
    // The layer LIST renders on the next UI refresh after the state import.
    await page.waitForSelector('.layer-row .layer-lock', { timeout: 10000 });

    const sizes = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const vis = q('.layer-vis');
      const lock = q('.layer-lock');
      const dot = q('.layer-color-dot');
      if (!vis || !lock || !dot) {
        return { missing: { vis: !vis, lock: !lock, dot: !dot } };
      }
      return {
        visFontSize: parseFloat(getComputedStyle(vis).fontSize),
        visBox: vis.getBoundingClientRect().height,
        lockFontSize: parseFloat(getComputedStyle(lock).fontSize),
        lockBox: lock.getBoundingClientRect().height,
        dotW: dot.getBoundingClientRect().width,
        visGlyph: vis.textContent,
      };
    });
    if (sizes.missing) throw new Error('layer row pieces missing: ' + JSON.stringify(sizes.missing));
    expect(sizes.visFontSize, 'visibility toggle glyph enlarged').toBeGreaterThanOrEqual(18);
    expect(sizes.lockFontSize, 'lock toggle glyph enlarged').toBeGreaterThanOrEqual(18);
    expect(sizes.visBox, 'visibility toggle hit area enlarged').toBeGreaterThanOrEqual(18);
    expect(sizes.lockBox, 'lock toggle hit area enlarged').toBeGreaterThanOrEqual(18);
    expect(sizes.dotW, 'color dot enlarged').toBeGreaterThanOrEqual(10);

    // The toggle still performs its action: click hides the layer.
    await page.locator('.layer-vis').first().click();
    const hidden = await page.evaluate(() => State.layers[0].visible);
    expect(hidden, 'visibility toggle still works at the larger size').toBe(false);
  });
});
