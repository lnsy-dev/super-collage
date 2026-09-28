/* ═══════════════════════════════════════════════════════════════════
   Google Fonts integration.

   Two things happen here:

   1. The family list. The Fontsource catalogue API
      (https://api.fontsource.org/v1/fonts) is fetched; it mirrors the
      Google Fonts catalogue (every record it returns is a Google family)
      and, unlike fonts.google.com/metadata/fonts, it sends
      Access-Control-Allow-Origin: * — without that header the old
      endpoint could never be read from the browser, which is why the font
      list used to stay empty. Each family arrives with its package id,
      category and the weights/styles it publishes. The response is
      trimmed and cached in localStorage, so the picker is instant on
      later sessions; failures leave the bundled font list untouched.

   2. The actual font files. type-set shapes text with opentype.js, which
      cannot read the woff2 files the Google CSS API hands to modern
      browsers. So the .woff files of the same Fontsource packages (served
      by jsDelivr, CORS-enabled, with a static instance per weight/style)
      are used instead: they are plain WOFF containers around the same
      TrueType outlines. Files are resolved lazily, only for the weight
      actually used, and cached per session.

   Everything here fails soft: without the network the app keeps working
   with the bundled families, and a family whose file cannot be fetched
   falls back to a bundled face rather than rendering nothing.
   ═══════════════════════════════════════════════════════════════════ */

import { snapWeight as bundledSnapWeight, getFont, FONT_FILES } from 'type-set';
import { addGoogleFamilies, setFontPickerValue } from './font-picker.js';

const CATALOG_URL = 'https://api.fontsource.org/v1/fonts';
const CACHE_KEY = 'googleFontsFamilies';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // one week

/** @fontsource packages on jsDelivr. "@latest" always tracks the newest release. */
const FONT_CDN = 'https://cdn.jsdelivr.net/npm/@fontsource';
/** Subset to download. "latin" is the one every family publishes. */
const FONT_SUBSETS = ['latin', 'latin-ext'];
/** Family used when a file cannot be fetched (e.g. offline). */
export const FALLBACK_FAMILY = 'IBM Plex Sans';
/** Sample text shown in the font picker previews. */
export const PREVIEW_TEXT = 'Handgloves';

/* ── family metadata ─────────────────────────────────────────────── */

/** family → { family, id, category, weights, italics } */
const familyIndex = new Map();
const packageIds = new Map();   // family → @fontsource package id
let listPromise = null;

/**
 * Fetch the family list. Returns an array of
 * { family, id, category, weights, italics } sorted alphabetically, or []
 * when the catalogue is unreachable.
 */
export async function fetchGoogleFontFamilies() {
  if (listPromise) return listPromise;
  listPromise = _fetchFamilies().catch(() => []);
  return listPromise;
}

async function _fetchFamilies() {
  // Serve from cache when fresh.
  let cached = null;
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw && Date.now() - raw.at < CACHE_TTL_MS && Array.isArray(raw.families)) cached = raw.families;
  } catch (_e) { /* ignore malformed cache */ }
  if (cached) return indexFamilies(cached);

  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`Font catalogue request failed: ${res.status}`);

  const families = parseCatalog(await res.json());
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), families }));
  } catch (_e) { /* storage full/unavailable — non-fatal */ }

  return indexFamilies(families);
}

/**
 * Trim a catalogue payload down to the fields the picker needs, dropping
 * families that cannot render latin text.
 */
export function parseCatalog(json) {
  const list = Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : []);
  const families = [];
  for (const f of list) {
    if (!f.family || !Array.isArray(f.subsets) || !f.subsets.includes('latin')) continue;
    const weights = (f.weights || []).filter(w => Number.isFinite(w)).sort((a, b) => a - b);
    if (!weights.length) continue;
    const styles = f.styles || ['normal'];
    families.push({
      family: f.family,
      id: f.id || f.family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      category: f.category || '',
      weights,
      italics: styles.includes('italic') ? weights.slice() : [],
    });
  }
  families.sort((a, b) => a.family.localeCompare(b.family));
  return families;
}

/** Register family records for the isGoogleFont()/fontVariants() lookups. */
function indexFamilies(families) {
  familyIndex.clear();
  packageIds.clear();
  for (const f of families) {
    familyIndex.set(f.family, f);
    packageIds.set(f.family, f.id);
  }
  return families;
}


/**
 * True when the family must be fetched from the web. Families that ship
 * with the app (several of which are also Google families, e.g. IBM Plex
 * Serif) always use their local file: no network, no fallback, and the very
 * same outlines on every machine.
 */
export function isGoogleFont(family) {
  return familyIndex.has(family) && !FONT_FILES[family];
}

/**
 * Weights that really exist for a family: every listed weight, plus its
 * italic when the family has one. Used to build the Variant dropdown.
 */
export function fontVariants(family) {
  const info = isGoogleFont(family) ? familyIndex.get(family) : null;
  if (!info) return null;
  const variants = [];
  for (const w of info.weights) variants.push({ weight: w, style: 'normal' });
  for (const w of info.italics) variants.push({ weight: w, style: 'italic' });
  return variants;
}

/** Nearest available weight for a family (no-op for unknown families). */
export function snapToAvailableWeight(family, weight) {
  const info = isGoogleFont(family) ? familyIndex.get(family) : null;
  const weights = info ? info.weights : null;
  if (!weights || !weights.length) return weight;
  const num = typeof weight === 'string' ? parseInt(weight, 10) : weight;
  return weights.reduce((prev, curr) =>
    Math.abs(curr - num) < Math.abs(prev - num) ? curr : prev
  );
}

/* ── font files ──────────────────────────────────────────────────── */

/** @fontsource package/file name for a family: lowercase, dash separated. */
export function fontPackageSlug(family) {
  return packageIds.get(family) || family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Candidate URLs for one weight/style, most specific first. */
export function fontSourceUrls(family, weight, style) {
  const slug = fontPackageSlug(family);
  const out = [];
  for (const subset of FONT_SUBSETS) {
    out.push(`${FONT_CDN}/${slug}@latest/files/${slug}-${subset}-${weight}-${style}.woff`);
  }
  return out;
}

/** In-flight/settled lookups, so a family is only probed once per session. */
const urlProbes = new Map();
const previewFaces = new Set();

/** HEAD a candidate URL; resolves to the URL when it exists, else null. */
async function firstAvailable(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return url;
    } catch (_e) { /* network/CORS failure — try the next candidate */ }
  }
  return null;
}

/**
 * Resolve a real font file for a family. Falls back to the closest
 * published weight, then to the upright file when the family has no italic
 * of the requested style, then to null when there is nothing to use.
 *
 * @returns {Promise<{url: string, weight: number, style: string}|null>}
 */
export function resolveFontFile(family, weight, style = 'normal') {
  const w = typeof weight === 'string' ? parseInt(weight, 10) : weight;
  const key = `${family}|${w}|${style}`;
  if (!urlProbes.has(key)) {
    urlProbes.set(key, (async () => {
      const info = familyIndex.get(family);
      // Try the requested weight first, then walk outwards to the nearest
      // weight the mirror actually publishes.
      const candidates = info ? info.weights.slice() : [w];
      if (candidates.includes(w)) {
        candidates.splice(candidates.indexOf(w), 1);
        candidates.unshift(w);
      } else {
        candidates.sort((a, b) => Math.abs(a - w) - Math.abs(b - w));
      }
      for (const cw of candidates) {
        const url = await firstAvailable(fontSourceUrls(family, cw, style));
        if (url) return { url, weight: cw, style };
      }
      // No italic anywhere: draw it upright rather than not at all.
      if (style === 'italic') return resolveFontFile(family, w, 'normal');
      return null;
    })());
  }
  return urlProbes.get(key);
}

/**
 * Register a CSS font face so the family can be used in the DOM (font
 * picker previews, the on-canvas text editor) without touching opentype.
 * Safe to call repeatedly; no-ops for non-Google families.
 */
export async function ensurePreviewFont(family, weight = 400, style = 'normal') {
  if (!isGoogleFont(family)) return false;
  const key = `${family}|${weight}|${style}`;
  if (previewFaces.has(key)) return true;
  const file = await resolveFontFile(family, weight, style);
  if (!file || typeof FontFace === 'undefined' || !document.fonts) return false;
  const face = new FontFace(family, `url(${file.url})`, { weight: String(file.weight), style: file.style });
  try {
    await face.load();
    document.fonts.add(face);
    previewFaces.add(key);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Resolve everything the text rasterizer needs for a family: the family to
 * shape with, the weight it actually has, and a weight → url map for
 * type-set's `weightSpecificFonts`. Bundled families resolve instantly;
 * Google families that cannot be fetched fall back to a bundled family so
 * the layer still renders.
 *
 * @returns {Promise<{family: string, weight: number|number[], style: string,
 *                    weightSpecificFonts: object|null}>}
 */
export async function resolveRenderFont(family, weight, style = 'normal') {
  const w = typeof weight === 'string' ? parseInt(weight, 10) : weight;
  if (!isGoogleFont(family)) {
    return { family, weight, style, weightSpecificFonts: null };
  }
  const file = await resolveFontFile(family, w, style);
  if (file) {
    const map = { [file.weight]: { [file.style]: file.url } };
    if (style !== file.style) map[file.weight][style] = map[file.weight][file.style];
    // type-set re-downloads a weight-specific file on every render, so only
    // hand it the URL while the slot is still empty.
    const pending = getFont(family, String(file.weight), file.style) ? {} : map;
    return { family, weight: file.weight, style, weightSpecificFonts: pending };
  }
  // Unreachable family (offline, or no mirror file) — keep text visible.
  return {
    family: FALLBACK_FAMILY,
    weight: bundledSnapWeight(FALLBACK_FAMILY, w),
    style: FALLBACK_FAMILY === family ? style : 'normal',
    weightSpecificFonts: null,
  };
}

/* ── startup ─────────────────────────────────────────────────────── */

/**
 * Fetch the family list in the background and offer it in the font
 * picker. Failure is silent: the bundled families stay selectable.
 */
export async function initGoogleFonts() {
  const select = document.getElementById('prop-text-font');
  if (!select) return;
  try {
    const families = await fetchGoogleFontFamilies();
    if (families.length) {
      addGoogleFamilies(families);
      setFontPickerValue(select.value);
    }
  } catch (_e) {
    // Offline or blocked — keep the bundled font list only.
  }
}
