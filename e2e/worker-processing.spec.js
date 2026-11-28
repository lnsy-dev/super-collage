// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Process-worker offload: responsiveness + output parity

   Regression coverage for the report:

     "There is a significant gap of time between when we click on a
      canvas, and when we lift up the mouse where the application is
      blocked. Drawing large amounts of pixels (for instance, drawing
      a large rectangle in a 8.5 x 11" canvas) is very slow."

   What changed: the layer pixel pipeline moved into a module worker
   (pixel-pipeline.js runs in both environments), shape commits persist
   in the background, and mask-stroke undo snapshots copy their pixels
   off the pointerdown critical path.

   These tests pin:
     1. committing a full-page rectangle on a letter canvas at zoom 1
        repaints fast (the first draw after mouseup no longer runs the
        megapixel pipeline inline) and the shape still renders + persists;
     2. worker and main-thread pipeline outputs are BIT-IDENTICAL for
        the same source and params (solid ink, dither halftone, gradient
        and pattern color modes, two-tone shapes);
     3. a mask stroke's undo restores the pre-stroke mask through the
        async snapshot copy.
   ═══════════════════════════════════════════════════════════════════ */
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

const PAGE_W = 3300, PAGE_H = 5100; // half-letter, matches createProject default

/** Wait until the renderer has no pending work. */
async function settle(page) {
  await page.waitForFunction(
    () => !State.renderPending && !State.zoomDebounceTimer,
    null, { timeout: 30000 },
  ).catch(() => {});
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction(t0 => window.Renderer._lastDrawAt > t0, t0,
    { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(120);
}

test.describe('Process worker offload', () => {
  test('full-page rectangle commit repaints fast and the shape renders + persists', async ({ page }) => {
    test.setTimeout(60000);
    await createProject(page, 'Worker Big Rect');
    // Zoom to 1:1 first so the shape processes at full page resolution —
    // the configuration where the old inline pipeline stalled longest.
    await page.evaluate(() => {
      State.zoom = 1;
      Renderer.resize();
      Renderer.schedule();
    });
    await settle(page);

    // Commit a full-page rectangle through the REAL commit path
    // (LayerManager.addShape — the same function the pointer pipeline
    // calls on mouseup): a 2640×4080 doc-px shape whose bitmap is ~10.8
    // megapixels, the reported "large rectangle on a letter canvas".
    const commit = await page.evaluate(async ([pw, ph]) => {
      UI.setTool('shape-rect');
      const shapeProps = {
        shapeHasFill: State.shapeMode !== 'outline',
        shapeHasStroke: false,
        shapeStrokeWidth: Math.max(1, State.shapeStrokeWidth / State.zoom),
        shapeSides: State.shapeSides,
        shapeIsStar: State.shapeIsStar,
        shapeStarRatio: State.shapeStarRatio,
      };
      const t0 = performance.now();
      await LayerManager.addShape(shapeProps, pw * 0.1, ph * 0.1, pw * 0.8, ph * 0.8);
      return { duration: performance.now() - t0, tEnd: performance.now() };
    }, [PAGE_W, PAGE_H]);
    console.log('[commit] addShape duration:', Math.round(commit.duration), 'ms');
    expect(commit.duration, 'addShape returns without awaiting the encodes')
      .toBeLessThan(250);

    // The main thread must stay responsive right after the commit: sample
    // timer overshoot for ~1.5s while the worker processes the bitmap.
    // (The old inline path blocked the thread on the encodes + megapixel
    // pipeline for hundreds of ms at a stretch.)
    const maxOvershoot = await page.evaluate(async () => {
      let max = 0;
      const deadline = performance.now() + 1500;
      while (performance.now() < deadline) {
        const t0 = performance.now();
        await new Promise(r => setTimeout(r, 30));
        max = Math.max(max, performance.now() - t0 - 30);
      }
      return Math.round(max);
    });
    console.log('[commit] max timer overshoot:', maxOvershoot, 'ms');
    expect(maxOvershoot, 'main thread stays responsive after the commit')
      .toBeLessThan(150);

    // The first completed draw after the commit must land quickly.
    // A completed draw after the commit (the layer's first render attempt).
    await page.evaluate(async (tEnd) => {
      const t0 = performance.now();
      while (Renderer._lastDrawAt <= tEnd) {
        if (performance.now() - t0 > 5000) throw new Error('no draw after commit');
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 4)));
      }
    }, commit.tEnd);

    // The shape layer exists immediately and renders once processed.
    await page.waitForFunction(() => {
      const l = State.layers[0];
      return State.layers.length === 1 && l.isShape && !l._dirty && !!l._processedCanvas;
    }, null, { timeout: 30000 });
    await settle(page);

    // Ink visible inside the shape (processed layer draws black ink).
    // The canvas only holds the viewport slice at zoom 1, so sample a
    // point that is inside BOTH the shape and the visible viewport.
    const ink = await page.evaluate(() => {
      const l = State.layers[0];
      const canvas = document.getElementById('display-canvas');
      // The shape spans doc (330,510)..(2970,4590); the viewport at zoom 1
      // shows doc [0..~866]×[0..~591] — sample inside both.
      const bx = Math.round(600 * State.zoom * Renderer._displayScale);
      const by = Math.round(550 * State.zoom * Renderer._displayScale);
      const d = canvas.getContext('2d').getImageData(
        Math.max(0, Math.min(canvas.width - 1, bx)),
        Math.max(0, Math.min(canvas.height - 1, by)), 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(ink[0], 'shape ink renders dark at its center').toBeLessThan(120);

    // Background persistence lands: the record + blobs reach IndexedDB.
    await page.waitForFunction(async () => {
      const { DB } = await import('/src/app/db.js');
      const rec = await DB.get('layers', State.layers[0].id);
      if (!rec) return false;
      const blob = await DB.get('imageBlobs', State.layers[0].id);
      const maskBlob = await DB.get('maskBlobs', State.layers[0].id);
      return !!blob && !!maskBlob;
    }, null, { timeout: 30000 }).catch(() => {});
    const persisted = await page.evaluate(async () => {
      const { DB } = await import('/src/app/db.js');
      const rec = await DB.get('layers', State.layers[0].id);
      const blob = await DB.get('imageBlobs', State.layers[0].id);
      const maskBlob = await DB.get('maskBlobs', State.layers[0].id);
      return { rec: !!rec, blob: !!blob, maskBlob: !!maskBlob };
    });
    expect(persisted.rec, 'layer record persisted').toBe(true);
    expect(persisted.blob, 'shape bitmap blob persisted').toBe(true);
    expect(persisted.maskBlob, 'mask blob persisted').toBe(true);

    // The worker path is genuinely used (not silently all-fallback).
    const stats = await page.evaluate(async () => {
      const { processWorkerClient } = await import('/src/app/process-worker-client.js');
      return { ...processWorkerClient.stats, available: processWorkerClient.available };
    });
    expect(stats.available, 'process worker available').toBe(true);
    expect(stats.resolved, 'worker jobs resolved').toBeGreaterThan(0);
  });

  test('worker and main-thread pipeline outputs are bit-identical', async ({ page }) => {
    test.setTimeout(60000);
    await clearIndexedDB(page);
    await page.goto('/');
    await page.waitForFunction(() => window.__appReady === true, null, { timeout: 20000 });

    const result = await page.evaluate(async () => {
      const { composeProcessedCanvas } = await import('/src/app/pixel-pipeline.js');
      const { processWorkerClient } = await import('/src/app/process-worker-client.js');
      const { renderShapeLayerBitmap, isTwoToneShape } = await import('/src/app/shape-bitmap.js');

      // Synthetic 96×96 source: a diagonal ramp of gray tones + color noise,
      // so every threshold branch (gray<128, dither cells, alpha steps) is hit.
      const makeSource = () => {
        const c = new OffscreenCanvas(96, 96);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const img = ctx.createImageData(96, 96);
        for (let y = 0; y < 96; y++) {
          for (let x = 0; x < 96; x++) {
            const i = (y * 96 + x) * 4;
            const v = Math.round((x + y) / 2 * 2.6);
            img.data[i] = v; img.data[i + 1] = (v * 3) % 256; img.data[i + 2] = (v * 7) % 256;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        return c;
      };
      const readAll = (c) => {
        const t = new OffscreenCanvas(c.width, c.height);
        t.getContext('2d').drawImage(c, 0, 0);
        return [...t.getContext('2d').getImageData(0, 0, c.width, c.height).data];
      };

      const cases = [
        { name: 'solid ink', p: { brightness: 10, contrast: -5, invert: false, halftoneType: 'none',
          color: '#0078bf', colorMode: 'solid', colorOverride: false, halftoneSize: 8,
          naturalWidth: 96, naturalHeight: 96, width: 96, height: 96, x: 0, y: 0,
          targetW: 96, targetH: 96, renderRatio: 1, mode: 'generic' } },
        { name: 'bayer dither', p: { brightness: 0, contrast: 0, invert: true, halftoneType: 'dither',
          color: '#f65058', colorMode: 'solid', colorOverride: false, halftoneSize: 6,
          naturalWidth: 96, naturalHeight: 96, width: 96, height: 96, x: 0, y: 0,
          targetW: 64, targetH: 64, renderRatio: 64 / 96, mode: 'generic' } },
        { name: 'grayscale halftone + gradient', p: { brightness: 0, contrast: 0, invert: false, halftoneType: 'grayscale',
          color: '#0078bf', colorMode: 'gradient', colorOverride: false, halftoneSize: 8,
          gradient: { type: 'linear', angle: 30, stops: [{ position: 0, color: '#ff48b0' }, { position: 1, color: '#ffe800' }] },
          gradientBounds: null,
          naturalWidth: 96, naturalHeight: 96, width: 96, height: 96, x: 0, y: 0,
          targetW: 96, targetH: 96, renderRatio: 1, mode: 'generic' } },
        { name: 'pattern color mode', p: { brightness: 0, contrast: 0, invert: false, halftoneType: 'none',
          color: '#010101', colorMode: 'pattern', colorOverride: false, halftoneSize: 8,
          pattern: { type: 'stripes', color1: '#0078bf', color2: '#ffffff', size: 12, angle: 15 },
          naturalWidth: 96, naturalHeight: 96, width: 96, height: 96, x: 0, y: 0,
          targetW: 80, targetH: 80, renderRatio: 80 / 96, mode: 'generic' } },
      ];

      const failures = [];
      for (const { name, p } of cases) {
        const mainSrc = makeSource();
        const mainBitmap = await createImageBitmap(mainSrc);
        const mainOut = composeProcessedCanvas([{ bitmap: mainBitmap, color: p.color }], p);
        const workerBitmap = await createImageBitmap(makeSource());
        const workerOut = await processWorkerClient.process(
          [{ bitmap: workerBitmap, color: p.color }], JSON.parse(JSON.stringify(p)));
        const a = readAll(mainOut);
        const b = readAll(workerOut);
        if (a.length !== b.length) { failures.push(`${name}: size mismatch`); continue; }
        let diffs = 0, firstDiff = -1;
        for (let i = 0; i < a.length; i++) {
          if (Math.abs(a[i] - b[i]) > 0) { diffs++; if (firstDiff < 0) firstDiff = i; }
        }
        if (diffs > 0) failures.push(`${name}: ${diffs} byte diffs, first at ${firstDiff}`);
      }

      // Two-tone shape through the worker: fill + stroke channels.
      const shapeLayer = {
        isShape: true, shapeType: 'shape-rect', shapeHasFill: true, shapeHasStroke: true,
        shapeStrokeWidth: 12, shapeFillColor: '#0078bf', shapeStrokeColor: '#f65058',
        shapeSides: 4, shapeIsStar: false, shapeStarRatio: 0.5,
        naturalWidth: 80, naturalHeight: 60, width: 80, height: 60,
        brightness: 0, contrast: 0, invert: false, halftoneType: 'none', halftoneSize: 8,
        colorMode: 'solid',
      };
      const pShape = { brightness: 0, contrast: 0, invert: false, halftoneType: 'none', halftoneSize: 8,
        naturalWidth: 80, naturalHeight: 60, width: 80, height: 60, x: 0, y: 0,
        targetW: 80, targetH: 60, renderRatio: 1, mode: 'twoToneShape' };
      const mainFill = await createImageBitmap(renderShapeLayerBitmap(shapeLayer, 'fill'));
      const mainStroke = await createImageBitmap(renderShapeLayerBitmap(shapeLayer, 'stroke'));
      const mainShape = composeProcessedCanvas([
        { bitmap: mainFill, color: shapeLayer.shapeFillColor },
        { bitmap: mainStroke, color: shapeLayer.shapeStrokeColor },
      ], pShape);
      const wFill = await createImageBitmap(renderShapeLayerBitmap(shapeLayer, 'fill'));
      const wStroke = await createImageBitmap(renderShapeLayerBitmap(shapeLayer, 'stroke'));
      const workerShape = await processWorkerClient.process([
        { bitmap: wFill, color: shapeLayer.shapeFillColor },
        { bitmap: wStroke, color: shapeLayer.shapeStrokeColor },
      ], JSON.parse(JSON.stringify(pShape)));
      const sa = readAll(mainShape);
      const sb = readAll(workerShape);
      let shapeDiffs = 0;
      for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
        if (sa[i] !== sb[i]) shapeDiffs++;
      }
      if (sa.length !== sb.length) failures.push('two-tone shape: size mismatch');
      else if (shapeDiffs > 0) failures.push(`two-tone shape: ${shapeDiffs} byte diffs`);

      return { failures, available: processWorkerClient.available, resolved: processWorkerClient.stats.resolved };
    });

    expect(result.available, 'process worker available').toBe(true);
    expect(result.resolved, 'worker jobs resolved for parity cases').toBeGreaterThan(4);
    expect(result.failures, 'worker output matches main-thread output bit-for-bit')
      .toEqual([]);
  });

  test('mask stroke undo restores the pre-stroke mask via the async snapshot', async ({ page }) => {
    test.setTimeout(60000);
    await createProject(page, 'Worker Mask Undo');
    await addImageFromBuffer(page, createSolidPngBuffer('#cc0000', 1200, 1200), { name: 'plate.png' });
    // Duplicate + difference mask through the real pipeline.
    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
    await page.locator('.layer-row').nth(0).click();
    await page.locator('.layer-row').nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('#btn-create-difference-mask')).toBeVisible();
    await page.click('#btn-create-difference-mask');
    await page.waitForFunction(() => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
      return !!base && !window.State.renderPending;
    }, null, { timeout: 15000 });

    const maskId = await page.evaluate(() => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
      return base.imageMaskIds[0];
    });
    await page.evaluate((id) => {
      window.State.selectedId = id;
      window.State.selectedIds = [id];
      window.UI.refreshLayerList();
      window.UI.setTool('mask-draw');
    }, maskId);

    // Paint a stroke through the real pointer pipeline.
    const pt = await page.evaluate(() => {
      const l = window.State.layers.find(x => (x.imageMaskIds || []).length);
      const rect = document.getElementById('interaction-overlay').getBoundingClientRect();
      return { x: rect.left + (l.x + l.width * 0.5 + 1000) * window.State.zoom,
               y: rect.top + (l.y + l.height * 0.5 + 1000) * window.State.zoom };
    });
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 30, pt.y + 20, { steps: 3 });
    await page.mouse.up();

    // The stroke hid mask ink at its path (painted-mask hole punched).
    await expect.poll(async () => page.evaluate((id) => {
      const mask = window.State.layers.find(l => l.id === id);
      const mc = mask._maskCanvas;
      const d = mc.getContext('2d').getImageData(Math.round(mc.width * 0.51),
        Math.round(mc.height * 0.51), 1, 1).data;
      return d[3];
    }, maskId), { timeout: 10000 }).toBe(0);

    // Undo through the real pipeline — the snapshot copy may still be in
    // flight; applySnapshot awaits it.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => page.evaluate((id) => {
      const mask = window.State.layers.find(l => l.id === id);
      const mc = mask._maskCanvas;
      const d = mc.getContext('2d').getImageData(Math.round(mc.width * 0.51),
        Math.round(mc.height * 0.51), 1, 1).data;
      return d[3];
    }, maskId), { timeout: 15000 }).toBe(255);
  });
});
