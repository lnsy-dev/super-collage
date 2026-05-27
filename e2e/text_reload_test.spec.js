import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, selectTool, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

async function getTextLayerState(page) {
  return page.evaluate(() => {
    const layer = State.layers[0];
    if (!layer) return null;
    const entry = TextEngine.pool.get(layer.id);
    const element = entry?.element;
    
    // Count lines by grouping glyphs by y position
    const glyphs = element?.glyphs || [];
    const lineYs = new Set();
    for (const g of glyphs) {
      if (g.char === '\n') continue;
      lineYs.add(Math.round(g.y));
    }
    
    return {
      text: layer.textConfig?.text,
      fontSize: layer.textConfig?.fontSize,
      fontFamily: layer.textConfig?.fontFamily,
      width: layer.width,
      height: layer.height,
      naturalWidth: layer.naturalWidth,
      naturalHeight: layer.naturalHeight,
      x: layer.x,
      y: layer.y,
      visible: layer.visible,
      lineCount: lineYs.size,
      glyphCount: glyphs.length,
      wrapperWidth: entry?.wrapper?.clientWidth,
      wrapperHeight: entry?.wrapper?.clientHeight,
    };
  });
}

async function getTextConfigDeep(page) {
  return page.evaluate(() => {
    const layer = State.layers[0];
    return layer ? JSON.parse(JSON.stringify(layer.textConfig)) : null;
  });
}

async function reloadAndReopenProject(page, projectName) {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#project-dialog')).toBeVisible();
  
  // Select the project and open it
  await page.locator('.project-entry', { hasText: projectName }).click();
  await page.click('#btn-open-project');
  await expect(page.locator('#main-app')).toBeVisible();
  await page.waitForTimeout(500);
}

test('text layer persists correctly after reload - short text', async ({ page }) => {
  await createProject(page, 'Reload Test Short');
  await selectTool(page, 'text');

  const canvas = page.locator('#interaction-overlay');
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForFunction(() => State.layers.length > 0);
  
  await page.evaluate(() => {
    const el = document.querySelector('#text-layer-pool type-set');
    if (el) el.text = 'Hello World';
  });

  await selectTool(page, 'select');
  await page.waitForTimeout(300);

  const before = await getTextLayerState(page);
  const beforeConfig = await getTextConfigDeep(page);
  console.log('Before reload:', before);

  expect(before).not.toBeNull();
  expect(before.text).toBe('Hello World');
  expect(before.lineCount).toBeGreaterThan(0);

  await reloadAndReopenProject(page, 'Reload Test Short');
  
  const after = await getTextLayerState(page);
  const afterConfig = await getTextConfigDeep(page);
  console.log('After reload:', after);

  expect(after).not.toBeNull();
  expect(after.text).toBe(before.text);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  expect(after.naturalWidth).toBe(before.naturalWidth);
  expect(after.naturalHeight).toBe(before.naturalHeight);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.visible).toBe(before.visible);
  expect(after.lineCount).toBe(before.lineCount);
  expect(after.glyphCount).toBe(before.glyphCount);
  expect(afterConfig).toEqual(beforeConfig);
});

test('text layer persists correctly after reload - long wrapping text', async ({ page }) => {
  await createProject(page, 'Reload Test Long');
  await selectTool(page, 'text');

  const canvas = page.locator('#interaction-overlay');
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForFunction(() => State.layers.length > 0);
  
  // Set text that should wrap to multiple lines in a 300px box
  const longText = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.';
  await page.evaluate((text) => {
    const el = document.querySelector('#text-layer-pool type-set');
    if (el) el.text = text;
  }, longText);

  await selectTool(page, 'select');
  await page.waitForTimeout(300);

  const before = await getTextLayerState(page);
  console.log('Before reload (long):', before);
  expect(before).not.toBeNull();
  expect(before.text).toBe(longText);
  expect(before.lineCount).toBeGreaterThan(1);

  await reloadAndReopenProject(page, 'Reload Test Long');
  
  const after = await getTextLayerState(page);
  console.log('After reload (long):', after);

  expect(after).not.toBeNull();
  expect(after.text).toBe(before.text);
  expect(after.lineCount).toBe(before.lineCount);
  expect(after.glyphCount).toBe(before.glyphCount);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  expect(after.naturalWidth).toBe(before.naturalWidth);
  expect(after.naturalHeight).toBe(before.naturalHeight);
});

test('text layer persists correctly after reload - multi-line explicit breaks', async ({ page }) => {
  await createProject(page, 'Reload Test Multi');
  await selectTool(page, 'text');

  const canvas = page.locator('#interaction-overlay');
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForFunction(() => State.layers.length > 0);
  
  const multiLineText = 'Line one\nLine two\nLine three';
  await page.evaluate((text) => {
    const el = document.querySelector('#text-layer-pool type-set');
    if (el) {
      el.text = text;
      el.setAttribute('font-size', '6');
    }
  }, multiLineText);

  await selectTool(page, 'select');
  await page.waitForTimeout(300);

  const before = await getTextLayerState(page);
  console.log('Before reload (multi):', before);
  expect(before).not.toBeNull();
  expect(before.lineCount).toBe(3);

  await reloadAndReopenProject(page, 'Reload Test Multi');
  
  const after = await getTextLayerState(page);
  console.log('After reload (multi):', after);

  expect(after).not.toBeNull();
  expect(after.text).toBe(before.text);
  expect(after.lineCount).toBe(before.lineCount);
});

test('text layer persists after reload with property changes', async ({ page }) => {
  await createProject(page, 'Reload Test Props');
  await selectTool(page, 'text');

  const canvas = page.locator('#interaction-overlay');
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForFunction(() => State.layers.length > 0);
  
  await page.evaluate(() => {
    const el = document.querySelector('#text-layer-pool type-set');
    if (el) {
      el.text = 'The quick brown fox';
      el.setAttribute('font-size', '12');
      el.setAttribute('letter-spacing', '2');
    }
  });

  await selectTool(page, 'select');
  await page.waitForTimeout(300);

  const before = await getTextLayerState(page);
  console.log('Before reload (props):', before);

  await reloadAndReopenProject(page, 'Reload Test Props');
  
  const after = await getTextLayerState(page);
  console.log('After reload (props):', after);

  expect(after).not.toBeNull();
  expect(after.text).toBe(before.text);
  expect(after.lineCount).toBe(before.lineCount);
  expect(after.glyphCount).toBe(before.glyphCount);
});

test('text layer persists after reload with different font', async ({ page }) => {
  await createProject(page, 'Reload Test Font');
  await selectTool(page, 'text');

  const canvas = page.locator('#interaction-overlay');
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForFunction(() => State.layers.length > 0);
  
  await page.evaluate(() => {
    const el = document.querySelector('#text-layer-pool type-set');
    if (el) {
      el.text = 'The quick brown fox jumps over the lazy dog';
      el.setAttribute('font-family', 'League Gothic');
      el.setAttribute('font-size', '10');
    }
  });

  await selectTool(page, 'select');
  await page.waitForTimeout(300);

  const before = await getTextLayerState(page);
  console.log('Before reload (font):', before);
  expect(before?.fontFamily).toBe('League Gothic');

  await reloadAndReopenProject(page, 'Reload Test Font');
  
  const after = await getTextLayerState(page);
  console.log('After reload (font):', after);

  expect(after).not.toBeNull();
  expect(after.text).toBe(before.text);
  expect(after.fontFamily).toBe(before.fontFamily);
  expect(after.fontSize).toBe(before.fontSize);
  expect(after.lineCount).toBe(before.lineCount);
  expect(after.glyphCount).toBe(before.glyphCount);
});

test('text layer persists after reload with resized box', async ({ page }) => {
  await createProject(page, 'Reload Test Resize');
  await selectTool(page, 'text');

  const canvasBox = await page.locator('#interaction-overlay').boundingBox();
  // Drag to create a larger text box using raw mouse events
  await page.mouse.move(canvasBox.x + 200, canvasBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 500, canvasBox.y + 350, { steps: 5 });
  await page.mouse.up();
  
  await page.waitForFunction(() => State.layers.length > 0);
  
  await page.evaluate(() => {
    const el = document.querySelector('#text-layer-pool type-set');
    if (el) el.text = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.';
  });

  await selectTool(page, 'select');
  await page.waitForTimeout(300);

  const before = await getTextLayerState(page);
  console.log('Before reload (resize):', before);
  expect(before).not.toBeNull();
  // Should be wider than default 300
  expect(before.width).toBeGreaterThan(300);

  await reloadAndReopenProject(page, 'Reload Test Resize');
  
  const after = await getTextLayerState(page);
  console.log('After reload (resize):', after);

  expect(after).not.toBeNull();
  expect(after.text).toBe(before.text);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  expect(after.naturalWidth).toBe(before.naturalWidth);
  expect(after.naturalHeight).toBe(before.naturalHeight);
  expect(after.lineCount).toBe(before.lineCount);
  expect(after.glyphCount).toBe(before.glyphCount);
});

test('legacy text layer with mismatched width/naturalWidth renders correctly after reload', async ({ page }) => {
  await createProject(page, 'Legacy Width Test');
  await selectTool(page, 'text');

  const canvas = page.locator('#interaction-overlay');
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForFunction(() => State.layers.length > 0);
  
  await page.evaluate(() => {
    const el = document.querySelector('#text-layer-pool type-set');
    if (el) el.text = 'The quick brown fox jumps over the lazy dog';
  });

  await selectTool(page, 'select');
  await page.waitForTimeout(300);

  const before = await getTextLayerState(page);
  console.log('Before reload (legacy):', before);
  expect(before).not.toBeNull();

  // Simulate a legacy save where width was stored as zoomed pixels (36) 
  // but naturalWidth was 300
  await page.evaluate(() => {
    const layer = State.layers[0];
    layer.width = 36;  // old zoomed width
    layer.height = 12; // old zoomed height
    layer.naturalWidth = 300;
    layer.naturalHeight = 100;
    // Force save
    DB.saveLayer(layer);
  });
  await page.waitForTimeout(200);

  await reloadAndReopenProject(page, 'Legacy Width Test');
  
  const after = await getTextLayerState(page);
  console.log('After reload (legacy):', after);

  expect(after).not.toBeNull();
  // Wrapper should use naturalWidth, not the legacy zoomed width
  expect(after.wrapperWidth).toBe(300);
  expect(after.wrapperHeight).toBe(100);
  // Text should wrap the same way
  expect(after.lineCount).toBe(before.lineCount);
  expect(after.glyphCount).toBe(before.glyphCount);
});
