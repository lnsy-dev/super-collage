# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: text-layer.spec.js >> Text layer integration >> resizing text box re-renders text instead of stretching
- Location: e2e/text-layer.spec.js:125:3

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 0
Received length: 2
Received array:  ["Access to fetch at 'https://fonts.google.com/metadata/fonts' from origin 'http://localhost:3421' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.", "Failed to load resource: net::ERR_FAILED"]
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
        - generic [ref=e41]: Text Resize Test — Page 1 — Letter (8.5" × 11") @ 600dpi
        - generic [ref=e47]:
          - button "−" [ref=e48] [cursor=pointer]
          - generic [ref=e49]: 9%
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
            - generic [ref=e67]: T Text
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
                - spinbutton [ref=e98]: "1950"
                - generic [ref=e99]: "Y"
                - spinbutton [ref=e100]: "3100"
                - generic [ref=e101]: W
                - spinbutton [active] [ref=e102]: "1764"
                - generic [ref=e103]: H
                - spinbutton [ref=e104]: "396"
                - generic [ref=e105]: °
                - spinbutton [ref=e106]: "0"
              - generic [ref=e107]:
                - button "↔ H" [ref=e108] [cursor=pointer]
                - button "↕ V" [ref=e109] [cursor=pointer]
                - button "Reset" [ref=e110] [cursor=pointer]
            - generic [ref=e111]:
              - generic [ref=e112]: Text
              - textbox [ref=e114]: Hello, type-set!
              - generic [ref=e115]:
                - generic [ref=e116]: Font
                - combobox [ref=e117]:
                  - option "IBM Plex Serif" [selected]
                  - option "IBM Plex Sans"
                  - option "Crimson Text"
                  - option "Fira Code"
                  - option "League Gothic"
                  - option "Atkinson Hyperlegible"
                  - option "Cormorant Garamond"
                  - option "EB Garamond"
                  - option "Spectral"
                  - option "UnifrakturMaguntia"
              - generic [ref=e118]:
                - generic [ref=e119]: Size
                - slider [ref=e120] [cursor=pointer]: "96"
                - spinbutton [ref=e121]: "96"
              - generic [ref=e122]:
                - generic [ref=e123]: Variant
                - combobox [ref=e124]:
                  - option "100 – Thin"
                  - option "200 – ExtraLight"
                  - option "300 – Light"
                  - option "400 – Regular" [selected]
                  - option "500 – Medium"
                  - option "600 – SemiBold"
                  - option "700 – Bold"
                  - option "100 – Thin Italic"
                  - option "200 – ExtraLight Italic"
                  - option "300 – Light Italic"
                  - option "400 – Regular Italic"
                  - option "500 – Medium Italic"
                  - option "600 – SemiBold Italic"
                  - option "700 – Bold Italic"
              - generic [ref=e125]:
                - generic [ref=e126]: Space
                - spinbutton [ref=e127]: "0"
              - generic [ref=e128]:
                - generic [ref=e129]: Lead
                - spinbutton [ref=e130]: "1.2"
              - generic [ref=e131]:
                - generic [ref=e132]: Align
                - combobox [ref=e133]:
                  - option "Left" [selected]
                  - option "Center"
                  - option "Right"
                  - option "Justify"
            - generic [ref=e134]:
              - generic [ref=e135]: Riso Color
              - generic [ref=e136]:
                - button "Solid" [ref=e137] [cursor=pointer]
                - button "Gradient" [ref=e138] [cursor=pointer]
                - button "Pattern" [ref=e139] [cursor=pointer]
              - generic [ref=e140]:
                - generic "Black" [ref=e141] [cursor=pointer]
                - generic "Red" [ref=e142] [cursor=pointer]
                - generic "Neon Orange" [ref=e143] [cursor=pointer]
                - generic "Yellow" [ref=e144] [cursor=pointer]
                - generic "Neon Pink" [ref=e145] [cursor=pointer]
                - generic "Aqua" [ref=e146] [cursor=pointer]
                - generic "Blue" [ref=e147] [cursor=pointer]
            - generic [ref=e148]:
              - generic [ref=e149]: Mask
              - generic [ref=e150]:
                - button "Clear" [ref=e151] [cursor=pointer]
                - button "Invert" [ref=e152] [cursor=pointer]
                - button "Fill" [ref=e153] [cursor=pointer]
    - generic [ref=e154]:
      - generic [ref=e155]:
        - text: "Tool:"
        - strong [ref=e156]: Select
      - generic [ref=e157]:
        - text: "Layer:"
        - strong [ref=e158]: Text
      - generic [ref=e159]:
        - text: "Pos:"
        - strong [ref=e160]: 3714, 3298
      - generic [ref=e161]:
        - text: "Zoom:"
        - strong [ref=e162]: 9%
      - generic [ref=e163]: Text Resize Test
  - generic [ref=e164]:
    - text: Enjoying Super Collage?
    - link "Support me on Ko-fi" [ref=e165] [cursor=pointer]:
      - /url: https://ko-fi.com/lnsy47369
```

# Test source

```ts
  119 |       return { opaque, transparent };
  120 |     });
  121 |     expect(pixelStats.opaque).toBeGreaterThan(0);
  122 |     expect(pixelStats.transparent).toBeGreaterThan(0);
  123 |   });
  124 | 
  125 |   test('resizing text box re-renders text instead of stretching', async ({ page }) => {
  126 |     const errors = [];
  127 |     page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  128 |     page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  129 | 
  130 |     await page.goto('/');
  131 | 
  132 |     // Create a project
  133 |     await page.fill('#create-project-name', 'Text Resize Test');
  134 |     await page.click('#btn-create-next'); // Units -> Page Size
  135 |     await page.click('#btn-create-next'); // Page Size -> Pages
  136 |     await page.click('#btn-create-next'); // Pages -> Create
  137 |     await expect(page.locator('#main-app')).toBeVisible();
  138 | 
  139 |     await page.click('[data-menu="file"]');
  140 |     await page.click('[data-action="add-text"]');
  141 |     const editor = page.locator('.text-editor-input');
  142 |     await expect(editor).toBeVisible();
  143 |     await editor.fill('Hello, type-set!');
  144 |     await page.keyboard.press('Escape');
  145 | 
  146 |     // Wait for the layer to render
  147 |     await expect(page.locator('.layer-row .layer-name').filter({ hasText: /^T Text/ })).toBeVisible();
  148 |     await page.waitForFunction(() => {
  149 |       const layer = window.State.layers.find(l => l.isText);
  150 |       return !!layer?._processedCanvas;
  151 |     }, { timeout: 10000 });
  152 | 
  153 |     // Resize the text box via the W property input
  154 |     await page.fill('#prop-w', '600');
  155 |     await page.keyboard.press('Enter');
  156 | 
  157 |     // Wait for re-render and verify dimensions match the new box size
  158 |     await page.waitForFunction(() => {
  159 |       const layer = window.State.layers.find(l => l.isText);
  160 |       return layer && layer._processedCanvas && layer._processedCanvas.width === Math.round(layer.width * 2);
  161 |     }, { timeout: 10000 });
  162 | 
  163 |     const dims = await page.evaluate(() => {
  164 |       const layer = window.State.layers.find(l => l.isText);
  165 |       return {
  166 |         width: layer.width,
  167 |         height: layer.height,
  168 |         naturalWidth: layer.naturalWidth,
  169 |         naturalHeight: layer.naturalHeight,
  170 |         processedWidth: layer._processedCanvas.width,
  171 |         processedHeight: layer._processedCanvas.height,
  172 |       };
  173 |     });
  174 |     expect(dims.width).toBe(600);
  175 |     expect(dims.naturalWidth).toBe(600);
  176 |     expect(dims.processedWidth).toBe(Math.round(dims.width * 2));
  177 |     expect(dims.processedHeight).toBe(Math.round(dims.height * 2));
  178 | 
  179 |     // Also resize by dragging the right-middle handle
  180 |     const canvasBox = await page.locator('#interaction-overlay').boundingBox();
  181 |     if (!canvasBox) throw new Error('Canvas not found');
  182 | 
  183 |     const startHandle = await page.evaluate(() => {
  184 |       const layer = window.State.layers.find(l => l.isText);
  185 |       const h = window.Renderer.getHandles(layer, window.State.zoom).find(h => h.id === 'mr');
  186 |       return h;
  187 |     });
  188 | 
  189 |     const startX = canvasBox.x + startHandle.x;
  190 |     const startY = canvasBox.y + startHandle.y;
  191 |     const endX = startX + 100;
  192 | 
  193 |     await page.mouse.move(startX, startY);
  194 |     await page.mouse.down();
  195 |     await page.mouse.move(endX, startY, { steps: 5 });
  196 |     await page.mouse.up();
  197 | 
  198 |     // Wait for re-render after handle resize
  199 |     await page.waitForFunction(() => {
  200 |       const layer = window.State.layers.find(l => l.isText);
  201 |       return layer && layer._processedCanvas && layer._processedCanvas.width === Math.round(layer.width * 2);
  202 |     }, { timeout: 10000 });
  203 | 
  204 |     const handleDims = await page.evaluate(() => {
  205 |       const layer = window.State.layers.find(l => l.isText);
  206 |       return {
  207 |         width: layer.width,
  208 |         naturalWidth: layer.naturalWidth,
  209 |         processedWidth: layer._processedCanvas.width,
  210 |       };
  211 |     });
  212 |     expect(handleDims.width).toBeGreaterThan(600);
  213 |     expect(handleDims.naturalWidth).toBe(handleDims.width);
  214 |     expect(handleDims.processedWidth).toBe(Math.round(handleDims.width * 2));
  215 | 
  216 |     if (errors.length) {
  217 |       errors.forEach(err => console.log('CONSOLE ERROR:', err));
  218 |     }
> 219 |     expect(errors).toHaveLength(0);
      |                    ^ Error: expect(received).toHaveLength(expected)
  220 |   });
  221 | 
  222 |   test('export processLayer returns 1x canvas sized to layer dimensions', async ({ page }) => {
  223 |     await page.goto('/');
  224 |     await page.fill('#create-project-name', 'Text Export Size Test');
  225 |     await page.click('#btn-create-next'); // Units -> Page Size
  226 |     await page.click('#btn-create-next'); // Page Size -> Pages
  227 |     await page.click('#btn-create-next'); // Pages -> Create
  228 |     await expect(page.locator('#main-app')).toBeVisible();
  229 | 
  230 |     await page.click('[data-menu="file"]');
  231 |     await page.click('[data-action="add-text"]');
  232 |     const editor = page.locator('.text-editor-input');
  233 |     await expect(editor).toBeVisible();
  234 |     await editor.fill('Export size test');
  235 |     await page.keyboard.press('Escape');
  236 | 
  237 |     await page.waitForFunction(() => {
  238 |       const layer = window.State.layers.find(l => l.isText);
  239 |       return !!layer?._processedCanvas;
  240 |     }, { timeout: 10000 });
  241 | 
  242 |     // Simulate what the export engine does: call processLayer with forExport=true
  243 |     const result = await page.evaluate(async () => {
  244 |       const layer = window.State.layers.find(l => l.isText);
  245 |       const exportCanvas = await window.ImageProcessor.processLayer(layer, { forExport: true });
  246 |       return {
  247 |         layerWidth: layer.width,
  248 |         layerHeight: layer.height,
  249 |         exportWidth: exportCanvas?.width,
  250 |         exportHeight: exportCanvas?.height,
  251 |         // Display canvas is 2x supersampled
  252 |         displayWidth: layer._processedCanvas?.width,
  253 |         displayHeight: layer._processedCanvas?.height,
  254 |       };
  255 |     });
  256 | 
  257 |     // Export canvas must be 1x (layer.width × layer.height)
  258 |     expect(result.exportWidth).toBe(result.layerWidth);
  259 |     expect(result.exportHeight).toBe(result.layerHeight);
  260 |     // Display canvas must be 2x
  261 |     expect(result.displayWidth).toBe(Math.round(result.layerWidth * 2));
  262 |     expect(result.displayHeight).toBe(Math.round(result.layerHeight * 2));
  263 |   });
  264 | 
  265 |   test('variant dropdown lists weight/style combinations and updates layer', async ({ page }) => {
  266 |     const errors = [];
  267 |     page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  268 |     await page.goto('/');
  269 |     await page.fill('#create-project-name', 'Text Variant Test');
  270 |     await page.click('#btn-create-next'); // Units -> Page Size
  271 |     await page.click('#btn-create-next'); // Page Size -> Pages
  272 |     await page.click('#btn-create-next'); // Pages -> Create
  273 |     await expect(page.locator('#main-app')).toBeVisible();
  274 | 
  275 |     await page.click('[data-menu="file"]');
  276 |     await page.click('[data-action="add-text"]');
  277 |     const editor = page.locator('.text-editor-input');
  278 |     await expect(editor).toBeVisible();
  279 |     await editor.fill('Hello, variant!');
  280 |     await page.keyboard.press('Escape');
  281 | 
  282 |     await page.waitForFunction(() => {
  283 |       const layer = window.State.layers.find(l => l.isText);
  284 |       return !!layer?._processedCanvas;
  285 |     }, { timeout: 10000 });
  286 | 
  287 |     // Default font (IBM Plex Serif) has italic, so variant list should include italic combos.
  288 |     const variantSelect = page.locator('#prop-text-variant');
  289 |     await expect(variantSelect).toBeVisible();
  290 |     await expect(variantSelect).toHaveValue('400:normal');
  291 | 
  292 |     const serifOptions = await variantSelect.evaluate(sel => [...sel.options].map(o => o.value));
  293 |     expect(serifOptions).toContain('400:italic');
  294 |     expect(serifOptions).toContain('700:normal');
  295 | 
  296 |     // Helper: checksum of rendered text pixels to detect actual visual changes.
  297 |     const pixelChecksum = async () => page.evaluate(() => {
  298 |       const layer = window.State.layers.find(l => l.isText);
  299 |       const ctx = layer._processedCanvas.getContext('2d');
  300 |       const { width, height } = layer._processedCanvas;
  301 |       const d = ctx.getImageData(0, 0, width, height).data;
  302 |       let h = 2166136261;
  303 |       for (let i = 3; i < d.length; i += 4) {
  304 |         h ^= d[i];
  305 |         h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  306 |       }
  307 |       return h >>> 0;
  308 |     });
  309 | 
  310 |     const normalChecksum = await pixelChecksum();
  311 | 
  312 |     // Select an italic variant and verify layer weight/style and re-render.
  313 |     await variantSelect.selectOption('400:italic');
  314 |     await expect(async () => {
  315 |       const props = await page.evaluate(() => {
  316 |         const layer = window.State.layers.find(l => l.isText);
  317 |         return { weight: layer?.textFontWeight, style: layer?.textFontStyle };
  318 |       });
  319 |       expect(props).toEqual({ weight: 400, style: 'italic' });
```