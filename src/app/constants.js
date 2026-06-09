/* ═══════════════════════════════════════════════════════════════════
   SUPER COLLAGE  ·  Application constants
   ═══════════════════════════════════════════════════════════════════ */

export let CANVAS_W = 3300;
export let CANVAS_H = 5100;
export const CANVAS_PAD = 1000; // document pixels of padding around the frame

export function setCanvasSize(w, h) {
  CANVAS_W = w;
  CANVAS_H = h;
}

export const PAGE_SIZE_DIMS = {
  'letter':       { w: 5100, h: 6600 },
  'legal':        { w: 5100, h: 8400 },
  'half-letter':  { w: 3300, h: 5100 },
  '4x6':          { w: 2400, h: 3600 },
  '4.25x7':       { w: 2550, h: 4200 },
  'manga':        { w: 3024, h: 4302 },
  'business-card':{ w: 2100, h: 1200 },
};

export const RISO_COLORS = [
  { name: 'Black',       hex: '#010101', pantone: 'BLACK U' },
  { name: 'Red',         hex: '#f65058', pantone: 'RED 032 U'},
  { name: 'Neon Orange', hex: '#ff7477', pantone: '805 U' },
  { name: 'Yellow',      hex: '#ffe800', pantone: 'YELLOW U' },
  { name: 'Neon Pink',   hex: '#ff48b0', pantone: '806 U' },
  { name: 'Aqua',        hex: '#5ec8e5', pantone: '637 U' },
  { name: 'Blue',        hex: '#0078bf', pantone: '3005 U' },
  { name: 'White',       hex: '#FFFFFF', pantone: '' },
];

// 8×8 Bayer matrix (values 0-255)
export const BAYER8 = new Uint8Array([
   0,136, 34,170,  2,138, 36,172,
 204, 68,238,102,206, 70,240,104,
  51,187, 17,153, 53,189, 19,155,
 255,119,221, 85,253,121,219, 87,
   3,139, 37,173,  1,137, 35,171,
 207, 71,241,105,205, 69,239,103,
  54,190, 20,156, 52,188, 18,154,
 253,123,217, 89,255,121,221, 85,
]);
