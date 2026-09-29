import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage, addImageFromBuffer, addTextLayer, createShapePngBuffer, createSolidPngBuffer } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Flatten layer', () => {
  test('flatten button is present in layer buttons', async ({ page }) => {
    await createProject(page, 'Flatten Button Test');
    await addImage(page, TEST_IMAGE);
    await expect(page.locator('#layer-buttons [data-action="flatten-layer"]')).toBeVisible();
  });

  test('flatten crops to visible pixels without a mask', async ({ page }) => {
    await createProject(page, 'Flatten Crop Test');
    // 200x200 image with a 100x100 black rect centered on white.
    await addImageFromBuffer(page, createShapePngBuffer('rect', 200, 200), { name: 'rect.png' });

    const before = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { nw: l.naturalWidth, nh: l.naturalHeight, x: l.x, y: l.y, w: l.width, h: l.height };
    });

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      return {
        nw: l.naturalWidth,
        nh: l.naturalHeight,
        x: l.x,
        y: l.y,
        w: l.width,
        h: l.height,
        hasMaskCanvas: !!l._maskCanvas,
        imageMaskIds: l.imageMaskIds?.length || 0,
      };
    });

    // The black rect occupies the center 100x100 pixels.
    expect(after.nw).toBe(100);
    expect(after.nh).toBe(100);
    // Display size scaled proportionally.
    expect(Math.round(after.w)).toBe(Math.round(before.w * 100 / before.nw));
    expect(Math.round(after.h)).toBe(Math.round(before.h * 100 / before.nh));
    // Position adjusted so the visible content stays in the same place (no rotation).
    expect(Math.round(after.x)).toBe(Math.round(before.x + (before.w - after.w) / 2));
    expect(Math.round(after.y)).toBe(Math.round(before.y + (before.h - after.h) / 2));
    expect(after.hasMaskCanvas).toBe(false);
    expect(after.imageMaskIds).toBe(0);
  });

  test('flatten applies manual mask and crops', async ({ page }) => {
    await createProject(page, 'Flatten Manual Mask Test');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 200, 200), { name: 'solid.png' });

    // Hide everything, then reveal a circle on the right side.
    await page.evaluate(() => {
      const l = window.State.layers[0];
      window.MaskEngine.fillMask(l);
      window.MaskEngine._paint(l, l.naturalWidth * 0.75, l.naturalHeight / 2, l.naturalWidth / 4, true);
    });

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      return {
        nw: l.naturalWidth,
        nh: l.naturalHeight,
        hasMaskCanvas: !!l._maskCanvas,
      };
    });

    // The revealed circle is 100x100 in natural pixels.
    expect(after.nw).toBe(100);
    expect(after.nh).toBe(100);
    expect(after.hasMaskCanvas).toBe(false);
  });

  test('flatten applies image mask, removes relationship, and deletes mask layer', async ({ page }) => {
    await createProject(page, 'Flatten Image Mask Test');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 200, 200), { name: 'base.png' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 150, 200), { name: 'maskimg.png' });

    // Position the mask layer over the left 150px of the base.
    await page.evaluate(() => {
      const base = window.State.layers[0];
      const mask = window.State.layers[1];
      mask.x = base.x;
      mask.y = base.y;
    });

    await page.evaluate(async () => {
      const base = window.State.layers[0];
      const mask = window.State.layers[1];
      window.State.selectedIds = [base.id, mask.id];
      window.State.selectedId = mask.id;
      await window.handleAction('create-image-mask');
    });

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    await page.locator('.layer-row').nth(0).click();
    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      return {
        layerCount: window.State.layers.length,
        nw: l.naturalWidth,
        nh: l.naturalHeight,
        imageMaskIds: l.imageMaskIds?.length || 0,
        hasMaskCanvas: !!l._maskCanvas,
      };
    });

    // Mask layer should be deleted after flatten.
    expect(after.layerCount).toBe(1);
    // Base layer should be cropped to the 50px-wide visible strip on the right.
    expect(after.nw).toBe(50);
    expect(after.nh).toBe(200);
    expect(after.imageMaskIds).toBe(0);
    expect(after.hasMaskCanvas).toBe(false);
  });

  test('flatten converts a text layer to a standard pixel layer', async ({ page }) => {
    await createProject(page, 'Flatten Text Test');
    await addTextLayer(page, 'Hello');

    const before = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { isText: l.isText, nw: l.naturalWidth, nh: l.naturalHeight, x: l.x, y: l.y, w: l.width, h: l.height };
    });
    expect(before.isText).toBe(true);

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { isText: l.isText, hasOriginal: !!l._originalCanvas, nw: l.naturalWidth, nh: l.naturalHeight };
    });

    // The text layer became a raster pixel layer.
    expect(after.isText).toBe(false);
    expect(after.hasOriginal).toBe(true);
    // Content was baked at natural size and cropped to the text's bounding box.
    expect(after.nw).toBeGreaterThan(0);
    expect(after.nw).toBeLessThanOrEqual(before.nw);
    expect(after.nh).toBeLessThanOrEqual(before.nh);

    // Persists as a pixel layer across reload (image blob stored in IndexedDB).
    // Wait for flatten's final IndexedDB write to land before reloading.
    await page.waitForFunction(async () => {
      const all = await new Promise((res, rej) => {
        const req = window.DB._db.transaction('layers').objectStore('layers').getAll();
        req.onsuccess = e => res(e.target.result);
        req.onerror = rej;
      });
      return all.length === 1 && all[0].isText === false;
    }, null, { timeout: 10000 });

    await page.reload();
    await expect(page.locator('#project-dialog')).toBeVisible();
    await page.locator('.project-entry', { hasText: 'Flatten Text Test' }).click();
    await page.click('#btn-open-project');
    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('.layer-row')).toHaveCount(1);
    const reloaded = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { isText: l.isText, hasOriginal: !!l._originalCanvas, nw: l.naturalWidth };
    });
    expect(reloaded.isText).toBe(false);
    expect(reloaded.hasOriginal).toBe(true);
    expect(reloaded.nw).toBe(after.nw);
  });

  test('undo restores a flattened text layer back to editable text', async ({ page }) => {
    await createProject(page, 'Flatten Text Undo Test');
    await addTextLayer(page, 'Hello');

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();
    await expect(page.locator('#layer-list .layer-name').filter({ hasText: /^T / })).toHaveCount(0);

    await page.keyboard.press('Control+z');

    const restored = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { isText: l.isText, hasTextContent: l.text === 'Hello' };
    });
    expect(restored.isText).toBe(true);
    expect(restored.hasTextContent).toBe(true);
  });
});

/* ── SVG layers ──────────────────────────────────────────────────── */

// A coloured shape inset from the layer edges: flatten should crop the
// layer down to it. Deliberately saturated red, so any "is it ink?" test
// that only looks at darkness gets this wrong.
const SVG_INSET = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><rect x="50" y="20" width="100" height="80" fill="#cc0000"/><circle cx="100" cy="60" r="20" fill="#ffffff"/></svg>';

// Solid ink with a white circle punched out of it, for the mask tests.
const SVG_SOLID = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><rect width="200" height="120" fill="#cc0000"/><circle cx="100" cy="60" r="30" fill="#ffffff"/></svg>';

// Authored big enough that the layer's natural size (96→600 DPI scaling,
// x6.25) exceeds MaskEngine's 4096px mask cap — the case where mask
// resolution and natural resolution differ.
const LARGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700"><rect x="200" y="150" width="500" height="400" fill="#cc0000"/><circle cx="450" cy="350" r="150" fill="#ffffff"/></svg>';

async function addSvg(page, svg, name = 'shape.svg') {
  await page.setInputFiles('#file-input', {
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg, 'utf8'),
  });
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
}

test.describe('Flatten layer – SVG', () => {
  test('flatten rasterises an SVG layer and crops to the visible artwork', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await createProject(page, 'Flatten SVG Test');
    await addSvg(page, SVG_INSET);

    const before = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { isSvg: l.isSvg, nw: l.naturalWidth, nh: l.naturalHeight, w: l.width, h: l.height };
    });
    expect(before.isSvg).toBe(true);

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();
    // Wait for the whole operation: the bake clears isSvg early, the crop
    // and mask drop happen later, and the renderer clears _dirty at the end.
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !l.isSvg && l._originalCanvas && !l._maskCanvas && !l._dirty;
    }, null, { timeout: 15000 });

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      const ctx = l._originalCanvas.getContext('2d');
      return {
        isSvg: l.isSvg,
        hasImage: !!l._svgImage,
        hasOriginal: !!l._originalCanvas,
        nw: l.naturalWidth,
        nh: l.naturalHeight,
        // The white hole is now empty, so the bbox shrinks around it.
        centre: ctx.getImageData(Math.floor(l.naturalWidth / 2), Math.floor(l.naturalHeight / 2), 1, 1).data[0],
        corner: ctx.getImageData(1, 1, 1, 1).data[0],
        w: l.width, h: l.height,
      };
    });

    expect(after.isSvg).toBe(false);
    expect(after.hasImage).toBe(false);   // the vector is gone — that's the point
    expect(after.hasOriginal).toBe(true);
    expect(after.centre).toBe(255);       // the shape's own white circle
    // Cropped to the shape, which sat inside a 50% x 66% inset of the layer.
    expect(after.nw / before.nw).toBeCloseTo(0.5, 1);
    expect(after.nh / before.nh).toBeCloseTo(0.67, 1);
    // The crop starts on the shape's own corner, so it is ink — and ink
    // means "not white" for a *coloured* shape too.
    expect(after.corner).toBeLessThan(255);
    // On-page size tracks the crop, so the layer stays where it was.
    expect(after.w / before.w).toBeCloseTo(after.nw / before.nw, 1);
    expect(after.h / before.h).toBeCloseTo(after.nh / before.nh, 1);
    expect(errors).toEqual([]);
  });

  test('a flattened SVG survives a reload as a pixel layer', async ({ page }) => {
    await createProject(page, 'Flatten SVG Reload');
    await addSvg(page, SVG_SOLID);

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !l.isSvg && l._originalCanvas;
    }, null, { timeout: 15000 });
    const nw = await page.evaluate(() => window.State.layers[0].naturalWidth);

    await page.waitForFunction(async () => {
      const all = await new Promise((res) => {
        const req = window.DB._db.transaction('layers').objectStore('layers').getAll();
        req.onsuccess = e => res(e.target.result);
      });
      return all.length === 1 && all[0].isSvg === false;
    }, null, { timeout: 10000 });

    await page.reload();
    await page.locator('.project-entry', { hasText: 'Flatten SVG Reload' }).click();
    await page.click('#btn-open-project');
    await expect(page.locator('.layer-row')).toHaveCount(1);

    const reloaded = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { isSvg: l.isSvg, hasOriginal: !!l._originalCanvas, nw: l.naturalWidth };
    });
    expect(reloaded.isSvg).toBe(false);
    expect(reloaded.hasOriginal).toBe(true);
    expect(reloaded.nw).toBe(nw);
  });

  test('a painted mask is baked in and crops the SVG to the visible part', async ({ page }) => {
    await createProject(page, 'Flatten SVG Mask');
    await addSvg(page, SVG_SOLID);

    // Punch a hole off-centre (the artwork's own white circle is in the
    // middle) so the mask is clearly not part of the vector.
    await page.click('.tool-btn[data-tool="mask-draw"]');
    const pt = await page.evaluate(() => {
      const l = window.State.layers[0];
      const r = document.getElementById('interaction-overlay').getBoundingClientRect();
      return {
        x: r.left + (l.x + l.width * 0.3 + 1000) * window.State.zoom,
        y: r.top + (l.y + l.height * 0.35 + 1000) * window.State.zoom,
      };
    });
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => {
      const mc = window.State.layers[0]._maskCanvas;
      if (!mc) return null;
      return mc.getContext('2d').getImageData(
        Math.floor(mc.width * 0.3), Math.floor(mc.height * 0.35), 1, 1).data[3];
    }), { timeout: 5000 }).toBe(0);

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !l.isSvg && l._originalCanvas && !l._maskCanvas && !l._dirty;
    }, null, { timeout: 15000 });

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      const ctx = l._originalCanvas.getContext('2d');
      return {
        nw: l.naturalWidth, nh: l.naturalHeight,
        hasMask: !!l._maskCanvas,
        centre: ctx.getImageData(Math.floor(l.naturalWidth / 2), Math.floor(l.naturalHeight / 2), 1, 1).data[0],
        corner: ctx.getImageData(1, 1, 1, 1).data[0],
      };
    });
    // Mask baked in: the masked-out centre is white, the mask is gone, and
    // the remaining ink was cropped to.
    expect(after.hasMask).toBe(false);
    expect(after.corner).toBeLessThan(255);
    expect(after.nw).toBeGreaterThan(0);
    expect(after.nh).toBeGreaterThan(0);
  });

  test('a large SVG (mask bitmap smaller than natural size) is not wiped by its mask', async ({ page }) => {
    // Regression: flatten used to read the mask canvas at *natural* size.
    // For a layer whose natural size is past the 4096px mask cap that reads
    // transparent black for everything outside the bitmap, which blanked the
    // whole layer.
    await createProject(page, 'Flatten Big SVG');
    await addSvg(page, LARGE_SVG, 'big.svg');

    const sizes = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { nw: l.naturalWidth, nh: l.naturalHeight, mask: [l._maskCanvas.width, l._maskCanvas.height] };
    });
    expect(Math.max(sizes.nw, sizes.nh)).toBeGreaterThan(4096);
    expect(Math.max(...sizes.mask)).toBeLessThanOrEqual(4096);

    // A small brush hole, off-centre, so the crop has to keep real ink.
    await page.click('.tool-btn[data-tool="mask-draw"]');
    const pt = await page.evaluate(() => {
      const l = window.State.layers[0];
      const r = document.getElementById('interaction-overlay').getBoundingClientRect();
      return {
        x: r.left + (l.x + l.width * 0.3 + 1000) * window.State.zoom,
        y: r.top + (l.y + l.height * 0.3 + 1000) * window.State.zoom,
      };
    });
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => {
      const mc = window.State.layers[0]._maskCanvas;
      return mc.getContext('2d').getImageData(
        Math.floor(mc.width * 0.3), Math.floor(mc.height * 0.3), 1, 1).data[3];
    }), { timeout: 5000 }).toBe(0);

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !l.isSvg && l._originalCanvas && !l._maskCanvas && !l._dirty;
    }, null, { timeout: 30000 });

    const after = await page.evaluate(() => {
      const l = window.State.layers[0];
      const ctx = l._originalCanvas.getContext('2d');
      return {
        nw: l.naturalWidth, nh: l.naturalHeight,
        corner: ctx.getImageData(1, 1, 1, 1).data[0],
        mid: ctx.getImageData(Math.floor(l.naturalWidth / 2), Math.floor(l.naturalHeight / 2), 1, 1).data[0],
      };
    });
    // The layer kept its ink (a white corner would mean it was blanked) and
    // was cropped to the shape rather than left at full size.
    expect(after.corner).toBeLessThan(255);
    expect(after.mid).toBe(255);   // the SVG's own white circle
    expect(after.nw).toBeLessThan(sizes.nw);
    expect(after.nh).toBeLessThan(sizes.nh);
    // The crop is the shape: 500/900 of the authored width, 400/700 of the
    // height (natural size is the authored size at 600 DPI).
    expect(after.nw / sizes.nw).toBeCloseTo(0.55, 1);
    expect(after.nh / sizes.nh).toBeCloseTo(0.57, 1);
  });

  test('undo turns a flattened SVG back into a working vector layer', async ({ page }) => {
    await createProject(page, 'Flatten SVG Undo');
    await addSvg(page, SVG_INSET);

    await page.locator('#layer-buttons [data-action="flatten-layer"]').click();
    await page.waitForFunction(() => {
      const l = window.State.layers[0];
      return l && !l.isSvg && l._originalCanvas && !l._dirty;
    }, null, { timeout: 15000 });

    await page.keyboard.press('Control+z');
    await expect.poll(() => page.evaluate(() => {
      const l = window.State.layers[0];
      return l && l.isSvg && !!l._svgImage;
    }), { timeout: 10000 }).toBe(true);

    // The restored layer must actually draw again, not sit there empty.
    await expect.poll(() => page.evaluate(async () => {
      const { ImageProcessor } = await import('/src/app/image-processor.js');
      const l = window.State.layers[0];
      const canvas = await ImageProcessor.processLayer(l, { forExport: true });
      if (!canvas) return 0;
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 200) ink++;
      return ink;
    }), { timeout: 10000 }).toBeGreaterThan(50);

    const state = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { isSvg: l.isSvg, nw: l.naturalWidth, name: l.name };
    });
    expect(state.isSvg).toBe(true);
    // Geometry is back to the un-cropped layer.
    expect(state.nw).toBe(1250);

    // …and it survives a reopen, which means the vector source went back
    // into storage too (flatten had replaced it with a PNG).
    await page.reload();
    await page.locator('.project-entry', { hasText: 'Flatten SVG Undo' }).click();
    await page.click('#btn-open-project');
    await expect(page.locator('.layer-row')).toHaveCount(1);
    const reopened = await page.evaluate(() => {
      const l = window.State.layers[0];
      return { isSvg: l.isSvg, hasImage: !!l._svgImage, nw: l.naturalWidth };
    });
    expect(reopened).toEqual({ isSvg: true, hasImage: true, nw: 1250 });
  });
});
