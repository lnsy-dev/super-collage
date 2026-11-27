// @ts-check
/* ═══════════════════════════════════════════════════════════════════
   Difference mask + zoomed painting: the masked pair must not shift

   Regression coverage for the report:

     "If we create a difference mask between two layers and then zoom
      in and try to add to the mask with our mask tool, the underlying
      mask shifts position. Scrolling the canvas pops the mask back
      into position in certain circumstances."

   Two defects produced that behavior, both in the viewport-slice
   composites used while a brush stroke is active:

     1. _compositeLayerWithImageMask drew the slice-mode painted-mask
        composite (which already has the layer transform baked in for
        the slice rect) under the active layer transform — applying it
        twice and displacing the base by its own top-left offset within
        the viewport, on every stroke frame. No repaint is scheduled on
        pointerup, so the displaced frame persisted until a scroll or
        zoom rebuild ("scrolling pops the mask back into position").

     2. The slice caches reused buffers across an in-band zoom change
        (the old 0.7×..1.3× fidelity band). When the layer covers the
        viewport, the slice bounds equal the viewport clip rect, which
        does NOT scale with zoom — so the bounds key held while the
        baked geometry went stale, rendering the pair at the previous
        zoom ("the layers do not scale properly when I zoom in/out").

   The test zooms to Z1, paints a hole through the real pointer
   pipeline, zooms to Z2 = Z1/1.12 without scrolling (bounds stay
   frozen), paints again with the BASE selected (which does not bump
   the mask layer's revision), and requires the hole to sit exactly
   where it was painted at every step. The layout is self-calibrating:
   it asserts the clip rect is frozen and the layer covers it at both
   zooms, which is the configuration that used to trigger both bugs.
   ═══════════════════════════════════════════════════════════════════ */
import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer,
} from './helpers.js';

const Z1 = 1.12, Z2 = 1.0; // ratio 0.893 — inside the old reuse band

test.describe('Difference mask + zoomed painting stays in place', () => {
  test('painted holes stay where painted across in-band zoom and further strokes', async ({ page }) => {
    test.setTimeout(120000);
    await clearIndexedDB(page);
    await createProject(page, 'Diff Mask Zoom Paint Shift');
    // 1200×1200 natural so at zoom ≈1 the layer covers the viewport.
    await addImageFromBuffer(page, createSolidPngBuffer('#333333', 1200, 1200), { name: 'plate.png' });
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
    await page.waitForFunction(() =>
      window.State.layers.every(l => !l._dirty) && !window.State.renderPending
    , null, { timeout: 15000 });

    // ---- Layout: zoom to Z1 and scroll so the layer covers the viewport ----
    await page.evaluate((z) => {
      window.State.zoom = z;
      window.Renderer.resize();
      window.Renderer.schedule();
    }, Z1);
    await page.waitForFunction(() => !window.State.renderPending && !window.State.zoomDebounceTimer,
      null, { timeout: 15000 });
    await page.waitForTimeout(200);

    // Center the layer (doc 1650, 2550) in the viewport, then correct the
    // scroll so the layer bbox also covers the clip rect at Z2 (smaller
    // zoom → smaller bbox; the clip's right/bottom must stay inside it).
    await page.evaluate(() => {
      const scroll = document.getElementById('canvas-scroll');
      scroll.scrollLeft = Math.max(0, 1650 * window.State.zoom - scroll.clientWidth / 2);
      scroll.scrollTop = Math.max(0, 2550 * window.State.zoom - scroll.clientHeight / 2);
      window.Renderer.schedule();
    });
    await page.waitForFunction(() => !window.State.renderPending, null, { timeout: 15000 });
    await page.evaluate(([z2]) => {
      const scroll = document.getElementById('canvas-scroll');
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
      const canvas = document.getElementById('display-canvas');
      const cRect = canvas.getBoundingClientRect();
      const sRect = scroll.getBoundingClientRect();
      const offX = cRect.left - sRect.left + scroll.scrollLeft;
      const offY = cRect.top - sRect.top + scroll.scrollTop;
      const M = 8;
      // Deficits: how far the clip's right/bottom edges stick out past the
      // Z2 bbox (+20px safety). Shift the scroll left/up by that amount.
      const clipRight = scroll.scrollLeft - offX + scroll.clientWidth + M;
      const clipBottom = scroll.scrollTop - offY + scroll.clientHeight + M;
      const dRight = clipRight - (base.x + base.width) * z2 + 20;
      const dBottom = clipBottom - (base.y + base.height) * z2 + 20;
      if (dRight > 0) scroll.scrollLeft = Math.max(0, scroll.scrollLeft - dRight);
      if (dBottom > 0) scroll.scrollTop = Math.max(0, scroll.scrollTop - dBottom);
      window.Renderer.schedule();
    }, [Z2]);
    await page.waitForFunction(() => !window.State.renderPending, null, { timeout: 15000 });
    await page.waitForTimeout(200);

    // Precondition: the clip rect must be frozen across the zoom step and
    // the layer bbox must cover it at both zooms (the trigger configuration).
    const layout = await page.evaluate(([z1, z2]) => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
      const bbox = (z) => ({
        left: base.x * z, top: base.y * z,
        right: (base.x + base.width) * z, bottom: (base.y + base.height) * z,
      });
      const scroll = document.getElementById('canvas-scroll');
      const canvas = document.getElementById('display-canvas');
      const cRect = canvas.getBoundingClientRect();
      const sRect = scroll.getBoundingClientRect();
      const offX = cRect.left - sRect.left + scroll.scrollLeft;
      const offY = cRect.top - sRect.top + scroll.scrollTop;
      const M = 8;
      const clip = (z, docW, docH) => ({
        left: Math.max(0, Math.floor(scroll.scrollLeft - offX - M)),
        top: Math.max(0, Math.floor(scroll.scrollTop - offY - M)),
        right: Math.min(docW, Math.ceil(scroll.scrollLeft - offX + scroll.clientWidth + M)),
        bottom: Math.min(docH, Math.ceil(scroll.scrollTop - offY + scroll.clientHeight + M)),
      });
      const c1 = clip(z1, 3300 * z1, 5100 * z1);
      const c2 = clip(z2, 3300 * z2, 5100 * z2);
      const covers = (b, c) => b.left <= c.left && b.top <= c.top && b.right >= c.right && b.bottom >= c.bottom;
      return {
        frozenBounds: c1.left === c2.left && c1.top === c2.top &&
          c1.right === c2.right && c1.bottom === c2.bottom,
        coveredBoth: covers(bbox(z1), c1) && covers(bbox(z2), c2),
      };
    }, [Z1, Z2]);
    expect(layout.frozenBounds, 'clip rect frozen across the in-band zoom').toBe(true);
    expect(layout.coveredBoth, 'layer bbox covers the clip at both zooms').toBe(true);

    // ---- Choose dab points in the doc region visible at BOTH zooms ----
    const pts = await page.evaluate(([z1, z2]) => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
      const scroll = document.getElementById('canvas-scroll');
      const canvas = document.getElementById('display-canvas');
      const cRect = canvas.getBoundingClientRect();
      const sRect = scroll.getBoundingClientRect();
      const offX = cRect.left - sRect.left + scroll.scrollLeft;
      const offY = cRect.top - sRect.top + scroll.scrollTop;
      const M = 8;
      const win = (z) => ({
        x0: Math.max(0, scroll.scrollLeft - offX - M) / z,
        x1: (scroll.scrollLeft - offX + scroll.clientWidth + M) / z,
        y0: Math.max(0, scroll.scrollTop - offY - M) / z,
        y1: (scroll.scrollTop - offY + scroll.clientHeight + M) / z,
      });
      const w1 = win(z1), w2 = win(z2);
      const ix0 = Math.max(w1.x0, w2.x0), ix1 = Math.min(w1.x1, w2.x1);
      const iy0 = Math.max(w1.y0, w2.y0), iy1 = Math.min(w1.y1, w2.y1);
      // Keep points inside the base layer, away from its edges (the +20px
      // duplicate offset leaves a 20px border strip showing).
      const pad = 60;
      const cx = Math.min(ix1 - pad, Math.max(ix0 + pad, (ix0 + ix1) / 2));
      const cy = Math.min(iy1 - pad, Math.max(iy0 + pad, (iy0 + iy1) / 2));
      const clampToLayer = (p) => ({
        x: Math.min(base.x + base.width - pad, Math.max(base.x + pad, p.x)),
        y: Math.min(base.y + base.height - pad, Math.max(base.y + pad, p.y)),
      });
      return {
        dabA: clampToLayer({ x: cx - 120, y: cy - 40 }),
        dabB: clampToLayer({ x: cx + 120, y: cy + 40 }),
      };
    }, [Z1, Z2]);

    // ---- Helpers ----
    const selectLayer = async (id) => {
      await page.evaluate((lid) => {
        window.State.selectedId = lid;
        window.State.selectedIds = [lid];
        window.UI.refreshLayerList();
        window.UI.refreshProperties();
      }, id);
    };

    const settle = async () => {
      await page.waitForFunction(() => !window.State.renderPending && !window.State.zoomDebounceTimer,
        null, { timeout: 15000 });
      // The brush-stroke frame coalescing (32ms) + rAF can still have a
      // pending scheduled frame; wait for a draw COMPLETED after this point
      // (Renderer._lastDrawAt updates at the end of each draw).
      const t0 = await page.evaluate(() => performance.now());
      await page.waitForFunction((t0) => window.Renderer._lastDrawAt > t0, t0,
        { timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(120);
    };

    // Paint a single dab through the REAL pointer pipeline, keeping the
    // pointer down until a stroke-frame draw has completed so the
    // viewport-slice compositing path (brushDepth > 0) is exercised.
    const dab = async (docPt) => {
      await page.evaluate(() => { window.UI.setTool('mask-draw'); });
      await page.waitForFunction(() => window.State.tool === 'mask-draw', null, { timeout: 5000 });
      const pt = await page.evaluate(([dx, dy]) => {
        const rect = document.getElementById('interaction-overlay').getBoundingClientRect();
        return {
          x: rect.left + (dx + 1000) * window.State.zoom,
          y: rect.top + (dy + 1000) * window.State.zoom,
        };
      }, [docPt.x, docPt.y]);
      await page.mouse.move(pt.x, pt.y);
      // Capture the draw timestamp BEFORE the press: the stroke's first
      // frame is coalesced by MASK_STROKE_FRAME_MS (32ms), so it always
      // completes after t0 — waiting for it guarantees a frame rendered
      // while the stroke is active (brushDepth > 0, the slice-cache path).
      const t0 = await page.evaluate(() => performance.now());
      await page.mouse.down();
      await page.waitForFunction((t0) =>
        window.Renderer._brushDepth > 0 && window.Renderer._lastDrawAt > t0, t0,
      { timeout: 5000 });
      await page.mouse.up();
      await settle();
    };

    // Ink-span scan along the canvas row y=docY over doc x range — returns
    // the rendered ink span in DOC coordinates (null when no ink found).
    const inkSpanAt = async (docY, docX0, docX1) => page.evaluate(([dy, dx0, dx1]) => {
      const canvas = document.getElementById('display-canvas');
      const ds = window.Renderer._displayScale;
      const z = window.State.zoom;
      const y = Math.round(dy * z * ds);
      const bx0 = Math.round(dx0 * z * ds);
      const bx1 = Math.round(dx1 * z * ds);
      const ctx = canvas.getContext('2d');
      const isDark = (r, g, b) => r < 120 && g < 120 && b < 120;
      let first = null, last = null;
      for (let bx = bx0; bx <= bx1; bx++) {
        const d = ctx.getImageData(Math.min(canvas.width - 1, Math.max(0, bx)),
          Math.min(canvas.height - 1, Math.max(0, y)), 1, 1).data;
        if (isDark(d[0], d[1], d[2])) {
          if (first === null) first = bx;
          last = bx;
        }
      }
      const toDoc = (bx) => bx / (z * ds);
      return first === null ? null : { x0: toDoc(first), x1: toDoc(last), center: toDoc((first + last) / 2) };
    }, [docY, docX0, docX1]);

    const assertHoleCentered = async (label, docPt) => {
      const span = await inkSpanAt(docPt.y, docPt.x - 80, docPt.x + 80);
      expect(span, `${label}: hole renders through the mask`).toBeTruthy();
      expect(Math.abs(span.center - docPt.x), `${label}: hole centered where painted` +
        ` (observed center ${span.center.toFixed(1)}, expected ${docPt.x.toFixed(1)})`).toBeLessThan(12);
      return span;
    };

    const maskLayerId = await page.evaluate(() => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
      return base.imageMaskIds[0];
    });
    const baseLayerId = await page.evaluate(() => {
      return window.State.layers.find(l => (l.imageMaskIds || []).length).id;
    });

    // ---- Phase 1: paint hole A (mask layer selected) at Z1 ----
    await selectLayer(maskLayerId);
    await dab(pts.dabA);
    await assertHoleCentered('at Z1', pts.dabA);

    // ---- Phase 2: in-band zoom to Z2, NO scroll change ----
    await page.evaluate((z) => {
      window.State.zoom = z;
      window.Renderer.resize();
      window.Renderer.schedule();
    }, Z2);
    await settle();
    // The pair must re-render at Z2 geometry: the hole sits where painted,
    // not where the previous zoom's geometry would put it (stale reuse).
    await assertHoleCentered('after in-band zoom to Z2', pts.dabA);

    // ---- Phase 3: paint dab B with the BASE selected at Z2 ----
    // Painting the base does not bump the mask layer's revision, so the
    // per-stroke mask-alpha slice must not be reused from its Z1 build.
    await selectLayer(baseLayerId);
    await dab(pts.dabB);
    await assertHoleCentered('after painting on the base at Z2', pts.dabA);

    // ---- Phase 4: scroll — the reported "pop back" must not be needed ----
    await page.evaluate(() => {
      const scroll = document.getElementById('canvas-scroll');
      scroll.scrollTop += 40;
      window.Renderer.schedule();
    });
    await settle();
    await assertHoleCentered('after scrolling', pts.dabA);

    // Layer geometry untouched by any of it.
    const rect = await page.evaluate((id) => {
      const l = window.State.layers.find(x => x.id === id);
      return { x: l.x, y: l.y, width: l.width, height: l.height };
    }, baseLayerId);
    expect(rect.width).toBe(1200);
  });
});
