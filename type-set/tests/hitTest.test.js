/**
 * hitTest unit tests
 *
 * Verifies cursor placement when clicking on the canvas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hitTest } from '../src/type-engine.js';

function makeGlyph(char, x, y, advanceWidth, opts = {}) {
  return {
    char,
    x,
    y,
    advanceWidth,
    spacingOffset: opts.spacingOffset ?? 0,
    kerningOverride: opts.kerningOverride ?? 0,
    kerning: opts.kerning ?? 0,
    charIndex: opts.charIndex ?? 0,
    charCount: opts.charCount ?? 1,
  };
}

describe('hitTest', () => {
  const lineHeight = 20;

  it('returns 0 for empty glyphs', () => {
    assert.strictEqual(hitTest([], 10, 10, lineHeight), 0);
  });

  it('returns 0 when clicking above the first line', () => {
    const glyphs = [makeGlyph('a', 10, 20, 10, { charIndex: 0 })];
    assert.strictEqual(hitTest(glyphs, 15, 5, lineHeight), 0);
  });

  it('returns end of text when clicking below the last line', () => {
    const glyphs = [
      makeGlyph('a', 10, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 20, 20, 10, { charIndex: 1 }),
    ];
    assert.strictEqual(hitTest(glyphs, 15, 100, lineHeight), 2);
  });

  it('places cursor at glyph start when clicking left of center', () => {
    const glyphs = [
      makeGlyph('a', 0, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 10, 20, 10, { charIndex: 1 }),
    ];
    // center of 'a' is at x=5, click at x=2 -> left of center -> index 0
    assert.strictEqual(hitTest(glyphs, 2, 20, lineHeight), 0);
  });

  it('places cursor at glyph end when clicking right of center', () => {
    const glyphs = [
      makeGlyph('a', 0, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 10, 20, 10, { charIndex: 1 }),
    ];
    // center of 'a' is at x=5, click at x=8 -> right of center -> index 1
    assert.strictEqual(hitTest(glyphs, 8, 20, lineHeight), 1);
  });

  it('handles multi-line text (first line)', () => {
    const glyphs = [
      makeGlyph('a', 0, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 10, 20, 10, { charIndex: 1 }),
      makeGlyph('c', 0, 40, 10, { charIndex: 2 }),
      makeGlyph('d', 10, 40, 10, { charIndex: 3 }),
    ];
    // click on first line, right of 'b' center
    assert.strictEqual(hitTest(glyphs, 18, 20, lineHeight), 2);
  });

  it('handles multi-line text (second line)', () => {
    const glyphs = [
      makeGlyph('a', 0, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 10, 20, 10, { charIndex: 1 }),
      makeGlyph('c', 0, 40, 10, { charIndex: 2 }),
      makeGlyph('d', 10, 40, 10, { charIndex: 3 }),
    ];
    // click on second line, left of 'c' center
    assert.strictEqual(hitTest(glyphs, 2, 40, lineHeight), 2);
    // click on second line, right of 'd' center
    assert.strictEqual(hitTest(glyphs, 18, 40, lineHeight), 4);
  });

  it('handles right-aligned glyphs', () => {
    const glyphs = [
      makeGlyph('a', 80, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 90, 20, 10, { charIndex: 1 }),
    ];
    // left of 'a' center (85)
    assert.strictEqual(hitTest(glyphs, 84, 20, lineHeight), 0);
    // right of 'a' center
    assert.strictEqual(hitTest(glyphs, 86, 20, lineHeight), 1);
    assert.strictEqual(hitTest(glyphs, 95, 20, lineHeight), 2);
  });

  it('handles center-aligned glyphs', () => {
    const glyphs = [
      makeGlyph('a', 40, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 50, 20, 10, { charIndex: 1 }),
    ];
    assert.strictEqual(hitTest(glyphs, 42, 20, lineHeight), 0);
    assert.strictEqual(hitTest(glyphs, 55, 20, lineHeight), 2);
  });

  it('handles spacingOffset (letter-spacing)', () => {
    const glyphs = [
      makeGlyph('a', 0, 20, 10, { charIndex: 0, spacingOffset: 5 }),
      makeGlyph('b', 15, 20, 10, { charIndex: 1, spacingOffset: 5 }),
    ];
    // center of 'a' is at x=7.5, click at x=3 -> left -> 0
    assert.strictEqual(hitTest(glyphs, 3, 20, lineHeight), 0);
    // center of 'a' is at x=7.5, click at x=12 -> right -> 1
    assert.strictEqual(hitTest(glyphs, 12, 20, lineHeight), 1);
  });

  it('handles ligature glyph (charCount > 1)', () => {
    const glyphs = [
      makeGlyph('fi', 0, 20, 15, { charIndex: 0, charCount: 2 }),
      makeGlyph('e', 15, 20, 10, { charIndex: 2 }),
    ];
    // left of ligature center -> charIndex 0
    assert.strictEqual(hitTest(glyphs, 2, 20, lineHeight), 0);
    // right of ligature center -> charIndex 0 + 2 = 2
    assert.strictEqual(hitTest(glyphs, 12, 20, lineHeight), 2);
  });

  it('handles hyphenation glyph (charCount = 0)', () => {
    const glyphs = [
      makeGlyph('h', 0, 20, 10, { charIndex: 0 }),
      makeGlyph('y', 10, 20, 10, { charIndex: 1 }),
      makeGlyph('-', 20, 20, 8, { charIndex: 1, charCount: 0 }),
      makeGlyph('p', 28, 20, 10, { charIndex: 2 }),
    ];
    // hyphen sits at x=20, width=8, center=24
    // click left of hyphen center -> charIndex 1
    assert.strictEqual(hitTest(glyphs, 22, 20, lineHeight), 1);
    // click right of hyphen center -> charIndex 1 + 0 = 1
    // (charCount 0 means cursor stays at same text position)
    assert.strictEqual(hitTest(glyphs, 26, 20, lineHeight), 1);
  });

  it('returns 0 when clicking far left of all glyphs', () => {
    const glyphs = [
      makeGlyph('a', 50, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 60, 20, 10, { charIndex: 1 }),
    ];
    assert.strictEqual(hitTest(glyphs, 5, 20, lineHeight), 0);
  });

  it('returns end when clicking far right of all glyphs', () => {
    const glyphs = [
      makeGlyph('a', 0, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 10, 20, 10, { charIndex: 1 }),
    ];
    assert.strictEqual(hitTest(glyphs, 200, 20, lineHeight), 2);
  });

  it('chooses closest glyph on correct line when y is between lines', () => {
    const glyphs = [
      makeGlyph('a', 0, 20, 10, { charIndex: 0 }),
      makeGlyph('b', 0, 40, 10, { charIndex: 1 }),
    ];
    // click halfway between lines (y=30). targetLine = round((30-20)/20)=round(0.5)=1 -> second line
    assert.strictEqual(hitTest(glyphs, 4, 30, lineHeight), 1);
    // click closer to first line (y=28). targetLine = round(8/20)=0 -> first line
    assert.strictEqual(hitTest(glyphs, 4, 28, lineHeight), 0);
    // click closer to second line (y=32). targetLine = round(12/20)=1 -> second line
    assert.strictEqual(hitTest(glyphs, 4, 32, lineHeight), 1);
  });
});

describe('hitTest with justified text', () => {
  const lineHeight = 20;

  it('handles spaces with extra justification width', () => {
    // Simulate a justified line: "a b c" where spaces are stretched
    // Glyph positions after justification:
    // 'a' at x=0, width=10
    // ' ' at x=10, width=10 + 20 extra = 30 total
    // 'b' at x=40, width=10
    // ' ' at x=50, width=10 + 20 extra = 30 total
    // 'c' at x=80, width=10
    const glyphs = [
      makeGlyph('a', 0, 20, 10, { charIndex: 0 }),
      makeGlyph(' ', 10, 20, 10, { charIndex: 1, spacingOffset: 20 }),
      makeGlyph('b', 40, 20, 10, { charIndex: 2 }),
      makeGlyph(' ', 50, 20, 10, { charIndex: 3, spacingOffset: 20 }),
      makeGlyph('c', 80, 20, 10, { charIndex: 4 }),
    ];

    // Click on 'a' left side
    assert.strictEqual(hitTest(glyphs, 2, 20, lineHeight), 0);
    // Click on 'a' right side -> after 'a'
    assert.strictEqual(hitTest(glyphs, 8, 20, lineHeight), 1);
    // Click in middle of first space -> should pick space, right of center -> after space
    assert.strictEqual(hitTest(glyphs, 28, 20, lineHeight), 2);
    // Click on 'b'
    assert.strictEqual(hitTest(glyphs, 42, 20, lineHeight), 2);
    // Click on 'c' right side -> end
    assert.strictEqual(hitTest(glyphs, 88, 20, lineHeight), 5);
  });
});
