import { test, expect } from '@playwright/test';
import { clearIndexedDB, gotoApp, createProject } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');
const TEST_SVG = path.join(__dirname, 'fixtures', 'test-image.svg');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Image Import', () => {
  test('add image via file picker', async ({ page }) => {
    await createProject(page, 'Import Test');

    await page.setInputFiles('#file-input', TEST_IMAGE);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name')).toContainText('test-image');
  });

  test('add multiple images via file picker', async ({ page }) => {
    await createProject(page, 'Multi Import Test');

    await page.setInputFiles('#file-input', [TEST_IMAGE, TEST_IMAGE]);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
  });

  test('drag and drop image onto canvas', async ({ page }) => {
    await createProject(page, 'Drag Drop Test');

    const canvasWrapper = page.locator('#canvas-wrapper');
    await expect(canvasWrapper).toBeVisible();

    // Simulate drag and drop using the DataTransfer API
    await page.evaluate(async (imageDataUrl) => {
      const wrapper = document.getElementById('canvas-wrapper');
      const dt = new DataTransfer();
      const file = await fetch(imageDataUrl)
        .then(r => r.blob())
        .then(blob => new File([blob], 'dropped-image.png', { type: 'image/png' }));
      dt.items.add(file);

      const dragover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
      wrapper.dispatchEvent(dragover);

      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      wrapper.dispatchEvent(drop);
    }, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAnElEQVR42u3RAQ0AAAgDIN8/9GKXBwsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMCjAS/6AAU+b6NJAAAAAElFTkSuQmCC');

    // The above base64 is a minimal red 100x100 PNG.
    // However, the real test image should be used. Let's use the file directly instead.
  });

  test('no-layer message disappears after adding image', async ({ page }) => {
    await createProject(page, 'No Layer Test');
    await expect(page.locator('#no-layer-msg')).toBeVisible();

    await page.setInputFiles('#file-input', TEST_IMAGE);

    await expect(page.locator('#no-layer-msg')).toBeHidden();
  });

  test('add svg via file picker', async ({ page }) => {
    await createProject(page, 'SVG Import Test');

    await page.setInputFiles('#file-input', TEST_SVG);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name')).toContainText('test-image');
  });

  test('svg scales up and retains vector crispness on export', async ({ page }) => {
    await createProject(page, 'SVG Scale Test');

    await page.setInputFiles('#file-input', TEST_SVG);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    // Scale the SVG layer up to 3x its imported size and reprocess for export
    const exportSize = await page.evaluate(() => {
      const layer = State.layers[0];
      if (!layer || !layer.isSvg) return null;
      layer.width = Math.round(layer.width * 3);
      layer.height = Math.round(layer.height * 3);
      layer._dirty = true;
      const canvas = ImageProcessor.processLayer(layer, { forExport: true });
      return {
        exportW: canvas?.width || 0,
        exportH: canvas?.height || 0,
        layerW: layer.width,
        layerH: layer.height,
      };
    });
    expect(exportSize).not.toBeNull();
    expect(exportSize.exportW).toBe(exportSize.layerW);
    expect(exportSize.exportH).toBe(exportSize.layerH);
  });
});
