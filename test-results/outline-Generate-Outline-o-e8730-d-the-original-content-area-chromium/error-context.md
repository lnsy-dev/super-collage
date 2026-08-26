# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: outline.spec.js >> Generate Outline >> outline renders as a border around the original content area
- Location: e2e/outline.spec.js:45:3

# Error details

```
Error: expect(received).toBeLessThan(expected)

Matcher error: received value must be a number or bigint

Received has value: undefined
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e4]: ▨ SC
      - generic [ref=e5] [cursor=pointer]: File
      - generic [ref=e6] [cursor=pointer]: Edit
      - generic [ref=e7] [cursor=pointer]: View
      - generic [ref=e8] [cursor=pointer]: Layer
      - generic [ref=e9] [cursor=pointer]: Colors
    - generic [ref=e10]:
      - generic [ref=e12]:
        - button "Select (V)" [ref=e13] [cursor=pointer]:
          - img [ref=e14]
        - button "Mask Paint (B)" [ref=e17] [cursor=pointer]:
          - img [ref=e18]
        - button "Mask Erase (E)" [ref=e20] [cursor=pointer]:
          - img [ref=e21]
        - generic [ref=e22]: Brush
        - button "● 30" [ref=e23] [cursor=pointer]:
          - generic [ref=e24]: ●
          - generic [ref=e25]: "30"
        - button "Type — paragraph box (T)" [ref=e27] [cursor=pointer]:
          - img [ref=e28]
        - button "Type on a line (Shift+T)" [ref=e31] [cursor=pointer]:
          - img [ref=e32]
        - button "▭" [ref=e35] [cursor=pointer]
        - button "◯" [ref=e36] [cursor=pointer]
        - button "⬠" [ref=e37] [cursor=pointer]
      - generic [ref=e38]:
        - generic [ref=e41]: Outline Render Test — Page 1 — Half Letter (5.5" × 8.5") @ 600dpi
        - generic [ref=e47]:
          - button "−" [ref=e48] [cursor=pointer]
          - generic [ref=e49]: 11%
          - button "+" [ref=e50] [cursor=pointer]
          - button "Fit" [ref=e51] [cursor=pointer]
          - button "1:1" [ref=e52] [cursor=pointer]
          - button "▯" [ref=e54] [cursor=pointer]
          - button "▭" [ref=e55] [cursor=pointer]
          - button "↶" [ref=e57] [cursor=pointer]
          - button "↷" [ref=e58] [cursor=pointer]
      - generic [ref=e59]:
        - generic [ref=e61]:
          - generic [ref=e62]:
            - generic [ref=e63] [cursor=pointer]:
              - generic [ref=e64]: ◉
              - generic "Lock layer" [ref=e65]: 🔓
              - generic [ref=e67]: Outline of square
            - generic [ref=e68] [cursor=pointer]:
              - generic [ref=e69]: ◉
              - generic "Lock layer" [ref=e70]: 🔓
              - generic [ref=e72]: square
          - generic [ref=e73]:
            - button "▲" [ref=e74] [cursor=pointer]
            - button "▼" [ref=e75] [cursor=pointer]
            - button "⊕" [ref=e76] [cursor=pointer]
            - button "Flatten" [ref=e77] [cursor=pointer]
            - button "Outline" [active] [ref=e78] [cursor=pointer]
            - button "✕" [ref=e79] [cursor=pointer]
        - generic [ref=e80]:
          - generic [ref=e82]: Pages
          - generic [ref=e83]:
            - generic [ref=e87] [cursor=pointer]: Page 1
            - generic [ref=e88]:
              - button "▲" [ref=e89] [cursor=pointer]
              - button "▼" [ref=e90] [cursor=pointer]
              - button "+" [ref=e91] [cursor=pointer]
              - button "−" [disabled] [ref=e92] [cursor=pointer]
        - generic [ref=e93]:
          - generic [ref=e95]: Properties
          - generic [ref=e98]:
            - generic [ref=e99]:
              - generic [ref=e100]: Transform
              - generic [ref=e101]:
                - generic [ref=e102]: X
                - spinbutton [ref=e103]: "1550"
                - generic [ref=e104]: "Y"
                - spinbutton [ref=e105]: "2450"
                - generic [ref=e106]: W
                - spinbutton [ref=e107]: "200"
                - generic [ref=e108]: H
                - spinbutton [ref=e109]: "200"
                - generic [ref=e110]: °
                - spinbutton [ref=e111]: "0"
              - generic [ref=e112]:
                - button "↔ H" [ref=e113] [cursor=pointer]
                - button "↕ V" [ref=e114] [cursor=pointer]
                - button "Reset" [ref=e115] [cursor=pointer]
            - generic [ref=e116]:
              - generic [ref=e117]: Image
              - generic [ref=e118]:
                - generic [ref=e119]: Bright
                - slider [ref=e120] [cursor=pointer]: "0"
                - generic [ref=e121]: "0"
              - generic [ref=e122]:
                - generic [ref=e123]: Contrast
                - slider [ref=e124] [cursor=pointer]: "0"
                - generic [ref=e125]: "0"
              - button "Invert" [ref=e127] [cursor=pointer]
            - generic [ref=e128]:
              - generic [ref=e129]: Shape Attributes
              - generic [ref=e130]:
                - generic [ref=e131]:
                  - radio "Fill" [ref=e132]
                  - text: Fill
                - generic [ref=e133]:
                  - radio "Border" [checked] [ref=e134]
                  - text: Border
              - generic [ref=e135]:
                - generic [ref=e136]: Width
                - slider [ref=e137] [cursor=pointer]: "12"
                - spinbutton [ref=e138]: "12"
            - generic [ref=e139]:
              - generic [ref=e140]: Halftone
              - generic [ref=e142]:
                - button "None" [ref=e143] [cursor=pointer]
                - button "Gray" [ref=e144] [cursor=pointer]
                - button "Dither" [ref=e145] [cursor=pointer]
                - button "Dots" [ref=e146] [cursor=pointer]
                - button "Grunge" [ref=e147] [cursor=pointer]
              - generic [ref=e148]:
                - generic [ref=e149]: Size
                - slider [ref=e150] [cursor=pointer]: "8"
                - generic [ref=e151]: "8"
              - generic [ref=e152]:
                - generic [ref=e153]: Angle
                - slider [ref=e154] [cursor=pointer]: "45"
                - generic [ref=e155]: "45"
            - generic [ref=e156]:
              - generic [ref=e157]: Riso Color
              - generic [ref=e158]:
                - button "Solid" [ref=e159] [cursor=pointer]
                - button "Gradient" [ref=e160] [cursor=pointer]
                - button "Pattern" [ref=e161] [cursor=pointer]
              - generic [ref=e162]:
                - generic "Black" [ref=e163] [cursor=pointer]
                - generic "Red" [ref=e164] [cursor=pointer]
                - generic "Neon Orange" [ref=e165] [cursor=pointer]
                - generic "Yellow" [ref=e166] [cursor=pointer]
                - generic "Neon Pink" [ref=e167] [cursor=pointer]
                - generic "Aqua" [ref=e168] [cursor=pointer]
                - generic "Blue" [ref=e169] [cursor=pointer]
            - generic [ref=e170]:
              - generic [ref=e171]: Mask
              - generic [ref=e172]:
                - button "Clear" [ref=e173] [cursor=pointer]
                - button "Invert" [ref=e174] [cursor=pointer]
                - button "Fill" [ref=e175] [cursor=pointer]
    - generic [ref=e176]:
      - generic [ref=e177]:
        - text: "Tool:"
        - strong [ref=e178]: Select
      - generic [ref=e179]:
        - text: "Layer:"
        - strong [ref=e180]: Outline of square
      - generic [ref=e181]:
        - text: "Pos:"
        - strong [ref=e182]: —
      - generic [ref=e183]:
        - text: "Zoom:"
        - strong [ref=e184]: 11%
      - generic [ref=e185]: Outline Render Test
  - generic [ref=e186]:
    - text: Enjoying Super Collage?
    - link "Support me on Ko-fi" [ref=e187] [cursor=pointer]:
      - /url: https://ko-fi.com/lnsy47369
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { clearIndexedDB, createProject, addImageFromBuffer, createShapePngBuffer } from './helpers.js';
  3   | 
  4   | test.beforeEach(async ({ page }) => {
  5   |   await clearIndexedDB(page);
  6   | });
  7   | 
  8   | test.describe('Generate Outline', () => {
  9   |   test('creates an editable custom-path shape layer from an image', async ({ page }) => {
  10  |     await createProject(page, 'Outline Test');
  11  |     // 200x200 image with a 100x100 black square centered on white.
  12  |     await addImageFromBuffer(page, createShapePngBuffer('rect', 200, 200), { name: 'square.png' });
  13  | 
  14  |     await page.locator('#layer-buttons [data-action="generate-outline"]').click();
  15  |     await page.waitForFunction(() => {
  16  |       const ol = window.State.layers[1];
  17  |       return ol && !ol._dirty && ol._processedCanvas;
  18  |     });
  19  | 
  20  |     const info = await page.evaluate(() => {
  21  |       const l = window.State.layers[window.State.layers.length - 1];
  22  |       return {
  23  |         name: l.name,
  24  |         isShape: l.isShape,
  25  |         shapeType: l.shapeType,
  26  |         hasPath: Array.isArray(l.shapePath) && l.shapePath.length > 0,
  27  |         pathPts: l.shapePath?.[0]?.length || 0,
  28  |         hasFill: l.shapeHasFill,
  29  |         hasStroke: l.shapeHasStroke,
  30  |         isSelected: window.State.selectedId === l.id && window.State.selectedIds.length === 1,
  31  |       };
  32  |     });
  33  | 
  34  |     expect(info.name).toBe('Outline of square');
  35  |     expect(info.isShape).toBe(true);
  36  |     expect(info.shapeType).toBe('custom-path');
  37  |     expect(info.hasPath).toBe(true);
  38  |     // A traced square should simplify to a handful of corner points.
  39  |     expect(info.pathPts).toBeLessThanOrEqual(12);
  40  |     expect(info.hasFill).toBe(false);
  41  |     expect(info.hasStroke).toBe(true);
  42  |     expect(info.isSelected).toBe(true);
  43  |   });
  44  | 
  45  |   test('outline renders as a border around the original content area', async ({ page }) => {
  46  |     await createProject(page, 'Outline Render Test');
  47  |     await addImageFromBuffer(page, createShapePngBuffer('rect', 200, 200), { name: 'square.png' });
  48  | 
  49  |     await page.locator('#layer-buttons [data-action="generate-outline"]').click();
  50  |     await page.waitForFunction(() => {
  51  |       const ol = window.State.layers[1];
  52  |       return ol && !ol._dirty && ol._processedCanvas;
  53  |     });
  54  | 
  55  |     // Hide the source image so only the outline shape is visible.
  56  |     await page.evaluate(async () => {
  57  |       window.State.layers[0].visible = false;
  58  |       const outline = window.State.layers[1];
  59  |       outline.color = '#010101';
  60  |       outline._dirty = true;
  61  |       await window.Renderer.draw();
  62  |     });
  63  | 
  64  |     const samples = await page.evaluate(() => {
  65  |       const canvas = document.getElementById('display-canvas');
  66  |       const ctx = canvas.getContext('2d');
  67  |       const z = window.State.zoom;
  68  |       const l = window.State.layers[1];
  69  |       const cx = (l.x + l.width / 2) * z;
  70  |       const cy = (l.y + l.height / 2) * z;
  71  |       const halfW = (l.width / 4) * z; // black square spans middle half of the image
  72  |       // Darkest red-channel value in a small neighbourhood. The stroke is
  73  |       // only a couple of screen px wide at fit zoom, so a single-pixel probe
  74  |       // can land on anti-aliased fringe.
  75  |       const darkest = (x, y, r = 4) => {
  76  |         let m = 255;
  77  |         for (let dy = -r; dy <= r; dy++) {
  78  |           for (let dx = -r; dx <= r; dx++) {
  79  |             const sx = Math.round(x) + dx, sy = Math.round(y) + dy;
  80  |             if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
  81  |             const v = ctx.getImageData(sx, sy, 1, 1).data[0];
  82  |             if (v < m) m = v;
  83  |           }
  84  |         }
  85  |         return m;
  86  |       };
  87  |       return {
  88  |         edgeTop: darkest(cx, cy - halfW),
  89  |         center: darkest(cx, cy),
  90  |         outside: darkest(l.x * z - 10, l.y * z - 10),
  91  |       };
  92  |     });
  93  | 
> 94  |     expect(samples.edgeTop[0]).toBeLessThan(128);   // stroke on the square's edge
      |                                ^ Error: expect(received).toBeLessThan(expected)
  95  |     expect(samples.center[0]).toBeGreaterThan(200); // no fill inside
  96  |     expect(samples.outside[0]).toBeGreaterThan(200);
  97  |   });
  98  | 
  99  |   test('outline stroke width can be edited like other shapes', async ({ page }) => {
  100 |     await createProject(page, 'Outline Edit Test');
  101 |     await addImageFromBuffer(page, createShapePngBuffer('rect', 200, 200), { name: 'square.png' });
  102 | 
  103 |     await page.locator('#layer-buttons [data-action="generate-outline"]').click();
  104 |     await page.waitForFunction(() => {
  105 |       const ol = window.State.layers[1];
  106 |       return ol && !ol._dirty && ol._processedCanvas;
  107 |     });
  108 | 
  109 |     const numInput = page.locator('#prop-shape-stroke-width-num');
  110 |     await expect(numInput).toBeVisible();
  111 | 
  112 |     await numInput.fill('20');
  113 |     await numInput.dispatchEvent('change');
  114 | 
  115 |     const width = await page.evaluate(() => {
  116 |       return window.State.layers.find(l => l.isShape)?.shapeStrokeWidth;
  117 |     });
  118 |     expect(width).toBe(20);
  119 |   });
  120 | });
  121 | 
```