/**
 * Hyphenation wrapper using the hyphen library.
 */

import { hyphenateSync } from 'hyphen/en/index.js';

const cache = new Map();

export function hyphenateWord(word) {
  if (word.length < 5) return [word];
  if (cache.has(word)) return cache.get(word);
  const result = hyphenateSync(word);
  const parts = result.split('\u00AD');
  cache.set(word, parts);
  return parts;
}

export function buildHyphenMap(text) {
  const map = new Map();
  const words = text.split(/[\s\n]+/);
  for (const word of words) {
    if (word.length < 5) continue;
    const parts = hyphenateWord(word);
    if (parts.length > 1) {
      map.set(word, parts);
    }
  }
  return map;
}
