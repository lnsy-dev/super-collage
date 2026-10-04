import { test, expect } from '@playwright/test';
import { clearIndexedDB } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Text layer integration', () => {
  test('can add a text layer and see it rendered', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto('/');

    // Create a project
    await page.fill('#create-project-name', 'Text Test');
    await page.click('#btn-create-next'); // Units -> Page Size
    await page.click('#btn-create-next'); // Page Size -> Pages
    await page.click('#btn-create-next'); // Pages -> Create

    // Wait for main app
    await expect(page.locator('#main-app')).toBeVisible();


    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible();
    await editor.fill('Hello, type-set!');
    await page.keyboard.press('Escape');
    // Wait for layer to appear
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text/ })).toBeVisible();

    // Wait for the async text render to produce a processed canvas
    try {
      await page.waitForFunction(() => {
        const layer = window.State.layers.find(l => l.isText);
        return !!layer?._processedCanvas;
      }, { timeout: 10000 });
    } catch (e) {
      errors.forEach(err => console.log('CONSOLE ERROR:', err));
      throw e;
    }

    // Verify the text is what we typed
    const text = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      return layer?.text;
    });
    expect(text).toBe('Hello, type-set!');

    // Verify the processed canvas has ink pixels (text) and transparent pixels
    // (background), confirming it is not a solid black/colored box.
    const pixelStats = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      const ctx = layer._processedCanvas.getContext('2d');
      const { width, height } = layer._processedCanvas;
      const d = ctx.getImageData(0, 0, width, height).data;
      let opaque = 0, transparent = 0;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 10) opaque++;
        else transparent++;
      }
      return { width, height, opaque, transparent };
    });
    expect(pixelStats.opaque).toBeGreaterThan(0);
    expect(pixelStats.transparent).toBeGreaterThan(0);
  });

  test('updating text re-renders the layer', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto('/');

    // Create a project
    await page.fill('#create-project-name', 'Text Test');
    await page.click('#btn-create-next'); // Units -> Page Size
    await page.click('#btn-create-next'); // Page Size -> Pages
    await page.click('#btn-create-next'); // Pages -> Create
    await expect(page.locator('#main-app')).toBeVisible();

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible();
    await editor.fill('Hello, type-set!');
    await page.keyboard.press('Escape');

    // Wait for the layer to render
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text/ })).toBeVisible();
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return !!layer?._processedCanvas;
    }, { timeout: 10000 });

    // Change the text in the properties panel
    await page.fill('#prop-text', 'Goodbye, type-set!');
    await page.locator('#prop-text').blur();

    // Wait for re-render and verify the new text is stored
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return layer?.text === 'Goodbye, type-set!';
    }, { timeout: 10000 });

    const pixelStats = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      const ctx = layer._processedCanvas.getContext('2d');
      const { width, height } = layer._processedCanvas;
      const d = ctx.getImageData(0, 0, width, height).data;
      let opaque = 0, transparent = 0;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 10) opaque++;
        else transparent++;
      }
      return { opaque, transparent };
    });
    expect(pixelStats.opaque).toBeGreaterThan(0);
    expect(pixelStats.transparent).toBeGreaterThan(0);
  });

  test('resizing text box re-renders text instead of stretching', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto('/');

    // Create a project
    await page.fill('#create-project-name', 'Text Resize Test');
    await page.click('#btn-create-next'); // Units -> Page Size
    await page.click('#btn-create-next'); // Page Size -> Pages
    await page.click('#btn-create-next'); // Pages -> Create
    await expect(page.locator('#main-app')).toBeVisible();

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible();
    await editor.fill('Hello, type-set!');
    await page.keyboard.press('Escape');

    // Wait for the layer to render
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text/ })).toBeVisible();
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return !!layer?._processedCanvas;
    }, { timeout: 10000 });

    // Resize the text box via the W property input
    await page.fill('#prop-w', '600');
    await page.keyboard.press('Enter');

    // Wait for re-render and verify dimensions match the new box size
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return layer && layer._processedCanvas
        && layer._processedCanvas.width === Math.round(layer.width * 2)
        && layer._processedCanvas.height === Math.round(layer.height * 2);
    }, { timeout: 10000 });

    const dims = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      return {
        width: layer.width,
        height: layer.height,
        naturalWidth: layer.naturalWidth,
        naturalHeight: layer.naturalHeight,
        processedWidth: layer._processedCanvas.width,
        processedHeight: layer._processedCanvas.height,
      };
    });
    expect(dims.width).toBe(600);
    expect(dims.naturalWidth).toBe(600);
    expect(dims.processedWidth).toBe(Math.round(dims.width * 2));
    expect(dims.processedHeight).toBe(Math.round(dims.height * 2));

    // Also resize by dragging the right-middle handle
    const canvasBox = await page.locator('#interaction-overlay').boundingBox();
    if (!canvasBox) throw new Error('Canvas not found');

    const startHandle = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      const h = window.Renderer.getHandles(layer, window.State.zoom).find(h => h.id === 'mr');
      return h;
    });

    const startX = canvasBox.x + startHandle.x;
    const startY = canvasBox.y + startHandle.y;
    const endX = startX + 100;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, startY, { steps: 5 });
    await page.mouse.up();

    // Wait for re-render after handle resize
    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return layer && layer._processedCanvas
        && layer._processedCanvas.width === Math.round(layer.width * 2)
        && layer._processedCanvas.height === Math.round(layer.height * 2);
    }, { timeout: 10000 });

    const handleDims = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      return {
        width: layer.width,
        naturalWidth: layer.naturalWidth,
        processedWidth: layer._processedCanvas.width,
      };
    });
    expect(handleDims.width).toBeGreaterThan(600);
    expect(handleDims.naturalWidth).toBe(handleDims.width);
    expect(handleDims.processedWidth).toBe(Math.round(handleDims.width * 2));

    if (errors.length) {
      errors.forEach(err => console.log('CONSOLE ERROR:', err));
    }
    expect(errors).toHaveLength(0);
  });

  test('export processLayer returns 1x canvas sized to layer dimensions', async ({ page }) => {
    await page.goto('/');
    await page.fill('#create-project-name', 'Text Export Size Test');
    await page.click('#btn-create-next'); // Units -> Page Size
    await page.click('#btn-create-next'); // Page Size -> Pages
    await page.click('#btn-create-next'); // Pages -> Create
    await expect(page.locator('#main-app')).toBeVisible();

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible();
    await editor.fill('Export size test');
    await page.keyboard.press('Escape');

    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return !!layer?._processedCanvas;
    }, { timeout: 10000 });

    // Simulate what the export engine does: call processLayer with forExport=true
    const result = await page.evaluate(async () => {
      const layer = window.State.layers.find(l => l.isText);
      const exportCanvas = await window.ImageProcessor.processLayer(layer, { forExport: true });
      return {
        layerWidth: layer.width,
        layerHeight: layer.height,
        exportWidth: exportCanvas?.width,
        exportHeight: exportCanvas?.height,
        // Display canvas is 2x supersampled
        displayWidth: layer._processedCanvas?.width,
        displayHeight: layer._processedCanvas?.height,
      };
    });

    // Export canvas must be 1x (layer.width × layer.height)
    expect(result.exportWidth).toBe(result.layerWidth);
    expect(result.exportHeight).toBe(result.layerHeight);
    // Display canvas must be 2x
    expect(result.displayWidth).toBe(Math.round(result.layerWidth * 2));
    expect(result.displayHeight).toBe(Math.round(result.layerHeight * 2));
  });

  test('variant dropdown lists weight/style combinations and updates layer', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
    await page.goto('/');
    await page.fill('#create-project-name', 'Text Variant Test');
    await page.click('#btn-create-next'); // Units -> Page Size
    await page.click('#btn-create-next'); // Page Size -> Pages
    await page.click('#btn-create-next'); // Pages -> Create
    await expect(page.locator('#main-app')).toBeVisible();

    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    const editor = page.locator('.text-editor-input');
    await expect(editor).toBeVisible();
    await editor.fill('Hello, variant!');
    await page.keyboard.press('Escape');

    await page.waitForFunction(() => {
      const layer = window.State.layers.find(l => l.isText);
      return !!layer?._processedCanvas;
    }, { timeout: 10000 });

    // Default font (IBM Plex Serif) has italic, so variant list should include italic combos.
    const variantSelect = page.locator('#prop-text-variant');
    await expect(variantSelect).toBeVisible();
    await expect(variantSelect).toHaveValue('400:normal');

    const serifOptions = await variantSelect.evaluate(sel => [...sel.options].map(o => o.value));
    expect(serifOptions).toContain('400:italic');
    expect(serifOptions).toContain('700:normal');

    // Helper: checksum of rendered text pixels to detect actual visual changes.
    const pixelChecksum = async () => page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      const ctx = layer._processedCanvas.getContext('2d');
      const { width, height } = layer._processedCanvas;
      const d = ctx.getImageData(0, 0, width, height).data;
      let h = 2166136261;
      for (let i = 3; i < d.length; i += 4) {
        h ^= d[i];
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
      }
      return h >>> 0;
    });

    const normalChecksum = await pixelChecksum();

    // Select an italic variant and verify layer weight/style and re-render.
    await variantSelect.selectOption('400:italic');
    await expect(async () => {
      const props = await page.evaluate(() => {
        const layer = window.State.layers.find(l => l.isText);
        return { weight: layer?.textFontWeight, style: layer?.textFontStyle };
      });
      expect(props).toEqual({ weight: 400, style: 'italic' });
    }).toPass({ timeout: 5000 });

    // The italic re-render is async — poll until the pixels actually change.
    await expect(async () => {
      const italicChecksum = await pixelChecksum();
      expect(italicChecksum).not.toBe(normalChecksum);
    }).toPass({ timeout: 10000 });

    // Switch to a font without italic; dropdown should only contain normal variants.
    await page.selectOption('#prop-text-font', 'Fira Code');
    const firaOptions = await variantSelect.evaluate(sel => [...sel.options].map(o => o.value));
    expect(firaOptions.every(v => v.endsWith(':normal'))).toBe(true);
    await expect(variantSelect).toHaveValue('400:normal');

    const propsAfterSwitch = await page.evaluate(() => {
      const layer = window.State.layers.find(l => l.isText);
      return { weight: layer?.textFontWeight, style: layer?.textFontStyle };
    });
    expect(propsAfterSwitch).toEqual({ weight: 400, style: 'normal' });

    if (errors.length) errors.forEach(err => console.log('CONSOLE ERROR:', err));
    expect(errors).toHaveLength(0);
  });
});

/* ─── TEXT SCALES WITH ITS BLOCK ─────────────────────────────────
   Resizing a text block must scale the type with it. The font (and its
   letter spacing) scale with the block, and the box is grown when the
   scaled type needs more room than the dragged size — so the text is
   never left clipped inside a box it no longer fits. */

/** Font metrics + ink bounding box of the first text layer's raster. */
function measureTextLayer() {
  const layer = window.State.layers.find(l => l.isText);
  const canvas = layer._processedCanvas;
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, w, h).data;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    fontSize: layer.textFontSize,
    letterSpacing: layer.textLetterSpacing,
    width: layer.width,
    height: layer.height,
    naturalWidth: layer.naturalWidth,
    naturalHeight: layer.naturalHeight,
    inkW: Math.max(0, maxX - minX),
    inkBottom: maxY,
    canvasW: w,
    canvasH: h,
  };
}

/** Wait until the raster matches the layer's current box size. */
async function waitForTextRender(page) {
  await page.waitForFunction(() => {
    const l = window.State.layers.find(x => x.isText);
    return !!l?._processedCanvas
      && l._processedCanvas.width === Math.round(l.width * 2)
      && l._processedCanvas.height === Math.round(l.height * 2);
  }, { timeout: 10000 });
}

/** Checksum of the rendered text pixels (box size alone cannot tell a
    font/spacing re-render apart from a stale one). */
function textPixelChecksum(page) {
  return page.evaluate(() => {
    const c = window.State.layers.find(l => l.isText)._processedCanvas;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let i = 3; i < d.length; i += 4) {
      h ^= d[i];
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return h >>> 0;
  });
}

async function addTextLayer(page, name, text) {
  await page.fill('#create-project-name', name);
  await page.click('#btn-create-next'); // Units -> Page Size
  await page.click('#btn-create-next'); // Page Size -> Pages
  await page.click('#btn-create-next'); // Pages -> Create
  await expect(page.locator('#main-app')).toBeVisible();

  await page.click('[data-menu="file"]');
  await page.click('[data-action="add-text"]');
  const editor = page.locator('.text-editor-input');
  await expect(editor).toBeVisible();
  await editor.fill(text);
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text/ })).toBeVisible();
  await page.waitForFunction(() => !!window.State.layers.find(l => l.isText)?._processedCanvas,
    { timeout: 10000 });
  await waitForTextRender(page);
}

/** Drag a resize handle of the text layer by (dx, dy) screen pixels. */
async function dragTextHandle(page, handleId, dx, dy) {
  const box = await page.locator('#interaction-overlay').boundingBox();
  const start = await page.evaluate(id => {
    const layer = window.State.layers.find(l => l.isText);
    const h = window.Renderer.getHandles(layer, window.State.zoom).find(h => h.id === id);
    return h ? { x: h.x, y: h.y } : null;
  }, handleId);
  if (!box || !start) throw new Error(`Could not locate the ${handleId} handle`);

  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + start.x + dx, box.y + start.y + dy, { steps: 8 });
  await page.mouse.up();
  await waitForTextRender(page);
}

test.describe('Text scales with its block', () => {
  test('corner resize scales the type with the block instead of snapping back', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto('/');
    await addTextLayer(page, 'Text Scale Drag', 'Hello, type-set!');
    const before = await page.evaluate(measureTextLayer);

    const zoom = await page.evaluate(() => window.State.zoom);
    const d = Math.round(before.width * 0.5 * zoom); // ~1.5x scale, aspect kept
    await dragTextHandle(page, 'br', d, d);

    const after = await page.evaluate(measureTextLayer);
    const k = after.width / before.width;
    expect(k).toBeGreaterThan(1.2);
    expect(after.height / before.height).toBeCloseTo(k, 2);

    // The font followed the block...
    expect(after.fontSize / before.fontSize).toBeCloseTo(k, 1);
    // ...and the rasterized type really is bigger, not the old size in a
    // bigger box (the jump the user reported).
    expect(after.inkW / before.inkW).toBeCloseTo(k, 1);
    // Nothing clipped at the bottom of the box.
    expect(after.canvasH - after.inkBottom).toBeGreaterThan(4);

    expect(after.naturalWidth).toBe(after.width);
    expect(after.naturalHeight).toBe(after.height);
    if (errors.length) errors.forEach(err => console.log('CONSOLE ERROR:', err));
    expect(errors).toHaveLength(0);
  });

  test('width+height property resize scales the type and its letter spacing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto('/');
    await addTextLayer(page, 'Text Scale Props', 'Hello, type-set!');

    // Non-zero letter spacing so its scaling is observable. Letter spacing
    // does not change the raster size, so wait for the pixels to change.
    const preSpacingPixels = await textPixelChecksum(page);
    await page.fill('#prop-text-spacing', '4');
    await page.keyboard.press('Enter');
    await expect.poll(() => textPixelChecksum(page)).not.toBe(preSpacingPixels);
    await waitForTextRender(page);
    const before = await page.evaluate(measureTextLayer);
    expect(before.letterSpacing).toBeCloseTo(4, 1);

    await page.fill('#prop-w', String(Math.round(before.width * 2)));
    await page.keyboard.press('Enter');
    await waitForTextRender(page);
    await page.fill('#prop-h', String(Math.round(before.height * 2)));
    await page.keyboard.press('Enter');
    await waitForTextRender(page);

    const after = await page.evaluate(measureTextLayer);
    // Uniform font scale whose area matches the block's: the two property
    // edits compose to sqrt(area ratio) no matter which order they land.
    const k = Math.sqrt((after.width * after.height) / (before.width * before.height));
    expect(k).toBeGreaterThan(1.5);
    expect(after.fontSize / before.fontSize).toBeCloseTo(k, 1);
    expect(after.letterSpacing / before.letterSpacing).toBeCloseTo(k, 1);
    expect(after.inkW / before.inkW).toBeCloseTo(k, 1);
    expect(after.canvasH - after.inkBottom).toBeGreaterThan(4);

    expect(after.naturalWidth).toBe(after.width);
    expect(after.naturalHeight).toBe(after.height);
    if (errors.length) errors.forEach(err => console.log('CONSOLE ERROR:', err));
    expect(errors).toHaveLength(0);
  });

  test('width-only resize grows the box so the scaled type is never clipped', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto('/');
    await addTextLayer(page, 'Text Width Only', 'Hanging jog');

    // Squeeze the box height first. Text boxes only ever grow on a resize
    // (the user's dragged size is the floor), so this is the state where
    // a wider box would leave the now-larger type hanging past the bottom.
    await page.fill('#prop-h', '60');
    await page.keyboard.press('Enter');
    await waitForTextRender(page);
    const before = await page.evaluate(measureTextLayer);
    expect(before.height).toBe(60);

    await page.fill('#prop-w', String(Math.round(before.width * 1.6)));
    await page.keyboard.press('Enter');
    await waitForTextRender(page);

    const after = await page.evaluate(measureTextLayer);
    // The type scaled up even though only the width was edited...
    expect(after.fontSize).toBeGreaterThan(before.fontSize);
    // ...so the box grew with it instead of clipping the descenders, and
    // it never snaps back below the dragged width.
    expect(after.width).toBe(Math.round(before.width * 1.6));
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.canvasH - after.inkBottom).toBeGreaterThan(4);
    expect(after.naturalHeight).toBe(after.height);

    if (errors.length) errors.forEach(err => console.log('CONSOLE ERROR:', err));
    expect(errors).toHaveLength(0);
  });

  test('undoing a text resize restores the original type size', async ({ page }) => {
    await page.goto('/');
    await addTextLayer(page, 'Text Scale Undo', 'Hello, type-set!');
    const before = await page.evaluate(measureTextLayer);

    const zoom = await page.evaluate(() => window.State.zoom);
    const d = Math.round(before.width * 0.5 * zoom);
    await dragTextHandle(page, 'br', d, d);

    const scaled = await page.evaluate(measureTextLayer);
    expect(scaled.fontSize).toBeGreaterThan(before.fontSize);

    await page.keyboard.press('Control+z');
    await waitForTextRender(page);

    const undone = await page.evaluate(measureTextLayer);
    expect(undone.fontSize).toBeCloseTo(before.fontSize, 1);
    expect(undone.width).toBeCloseTo(before.width, 0);
    expect(undone.inkW).toBeCloseTo(before.inkW, 0);
  });
});
