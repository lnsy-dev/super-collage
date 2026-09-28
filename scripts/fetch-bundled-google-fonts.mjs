/* Download the bundled Google Fonts faces and regenerate their metadata.
 *
 * Every family in the app's font list has to be a real font *file*: text is
 * shaped by opentype.js, which reads the binary itself — there is no CSS
 * font stack to fall back on. So a curated selection of Google Fonts is
 * vendored into vendor/type-set/fonts/ as latin-subset .woff (a WOFF
 * container around the same TrueType outlines Google ships), one file per
 * weight/style, plus each family's licence.
 *
 *   node scripts/fetch-bundled-google-fonts.mjs            # download + regenerate metadata
 *   node scripts/fetch-bundled-google-fonts.mjs --dry-run  # only report what is missing
 *
 * Regenerates:
 *   vendor/type-set/fonts/bundled-google-fonts.json  provenance manifest
 *   vendor/type-set/src/bundled-google-fonts.js      FONT_FILES / FONT_WEIGHTS tables
 *
 * The generated module is merged into the hand-maintained font-data.js, so
 * adding a family here is enough — no second place to update by hand.
 */

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as opentype from '../vendor/opentype.js/dist/opentype.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = join(ROOT, 'vendor/type-set/fonts');
const MANIFEST = join(FONT_DIR, 'bundled-google-fonts.json');
const GENERATED = join(ROOT, 'vendor/type-set/src/bundled-google-fonts.js');

/** @fontsource packages, served by jsDelivr. */
const CDN = 'https://cdn.jsdelivr.net/npm/@fontsource';
/** @fontsource version used for every family below — pin it, don't float. */
const VERSION = '5.2.5';

/**
 * The curated list: a spread of text faces, display faces, slabs, a
 * condensed, a mono and a handwriting face, so a collage can mix type
 * without leaving the app. Weights are deliberately few — each file is
 * ~15–60 KB and every one of them ships with the app. Italics are listed
 * per family because not every family ships every italic.
 */
const FAMILIES = [
  // Serif
  { family: 'Playfair Display', slug: 'playfair-display', weights: [400, 700], italics: [400, 700] },
  { family: 'Bodoni Moda', slug: 'bodoni-moda', weights: [400, 700, 900], italics: [400, 700] },
  { family: 'Lora', slug: 'lora', weights: [400, 500, 700], italics: [400, 500, 700] },
  { family: 'Libre Baskerville', slug: 'libre-baskerville', weights: [400, 700], italics: [400] },
  { family: 'Bitter', slug: 'bitter', weights: [300, 400, 700], italics: [400, 700] },
  // Sans
  { family: 'Inter', slug: 'inter', weights: [300, 400, 600, 800], italics: [400, 700] },
  { family: 'Public Sans', slug: 'public-sans', weights: [400, 600, 800], italics: [400, 700] },
  { family: 'Oswald', slug: 'oswald', weights: [300, 500, 700], italics: [] },
  { family: 'Space Grotesk', slug: 'space-grotesk', weights: [300, 400, 500, 700], italics: [] },
  { family: 'Raleway', slug: 'raleway', weights: [300, 400, 700], italics: [400, 700] },
  // Slab
  { family: 'Zilla Slab', slug: 'zilla-slab', weights: [300, 400, 700], italics: [400, 700] },
  { family: 'Roboto Slab', slug: 'roboto-slab', weights: [100, 300, 400, 700, 900], italics: [] },
  // Display, mono and handwriting
  { family: 'Abril Fatface', slug: 'abril-fatface', weights: [400], italics: [] },
  { family: 'Anton', slug: 'anton', weights: [400], italics: [] },
  { family: 'IBM Plex Mono', slug: 'ibm-plex-mono', weights: [400, 600, 700], italics: [400, 700] },
  { family: 'Caveat', slug: 'caveat', weights: [400, 600, 700], italics: [] },
];

const dryRun = process.argv.includes('--dry-run');

/**
 * The .woff files a family wants, as { name, weight, style, url }.
 *
 * An italic is only reachable through the weight slot it belongs to
 * (getFontUrl looks up family → weight → style), so asking for an italic
 * also asks for that weight's upright file.
 */
function candidatesFor({ slug, weights, italics }) {
  const byName = new Map();
  const add = (weight, style) => {
    const name = `${slug}-latin-${weight}-${style}.woff`;
    byName.set(name, { weight, style, name, url: `${CDN}/${slug}@${VERSION}/files/${name}` });
  };
  for (const w of weights) add(w, 'normal');
  for (const w of italics) {
    if (!weights.includes(w)) add(w, 'normal');
    add(w, 'italic');
  }
  return [...byName.values()];
}

async function fetchOrNull(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch (_e) {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

/** A file is only usable if opentype can actually parse it. */
async function assertParses(path) {
  const bytes = await readFile(path);
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (!font.numGlyphs || !font.unitsPerEm) throw new Error(`unusable font data in ${path}`);
  return bytes.length;
}

const entries = [];
let totalBytes = 0;
let fileCount = 0;
let missing = 0;

for (const fam of FAMILIES) {
  const dir = join(FONT_DIR, fam.family.replace(/[^A-Za-z0-9]+/g, '_'));
  const licenceUrl = `${CDN}/${fam.slug}@${VERSION}/LICENSE`;
  const entry = {
    family: fam.family,
    slug: fam.slug,
    source: `${CDN}/${fam.slug}@${VERSION}`,
    licence: licenceUrl,
    weights: [],
    files: [],
  };

  if (!dryRun) await mkdir(dir, { recursive: true });
  const licencePath = join(dir, 'OFL.txt');
  if (!dryRun && !existsSync(licencePath)) totalBytes += await download(licenceUrl, licencePath);

  for (const cand of candidatesFor(fam)) {
    const dest = join(FONT_DIR, cand.name);
    const known = await fetchOrNull(cand.url);
    if (!known) {
      missing++;
      console.log(`  -- ${cand.name} (not published — skipped)`);
      continue;
    }
    if (dryRun) {
      console.log(`  would fetch ${cand.name}`);
    } else {
      if (!existsSync(dest)) await download(cand.url, dest);
      totalBytes += await assertParses(dest);
      fileCount++;
    }
    entry.files.push({ name: cand.name, weight: cand.weight, style: cand.style, url: cand.url });
    if (cand.style === 'normal') entry.weights.push(cand.weight);
  }
  entry.weights.sort((a, b) => a - b);
  if (!entry.weights.length) throw new Error(`no upright file for ${fam.family}`);
  entries.push(entry);
  console.log(`${dryRun ? 'plan' : ' ok '}  ${fam.family.padEnd(20)} ${entry.files.length} files`);
}

if (dryRun) process.exit(0);

/* ── regenerate the metadata the app reads ────────────────────────── */

const files = {};
const weights = {};
for (const e of entries) {
  files[e.family] = {};
  for (const w of e.weights) {
    const slot = { normal: e.files.find(f => f.weight === w && f.style === 'normal').name };
    const italic = e.files.find(f => f.weight === w && f.style === 'italic');
    if (italic) slot.italic = italic.name;
    files[e.family][w] = slot;
  }
  weights[e.family] = e.weights;
}

const js = `/* AUTO-GENERATED by scripts/fetch-bundled-google-fonts.mjs — do not edit.
 *
 * Google Fonts vendored into vendor/type-set/fonts/ so text layers can be
 * shaped offline. latin subset, static instances, @fontsource ${VERSION}.
 * File names are relative to the type-set font base directory.
 */

export const BUNDLED_GOOGLE_FONT_FILES = ${JSON.stringify(files, null, 2)};

export const BUNDLED_GOOGLE_FONT_WEIGHTS = ${JSON.stringify(weights, null, 2)};
`;
await writeFile(GENERATED, js);

await writeFile(MANIFEST, JSON.stringify({
  source: 'Google Fonts, via the @fontsource mirror on jsDelivr',
  version: VERSION,
  note: 'latin subset, static instances; regenerate with scripts/fetch-bundled-google-fonts.mjs',
  families: entries,
}, null, 2) + '\n');

console.log(`\n${fileCount} font files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);
console.log(`metadata: ${GENERATED}`);
console.log(`manifest: ${MANIFEST}`);

// Leave no stale faces behind if a family lost a weight in the list above.
// Scoped to the families this script owns so the older bundled faces — which
// have no manifest here — are never touched.
const keep = new Set(entries.flatMap(e => e.files.map(f => f.name)));
const { readdir } = await import('node:fs/promises');
for (const name of await readdir(FONT_DIR)) {
  const owned = FAMILIES.some(f => name.startsWith(`${f.slug}-latin-`));
  if (owned && name.endsWith('.woff') && !keep.has(name)) {
    console.log(`removing stale ${name}`);
    await rm(join(FONT_DIR, name));
  }
}
