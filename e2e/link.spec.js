import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImageFromBuffer, createSolidPngBuffer } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

const clickLink = (page) =>
  page.locator('#layer-buttons [data-action="link-layers"]').click();

const clickFillMask = (page) =>
  page.locator('#layer-props [data-action="fill-mask"]').click();

const clickClearMask = (page) =>
  page.locator('#layer-props [data-action="clear-mask"]').click();

test.describe('Layer Linking', () => {
  test('link button appears for multi-selection and toggles link state', async ({ page }) => {
    await createProject(page, 'Link Test');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'a.png' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'b.png' });

    const linkBtn = page.locator('#layer-buttons [data-action="link-layers"]');
    await expect(linkBtn).toBeHidden();

    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Shift'] });
    await expect(linkBtn).toBeVisible();
    await expect(linkBtn).toHaveText('Link');

    await clickLink(page);
    await expect(linkBtn).toHaveText('Unlink');

    const linked = await page.evaluate(() => {
      // @ts-ignore
      const [a, b] = window.State.layers;
      return {
        aId: a.id,
        bId: b.id,
        aLinks: a.linkedIds,
        bLinks: b.linkedIds,
      };
    });
    expect(linked.aLinks).toContain(linked.bId);
    expect(linked.bLinks).toContain(linked.aId);

    await clickLink(page);
    await expect(linkBtn).toHaveText('Link');

    const unlinked = await page.evaluate(() => {
      // @ts-ignore
      const [a, b] = window.State.layers;
      return { aLinks: a.linkedIds, bLinks: b.linkedIds };
    });
    expect(unlinked.aLinks).toEqual([]);
    expect(unlinked.bLinks).toEqual([]);
  });

  test('moving a linked layer moves its linked siblings', async ({ page }) => {
    await createProject(page, 'Link Move');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'a.png' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'b.png' });

    await page.evaluate(() => {
      // @ts-ignore
      const [a, b] = window.State.layers;
      a.x = 300; a.y = 400;
      b.x = 500; b.y = 400;
    });

    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Shift'] });
    await clickLink(page);

    // Select only the first layer and nudge it with the keyboard.
    await rows.nth(0).click();
    await page.keyboard.press('ArrowRight');

    const positions = await page.evaluate(() => {
      // @ts-ignore
      const [a, b] = window.State.layers;
      return { ax: a.x, bx: b.x };
    });
    expect(positions.bx).toBe(positions.ax + 200);
  });

  test('mask actions propagate through links', async ({ page }) => {
    await createProject(page, 'Link Mask');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'a.png' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'b.png' });

    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Shift'] });
    await clickLink(page);

    // Select the first layer and fill its mask.
    await rows.nth(0).click();
    await clickFillMask(page);

    const filled = await page.evaluate(() => {
      // @ts-ignore
      return window.State.layers.map(l => {
        if (!l._maskCanvas) return null;
        const d = l._maskCanvas.getContext('2d').getImageData(
          Math.floor(l.naturalWidth / 2), Math.floor(l.naturalHeight / 2), 1, 1
        ).data;
        return d[3];
      });
    });
    expect(filled[0]).toBe(0);
    expect(filled[1]).toBe(0);

    await clickClearMask(page);

    const cleared = await page.evaluate(() => {
      // @ts-ignore
      return window.State.layers.map(l => {
        if (!l._maskCanvas) return null;
        const d = l._maskCanvas.getContext('2d').getImageData(
          Math.floor(l.naturalWidth / 2), Math.floor(l.naturalHeight / 2), 1, 1
        ).data;
        return d[3];
      });
    });
    expect(cleared[0]).toBe(255);
    expect(cleared[1]).toBe(255);
  });
});

test.describe('Linked layer resize', () => {
  test('resizing via handle drag scales linked siblings', async ({ page }) => {
    await createProject(page, 'Link Resize Test');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'a.png' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'b.png' });

    // Link the two layers.
    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Shift'] });
    await clickLink(page);

    // Position layers apart, select layer b alone.
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const [a, b] = window.State.layers;
      a.x = 100; a.y = 400;
      b.x = 200; b.y = 200; b.width = 100; b.height = 100;
      window.State.selectedId = b.id;
      window.State.selectedIds = [b.id];
      window.State.zoom = 4;
      Renderer.resize();
      Renderer.schedule();
      window.UI.refreshLayerList();
    });
    await page.waitForTimeout(100);

    const box = await page.locator('#interaction-overlay').boundingBox();
    if (!box) throw new Error('Canvas not found');

    const handles = await page.evaluate(async () => {
      const { Renderer } = await import('/src/app/renderer.js');
      const b = window.State.layers.find(l => window.State.selectedIds.includes(l.id));
      return Renderer.getHandles(b, window.State.zoom);
    });
    const br = handles.find(h => h.id === 'br');
    if (!br) throw new Error('br handle not found');

    const before = await page.evaluate(() => {
      const [a, b] = window.State.layers;
      return { aw: a.width, bw: b.width };
    });

    const startX = box.x + br.x;
    const startY = box.y + br.y;
    await page.evaluate(({ sx, sy, ex, ey }) => {
      const el = document.getElementById('interaction-overlay');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      const opts = { pointerId: 42, isPrimary: true, bubbles: true, cancelable: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ex, clientY: ey, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ex, clientY: ey, buttons: 0 }));
      el.setPointerCapture = orig;
    }, { sx: startX, sy: startY, ex: startX + 60, ey: startY + 60 });
    await page.waitForTimeout(100);

    const after = await page.evaluate(() => {
      const [a, b] = window.State.layers;
      return { aw: a.width, bw: b.width };
    });

    expect(after.bw).toBeGreaterThan(before.bw * 1.1);
    // Linked sibling scaled by approximately the same factor.
    const factor = after.bw / before.bw;
    expect(after.aw / before.aw).toBeCloseTo(factor, 1);
  });

  test('width property input resizes linked siblings proportionally', async ({ page }) => {
    await createProject(page, 'Link Resize Prop Test');
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'a.png' });
    await addImageFromBuffer(page, createSolidPngBuffer('#000000', 100, 100), { name: 'b.png' });

    const rows = page.locator('#layer-list .layer-row');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Shift'] });
    await clickLink(page);

    // Select layer b alone and change its width.
    await rows.nth(1).click();
    await page.fill('#prop-w', '200');
    await page.keyboard.press('Enter');

    const sizes = await page.evaluate(() => {
      const [a, b] = window.State.layers;
      return { aw: a.width, bw: b.width };
    });
    expect(sizes.bw).toBe(200);
    expect(sizes.aw).toBe(200);
  });
});
