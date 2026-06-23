import { test, expect } from '@playwright/test';
import {
  clearIndexedDB,
  createProject,
  getProjectPageIds,
  loadPageById,
  addSolidColorImage,
  createShapePngBuffer,
  setLayerColorDirect,
  runExportBooklet,
  runExportCompositeBooklet,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

// Distinct colors used to identify pages in exported plates. Any hex can be
// used because tests set the layer color directly, bypassing the UI swatches.
const PAGE_COLORS = [
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
  '#FF00FF', '#00FFFF', '#000000', '#808080',
  '#FF8000', '#8000FF', '#008000', '#800000',
  '#008080', '#808000', '#C0C0C0', '#404040',
];

function pageColor(index) {
  return PAGE_COLORS[index % PAGE_COLORS.length];
}

function findPlateKey(plates, colorHex) {
  return Object.keys(plates).find(k => k.toLowerCase() === colorHex.toLowerCase());
}

function regionGrey(sheet, regionName = 'avgGrey') {
  return sheet[regionName];
}

// Half-letter page size at 600 DPI. PNG images must be generated at the page
// pixel size so the layer fills the entire page (the app does not upscale images).
const PAGE_W = 3300;
const PAGE_H = 5100;

/**
 * Add a full-page black image to a specific page and set the layer color.
 * The image pixels must be dark enough to survive the export colorize threshold.
 */
async function addColoredImageToPage(page, pageId, colorHex) {
  await loadPageById(page, pageId);
  await addSolidColorImage(page, '#000000', { width: PAGE_W, height: PAGE_H });
  await setLayerColorDirect(page, colorHex);
}

/**
 * Add a full-page PNG shape to a specific page and set the layer color.
 * Supported shapes: 'rect', 'ellipse', 'triangle', 'diamond'.
 */
async function addShapeToPage(page, pageId, shape, colorHex) {
  await loadPageById(page, pageId);
  const buffer = createShapePngBuffer(shape, PAGE_W, PAGE_H);
  await page.setInputFiles('#file-input', {
    name: `shape-${shape}-${Date.now()}.png`,
    mimeType: 'image/png',
    buffer,
  });
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
  await setLayerColorDirect(page, colorHex);
}

test.describe('Paginated Export', () => {
  test('single-page saddle-stitch export renders page content', async ({ page }) => {
    await createProject(page, 'Saddle Single', { pageSize: 'half-letter', pageCount: 1 });
    const [pageId] = await getProjectPageIds(page);
    await addColoredImageToPage(page, pageId, '#f65058');

    const plates = await runExportBooklet(page, { binding: 'saddle-stitch', bookletLayout: 'folio', targetSheetSize: 'letter' });
    const key = findPlateKey(plates, '#f65058');
    expect(key, 'expected a red plate').toBeTruthy();
    const minGrey = Math.min(...plates[key].map(s => regionGrey(s)));
    expect(minGrey, 'red plate has no ink').toBeLessThan(250);
  });

  test('4-page saddle-stitch export includes every page color', async ({ page }) => {
    await createProject(page, 'Saddle Multi', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    for (let i = 0; i < pageIds.length; i++) {
      await addColoredImageToPage(page, pageIds[i], pageColor(i));
    }

    const plates = await runExportBooklet(page, { binding: 'saddle-stitch', bookletLayout: 'folio', targetSheetSize: 'letter' });

    for (let i = 0; i < pageIds.length; i++) {
      const color = pageColor(i);
      const key = findPlateKey(plates, color);
      expect(key, `missing plate for ${color}`).toBeTruthy();
      const minGrey = Math.min(...plates[key].map(s => regionGrey(s)));
      expect(minGrey, `color ${color} has no ink on any sheet`).toBeLessThan(250);
    }
  });

  test('saddle-stitch folio imposes 8 pages without dropping colors', async ({ page }) => {
    test.setTimeout(120000);
    await createProject(page, 'Saddle Folio', { pageSize: 'half-letter', pageCount: 8 });
    const pageIds = await getProjectPageIds(page);

    for (let i = 0; i < pageIds.length; i++) {
      await addColoredImageToPage(page, pageIds[i], pageColor(i));
    }

    const plates = await runExportBooklet(page, {
      binding: 'saddle-stitch',
      bookletLayout: 'folio',
      targetSheetSize: 'letter',
    });

    for (let i = 0; i < pageIds.length; i++) {
      const color = pageColor(i);
      const key = findPlateKey(plates, color);
      expect(key, `missing plate for color ${color}`).toBeTruthy();
      const minGrey = Math.min(...plates[key].map(s => regionGrey(s)));
      expect(minGrey, `color ${color} has no ink on any sheet`).toBeLessThan(250);
    }
  });

  test('saddle-stitch folio creates front and back sheets for a single color', async ({ page }) => {
    await createProject(page, 'Saddle Folio Mono', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    for (const pageId of pageIds) {
      await addColoredImageToPage(page, pageId, '#000000');
    }

    const plates = await runExportBooklet(page, {
      binding: 'saddle-stitch',
      bookletLayout: 'folio',
      targetSheetSize: 'letter',
    });

    const key = findPlateKey(plates, '#000000');
    expect(key, 'expected a black plate').toBeTruthy();
    // 4 folio pages produce 2 physical sheet sides.
    expect(plates[key].length).toBe(2);
    for (const sheet of plates[key]) {
      expect(regionGrey(sheet)).toBeLessThan(250);
    }
  });

  test('saddle-stitch quarto imposes 8 pages without dropping colors', async ({ page }) => {
    test.setTimeout(120000);
    await createProject(page, 'Saddle Quarto', { pageSize: 'half-letter', pageCount: 8 });
    const pageIds = await getProjectPageIds(page);

    for (let i = 0; i < pageIds.length; i++) {
      await addColoredImageToPage(page, pageIds[i], pageColor(i));
    }

    const plates = await runExportBooklet(page, {
      binding: 'saddle-stitch',
      bookletLayout: 'quarto',
      targetSheetSize: 'tabloid',
    });

    expect(Object.keys(plates).length).toBe(pageIds.length);
    for (let i = 0; i < pageIds.length; i++) {
      const color = pageColor(i);
      const key = findPlateKey(plates, color);
      expect(key, `missing plate for ${color}`).toBeTruthy();
      const minGrey = Math.min(...plates[key].map(s => regionGrey(s)));
      expect(minGrey, `color ${color} has no ink on any sheet`).toBeLessThan(250);
    }
  });

  test('saddle-stitch octavo imposes 8 pages without dropping colors', async ({ page }) => {
    test.setTimeout(120000);
    await createProject(page, 'Saddle Octavo', { pageSize: 'half-letter', pageCount: 8 });
    const pageIds = await getProjectPageIds(page);

    for (let i = 0; i < pageIds.length; i++) {
      await addColoredImageToPage(page, pageIds[i], pageColor(i));
    }

    const plates = await runExportBooklet(page, {
      binding: 'saddle-stitch',
      bookletLayout: 'octavo',
      targetSheetSize: 'tabloid',
    });

    expect(Object.keys(plates).length).toBe(pageIds.length);
    for (let i = 0; i < pageIds.length; i++) {
      const color = pageColor(i);
      const key = findPlateKey(plates, color);
      expect(key, `missing plate for ${color}`).toBeTruthy();
      const minGrey = Math.min(...plates[key].map(s => regionGrey(s)));
      expect(minGrey, `color ${color} has no ink on any sheet`).toBeLessThan(250);
    }
  });

  test('rectangles, ellipses, and polygons all export to their color plates', async ({ page }) => {
    await createProject(page, 'Shape Export', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    const shapes = ['rect', 'ellipse', 'triangle', 'diamond'];
    const colors = ['#f65058', '#0078bf', '#ffe800', '#5ec8e5'];

    for (let i = 0; i < pageIds.length; i++) {
      await addShapeToPage(page, pageIds[i], shapes[i], colors[i]);
    }

    const plates = await runExportBooklet(page, { binding: 'saddle-stitch', bookletLayout: 'folio', targetSheetSize: 'letter' });

    for (const color of colors) {
      const key = findPlateKey(plates, color);
      expect(key, `missing ${color} plate`).toBeTruthy();
      const minGrey = Math.min(...plates[key].map(s => regionGrey(s)));
      expect(minGrey, `${color} plate has no ink`).toBeLessThan(250);
    }
  });

  test('solid-color image layers export across multiple pages', async ({ page }) => {
    await createProject(page, 'Image Export', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    const colors = ['#f65058', '#0078bf', '#ffe800', '#5ec8e5'];
    for (let i = 0; i < pageIds.length; i++) {
      await addColoredImageToPage(page, pageIds[i], colors[i]);
    }

    const plates = await runExportBooklet(page, { binding: 'saddle-stitch', bookletLayout: 'folio', targetSheetSize: 'letter' });

    for (const color of colors) {
      const key = findPlateKey(plates, color);
      expect(key, `expected a plate for color ${color}`).toBeTruthy();
      const minGrey = Math.min(...plates[key].map(s => regionGrey(s)));
      expect(minGrey, `color ${color} has no ink on any sheet`).toBeLessThan(250);
    }
  });

  test('8-page saddle-stitch folio does not drop any page content', async ({ page }) => {
    test.setTimeout(120000);
    await createProject(page, 'No Missing Pages', { pageSize: 'half-letter', pageCount: 8 });
    const pageIds = await getProjectPageIds(page);

    for (let i = 0; i < pageIds.length; i++) {
      await addColoredImageToPage(page, pageIds[i], pageColor(i));
    }

    const plates = await runExportBooklet(page, {
      binding: 'saddle-stitch',
      bookletLayout: 'folio',
      targetSheetSize: 'letter',
    });

    for (let i = 0; i < pageIds.length; i++) {
      const color = pageColor(i);
      const key = findPlateKey(plates, color);
      expect(key, `missing plate for page color ${color}`).toBeTruthy();
      const minGrey = Math.min(...plates[key].map(s => regionGrey(s)));
      expect(minGrey, `color ${color} has no ink on any sheet`).toBeLessThan(250);
    }
  });

  test('layers imported in spread view are centered on the page, not the spread', async ({ page }) => {
    await createProject(page, 'Spread Import', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    // Add a red layer to page 1 while in single-page view.
    await loadPageById(page, pageIds[0]);
    await addSolidColorImage(page, '#000000', { width: 1650, height: 2550 });
    await setLayerColorDirect(page, '#f65058');

    // Switch to the saddle-stitch spread view by clicking the spread unit.
    await page.locator('#page-list .page-row').filter({ hasText: '+' }).first().click();
    await expect(page.locator('#page-list .page-row.selected')).toHaveCount(1);

    // Import a black image while in spread view and color it blue.
    await addSolidColorImage(page, '#000000', { width: 1650, height: 2550 });
    // The layer list can lag behind State.layers in spread view; wait for both rows.
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
    await setLayerColorDirect(page, '#0078bf');

    // Verify the newly imported layer is centered on the left page, not the spread.
    const blueLayerInfo = await page.evaluate(async () => {
      const layer = State.layers.find(l => l.color?.toLowerCase() === '#0078bf');
      if (!layer) return null;
      return {
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        pageId: layer.pageId,
      };
    });
    expect(blueLayerInfo).toBeTruthy();
    // Half-letter page is 3300x5100; a 1650x2550 image should be centered at (825, 1275).
    expect(blueLayerInfo.x).toBeGreaterThanOrEqual(700);
    expect(blueLayerInfo.x).toBeLessThanOrEqual(1000);

    // Export the booklet and verify both colors appear on their plates.
    const plates = await runExportBooklet(page, {
      binding: 'saddle-stitch',
      bookletLayout: 'folio',
      targetSheetSize: 'letter',
    });
    for (const color of ['#f65058', '#0078bf']) {
      const key = findPlateKey(plates, color);
      expect(key, `missing plate for ${color}`).toBeTruthy();
      const minGrey = Math.min(...plates[key].map(s => regionGrey(s)));
      expect(minGrey, `${color} has no ink`).toBeLessThan(250);
    }
  });

  test('export dialog lists colors from all pages, not just the current page', async ({ page }) => {
    await createProject(page, 'Color List', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    await loadPageById(page, pageIds[0]);
    await addSolidColorImage(page, '#000000', { width: 1650, height: 2550 });
    await setLayerColorDirect(page, '#f65058');

    await loadPageById(page, pageIds[1]);
    await addSolidColorImage(page, '#000000', { width: 1650, height: 2550 });
    await setLayerColorDirect(page, '#0078bf');

    // Stay on page 2 and open the export dialog.
    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();

    const colorText = await page.locator('#export-color-list').textContent();
    expect(colorText).toContain('Red');
    expect(colorText).toContain('Blue');
  });

  test('spanning layer is preserved across both pages of a spread', async ({ page }) => {
    await createProject(page, 'Spanning Layer', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    // Import a spread-sized black image to page 4 (left side of the cover spread).
    // It is initially scaled to the page, then resized back to spread size so the
    // stored blob is large enough to cover both pages on export.
    await loadPageById(page, pageIds[3]);
    await addSolidColorImage(page, '#000000', { width: 6600, height: 5100 });
    await setLayerColorDirect(page, '#f65058');

    // Resize the layer so it spans the full cover spread (pages 4 + 1).
    await page.evaluate(async () => {
      const layer = State.layers[0];
      layer.x = 0;
      layer.y = 0;
      layer.width = 6600;
      layer.height = 5100;
      layer.naturalWidth = 6600;
      layer.naturalHeight = 5100;
      layer._dirty = true;
      const { DB } = await import('/src/app/db.js');
      await DB.saveLayer(layer);
    });

    // Export and verify the red plate has ink on both halves of the sheet.
    const plates = await runExportBooklet(page, {
      binding: 'saddle-stitch',
      bookletLayout: 'folio',
      targetSheetSize: 'letter',
    });

    const key = findPlateKey(plates, '#f65058');
    expect(key, 'expected a red plate').toBeTruthy();

    // For a 4-page folio, page 4 is on the left of sheet 1 and page 1 is on
    // the right. The spanning layer should appear on both sides.
    const sheet = plates[key].find(s => s.leftGrey < 250 && s.rightGrey < 250);
    expect(sheet, 'spanning layer should appear on both halves of a sheet').toBeTruthy();
  });

  test('multi-page composite booklet export imposes pages without dropping colors', async ({ page }) => {
    test.setTimeout(120000);
    await createProject(page, 'Composite Booklet', { pageSize: 'half-letter', pageCount: 4 });
    const pageIds = await getProjectPageIds(page);

    for (let i = 0; i < pageIds.length; i++) {
      await addColoredImageToPage(page, pageIds[i], pageColor(i));
    }

    const sheets = await runExportCompositeBooklet(page, {
      bookletLayout: 'folio',
      targetSheetSize: 'letter',
    });

    // 4-page folio produces 2 physical sheet sides.
    expect(sheets.length).toBe(2);

    function hexToRgbObj(hex) {
      const n = parseInt(hex.replace('#', ''), 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function colorDistance(a, b) {
      return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
    }

    const colors = pageIds.map((_, i) => hexToRgbObj(pageColor(i)));
    const [c1, c2, c3, c4] = colors;

    // For a 4-page saddle-stitch folio:
    // Sheet 1 front: page 4 (left), page 1 (right)
    // Sheet 1 back: page 2 (left), page 3 (right)
    expect(colorDistance(sheets[0].leftColor, c4)).toBeLessThan(10);
    expect(colorDistance(sheets[0].rightColor, c1)).toBeLessThan(10);
    expect(colorDistance(sheets[1].leftColor, c2)).toBeLessThan(10);
    expect(colorDistance(sheets[1].rightColor, c3)).toBeLessThan(10);
  });
});
