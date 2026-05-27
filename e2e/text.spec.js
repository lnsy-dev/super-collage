import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, selectTool, getLayerCount } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Text Tool', () => {
  test('select text tool', async ({ page }) => {
    await createProject(page, 'Text Tool Test');
    await selectTool(page, 'text');
    await expect(page.locator('#status-tool')).toContainText('Text');
  });

  test('place text layer via canvas click', async ({ page }) => {
    await createProject(page, 'Place Text Test');
    await selectTool(page, 'text');

    const canvas = page.locator('#interaction-overlay');
    await canvas.click({ position: { x: 200, y: 200 } });

    // Type-set element should appear in the pool
    await expect(page.locator('#text-layer-pool type-set')).toHaveCount(1);

    // Wait for layer to be fully created
    await page.waitForFunction(() => State.layers.length > 0);

    // Type some text into the element
    await page.evaluate(() => {
      const el = document.querySelector('#text-layer-pool type-set');
      if (el) el.text = 'Hello Riso';
    });

    // Switch to select tool to finalize editing
    await selectTool(page, 'select');

    // Layer should exist
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    const count = await getLayerCount(page);
    expect(count).toBe(1);

    const isText = await page.evaluate(() => {
      return State.layers[0]?.isText;
    });
    expect(isText).toBe(true);
  });

  test('edit existing text layer via double-click', async ({ page }) => {
    await createProject(page, 'Edit Text Test');
    await selectTool(page, 'text');

    const canvas = page.locator('#interaction-overlay');
    await canvas.click({ position: { x: 200, y: 200 } });

    // Wait for layer to be fully created
    await page.waitForFunction(() => State.layers.length > 0);

    await page.evaluate(() => {
      const el = document.querySelector('#text-layer-pool type-set');
      if (el) el.text = 'Initial';
    });

    // Give sync time to complete
    await page.waitForTimeout(200);

    // Switch to select tool to finalize editing
    await selectTool(page, 'select');

    // Double-click the text layer to edit again
    const layerBox = await page.evaluate(() => {
      const layer = State.layers[0];
      return { x: layer.x, y: layer.y, w: layer.width, h: layer.height };
    });

    const overlayBox = await canvas.boundingBox();
    if (!overlayBox) throw new Error('Canvas not found');

    const dblX = overlayBox.x + (layerBox.x + layerBox.w / 2) * (await page.evaluate(() => State.zoom));
    const dblY = overlayBox.y + (layerBox.y + layerBox.h / 2) * (await page.evaluate(() => State.zoom));

    await page.mouse.dblclick(dblX, dblY);

    // Should still have one type-set element
    await expect(page.locator('#text-layer-pool type-set')).toHaveCount(1);

    const text = await page.evaluate(() => {
      const el = document.querySelector('#text-layer-pool type-set');
      return el?.text;
    });
    expect(text).toBe('Initial');
  });

  test('duplicate text layer', async ({ page }) => {
    await createProject(page, 'Dup Text Test');
    await selectTool(page, 'text');

    const canvas = page.locator('#interaction-overlay');
    await canvas.click({ position: { x: 200, y: 200 } });

    // Wait for layer to be fully created
    await page.waitForFunction(() => State.layers.length > 0);

    await page.evaluate(() => {
      const el = document.querySelector('#text-layer-pool type-set');
      if (el) el.text = 'Duplicate Me';
    });

    // Switch to select tool to finalize editing
    await selectTool(page, 'select');

    await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    const bothText = await page.evaluate(() => {
      return State.layers.every(l => l.isText);
    });
    expect(bothText).toBe(true);

    // Both should have type-set elements
    await expect(page.locator('#text-layer-pool type-set')).toHaveCount(2);
  });

  test('double-click selects word when editing', async ({ page }) => {
    await createProject(page, 'Word Select Test');
    await selectTool(page, 'text');

    const canvas = page.locator('#interaction-overlay');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForFunction(() => State.layers.length > 0);

    await page.evaluate(() => {
      const el = document.querySelector('#text-layer-pool type-set');
      if (el) el.text = 'Hello World';
    });

    // Wait for layout
    await page.waitForTimeout(300);

    // Double-click on the text to select a word
    const layerBox = await page.evaluate(() => {
      const layer = State.layers[0];
      return { x: layer.x, y: layer.y, w: layer.width, h: layer.height };
    });

    const overlayBox = await canvas.boundingBox();
    if (!overlayBox) throw new Error('Canvas not found');

    const z = await page.evaluate(() => State.zoom);
    const dblX = overlayBox.x + (layerBox.x + layerBox.w / 2) * z;
    const dblY = overlayBox.y + (layerBox.y + layerBox.h / 2) * z;

    await page.mouse.dblclick(dblX, dblY);
    await page.waitForTimeout(100);

    const selection = await page.evaluate(() => {
      const el = document.querySelector('#text-layer-pool type-set');
      if (!el) return null;
      return {
        hasSelection: el.hasSelection,
        selStart: el.selStart,
        selEnd: el.selEnd,
        text: el.text,
        selectedText: el.text.slice(el.selStart, el.selEnd),
      };
    });

    expect(selection).not.toBeNull();
    expect(selection.hasSelection).toBe(true);
    // Should select a single word (either "Hello" or "World")
    expect(selection.selectedText).toMatch(/^(Hello|World)$/);
  });

  test('command+a selects all text when editing', async ({ page }) => {
    await createProject(page, 'Select All Test');
    await selectTool(page, 'text');

    const canvas = page.locator('#interaction-overlay');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForFunction(() => State.layers.length > 0);

    await page.evaluate(() => {
      const el = document.querySelector('#text-layer-pool type-set');
      if (el) el.text = 'The quick brown fox';
    });

    // Wait for layout
    await page.waitForTimeout(300);

    // Press Cmd+A to select all
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(100);

    const selection = await page.evaluate(() => {
      const el = document.querySelector('#text-layer-pool type-set');
      if (!el) return null;
      return {
        hasSelection: el.hasSelection,
        selStart: el.selStart,
        selEnd: el.selEnd,
        text: el.text,
        selectedText: el.text.slice(el.selStart, el.selEnd),
      };
    });

    expect(selection).not.toBeNull();
    expect(selection.hasSelection).toBe(true);
    expect(selection.selStart).toBe(0);
    expect(selection.selEnd).toBe(selection.text.length);
    expect(selection.selectedText).toBe('The quick brown fox');
  });
});
