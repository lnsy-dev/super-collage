/**
 * Hyphenation wrapper using the hyphen library.
 *
 * hyphen is a CommonJS package, so in browser ES-module environments it may
 * not be available. We lazily import it and fall back to no hyphenation when
 * it cannot be loaded.
 */

const cache = new Map();
let hyphenateSync = null;
let hyphenLoading = null;

async function ensureHyphen() {
  if (hyphenateSync) return;
  if (hyphenLoading) return hyphenLoading;

  hyphenLoading = (async () => {
    try {
      const mod = await import('hyphen/en/index.js');
      hyphenateSync = mod.hyphenateSync;
    } catch {
      hyphenateSync = null;
    }
  })();

  await hyphenLoading;
}

export async function hyphenateWord(word) {
  if (word.length < 5) return [word];
  if (cache.has(word)) return cache.get(word);

  await ensureHyphen();

  if (!hyphenateSync) {
    cache.set(word, [word]);
    return [word];
  }

  const result = hyphenateSync(word);
  const parts = result.split('\u00AD');
  cache.set(word, parts);
  return parts;
}

export async function buildHyphenMap(text) {
  const map = new Map();
  const words = text.split(/[\s\n]+/);

  // Pre-load hyphen once for all words.
  await ensureHyphen();

  for (const word of words) {
    if (word.length < 5) continue;
    const parts = await hyphenateWord(word);
    if (parts.length > 1) {
      map.set(word, parts);
    }
  }
  return map;
}
