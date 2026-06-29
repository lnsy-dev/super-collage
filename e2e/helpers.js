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
export async function createProject(page, name, { pageSize = 'half-letter', orientation = 'portrait', pageCount = 1 } = {}) {
  await gotoApp(page);
  await page.fill('#new-project-name', name);
  await page.locator(`label:has(input[name="new-page-size"][value="${pageSize}"])`).click();
  if (pageCount !== 1) {
    await page.locator(`label:has(input[name="new-page-count"][value="${pageCount}"])`).click();
  }
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
 * Return all page ids for the current project from browser state.
 */
export async function getProjectPageIds(page) {
  return page.evaluate(() => {
    // @ts-ignore
    return State.project?.pageOrder || [];
  });
}

/**
 * Switch the editor to a specific page by id. Bypasses the page-list view units
 * so it works whether the project is saddle-stitch or sequential.
 */
export async function loadPageById(page, pageId) {
  await page.evaluate(async (id) => {
    const { PageManager } = await import('/src/app/page-manager.js');
    await PageManager.loadPage(id);
  }, pageId);
  await page.waitForTimeout(100);
}

/**
 * Set the selected layer's solid color by clicking a color swatch.
 */
export async function setLayerColor(page, colorHex) {
  await page.locator(`.color-swatch[data-color="${colorHex}"]`).click();
  await page.waitForTimeout(50);
}

/**
 * Set the selected layer's color directly in state/DB, bypassing the UI swatches.
 * Useful for tests that need colors outside the predefined RISO palette.
 */
export async function setLayerColorDirect(page, colorHex) {
  await page.evaluate(async (color) => {
    const { DB } = await import('/src/app/db.js');
    const layer = State.layers.find(l => l.id === State.selectedId);
    if (!layer) return;
    layer.color = color;
    layer._dirty = true;
    await DB.saveLayer(layer);
  }, colorHex);
  await page.waitForTimeout(50);
}

import { deflateSync } from 'zlib';

function writePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const chunkType = Buffer.from(type, 'ascii');
  // Simple CRC32 implementation for PNG chunks.
  const crc32 = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    return (buf) => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      }
      return c ^ 0xffffffff;
    };
  })();
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([chunkType, data])) >>> 0, 0);
  return Buffer.concat([len, chunkType, data, crcBuf]);
}

/**
 * Generate a minimal solid-color PNG buffer of the given size.
 */
export function createSolidPngBuffer(colorHex, width, height) {
  const { r, g, b } = hexToRgb(colorHex);
  // Each scanline: filter byte (0) + RGB triples
  const rowSize = 1 + width * 3;
  const imageData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    imageData[rowOffset] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 3;
      imageData[pxOffset] = r;
      imageData[pxOffset + 1] = g;
      imageData[pxOffset + 2] = b;
    }
  }
  const compressed = deflateSync(imageData);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = writePngChunk('IHDR', ihdrData);
  const idat = writePngChunk('IDAT', compressed);
  const iend = writePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

/**
 * Create a black-on-white RGB PNG buffer with a simple geometric shape.
 * Supports 'rect', 'ellipse', 'triangle', and 'diamond'.
 * The shape is drawn in black (#000000) on a white background so the export
 * colorizer will fill it with the layer color.
 */
export function createShapePngBuffer(shape, width, height) {
  const rowSize = 1 + width * 3;
  const imageData = Buffer.alloc(rowSize * height);
  // Fill white
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    imageData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 3;
      imageData[pxOffset] = 255;
      imageData[pxOffset + 1] = 255;
      imageData[pxOffset + 2] = 255;
    }
  }

  function setPixel(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pxOffset = y * rowSize + 1 + x * 3;
    imageData[pxOffset] = 0;
    imageData[pxOffset + 1] = 0;
    imageData[pxOffset + 2] = 0;
  }

  function fillScanline(y, x1, x2) {
    for (let x = Math.max(0, Math.floor(x1)); x <= Math.min(width - 1, Math.ceil(x2)); x++) {
      setPixel(x, y);
    }
  }

  switch (shape) {
    case 'rect': {
      const padX = Math.floor(width * 0.25);
      const padY = Math.floor(height * 0.25);
      for (let y = padY; y < height - padY; y++) {
        fillScanline(y, padX, width - padX - 1);
      }
      break;
    }
    case 'ellipse': {
      const cx = width / 2;
      const cy = height / 2;
      const rx = width * 0.35;
      const ry = height * 0.35;
      for (let y = 0; y < height; y++) {
        const dy = (y - cy) / ry;
        if (dy * dy > 1) continue;
        const dx = rx * Math.sqrt(1 - dy * dy);
        fillScanline(y, cx - dx, cx + dx);
      }
      break;
    }
    case 'triangle': {
      const topX = width / 2;
      const topY = height * 0.15;
      const bottomY = height * 0.85;
      const halfBase = width * 0.35;
      for (let y = Math.floor(topY); y <= Math.ceil(bottomY); y++) {
        const t = (y - topY) / (bottomY - topY);
        const cx = topX;
        const halfW = halfBase * t;
        fillScanline(y, cx - halfW, cx + halfW);
      }
      break;
    }
    case 'diamond': {
      const cx = width / 2;
      const cy = height / 2;
      const rx = width * 0.35;
      const ry = height * 0.35;
      for (let y = 0; y < height; y++) {
        const t = Math.abs(y - cy) / ry;
        if (t > 1) continue;
        const dx = rx * (1 - t);
        fillScanline(y, cx - dx, cx + dx);
      }
      break;
    }
  }

  const compressed = deflateSync(imageData);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = writePngChunk('IHDR', ihdrData);
  const idat = writePngChunk('IDAT', compressed);
  const iend = writePngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

/**
 * Add a solid-color PNG image to the current page and wait for the layer.
 */
export async function addSolidColorImage(page, colorHex, { width = 100, height = 100 } = {}) {
  const buffer = createSolidPngBuffer(colorHex, width, height);
  await page.setInputFiles('#file-input', {
    name: `solid-${colorHex.replace('#', '')}.png`,
    mimeType: 'image/png',
    buffer,
  });
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
}

/**
 * Draw a shape on the current page with the given tool and optional color.
 * Coordinates are in screen pixels relative to the interaction overlay.
 */
export async function addShapeLayer(page, toolName, { x = 200, y = 200, w = 100, h = 100, color = null } = {}) {
  await selectTool(page, toolName);
  const canvas = page.locator('#interaction-overlay');
  await canvas.dragTo(canvas, {
    sourcePosition: { x, y },
    targetPosition: { x: x + w, y: y + h },
  });
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
  if (color) {
    await setLayerColor(page, color);
  }
}

/**
 * Run ExportEngine.exportBooklet's core logic in the browser and return
 * compact sheet summaries per color plate. Avoids actual downloads.
 *
 * buildSheets auto-calculates the N-up layout from page and target sheet
 * sizes; there is no explicit 1up/2up/4up parameter at the booklet level.
 *
 * Returns { [colorHex]: Array<{ width, height, avgGrey, leftGrey, rightGrey }> }
 */
export async function runExportBooklet(page, {
  binding = 'saddle-stitch',
  bookletLayout = 'folio',
  targetSheetSize = 'letter',
} = {}) {
  return page.evaluate(async ({ binding, bookletLayout, targetSheetSize }) => {
    const { ExportEngine } = await import('/src/app/export-engine.js');
    const { buildSheets } = await import('/src/app/imposition.js');

    function avgGrey(data, width, region) {
      let sum = 0;
      let count = 0;
      const { x, y, w, h } = region;
      for (let row = Math.max(0, Math.floor(y)); row < Math.floor(y + h) && row < data.height; row++) {
        for (let col = Math.max(0, Math.floor(x)); col < Math.floor(x + w) && col < data.width; col++) {
          const idx = (row * data.width + col) * 4;
          sum += data.data[idx]; // R=G=B=grey
          count++;
        }
      }
      return count === 0 ? 255 : sum / count;
    }

    // Delegate to the production plate builder so the spanning/crop behaviour is
    // exercised in one place (no duplicated logic in the test harness).
    const colorPages = await ExportEngine._buildBookletPagePlates(State.project.pageOrder);

    const result = {};
    for (const [color, pages] of colorPages.entries()) {
      const sheets = buildSheets(pages, {
        binding,
        bookletLayout,
        targetSheetSize,
      });
      result[color] = sheets.map(sheet => {
        const ctx = sheet.getContext('2d');
        const imgData = ctx.getImageData(0, 0, sheet.width, sheet.height);
        const w = sheet.width, h = sheet.height;
        return {
          width: w,
          height: h,
          avgGrey: avgGrey(imgData, w, { x: 0, y: 0, w, h }),
          leftGrey: avgGrey(imgData, w, { x: 0, y: 0, w: w / 2, h }),
          rightGrey: avgGrey(imgData, w, { x: w / 2, y: 0, w: w / 2, h }),
        };
      });
    }
    return result;
  }, { binding, bookletLayout, targetSheetSize });
}

/**
 * Sample the dominant grey value of a rectangular region in a sheet's pixel array.
 * Sheets are exported as greyscale ink on white (R=G=B=grey, A=255).
 * Returns the average grey value (0-255). 255 = white/empty, 0 = black/fully inked.
 */
export function sampleRegionGrey(pixels, width, region) {
  const { x, y, w, h } = region;
  let sum = 0;
  let count = 0;
  for (let row = Math.floor(y); row < Math.floor(y + h); row++) {
    for (let col = Math.floor(x); col < Math.floor(x + w); col++) {
      if (col < 0 || col >= width || row < 0) continue;
      const idx = (row * width + col) * 4;
      if (idx >= pixels.length) continue;
      sum += pixels[idx]; // R=G=B=grey
      count++;
    }
  }
  return count === 0 ? 255 : sum / count;
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
 * Run ExportEngine composite rendering for a multi-page booklet and return
 * compact sheet summaries with average color per region.
 *
 * Returns Array<{ width, height, avgColor, leftColor, rightColor }>
 * where each color is { r, g, b }.
 */
export async function runExportCompositeBooklet(page, {
  bookletLayout = 'folio',
  targetSheetSize = 'letter',
} = {}) {
  return page.evaluate(async ({ bookletLayout, targetSheetSize }) => {
    const { ExportEngine } = await import('/src/app/export-engine.js');
    const { buildSheets } = await import('/src/app/imposition.js');

    function avgColor(data, width, region) {
      let r = 0, g = 0, b = 0, count = 0;
      const { x, y, w, h } = region;
      for (let row = Math.max(0, Math.floor(y)); row < Math.floor(y + h) && row < data.height; row++) {
        for (let col = Math.max(0, Math.floor(x)); col < Math.floor(x + w) && col < data.width; col++) {
          const idx = (row * data.width + col) * 4;
          r += data.data[idx];
          g += data.data[idx + 1];
          b += data.data[idx + 2];
          count++;
        }
      }
      return count === 0 ? { r: 255, g: 255, b: 255 } : { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
    }

    // Delegate to the production composite builder so spanning/crop behaviour is
    // exercised in one place (no duplicated logic in the test harness).
    const pageComposites = await ExportEngine._buildBookletPageComposites(State.project.pageOrder);

    const sheets = buildSheets(pageComposites, { binding: 'saddle-stitch', bookletLayout, targetSheetSize });
    return sheets.map(sheet => {
      const ctx = sheet.getContext('2d');
      const imgData = ctx.getImageData(0, 0, sheet.width, sheet.height);
      const w = sheet.width, h = sheet.height;
      return {
        width: w,
        height: h,
        avgColor: avgColor(imgData, w, { x: 0, y: 0, w, h }),
        leftColor: avgColor(imgData, w, { x: 0, y: 0, w: w / 2, h }),
        rightColor: avgColor(imgData, w, { x: w / 2, y: 0, w: w / 2, h }),
      };
    });
  }, { bookletLayout, targetSheetSize });
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
