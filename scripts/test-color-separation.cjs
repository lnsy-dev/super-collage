const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');

/* ═══════════════════════════════════════════════════════════════════
   Color Separation Test Loop
   Compare our 4-ink decomposition against Spectralite PDF references
   ═══════════════════════════════════════════════════════════════════ */

const TEST_IMAGE = path.join(__dirname, '..', 'test-results', '00002-3517528452.jpg');
const PREVIEW_PDF = path.join(__dirname, '..', 'test-results', '00002-3517528452.black-aqua-yellow-fluorescentpink.preview.pdf');
const PLATE_PDFS = [
  { name: 'black',  file: '00002-3517528452.grayscale.ink-1-black.pdf' },
  { name: 'aqua',   file: '00002-3517528452.grayscale.ink-2-aqua.pdf' },
  { name: 'yellow', file: '00002-3517528452.grayscale.ink-3-yellow.pdf' },
  { name: 'pink',   file: '00002-3517528452.grayscale.ink-4-fluorescentpink.pdf' },
];
const OUT_DIR = path.join(__dirname, '..', 'test-results', 'test-output');

// Ensure output dir exists
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

/* ─── Convert PDFs to PNGs at original image resolution ─────────── */
async function convertPdfs() {
  const meta = await sharp(TEST_IMAGE).metadata();
  const targetW = meta.width;
  const targetH = meta.height;
  console.log(`Converting PDFs to ${targetW}×${targetH}…`);

  const refs = {};

  // Preview
  const previewPng = path.join(OUT_DIR, 'ref-preview.png');
  execSync(`pdftoppm -png -scale-to-x ${targetW} -scale-to-y ${targetH} "${PREVIEW_PDF}" "${path.join(OUT_DIR, 'ref-preview')}"`);
  // pdftoppm appends -1.png
  fs.renameSync(path.join(OUT_DIR, 'ref-preview-1.png'), previewPng);
  refs.preview = previewPng;

  // Plates
  for (const plate of PLATE_PDFS) {
    const src = path.join(__dirname, '..', 'test-results', plate.file);
    const base = path.join(OUT_DIR, `ref-${plate.name}`);
    execSync(`pdftoppm -png -scale-to-x ${targetW} -scale-to-y ${targetH} "${src}" "${base}"`);
    const out = `${base}.png`;
    fs.renameSync(`${base}-1.png`, out);
    refs[plate.name] = out;
  }

  return refs;
}

/* ─── Color math (ported from Rust) ─────────────────────────────── */

function srgbByteToLinear(v) {
  const s = v / 255.0;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearToLab(r, g, b) {
  let x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  let y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  let z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;

  function f(t) {
    return t > 0.008856 ? Math.pow(t, 1.0 / 3.0) : 7.787 * t + 16.0 / 116.0;
  }

  const fx = f(x / 0.95047);
  const fy = f(y / 1.0);
  const fz = f(z / 1.08883);

  return {
    l: Math.max(0.0, 116.0 * fy - 16.0),
    a: 500.0 * (fx - fy),
    b: 200.0 * (fy - fz),
  };
}

function labDistanceSq(a, b) {
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dl * dl + da * da + db * db;
}

function geometricMix(inks, weights) {
  let r = 1.0, g = 1.0, b = 1.0;
  for (let i = 0; i < inks.length; i++) {
    const w = weights[i];
    if (w <= 0.0) continue;
    r *= Math.pow(inks[i].r, w);
    g *= Math.pow(inks[i].g, w);
    b *= Math.pow(inks[i].b, w);
  }
  return { r, g, b };
}

/* ─── LUT building ──────────────────────────────────────────────── */

function buildPowCache(colors) {
  const numColors = colors.length;
  // cache[color][step] where step is 0..10
  const cacheR = Array.from({ length: numColors }, () => new Float64Array(11));
  const cacheG = Array.from({ length: numColors }, () => new Float64Array(11));
  const cacheB = Array.from({ length: numColors }, () => new Float64Array(11));
  for (let i = 0; i < numColors; i++) {
    for (let step = 0; step <= 10; step++) {
      const w = step / 10.0;
      cacheR[i][step] = Math.pow(colors[i].r, w);
      cacheG[i][step] = Math.pow(colors[i].g, w);
      cacheB[i][step] = Math.pow(colors[i].b, w);
    }
  }
  return { cacheR, cacheG, cacheB };
}

function mixFromCache(cacheR, cacheG, cacheB, idxs, weightsTenths) {
  let rr = 1.0, gg = 1.0, bb = 1.0;
  for (let k = 0; k < idxs.length; k++) {
    const wt = weightsTenths[k];
    if (wt === 0) continue;
    rr *= cacheR[idxs[k]][wt];
    gg *= cacheG[idxs[k]][wt];
    bb *= cacheB[idxs[k]][wt];
  }
  return { r: rr, g: gg, b: bb };
}

function buildLutCell(targetRgb, colors, cacheR, cacheG, cacheB, maxMix) {
  const targetLab = linearToLab(targetRgb.r, targetRgb.g, targetRgb.b);
  const numColors = colors.length;
  let bestError = Infinity;
  let bestWeights = new Float64Array(numColors);

  // No ink (paper white)
  const whiteLab = linearToLab(1.0, 1.0, 1.0);
  let whiteErr = labDistanceSq(targetLab, whiteLab);
  if (whiteErr < bestError) {
    bestError = whiteErr;
    bestWeights.fill(0.0);
  }

  // 1-color search
  for (let c = 0; c < numColors; c++) {
    for (let step = 1; step <= 10; step++) {
      const mix = { r: cacheR[c][step], g: cacheG[c][step], b: cacheB[c][step] };
      const err = labDistanceSq(targetLab, linearToLab(mix.r, mix.g, mix.b));
      if (err < bestError) {
        bestError = err;
        bestWeights.fill(0.0);
        bestWeights[c] = step / 10.0;
      }
    }
  }

  // 2-color search
  if (maxMix >= 2) {
    for (let i = 0; i < numColors; i++) {
      for (let j = i + 1; j < numColors; j++) {
        for (let step = 1; step <= 4; step++) {
          const w1 = step;
          const w2 = 10 - step;
          const mix = mixFromCache(cacheR, cacheG, cacheB, [i, j], [w1, w2]);
          const err = labDistanceSq(targetLab, linearToLab(mix.r, mix.g, mix.b));
          if (err < bestError) {
            bestError = err;
            bestWeights.fill(0.0);
            bestWeights[i] = w1 / 10.0;
            bestWeights[j] = w2 / 10.0;
          }
        }
      }
    }
  }

  // 3-color search
  if (maxMix >= 3) {
    const q = [0, 2, 5, 7];
    for (let i = 0; i < numColors; i++) {
      for (let j = i + 1; j < numColors; j++) {
        for (let k = j + 1; k < numColors; k++) {
          for (let a = 1; a <= 3; a++) {
            for (let b = 1; b <= 3 - a; b++) {
              const c = 4 - a - b;
              if (c === 0) continue;
              const mix = mixFromCache(cacheR, cacheG, cacheB, [i, j, k], [q[a], q[b], q[c]]);
              const err = labDistanceSq(targetLab, linearToLab(mix.r, mix.g, mix.b));
              if (err < bestError) {
                bestError = err;
                bestWeights.fill(0.0);
                bestWeights[i] = a / 4.0;
                bestWeights[j] = b / 4.0;
                bestWeights[k] = c / 4.0;
              }
            }
          }
        }
      }
    }
  }

  return bestWeights;
}

function buildColorLut(risoColors, maxMix, gridSize) {
  const numColors = risoColors.length;
  const gs = Math.max(2, Math.min(64, gridSize));
  const totalCells = gs * gs * gs;
  const lut = new Uint8Array(totalCells * 7); // 7 bytes per cell (max colors)

  const colors = risoColors.map(c => ({
    r: srgbByteToLinear(c.r),
    g: srgbByteToLinear(c.g),
    b: srgbByteToLinear(c.b),
  }));

  const { cacheR, cacheG, cacheB } = buildPowCache(colors);
  const scale = 1.0 / (gs - 1);

  for (let rz = 0; rz < gs; rz++) {
    for (let gy = 0; gy < gs; gy++) {
      for (let bx = 0; bx < gs; bx++) {
        const target = {
          r: srgbByteToLinear(Math.round(bx * scale * 255)),
          g: srgbByteToLinear(Math.round(gy * scale * 255)),
          b: srgbByteToLinear(Math.round(rz * scale * 255)),
        };
        const weights = buildLutCell(target, colors, cacheR, cacheG, cacheB, maxMix);
        const base = ((rz * gs + gy) * gs + bx) * 7;
        for (let c = 0; c < numColors; c++) {
          lut[base + c] = Math.round(weights[c] * 255);
        }
      }
    }
  }

  return { lut, gs, numColors };
}

function separateColorsWithLut(imageData, width, height, lutInfo) {
  const { lut, gs, numColors } = lutInfo;
  const pixelCount = width * height;
  const plates = new Uint8Array(pixelCount * 4 * numColors);
  const gsMinus1 = gs - 1;
  const lutStride = 7;

  for (let py = 0; py < pixelCount; py++) {
    const srcBase = py * 4;
    const ta = imageData[srcBase + 3];

    if (ta < 10) {
      for (let c = 0; c < numColors; c++) {
        const dstBase = (c * pixelCount + py) * 4;
        plates[dstBase] = 255;
        plates[dstBase + 1] = 255;
        plates[dstBase + 2] = 255;
        plates[dstBase + 3] = 255;
      }
      continue;
    }

    const r = imageData[srcBase];
    const g = imageData[srcBase + 1];
    const b = imageData[srcBase + 2];

    const rx = Math.min(gs - 1, Math.round((r / 255.0) * gsMinus1));
    const gY = Math.min(gs - 1, Math.round((g / 255.0) * gsMinus1));
    const bZ = Math.min(gs - 1, Math.round((b / 255.0) * gsMinus1));

    const lutBase = ((bZ * gs + gY) * gs + rx) * lutStride;

    for (let c = 0; c < numColors; c++) {
      const dstBase = (c * pixelCount + py) * 4;
      const ink = 255 - lut[lutBase + c];
      plates[dstBase] = ink;
      plates[dstBase + 1] = ink;
      plates[dstBase + 2] = ink;
      plates[dstBase + 3] = 255;
    }
  }

  return plates;
}

/* ─── Subtractive blend (ported from Rust) ──────────────────────── */

function blendSubtractive(base, overlay) {
  const result = new Uint8Array(base);
  let i = 0;
  while (i < result.length) {
    const oa = overlay[i + 3];
    if (oa > 0) {
      const mr = 255 * (255 - oa) + overlay[i] * oa;
      const mg = 255 * (255 - oa) + overlay[i + 1] * oa;
      const mb = 255 * (255 - oa) + overlay[i + 2] * oa;
      result[i] = Math.round((result[i] * mr) / (255 * 255));
      result[i + 1] = Math.round((result[i + 1] * mg) / (255 * 255));
      result[i + 2] = Math.round((result[i + 2] * mb) / (255 * 255));
    }
    i += 4;
  }
  return result;
}

function simulatePrint(plates, width, height, inkColors) {
  let composite = new Uint8Array(width * height * 4).fill(255);
  const pixelCount = width * height;
  for (let c = 0; c < inkColors.length; c++) {
    const plate = new Uint8Array(plates.buffer, c * pixelCount * 4, pixelCount * 4);
    // Build overlay exactly as the app does: full ink color with alpha = density
    const overlay = new Uint8Array(pixelCount * 4);
    const { r: ir, g: ig, b: ib } = inkColors[c];
    for (let p = 0; p < pixelCount; p++) {
      const gray = plate[p * 4]; // 0 = full ink, 255 = no ink
      overlay[p * 4] = ir;
      overlay[p * 4 + 1] = ig;
      overlay[p * 4 + 2] = ib;
      overlay[p * 4 + 3] = 255 - gray; // alpha = ink density
    }
    composite = blendSubtractive(composite, overlay);
  }
  return composite;
}

/* ─── Error metrics ─────────────────────────────────────────────── */

function rmse(a, b) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += (a[i] - b[i]) ** 2;
    sum += (a[i + 1] - b[i + 1]) ** 2;
    sum += (a[i + 2] - b[i + 2]) ** 2;
    count += 3;
  }
  return Math.sqrt(sum / count);
}

function plateRmse(ourPlate, refPlate) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < ourPlate.length; i += 4) {
    sum += (ourPlate[i] - refPlate[i]) ** 2;
    count++;
  }
  return Math.sqrt(sum / count);
}

/* ─── Image I/O helpers ─────────────────────────────────────────── */

async function loadImageRgba(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

async function savePng(filePath, data, width, height) {
  await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
    .png()
    .toFile(filePath);
}

/* ─── Main test loop ────────────────────────────────────────────── */

async function main() {
  console.log('=== Color Separation Test Loop ===\n');

  // Check if reference files exist
  const hasRefs = fs.existsSync(TEST_IMAGE) && PLATE_PDFS.every(p => fs.existsSync(path.join(__dirname, '..', 'test-results', p.file)));

  let refs = {};
  let refPlates = {};

  if (hasRefs) {
    // 1. Convert reference PDFs
    refs = await convertPdfs();
    console.log('Reference PDFs converted.\n');

    // 2. Load reference plates
    for (const plate of PLATE_PDFS) {
      const img = await loadImageRgba(refs[plate.name]);
      refPlates[plate.name] = img.data;
      console.log(`Ref ${plate.name}: ${img.width}×${img.height}`);
    }
  } else {
    console.log('Reference PDFs not found - running without spectralite comparison.\n');
  }

  // 3. Load original image
  if (!fs.existsSync(TEST_IMAGE)) {
    console.log('Original test image not found:', TEST_IMAGE);
    console.log('Skipping test loop.');
    return;
  }
  const original = await loadImageRgba(TEST_IMAGE);
  console.log(`Original: ${original.width}×${original.height}`);

  // 3. Candidate color sets to test
  const candidates = [
    {
      name: 'App default (black #010101, aqua #5ec8e5)',
      colors: [
        { r: 1,   g: 1,   b: 1,   name: 'Black' },
        { r: 94,  g: 200, b: 229, name: 'Aqua' },
        { r: 255, g: 232, b: 0,   name: 'Yellow' },
        { r: 255, g: 72,  b: 176, name: 'Pink' },
      ],
    },
    {
      name: 'Pure black #000000 (degenerate mix)',
      colors: [
        { r: 0,   g: 0,   b: 0,   name: 'Black' },
        { r: 94,  g: 200, b: 229, name: 'Aqua' },
        { r: 255, g: 232, b: 0,   name: 'Yellow' },
        { r: 255, g: 72,  b: 176, name: 'Pink' },
      ],
    },
    {
      name: 'Deeper aqua (cyan #0099cc)',
      colors: [
        { r: 1,   g: 1,   b: 1,   name: 'Black' },
        { r: 0,   g: 153, b: 204, name: 'Cyan' },
        { r: 255, g: 232, b: 0,   name: 'Yellow' },
        { r: 255, g: 72,  b: 176, name: 'Pink' },
      ],
    },
  ];

  // Grid search around aqua and pink
  const aquaGs = [180, 200, 220, 240];
  const pinkGs = [52, 62, 72, 82];
  for (const ag of aquaGs) {
    for (const pg of pinkGs) {
      const aqua = { r: 0, g: ag, b: 229 };
      const pink = { r: 255, g: pg, b: 176 };
      candidates.push({
        name: `Grid A(0,${ag},229) P(255,${pg},176)`,
        colors: [
          { r: 1,   g: 1,   b: 1,   name: 'Black' },
          aqua,
          { r: 255, g: 232, b: 0,   name: 'Yellow' },
          pink,
        ],
      });
    }
  }

  console.log(`\nTesting ${candidates.length} candidate color sets…\n`);

  let bestOverall = null;
  let bestCompositeRmse = Infinity;

  for (const candidate of candidates) {
    console.log(`--- ${candidate.name} ---`);

    // Build LUT
    const t0 = Date.now();
    const lutInfo = buildColorLut(candidate.colors, 3, 16);
    const t1 = Date.now();

    // Separate
    const plates = separateColorsWithLut(original.data, original.width, original.height, lutInfo);
    const t2 = Date.now();

    // Simulate print
    const composite = simulatePrint(plates, original.width, original.height, candidate.colors);
    const t3 = Date.now();

    // Compute composite RMSE vs original
    const compositeRmse = rmse(composite, original.data);

    // Compute per-plate RMSE vs spectralite references (if available)
    const pixelCount = original.width * original.height;
    const plateNames = ['black', 'aqua', 'yellow', 'pink'];
    const plateRmses = {};
    if (hasRefs) {
      for (let i = 0; i < lutInfo.numColors; i++) {
        const ourPlate = new Uint8Array(plates.buffer, i * pixelCount * 4, pixelCount * 4);
        const refName = plateNames[i];
        if (refPlates[refName]) {
          plateRmses[refName] = plateRmse(ourPlate, refPlates[refName]);
        }
      }
    }

    console.log(`  LUT build: ${t1 - t0}ms | Separate: ${t2 - t1}ms | Blend: ${t3 - t2}ms`);
    console.log(`  Composite RMSE vs original: ${compositeRmse.toFixed(2)}`);
    for (const [name, val] of Object.entries(plateRmses)) {
      console.log(`  Plate ${name} RMSE vs spectralite: ${val.toFixed(2)}`);
    }

    // Save debug images for best candidate so far
    if (compositeRmse < bestCompositeRmse) {
      bestCompositeRmse = compositeRmse;
      bestOverall = candidate;

      // Save composite
      await savePng(path.join(OUT_DIR, 'best-composite.png'), composite, original.width, original.height);

      // Save plates
      for (let i = 0; i < lutInfo.numColors; i++) {
        const ourPlate = new Uint8Array(plates.buffer, i * pixelCount * 4, pixelCount * 4);
        await savePng(
          path.join(OUT_DIR, `best-plate-${candidate.colors[i].name.toLowerCase().replace(/\s+/g, '-')}.png`),
          ourPlate,
          original.width,
          original.height
        );
      }
    }

    console.log('');
  }

  console.log('=== BEST CANDIDATE ===');
  console.log(bestOverall.name);
  console.log('Colors:');
  for (const c of bestOverall.colors) {
    console.log(`  ${c.name}: rgb(${c.r}, ${c.g}, ${c.b})`);
  }
  console.log(`Composite RMSE: ${bestCompositeRmse.toFixed(2)}`);
  console.log(`\nDebug images saved to: ${OUT_DIR}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
