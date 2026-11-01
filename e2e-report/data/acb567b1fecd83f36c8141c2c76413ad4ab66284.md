# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: color-separation.spec.js >> Color Separation Calibration >> oversized separation source survives reload without cropping
- Location: e2e/color-separation.spec.js:293:3

# Error details

```
Error: page.evaluate: TypeError: plate.getContext is not a function
    at eval (eval at evaluate (:370:30), <anonymous>:6:23)
    at UtilityScript.evaluate (<anonymous>:372:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e2]:
    - generic [ref=f1e3]:
      - generic [ref=f1e4]: ▨ SC
      - generic [ref=f1e5] [cursor=pointer]: File
      - generic [ref=f1e6] [cursor=pointer]: Edit
      - generic [ref=f1e7] [cursor=pointer]: View
      - generic [ref=f1e8] [cursor=pointer]: Layer
      - generic [ref=f1e9] [cursor=pointer]: Colors
    - generic [ref=f1e10]:
      - generic [ref=f1e12]:
        - button "Select (V)" [ref=f1e13] [cursor=pointer]
        - button "Mask Paint (B)" [ref=f1e17] [cursor=pointer]
        - button "Mask Erase (E)" [ref=f1e20] [cursor=pointer]
        - generic [ref=f1e22]: Brush
        - button "● 30" [ref=f1e23] [cursor=pointer]:
          - generic [ref=f1e24]: ●
          - generic [ref=f1e25]: "30"
        - button "Color Layer — fill bucket (G)" [ref=f1e27] [cursor=pointer]
        - button "Eyedropper — pick ink from the page (I)" [ref=f1e33] [cursor=pointer]
        - button "Type — paragraph box (T)" [ref=f1e39] [cursor=pointer]
        - button "Type on a line (Shift+T)" [ref=f1e43] [cursor=pointer]
        - button "▭" [ref=f1e47] [cursor=pointer]
        - button "◯" [ref=f1e48] [cursor=pointer]
        - button "⬠" [ref=f1e49] [cursor=pointer]
        - button "Zoom (Z) — click to zoom in, Shift+click to zoom out" [ref=f1e51] [cursor=pointer]
      - generic [ref=f1e56]:
        - generic [ref=f1e57]:
          - generic [ref=f1e58] [cursor=pointer]
          - generic [ref=f1e59]: Sep Reload Crop Test — Page 1 — Half Letter (5.5" × 8.5") @ 600dpi
        - generic [ref=f1e65]:
          - button "−" [ref=f1e66] [cursor=pointer]
          - generic [ref=f1e67]: 11%
          - button "+" [ref=f1e68] [cursor=pointer]
          - button "Fit" [ref=f1e69] [cursor=pointer]
          - button "1:1" [ref=f1e70] [cursor=pointer]
          - button "▯" [ref=f1e72] [cursor=pointer]
          - button "▭" [ref=f1e73] [cursor=pointer]
          - button "↶" [ref=f1e75] [cursor=pointer]
          - button "↷" [ref=f1e76] [cursor=pointer]
      - generic [ref=f1e77]:
        - generic [ref=f1e79]:
          - generic [ref=f1e81] [cursor=pointer]:
            - generic [ref=f1e82]: ◉
            - generic "Lock layer" [ref=f1e83]: 🔓
            - generic [ref=f1e85]: "Sep: sep-oversized"
          - generic [ref=f1e86]:
            - button "▲" [ref=f1e87] [cursor=pointer]
            - button "▼" [ref=f1e88] [cursor=pointer]
            - button "⊕" [ref=f1e89] [cursor=pointer]
            - button "Split" [ref=f1e90] [cursor=pointer]
            - button "Flatten" [ref=f1e91] [cursor=pointer]
            - button "Outline" [ref=f1e92] [cursor=pointer]
            - button "✕" [ref=f1e93] [cursor=pointer]
        - generic [ref=f1e94]:
          - generic [ref=f1e95]: Pages
          - generic [ref=f1e97]:
            - generic [ref=f1e98]: Page 1
            - generic [ref=f1e102]:
              - button "▲" [ref=f1e103] [cursor=pointer]
              - button "▼" [ref=f1e104] [cursor=pointer]
              - button "+" [ref=f1e105] [cursor=pointer]
              - button "−" [disabled] [ref=f1e106] [cursor=pointer]
        - generic [ref=f1e107]:
          - generic [ref=f1e108]: Properties
          - generic [ref=f1e112]:
            - generic [ref=f1e113]:
              - generic [ref=f1e114]: Transform
              - generic [ref=f1e115]:
                - generic [ref=f1e116]: X
                - spinbutton [ref=f1e117]: "650"
                - generic [ref=f1e118]: "Y"
                - spinbutton [ref=f1e119]: "1050"
                - generic [ref=f1e120]: W
                - spinbutton [ref=f1e121]: "2000"
                - generic [ref=f1e122]: H
                - spinbutton [ref=f1e123]: "3000"
                - generic [ref=f1e124]: °
                - spinbutton [ref=f1e125]: "0"
              - generic [ref=f1e126]:
                - button "↔ H" [ref=f1e127] [cursor=pointer]
                - button "↕ V" [ref=f1e128] [cursor=pointer]
                - button "Reset" [ref=f1e129] [cursor=pointer]
            - generic [ref=f1e130]:
              - generic [ref=f1e131]: Image
              - generic [ref=f1e132]:
                - generic [ref=f1e133]: Bright
                - slider [ref=f1e134] [cursor=pointer]: "0"
                - generic [ref=f1e135]: "0"
              - generic [ref=f1e136]:
                - generic [ref=f1e137]: Contrast
                - slider [ref=f1e138] [cursor=pointer]: "0"
                - generic [ref=f1e139]: "0"
              - button "Invert" [ref=f1e141] [cursor=pointer]
            - generic [ref=f1e142]:
              - generic [ref=f1e143]: Halftone
              - generic [ref=f1e145]:
                - button "None" [ref=f1e146] [cursor=pointer]
                - button "Gray" [ref=f1e147] [cursor=pointer]
                - button "Screen" [ref=f1e148] [cursor=pointer]
                - button "E-Dither" [ref=f1e149] [cursor=pointer]
                - button "Dither" [ref=f1e150] [cursor=pointer]
                - button "Dots" [ref=f1e151] [cursor=pointer]
                - button "Grunge" [ref=f1e152] [cursor=pointer]
            - generic [ref=f1e153]:
              - generic [ref=f1e154]: Mask
              - generic [ref=f1e155]:
                - button "Clear" [ref=f1e156] [cursor=pointer]
                - button "Invert" [ref=f1e157] [cursor=pointer]
                - button "Fill" [ref=f1e158] [cursor=pointer]
    - generic [ref=f1e159]:
      - generic [ref=f1e160]:
        - text: "Tool:"
        - strong [ref=f1e161]: Select
      - generic [ref=f1e162]:
        - text: "Layer:"
        - strong [ref=f1e163]: "Sep: sep-oversized"
      - generic [ref=f1e164]:
        - text: "Pos:"
        - strong [ref=f1e165]: —
      - generic [ref=f1e166]:
        - text: "Zoom:"
        - strong [ref=f1e167]: 11%
      - generic [ref=f1e168]: Sep Reload Crop Test
  - generic [ref=f1e169]:
    - text: Enjoying Super Collage?
    - link "Support me on Ko-fi" [ref=f1e170] [cursor=pointer]:
      - /url: https://ko-fi.com/lnsy47369
```