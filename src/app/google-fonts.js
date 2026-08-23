/* ═══════════════════════════════════════════════════════════════════
   Google Fonts metadata integration.

   Fetches the Google Fonts JSON API
   (https://fonts.google.com/metadata/fonts) and appends the available
   families to the text font selector, grouped under a "Google Fonts"
   optgroup. The response is cached in localStorage so the list loads
   instantly on subsequent sessions; failures (e.g. offline) leave the
   bundled font list untouched.
   ═══════════════════════════════════════════════════════════════════ */

const METADATA_URL = 'https://fonts.google.com/metadata/fonts';
const CACHE_KEY = 'googleFontsFamilies';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // one week

/**
 * Fetch the Google Fonts family list. Returns an array of
 * { family, category } sorted alphabetically. Uses the localStorage
 * cache when fresh; returns [] on any failure.
 */
export async function fetchGoogleFontFamilies() {
  // Serve from cache when fresh.
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < CACHE_TTL_MS && Array.isArray(cached.families)) {
      return cached.families;
    }
  } catch (_e) { /* ignore malformed cache */ }

  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`Google Fonts metadata request failed: ${res.status}`);

  let text = await res.text();
  // The endpoint guards the JSON with a XSSI-protection prefix line.
  if (text.startsWith(")]}'")) {
    text = text.slice(text.indexOf('\n') + 1);
  }
  const json = JSON.parse(text);

  const list = Array.isArray(json.familyMetadataList) ? json.familyMetadataList : [];
  const families = list
    .filter(f => f.family && Array.isArray(f.subsets) && f.subsets.includes('latin'))
    .map(f => ({ family: f.family, category: f.category || '' }))
    .sort((a, b) => a.family.localeCompare(b.family));

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), families }));
  } catch (_e) { /* storage full/unavailable — non-fatal */ }

  return families;
}

/** Append fetched families to the font <select> as a "Google Fonts" group. */
export async function initGoogleFonts() {
  const select = document.getElementById('prop-text-font');
  if (!select) return;
  try {
    const families = await fetchGoogleFontFamilies();
    if (!families.length) return;

    const known = new Set([...select.options].map(o => o.value));
    const group = document.createElement('optgroup');
    group.label = 'Google Fonts';
    let added = 0;
    for (const { family } of families) {
      if (known.has(family)) continue;
      const opt = document.createElement('option');
      opt.value = family;
      opt.textContent = family;
      group.appendChild(opt);
      added++;
    }
    if (added) select.appendChild(group);
  } catch (_e) {
    // Offline or blocked — keep the bundled font list only.
  }
}
