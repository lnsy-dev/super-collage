# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: undo.spec.js >> Undo / Redo >> undo removes a spawned border layer and restores selection
- Location: e2e/undo.spec.js:14:3

# Error details

```
ReferenceError: State is not defined
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
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
        - generic [ref=e41]: Undo Shape Test — Page 1 — Half Letter (5.5" × 8.5") @ 600dpi
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
          - generic [ref=e63] [cursor=pointer]:
            - generic [ref=e64]: ◉
            - generic "Lock layer" [ref=e65]: 🔓
            - generic [ref=e67]: Rectangle
          - generic [ref=e68]:
            - button "▲" [ref=e69] [cursor=pointer]
            - button "▼" [ref=e70] [cursor=pointer]
            - button "⊕" [ref=e71] [cursor=pointer]
            - button "Flatten" [ref=e72] [cursor=pointer]
            - button "Outline" [ref=e73] [cursor=pointer]
            - button "✕" [ref=e74] [cursor=pointer]
        - generic [ref=e75]:
          - generic [ref=e77]: Pages
          - generic [ref=e78]:
            - generic [ref=e82] [cursor=pointer]: Page 1
            - generic [ref=e83]:
              - button "▲" [ref=e84] [cursor=pointer]
              - button "▼" [ref=e85] [cursor=pointer]
              - button "+" [ref=e86] [cursor=pointer]
              - button "−" [disabled] [ref=e87] [cursor=pointer]
        - generic [ref=e88]:
          - generic [ref=e90]: Properties
          - generic [ref=e93]:
            - generic [ref=e94]:
              - generic [ref=e95]: Transform
              - generic [ref=e96]:
                - generic [ref=e97]: X
                - spinbutton [ref=e98]: "799"
                - generic [ref=e99]: "Y"
                - spinbutton [ref=e100]: "799"
                - generic [ref=e101]: W
                - spinbutton [ref=e102]: "899"
                - generic [ref=e103]: H
                - spinbutton [ref=e104]: "899"
                - generic [ref=e105]: °
                - spinbutton [ref=e106]: "0"
              - generic [ref=e107]:
                - button "↔ H" [ref=e108] [cursor=pointer]
                - button "↕ V" [ref=e109] [cursor=pointer]
                - button "Reset" [ref=e110] [cursor=pointer]
            - generic [ref=e111]:
              - generic [ref=e112]: Image
              - generic [ref=e113]:
                - generic [ref=e114]: Bright
                - slider [ref=e115] [cursor=pointer]: "0"
                - generic [ref=e116]: "0"
              - generic [ref=e117]:
                - generic [ref=e118]: Contrast
                - slider [ref=e119] [cursor=pointer]: "0"
                - generic [ref=e120]: "0"
              - button "Invert" [ref=e122] [cursor=pointer]
            - generic [ref=e123]:
              - generic [ref=e124]: Shape Attributes
              - generic [ref=e125]:
                - generic [ref=e126]:
                  - radio "Fill" [checked] [ref=e127]
                  - text: Fill
                - generic [ref=e128]:
                  - radio "Border" [ref=e129]
                  - text: Border
            - generic [ref=e130]:
              - generic [ref=e131]: Halftone
              - generic [ref=e133]:
                - button "None" [ref=e134] [cursor=pointer]
                - button "Gray" [ref=e135] [cursor=pointer]
                - button "Dither" [ref=e136] [cursor=pointer]
                - button "Dots" [ref=e137] [cursor=pointer]
                - button "Grunge" [ref=e138] [cursor=pointer]
              - generic [ref=e139]:
                - generic [ref=e140]: Size
                - slider [ref=e141] [cursor=pointer]: "8"
                - generic [ref=e142]: "8"
              - generic [ref=e143]:
                - generic [ref=e144]: Angle
                - slider [ref=e145] [cursor=pointer]: "45"
                - generic [ref=e146]: "45"
            - generic [ref=e147]:
              - generic [ref=e148]: Riso Color
              - generic [ref=e149]:
                - button "Solid" [ref=e150] [cursor=pointer]
                - button "Gradient" [ref=e151] [cursor=pointer]
                - button "Pattern" [ref=e152] [cursor=pointer]
              - generic [ref=e153]:
                - generic "Black" [ref=e154] [cursor=pointer]
                - generic "Red" [ref=e155] [cursor=pointer]
                - generic "Neon Orange" [ref=e156] [cursor=pointer]
                - generic "Yellow" [ref=e157] [cursor=pointer]
                - generic "Neon Pink" [ref=e158] [cursor=pointer]
                - generic "Aqua" [ref=e159] [cursor=pointer]
                - generic "Blue" [ref=e160] [cursor=pointer]
            - generic [ref=e161]:
              - generic [ref=e162]: Mask
              - generic [ref=e163]:
                - button "Clear" [ref=e164] [cursor=pointer]
                - button "Invert" [ref=e165] [cursor=pointer]
                - button "Fill" [ref=e166] [cursor=pointer]
    - generic [ref=e167]:
      - generic [ref=e168]:
        - text: "Tool:"
        - strong [ref=e169]: Select
      - generic [ref=e170]:
        - text: "Layer:"
        - strong [ref=e171]: Rectangle
      - generic [ref=e172]:
        - text: "Pos:"
        - strong [ref=e173]: 1698, 1698
      - generic [ref=e174]:
        - text: "Zoom:"
        - strong [ref=e175]: 11%
      - generic [ref=e176]: Undo Shape Test
  - generic [ref=e177]:
    - text: Enjoying Super Collage?
    - link "Support me on Ko-fi" [ref=e178] [cursor=pointer]:
      - /url: https://ko-fi.com/lnsy47369
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { clearIndexedDB, createProject, addImage, selectTool } from './helpers.js';
  3   | import path from 'path';
  4   | import { fileURLToPath } from 'url';
  5   | 
  6   | const __dirname = path.dirname(fileURLToPath(import.meta.url));
  7   | const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-image.png');
  8   | 
  9   | test.beforeEach(async ({ page }) => {
  10  |   await clearIndexedDB(page);
  11  | });
  12  | 
  13  | test.describe('Undo / Redo', () => {
  14  |   test('undo removes a spawned border layer and restores selection', async ({ page }) => {
  15  |     await createProject(page, 'Undo Shape Test');
  16  |     await selectTool(page, 'shape-rect');
  17  |     const canvas = page.locator('#interaction-overlay');
  18  |     await canvas.dragTo(canvas, { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 300, y: 300 } });
  19  | 
  20  |     // Selecting Border spawns a sibling outline layer and selects it.
  21  |     await page.check('#prop-shape-border');
  22  |     await page.waitForFunction(() => State.layers.length === 2);
  23  |     expect(await page.isChecked('#prop-shape-border')).toBe(true);
  24  | 
  25  |     // Undo should remove the spawned outline layer and restore the previous
  26  |     // single-fill-layer state. (Blur first: the checked radio holds focus,
  27  |     // and shortcuts are ignored while an input is focused.)
  28  |     await page.evaluate(() => document.activeElement?.blur());
  29  |     await page.keyboard.press('Control+z');
  30  |     await page.waitForFunction(() => State.layers.length === 1);
  31  |     const info = await page.evaluate(() => ({
  32  |       count: State.layers.length,
  33  |       hasStroke: State.layers[0].shapeHasStroke,
  34  |       selectedId: State.selectedId,
  35  |     }));
  36  |     expect(info.count).toBe(1);
  37  |     expect(info.hasStroke).toBe(false);
> 38  |     expect(info.selectedId).toBe(State.layers[0].id);
      |                                  ^ ReferenceError: State is not defined
  39  |   });
  40  | 
  41  |   test('undo restores previous rotation value', async ({ page }) => {
  42  |     await createProject(page, 'Undo Test');
  43  |     await addImage(page, TEST_IMAGE);
  44  | 
  45  |     // Change rotation using blur to trigger change event
  46  |     await page.fill('#prop-rot', '45');
  47  |     await page.locator('#prop-rot').blur();
  48  | 
  49  |     const changedRotation = await page.evaluate(() => {
  50  |       // @ts-ignore
  51  |       return State.layers[0].rotation;
  52  |     });
  53  |     expect(changedRotation).toBe(45);
  54  | 
  55  |     // Undo
  56  |     await page.keyboard.press('Control+z');
  57  | 
  58  |     const undoneRotation = await page.evaluate(() => {
  59  |       // @ts-ignore
  60  |       return State.layers[0].rotation;
  61  |     });
  62  |     expect(undoneRotation).toBe(0);
  63  |   });
  64  | 
  65  |   test('redo restores undone property value', async ({ page }) => {
  66  |     await createProject(page, 'Redo Test');
  67  |     await addImage(page, TEST_IMAGE);
  68  | 
  69  |     // Change brightness
  70  |     await page.fill('#prop-brightness', '50');
  71  |     await page.keyboard.press('Tab');
  72  | 
  73  |     const changedBrightness = await page.evaluate(() => {
  74  |       // @ts-ignore
  75  |       return State.layers[0].brightness;
  76  |     });
  77  |     expect(changedBrightness).toBe(50);
  78  | 
  79  |     // Undo
  80  |     await page.keyboard.press('Control+z');
  81  | 
  82  |     // Redo
  83  |     await page.keyboard.press('Control+Shift+z');
  84  | 
  85  |     const redoneBrightness = await page.evaluate(() => {
  86  |       // @ts-ignore
  87  |       return State.layers[0].brightness;
  88  |     });
  89  |     expect(redoneBrightness).toBe(50);
  90  |   });
  91  | 
  92  |   test('undo flip horizontal', async ({ page }) => {
  93  |     await createProject(page, 'Undo Flip Test');
  94  |     await addImage(page, TEST_IMAGE);
  95  | 
  96  |     await page.locator('#properties-content [data-action="flip-h"]').click();
  97  |     const flipped = await page.evaluate(() => {
  98  |       // @ts-ignore
  99  |       return State.layers[0].flipH;
  100 |     });
  101 |     expect(flipped).toBe(true);
  102 | 
  103 |     await page.keyboard.press('Control+z');
  104 | 
  105 |     const undone = await page.evaluate(() => {
  106 |       // @ts-ignore
  107 |       return State.layers[0].flipH;
  108 |     });
  109 |     expect(undone).toBe(false);
  110 |   });
  111 | });
  112 | 
```