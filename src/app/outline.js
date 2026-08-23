/* ═══════════════════════════════════════════════════════════════════
   Outline generation: traces the visible content of a layer and turns
   it into an editable shape layer (shapeType 'custom-path') whose
   fill/border/stroke-width/color can be edited like any other shape.
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';
import { DB } from './db.js';
import { Layer } from './layer.js';
import { ImageProcessor } from './image-processor.js';
import { MaskEngine } from './mask-engine.js';
import { UI } from './ui.js';
import { Renderer } from './renderer.js';
import { PageManager } from './page-manager.js';
import { pushUndoState } from './undo.js';
import { rerenderShapeLayer } from './shape-utils.js';

// Max resolution of the bitmap used for tracing. Higher = more detail,
// slower contour extraction.
const TRACE_MAX_DIM = 400;
const SIMPLIFY_TOLERANCE = 1.2; // in traced-bitmap pixels

/**
 * Trace contours of a binary bitmap using marching-squares edge
 * following. Returns closed loops of [x, y] points in pixel-corner
 * coordinates. Only outer boundaries are traced (holes are ignored).
 */
export function traceContours(binary, w, h) {
  // Directed edges along pixel borders, filled region on the left.
  const edges = new Map(); // "vx,vy" -> array of target vertex keys
  const addEdge = (x1, y1, x2, y2) => {
    const k = x1 + ',' + y1;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([x2, y2]);
  };
  const filled = (x, y) => x >= 0 && x < w && y >= 0 && y < h && binary[y * w + x] === 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) addEdge(x, y, x + 1, y);         // top
      if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1); // right
      if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1); // bottom
      if (!filled(x - 1, y)) addEdge(x, y + 1, x, y);         // left
    }
  }

  const contours = [];
  const used = new Set();
  for (const [startKey, targets] of edges) {
    for (const startTarget of targets) {
      const startId = startKey + '>' + startTarget[0] + ',' + startTarget[1];
      if (used.has(startId)) continue;

      const loop = [];
      let cur = startKey.split(',').map(Number);
      let next = startTarget;
      let prevDx = next[0] - cur[0], prevDy = next[1] - cur[1];
      loop.push(cur);
      while (true) {
        loop.push(next);
        used.add(cur[0] + ',' + cur[1] + '>' + next[0] + ',' + next[1]);
        const vk = next[0] + ',' + next[1];
        const outs = edges.get(vk);
        if (!outs || !outs.length) break; // shouldn't happen on closed loops
        // Prefer continuing straight / turning consistently to resolve saddles.
        let best = null, bestScore = Infinity;
        for (const out of outs) {
          const id = vk + '>' + out[0] + ',' + out[1];
          if (used.has(id)) continue;
          const dx = out[0] - next[0], dy = out[1] - next[1];
          // cross product relative to incoming direction: prefer left turns first
          const cross = prevDx * dy - prevDy * dx;
          const dot = prevDx * dx + prevDy * dy;
          const score = cross > 0 ? 0 : (cross < 0 ? 2 : 1); // left, back, straight
          const s = score * 10 + (dot < 0 ? 5 : 0);
          if (s < bestScore) { bestScore = s; best = out; }
        }
        if (!best) break;
        prevDx = best[0] - next[0]; prevDy = best[1] - next[1];
        cur = next;
        next = best;
        if (cur[0] === loop[0][0] && cur[1] === loop[0][1]) break;
      }

      if (loop.length >= 4) contours.push(loop);
    }
  }
  return contours.map(pts => simplifyClosed(pts, SIMPLIFY_TOLERANCE));
}

/** Remove collinear points, then Ramer–Douglas–Peucker simplification. */
export function simplifyClosed(points, tolerance) {
  const pts = points.slice();
  // Drop the duplicated closing vertex so wraparound checks are valid.
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts.pop();
  }
  // Remove collinear intermediates
  const collinearRemoved = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross !== 0) collinearRemoved.push(b);
  }
  if (collinearRemoved.length < 4) return collinearRemoved;

  // RDP on the open path from first point around back to first point.
  const first = collinearRemoved[0];
  const path = [...collinearRemoved, first];
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  rdp(path, 0, path.length - 1, tolerance * tolerance, keep);

  const result = [];
  for (let i = 0; i < path.length - 1; i++) {
    if (keep[i]) result.push(path[i]);
  }
  return result;
}

function rdp(pts, i, j, tol2, keep) {
  if (j <= i + 1) return;
  const ax = pts[i][0], ay = pts[i][1];
  const bx = pts[j][0], by = pts[j][1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let maxDist2 = -1, maxIdx = -1;
  for (let k = i + 1; k < j; k++) {
    const px = pts[k][0] - ax, py = pts[k][1] - ay;
    let d2;
    if (len2 === 0) {
      d2 = px * px + py * py;
    } else {
      let t = (px * dx + py * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = px - t * dx, qy = py - t * dy;
      d2 = qx * qx + qy * qy;
    }
    if (d2 > maxDist2) { maxDist2 = d2; maxIdx = k; }
  }
  if (maxDist2 > tol2 && maxIdx > 0) {
    keep[maxIdx] = 1;
    rdp(pts, i, maxIdx, tol2, keep);
    rdp(pts, maxIdx, j, tol2, keep);
  }
}

/**
 * Create an editable shape layer outlining the given layer's visible
 * content. The outline layer copies the source geometry (position,
 * rotation, flips) so it lines up with the original.
 */
export async function generateOutline(layerId) {
  pushUndoState();
  const src = State.layers.find(l => l.id === layerId);
  if (!src) return;

  const proc = await ImageProcessor.processLayer(src, { forExport: true });
  if (!proc) return;

  // Downscale for tracing.
  const scale = Math.min(1, TRACE_MAX_DIM / Math.max(proc.width, proc.height));
  const tw = Math.max(2, Math.round(proc.width * scale));
  const th = Math.max(2, Math.round(proc.height * scale));
  const tmp = new OffscreenCanvas(tw, th);
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  tctx.fillStyle = '#fff';
  tctx.fillRect(0, 0, tw, th);
  tctx.drawImage(proc, 0, 0, tw, th);

  const data = tctx.getImageData(0, 0, tw, th).data;
  const binary = new Uint8Array(tw * th);
  for (let i = 0; i < tw * th; i++) {
    binary[i] = data[i * 4] < 128 ? 1 : 0; // red channel, same threshold as flatten
  }

  const contours = traceContours(binary, tw, th);
  if (!contours.length) return; // no visible content

  // Map trace coordinates into the source layer's natural space.
  const sx = src.naturalWidth / tw;
  const sy = src.naturalHeight / th;
  const shapePath = contours.map(pts =>
    pts.map(([x, y]) => [Math.round(x * sx * 100) / 100, Math.round(y * sy * 100) / 100])
  );

  const outline = new Layer({
    name: 'Outline of ' + src.name,
    x: src.x, y: src.y,
    width: src.width, height: src.height,
    naturalWidth: src.naturalWidth, naturalHeight: src.naturalHeight,
    rotation: src.rotation, flipH: src.flipH, flipV: src.flipV,
    isShape: true,
    shapeType: 'custom-path',
    shapePath,
    shapeHasFill: false,
    shapeHasStroke: true,
    shapeStrokeWidth: 4,
    shapeStrokeColor: '#010101',
    color: src.color || '#010101',
  });

  const insertIdx = State.layers.indexOf(src) + 1;
  State.layers.splice(insertIdx, 0, outline);
  State.selectedId = outline.id;
  State.selectedIds = [outline.id];

  // Render the traced path into the layer's bitmap and persist it.
  await rerenderShapeLayer(outline);
  await PageManager.saveActivePage();

  UI.refreshLayerList();
  UI.refreshProperties();
  Renderer.schedule();
  return outline;
}
