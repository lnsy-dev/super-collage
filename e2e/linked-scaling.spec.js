import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/* ═══════════════════════════════════════════════════════════════════
   Linked-layer scaling
   ═══════════════════════════════════════════════════════════════════

   Linked layers must transform together: scaling one member of a link
   group — via a handle drag or the W/H property inputs — must scale
   every other member by the same factor while keeping the group's
   relative arrangement. These tests cover:

     - corner-handle drags (uniform scale about the fixed corner)
     - edge-handle drags (single-axis scale)
     - W/H property inputs (scale about each layer's own center)
     - link chains (A–B–C: scaling A must reach C)
     - unlinked bystanders (must NOT be scaled)
     - locked linked siblings (must NOT be scaled)
     - image-mask groups (base + mask + diff must scale as one unit)
     - group rotation via the rotate handle
     - undo of group scaling
     - persistence of the scaled geometry and of the links themselves
   ═══════════════════════════════════════════════════════════════════ */

/* ── helpers ─────────────────────────────────────────────────────── */

// { name: { x, y, width, height, rotation } } for every layer on the page.
const geom = (page) => page.evaluate(() =>
  Object.fromEntries(window.State.layers.map(l => [l.name, {
    x: l.x, y: l.y, width: l.width, height: l.height, rotation: l.rotation,
  }]))
);

async function setZoom(page, zoom) {
  await page.evaluate(z => {
    window.State.zoom = z;
    window.Renderer.resize();
    window.Renderer.schedule();
  }, zoom);
  await page.waitForTimeout(100);
}

async function selectLayer(page, name) {
  await page.evaluate(n => {
    const l = window.State.layers.find(l => l.name === n);
    if (!l) throw new Error('no layer named ' + n);
    window.State.selectedId = l.id;
    window.State.selectedIds = [l.id];
    window.UI.refreshLayerList();
    window.UI.refreshProperties();
  }, name);
  // Let pending rAF renders flush so a late refreshProperties() can't reset
  // a property field between fill and commit.
  await page.waitForTimeout(150);
}

// Link layers by name through the production linkLayers helper.
async function linkLayersByName(page, names) {
  await page.evaluate(async names => {
    const { linkLayers } = await import('/src/app/layer-link-utils.js');
    const ls = names.map(n => window.State.layers.find(l => l.name === n));
    linkLayers(ls[0], ls[1]);
    for (const l of ls) await window.DB.saveLayer(l);
    window.UI.refreshLayerList();
  }, names);
}

async function setProp(page, prop, value) {
  const field = { w: 'width', h: 'height', x: 'x', y: 'y', rot: 'rotation' }[prop] || prop;
  const input = page.locator(`#prop-${prop}`);
  // A pending re-render can repopulate the field after fill(), so verify the
  // value stuck before committing — and verify the layer actually changed
  // afterwards, retrying on the rare race.
  for (let attempt = 0; attempt < 3; attempt++) {
    await input.fill(String(value));
    await expect(input).toHaveValue(String(value));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    const applied = await page.evaluate(([f, v]) => {
      const l = window.State.layers.find(l => l.id === window.State.selectedId);
      return l ? l[f] === v : false;
    }, [field, value]);
    if (applied) return;
  }
  throw new Error(`setProp(${prop}, ${value}) never committed`);
}

// Dispatch a full pointer drag on the interaction overlay, starting exactly
// on the given handle of the named layer and moving (dx, dy) screen pixels.
async function dragHandle(page, layerName, handleId, dx, dy) {
  const box = await page.locator('#interaction-overlay').boundingBox();
  if (!box) throw new Error('Canvas not found');
  const handles = await page.evaluate(([name]) => {
    const l = window.State.layers.find(l => l.name === name);
    return window.Renderer.getHandles(l, window.State.zoom);
  }, [layerName]);
  const h = handles.find(h => h.id === handleId);
  if (!h) throw new Error(handleId + ' handle not found');

  const sx = box.x + h.x, sy = box.y + h.y;
  await page.evaluate(({ sx, sy, ex, ey }) => {
    const el = document.getElementById('interaction-overlay');
    const orig = el.setPointerCapture;
    el.setPointerCapture = () => {};
    const opts = { pointerId: 42, isPrimary: true, bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ex, clientY: ey, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ex, clientY: ey, buttons: 0 }));
    el.setPointerCapture = orig;
  }, { sx, sy, ex: sx + dx, ey: sy + dy });
  await page.waitForTimeout(100);
}

// Two linked 100×100 layers: alpha at (300,500), beta at (450,650).
async function setupPair(page) {
  await createProject(page, 'Linked Scaling Pair');
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'alpha.png' });
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'beta.png' });
  await page.evaluate(async () => {
    const [a, b] = window.State.layers;
    a.x = 300; a.y = 500;
    b.x = 450; b.y = 650;
    await window.DB.saveLayer(a);
    await window.DB.saveLayer(b);
  });
  await linkLayersByName(page, ['alpha', 'beta']);
}

// Three chained layers alpha–beta–gamma (linked pairwise) plus the ability
// to leave gamma unlinked for isolation tests.
async function setupTrio(page, { linkGamma = true } = {}) {
  await createProject(page, 'Linked Scaling Trio');
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'alpha.png' });
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'beta.png' });
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'gamma.png' });
  await page.evaluate(async () => {
    const [a, b, c] = window.State.layers;
    a.x = 300; a.y = 500;
    b.x = 450; b.y = 650;
    c.x = 800; c.y = 1100;
    await window.DB.saveLayer(a);
    await window.DB.saveLayer(b);
    await window.DB.saveLayer(c);
  });
  await linkLayersByName(page, ['alpha', 'beta']);
  if (linkGamma) await linkLayersByName(page, ['beta', 'gamma']);
}

// An aligned base+mask pair (100×100 both at (400,400)) with an image-mask
// relationship; createDifferenceMask also spawns a linked "(diff)" layer.
async function setupMaskPair(page, { difference = false } = {}) {
  await createProject(page, difference ? 'Linked Diff Mask' : 'Linked Image Mask');
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'base.png' });
  await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'cover.png' });
  await page.evaluate(async ({ difference }) => {
    const [a, b] = window.State.layers;
    a.x = 400; a.y = 400;
    b.x = 400; b.y = 400;
    await window.DB.saveLayer(a);
    await window.DB.saveLayer(b);
    window.State.selectedId = b.id;
    window.State.selectedIds = [a.id, b.id];
    await window.handleAction(difference ? 'create-difference-mask' : 'create-image-mask');
  }, { difference });
  await page.waitForFunction(() => window.State.layers.some(l => l.isMaskFor));
}

/* ═══════════════════════════════════════════════════════════════════
   Handle-drag scaling
   ═══════════════════════════════════════════════════════════════════ */

test.describe('Linked scaling: handle drags', () => {
  test('corner-handle drag scales the linked sibling by the same factor about the fixed corner', async ({ page }) => {
    await setupPair(page);
    await selectLayer(page, 'beta');
    await setZoom(page, 4);

    // Drag beta's bottom-right handle +60,+60 screen px = +15 page px at zoom 4
    // → new size 115, uniform scale 1.15. Alpha's top-left corner is the
    // stationary anchor for alpha's own motion.
    await dragHandle(page, 'beta', 'br', 60, 60);

    const g = await geom(page);
    expect(g.beta.width).toBeCloseTo(115, 6);
    expect(g.beta.height).toBeCloseTo(115, 6);
    // Sibling scales by the same factor…
    expect(g.alpha.width).toBeCloseTo(115, 6);
    expect(g.alpha.height).toBeCloseTo(115, 6);
    // …about the group anchor: beta's stationary top-left corner (450, 650).
    // Alpha's center offset from the anchor (−100, −100) becomes (−115, −115).
    expect(g.alpha.x).toBeCloseTo(450 - 115 - 57.5, 6);
    expect(g.alpha.y).toBeCloseTo(650 - 115 - 57.5, 6);
    // Beta keeps its fixed corner.
    expect(g.beta.x).toBeCloseTo(450, 6);
    expect(g.beta.y).toBeCloseTo(650, 6);
    // The center-to-center offset must scale by exactly the same factor.
    const dx = (g.beta.x + g.beta.width / 2) - (g.alpha.x + g.alpha.width / 2);
    const dy = (g.beta.y + g.beta.height / 2) - (g.alpha.y + g.alpha.height / 2);
    expect(dx).toBeCloseTo(150 * 1.15, 6);
    expect(dy).toBeCloseTo(150 * 1.15, 6);
  });

  test('right-edge handle drag scales width only, sibling centers keep their y', async ({ page }) => {
    await setupPair(page);
    await selectLayer(page, 'beta');
    await setZoom(page, 4);

    await dragHandle(page, 'beta', 'mr', 60, 0);

    const g = await geom(page);
    // Widths scale by 1.15, heights are untouched.
    expect(g.beta.width).toBeCloseTo(115, 6);
    expect(g.alpha.width).toBeCloseTo(115, 6);
    expect(g.beta.height).toBeCloseTo(100, 6);
    expect(g.alpha.height).toBeCloseTo(100, 6);
    // Alpha scales horizontally about the anchor — beta's stationary left
    // edge (x=450): its center x (350) moves to 335, y offset is unchanged.
    expect(g.alpha.x).toBeCloseTo(335 - 57.5, 6);
    expect(g.alpha.y).toBeCloseTo(500, 6);
    // Beta keeps its left edge and vertical position.
    expect(g.beta.x).toBeCloseTo(450, 6);
    expect(g.beta.y).toBeCloseTo(650, 6);
  });

  test('top-edge handle drag scales height only and pushes the sibling upward, not sideways', async ({ page }) => {
    await setupPair(page);
    await selectLayer(page, 'beta');
    await setZoom(page, 4);

    await dragHandle(page, 'beta', 'tm', 0, -60);

    const g = await geom(page);
    expect(g.beta.height).toBeCloseTo(115, 6);
    expect(g.alpha.height).toBeCloseTo(115, 6);
    expect(g.beta.width).toBeCloseTo(100, 6);
    expect(g.alpha.width).toBeCloseTo(100, 6);
    // Anchor is beta's stationary bottom edge (y=750). Alpha's center y
    // offset (−200) scales to (−230): center 550 → 520; x offset unchanged.
    expect(g.alpha.x).toBeCloseTo(300, 6);
    expect(g.alpha.y).toBeCloseTo(520 - 57.5, 6);
    // Beta's center y offset (−50) scales to (−57.5): top edge 650 → 635.
    expect(g.beta.y).toBeCloseTo(650 - 15, 6);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   Property-input scaling
   ═══════════════════════════════════════════════════════════════════ */

test.describe('Linked scaling: property inputs', () => {
  test('width input scales the linked sibling and keeps both centers fixed', async ({ page }) => {
    await setupPair(page);
    await selectLayer(page, 'beta');

    await setProp(page, 'w', 150);

    const g = await geom(page);
    expect(g.beta.width).toBe(150);
    expect(g.alpha.width).toBe(150);
    // Each linked layer scales about its own center.
    expect(g.beta.x).toBeCloseTo(500 - 75, 6);
    expect(g.beta.y).toBeCloseTo(650, 6);
    expect(g.alpha.x).toBeCloseTo(350 - 75, 6);
    expect(g.alpha.y).toBeCloseTo(500, 6);
    expect(g.alpha.height).toBe(100);
  });

  test('height input scales the linked sibling height only', async ({ page }) => {
    await setupPair(page);
    await selectLayer(page, 'beta');

    await setProp(page, 'h', 50);

    const g = await geom(page);
    expect(g.beta.height).toBe(50);
    expect(g.alpha.height).toBe(50);
    expect(g.beta.width).toBe(100);
    expect(g.alpha.width).toBe(100);
    // Centers stay fixed; y positions adjust by half the shrink.
    expect(g.beta.y).toBeCloseTo(700 - 25, 6);
    expect(g.alpha.y).toBeCloseTo(550 - 25, 6);
    expect(g.beta.x).toBeCloseTo(450, 6);
    expect(g.alpha.x).toBeCloseTo(300, 6);
  });

  test('an unlinked bystander layer is NOT scaled with the group', async ({ page }) => {
    await setupTrio(page, { linkGamma: false });
    await selectLayer(page, 'beta');
    await setZoom(page, 4);

    await dragHandle(page, 'beta', 'br', 60, 60);

    const g = await geom(page);
    expect(g.alpha.width).toBeCloseTo(115, 6);
    expect(g.beta.width).toBeCloseTo(115, 6);
    // Gamma is not linked to anything in the chain — untouched.
    expect(g.gamma.width).toBe(100);
    expect(g.gamma.height).toBe(100);
    expect(g.gamma.x).toBe(800);
    expect(g.gamma.y).toBe(1100);
  });

  test('a locked linked sibling is NOT scaled', async ({ page }) => {
    await setupPair(page);
    await page.evaluate(async () => {
      const b = window.State.layers.find(l => l.name === 'beta');
      b.locked = true;
      await window.DB.saveLayer(b);
      window.UI.refreshLayerList();
    });
    await selectLayer(page, 'alpha');
    await setZoom(page, 4);

    await dragHandle(page, 'alpha', 'br', 60, 60);

    const g = await geom(page);
    expect(g.alpha.width).toBeCloseTo(115, 6);
    expect(g.beta.width).toBe(100);
    expect(g.beta.x).toBe(450);
    expect(g.beta.y).toBe(650);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   Link chains (transitive groups)
   ═══════════════════════════════════════════════════════════════════ */

test.describe('Linked scaling: link chains', () => {
  test('corner drag propagates through the whole chain (A–B–C)', async ({ page }) => {
    await setupTrio(page);
    await selectLayer(page, 'beta');
    await setZoom(page, 4);

    await dragHandle(page, 'beta', 'br', 60, 60);

    const g = await geom(page);
    // Every member scales uniformly by 1.15.
    expect(g.alpha.width).toBeCloseTo(115, 6);
    expect(g.beta.width).toBeCloseTo(115, 6);
    expect(g.gamma.width).toBeCloseTo(115, 6);
    expect(g.gamma.height).toBeCloseTo(115, 6);
    // All members scale about the anchor — beta's stationary top-left corner
    // (450, 650). Alpha's center offset (−100, −100) → (−115, −115).
    expect(g.alpha.x).toBeCloseTo(450 - 115 - 57.5, 6);
    expect(g.alpha.y).toBeCloseTo(650 - 115 - 57.5, 6);
    // Gamma's center offset from the anchor (400, 500) scales to (460, 575).
    expect(g.gamma.x).toBeCloseTo(450 + 460 - 57.5, 6);
    expect(g.gamma.y).toBeCloseTo(650 + 575 - 57.5, 6);
    // Pairwise center distances all scale by the same factor.
    const dAB = Math.hypot(
      (g.beta.x - g.alpha.x), (g.beta.y - g.alpha.y));
    const dBC = Math.hypot(
      (g.gamma.x - g.beta.x), (g.gamma.y - g.beta.y));
    expect(dAB).toBeCloseTo(Math.hypot(150, 150) * 1.15, 4);
    expect(dBC).toBeCloseTo(Math.hypot(350, 450) * 1.15, 4);
  });

  test('width input propagates through the whole chain', async ({ page }) => {
    await setupTrio(page);
    await selectLayer(page, 'alpha');

    await setProp(page, 'w', 200);

    const g = await geom(page);
    expect(g.alpha.width).toBe(200);
    expect(g.beta.width).toBe(200);
    expect(g.gamma.width).toBe(200);
    // Centers fixed for every member.
    expect(g.alpha.x).toBeCloseTo(350 - 100, 6);
    expect(g.beta.x).toBeCloseTo(500 - 100, 6);
    expect(g.gamma.x).toBeCloseTo(850 - 100, 6);
    expect(g.beta.y).toBeCloseTo(650, 6);
    expect(g.gamma.y).toBeCloseTo(1100, 6);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   Image-mask groups
   ═══════════════════════════════════════════════════════════════════ */

test.describe('Linked scaling: image-mask groups', () => {
  test('resizing the base scales its mask layer and diff copy in lockstep', async ({ page }) => {
    await setupMaskPair(page, { difference: true });

    const ids = await page.evaluate(() => {
      const mask = window.State.layers.find(l => l.isMaskFor);
      const base = window.State.layers.find(l => (l.imageMaskIds || []).includes(mask.id));
      const diff = window.State.layers.find(l => l.name.includes('(diff)'));
      return { baseId: base.id, maskId: mask.id, diffId: diff.id };
    });
    await selectLayer(page, 'base');

    await setProp(page, 'w', 200);

    const state = await page.evaluate(({ baseId, maskId, diffId }) => {
      const byId = id => window.State.layers.find(l => l.id === id);
      const base = byId(baseId), mask = byId(maskId), diff = byId(diffId);
      const center = l => ({ x: l.x + l.width / 2, y: l.y + l.height / 2 });
      return {
        base: { w: base.width, h: base.height, c: center(base) },
        mask: { w: mask.width, h: mask.height, c: center(mask) },
        diff: { w: diff.width, h: diff.height, c: center(diff) },
        stillMasked: (base.imageMaskIds || []).includes(mask.id) && mask.isMaskFor === base.id,
        diffStillLinked: (diff.linkedIds || []).includes(mask.id) && (mask.linkedIds || []).includes(diff.id),
      };
    }, ids);

    // All three layers scale together and stay perfectly aligned.
    expect(state.base.w).toBe(200);
    expect(state.mask.w).toBe(200);
    expect(state.diff.w).toBe(200);
    expect(state.mask.h).toBe(state.base.h);
    expect(state.diff.h).toBe(state.base.h);
    expect(state.mask.c.x).toBeCloseTo(state.base.c.x, 6);
    expect(state.mask.c.y).toBeCloseTo(state.base.c.y, 6);
    expect(state.diff.c.x).toBeCloseTo(state.base.c.x, 6);
    expect(state.diff.c.y).toBeCloseTo(state.base.c.y, 6);
    // The resize must not have disturbed the mask relationships.
    expect(state.stillMasked).toBe(true);
    expect(state.diffStillLinked).toBe(true);
  });

  test('painted mask content stays aligned with the base after a group scale', async ({ page }) => {
    await setupMaskPair(page);

    // Paint a hole in the middle of the base's mask (natural coordinates).
    await page.evaluate(async () => {
      const base = window.State.layers.find(l => (l.imageMaskIds || []).length);
      window.MaskEngine._paint(base, 50, 50, 30, false);
      await window.DB.saveMask(base);
    });
    await selectLayer(page, 'base');

    await setProp(page, 'w', 200);

    const state = await page.evaluate(() => {
      const mask = window.State.layers.find(l => l.isMaskFor);
      const base = window.State.layers.find(l => (l.imageMaskIds || []).includes(mask.id));
      const center = l => ({ x: l.x + l.width / 2, y: l.y + l.height / 2 });
      // The mask bitmap lives in natural space: its painted center must map
      // back to the layer center at any scale.
      const d = base._maskCanvas.getContext('2d')
        .getImageData(Math.floor(base._maskCanvas.width / 2), Math.floor(base._maskCanvas.height / 2), 1, 1).data;
      return {
        maskW: mask.width,
        maskC: center(mask),
        baseC: center(base),
        baseW: base.width,
        paintedAlpha: d[3],
      };
    });
    expect(state.baseW).toBe(200);
    expect(state.maskW).toBe(200);
    expect(state.maskC.x).toBeCloseTo(state.baseC.x, 6);
    expect(state.maskC.y).toBeCloseTo(state.baseC.y, 6);
    expect(state.paintedAlpha).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   Rotation
   ═══════════════════════════════════════════════════════════════════ */

test.describe('Linked scaling: rotation', () => {
  test('rotate handle applies the same delta to every group member without moving them', async ({ page }) => {
    await setupTrio(page);
    await selectLayer(page, 'beta');
    await setZoom(page, 4);

    await dragHandle(page, 'beta', 'rotate', 60, 0);

    const g = await geom(page);
    expect(g.beta.rotation).toBeGreaterThan(5);
    expect(g.beta.rotation).toBeLessThan(30);
    expect(g.alpha.rotation).toBe(g.beta.rotation);
    expect(g.gamma.rotation).toBe(g.beta.rotation);
    // Rotation is about each layer's own center: geometry is untouched.
    expect(g.alpha.x).toBe(300);
    expect(g.beta.x).toBe(450);
    expect(g.gamma.x).toBe(800);
    expect(g.alpha.width).toBe(100);
    expect(g.gamma.width).toBe(100);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   Undo
   ═══════════════════════════════════════════════════════════════════ */

test.describe('Linked scaling: undo', () => {
  test('undo steps a handle-drag group scale back one layer at a time', async ({ page }) => {
    await setupPair(page);
    await selectLayer(page, 'beta');
    await setZoom(page, 4);
    await dragHandle(page, 'beta', 'br', 60, 60);

    let g = await geom(page);
    expect(g.alpha.width).toBeCloseTo(115, 6);

    // One undo per layer snapshot (primary first, then linked siblings).
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');

    g = await geom(page);
    expect(g.alpha.width).toBeCloseTo(100, 6);
    expect(g.beta.width).toBeCloseTo(100, 6);
    expect(g.alpha.x).toBeCloseTo(300, 6);
    expect(g.beta.x).toBeCloseTo(450, 6);
    expect(g.beta.y).toBeCloseTo(650, 6);
  });

  test('undoing a property-input chain scale restores every member', async ({ page }) => {
    await setupTrio(page);
    await selectLayer(page, 'alpha');
    await setProp(page, 'w', 200);

    let g = await geom(page);
    expect(g.gamma.width).toBe(200);

    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');

    g = await geom(page);
    expect(g.alpha.width).toBe(100);
    expect(g.beta.width).toBe(100);
    expect(g.gamma.width).toBe(100);
    expect(g.alpha.x).toBe(300);
    expect(g.gamma.x).toBe(800);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   Persistence
   ═══════════════════════════════════════════════════════════════════ */

test.describe('Linked scaling: persistence', () => {
  test('scaled geometry and the links themselves are saved to IndexedDB', async ({ page }) => {
    await setupPair(page);
    await selectLayer(page, 'beta');

    await setProp(page, 'w', 200);

    const ids = await page.evaluate(() => {
      const byName = n => window.State.layers.find(l => l.name === n);
      return { alphaId: byName('alpha').id, betaId: byName('beta').id };
    });

    // Wait for the (debounced-free) DB writes to land, then compare records
    // with live state.
    await page.waitForFunction(async ({ alphaId, betaId }) => {
      const [a, b] = await Promise.all([
        window.DB.get('layers', alphaId),
        window.DB.get('layers', betaId),
      ]);
      return a && b && a.width === 200 && b.width === 200;
    }, ids, { timeout: 8000 });

    const saved = await page.evaluate(async ({ alphaId, betaId }) => {
      const [a, b] = await Promise.all([
        window.DB.get('layers', alphaId),
        window.DB.get('layers', betaId),
      ]);
      const live = id => {
        const l = window.State.layers.find(l => l.id === id);
        return { x: l.x, y: l.y, width: l.width, height: l.height };
      };
      return {
        rec: { alpha: { x: a.x, y: a.y, width: a.width, height: a.height, linkedIds: a.linkedIds },
               beta: { x: b.x, y: b.y, width: b.width, height: b.height, linkedIds: b.linkedIds } },
        live: { alpha: live(alphaId), beta: live(betaId) },
      };
    }, ids);

    expect(saved.rec.alpha.width).toBe(saved.live.alpha.width);
    expect(saved.rec.beta.width).toBe(saved.live.beta.width);
    expect(saved.rec.alpha.x).toBeCloseTo(saved.live.alpha.x, 6);
    expect(saved.rec.alpha.y).toBeCloseTo(saved.live.alpha.y, 6);
    expect(saved.rec.beta.x).toBeCloseTo(saved.live.beta.x, 6);
    expect(saved.rec.beta.y).toBeCloseTo(saved.live.beta.y, 6);
    // The link relationship survived the resize.
    expect(saved.rec.alpha.linkedIds).toContain(ids.betaId);
    expect(saved.rec.beta.linkedIds).toContain(ids.alphaId);
  });
});
