#!/usr/bin/env node
/**
 * Calibration script for risograph color separation.
 *
 * Loads an image, tries 10–12 candidate palettes, scores each by average
 * CIEDE2000 distance to the original, and saves the composite + plates
 * for every candidate so you can visually compare.
 *
 * Usage:
 *   node scripts/calibrate-colors.js <input-image> [output-dir]
 *
 * Example:
 *   node scripts/calibrate-colors.js test-results/00002-3517528452.jpg calibration-output/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── RISO palette (excluding white) ──────────────────────────────────
const RISO = [
  { name: 'Black',       hex: '#010101' },
  { name: 'Red',         hex: '#f65058' },
  { name: 'Neon Orange', hex: '#ff7477' },
  { name: 'Yellow',      hex: '#ffe800' },
  { name: 'Neon Pink',   hex: '#ff48b0' },
  { name: 'Aqua',        hex: '#5ec8e5' },
  { name: 'Blue',        hex: '#0078bf' },
];

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xFF, g: (v >> 8) & 0xFF, b: v & 0xFF };
}

function hexBytes(hex) {
  const { r, g, b } = hexToRgb(hex);
  return [r, g, b];
}

// ── Candidate palettes ──────────────────────────────────────────────
const CANDIDATES = [
  { name: 'cmyk-ish',     colors: ['Black', 'Aqua', 'Yellow', 'Neon Pink'] },
  { name: 'full-7',       colors: ['Black', 'Red', 'Neon Orange', 'Yellow', 'Neon Pink', 'Aqua', 'Blue'] },
  { name: 'warm-4',       colors: ['Black', 'Red', 'Neon Orange', 'Yellow'] },
  { name: 'cool-4',       colors: ['Black', 'Aqua', 'Blue', 'Neon Pink'] },
  { name: 'primary-4',    colors: ['Black', 'Red', 'Yellow', 'Blue'] },
  { name: 'warm-5',       colors: ['Black', 'Red', 'Neon Orange', 'Yellow', 'Neon Pink'] },
  { name: 'cool-5',       colors: ['Black', 'Aqua', 'Blue', 'Neon Pink', 'Yellow'] },
  { name: 'no-blue',      colors: ['Black', 'Red', 'Neon Orange', 'Yellow', 'Neon Pink', 'Aqua'] },
  { name: 'no-red',       colors: ['Black', 'Neon Orange', 'Yellow', 'Neon Pink', 'Aqua', 'Blue'] },
  { name: 'no-orange',    colors: ['Black', 'Red', 'Yellow', 'Neon Pink', 'Aqua', 'Blue'] },
  { name: 'vibrant-4',    colors: ['Black', 'Red', 'Neon Pink', 'Aqua'] },
  { name: 'cybp-4',       colors: ['Black', 'Yellow', 'Neon Pink', 'Aqua'] },
];

async function main() {
  const inputPath = process.argv[2];
  const outputDir = process.argv[3] || 'calibration-output';

  if (!inputPath) {
    console.error('Usage: node scripts/calibrate-colors.js <input-image> [output-dir]');
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // ── Load image ────────────────────────────────────────────────────
  console.log(`Loading ${inputPath} …`);
  const img = sharp(inputPath);
  const { width, height } = await img.metadata();
  const raw = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageData = raw.data; // RGBA
  console.log(`  ${width}×${height}  (${imageData.length / 4} pixels)`);

  // ── Init WASM ─────────────────────────────────────────────────────
  const wasmPath = path.resolve(__dirname, '../src/wasm/super_collage.js');
  const wasmMod = await import(wasmPath);
  const wasmBinaryPath = path.resolve(__dirname, '../src/wasm/super_collage_bg.wasm');
  const wasmBytes = new Uint8Array(fs.readFileSync(wasmBinaryPath));
  await wasmMod.default({ module_or_path: wasmBytes });

  const {
    build_color_lut,
    separate_colors_with_lut,
    simulate_print,
    evaluate_palettes,
  } = wasmMod;

  // ── Prepare candidate data ────────────────────────────────────────
  const candidateColors = [];
  const candidateCounts = [];
  for (const cand of CANDIDATES) {
    const bytes = [];
    for (const name of cand.colors) {
      const riso = RISO.find(c => c.name === name);
      bytes.push(...hexBytes(riso.hex));
    }
    candidateColors.push(...bytes);
    candidateCounts.push(cand.colors.length);
  }

  // ── Evaluate all palettes ─────────────────────────────────────────
  console.log('\nEvaluating palettes …');
  const scores = evaluate_palettes(
    imageData,
    width,
    height,
    new Uint8Array(candidateColors),
    new Uint32Array(candidateCounts),
    3,   // max_mix
    16,  // grid_size
  );

  // wasm-bindgen returns a Float64Array-like object
  const scoreArray = Array.from(scores);

  // ── Rank and print ────────────────────────────────────────────────
  const ranked = scoreArray
    .map((score, i) => ({ score, i, name: CANDIDATES[i].name, colors: CANDIDATES[i].colors }))
    .sort((a, b) => a.score - b.score);

  console.log('\n  Rank  Score (ΔE)  Palette');
  console.log('  ───────────────────────────────────────────────');
  for (let rank = 0; rank < ranked.length; rank++) {
    const r = ranked[rank];
    const marker = rank === 0 ? '★' : ' ';
    console.log(`  ${marker} ${String(rank + 1).padStart(2)}   ${r.score.toFixed(4).padStart(9)}  ${r.name} (${r.colors.join(', ')})`);
  }

  // ── Render and save every candidate ───────────────────────────────
  console.log('\nRendering composites …');
  let colorOffset = 0;
  for (let i = 0; i < CANDIDATES.length; i++) {
    const cand = CANDIDATES[i];
    const count = cand.colors.length;
    const paletteBytes = candidateColors.slice(colorOffset, colorOffset + count * 3);
    colorOffset += count * 3;

    // Build LUT, separate, simulate print
    const lut = build_color_lut(new Uint8Array(paletteBytes), 3, 16);
    const plates = separate_colors_with_lut(
      imageData, width, height, lut, 16, count,
    );
    const composite = simulate_print(
      plates, new Uint8Array(paletteBytes), width, height, count,
    );

    // Save composite
    const compositePath = path.join(outputDir, `${cand.name}.composite.png`);
    await sharp(Buffer.from(composite), {
      raw: { width, height, channels: 4 },
    }).png().toFile(compositePath);

    // Save individual plates
    const pixelCount = width * height;
    for (let c = 0; c < count; c++) {
      const plateStart = c * pixelCount * 4;
      const plateData = plates.slice(plateStart, plateStart + pixelCount * 4);
      const platePath = path.join(outputDir, `${cand.name}.plate-${cand.colors[c]}.png`);
      await sharp(Buffer.from(plateData), {
        raw: { width, height, channels: 4 },
      }).png().toFile(platePath);
    }

    console.log(`  ${cand.name}: score=${scoreArray[i].toFixed(4)} → ${compositePath}`);
  }

  // ── Save best composite as "best.png" ─────────────────────────────
  const best = ranked[0];
  const bestSrc = path.join(outputDir, `${best.name}.composite.png`);
  const bestDst = path.join(outputDir, 'best.png');
  fs.copyFileSync(bestSrc, bestDst);
  console.log(`\nBest palette: ${best.name} (ΔE = ${best.score.toFixed(4)})`);
  console.log(`Copied best composite to ${bestDst}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
