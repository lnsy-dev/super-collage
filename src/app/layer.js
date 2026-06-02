/* ═══════════════════════════════════════════════════════════════════
   Layer factory
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';

export function makeLayer(data = {}) {
  return {
    id: data.id || crypto.randomUUID(),
    projectId: data.projectId || (State.project && State.project.id),
    name: data.name || 'Layer',
    visible: data.visible !== false,
    locked: data.locked || false,
    x: data.x ?? 0,
    y: data.y ?? 0,
    width: data.width || 100,
    height: data.height || 100,
    naturalWidth: data.naturalWidth || data.width || 100,
    naturalHeight: data.naturalHeight || data.height || 100,
    rotation: data.rotation ?? 0,
    flipH: data.flipH || false,
    flipV: data.flipV || false,
    brightness: data.brightness ?? 0,
    contrast: data.contrast ?? 0,
    saturation: data.saturation ?? -100,
    invert: data.invert || false,
    halftoneType: data.halftoneType || 'none',
    halftoneSize: data.halftoneSize ?? 8,
    halftoneAngle: data.halftoneAngle ?? 45,
    hatchLineHeight: data.hatchLineHeight ?? 10,
    hatchLineLength: data.hatchLineLength ?? 60,
    color: data.color || '#212121',
    colorMode: data.colorMode || 'solid',
    gradient: data.gradient ? JSON.parse(JSON.stringify(data.gradient)) : {
      type: 'linear',
      angle: 0,
      centerX: 0.5,
      centerY: 0.5,
      stops: [
        { color: '#212121', position: 0 },
        { color: '#0078BF', position: 1 },
      ],
      poles: [],
    },
    pattern: data.pattern ? JSON.parse(JSON.stringify(data.pattern)) : {
      type: 'stripes',
      color1: '#212121',
      color2: '#0078BF',
      size: 20,
      angle: 0,
    },
    imageMaskIds: data.imageMaskIds || (data.imageMaskId ? [data.imageMaskId] : []),
    isMaskFor:   data.isMaskFor   || null,
    isSvg: data.isSvg || false,
    isColorSeparation: data.isColorSeparation || false,
    separationColors: data.separationColors || [],
    separationPlates: new Map(),
    _originalCanvas: null,
    _processedCanvas: null,
    _maskCanvas: null,
    _dirty: true,
  };
}
