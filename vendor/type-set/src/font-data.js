/**
 * Built-in font metadata for type-set.
 *
 * This module only describes the bundled fonts. Consumers can ignore it and
 * register their own fonts via the renderer engine.
 */

export const FONT_FILES = {
  'IBM Plex Serif': {
    100: { normal: 'ibm-plex-serif-latin-100-normal.woff', italic: 'ibm-plex-serif-latin-100-italic.woff' },
    200: { normal: 'ibm-plex-serif-latin-200-normal.woff', italic: 'ibm-plex-serif-latin-200-italic.woff' },
    300: { normal: 'ibm-plex-serif-latin-300-normal.woff', italic: 'ibm-plex-serif-latin-300-italic.woff' },
    400: { normal: 'ibm-plex-serif-latin-400-normal.woff', italic: 'ibm-plex-serif-latin-400-italic.woff' },
    500: { normal: 'ibm-plex-serif-latin-500-normal.woff', italic: 'ibm-plex-serif-latin-500-italic.woff' },
    600: { normal: 'ibm-plex-serif-latin-600-normal.woff', italic: 'ibm-plex-serif-latin-600-italic.woff' },
    700: { normal: 'ibm-plex-serif-latin-700-normal.woff', italic: 'ibm-plex-serif-latin-700-italic.woff' },
  },
  'IBM Plex Sans': {
    100: { normal: 'ibm-plex-sans-latin-100-normal.woff', italic: 'ibm-plex-sans-latin-100-italic.woff' },
    200: { normal: 'ibm-plex-sans-latin-200-normal.woff', italic: 'ibm-plex-sans-latin-200-italic.woff' },
    300: { normal: 'ibm-plex-sans-latin-300-normal.woff', italic: 'ibm-plex-sans-latin-300-italic.woff' },
    400: { normal: 'ibm-plex-sans-latin-400-normal.woff', italic: 'ibm-plex-sans-latin-400-italic.woff' },
    500: { normal: 'ibm-plex-sans-latin-500-normal.woff', italic: 'ibm-plex-sans-latin-500-italic.woff' },
    600: { normal: 'ibm-plex-sans-latin-600-normal.woff', italic: 'ibm-plex-sans-latin-600-italic.woff' },
    700: { normal: 'ibm-plex-sans-latin-700-normal.woff', italic: 'ibm-plex-sans-latin-700-italic.woff' },
  },
  'Crimson Text': {
    400: { normal: 'crimson-text-latin-400-normal.woff', italic: 'crimson-text-latin-400-italic.woff' },
    600: { normal: 'crimson-text-latin-600-normal.woff', italic: 'crimson-text-latin-600-italic.woff' },
    700: { normal: 'crimson-text-latin-700-normal.woff', italic: 'crimson-text-latin-700-italic.woff' },
  },
  'Fira Code': {
    300: { normal: 'fira-code-latin-300-normal.woff' },
    400: { normal: 'fira-code-latin-400-normal.woff' },
    500: { normal: 'fira-code-latin-500-normal.woff' },
    600: { normal: 'fira-code-latin-600-normal.woff' },
    700: { normal: 'fira-code-latin-700-normal.woff' },
  },
  'League Gothic': {
    400: { normal: 'league-gothic-latin-400-normal.woff' },
  },
  'Atkinson Hyperlegible': {
    400: { normal: 'atkinson-hyperlegible-latin-400-normal.woff', italic: 'atkinson-hyperlegible-latin-400-italic.woff' },
    700: { normal: 'atkinson-hyperlegible-latin-700-normal.woff', italic: 'atkinson-hyperlegible-latin-700-italic.woff' },
  },
  'Cormorant Garamond': {
    300: { normal: 'cormorant-garamond-latin-300-normal.woff', italic: 'cormorant-garamond-latin-300-italic.woff' },
    400: { normal: 'cormorant-garamond-latin-400-normal.woff', italic: 'cormorant-garamond-latin-400-italic.woff' },
    500: { normal: 'cormorant-garamond-latin-500-normal.woff', italic: 'cormorant-garamond-latin-500-italic.woff' },
    600: { normal: 'cormorant-garamond-latin-600-normal.woff', italic: 'cormorant-garamond-latin-600-italic.woff' },
    700: { normal: 'cormorant-garamond-latin-700-normal.woff', italic: 'cormorant-garamond-latin-700-italic.woff' },
  },
  'EB Garamond': {
    400: { normal: 'eb-garamond-latin-400-normal.woff', italic: 'eb-garamond-latin-400-italic.woff' },
    500: { normal: 'eb-garamond-latin-500-normal.woff', italic: 'eb-garamond-latin-500-italic.woff' },
    600: { normal: 'eb-garamond-latin-600-normal.woff', italic: 'eb-garamond-latin-600-italic.woff' },
    700: { normal: 'eb-garamond-latin-700-normal.woff', italic: 'eb-garamond-latin-700-italic.woff' },
    800: { normal: 'eb-garamond-latin-800-normal.woff', italic: 'eb-garamond-latin-800-italic.woff' },
  },
  'Spectral': {
    200: { normal: 'spectral-latin-200-normal.woff', italic: 'spectral-latin-200-italic.woff' },
    300: { normal: 'spectral-latin-300-normal.woff', italic: 'spectral-latin-300-italic.woff' },
    400: { normal: 'spectral-latin-400-normal.woff', italic: 'spectral-latin-400-italic.woff' },
    500: { normal: 'spectral-latin-500-normal.woff', italic: 'spectral-latin-500-italic.woff' },
    600: { normal: 'spectral-latin-600-normal.woff', italic: 'spectral-latin-600-italic.woff' },
    700: { normal: 'spectral-latin-700-normal.woff', italic: 'spectral-latin-700-italic.woff' },
    800: { normal: 'spectral-latin-800-normal.woff', italic: 'spectral-latin-800-italic.woff' },
  },
  'UnifrakturMaguntia': {
    400: { normal: 'unifrakturmaguntia-latin-400-normal.woff' },
  },
};

export const FONT_WEIGHTS = {
  'IBM Plex Serif': [100, 200, 300, 400, 500, 600, 700],
  'IBM Plex Sans': [100, 200, 300, 400, 500, 600, 700],
  'Crimson Text': [400, 600, 700],
  'Fira Code': [300, 400, 500, 600, 700],
  'League Gothic': [400],
  'Atkinson Hyperlegible': [400, 700],
  'Cormorant Garamond': [300, 400, 500, 600, 700],
  'EB Garamond': [400, 500, 600, 700, 800],
  'Spectral': [200, 300, 400, 500, 600, 700, 800],
  'UnifrakturMaguntia': [400],
};

export function hasItalic(family) {
  const map = FONT_FILES[family];
  if (!map) return false;
  const first = Object.values(map)[0];
  return !!first.italic;
}

export function snapWeight(family, weight) {
  const available = FONT_WEIGHTS[family];
  if (!available) return weight;
  const num = typeof weight === 'string' ? parseInt(weight, 10) : weight;
  return available.reduce((prev, curr) =>
    Math.abs(curr - num) < Math.abs(prev - num) ? curr : prev
  );
}

export function getFontUrl(family, weight, style, base = '') {
  const prefix = base.endsWith('/') ? base : base ? base + '/' : '';
  const map = FONT_FILES[family];
  if (!map) return null;
  const weightMap = map[weight];
  if (!weightMap) return null;
  const path = weightMap[style] || weightMap.normal || null;
  if (!path) return null;
  return prefix + path;
}
