/* ═══════════════════════════════════════════════════════════════════
   Layer class
   ═══════════════════════════════════════════════════════════════════ */

import { State } from './state.js';

export class Layer {
  constructor(data = {}) {
    this.id = data.id || crypto.randomUUID();
    this.projectId = data.projectId || (State.project && State.project.id);
    this.name = data.name || 'Layer';
    this.visible = data.visible !== false;
    this.locked = data.locked || false;
    this.x = data.x ?? 0;
    this.y = data.y ?? 0;
    this.width = data.width || 100;
    this.height = data.height || 100;
    this.naturalWidth = data.naturalWidth || data.width || 100;
    this.naturalHeight = data.naturalHeight || data.height || 100;
    this.rotation = data.rotation ?? 0;
    this.flipH = data.flipH || false;
    this.flipV = data.flipV || false;
    this.brightness = data.brightness ?? 0;
    this.contrast = data.contrast ?? 0;
    this.saturation = data.saturation ?? -100;
    this.invert = data.invert || false;
    this.halftoneType = data.halftoneType || 'none';
    this.halftoneSize = data.halftoneSize ?? 8;
    this.halftoneAngle = data.halftoneAngle ?? 45;
    this.color = data.color || '#010101';
    this.colorMode = data.colorMode || 'solid';
    this.gradient = data.gradient ? JSON.parse(JSON.stringify(data.gradient)) : {
      type: 'linear',
      angle: 0,
      centerX: 0.5,
      centerY: 0.5,
      stops: [
        { color: '#010101', position: 0 },
        { color: '#0078bf', position: 1 },
      ],
      poles: [],
    };
    this.pattern = data.pattern ? JSON.parse(JSON.stringify(data.pattern)) : {
      type: 'stripes',
      color1: '#010101',
      color2: '#0078bf',
      size: 20,
      angle: 0,
    };
    this.imageMaskIds = data.imageMaskIds || (data.imageMaskId ? [data.imageMaskId] : []);
    this.isMaskFor = data.isMaskFor || null;
    this.isSvg = data.isSvg || false;
    this.isColorSeparation = data.isColorSeparation || false;
    this.separationColors = data.separationColors || [];
    this.separationPlates = new Map();
    this._originalCanvas = null;
    this._processedCanvas = null;
    this._maskCanvas = null;
    this._dirty = true;
    this._processedAtZoom = null;
  }

  markDirty() {
    this._dirty = true;
  }

  toRecord() {
    return {
      id: this.id,
      projectId: this.projectId,
      name: this.name,
      visible: this.visible,
      locked: this.locked,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      naturalWidth: this.naturalWidth,
      naturalHeight: this.naturalHeight,
      rotation: this.rotation,
      flipH: this.flipH,
      flipV: this.flipV,
      brightness: this.brightness,
      contrast: this.contrast,
      saturation: this.saturation,
      invert: this.invert,
      halftoneType: this.halftoneType,
      halftoneSize: this.halftoneSize,
      halftoneAngle: this.halftoneAngle,
      color: this.color,
      colorMode: this.colorMode,
      gradient: JSON.parse(JSON.stringify(this.gradient)),
      pattern: JSON.parse(JSON.stringify(this.pattern)),
      imageMaskIds: this.imageMaskIds,
      isMaskFor: this.isMaskFor,
      isSvg: this.isSvg,
      isColorSeparation: this.isColorSeparation,
      separationColors: this.separationColors,
    };
  }

  static fromRecord(record) {
    const layer = new Layer(record);
    layer.separationPlates = new Map();
    layer._originalCanvas = null;
    layer._processedCanvas = null;
    layer._maskCanvas = null;
    layer._dirty = true;
    layer._processedAtZoom = null;
    return layer;
  }
}
