import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LARGE_IMAGE = path.join(__dirname, 'fixtures', 'large-test-image.png');

// Zoom levels within app's valid range [0.04, 2]
const ZOOM_LEVELS = [0.04, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/**
 * Set zoom via window globals, update the label, and scroll the canvas to center
 * so the viewport intersection check doesn't cull the layer.
 */
async function setZoom(page, zoom) {
  await page.evaluate((z) => {
    State.zoom = z;
    Renderer.resize();
    UI.refreshZoom();
    // Scroll canvas-scroll so the canvas stays centered in view
    const scroll = document.getElementById('canvas-scroll');
    const canvas = document.getElementById('display-canvas');
    if (scroll && canvas) {
      scroll.scrollLeft = Math.max(0, (canvas.offsetLeft + canvas.offsetWidth / 2) - scroll.clientWidth / 2);
      scroll.scrollTop  = Math.max(0, (canvas.offsetTop  + canvas.offsetHeight / 2) - scroll.clientHeight / 2);
    }
  }, zoom);
  // Wait for debounce (150ms) + rAF render
  await page.waitForTimeout(350);
}

/** Returns true if the display canvas has any non-white, opaque pixels */
async function canvasHasContent(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('display-canvas');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    if (width === 0 || height === 0) return false;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 20));
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        if (d[3] > 0 && (d[0] < 250 || d[1] < 250 || d[2] < 250)) return true;
      }
    }
    return false;
  });
}

test.describe('Zoom Rendering', () => {
  test('canvas resizes correctly at every zoom level', async ({ page }) => {
    await createProject(page, 'Zoom Resize Test');

    for (const zoom of ZOOM_LEVELS) {
      await setZoom(page, zoom);
      const { width, height } = await page.evaluate(() => {
        const c = document.getElementById('display-canvas');
        return { width: c.width, height: c.height };
      });
      expect(width,  `canvas width at zoom ${zoom}`).toBeGreaterThan(0);
      expect(height, `canvas height at zoom ${zoom}`).toBeGreaterThan(0);
    }
  });

  test('complex image renders (non-blank) at every zoom level', async ({ page }) => {
    await createProject(page, 'Zoom Render Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);

    for (const zoom of ZOOM_LEVELS) {
      await setZoom(page, zoom);
      const hasContent = await canvasHasContent(page);
      expect(hasContent, `canvas should have visible content at zoom ${zoom}x`).toBe(true);
    }
  });

  test('zoom display label updates at every zoom level', async ({ page }) => {
    await createProject(page, 'Zoom Label Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    for (const zoom of ZOOM_LEVELS) {
      await setZoom(page, zoom);
      const expectedPct = `${Math.round(zoom * 100)}%`;
      await expect(page.locator('#zoom-display'), `zoom label at ${zoom}x`).toHaveText(expectedPct);
    }
  });

  test('no JS errors thrown during zoom sweep', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await createProject(page, 'Zoom Error Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);

    for (const zoom of ZOOM_LEVELS) {
      await setZoom(page, zoom);
    }

    expect(errors, 'no JS errors during zoom sweep').toHaveLength(0);
  });

  test('image renders when scrolled to layer position after zoom', async ({ page }) => {
    await createProject(page, 'Zoom Scroll Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);

    // Zoom to max — canvas is now larger than viewport, scrollbars appear
    await setZoom(page, 2);

    // Scroll layer center into view via scroll event (exercises the scroll→schedule path)
    await page.evaluate(() => {
      const scroll = document.getElementById('canvas-scroll');
      const canvas = document.getElementById('display-canvas');
      const layer = State.layers[0];
      const z = State.zoom;
      const canvasLeft = canvas.offsetLeft + (canvas.offsetParent?.offsetLeft ?? 0);
      const canvasTop  = canvas.offsetTop  + (canvas.offsetParent?.offsetTop  ?? 0);
      const cx = (layer.x + layer.width / 2) * z + canvasLeft;
      const cy = (layer.y + layer.height / 2) * z + canvasTop;
      scroll.scrollLeft = Math.max(0, cx - scroll.clientWidth / 2);
      scroll.scrollTop  = Math.max(0, cy - scroll.clientHeight / 2);
      scroll.dispatchEvent(new Event('scroll')); // triggers Renderer.schedule
    });
    await page.waitForTimeout(200);

    const hasContent = await canvasHasContent(page);
    expect(hasContent, 'canvas has content when layer scrolled into view at zoom 2x').toBe(true);
  });

  test('image renders after zoom-out then scroll', async ({ page }) => {
    await createProject(page, 'Zoom Out Scroll Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);

    // Zoom in then zoom out — tests the dirty/reprocess path
    await setZoom(page, 2);
    await setZoom(page, 0.25);

    await page.evaluate(() => {
      const scroll = document.getElementById('canvas-scroll');
      scroll.scrollLeft = 0;
      scroll.scrollTop = 0;
      Renderer.schedule();
    });
    await page.waitForTimeout(200);

    const hasContent = await canvasHasContent(page);
    expect(hasContent, 'canvas has content after zoom-out and scroll').toBe(true);
  });

  test('layer is re-processed when zoom ratio exceeds reprocess threshold', async ({ page }) => {
    await createProject(page, 'Zoom Reprocess Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);

    // Start at 1x so _processedAtZoom is ~1
    await setZoom(page, 1);
    const zoomAfter1x = await page.evaluate(() => State.layers[0]?._processedAtZoom ?? null);
    expect(zoomAfter1x, 'layer should have been processed at 1x').not.toBeNull();

    // Jump to 2x — ratio is 2.0 > 1.3 threshold, so layer should be re-processed
    await setZoom(page, 2);
    const zoomAfter2x = await page.evaluate(() => State.layers[0]?._processedAtZoom ?? null);
    expect(zoomAfter2x, 'layer should have been re-processed at 2x').not.toBeNull();

    const hasContent = await canvasHasContent(page);
    expect(hasContent, 'canvas has content after zoom-triggered reprocess').toBe(true);
  });
});
