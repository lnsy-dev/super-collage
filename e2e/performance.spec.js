import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, throttleCPU } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LARGE_IMAGE = path.join(__dirname, 'fixtures', 'large-test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Performance Optimizations', () => {
  test('display resolution stays below full DPI at low zoom', async ({ page }) => {
    await createProject(page, 'Resolution Test');
    await addImage(page, LARGE_IMAGE);

    // Wait for the image to be rendered at default 15% zoom
    await page.waitForTimeout(500);

    const resolutionInfo = await page.evaluate(() => {
      const layer = State.layers[0];
      if (!layer) return null;
      return {
        naturalWidth: layer.naturalWidth,
        naturalHeight: layer.naturalHeight,
        processedWidth: layer._processedCanvas?.width || 0,
        processedHeight: layer._processedCanvas?.height || 0,
        zoom: State.zoom,
      };
    });

    expect(resolutionInfo).not.toBeNull();
    // At 15% zoom, processed resolution should be significantly smaller than natural
    expect(resolutionInfo.processedWidth).toBeLessThan(resolutionInfo.naturalWidth);
    expect(resolutionInfo.processedHeight).toBeLessThan(resolutionInfo.naturalHeight);
    // Should still be reasonable (at least 64px as per our floor)
    expect(resolutionInfo.processedWidth).toBeGreaterThanOrEqual(64);
    expect(resolutionInfo.processedHeight).toBeGreaterThanOrEqual(64);
  });

  test('viewport culling skips off-screen layers', async ({ page }) => {
    await createProject(page, 'Culling Test');
    await addImage(page, LARGE_IMAGE);

    // Zoom to 100% so the image is large and can be scrolled off-screen
    await page.locator('#zoom-controls [data-action="zoom-100"]').click();
    await page.waitForTimeout(300);

    // Reset process call count
    await page.evaluate(() => {
      ImageProcessor._processCallCount = 0;
    });

    // Scroll the image completely off-screen to the right
    await page.evaluate(() => {
      const scroll = document.getElementById('canvas-scroll');
      scroll.scrollLeft = scroll.scrollWidth;
    });

    // Make the layer dirty and trigger a render by changing brightness
    await page.evaluate(() => {
      const layer = State.layers[0];
      if (layer) {
        layer.brightness = (layer.brightness || 0) + 5;
        layer._dirty = true;
        Renderer.schedule();
      }
    });

    await page.waitForTimeout(300);

    const processCount = await page.evaluate(() => {
      return ImageProcessor._processCallCount;
    });

    // The off-screen layer should not have been processed
    expect(processCount).toBe(0);
  });

  test('export renders at full resolution even after low-zoom display', async ({ page }) => {
    await createProject(page, 'Export Resolution Test');
    await addImage(page, LARGE_IMAGE);

    // Wait for low-zoom render
    await page.waitForTimeout(500);

    // Verify it's at low resolution before export
    const beforeExport = await page.evaluate(() => {
      const layer = State.layers[0];
      return {
        processedWidth: layer._processedCanvas?.width || 0,
        naturalWidth: layer.naturalWidth,
      };
    });
    expect(beforeExport.processedWidth).toBeLessThan(beforeExport.naturalWidth);

    // Open export dialog and trigger export
    await page.click('.menu-item[data-menu="file"]');
    await page.locator('[data-action="export"]').click();
    await page.locator('#export-dialog').waitFor({ state: 'visible' });

    // Capture the export blob dimensions via a monkey-patched URL.createObjectURL
    const exportDims = await page.evaluate(() => {
      return new Promise((resolve) => {
        const originalCreateObjectURL = URL.createObjectURL;
        URL.createObjectURL = function(blob) {
          const img = new Image();
          img.onload = () => {
            URL.createObjectURL = originalCreateObjectURL;
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
          };
          img.onerror = () => {
            URL.createObjectURL = originalCreateObjectURL;
            resolve(null);
          };
          const url = originalCreateObjectURL.call(URL, blob);
          img.src = url;
          return url;
        };
        document.getElementById('btn-export-go').click();
      });
    });

    // Wait for dialog to close / done state
    await page.waitForTimeout(2000);

    expect(exportDims).not.toBeNull();
    // For half-letter at 600 dpi: 3300 x 5100
    expect(exportDims.width).toBe(3300);
    expect(exportDims.height).toBe(5100);
  });

  test('app remains interactive under CPU throttling', async ({ page }) => {
    await createProject(page, 'Throttle Test');
    await addImage(page, LARGE_IMAGE);

    // Apply CPU throttling
    await throttleCPU(page, 4);

    // Wait for initial render
    await page.waitForTimeout(500);

    // Reset process call count to measure
    await page.evaluate(() => {
      ImageProcessor._processCallCount = 0;
    });

    // Apply a halftone filter (expensive operation)
    const startTime = Date.now();
    await page.evaluate(() => {
      const layer = State.layers[0];
      if (layer) {
        layer.halftoneType = 'dither';
        layer.halftoneSize = 4;
        layer._dirty = true;
        Renderer.schedule();
      }
    });

    // Wait for the canvas center to show non-white pixels (filter applied)
    // The image is centered on the canvas, so sample the middle
    await page.waitForFunction(() => {
      const canvas = document.getElementById('display-canvas');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      const cx = Math.floor(canvas.width / 2);
      const cy = Math.floor(canvas.height / 2);
      const d = ctx.getImageData(cx, cy, 1, 1).data;
      // The filtered image should have changed from pure white paper
      return d[0] !== 255 || d[1] !== 255 || d[2] !== 255;
    }, { timeout: 8000 });

    const elapsed = Date.now() - startTime;
    // Verify processing actually happened
    const processCount = await page.evaluate(() => ImageProcessor._processCallCount);
    expect(processCount).toBeGreaterThan(0);
    // Should complete within 5 seconds even with 4x CPU throttling
    expect(elapsed).toBeLessThan(5000);
  });
});
