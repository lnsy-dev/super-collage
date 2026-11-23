import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, getCanvasPixel,
  addImageFromBuffer, createSolidPngBuffer,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

// The center guides draw as translucent magenta dashes over the white paper:
// 0.65 alpha over white → r≈255, g≈89, b≈199. Distinct from the light-blue
// margins/grid overlays.
function isGuideColor(px) {
  return !!px && px.r > 240 && px.g < 160 && px.b > 140 && px.b < 235;
}

function isPaper(px) {
  return !!px && px.r > 248 && px.g > 248 && px.b > 248;
}

// Display-canvas backing px where the guide line lands for a page edge of
// `pageEdge` (600 dpi px) at the current zoom — mirrors Renderer's
// Math.round(pos * zoom) + 0.5 stroke placement.
async function guidePixel(page, pageEdge) {
  return page.evaluate((edge) => {
    return Math.round((edge / 2) * window.State.zoom);
  }, pageEdge);
}

// Walk columns x0..x1 sampling several positions along each (dashes have
// gaps) and report whether any sampled pixel is guide-colored.
async function columnHasGuide(page, x0, x1, from, to) {
  for (let x = x0; x <= x1; x++) {
    for (let y = from; y <= to; y += 3) {
      const px = await getCanvasPixel(page, '#display-canvas', x, y);
      if (isGuideColor(px)) return true;
    }
  }
  return false;
}

async function rowHasGuide(page, y0, y1, from, to) {
  for (let y = y0; y <= y1; y++) {
    for (let x = from; x <= to; x += 3) {
      const px = await getCanvasPixel(page, '#display-canvas', x, y);
      if (isGuideColor(px)) return true;
    }
  }
  return false;
}

async function columnAllPaper(page, x, from, to) {
  for (let y = from; y <= to; y += 3) {
    const px = await getCanvasPixel(page, '#display-canvas', x, y);
    if (!isPaper(px)) return false;
  }
  return true;
}

async function toggleCenterView(page, action, expected) {
  await page.locator('.menu-item[data-menu="view"]').click();
  await page.locator(`.menu-entry[data-action="${action}"]`).click();
  // The action flips state synchronously; wait for the async
  // saveViewSettings write to land so later steps don't race it.
  await page.waitForFunction(({ action, expected }) => {
    const flag = action === 'toggle-center-v'
      ? window.State.showVerticalCenter
      : window.State.showHorizontalCenter;
    const vs = window.State.project?.viewSettings;
    return flag === expected && !!vs && (action === 'toggle-center-v'
      ? vs.showVerticalCenter === expected
      : vs.showHorizontalCenter === expected);
  }, { action, expected }, { timeout: 5000 });
  await page.waitForTimeout(200); // let the scheduled render complete
}

test.describe('View → center guidelines', () => {
  test('menu items present, labeled, and independently toggleable', async ({ page }) => {
    await createProject(page, 'Center Guide Menu Test', { pageSize: 'half-letter', pageCount: 1 });

    const viewMenu = page.locator('.menu-item[data-menu="view"]');
    await viewMenu.click();
    await expect(page.locator('#menu-toggle-center-v')).toHaveText('View Vertical Center');
    await expect(page.locator('#menu-toggle-center-h')).toHaveText('View Horizontal Center');

    await page.locator('.menu-entry[data-action="toggle-center-v"]').click();
    expect(await page.evaluate(() => window.State.showVerticalCenter)).toBe(true);
    expect(await page.evaluate(() => window.State.showHorizontalCenter)).toBe(false);
    await viewMenu.click();
    await expect(page.locator('#menu-toggle-center-v')).toHaveText('Hide Vertical Center');
    await expect(page.locator('#menu-toggle-center-h')).toHaveText('View Horizontal Center');

    await page.locator('.menu-entry[data-action="toggle-center-h"]').click();
    expect(await page.evaluate(() => window.State.showVerticalCenter)).toBe(true);
    expect(await page.evaluate(() => window.State.showHorizontalCenter)).toBe(true);
    await viewMenu.click();
    await expect(page.locator('#menu-toggle-center-v')).toHaveText('Hide Vertical Center');
    await expect(page.locator('#menu-toggle-center-h')).toHaveText('Hide Horizontal Center');

    // Menu is still open from the previous click; each entry toggles back
    // off independently.
    await page.locator('.menu-entry[data-action="toggle-center-v"]').click();
    expect(await page.evaluate(() => window.State.showVerticalCenter)).toBe(false);
    expect(await page.evaluate(() => window.State.showHorizontalCenter)).toBe(true);
    await viewMenu.click();
    await page.locator('.menu-entry[data-action="toggle-center-h"]').click();
    expect(await page.evaluate(() => window.State.showHorizontalCenter)).toBe(false);
  });

  test('vertical guide renders at the horizontal center of the paper', async ({ page }) => {
    await createProject(page, 'Center Guide Vertical Test', { pageSize: 'half-letter', pageCount: 1 });
    const pageW = await page.evaluate(async () =>
      (await import('/src/app/constants.js')).CANVAS_W);
    await toggleCenterView(page, 'toggle-center-v', true);

    const dims = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      return { w: c.width, h: c.height };
    });
    const cx = await guidePixel(page, pageW);
    expect(await columnHasGuide(page, cx - 1, cx + 1, 0, dims.h - 1)).toBe(true);
    // Off-center columns stay clean paper.
    expect(await columnAllPaper(page, Math.max(0, cx - 30), 0, dims.h - 1)).toBe(true);
    expect(await columnAllPaper(page, Math.min(dims.w - 1, cx + 30), 0, dims.h - 1)).toBe(true);
  });

  test('horizontal guide renders at the vertical center of the paper', async ({ page }) => {
    await createProject(page, 'Center Guide Horizontal Test', { pageSize: 'letter', pageCount: 1 });
    const pageH = await page.evaluate(async () =>
      (await import('/src/app/constants.js')).CANVAS_H);
    await toggleCenterView(page, 'toggle-center-h', true);

    const dims = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      return { w: c.width, h: c.height };
    });
    const cy = await guidePixel(page, pageH);
    expect(await rowHasGuide(page, cy - 1, cy + 1, 0, dims.w - 1)).toBe(true);
    // Off-center rows stay clean paper.
    for (let x = 0; x <= dims.w - 1; x += 3) {
      const above = await getCanvasPixel(page, '#display-canvas', x, Math.max(0, cy - 30));
      const below = await getCanvasPixel(page, '#display-canvas', x, Math.min(dims.h - 1, cy + 30));
      expect(isPaper(above) && isPaper(below)).toBe(true);
    }
  });

  test('guide position tracks the paper size, not the viewport', async ({ page }) => {
    // A different paper size puts the center elsewhere on the canvas; the
    // guide must land on the paper's center either way.
    await createProject(page, 'Center Guide Size Test', { pageSize: 'letter', pageCount: 1 });
    const pageW = await page.evaluate(async () =>
      (await import('/src/app/constants.js')).CANVAS_W);
    await toggleCenterView(page, 'toggle-center-v', true);

    const dims = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      return { w: c.width, h: c.height };
    });
    // Letter (5100×6600) is wider than half-letter: its center column is
    // strictly right of where a half-letter page's would be, and the guide
    // must not hug the canvas edge (a viewport-anchored line would).
    const cx = await guidePixel(page, pageW);
    expect(cx).toBeGreaterThan(dims.w * 0.4);
    expect(cx).toBeLessThan(dims.w * 0.6);
    expect(await columnHasGuide(page, cx - 1, cx + 1, 0, dims.h - 1)).toBe(true);
    expect(await columnAllPaper(page, Math.max(0, cx - 40), 0, dims.h - 1)).toBe(true);
  });

  test('toggling off removes the guideline', async ({ page }) => {
    await createProject(page, 'Center Guide Toggle Off Test', { pageSize: 'half-letter', pageCount: 1 });
    const pageW = await page.evaluate(async () =>
      (await import('/src/app/constants.js')).CANVAS_W);
    await toggleCenterView(page, 'toggle-center-v', true);

    const dims = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      return { w: c.width, h: c.height };
    });
    const cx = await guidePixel(page, pageW);
    expect(await columnHasGuide(page, cx - 1, cx + 1, 0, dims.h - 1)).toBe(true);

    await toggleCenterView(page, 'toggle-center-v', false); // toggles it back off
    expect(await page.evaluate(() => window.State.showVerticalCenter)).toBe(false);
    expect(await columnAllPaper(page, cx, 0, dims.h - 1)).toBe(true);
  });

  test('guides stay aligned with the paper across zoom changes', async ({ page }) => {
    await createProject(page, 'Center Guide Zoom Test', { pageSize: 'half-letter', pageCount: 1 });
    await toggleCenterView(page, 'toggle-center-v', true);
    await toggleCenterView(page, 'toggle-center-h', true);

    // Zoom in via the View menu, then re-check both guides sit at the
    // paper's center under the new zoom.
    await page.locator('.menu-item[data-menu="view"]').click();
    await page.locator('.menu-entry[data-action="zoom-in"]').click();
    await page.waitForTimeout(400); // settle the zoom debounce + repaint

    const dims = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      return { w: c.width, h: c.height };
    });
    const pageW = await page.evaluate(async () =>
      (await import('/src/app/constants.js')).CANVAS_W);
    const cx = await guidePixel(page, pageW);
    const cy = Math.round(dims.h / 2);
    expect(await columnHasGuide(page, cx - 1, cx + 1, 0, dims.h - 1)).toBe(true);
    expect(await rowHasGuide(page, cy - 1, cy + 1, 0, dims.w - 1)).toBe(true);
    // Clean paper well away from both guide lines — the guides moved WITH
    // the paper rather than staying at the old zoom's pixel position.
    expect(await columnAllPaper(page, Math.max(0, cx - 40), 0, cy - 25)).toBe(true);
    expect(await columnAllPaper(page, Math.max(0, cx - 40), cy + 25, dims.h - 1)).toBe(true);
  });

  test('spread view guides center each page, not the fold', async ({ page }) => {
    await createProject(page, 'Center Guide Spread Test', { pageSize: 'half-letter', pageCount: 8 });

    await page.evaluate(async () => {
      const { PageManager } = await import('/src/app/page-manager.js');
      const { computeViewUnits } = await import('/src/app/spread-manager.js');
      const units = computeViewUnits(window.State.project.pageOrder, 'saddle-stitch');
      const spread = units.find(u => u.type === 'spread');
      if (spread) await PageManager.loadUnit(spread.id);
    });
    expect(await page.evaluate(() => window.State.spreadView)).toBe(true);
    const splitX = await page.evaluate(() => window.State.spreadSplitX);
    expect(splitX).toBeGreaterThan(0);

    await toggleCenterView(page, 'toggle-center-v', true);
    await page.waitForTimeout(200);

    const dims = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      return { w: c.width, h: c.height };
    });
    const splitPx = await page.evaluate(({ split }) =>
      Math.round(split * window.State.zoom), { split: splitX });
    const leftCx = Math.round(splitPx / 2);
    const rightCx = Math.round((splitPx + dims.w) / 2);

    expect(await columnHasGuide(page, leftCx - 1, leftCx + 1, 0, dims.h - 1)).toBe(true);
    expect(await columnHasGuide(page, rightCx - 1, rightCx + 1, 0, dims.h - 1)).toBe(true);
    // The fold itself is not a guide (margins are off, so it is clean paper).
    expect(await columnAllPaper(page, splitPx, 0, dims.h - 1)).toBe(true);
  });

  test('guides do not appear in export output', async ({ page }) => {
    await createProject(page, 'Center Guide Export Test', { pageSize: 'half-letter', pageCount: 1 });
    // A small black layer parked in the top-left corner, well away from both
    // center lines (imports center layers, so move it explicitly).
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 400, 300));
    await page.evaluate(async () => {
      const { DB } = await import('/src/app/db.js');
      const layer = State.layers.find(l => l.id === State.selectedId);
      layer.x = 100; layer.y = 100;
      layer._dirty = true;
      await DB.saveLayer(layer);
    });
    await page.waitForTimeout(300);
    await toggleCenterView(page, 'toggle-center-v', true);
    await toggleCenterView(page, 'toggle-center-h', true);

    const result = await page.evaluate(async () => {
      const { ExportEngine } = await import('/src/app/export-engine.js');
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
      const plateMap = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);
      const out = {};
      for (const [color, canvas] of plateMap.entries()) {
        const w = canvas.width, h = canvas.height;
        const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
        let nonGrey = 0;
        let centerColumnInk = 0;
        let centerRowInk = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) nonGrey++;
            if (x === Math.floor(w / 2) && data[i] < 250) centerColumnInk++;
            if (y === Math.floor(h / 2) && data[i] < 250) centerRowInk++;
          }
        }
        out[color] = { nonGrey, centerColumnInk, centerRowInk };
      }
      return out;
    });

    expect(Object.keys(result).length).toBeGreaterThan(0);
    for (const [color, stats] of Object.entries(result)) {
      // Export plates are greyscale ink on white: a leaked magenta guide
      // would show up as non-grey pixels.
      expect(stats.nonGrey, `${color} plate must stay greyscale`).toBe(0);
      // The small layer sits at 10% from the top-left, so both center lines
      // cross pure paper — they must be fully white in the export.
      expect(stats.centerColumnInk, `${color} plate has ink on the vertical center`).toBe(0);
      expect(stats.centerRowInk, `${color} plate has ink on the horizontal center`).toBe(0);
    }
  });
});
