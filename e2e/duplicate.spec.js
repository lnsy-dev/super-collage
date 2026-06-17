import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

const clickDuplicate = (page) =>
  page.locator('#layer-buttons [data-action="duplicate-layer"]').click();

// ── Image layer ────────────────────────────────────────────────────

test.describe('Duplicate – image layer', () => {
  test('creates a second layer named "copy"', async ({ page }) => {
    await createProject(page, 'Dup Image');
    await page.setInputFiles('#file-input', TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    await clickDuplicate(page);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
    await expect(page.locator('#layer-list .layer-name').nth(0)).toContainText('copy');
  });

  test('duplicate has offset position', async ({ page }) => {
    await createProject(page, 'Dup Image Pos');
    await page.setInputFiles('#file-input', TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    await clickDuplicate(page);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    const positions = await page.evaluate(() => {
      // @ts-ignore
      const orig = State.layers.find(l => !l.name.includes('copy'));
      // @ts-ignore
      const dup  = State.layers.find(l =>  l.name.includes('copy'));
      return { orig: { x: orig.x, y: orig.y }, dup: { x: dup.x, y: dup.y } };
    });
    expect(positions.dup.x).toBe(positions.orig.x + 20);
    expect(positions.dup.y).toBe(positions.orig.y + 20);
  });

  test('duplicate is selected after click', async ({ page }) => {
    await createProject(page, 'Dup Image Select');
    await page.setInputFiles('#file-input', TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    await clickDuplicate(page);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    const selected = await page.evaluate(() => {
      // @ts-ignore
      return State.layers.find(l => l.id === State.selectedId)?.name;
    });
    expect(selected).toContain('copy');
  });

  test('duplicate preserves image content', async ({ page }) => {
    await createProject(page, 'Dup Image Content');
    await page.setInputFiles('#file-input', TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);

    await clickDuplicate(page);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    const hasCanvas = await page.evaluate(() => {
      // @ts-ignore
      const dup = State.layers.find(l => l.name.includes('copy'));
      return !!dup?._originalCanvas;
    });
    expect(hasCanvas).toBe(true);
  });
});

// ── Text layer ─────────────────────────────────────────────────────

test.describe('Duplicate – text layer', () => {
  async function addTextLayer(page, text = 'Hello') {
    page.once('dialog', d => d.accept(text));
    await page.click('[data-menu="file"]');
    await page.click('[data-action="add-text"]');
    await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T / })).toBeVisible();
  }

  test('creates a second text layer named "copy"', async ({ page }) => {
    await createProject(page, 'Dup Text');
    await addTextLayer(page);

    await clickDuplicate(page);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
    await expect(page.locator('#layer-list .layer-name').nth(0)).toContainText('copy');
  });

  test('duplicate preserves text content and isText flag', async ({ page }) => {
    await createProject(page, 'Dup Text Content');
    await addTextLayer(page, 'Duplicate me');

    await clickDuplicate(page);

    const dup = await page.evaluate(() => {
      // @ts-ignore
      const d = State.layers.find(l => l.name.includes('copy'));
      return { isText: d?.isText, text: d?.text };
    });
    expect(dup.isText).toBe(true);
    expect(dup.text).toBe('Duplicate me');
  });

  test('duplicate text layer is dirty and renders', async ({ page }) => {
    await createProject(page, 'Dup Text Render');
    await addTextLayer(page, 'Render me');

    // Wait for original to render
    await page.waitForFunction(() => {
      // @ts-ignore
      return !!window.State.layers.find(l => l.isText)?._processedCanvas;
    }, { timeout: 10000 });

    await clickDuplicate(page);

    // The duplicate should eventually get a processedCanvas too
    await page.waitForFunction(() => {
      // @ts-ignore
      const dup = window.State.layers.find(l => l.name?.includes('copy'));
      return !!dup?._processedCanvas;
    }, { timeout: 10000 });

    const ok = await page.evaluate(() => {
      // @ts-ignore
      return !!window.State.layers.find(l => l.name?.includes('copy'))?._processedCanvas;
    });
    expect(ok).toBe(true);
  });
});

// ── Color Separation layer ─────────────────────────────────────────

test.describe('Duplicate – color separation layer', () => {
  async function addColorSepLayer(page) {
    await page.click('.menu-item[data-menu="file"]');
    await page.click('.menu-entry[data-action="import-color-separation"]');
    await page.setInputFiles('#color-sep-input', TEST_IMAGE);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name')).toContainText('Sep:');
  }

  test('creates a second layer named "copy"', async ({ page }) => {
    await createProject(page, 'Dup ColSep');
    await addColorSepLayer(page);

    await clickDuplicate(page);

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);
    await expect(page.locator('#layer-list .layer-name').nth(0)).toContainText('copy');
  });

  test('duplicate preserves isColorSeparation flag and separationColors', async ({ page }) => {
    await createProject(page, 'Dup ColSep Flags');
    await addColorSepLayer(page);

    await clickDuplicate(page);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    const dup = await page.evaluate(() => {
      // @ts-ignore
      const d = State.layers.find(l => l.name.includes('copy'));
      return {
        isColorSeparation: d?.isColorSeparation,
        colorsCount: d?.separationColors?.length,
      };
    });
    expect(dup.isColorSeparation).toBe(true);
    expect(dup.colorsCount).toBeGreaterThan(0);
  });

  test('duplicate has separation plates rebuilt', async ({ page }) => {
    await createProject(page, 'Dup ColSep Plates');
    await addColorSepLayer(page);

    await clickDuplicate(page);
    await expect(page.locator('#layer-list .layer-row')).toHaveCount(2);

    const platesSize = await page.evaluate(() => {
      // @ts-ignore
      const d = State.layers.find(l => l.name.includes('copy'));
      return d?.separationPlates?.size ?? 0;
    });
    expect(platesSize).toBeGreaterThan(0);
  });
});
