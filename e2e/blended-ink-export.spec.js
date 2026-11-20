import { test, expect } from '@playwright/test';
import {
  clearIndexedDB, createProject, addSolidColorImage,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await clearIndexedDB(page);
});

test.describe('Blended ink export', () => {
  test('exports a two-ink blended layer as the component inks at mix grayscale', async ({ page }) => {
    await createProject(page, 'Blended Export', { pageSize: 'half-letter' });
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async () => {
      const { ExportEngine } = await import('/src/app/export-engine.js');
      const { mixInks } = await import('/src/app/color-layer.js');
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');

      // Blend Aqua (60%) and Yellow (40%) into a single mixed ink.
      const mix = {
        '#5ec8e5': 60, // Aqua
        '#ffe800': 40, // Yellow
      };
      const color = mixInks([
        { hex: '#5ec8e5', amount: 60 },
        { hex: '#ffe800', amount: 40 },
      ]);

      const layer = State.layers[0];
      layer.color = color;
      layer.colorMode = 'solid';
      layer.mixedInks = mix;
      layer._dirty = true;

      const plates = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);
      const colors = [...plates.keys()].map(c => c.toUpperCase()).sort();

      const stats = {};
      for (const [hex, canvas] of plates.entries()) {
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const g = data[i]; // R=G=B
          if (g < 250) { sum += g; count++; }
        }
        stats[hex.toUpperCase()] = {
          avgGrey: count ? sum / count : 255,
          count,
        };
      }

      // Re-render to confirm stability: mixed hex must not appear as a plate.
      return {
        color,
        colors,
        hasMixedPlate: colors.includes(color.toUpperCase()),
        hasAqua: colors.includes('#5EC8E5'),
        hasYellow: colors.includes('#FFE800'),
        aquaAvg: stats['#5EC8E5']?.avgGrey ?? null,
        yellowAvg: stats['#FFE800']?.avgGrey ?? null,
      };
    });

    // Must export as the two component inks, not as a single blended plate.
    expect(result.hasMixedPlate).toBe(false);
    expect(result.hasAqua).toBe(true);
    expect(result.hasYellow).toBe(true);
    expect(result.colors).toEqual(['#5EC8E5', '#FFE800']);

    // A fully inked area: plate grey = 255 - alpha*weight. weight 0.6 -> ~102,
    // weight 0.4 -> ~153 (lower grey = denser ink).
    expect(result.aquaAvg).not.toBeNull();
    expect(result.yellowAvg).not.toBeNull();
    expect(result.aquaAvg).toBeGreaterThan(70);
    expect(result.aquaAvg).toBeLessThan(140);
    expect(result.yellowAvg).toBeGreaterThan(120);
    expect(result.yellowAvg).toBeLessThan(190);
    // Aqua (60%) must print denser than Yellow (40%).
    expect(result.aquaAvg).toBeLessThan(result.yellowAvg - 20);
  });

  test('exports different blend ratios with proportionate grayscale values', async ({ page }) => {
    await createProject(page, 'Blend Ratios', { pageSize: 'half-letter' });
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async () => {
      const { ExportEngine } = await import('/src/app/export-engine.js');
      const { mixInks } = await import('/src/app/color-layer.js');
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');

      const run = async (amounts) => {
        const color = mixInks([
          { hex: '#0078bf', amount: amounts[0] }, // Medium Blue
          { hex: '#f65058', amount: amounts[1] }, // Fluorescent Pink
        ]);
        const layer = State.layers[0];
        layer.color = color;
        layer.colorMode = 'solid';
        layer.mixedInks = { '#0078bf': amounts[0], '#f65058': amounts[1] };
        layer._dirty = true;
        const plates = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);
        const avg = hex => {
          const canvas = plates.get(hex) || plates.get(hex.toUpperCase()) || plates.get(hex.toLowerCase());
          if (!canvas) return null;
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let sum = 0, count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] < 250) { sum += data[i]; count++; }
          }
          return count ? sum / count : 255;
        };
        return {
          blue: avg('#0078bf'),
          pink: avg('#f65058'),
          plateCount: plates.size,
        };
      };

      return {
        heavyBlue: await run([80, 20]),
        even: await run([50, 50]),
      };
    });

    expect(result.heavyBlue.plateCount).toBe(2);
    expect(result.even.plateCount).toBe(2);
    // Heavier blue coverage => denser blue plate (lower grey) than pink.
    expect(result.heavyBlue.blue).toBeLessThan(result.heavyBlue.pink - 30);
    // Even mix => similar densities.
    expect(Math.abs(result.even.blue - result.even.pink)).toBeLessThan(35);
  });

  test('a pure single-ink layer still exports as one solid plate', async ({ page }) => {
    await createProject(page, 'Pure Ink Export', { pageSize: 'half-letter' });
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async () => {
      const { ExportEngine } = await import('/src/app/export-engine.js');
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');
      const layer = State.layers[0];
      layer.color = '#0078bf';
      layer.colorMode = 'solid';
      layer._dirty = true;
      const plates = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);
      return {
        colors: [...plates.keys()].map(c => c.toUpperCase()),
      };
    });

    expect(result.colors).toEqual(['#0078BF']);
  });

  test('a blended-color layer without explicit mixedInks is decomposed into component plates', async ({ page }) => {
    await createProject(page, 'Blended Auto Detect', { pageSize: 'half-letter' });
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async () => {
      const { ExportEngine } = await import('/src/app/export-engine.js');
      const { mixInks } = await import('/src/app/color-layer.js');
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');

      // A color produced by mixing palette inks, with no explicit recipe stored.
      const color = mixInks([
        { hex: '#5ec8e5', amount: 60 }, // Aqua
        { hex: '#ffe800', amount: 40 }, // Yellow
      ]);

      const layer = State.layers[0];
      layer.color = color;
      layer.colorMode = 'solid';
      delete layer.mixedInks; // force color-only detection
      layer._dirty = true;

      const plates = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);
      const avg = hex => {
        const canvas = plates.get(hex) || plates.get(hex.toUpperCase()) || plates.get(hex.toLowerCase());
        if (!canvas) return null;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] < 250) { sum += data[i]; count++; }
        }
        return count ? sum / count : 255;
      };
      const colors = [...plates.keys()].map(c => c.toUpperCase()).sort();

      return {
        colors,
        hasMixedPlate: colors.includes(color.toUpperCase()),
        aquaAvg: avg('#5ec8e5'),
        yellowAvg: avg('#ffe800'),
      };
    });

    expect(result.hasMixedPlate).toBe(false);
    expect(result.colors.length).toBeGreaterThanOrEqual(2);
    expect(result.colors).toContain('#5EC8E5');
    expect(result.colors).toContain('#FFE800');
    expect(result.aquaAvg).not.toBeNull();
    expect(result.yellowAvg).not.toBeNull();
    expect(result.aquaAvg).toBeLessThan(result.yellowAvg - 20);
  });

  test('blended export ignores zero-coverage inks and keeps ink order irrelevant', async ({ page }) => {
    await createProject(page, 'Blended Normalize', { pageSize: 'half-letter' });
    await addSolidColorImage(page, '#000000', { width: 800, height: 800 });

    const result = await page.evaluate(async () => {
      const { ExportEngine } = await import('/src/app/export-engine.js');
      const { mixInks } = await import('/src/app/color-layer.js');
      const { CANVAS_W, CANVAS_H } = await import('/src/app/constants.js');

      const mix = { '#ffe800': 40, '#5ec8e5': 60, '#0078bf': 0 };
      const color = mixInks([
        { hex: '#5ec8e5', amount: 60 },
        { hex: '#ffe800', amount: 40 },
      ]);

      const layer = State.layers[0];
      layer.color = color;
      layer.colorMode = 'solid';
      layer.mixedInks = mix;
      layer._dirty = true;

      const plates = await ExportEngine.exportLayers(State.layers, CANVAS_W, CANVAS_H);
      return { colors: [...plates.keys()].map(c => c.toUpperCase()).sort() };
    });

    expect(result.colors).toEqual(['#5EC8E5', '#FFE800']);
  });
});
