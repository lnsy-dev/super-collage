/* ═══════════════════════════════════════════════════════════════════
   Unit tests for the palette ink-name helpers (src/app/constants.js).

   Run with:  npm run test:colors

   The invariant these tests encode: every palette color carries a
   REAL name — exports never fall back to hex strings as ink names.

     - inkNameForHex: hex → palette ink name, case-insensitively,
       with the raw hex as fallback for stray out-of-palette layers.
     - ensureColorNames: purges empty / 'Untitled' / hex-as-name
       entries by assigning unique 'Custom N' names, without ever
       mutating its input or colliding with names in use.
   ═══════════════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RISO_COLORS,
  RISO_COLORS,
  setRisoColors,
  inkNameForHex,
  ensureColorNames,
} from './constants.js';

/* ─── inkNameForHex: palette lookup ────────────────────────────────── */

test('inkNameForHex resolves every default palette hex to its ink name', () => {
  for (const c of DEFAULT_RISO_COLORS) {
    assert.equal(inkNameForHex(c.hex), c.name, `default hex ${c.hex} must resolve to '${c.name}'`);
  }
});

test('inkNameForHex lookup is case-insensitive in both directions', () => {
  assert.equal(inkNameForHex('#f65058'), 'Red');   // palette stores lowercase
  assert.equal(inkNameForHex('#F65058'), 'Red');
  assert.equal(inkNameForHex('#Ff48B0'), 'Neon Pink');
  assert.equal(inkNameForHex('#ffffff'), 'White'); // palette stores uppercase
  assert.equal(inkNameForHex('#FFFFFF'), 'White');
});

test('inkNameForHex falls back to the raw hex for out-of-palette colors', () => {
  assert.equal(inkNameForHex('#123456'), '#123456');
  // The fallback is the argument EXACTLY as given — case and format preserved.
  assert.equal(inkNameForHex('#AbCdEf'), '#AbCdEf');
  assert.equal(inkNameForHex('rgb(1,2,3)'), 'rgb(1,2,3)');
});

test('inkNameForHex degenerate arguments come back unchanged', () => {
  assert.equal(inkNameForHex(''), '');
  assert.equal(inkNameForHex(null), null);
  assert.equal(inkNameForHex(undefined), undefined);
});

test('inkNameForHex reads the LIVE palette (setRisoColors), then restores', () => {
  try {
    setRisoColors([{ name: 'Zomp', hex: '#72A583', pantone: '15-6330' }]);
    assert.equal(inkNameForHex('#72a583'), 'Zomp');
    assert.equal(inkNameForHex('#010101'), '#010101', 'old palette hex gone from live lookup');
  } finally {
    setRisoColors(DEFAULT_RISO_COLORS);
  }
  assert.equal(inkNameForHex('#010101'), 'Black', 'defaults restored');
  assert.deepEqual(RISO_COLORS, DEFAULT_RISO_COLORS);
});

/* ─── ensureColorNames: which entries need renaming ────────────────── */

test('ensureColorNames renames missing, empty and whitespace-only names', () => {
  const input = [
    { name: '',            hex: '#111111', pantone: '' },
    { name: '   ',         hex: '#222222', pantone: '' },
    { name: undefined,     hex: '#333333', pantone: '' },
    { hex: '#444444',      pantone: '' },               // name key absent
  ];
  const { colors, changed } = ensureColorNames(input);
  assert.equal(changed, true);
  assert.deepEqual(colors.map(c => c.name), ['Custom 1', 'Custom 2', 'Custom 3', 'Custom 4']);
  assert.deepEqual(colors.map(c => c.hex), ['#111111', '#222222', '#333333', '#444444']);
});

test('ensureColorNames renames Untitled entries (case-insensitive)', () => {
  const input = [
    { name: 'Untitled', hex: '#111111', pantone: '' },
    { name: 'untitled', hex: '#222222', pantone: '' },
    { name: 'UNTITLED', hex: '#333333', pantone: '' },
  ];
  const { colors, changed } = ensureColorNames(input);
  assert.equal(changed, true);
  assert.deepEqual(colors.map(c => c.name), ['Custom 1', 'Custom 2', 'Custom 3']);
});

test('ensureColorNames keeps names that are not EXACTLY Untitled (spec boundary)', () => {
  // Spec triggers are exact: missing/whitespace-only, equal to 'Untitled'
  // (case-insensitive), or equal to the entry's own hex. '  Untitled ' is
  // neither whitespace-only nor equal to 'Untitled', so it is kept.
  const input = [{ name: '  Untitled ', hex: '#111111', pantone: '' }];
  const { colors, changed } = ensureColorNames(input);
  assert.equal(changed, false);
  assert.equal(colors[0].name, '  Untitled ');
});

test('ensureColorNames renames entries whose name equals their own hex (legacy "Save Color")', () => {
  const input = [
    { name: '#f65058', hex: '#f65058', pantone: '' },
    { name: '#F65058', hex: '#f65058', pantone: '' }, // case-insensitive match
    { name: '#0078bf', hex: '#0078bf', pantone: '' },
  ];
  const { colors, changed } = ensureColorNames(input);
  assert.equal(changed, true);
  assert.deepEqual(colors.map(c => c.name), ['Custom 1', 'Custom 2', 'Custom 3']);
});

test('ensureColorNames preserves good names untouched (even non-riso names)', () => {
  const input = [
    { name: 'Black',       hex: '#010101', pantone: 'BLACK U' },
    { name: 'custom 1',    hex: '#abcdef', pantone: '' },  // a real user-chosen name
    { name: 'Sunset Soup', hex: '#ff8844', pantone: '' },
    { name: '#00ff00ish',  hex: '#123123', pantone: '' },  // hex-like but NOT the entry's own hex
  ];
  const { colors, changed } = ensureColorNames(input);
  assert.equal(changed, false);
  assert.deepEqual(colors, input);
});

test('ensureColorNames in a mixed palette only touches the bad entries', () => {
  const input = [
    { name: 'Red',        hex: '#f65058', pantone: 'RED 032 U' },
    { name: '#f65058',    hex: '#f65058', pantone: '' },
    { name: 'Untitled',   hex: '#ffe800', pantone: '' },
    { name: 'Yellow',     hex: '#ffe800', pantone: 'YELLOW U' },
    { name: '',           hex: '#0078bf', pantone: '' },
  ];
  const { colors, changed } = ensureColorNames(input);
  assert.equal(changed, true);
  assert.equal(colors[0].name, 'Red');
  assert.equal(colors[1].name, 'Custom 1');
  assert.equal(colors[2].name, 'Custom 2');
  assert.equal(colors[3].name, 'Yellow');
  assert.equal(colors[4].name, 'Custom 3');
});

/* ─── ensureColorNames: 'Custom N' uniqueness ──────────────────────── */

test('ensureColorNames never emits duplicate Custom N, even on collisions', () => {
  // 'Custom 1' is already taken by a GOOD entry — bad entries must skip it.
  const input = [
    { name: 'Custom 1', hex: '#111111', pantone: '' },
    { name: '',         hex: '#222222', pantone: '' },
    { name: 'Untitled', hex: '#333333', pantone: '' },
  ];
  const { colors, changed } = ensureColorNames(input);
  assert.equal(changed, true);
  const names = colors.map(c => c.name);
  assert.equal(names[0], 'Custom 1', 'good entry keeps its name');
  assert.deepEqual(names.slice(1), ['Custom 2', 'Custom 3']);
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
});

test('ensureColorNames gives identical bad names their own sequential Custom N', () => {
  // Three entries produced by the legacy "Save Color" flow with the same hex:
  const input = [
    { name: '#aaaaaa', hex: '#aaaaaa', pantone: '' },
    { name: '#aaaaaa', hex: '#aaaaaa', pantone: '' },
    { name: '#aaaaaa', hex: '#aaaaaa', pantone: '' },
  ];
  const { colors } = ensureColorNames(input);
  assert.deepEqual(colors.map(c => c.name), ['Custom 1', 'Custom 2', 'Custom 3']);
});

test('ensureColorNames renames only names equal to the entry\'s OWN hex', () => {
  // The legacy trigger is name === own hex. A name that merely matches a
  // DIFFERENT entry's hex is not that pattern and is left alone.
  const input = [
    { name: '#aaaaaa', hex: '#aaaaaa', pantone: '' }, // own hex -> rename
    { name: '#aaaaaa', hex: '#bbbbbb', pantone: '' }, // not its own hex -> keep
  ];
  const { colors, changed } = ensureColorNames(input);
  assert.equal(changed, true);
  assert.deepEqual(colors.map(c => c.name), ['Custom 1', '#aaaaaa']);
});

test('ensureColorNames cascade: the counter skips every taken number in one shared sweep', () => {
  const input = [
    { name: 'Custom 2', hex: '#111111', pantone: '' }, // good name, occupies 2
    { name: '',         hex: '#222222', pantone: '' }, // -> Custom 1
    { name: '',         hex: '#333333', pantone: '' }, // 1 taken (just assigned), 2 taken -> Custom 3
  ];
  const { colors } = ensureColorNames(input);
  assert.deepEqual(colors.map(c => c.name), ['Custom 2', 'Custom 1', 'Custom 3']);
  assert.equal(new Set(colors.map(c => c.name)).size, 3);
});

/* ─── ensureColorNames: reserved names ─────────────────────────────── */

test('ensureColorNames honors reserved names', () => {
  const input = [
    { name: '', hex: '#111111', pantone: '' },
    { name: '', hex: '#222222', pantone: '' },
  ];
  const { colors, changed } = ensureColorNames(input, ['Custom 1', 'Custom 2']);
  assert.equal(changed, true);
  assert.deepEqual(colors.map(c => c.name), ['Custom 3', 'Custom 4']);
});

test('ensureColorNames reserved check is case-insensitive', () => {
  const input = [{ name: '', hex: '#111111', pantone: '' }];
  const { colors } = ensureColorNames(input, ['custom 1']);
  assert.equal(colors[0].name, 'Custom 2');
});

test('ensureColorNames works without a reserved argument (default [])', () => {
  const input = [{ name: 'Untitled', hex: '#111111', pantone: '' }];
  const { colors, changed } = ensureColorNames(input);
  assert.equal(changed, true);
  assert.equal(colors[0].name, 'Custom 1');
});

/* ─── ensureColorNames: purity ─────────────────────────────────────── */

test('ensureColorNames does not mutate the input array or its entries', () => {
  const input = [
    { name: 'Red',      hex: '#f65058', pantone: 'RED 032 U' },
    { name: '',         hex: '#111111', pantone: '' },
    { name: 'Untitled', hex: '#222222', pantone: '' },
    { name: '#333333',  hex: '#333333', pantone: '' },
  ];
  const snapshot = JSON.parse(JSON.stringify(input));

  // Frozen objects make any attempted mutation throw (ES modules are strict).
  const frozen = Object.freeze(input.map(c => Object.freeze(c)));

  const { colors, changed } = ensureColorNames(frozen);
  assert.equal(changed, true);
  assert.deepEqual(input, snapshot, 'input array and entries must be untouched');
  assert.deepEqual(frozen, snapshot, 'frozen input untouched');
  assert.notEqual(colors, input, 'returns a new array');
  assert.equal(colors[1].name, 'Custom 1');
  assert.equal(colors[2].name, 'Custom 2');
  assert.equal(colors[3].name, 'Custom 3');
});

test('ensureColorNames is idempotent: a second pass changes nothing', () => {
  const messy = [
    { name: 'Black',    hex: '#010101', pantone: '' },
    { name: 'Untitled', hex: '#111111', pantone: '' },
    { name: '',         hex: '#222222', pantone: '' },
    { name: '#333333',  hex: '#333333', pantone: '' },
  ];
  const first = ensureColorNames(messy);
  assert.equal(first.changed, true);
  const second = ensureColorNames(first.colors);
  assert.equal(second.changed, false, 'cleaned palette needs no further renaming');
  assert.deepEqual(second.colors, first.colors);
});

/* ─── ensureColorNames: empty input ────────────────────────────────── */

test('ensureColorNames on an empty palette is a no-op with changed=false', () => {
  const { colors, changed } = ensureColorNames([]);
  assert.deepEqual(colors, []);
  assert.equal(changed, false);
});
