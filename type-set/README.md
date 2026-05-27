# type-set

A canvas-based typography editor delivered as a single custom HTML element. Render beautiful type with per-glyph control, load custom fonts, and export to SVG or high-DPI PNG — all without leaving the browser.

**Demo & Repo:** [https://github.com/lnsy-dev/type-set](https://github.com/lnsy-dev/type-set)

---

## What it does

`type-set` is a self-contained `<type-set>` web component that gives you fine-grained control over text rendering on a canvas. It uses [opentype.js](https://opentype.js.org/) for real glyph shaping, so kerning, ligatures, and per-character adjustments work with actual font data rather than browser heuristics.

### Highlights

- **Canvas-based rendering** – precise, pixel-perfect text layout you can manipulate programmatically
- **Per-character styling** – select text and adjust weight, spacing, or italic independently for individual characters
- **Custom fonts** – load any TTF or WOFF file via a single attribute, or specify per-weight font files
- **Rich typography** – kerning, ligatures, auto-hyphenation, and configurable line height
- **Export** – download your typesetting as vector SVG or PNG at up to 600 DPI
- **Zero framework dependencies** – works in any HTML page or modern framework

---

## Installation

```bash
npm install type-set
```

Then import it in your app:

```js
import 'type-set';
```

Or load it directly from a CDN:

```html
<script type="module" src="https://unpkg.com/type-set/dist/main.min.js"></script>
```

---

## Basic Usage

```html
<type-set
  font-family="IBM Plex Serif"
  font-size="64"
  font-weight="400"
  color="#0a5c0a"
  line-height="1.2"
  text-align="left"
>
  The quick brown fox jumps over the lazy dog.
</type-set>
```

### Attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `font-family` | `IBM Plex Serif` | Font family name. Built-ins: `IBM Plex Serif`, `IBM Plex Sans`, `Crimson Text`, `Fira Code`. |
| `font-size` | `48` | Font size in pixels. |
| `font-weight` | `400` | Global font weight. |
| `font-style` | `normal` | Global font style (`normal` or `italic`). |
| `letter-spacing` | `0` | Global letter spacing in pixels. |
| `line-height` | `1.2` | Line height multiplier. |
| `color` | `#0a5c0a` | Text color (any CSS color). |
| `text-align` | `left` | Alignment: `left`, `right`, `center`, `justify`. |
| `font-base` | `./fonts/` | Base path for built-in font files. |
| `font` | — | URL to a single custom font file (TTF/WOFF) used for all weights. |
| `font-100` … `font-900` | — | URL to a custom font for a specific weight. |
| `font-100-italic` … `font-900-italic` | — | URL to a custom italic font for a specific weight. |

### Custom Fonts

Load a single font for everything:

```html
<type-set font="/fonts/my-font.woff"></type-set>
```

Load different files per weight:

```html
<type-set
  font-300="/fonts/light.woff"
  font-400="/fonts/regular.woff"
  font-700="/fonts/bold.woff"
  font-700-italic="/fonts/bold-italic.woff"
></type-set>
```

Use a catch-all fallback with specific overrides:

```html
<type-set
  font="/fonts/regular.woff"
  font-900="/fonts/black.woff"
></type-set>
```

When using custom fonts, you can also set `font-family` to a custom name so canvas rendering and CSS FontFace registration use it:

```html
<type-set
  font-family="MyBrand"
  font="/fonts/mybrand.woff"
></type-set>
```

### Programmatic Control

Access the element in JavaScript to change text, toggle features, or export:

```js
const editor = document.querySelector('type-set');

// Change text
editor.text = 'Hello, custom typography!';

// Toggle features
editor.setLigatures(false);
editor.setKerning(true);
editor.setHyphenation(true);

// Apply weight to selected text
editor.setWeight(700);

// Toggle italic for selection
editor.toggleItalic();

// Adjust spacing for selection (or globally if nothing selected)
editor.setSpacing(2);

// Export
await editor.downloadSVG('my-text.svg');
await editor.downloadPNG('my-text.png', 600); // 600 DPI
```

### Events

Listen for text changes:

```js
editor.addEventListener('typeset-change', (e) => {
  console.log('Text changed:', e.detail.text);
});
```

---

## Development

Clone the repo and install dependencies:

```bash
git clone https://github.com/lnsy-dev/type-set.git
cd type-set
npm install
```

Start the dev server:

```bash
npm start
```

Build for production:

```bash
npm run build
```

This outputs `dist/main.min.js` and copies font assets to `dist/fonts/`.

### Environment Variables

Create a `.env` file to customize the build:

```env
# Output filename (default: main.min.js)
OUTPUT_FILE_NAME=type-set.min.js

# Dev server port (default: 3008)
PORT=8080

# Extract CSS to a separate file instead of injecting it
SEPARATE_CSS=true
```

---

## Publishing

The package is pre-configured for npm. Update metadata in `package.json` if needed, then:

```bash
npm version patch   # or minor / major
npm publish
```

The `prepublishOnly` script automatically runs the production build before publishing.

---

## Built-in Fonts

The package ships with four open-source font families via [@fontsource](https://fontsource.org/):

- **IBM Plex Serif**
- **IBM Plex Sans**
- **Crimson Text**
- **Fira Code**

These are bundled in `dist/fonts/` and loaded on demand based on the weights used in your text.

---

## Project Structure

```
├── src/
│   ├── type-set.js      # The <type-set> custom element
│   ├── type-engine.js   # Font loading, shaping, layout, export
│   └── hyphenate.js     # Auto-hyphenation wrapper
├── dist/                # Built output (JS bundle + fonts)
├── assets/fonts/        # Source font files
├── index.html           # Demo page
├── index.js             # Entry point
└── webpack.config.js
```

---

## License

Unlicense — public domain. Use it however you like.
