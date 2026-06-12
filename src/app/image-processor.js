/* ═══════════════════════════════════════════════════════════════════
   Image Processing Pipeline
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { hexToRgb } from '../utils/color.js';
import { clamp } from '../utils/math.js';
import { BAYER8 } from './constants.js';
import { TypeSetRenderer } from 'type-set';

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

/* ─── PATTERN CANVAS GENERATOR ──────────────────────────────────── */
export function generatePatternCanvas(width, height, pattern) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { type, color1, color2, size, angle } = pattern;
  const tileSize = Math.max(4, Math.round(size)) * 2;
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

/* ─── IMAGE PROCESSING PIPELINE ─────────────────────────────────── */
export const ImageProcessor = {

  _processCallCount: 0,

  getDisplayResolution(layer) {
    const nw = layer.naturalWidth, nh = layer.naturalHeight;
    const displayW = layer.width * State.zoom;
    const displayH = layer.height * State.zoom;
    const dpr = window.devicePixelRatio || 1;
    const quality = 1.5;
    let targetW = Math.min(nw, Math.max(64, Math.ceil(displayW * dpr * quality)));
    let targetH = Math.round(nh * (targetW / nw));
    const altH = Math.min(nh, Math.max(64, Math.ceil(displayH * dpr * quality)));
    const altW = Math.round(nw * (altH / nh));
    if (altW * altH < targetW * targetH) {
      targetW = altW;
      targetH = altH;
    }
    return { w: targetW, h: targetH };
  },

  async processLayer(layer, { forExport = false } = {}) {
    if (layer.isText) {
      await this.processTextLayer(layer, forExport);
      return layer._processedCanvas;
    }
    if (layer.isColorSeparation) {
      return this.processColorSeparation(layer, forExport);
    }
    if (!layer._originalCanvas && !(layer.isSvg && layer._svgImage)) return null;
    this._processCallCount++;
    const nw = layer.naturalWidth, nh = layer.naturalHeight;
    let targetW, targetH;
    if (layer.isSvg) {
      if (forExport) {
        targetW = layer.width;
        targetH = layer.height;
      } else {
        const displayW = layer.width * State.zoom;
        const displayH = layer.height * State.zoom;
        const dpr = window.devicePixelRatio || 1;
        const quality = 1.5;
        let tw = Math.max(64, Math.ceil(displayW * dpr * quality));
        let th = Math.round(layer.height * (tw / layer.width));
        const altTh = Math.max(64, Math.ceil(displayH * dpr * quality));
        const altTw = Math.round(layer.width * (altTh / layer.height));
        if (altTw * altTh < tw * th) {
          tw = altTw;
          th = altTh;
        }
        targetW = tw;
        targetH = th;
      }
    } else {
      if (forExport) {
        targetW = nw;
        targetH = nh;
      } else {
        const res = this.getDisplayResolution(layer);
        targetW = res.w;
        targetH = res.h;
      }
    }
    const work = new OffscreenCanvas(targetW, targetH);
    const ctx = work.getContext('2d', { willReadFrequently: true });
    if (layer.isSvg && layer._svgImage) {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(layer._svgImage, 0, 0, targetW, targetH);
    } else {
      ctx.drawImage(layer._originalCanvas, 0, 0, targetW, targetH);
    }
    let px = ctx.getImageData(0, 0, targetW, targetH);
    px = this.toGrayscale(px);
    px = this.applyBrightness(px, layer.brightness);
    px = this.applyContrast(px, layer.contrast);
    if (layer.invert) px = this.applyInvert(px);
    if (layer.halftoneType === 'grayscale') {
      const d = px.data;
      if (layer.colorMode === 'gradient' && layer.gradient) {
        const gradCanvas = generateGradientCanvas(targetW, targetH, layer.gradient);
        const gradData = gradCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, targetW, targetH).data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          d[i] = gradData[i]; d[i+1] = gradData[i+1]; d[i+2] = gradData[i+2];
          d[i+3] = Math.round(255 - gray);
        }
      } else if (layer.colorMode === 'pattern' && layer.pattern) {
        const patCanvas = generatePatternCanvas(targetW, targetH, layer.pattern);
        const patData = patCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, targetW, targetH).data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          d[i] = patData[i]; d[i+1] = patData[i+1]; d[i+2] = patData[i+2];
          d[i+3] = Math.round(255 - gray);
        }
      } else {
        const { r: cr, g: cg, b: cb } = hexToRgb(layer.color);
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          d[i] = cr; d[i+1] = cg; d[i+2] = cb;
          d[i+3] = Math.round(255 - gray);
        }
      }
    } else {
      if (layer.halftoneType !== 'none') {
        if (layer.colorMode === 'gradient' && layer.gradient) {
          const gradCanvas = generateGradientCanvas(targetW, targetH, layer.gradient);
          const gradData = gradCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, targetW, targetH).data;
          const d = px.data;
          for (let i = 0; i < d.length; i += 4) {
            const gradGray = Math.round(0.299 * gradData[i] + 0.587 * gradData[i+1] + 0.114 * gradData[i+2]);
            const deepened = Math.round(Math.pow(gradGray / 255, 2.5) * 255);
            d[i] = d[i+1] = d[i+2] = Math.max(d[i], deepened);
          }
        } else if (layer.colorMode === 'pattern' && layer.pattern) {
          const patCanvas = generatePatternCanvas(targetW, targetH, layer.pattern);
          const patData = patCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, targetW, targetH).data;
          const d = px.data;
          for (let i = 0; i < d.length; i += 4) {
            const patGray = Math.round(0.299 * patData[i] + 0.587 * patData[i+1] + 0.114 * patData[i+2]);
            const deepened = Math.round(Math.pow(patGray / 255, 2.5) * 255);
            d[i] = d[i+1] = d[i+2] = Math.max(d[i], deepened);
          }
        }
        px = this.posterize(px, 6);
        px = this.applyHalftone(px, targetW, targetH, layer.halftoneType, layer.halftoneSize, layer.halftoneAngle);
      }
      px = this.colorize(px, layer.color, layer);
    }
    ctx.putImageData(px, 0, 0);
    if (forExport) {
      return work;
    }
    layer._processedCanvas = work;
    layer._processedAtZoom = State.zoom;
    layer._dirty = false;
    return work;
  },

  toGrayscale(px) {
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
      d[i] = d[i+1] = d[i+2] = gray;
    }
    return px;
  },

  applyBrightness(px, brightness) {
    const offset = brightness * 2.55;
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = clamp(d[i]   + offset, 0, 255);
      d[i+1] = clamp(d[i+1] + offset, 0, 255);
      d[i+2] = clamp(d[i+2] + offset, 0, 255);
    }
    return px;
  },

  applyContrast(px, contrast) {
    const c = contrast * 2.55;
    const factor = (259 * (c + 255)) / (255 * (259 - c));
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = clamp(factor * (d[i]   - 128) + 128, 0, 255);
      d[i+1] = clamp(factor * (d[i+1] - 128) + 128, 0, 255);
      d[i+2] = clamp(factor * (d[i+2] - 128) + 128, 0, 255);
    }
    return px;
  },

  applyInvert(px) {
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = 255 - d[i];
      d[i+1] = 255 - d[i+1];
      d[i+2] = 255 - d[i+2];
    }
    return px;
  },

  posterize(px, levels) {
    const d = px.data;
    const step = 255 / (levels - 1);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.round(Math.round(d[i] / step) * step);
      d[i] = d[i+1] = d[i+2] = v;
    }
    return px;
  },

  applyHalftone(px, w, h, type, size, angle) {
    if (type === 'dither')    return this.bayerDither(px, w, h, size);
    if (type === 'magazine')  return this.magazineDots(px, w, h, size, angle ?? 45);
    if (type === 'grunge')    return this.grungeDots(px, w, h, size, angle ?? 45);
    return px;
  },

  bayerDither(px, w, h, cellSize) {
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
  },

  magazineDots(px, w, h, cellSize, angleDeg) {
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
  },

  grungeDots(px, w, h, cellSize, angleDeg) {
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
        if (darkness < 0.05) continue;

        // Base radius with random size variation (~±35%)
        const baseR = darkness * (cellSize * 0.55);
        const r = baseR * (0.95 + rand() * 0.1);
        if (r < 0.4) continue;

        // Randomly choose shape: circle, slightly squashed ellipse, or splat
        const shapeChoice = rand();
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
      }
    }
    return ctx.getImageData(0, 0, w, h);
  },

  colorize(px, hex, layer) {
    const d = px.data;
    if (layer && layer.colorMode === 'gradient' && layer.gradient) {
      const nw = px.width, nh = px.height;
      const gradCanvas = generateGradientCanvas(nw, nh, layer.gradient);
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
      const patCanvas = generatePatternCanvas(nw, nh, layer.pattern);
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
  },

  async processTextLayer(layer, forExport) {
    // Supersample text for display so zoomed-out previews stay sharp.
    const renderScale = forExport ? 1 : 2;
    const layoutW = forExport ? layer.naturalWidth : layer.width;
    const layoutH = forExport ? layer.naturalHeight : layer.height;
    const targetW = Math.round(layoutW * renderScale);
    const targetH = Math.round(layoutH * renderScale);

    if (!layer._originalCanvas ||
        layer._originalCanvas.width !== targetW ||
        layer._originalCanvas.height !== targetH) {
      const renderer = new TypeSetRenderer({
        fontBase: './node_modules/type-set/dist/fonts/',
        fontFamily: layer.textFontFamily,
        fontSize: layer.textFontSize,
        fontWeight: layer.textFontWeight,
        fontStyle: layer.textFontStyle,
        letterSpacing: layer.textLetterSpacing,
        lineHeight: layer.textLineHeight,
        textAlign: layer.textAlign,
        text: layer.text,
        color: '#000000',
        useLigatures: true,
        useKerning: true,
        useHyphenation: false,
      });
      const canvas = new OffscreenCanvas(targetW, targetH);
      await renderer.renderToCanvas(canvas, { width: layoutW, height: layoutH, clear: true, dpr: renderScale });
      const tCtx = canvas.getContext('2d');
      tCtx.globalCompositeOperation = 'destination-over';
      tCtx.fillStyle = 'white';
      tCtx.fillRect(0, 0, canvas.width, canvas.height);
      tCtx.globalCompositeOperation = 'source-over';
      layer._originalCanvas = canvas;
    }

    const work = new OffscreenCanvas(targetW, targetH);
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(layer._originalCanvas, 0, 0, targetW, targetH);

    let px = ctx.getImageData(0, 0, targetW, targetH);
    px = this.toGrayscale(px);
    px = this.applyBrightness(px, layer.brightness);
    px = this.applyContrast(px, layer.contrast);
    if (layer.invert) px = this.applyInvert(px);

    if (layer.halftoneType === 'grayscale') {
      const d = px.data;
      const { r: cr, g: cg, b: cb } = hexToRgb(layer.color);
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = Math.round(255 - gray);
      }
    } else {
      if (layer.halftoneType !== 'none') {
        px = this.posterize(px, 6);
        px = this.applyHalftone(px, targetW, targetH, layer.halftoneType, layer.halftoneSize, layer.halftoneAngle);
      }
      px = this.colorize(px, layer.color, layer);
    }

    ctx.putImageData(px, 0, 0);

    if (forExport) return work;
    layer._processedCanvas = work;
    layer._processedAtZoom = State.zoom;
    layer._dirty = false;
    return work;
  },

  // Per-color screen angles to minimize moiré when multiple plates overlap
  _separationAngles: {
    '#010101': 45, '#f65058': 75, '#ff7477': 15,
    '#ffe800': 90, '#ff48b0': 105, '#5ec8e5': 30, '#0078bf': 60,
  },

  processColorSeparation(layer, forExport) {
    const nw = layer.naturalWidth, nh = layer.naturalHeight;
    let targetW, targetH;
    if (forExport) {
      targetW = nw;
      targetH = nh;
    } else {
      const res = this.getDisplayResolution(layer);
      targetW = res.w;
      targetH = res.h;
    }
    const work = new OffscreenCanvas(targetW, targetH);
    const ctx = work.getContext('2d');

    for (const colorHex of layer.separationColors) {
      const plate = layer.separationPlates.get(colorHex);
      if (!plate) continue;

      const plateCanvas = new OffscreenCanvas(targetW, targetH);
      const pCtx = plateCanvas.getContext('2d', { willReadFrequently: true });
      pCtx.drawImage(plate, 0, 0, targetW, targetH);

      let px = pCtx.getImageData(0, 0, targetW, targetH);

      if (layer.halftoneType === 'grayscale') {
        // Grayscale halftone: use plate value as alpha coverage instead of dot patterns.
        // Plate data is already grayscale where 0 = full ink, 255 = no ink.
        const d = px.data;
        const { r: cr, g: cg, b: cb } = hexToRgb(colorHex);
        for (let i = 0; i < d.length; i += 4) {
          const gray = d[i]; // R = G = B in plate
          d[i] = cr;
          d[i + 1] = cg;
          d[i + 2] = cb;
          d[i + 3] = 255 - gray; // darker plate = more opaque ink
        }
        pCtx.putImageData(px, 0, 0);
      } else {
        const baseAngle = layer.halftoneAngle || 45;
        const offsetAngle = this._separationAngles[colorHex] || 0;
        const angle = (baseAngle + offsetAngle) % 180;
        px = this.posterize(px, 6);
        px = this.applyHalftone(px, targetW, targetH, layer.halftoneType, layer.halftoneSize, angle);
        pCtx.putImageData(px, 0, 0);

        // Colorize: black dots → riso color, white → transparent
        const colored = this.colorize(pCtx.getImageData(0, 0, targetW, targetH), colorHex, null);
        pCtx.putImageData(colored, 0, 0);
      }

      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(plateCanvas, 0, 0);
    }

    if (forExport) return work;
    layer._processedCanvas = work;
    layer._processedAtZoom = State.zoom;
    layer._dirty = false;
    return work;
  },
};

/* ─── GRADIENT WEIGHT MAP ────────────────────────────────────────── */
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

/* ─── PATTERN WEIGHT MAP ─────────────────────────────────────────── */
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
