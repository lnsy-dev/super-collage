// @ts-check
import { test, expect } from '@playwright/test';
import { clearIndexedDB, createProject } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');

const TOGGLE = '#layer-multiselect';
const CHECKBOX = '#layer-multiselect-checkbox';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

/**
 * Project with three image layers so multi-select has something to work on.
 * Row nth(0) in the panel is the topmost layer (last in State.layers).
 */
async function setupThreeLayers(page, name) {
  await createProject(page, name);
  await page.setInputFiles('#file-input', TEST_IMAGE);
  await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
  await page.locator('#layer-buttons [data-action="duplicate-layer"]').click();
  await expect(page.locator('#layer-list .layer-row')).toHaveCount(3);

  // Duplicating leaves the new copy selected; the selection tests below
  // count taps, so start from an empty selection.
  await page.evaluate(() => {
    State.selectedId = null;
    State.selectedIds = [];
  });
}

async function readSelection(page) {
  return page.evaluate(() => ({
    selectedId: State.selectedId,
    selectedIds: [...State.selectedIds],
  }));
}

async function tapRow(page, index) {
  await page.locator('#layer-list .layer-row').nth(index).click();
}

/* ─── MOUSE (NON-TOUCH) DEVICES ──────────────────────────────────── */

test.describe('Layer multi-select toggle — mouse device', () => {
  test('checkbox is hidden on a non-touch device', async ({ page }) => {
    await createProject(page, 'Mouse No Toggle');
    await expect(page.locator(TOGGLE)).toBeHidden();
  });

  test('tapping rows still single-selects without the checkbox', async ({ page }) => {
    await setupThreeLayers(page, 'Mouse Single Select');
    await expect(page.locator(TOGGLE)).toBeHidden();

    await tapRow(page, 0);
    await tapRow(page, 2);

    const sel = await readSelection(page);
    expect(sel.selectedIds).toHaveLength(1);
  });
});

/* ─── TOUCH DEVICES ──────────────────────────────────────────────── */

test.describe('Layer multi-select toggle — touch device', () => {
  // hasTouch gives the context a nonzero maxTouchPoints, the same signal
  // isTouchDevice() keys on for real tablets/phones.
  test.use({ hasTouch: true });

  test('checkbox is shown on a touch device', async ({ page }) => {
    await createProject(page, 'Touch Shows Toggle');
    await expect(page.locator(TOGGLE)).toBeVisible();
    await expect(page.locator(CHECKBOX)).toBeVisible();
  });

  test('checked: tapping layers adds each to the multi-selection', async ({ page }) => {
    await setupThreeLayers(page, 'Touch Multi Add');
    await page.locator(CHECKBOX).check();

    await tapRow(page, 0);
    let sel = await readSelection(page);
    expect(sel.selectedIds).toHaveLength(1);

    await tapRow(page, 1);
    sel = await readSelection(page);
    expect(sel.selectedIds).toHaveLength(2);

    await tapRow(page, 2);
    sel = await readSelection(page);
    expect(sel.selectedIds).toHaveLength(3);

    // Every row renders as selected.
    await expect(page.locator('#layer-list .layer-row.selected')).toHaveCount(3);
  });

  test('checked: tapping a selected layer toggles it back out', async ({ page }) => {
    await setupThreeLayers(page, 'Touch Multi Toggle');
    await page.locator(CHECKBOX).check();

    await tapRow(page, 0);
    await tapRow(page, 1);
    expect((await readSelection(page)).selectedIds).toHaveLength(2);

    await tapRow(page, 0);
    const sel = await readSelection(page);
    expect(sel.selectedIds).toHaveLength(1);
    await expect(page.locator('#layer-list .layer-row.selected')).toHaveCount(1);
  });

  test('checked: multi-selection exposes the Link and Merge actions', async ({ page }) => {
    await setupThreeLayers(page, 'Touch Multi Actions');
    await page.locator(CHECKBOX).check();

    await tapRow(page, 0);
    await expect(page.locator('#btn-link-layers')).toBeHidden();

    await tapRow(page, 1);
    await expect(page.locator('#btn-link-layers')).toBeVisible();
    await expect(page.locator('#btn-merge-layers')).toBeVisible();
  });

  test('unchecked: tapping a layer replaces the selection (single select)', async ({ page }) => {
    await setupThreeLayers(page, 'Touch Unchecked Single');
    await page.locator(CHECKBOX).check();
    await tapRow(page, 0);
    await tapRow(page, 1);
    expect((await readSelection(page)).selectedIds).toHaveLength(2);

    await page.locator(CHECKBOX).uncheck();
    await tapRow(page, 2);

    const sel = await readSelection(page);
    expect(sel.selectedIds).toHaveLength(1);
    expect(sel.selectedIds[0]).toBe(sel.selectedId);
  });

  test('unchecking collapses an existing multi-selection to the primary layer', async ({ page }) => {
    await setupThreeLayers(page, 'Touch Uncheck Collapse');
    await page.locator(CHECKBOX).check();
    await tapRow(page, 0);
    await tapRow(page, 1);
    await tapRow(page, 2);
    expect((await readSelection(page)).selectedIds).toHaveLength(3);

    await page.locator(CHECKBOX).uncheck();

    const sel = await readSelection(page);
    expect(sel.selectedIds).toHaveLength(1);
    await expect(page.locator('#layer-list .layer-row.selected')).toHaveCount(1);
  });
});
