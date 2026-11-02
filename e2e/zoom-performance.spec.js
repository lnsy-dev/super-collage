import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LARGE_IMAGE = path.join(__dirname, 'fixtures', 'large-test-image.png');

// 40 MP envelope; a hair over it is per-axis rounding at the capped edge,
// so the bound carries a small rounding slack.
const MAX_BACKING_PIXELS = 40 * 1024 * 1024 + 65536;
const MAX_BACKING_EDGE = 8192;

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/**
 * Set zoom via window globals and let the debounced quality repaint land, so
 * assertions observe the settled render state (mirrors zoom-render.spec.js,
 * which also re-centers the scroll so the layer stays inside the viewport —
 * control-zoom does not auto-center in the app, and off-screen layers are
 * legitimately culled).
 */
async function setZoom(page, zoom) {
  await page.evaluate((z) => {
    State.zoom = z;
    Renderer.resize();
    UI.refreshZoom();
    const scroll = document.getElementById('canvas-scroll');
    const canvas = document.getElementById('display-canvas');
    if (scroll && canvas) {
      scroll.scrollLeft = Math.max(0, (canvas.offsetLeft + canvas.offsetWidth / 2) - scroll.clientWidth / 2);
      scroll.scrollTop  = Math.max(0, (canvas.offsetTop  + canvas.offsetHeight / 2) - scroll.clientHeight / 2);
    }
  }, zoom);
  // Debounce (150ms) + rAF render (+ margin)
  await page.waitForTimeout(400);
}

/** Adds a second layer that is a throwaway duplicate used as an image mask. */
async function addImageMaskLayer(page) {
  await page.evaluate(() => {
    const base = State.layers[0];
    const maskLayer = { ...base, id: 'e2e-mask-layer', imageMaskIds: [], isMaskFor: base.id };
    maskLayer.x = (base.x ?? 0) + 50;
    State.layers.push(maskLayer);
    base.imageMaskIds = [maskLayer.id];
    base._dirty = true;
    Renderer.schedule();
  });
  await page.waitForTimeout(400);
}

test.describe('Zoom Performance', () => {
  test('document backing stores are capped and stay flat across zoom sweep', async ({ page }) => {
    await createProject(page, 'Backing Cap Test');

    // Sweep the full zoom range; record the display + overlay backing dims.
    const trace = [];
    for (const zoom of [0.25, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) {
      await setZoom(page, zoom);
      trace.push(await page.evaluate(() => ({
        zoom: State.zoom,
        displayW: document.getElementById('display-canvas').width,
        displayH: document.getElementById('display-canvas').height,
        overlayW: document.getElementById('interaction-overlay').width,
        overlayH: document.getElementById('interaction-overlay').height,
        displayScale: Renderer._displayScale,
      })));
    }

    // Hard cap: no backing store ever exceeds the renderer's envelope.
    for (const step of trace) {
      expect(step.displayW * step.displayH, `display backing pixels at zoom ${step.zoom}`).toBeLessThanOrEqual(MAX_BACKING_PIXELS);
      expect(step.overlayW * step.overlayH, `overlay backing pixels at zoom ${step.zoom}`).toBeLessThanOrEqual(MAX_BACKING_PIXELS);
      expect(step.displayW).toBeLessThanOrEqual(MAX_BACKING_EDGE);
      expect(step.overlayH).toBeLessThanOrEqual(MAX_BACKING_EDGE);
    }

    // Once a zoom step crosses the cap, backing-store dimensions must freeze:
    // capped steps record identical dims, so zooming stops reallocating.
    const capped = trace.filter(s => s.displayScale < 1);
    expect(capped.length, 'sweep includes capped steps at high zoom').toBeGreaterThanOrEqual(2);
    expect(new Set(capped.map(s => s.displayW)).size, 'display width flat across capped steps').toBe(1);
    expect(new Set(capped.map(s => s.displayH)).size, 'display height flat across capped steps').toBe(1);

    // At low zoom nothing is capped: the backing store is still 1:1 with CSS.
    await setZoom(page, 0.25);
    const low = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      return { backingW: c.width, backingH: c.height, scale: Renderer._displayScale };
    });
    expect(low.scale).toBe(1);
    expect(low.backingW).toBe(Math.round(3300 * 0.25)); // half-letter page width
    expect(low.backingH).toBe(Math.round(5100 * 0.25)); // half-letter page height
  });

  test('image-mask composite is cached across redraws at a fixed zoom', async ({ page }) => {
    await createProject(page, 'Mask Cache Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);
    await addImageMaskLayer(page);

    await setZoom(page, 0.75);
    const before = await page.evaluate(() => ({
      ref: State.layers[0]._imageMaskComposite?._zoomRef ?? null,
      builds: Renderer._stats.imageMaskBuilds,
    }));
    expect(before.ref).not.toBeNull();
    expect(before.builds).toBeGreaterThan(0);

    // Force several renders at the SAME zoom (scroll-driven repaints in the
    // real app): the composite must be reused, not rebuilt every frame.
    // Keep a page-side reference: Playwright serializes evaluate() results,
    // so object identity must be checked inside the page.
    await page.evaluate(() => {
      window.__e2eMaskCache = State.layers[0]._imageMaskComposite;
    });
    for (let i = 0; i < 4; i++) {
      await page.evaluate((n) => {
        const scroll = document.getElementById('canvas-scroll');
        scroll.scrollTop = n * 10;
        Renderer.schedule();
      }, i);
      await page.waitForTimeout(120);
    }
    // Re-center so the layer is in view again before the content check.
    await page.evaluate(() => {
      const scroll = document.getElementById('canvas-scroll');
      const canvas = document.getElementById('display-canvas');
      scroll.scrollLeft = Math.max(0, (canvas.offsetLeft + canvas.offsetWidth / 2) - scroll.clientWidth / 2);
      scroll.scrollTop  = Math.max(0, (canvas.offsetTop  + canvas.offsetHeight / 2) - scroll.clientHeight / 2);
      Renderer.schedule();
    });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      sameObject: State.layers[0]._imageMaskComposite === window.__e2eMaskCache,
      builds: Renderer._stats.imageMaskBuilds,
    }));
    expect(after.sameObject, 'composite buffer reused across redraws').toBe(true);
    expect(after.builds, 'zero rebuilds across redraws').toBe(before.builds);

    // Content is still drawn (cache reuse path produces visible output):
    // scan a grid of samples across the backing store, like
    // canvasHasContent() in zoom-render.spec.js.
    await expect.poll(async () => page.evaluate(() => {
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
    })).toBe(true);
  });

  test('painted-mask composite is cached across redraws and zoom steps', async ({ page }) => {
    await createProject(page, 'Painted Mask Cache Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);

    // Give the layer an opaque painted mask (as mask-engine would create).
    await page.evaluate(() => {
      const l = State.layers[0];
      l._maskCanvas = new OffscreenCanvas(l.naturalWidth, l.naturalHeight);
      l._maskCanvas.getContext('2d').fillStyle = '#fff';
      l._maskCanvas.getContext('2d').fillRect(0, 0, l.naturalWidth, l.naturalHeight);
      l._maskRev = 1;
      Renderer.schedule();
    });
    await page.waitForTimeout(400);

    await setZoom(page, 0.75);
    const builds = await page.evaluate(() => Renderer._stats.paintedMaskBuilds);
    await page.evaluate(() => { window.__e2ePMCache = State.layers[0]._maskComposite; });

    // Multiple redraws at the same zoom + zoom round-trips in between.
    for (const z of [0.75, 1.25, 0.75]) {
      await page.evaluate((zz) => { State.zoom = zz; Renderer.resize(); }, z);
      await page.waitForTimeout(300);
    }
    const after = await page.evaluate(() => ({
      sameObject: State.layers[0]._maskComposite === window.__e2ePMCache,
      builds: Renderer._stats.paintedMaskBuilds,
    }));
    expect(after.sameObject, 'zoom-invariant composite reused').toBe(true);
    expect(after.builds, 'no rebuilds across zoom-stable redrawing').toBe(builds);
  });

  test('rapid zoom bursts coalesce backing-store reallocation to the settle only', async ({ page }) => {
    await createProject(page, 'Zoom Realloc Coalesce');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);

    await page.evaluate(() => { Renderer._stats.backingReallocs = 0; });
    // Hammer 10 zoom steps with no settle time in between: each step used
    // to reallocate fresh megapixel-class backing stores (the reported
    // system-wide crash); now only the settled final step reallocates.
    for (let i = 0; i < 10; i++) {
      await page.evaluate((n) => {
        State.zoom = Math.min(2, 0.25 + n * 0.2);
        Renderer.resize();
        UI.refreshZoom();
      }, i);
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(600); // let the settle land
    const { reallocs, zoom, backingPixels } = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      return {
        reallocs: Renderer._stats.backingReallocs,
        zoom: State.zoom,
        backingPixels: c.width * c.height,
      };
    });
    expect(reallocs, 'zoom bursts reallocate once at the settle, not per step').toBeLessThanOrEqual(2);
    expect(reallocs, 'the settled step did reallocate for full quality').toBeGreaterThanOrEqual(1);
    expect(zoom).toBeGreaterThan(1.5);
    expect(backingPixels, 'capped backing envelope respected')
      .toBeLessThanOrEqual(40 * 1024 * 1024 + 65536);
  });

  test('rapid multi-step zooming coalesces into preview blits', async ({ page }) => {
    await createProject(page, 'Coalesce Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);

    await page.evaluate(() => { Renderer._stats.previewBlits = 0; });

    // Start from 1:1 so the sweep reaches high zoom within a few steps, and
    // keep the layer in the viewport for the final content check.
    await setZoom(page, 1);
    await page.evaluate(() => { Renderer._stats.previewBlits = 0; });

    // Hammer zoom steps in quick succession and force the "a repaint just
    // finished" condition before each step — on a slow/CPU-throttled test box
    // a real <100ms click cadence is not reproducible, but the branch it
    // exercises is exactly what a fast zoom-with-preview session hits. The
    // final settle repaint afterwards proves quality is restored.
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => {
        Renderer._lastFullPaintAt = performance.now();
        State.zoom = Math.min(2, State.zoom * 1.25);
        Renderer.resize();
        UI.refreshZoom();
      });
      await page.waitForTimeout(25);
    }
    // Re-center so the layer is on screen for the content check, and let the
    // settled quality repaint land.
    await page.evaluate(() => {
      const scroll = document.getElementById('canvas-scroll');
      const canvas = document.getElementById('display-canvas');
      scroll.scrollLeft = Math.max(0, (canvas.offsetLeft + canvas.offsetWidth / 2) - scroll.clientWidth / 2);
      scroll.scrollTop  = Math.max(0, (canvas.offsetTop  + canvas.offsetHeight / 2) - scroll.clientHeight / 2);
      Renderer.schedule();
    });
    await page.waitForTimeout(500);

    const { stats, zoom, hasInk } = await page.evaluate(() => {
      const c = document.getElementById('display-canvas');
      const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return {
        stats: { previewBlits: Renderer._stats.previewBlits },
        zoom: State.zoom,
        hasInk: d[3] > 0 && (d[0] < 250 || d[1] < 250 || d[2] < 250),
      };
    });
    expect(stats.previewBlits, 'zoom steps while a paint was in flight served previews').toBeGreaterThanOrEqual(1);
    expect(zoom, 'zoom level advanced through the rapid sweep').toBeGreaterThan(1.5);
    expect(hasInk, 'canvas still shows ink after the rapid sweep').toBe(true);
  });

  test('deep-zoom full draw of a large masked composite stays bounded', async ({ page }) => {
    await createProject(page, 'Deep Zoom Draw Test');
    await page.setInputFiles('#file-input', LARGE_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await page.waitForTimeout(500);
    await addImageMaskLayer(page);

    await page.evaluate(() => { State.zoom = 2; Renderer.resize(); UI.refreshZoom(); });
    await page.waitForTimeout(400);

    // Measure consecutive full draws at 2x. Each must be well under the old
    // megapixel-repaint floor; the capped backing store is the guarantee.
    const times = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        await Renderer.draw();
        out.push(Math.round(performance.now() - t0));
      }
      return {
        out,
        backing: document.getElementById('display-canvas').width *
                 document.getElementById('display-canvas').height,
      };
    });
    expect(times.backing, 'backing capped to renderer envelope').toBeLessThanOrEqual(MAX_BACKING_PIXELS);
    expect(times.out[0], 'first 2x draw (<3s even on software raster)').toBeLessThan(3000);
    // With warm caches every subsequent draw is nothing but scaled blits.
    const warm = [...times.out.slice(1)].sort((a, b) => a - b);
    expect(warm[Math.floor(warm.length / 2)], 'warm 2x redraw').toBeLessThan(1200);
  });
});
