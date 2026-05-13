import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject, addImage } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Zoom Controls', () => {
  test('zoom in increases zoom level', async ({ page }) => {
    await createProject(page, 'Zoom In Test');
    await addImage(page, TEST_IMAGE);

    const initialZoom = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    await page.locator('#zoom-controls [data-action="zoom-in"]').click();

    const newZoom = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    expect(newZoom).toBeGreaterThan(initialZoom);
  });

  test('zoom out decreases zoom level', async ({ page }) => {
    await createProject(page, 'Zoom Out Test');
    await addImage(page, TEST_IMAGE);

    // First zoom in so we can zoom out
    await page.locator('#zoom-controls [data-action="zoom-in"]').click();
    const zoomedIn = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    await page.locator('#zoom-controls [data-action="zoom-out"]').click();

    const zoomedOut = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    expect(zoomedOut).toBeLessThan(zoomedIn);
  });

  test('fit to window sets reasonable zoom', async ({ page }) => {
    await createProject(page, 'Zoom Fit Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#zoom-controls [data-action="zoom-fit"]').click();

    const zoom = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThanOrEqual(2);
  });

  test('actual size sets zoom to 100%', async ({ page }) => {
    await createProject(page, 'Zoom 100 Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#zoom-controls [data-action="zoom-100"]').click();

    const zoom = await page.evaluate(() => {
      // @ts-ignore
      return State.zoom;
    });

    expect(zoom).toBe(1);
    await expect(page.locator('#zoom-display')).toHaveText('100%');
    await expect(page.locator('#status-zoom')).toHaveText('100%');
  });

  test('zoom display updates after zoom change', async ({ page }) => {
    await createProject(page, 'Zoom Display Test');
    await addImage(page, TEST_IMAGE);

    await page.locator('#zoom-controls [data-action="zoom-100"]').click();
    await expect(page.locator('#zoom-display')).toHaveText('100%');

    await page.locator('#zoom-controls [data-action="zoom-in"]').click();
    const zoomText = await page.locator('#zoom-display').textContent();
    expect(zoomText).not.toBe('100%');
  });
});
