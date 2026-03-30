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
