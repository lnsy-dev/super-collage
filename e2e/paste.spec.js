import { test, expect } from '@playwright/test';
import { clearIndexedDB, gotoApp, createProject } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Image Paste', () => {
  test('paste image from clipboard', async ({ page }) => {
    await createProject(page, 'Paste Test');

    await page.evaluate(async () => {
      // Build a 2×2 red PNG inline
      const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAABZJREFUeNpi2r9//38gYGAEESAAEGAAasgJOgzOKCoAAAAASUVORK5CYII=';
      const blob = await fetch(pngDataUrl).then(r => r.blob());
      const file = new File([blob], 'pasted-image.png', { type: 'image/png' });
      let dt;
      try {
        dt = new DataTransfer();
        dt.items.add(file);
      } catch {
        dt = { items: [{ kind: 'file', type: file.type, getAsFile: () => file }], files: [file] };
      }
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      try { Object.defineProperty(ev, 'clipboardData', { value: dt }); } catch {}
      document.dispatchEvent(ev);
    });

    await expect(page.locator('#layer-list .layer-row')).toHaveCount(1);
    await expect(page.locator('#layer-list .layer-name')).toContainText('Pasted Image');
  });
});
