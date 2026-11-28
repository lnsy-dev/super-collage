/* ═══════════════════════════════════════════════════════════════════
   Pixel Pipeline (pure)

   The per-pixel render chain for image/shape layers, extracted from
   ImageProcessor so it can run in TWO places without drifting apart:

     - the main thread (fallback when the process worker is unavailable,
       and for text layers whose font shaping needs document.fonts), and
     - the process worker (src/app/worker/process-worker.js), which is
       where the megapixel-class work is meant to run.

   Every function here is pure with respect to the app: no DOM, no
   State, no Renderer, no DB. Inputs are OffscreenCanvas/ImageBitmap/
   ImageData and plain param objects (the shape of Layer.toRecord plus
   computed target fields), so the same code produces bit-identical
   output in both environments.
   ═══════════════════════════════════════════════════════════════════ */

import { hexToRgb } from '../utils/color.js';
import { clamp } from '../utils/math.js';
import { BAYER8 } from './constants.js';
import { clampDims } from './canvas-limits.js';
import { minCellForRender } from './pattern-size.js';
import { renderShapeLayerBitmap } from './shape-bitmap.js';

/**
 * Cap a processing target into the browser's canvas allocation envelope.
 * Layer natural sizes are clamped at allocation time, but text layers
 * grow their natural size on every box resize/refit and SVG/raster targets
 * derive from display geometry — any of these can exceed the canvas cap,
 * which allocates a dead 0×0 backing store whose every readback throws
 * (the resize-then-flatten crash).
 */
export function fitTarget(width, height) {
  const fit = clampDims(width, height);
  // Keep at least a tiny live target so the layer still renders even if
  // the caller requested something pathological.
  return { w: Math.max(1, fit.w), h: Math.max(1, fit.h) };
}

/* ─── GRADIENT CANVAS GENERATOR ─────────────────────────────────── */
export function generateGradientCanvas(width, height, gradient) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const stops = gradient.stops;

  if (gradient.type === 'multipolar') {
    const poles = gradient.poles;
    if (!poles || poles.length < 2) {
      // fall back to linear with first two stops
      return generateGradientCanvas(width, height, { ...gradient, type: 'linear' });
    }
    // Compute at 1/4 resolution for performance, then scale up
    const sw = Math.max(1, Math.round(width / 4));
    const sh = Math.max(1, Math.round(height / 4));
    const small = new OffscreenCanvas(sw, sh);
    const sCtx = small.getContext('2d', { willReadFrequently: true });
    const imgData = sCtx.createImageData(sw, sh);
    const d = imgData.data;
    const parsedPoles = poles.map(p => ({
      x: p.x * sw, y: p.y * sh,
      ...hexToRgb(p.color),
    }));
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        let wSum = 0, rSum = 0, gSum = 0, bSum = 0;
        for (const pole of parsedPoles) {
          const dx = px - pole.x, dy = py - pole.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1e-6;
          const w = 1 / (dist * dist);
          wSum += w; rSum += w * pole.r; gSum += w * pole.g; bSum += w * pole.b;
        }
        const idx = (py * sw + px) * 4;
        d[idx] = rSum / wSum; d[idx+1] = gSum / wSum; d[idx+2] = bSum / wSum; d[idx+3] = 255;
      }
    }
    sCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(small, 0, 0, width, height);
    return canvas;
  }

  let grad;
  if (gradient.type === 'linear') {
    const rad = (gradient.angle || 0) * Math.PI / 180;
    const halfDiag = Math.sqrt(width * width + height * height) / 2;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(rad);
    grad = ctx.createLinearGradient(-halfDiag, 0, halfDiag, 0);
    stops.forEach(s => grad.addColorStop(s.position, s.color));
    ctx.fillStyle = grad;
    ctx.fillRect(-halfDiag, -halfDiag * 2, halfDiag * 2, halfDiag * 4);
    ctx.restore();
  } else if (gradient.type === 'circular') {
    const cx = (gradient.centerX ?? 0.5) * width;
    const cy = (gradient.centerY ?? 0.5) * height;
    const maxDx = Math.max(cx, width - cx);
    const maxDy = Math.max(cy, height - cy);
    const outerR = Math.sqrt(maxDx * maxDx + maxDy * maxDy);
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
    stops.forEach(s => grad.addColorStop(s.position, s.color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (gradient.type === 'conic') {
    const cx = (gradient.centerX ?? 0.5) * width;
    const cy = (gradient.centerY ?? 0.5) * height;
    const startAngle = (gradient.angle || 0) * Math.PI / 180;
    grad = ctx.createConicGradient(startAngle, cx, cy);
    stops.forEach(s => grad.addColorStop(s.position, s.color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else {
    // fallback: solid first stop color
    ctx.fillStyle = stops[0]?.color || '#000';
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

/**
 * Render a gradient that is defined over a page-space bounding box
 * (gradientBounds) into a canvas sized to the layer's target render size.
 * This lets multiple layers share one continuous gradient stretched across
 * all of them ("sub items").
 */
export function generateStretchedGradientCanvas(targetW, targetH, gradient, layer, bounds) {
  const bw = Number(bounds && bounds.width) || 0;
  const bh = Number(bounds && bounds.height) || 0;
  if (!(bw > 0) || !(bh > 0)) return generateGradientCanvas(targetW, targetH, gradient);
  const gradCanvas = generateGradientCanvas(bw, bh, gradient);
  const out = new OffscreenCanvas(targetW, targetH);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const sx = targetW / (layer.width || 1);
  const sy = targetH / (layer.height || 1);
  // Source region in gradient-bounds space covered by this layer.
  const srcX = (layer.x || 0) - (bounds.x || 0);
  const srcY = (layer.y || 0) - (bounds.y || 0);
  const srcW = layer.width || 0;
  const srcH = layer.height || 0;
  if (srcW > 0 && srcH > 0) {
    ctx.drawImage(gradCanvas, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);
  } else {
    ctx.drawImage(gradCanvas, 0, 0, targetW, targetH);
  }
  return out;
}

/* ─── PATTERN CANVAS GENERATOR ──────────────────────────────────── */
export function generatePatternCanvas(width, height, pattern, scale = 1) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { type, color1, color2, size, angle } = pattern;
  const tileSize = Math.max(4, Math.round(size * scale)) * 2;
  const tile = new OffscreenCanvas(tileSize, tileSize);
  const tCtx = tile.getContext('2d');
  tCtx.fillStyle = color1;
  tCtx.fillRect(0, 0, tileSize, tileSize);

  if (type === 'stripes') {
    const bar = tileSize / 2;
    tCtx.fillStyle = color2;
    tCtx.fillRect(bar, 0, bar, tileSize);
  } else if (type === 'polka') {
    const r = tileSize / 4;
    tCtx.fillStyle = color2;
    tCtx.beginPath();
    tCtx.arc(tileSize / 2, tileSize / 2, r, 0, Math.PI * 2);
    tCtx.fill();
  } else if (type === 'stars') {
    const cx = tileSize / 2, cy = tileSize / 2;
    const outerR = tileSize / 2.5;
    const innerR = outerR * 0.45;
    const points = 5;
    tCtx.fillStyle = color2;
    tCtx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = (i % 2 === 1) ? innerR : outerR;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      i === 0 ? tCtx.moveTo(px, py) : tCtx.lineTo(px, py);
    }
    tCtx.closePath();
    tCtx.fill();
  }

  const pat = ctx.createPattern(tile, 'repeat');
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((angle || 0) * Math.PI / 180);
  ctx.fillStyle = pat;
  const diag = Math.sqrt(width * width + height * height);
  ctx.fillRect(-diag, -diag, diag * 2, diag * 2);
  ctx.restore();
  return canvas;
}

/* ─── PER-PIXEL STEPS ───────────────────────────────────────────── */

export function toGrayscale(px) {
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
    d[i] = d[i+1] = d[i+2] = gray;
  }
  return px;
}

export function applyBrightness(px, brightness) {
  const offset = brightness * 2.55;
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = clamp(d[i]   + offset, 0, 255);
    d[i+1] = clamp(d[i+1] + offset, 0, 255);
    d[i+2] = clamp(d[i+2] + offset, 0, 255);
  }
  return px;
}

export function applyContrast(px, contrast) {
  const c = contrast * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = clamp(factor * (d[i]   - 128) + 128, 0, 255);
    d[i+1] = clamp(factor * (d[i+1] - 128) + 128, 0, 255);
    d[i+2] = clamp(factor * (d[i+2] - 128) + 128, 0, 255);
  }
  return px;
}

export function applyInvert(px) {
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = 255 - d[i];
    d[i+1] = 255 - d[i+1];
    d[i+2] = 255 - d[i+2];
  }
  return px;
}

export function posterize(px, levels) {
  const d = px.data;
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(Math.round(d[i] / step) * step);
    d[i] = d[i+1] = d[i+2] = v;
  }
  return px;
}

export function applyHalftone(px, w, h, type, size, angle) {
  if (type === 'dither')    return bayerDither(px, w, h, size);
  if (type === 'magazine')  return magazineDots(px, w, h, size, angle ?? 45);
  if (type === 'grunge')    return grungeDots(px, w, h, size, angle ?? 45);
  return px;
}

export function bayerDither(px, w, h, cellSize) {
  const d = px.data;
  const n = 8;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const mx = Math.floor(x / cellSize) % n;
      const my = Math.floor(y / cellSize) % n;
      const threshold = BAYER8[my * n + mx];
      const out = gray < threshold ? 0 : 255;
      d[i] = d[i+1] = d[i+2] = out;
    }
  }
  return px;
}

export function magazineDots(px, w, h, cellSize, angleDeg) {
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'black';
  const d = px.data;
  const angle = (angleDeg ?? 45) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = w / 2, cy = h / 2;
  const half = Math.floor(cellSize / 2);
  const range = Math.ceil(Math.sqrt(w * w + h * h) / 2) + cellSize;
  for (let gy = -range; gy < range; gy += cellSize) {
    for (let gx = -range; gx < range; gx += cellSize) {
      const rx = gx * cos - gy * sin + cx;
      const ry = gx * sin + gy * cos + cy;
      if (rx < -cellSize || rx > w + cellSize || ry < -cellSize || ry > h + cellSize) continue;
      let sum = 0, cnt = 0;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const sx = Math.round(rx + dx);
          const sy = Math.round(ry + dy);
          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            const i = (sy * w + sx) * 4;
            sum += 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
            cnt++;
          }
        }
      }
      const avg = cnt ? sum / cnt : 255;
      const r = (1 - avg / 255) * (cellSize * 0.55);
      if (r > 0.4) {
        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return ctx.getImageData(0, 0, w, h);
}

export function grungeDots(px, w, h, cellSize, angleDeg) {
  // Seeded pseudo-random so output is stable per render
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'black';

  const d = px.data;
  const angle = (angleDeg ?? 45) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const cx = w / 2, cy = h / 2;
  const half = Math.floor(cellSize / 2);
  const range = Math.ceil(Math.sqrt(w * w + h * h) / 2) + cellSize;

  for (let gy = -range; gy < range; gy += cellSize) {
    for (let gx = -range; gx < range; gx += cellSize) {
      // Random positional jitter up to ~30% of cell
      const jx = (rand() - 0.5) * cellSize * 0.2;
      const jy = (rand() - 0.5) * cellSize * 0.2;
      const rx = gx * cos - gy * sin + cx + jx;
      const ry = gx * sin + gy * cos + cy + jy;
      if (rx < -cellSize || rx > w + cellSize || ry < -cellSize || ry > h + cellSize) continue;

      let sum = 0, cnt = 0;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const sx = Math.round(rx + dx), sy = Math.round(ry + dy);
          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            const i = (sy * w + sx) * 4;
            sum += 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
            cnt++;
          }
        }
      }
      const avg = cnt ? sum / cnt : 255;
      const darkness = 1 - avg / 255;

      // Dot AREA must track darkness (√ response) so the rendered tone
      // follows the source gradient linearly — a radius-linear response
      // makes area quadratic, which visually bunches midtones into hard
      // steps (banding).
      const baseR = Math.sqrt(darkness) * (cellSize * 0.55);
      const r = baseR * (0.95 + rand() * 0.1);

      // Fade tiny dots in smoothly instead of cutting them off at a fixed
      // threshold — hard visibility cliffs read as banding in gradients.
      const t = (darkness - 0.01) / (0.07 - 0.01);           // 0..1 over the fade band
      const alpha = Math.max(0, Math.min(1, t));
      if (alpha <= 0) continue;
      const drawR = Math.max(r, 0.35);

      // Randomly choose shape: circle, slightly squashed ellipse, or splat
      const shapeChoice = rand();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      if (shapeChoice < 0.55) {
        // Plain circle (most common)
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
      } else if (shapeChoice < 0.82) {
        // Squashed / rotated ellipse
        const rot = rand() * Math.PI;
        const xScale = 0.6 + rand() * 0.8;
        const yScale = 0.6 + rand() * 0.8;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(rot);
        ctx.scale(xScale, yScale);
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.restore();
      } else {
        // Rough splat: draw a polygon with ragged radius
        const sides = 5 + Math.floor(rand() * 4); // 5–8 sides
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(rand() * Math.PI * 2);
        for (let s = 0; s < sides; s++) {
          const a = (s / sides) * Math.PI * 2;
          const rr = r * (0.7 + rand() * 0.6);
          const px2 = Math.cos(a) * rr, py2 = Math.sin(a) * rr;
          s === 0 ? ctx.moveTo(px2, py2) : ctx.lineTo(px2, py2);
        }
        ctx.closePath();
        ctx.restore();
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  return ctx.getImageData(0, 0, w, h);
}

export function colorize(px, hex, layer) {
  const d = px.data;
  if (layer && layer.colorMode === 'gradient' && layer.gradient) {
    const nw = px.width, nh = px.height;
    const gradCanvas = layer.gradientBounds
      ? generateStretchedGradientCanvas(nw, nh, layer.gradient, layer, layer.gradientBounds)
      : generateGradientCanvas(nw, nh, layer.gradient);
    const gradData = gradCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, nw, nh).data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      if (gray < 128) {
        d[i] = gradData[i]; d[i+1] = gradData[i+1]; d[i+2] = gradData[i+2]; d[i+3] = 255;
      } else {
        d[i+3] = 0;
      }
    }
    return px;
  }
  if (layer && layer.colorMode === 'pattern' && layer.pattern) {
    const nw = px.width, nh = px.height;
    const patScale = nw / layer.naturalWidth;
    const patCanvas = generatePatternCanvas(nw, nh, layer.pattern, patScale);
    const patData = patCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, nw, nh).data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      if (gray < 128) {
        d[i] = patData[i]; d[i+1] = patData[i+1]; d[i+2] = patData[i+2]; d[i+3] = 255;
      } else {
        d[i+3] = 0;
      }
    }
    return px;
  }
  const { r, g, b } = hexToRgb(hex);
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    if (gray < 128) {
      d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255;
    } else {
      d[i+3] = 0;
    }
  }
  return px;
}

/* ─── PATTERN-KNOB SCALING ──────────────────────────────────────── */

/**
 * Scale a pattern-size knob (halftone/dither cell, dot grid spacing)
 * from the layer's natural-resolution pixels to a render at
 * `patternScale` × that resolution. Patterned output (dither cells,
 * screens, dots) is anchored to natural pixels: rendering the same
 * layer at a different bitmap resolution must scale the pattern with
 * the bitmap or the on-page pattern size changes.
 */
export function scaledPatternSize(size, patternScale) {
  if (!patternScale || patternScale === 1) return size;
  return Math.max(1, Math.round(size * patternScale));
}

/**
 * Render-ratio fallback for pattern knobs: callers that render at a
 * different bitmap resolution than the layer's natural size (previews,
 * custom composite targets) scale the knobs by targetW/naturalWidth so
 * patterns keep their on-page size. Callers that already computed a
 * ratio (e.g. the merge composite) pass it explicitly.
 */
export function renderRatio(patternScale, naturalWidth, targetW) {
  if (patternScale) return patternScale;
  return naturalWidth > 0 ? targetW / naturalWidth : 1;
}

/**
 * Effective halftone cell size (bitmap px) for a render.
 *
 * The knob is anchored to the layer's natural-resolution pixels and
 * scaled by the render ratio (`patternScale`). Dot screens (magazine
 * "Dots" and "Grunge") are additionally floored at the magazine-size
 * anchor: pages rasterize at 600 dpi and a magazine screen (133–150 lpi)
 * spans ~4 device px per cell (600/150 = 4), so knob settings below that
 * keep rendering at the magazine pitch instead of collapsing into
 * sub-pixel noise (see pattern-size.js for the lpi/dpi math).
 */
export function halftoneCell(p, patternScale, targetW) {
  const scaled = scaledPatternSize(p.halftoneSize, patternScale);
  const isDotScreen = p.halftoneType === 'magazine' || p.halftoneType === 'grunge';
  if (!isDotScreen) return scaled;
  return Math.max(1, scaled, Math.round(minCellForRender(targetW, p.width)));
}

/* ─── PIPELINE ORCHESTRATION ────────────────────────────────────── */

/**
 * The generic single-ink chain, exactly mirroring the body of
 * ImageProcessor.processLayer (grayscale → brightness → contrast →
 * invert → grayscale-halftone / posterize+halftone+colorize).
 *
 * `p` carries the layer fields the chain reads: brightness, contrast,
 * invert, halftoneType, halftoneSize, halftoneAngle, color, colorMode,
 * gradient, pattern, gradientBounds, naturalWidth, naturalHeight,
 * width, height, x, y — plus targetW/targetH and the renderRatio for
 * the pattern knobs.
 */
export function runPixelPipeline(px, p) {
  px = toGrayscale(px);
  px = applyBrightness(px, p.brightness);
  px = applyContrast(px, p.contrast);
  if (p.invert) px = applyInvert(px);
  if (p.halftoneType === 'grayscale') {
    const d = px.data;
    if (p.colorMode === 'gradient' && p.gradient) {
      const gradCanvas = p.gradientBounds
        ? generateStretchedGradientCanvas(p.targetW, p.targetH, p.gradient, p, p.gradientBounds)
        : generateGradientCanvas(p.targetW, p.targetH, p.gradient);
      const gradData = gradCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, p.targetW, p.targetH).data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        d[i] = gradData[i]; d[i+1] = gradData[i+1]; d[i+2] = gradData[i+2];
        d[i+3] = Math.round(255 - gray);
      }
    } else if (p.colorMode === 'pattern' && p.pattern) {
      const patScale = p.targetW / p.naturalWidth;
      const patCanvas = generatePatternCanvas(p.targetW, p.targetH, p.pattern, patScale);
      const patData = patCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, p.targetW, p.targetH).data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        d[i] = patData[i]; d[i+1] = patData[i+1]; d[i+2] = patData[i+2];
        d[i+3] = Math.round(255 - gray);
      }
    } else {
      const { r: cr, g: cg, b: cb } = hexToRgb(p.color);
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        d[i] = cr; d[i+1] = cg; d[i+2] = cb;
        d[i+3] = Math.round(255 - gray);
      }
    }
  } else {
    if (p.halftoneType !== 'none') {
      if (p.colorMode === 'gradient' && p.gradient) {
        const gradCanvas = p.gradientBounds
          ? generateStretchedGradientCanvas(p.targetW, p.targetH, p.gradient, p, p.gradientBounds)
          : generateGradientCanvas(p.targetW, p.targetH, p.gradient);
        const gradData = gradCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, p.targetW, p.targetH).data;
        const d = px.data;
        for (let i = 0; i < d.length; i += 4) {
          const gradGray = Math.round(0.299 * gradData[i] + 0.587 * gradData[i+1] + 0.114 * gradData[i+2]);
          const deepened = Math.round(Math.pow(gradGray / 255, 2.5) * 255);
          d[i] = d[i+1] = d[i+2] = Math.max(d[i], deepened);
        }
      } else if (p.colorMode === 'pattern' && p.pattern) {
        const patScale = p.targetW / p.naturalWidth;
        const patCanvas = generatePatternCanvas(p.targetW, p.targetH, p.pattern, patScale);
        const patData = patCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, p.targetW, p.targetH).data;
        const d = px.data;
        for (let i = 0; i < d.length; i += 4) {
          const patGray = Math.round(0.299 * patData[i] + 0.587 * patData[i+1] + 0.114 * patData[i+2]);
          const deepened = Math.round(Math.pow(patGray / 255, 2.5) * 255);
          d[i] = d[i+1] = d[i+2] = Math.max(d[i], deepened);
        }
      }
      px = posterize(px, 6);
      // Pattern sizes (dither cells, dot grids) are anchored to the
      // layer's natural-resolution pixels; scale them with the render
      // ratio so a pattern rasterized at a custom target keeps its
      // on-page size instead of shrinking/stretching with the bitmap.
      px = applyHalftone(px, p.targetW, p.targetH, p.halftoneType,
        halftoneCell(p, p.renderRatio, p.targetW), p.halftoneAngle);
    }
    // An explicit color override always colorizes solid, ignoring the
    // layer's gradient/pattern mode (export plate inks).
    px = colorize(px, p.color, p.colorOverride ? null : p);
  }
  return px;
}

/**
 * One shape channel (fill or stroke) through the solid-ink chain —
 * exactly mirroring ImageProcessor.processShapePart: draw the channel
 * bitmap scaled to the target, grayscale → brightness → contrast →
 * invert → halftone (no grayscale-halftone branch; per-part inks are
 * always solid), colorize with the part's ink.
 */
export function shapePartFromBitmap(srcBitmap, partColor, p) {
  const work = new OffscreenCanvas(p.targetW, p.targetH);
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(srcBitmap, 0, 0, p.targetW, p.targetH);
  let px = ctx.getImageData(0, 0, p.targetW, p.targetH);
  px = toGrayscale(px);
  px = applyBrightness(px, p.brightness);
  px = applyContrast(px, p.contrast);
  if (p.invert) px = applyInvert(px);
  if (p.halftoneType !== 'none') {
    px = applyHalftone(px, p.targetW, p.targetH, p.halftoneType,
      halftoneCell(p, p.renderRatio, p.targetW), p.halftoneAngle);
  }
  px = colorize(px, partColor, null);
  ctx.putImageData(px, 0, 0);
  return work;
}

/**
 * Compose the processed layer bitmap from source parts.
 *
 *   parts = [{ bitmap, color }] — one entry for the generic chain; two
 *   entries (fill body, stroke ring) for a two-tone shape, where each
 *   channel runs the solid-ink chain with its own ink and the stroke is
 *   overprinted on the body (mirroring processShapePart + the merge).
 *
 * Used by the process worker AND by the main-thread fallback, so both
 * environments produce identical output by construction.
 */
export function composeProcessedCanvas(parts, p) {
  if (p.mode === 'twoToneShape') {
    const merged = shapePartFromBitmap(parts[0].bitmap, parts[0].color, p);
    const strokePart = shapePartFromBitmap(parts[1].bitmap, parts[1].color, p);
    if (merged && strokePart) {
      merged.getContext('2d').drawImage(strokePart, 0, 0);
    }
    return merged;
  }
  const work = new OffscreenCanvas(p.targetW, p.targetH);
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(parts[0].bitmap, 0, 0, p.targetW, p.targetH);
  let px = ctx.getImageData(0, 0, p.targetW, p.targetH);
  px = runPixelPipeline(px, p);
  ctx.putImageData(px, 0, 0);
  return work;
}

/* ─── GRADIENT / PATTERN WEIGHT MAPS ────────────────────────────── */

export function buildGradientWeightMap(nw, nh, gradient, stopIdx) {
  const gradCanvas = generateGradientCanvas(nw, nh, gradient);
  const gradData = gradCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, nw, nh).data;
  const stops = gradient.stops;
  const parsedStops = stops.map(s => hexToRgb(s.color));
  const weightMap = new Float32Array(nw * nh);
  for (let i = 0; i < nw * nh; i++) {
    const pr = gradData[i*4], pg = gradData[i*4+1], pb = gradData[i*4+2];
    let totalWeight = 0;
    const weights = parsedStops.map(s => {
      const dist = Math.sqrt((pr-s.r)**2 + (pg-s.g)**2 + (pb-s.b)**2) + 1e-6;
      const w = 1 / (dist * dist);
      totalWeight += w;
      return w;
    });
    weightMap[i] = totalWeight > 0 ? weights[stopIdx] / totalWeight : 0;
  }
  return weightMap;
}

export function buildPatternWeightMap(nw, nh, pattern, colorIdx) {
  const patCanvas = generatePatternCanvas(nw, nh, pattern);
  const patData = patCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, nw, nh).data;
  const target = colorIdx === 0 ? pattern.color1 : pattern.color2;
  const { r: tr, g: tg, b: tb } = hexToRgb(target);
  const weightMap = new Float32Array(nw * nh);
  for (let i = 0; i < nw * nh; i++) {
    const pr = patData[i*4], pg = patData[i*4+1], pb = patData[i*4+2];
    const dist = Math.sqrt((pr-tr)**2 + (pg-tg)**2 + (pb-tb)**2);
    weightMap[i] = dist < 30 ? 1.0 : 0.0;
  }
  return weightMap;
}
