import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addTextLayer } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test('double-clicking a text layer with the Select tool opens the editor', async ({ page }) => {
  test.setTimeout(60000);
  await createProject(page, 'Dblclick Edit');
  await addTextLayer(page, 'Hello');

  await page.evaluate(async () => {
    const { Renderer } = await import('/src/app/renderer.js');
    const { CANVAS_PAD } = await import('/src/app/constants.js');
    const l = State.layers.find(x => x.isText);
    l.x = 100; l.y = 100;
    State.selectedId = null; State.selectedIds = [];
    State.zoom = 1;
    Renderer.resize(); Renderer.schedule();
    UI.refreshLayerList(); UI.refreshProperties();
    // keep pad referenced (used below via evaluate)
    window.__pad = CANVAS_PAD;
  });
  await page.waitForTimeout(200);

  const box = await page.locator('#interaction-overlay').boundingBox();
  const pt = await page.evaluate(async ({ pad }) => {
    const l = State.layers.find(x => x.isText);
    const z = State.zoom;
    return { x: (l.x + pad) * z + 20, y: (l.y + pad) * z + 20 };
  }, { pad: await page.evaluate(async () => (await import('/src/app/constants.js')).CANVAS_PAD) });

  await page.mouse.dblclick(box.x + pt.x, box.y + pt.y);
  await expect(page.locator('.text-editor-input')).toBeVisible({ timeout: 10000 });
});
