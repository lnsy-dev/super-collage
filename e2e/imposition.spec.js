import { test, expect } from '@playwright/test';
import { clearIndexedDB, gotoApp, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

function makePageCanvas(width, height, color, label) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.font = `${Math.floor(height / 4)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(label), width / 2, height / 2);
  return canvas;
}

test.describe('Imposition', () => {
  test('folio saddle-stitch order for 12 pages', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { buildSheets } = await import('/src/app/imposition.js');
      const width = 3300;
      const height = 5100;
      const colors = [
        '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
        '#FF00FF', '#00FFFF', '#800000', '#008000',
        '#000080', '#808000', '#800080', '#008080',
      ];
      const pages = colors.map((c, i) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, width, height);
        return canvas;
      });

      const sheets = buildSheets(pages, {
        binding: 'saddle-stitch',
        bookletLayout: 'folio',
        targetSheetSize: 'letter',
      });

      // Return the dominant colour of the left and right halves of each sheet.
      const summaries = [];
      for (const sheet of sheets) {
        const ctx = sheet.getContext('2d');
        const left = ctx.getImageData(0, 0, Math.floor(sheet.width / 2), sheet.height).data;
        const right = ctx.getImageData(Math.floor(sheet.width / 2), 0, Math.floor(sheet.width / 2), sheet.height).data;
        const leftColor = colors.find(c => {
          const rgb = parseInt(c.slice(1), 16);
          const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
          return left[0] === r && left[1] === g && left[2] === b;
        });
        const rightColor = colors.find(c => {
          const rgb = parseInt(c.slice(1), 16);
          const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
          return right[0] === r && right[1] === g && right[2] === b;
        });
        summaries.push([colors.indexOf(leftColor) + 1, colors.indexOf(rightColor) + 1]);
      }
      return summaries;
    });

    // 12-page folio saddle-stitch, outer-to-inner:
    // [12,1], [2,11], [10,3], [4,9], [8,5], [6,7]
    expect(result).toEqual([
      [12, 1], [2, 11], [10, 3], [4, 9], [8, 5], [6, 7],
    ]);
  });

  test('quarto and octavo produce correct sheet counts', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { buildSheets } = await import('/src/app/imposition.js');
      const width = 1650;
      const height = 2550;
      const makePages = count => Array.from({ length: count }, (_, i) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = `hsl(${(i * 30) % 360}, 70%, 50%)`;
        ctx.fillRect(0, 0, width, height);
        return canvas;
      });

      const quartoSheets = buildSheets(makePages(16), {
        binding: 'saddle-stitch',
        bookletLayout: 'quarto',
        targetSheetSize: 'tabloid',
      });
      const octavoSheets = buildSheets(makePages(32), {
        binding: 'saddle-stitch',
        bookletLayout: 'octavo',
        targetSheetSize: 'tabloid',
      });

      return {
        quartoSheetCount: quartoSheets.length,
        octavoSheetCount: octavoSheets.length,
      };
    });

    expect(result.quartoSheetCount).toBe(4); // 16 pages / 8 per sheet * 2 sides = 4
    expect(result.octavoSheetCount).toBe(4); // 32 pages / 16 per sheet * 2 sides = 4
  });

  test('export dialog shows booklet layout controls', async ({ page }) => {
    await createProject(page, 'Booklet UI Test');
    await page.click('.menu-item[data-menu="file"]');
    await page.click('[data-action="export"]');
    await expect(page.locator('#export-dialog')).toBeVisible();

    // Booklet layout row is always visible now that only saddle-stitch is supported.
    await expect(page.locator('#export-booklet-layout-row')).toBeVisible();
    await expect(page.locator('#export-layout-info')).toContainText('folio');

    await page.locator('input[name="export-booklet-layout"][value="quarto"]').click();
    await expect(page.locator('#export-layout-info')).toContainText('quarto');
  });
});
