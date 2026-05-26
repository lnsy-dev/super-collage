use wasm_bindgen::prelude::*;

/// Initialize a particle system with `count` particles.
/// Returns a flat f32 array: [x0, y0, vx0, vy0, hue0, x1, y1, ...]
#[wasm_bindgen]
pub fn init_particles(count: u32, seed: u32) -> Vec<f32> {
    let mut data = Vec::with_capacity((count * 5) as usize);
    let mut rng = seed;

    for _ in 0..count {
        rng = lcg(rng);
        let x = (rng as f32 / u32::MAX as f32) * 2.0 - 1.0;
        rng = lcg(rng);
        let y = (rng as f32 / u32::MAX as f32) * 2.0 - 1.0;
        rng = lcg(rng);
        let vx = ((rng as f32 / u32::MAX as f32) - 0.5) * 0.01;
        rng = lcg(rng);
        let vy = ((rng as f32 / u32::MAX as f32) - 0.5) * 0.01;
        rng = lcg(rng);
        let hue = rng as f32 / u32::MAX as f32;

        data.push(x);
        data.push(y);
        data.push(vx);
        data.push(vy);
        data.push(hue);
    }
    data
}

/// Step the simulation forward by `dt` seconds.
/// Mutates positions using velocities; wraps at ±1.
#[wasm_bindgen]
pub fn step_particles(data: &mut [f32], dt: f32, time: f32) {
    let stride = 5;
    let count = data.len() / stride;

    for i in 0..count {
        let base = i * stride;
        let x = data[base];
        let y = data[base + 1];
        let vx = data[base + 2];
        let vy = data[base + 3];

        // Attractor field: gentle curl toward center with time-based swirl
        let angle = time * 0.3 + (x * x + y * y).sqrt() * 3.0;
        let fx = angle.cos() * 0.0002 - x * 0.0001;
        let fy = angle.sin() * 0.0002 - y * 0.0001;

        let new_vx = (vx + fx * dt).clamp(-0.02, 0.02);
        let new_vy = (vy + fy * dt).clamp(-0.02, 0.02);
        let mut new_x = x + new_vx;
        let mut new_y = y + new_vy;

        // Wrap around edges
        if new_x > 1.0 { new_x -= 2.0; }
        if new_x < -1.0 { new_x += 2.0; }
        if new_y > 1.0 { new_y -= 2.0; }
        if new_y < -1.0 { new_y += 2.0; }

        data[base] = new_x;
        data[base + 1] = new_y;
        data[base + 2] = new_vx;
        data[base + 3] = new_vy;
    }
}

/// Extract just positions + hues as a flat [x, y, hue, ...] array for the GPU.
#[wasm_bindgen]
pub fn extract_render_data(data: &[f32]) -> Vec<f32> {
    let stride = 5;
    let count = data.len() / stride;
    let mut out = Vec::with_capacity(count * 3);
    for i in 0..count {
        let base = i * stride;
        out.push(data[base]);
        out.push(data[base + 1]);
        out.push(data[base + 4]);
    }
    out
}

/// Alpha-weighted subtractive (multiply) blend. Both slices are flat RGBA u8 of equal length.
/// For each pixel: base_channel = base_channel × lerp(255, overlay_channel, overlay_alpha/255) / 255
/// This simulates transparent riso ink on paper: overlapping inks darken subtractively.
#[wasm_bindgen]
pub fn blend_subtractive(base: &[u8], overlay: &[u8]) -> Vec<u8> {
    let mut result = base.to_vec();
    let mut i = 0;
    while i < result.len() {
        let oa = overlay[i + 3] as u32;
        if oa > 0 {
            let mr = 255 * (255 - oa) + overlay[i]     as u32 * oa;
            let mg = 255 * (255 - oa) + overlay[i + 1] as u32 * oa;
            let mb = 255 * (255 - oa) + overlay[i + 2] as u32 * oa;
            result[i]     = ((result[i]     as u32 * mr) / (255 * 255)) as u8;
            result[i + 1] = ((result[i + 1] as u32 * mg) / (255 * 255)) as u8;
            result[i + 2] = ((result[i + 2] as u32 * mb) / (255 * 255)) as u8;
            // alpha channel left unchanged (paper is always opaque)
        }
        i += 4;
    }
    result
}

fn lcg(state: u32) -> u32 {
    state.wrapping_mul(1664525).wrapping_add(1013904223)
}

/* ═══════════════════════════════════════════════════════════════════
   COLOR SEPARATION  ·  Decompose RGB image into risograph plates
════════════════════════════════════════════════════════════════════ */

#[derive(Clone, Copy, Debug)]
struct Lab {
    l: f64,
    a: f64,
    b: f64,
}

#[derive(Clone, Copy, Debug)]
struct Vec3 {
    x: f64,
    y: f64,
    z: f64,
}

impl Vec3 {
    fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
    fn dot(self, other: Self) -> f64 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }
    fn sub(self, other: Self) -> Self {
        Self::new(self.x - other.x, self.y - other.y, self.z - other.z)
    }
    fn scale(self, s: f64) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }
    fn add(self, other: Self) -> Self {
        Self::new(self.x + other.x, self.y + other.y, self.z + other.z)
    }
}

fn srgb_byte_to_linear(v: u8) -> f64 {
    let s = v as f64 / 255.0;
    if s <= 0.04045 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_lab(r: f64, g: f64, b: f64) -> Lab {
    // D65 sRGB → XYZ
    let x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
    let y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
    let z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;

    fn f(t: f64) -> f64 {
        if t > 0.008856 {
            t.powf(1.0 / 3.0)
        } else {
            7.787 * t + 16.0 / 116.0
        }
    }

    let fx = f(x / 0.95047);
    let fy = f(y / 1.0);
    let fz = f(z / 1.08883);

    Lab {
        l: (116.0 * fy - 16.0).max(0.0),
        a: 500.0 * (fx - fy),
        b: 200.0 * (fy - fz),
    }
}

fn lab_distance_sq(a: &Lab, b: &Lab) -> f64 {
    let dl = a.l - b.l;
    let da = a.a - b.a;
    let db = a.b - b.b;
    dl * dl + da * da + db * db
}

/// Geometric (subtractive) color mixing for translucent inks.
/// Result = Π(color_i ^ weight_i).  When weights sum to 1 this produces
/// darker, more saturated mixes than linear interpolation — closer to how
/// risograph inks overlap on paper.
fn geometric_mix(inks: &[(Vec3, f64)]) -> Vec3 {
    let mut r = 1.0;
    let mut g = 1.0;
    let mut b = 1.0;
    for &(color, weight) in inks {
        if weight <= 0.0 { continue; }
        r *= color.x.powf(weight);
        g *= color.y.powf(weight);
        b *= color.z.powf(weight);
    }
    Vec3::new(r, g, b)
}

/// Pre-computed powers for each color channel: cache[color][step] = channel^(step/10)
/// This eliminates expensive `powf` calls inside the LUT search loops.
struct PowCache {
    r: [[f64; 11]; 7],
    g: [[f64; 11]; 7],
    b: [[f64; 11]; 7],
}

impl PowCache {
    fn new(colors: &[Vec3]) -> Self {
        let mut r = [[1.0f64; 11]; 7];
        let mut g = [[1.0f64; 11]; 7];
        let mut b = [[1.0f64; 11]; 7];
        for (i, c) in colors.iter().enumerate() {
            for step in 0..=10 {
                let w = step as f64 / 10.0;
                r[i][step] = c.x.powf(w);
                g[i][step] = c.y.powf(w);
                b[i][step] = c.z.powf(w);
            }
        }
        Self { r, g, b }
    }

    fn mix(&self, idxs: &[usize], weights_tenths: &[usize]) -> Vec3 {
        let mut rr = 1.0;
        let mut gg = 1.0;
        let mut bb = 1.0;
        for (&i, &wt) in idxs.iter().zip(weights_tenths.iter()) {
            if wt == 0 { continue; }
            rr *= self.r[i][wt];
            gg *= self.g[i][wt];
            bb *= self.b[i][wt];
        }
        Vec3::new(rr, gg, bb)
    }
}

/// Find the best weights for one LUT cell using brute-force search over
/// discrete weight grids.  Uses geometric (subtractive) mixing for
/// calibrations that match real ink behaviour.
fn build_lut_cell(target_rgb: Vec3, cache: &PowCache, num_colors: usize, max_mix: u32) -> [u8; 7] {
    let target_lab = linear_to_lab(target_rgb.x, target_rgb.y, target_rgb.z);
    let mut best_error = f64::INFINITY;
    let mut best_weights = [0.0f64; 7];

    // "No ink" option (paper white).  This prevents white/light pixels from
    // being forced onto the nearest riso color.
    let white_lab = linear_to_lab(1.0, 1.0, 1.0);
    let white_err = lab_distance_sq(&target_lab, &white_lab);
    if white_err < best_error {
        best_error = white_err;
        best_weights = [0.0; 7];
    }

    // 1-color search with partial densities (0.1 … 1.0).
    // Allows light greys to map to low-density black instead of full cyan.
    for c in 0..num_colors {
        for step in 1..=10 {
            let err = lab_distance_sq(&target_lab, &linear_to_lab(cache.r[c][step], cache.g[c][step], cache.b[c][step]));
            if err < best_error {
                best_error = err;
                best_weights = [0.0; 7];
                best_weights[c] = step as f64 / 10.0;
            }
        }
    }

    // 2-color search (4 discrete steps: 0.2, 0.4, 0.6, 0.8)
    if max_mix >= 2 {
        for i in 0..num_colors {
            for j in (i + 1)..num_colors {
                for step in 1..=4 {
                    let w1 = step;
                    let w2 = 10 - step;
                    let mix = cache.mix(&[i, j], &[w1, w2]);
                    let err = lab_distance_sq(&target_lab, &linear_to_lab(mix.x, mix.y, mix.z));
                    if err < best_error {
                        best_error = err;
                        best_weights = [0.0; 7];
                        best_weights[i] = w1 as f64 / 10.0;
                        best_weights[j] = w2 as f64 / 10.0;
                    }
                }
            }
        }
    }

    // 3-color search (coarse triangular grid with 0.25 increments)
    if max_mix >= 3 {
        // Map quarter steps to nearest cache tenths: 0.25→2, 0.5→5, 0.75→7
        let q = [0usize, 2, 5, 7];
        for i in 0..num_colors {
            for j in (i + 1)..num_colors {
                for k in (j + 1)..num_colors {
                    for a in 1..=3 {
                        for b in 1..=(3 - a) {
                            let c = 4 - a - b;
                            if c == 0 { continue; }
                            let mix = cache.mix(&[i, j, k], &[q[a], q[b], q[c]]);
                            let err = lab_distance_sq(&target_lab, &linear_to_lab(mix.x, mix.y, mix.z));
                            if err < best_error {
                                best_error = err;
                                best_weights = [0.0; 7];
                                best_weights[i] = a as f64 / 4.0;
                                best_weights[j] = b as f64 / 4.0;
                                best_weights[k] = c as f64 / 4.0;
                            }
                        }
                    }
                }
            }
        }
    }

    best_weights.map(|w| (w * 255.0).round().clamp(0.0, 255.0) as u8)
}

/// Build a 3-D RGB lookup table for fast color separation.
/// `grid_size` cells per channel (e.g. 16 → 16³ = 4096 cells).
/// Each cell stores 7 weight bytes (one per riso color, 0–255).
#[wasm_bindgen]
pub fn build_color_lut(riso_colors: &[u8], max_mix: u32, grid_size: u32) -> Vec<u8> {
    let num_colors = riso_colors.len() / 3;
    let gs = grid_size.max(2).min(64) as usize;
    let total_cells = gs * gs * gs;
    let mut lut = vec![0u8; total_cells * 7];

    let colors: Vec<Vec3> = (0..num_colors)
        .map(|i| Vec3::new(
            srgb_byte_to_linear(riso_colors[i * 3]),
            srgb_byte_to_linear(riso_colors[i * 3 + 1]),
            srgb_byte_to_linear(riso_colors[i * 3 + 2]),
        ))
        .collect();

    let cache = PowCache::new(&colors);
    let scale = 1.0 / (gs - 1) as f64;

    for rz in 0..gs {
        for gy in 0..gs {
            for bx in 0..gs {
                let target = Vec3::new(
                    srgb_byte_to_linear((bx as f64 * scale * 255.0).round() as u8),
                    srgb_byte_to_linear((gy as f64 * scale * 255.0).round() as u8),
                    srgb_byte_to_linear((rz as f64 * scale * 255.0).round() as u8),
                );
                let cell = build_lut_cell(target, &cache, num_colors, max_mix);
                let base = ((rz * gs + gy) * gs + bx) * 7;
                for c in 0..num_colors {
                    lut[base + c] = cell[c];
                }
            }
        }
    }

    lut
}

/// Decompose an RGBA image into risograph plates using a pre-built LUT.
/// This is ~20–50× faster than per-pixel brute-force search.
#[wasm_bindgen]
pub fn separate_colors_with_lut(
    image_data: &[u8],
    width: u32,
    height: u32,
    lut: &[u8],
    grid_size: u32,
) -> Vec<u8> {
    let pixel_count = (width * height) as usize;
    let num_colors = 7; // fixed for our riso palette (non-white)
    let mut plates = vec![0u8; pixel_count * 4 * num_colors];

    if pixel_count == 0 || lut.is_empty() {
        return plates;
    }

    let gs = grid_size as usize;
    let gs_minus_1 = (gs - 1) as f64;
    let lut_stride = 7;

    for py in 0..pixel_count {
        let src_base = py * 4;
        let ta = image_data[src_base + 3];

        // Transparent pixels → no ink on any plate (255 = no ink)
        if ta < 10 {
            for c in 0..num_colors {
                let dst_base = (c * pixel_count + py) * 4;
                plates[dst_base] = 255;
                plates[dst_base + 1] = 255;
                plates[dst_base + 2] = 255;
                plates[dst_base + 3] = 255;
            }
            continue;
        }

        let r = image_data[src_base] as usize;
        let g = image_data[src_base + 1] as usize;
        let b = image_data[src_base + 2] as usize;

        let rx = ((r as f64 / 255.0 * gs_minus_1).round() as usize).min(gs - 1);
        let gy = ((g as f64 / 255.0 * gs_minus_1).round() as usize).min(gs - 1);
        let bz = ((b as f64 / 255.0 * gs_minus_1).round() as usize).min(gs - 1);

        let lut_base = ((bz * gs + gy) * gs + rx) * lut_stride;

        for c in 0..num_colors {
            let dst_base = (c * pixel_count + py) * 4;
            let ink = 255 - lut[lut_base + c]; // 0 = full ink, 255 = no ink
            plates[dst_base] = ink;
            plates[dst_base + 1] = ink;
            plates[dst_base + 2] = ink;
            plates[dst_base + 3] = 255;
        }
    }

    plates
}

/// Legacy API: builds a temporary LUT internally, then decomposes.
/// Slower than the two-step LUT approach but keeps the same signature.
#[wasm_bindgen]
pub fn separate_colors(
    image_data: &[u8],
    width: u32,
    height: u32,
    riso_colors: &[u8],
    max_mix: u32,
) -> Vec<u8> {
    let lut = build_color_lut(riso_colors, max_mix, 32);
    separate_colors_with_lut(image_data, width, height, &lut, 32)
}

/// Apply a simple threshold-based halftone to a single grayscale plate.
#[wasm_bindgen]
pub fn halftone_plate(
    image_data: &[u8],
    width: u32,
    height: u32,
    cell_size: u32,
) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let cs = cell_size.max(1) as usize;
    let mut out = vec![255u8; w * h * 4];

    const BAYER4: [u8; 16] = [
        0, 128, 32, 160,
        192, 64, 224, 96,
        48, 176, 16, 144,
        240, 112, 208, 80,
    ];

    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let gray = image_data[i] as u16;
            let mx = (x / cs) % 4;
            let my = (y / cs) % 4;
            let threshold = BAYER4[my * 4 + mx] as u16;
            if gray < threshold {
                out[i] = 0;
                out[i + 1] = 0;
                out[i + 2] = 0;
                out[i + 3] = 255;
            } else {
                out[i + 3] = 255;
            }
        }
    }
    out
}
