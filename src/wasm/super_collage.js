/* @ts-self-types="./super_collage.d.ts" */

/**
 * A chromaticity coordinate with x and y values.
 */
export class Chromaticity {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ChromaticityFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_chromaticity_free(ptr, 0);
    }
}
if (Symbol.dispose) Chromaticity.prototype[Symbol.dispose] = Chromaticity.prototype.free;

/**
 * A **lightweight enum** representing the CIE standard illuminants from the CIE 15:2018 datasets
 * (downloaded August 2024). Each variant holds a zero-cost reference to its precompiled spectrum,
 * making it easy to include as a field in your own types without pulling in heavy data structures.
 *
 * This enum implements `IntoEnumIterator`, so you can **iterate through every standard illuminant**
 * (useful for testing, batch conversions, or validation).
 *
 * - Use `CieIlluminant::iter()` or `CieIlluminant::spectrum()` to list or retrieve any built-in illuminant.
 * - For a generic D-series illuminant at any correlated color temperature, use
 *   `Spectrum::cie_d_illuminant(cct: f64)`.
 *
 * By default, only **D65** and **D50** are included. To pull in the full set of fluorescent “F3_X”
 * series and other CIE illuminants, enable the `"cie-illuminants"` feature in `Cargo.toml`
 * (or build with `--features cie-illuminants`). Omit that feature (or use `--no-default-features`)
 * to keep your binary lean.
 *
 * In JavaScript/WebAssembly builds, the `colorimetry` package excludes these extra spectra by default
 * for faster load times. To include them, use the `colorimetry-all` bundle instead.
 *
 * For more background, see the Wikipedia article on
 * [Standard illuminant white points](https://en.wikipedia.org/wiki/Standard_illuminant#White_points_of_standard_illuminants).
 *
 * # Examples
 * ```rust
 * use colorimetry::illuminant::CieIlluminant;
 * use strum::IntoEnumIterator;
 *
 * // Iterate through and print all available CIE illuminants:
 * for illum in CieIlluminant::iter() {
 *     println!("{illum}");
 * }
 * ```
 * @enum {0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39}
 */
export const CieIlluminant = Object.freeze({
    D65: 0, "0": "D65",
    D50: 1, "1": "D50",
    E: 2, "2": "E",
    A: 3, "3": "A",
    F1: 4, "4": "F1",
    F2: 5, "5": "F2",
    F3: 6, "6": "F3",
    F4: 7, "7": "F4",
    F5: 8, "8": "F5",
    F6: 9, "9": "F6",
    F7: 10, "10": "F7",
    F8: 11, "11": "F8",
    F9: 12, "12": "F9",
    F10: 13, "13": "F10",
    F11: 14, "14": "F11",
    F12: 15, "15": "F12",
    F3_1: 16, "16": "F3_1",
    F3_2: 17, "17": "F3_2",
    F3_3: 18, "18": "F3_3",
    F3_4: 19, "19": "F3_4",
    F3_5: 20, "20": "F3_5",
    F3_6: 21, "21": "F3_6",
    F3_7: 22, "22": "F3_7",
    F3_8: 23, "23": "F3_8",
    F3_9: 24, "24": "F3_9",
    F3_10: 25, "25": "F3_10",
    F3_11: 26, "26": "F3_11",
    F3_12: 27, "27": "F3_12",
    F3_13: 28, "28": "F3_13",
    F3_14: 29, "29": "F3_14",
    F3_15: 30, "30": "F3_15",
    LED_B1: 31, "31": "LED_B1",
    LED_B2: 32, "32": "LED_B2",
    LED_B3: 33, "33": "LED_B3",
    LED_B4: 34, "34": "LED_B4",
    LED_B5: 35, "35": "LED_B5",
    LED_BH1: 36, "36": "LED_BH1",
    LED_RGB1: 37, "37": "LED_RGB1",
    LED_V1: 38, "38": "LED_V1",
    LED_V2: 39, "39": "LED_V2",
});

export class CieLab {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CieLabFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_cielab_free(ptr, 0);
    }
}
if (Symbol.dispose) CieLab.prototype[Symbol.dispose] = CieLab.prototype.free;

/**
 * # Illuminant
 *
 * An illuminant is a spectral power distribution that represents the
 * spectral power density of a light source (sun, bulb, LED, etc.) in
 * W/m²/nm over 380–780 nm (401 samples).
 */
export class Illuminant {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Illuminant.prototype);
        obj.__wbg_ptr = ptr;
        IlluminantFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IlluminantFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_illuminant_free(ptr, 0);
    }
    /**
     * Returns the spectral data values, as a Float64Array containing 401 data
     * points, over a wavelength domain from 380 t0 780 nanometer, with a
     * stepsize of 1 nanometer.
     * @returns {Float64Array}
     */
    Values() {
        const ret = wasm.illuminant_Values(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Get the CieIlluminant spectrum. Typically you don't need to use the Spectrum itself, as many
     * methods just accept the CieIlluminant directly.
     * @param {CieIlluminant} stdill
     * @returns {Illuminant}
     */
    static illuminant(stdill) {
        const ret = wasm.illuminant_illuminant(stdill);
        return Illuminant.__wrap(ret);
    }
    /**
     * Create a new illuminant spectrum from the given data.
     *
     * The data must be the 401 values from 380 to 780 nm, with an interval size of 1 nanometer.
     * @param {Float64Array} data
     */
    constructor(data) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.illuminant_new_js(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        IlluminantFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Illuminant.prototype[Symbol.dispose] = Illuminant.prototype.free;

/**
 * Selects a CIE standard colorimetric observer.
 *
 * The tag is embedded in every [`XYZ`] and [`Rgb`](crate::rgb::Rgb) value so that
 * operations across incompatible observers can be detected at runtime.  Each variant
 * is a lightweight index; the color-matching function tables are stored in
 * [`observer_data`].
 * @enum {0 | 1 | 2 | 3}
 */
export const Observer = Object.freeze({
    /**
     * CIE 1931 2° standard observer — the default for most colorimetry.
     *
     * Used by sRGB, ICC profiles, and CIE CRI Ra.
     */
    Cie1931: 0, "0": "Cie1931",
    /**
     * CIE 1964 10° supplementary standard observer.
     *
     * Preferred when the viewed area subtends more than ~4° at the eye.
     * Used by CIE 224:2017 / ANSI/IES TM-30 for colour fidelity calculations.
     */
    Cie1964: 1, "1": "Cie1964",
    /**
     * CIE 2015 2° observer — CMFs constructed as linear transforms of the Stockman & Sharpe
     * (2000) cone fundamentals.
     *
     * More accurate than `Cie1931` in the short-wavelength (blue) region.
     */
    Cie2015: 2, "2": "Cie2015",
    /**
     * CIE 2015 10° observer — CMFs constructed as linear transforms of the Stockman & Sharpe
     * (2000) cone fundamentals.
     *
     * Wide-field counterpart of [`Cie2015`](Observer::Cie2015).
     */
    Cie2015_10: 3, "3": "Cie2015_10",
});

/**
 * # Related Tristimulus Values
 *
 * Tristimulus Values for a given sample and reference white,
 * used to represent related colors as used in various color
 * models. Typically the reference white is normalized to have
 * an Y-value of 100
 */
export class RelXYZ {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RelXYZFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_relxyz_free(ptr, 0);
    }
}
if (Symbol.dispose) RelXYZ.prototype[Symbol.dispose] = RelXYZ.prototype.free;

/**
 * Represents a color stimulus using Red, Green, and Blue (RGB) values constrained to the `[0.0, 1.0]` range.
 * Each component is a floating-point value representing the relative intensity of the respective primary color
 * within a defined RGB color space.
 *
 * Unlike the CIE XYZ tristimulus values, which use imaginary primaries, RGB values are defined using real primaries
 * based on a specific color space. These primaries typically form a triangular area within a CIE (x,y) chromaticity
 * diagram, representing the gamut of colors the device can reproduce.
 *
 * # Usage
 * The `Rgb` struct is used to encapsulate color information in a device-independent manner, allowing for accurate color
 * representation, conversion, and manipulation within defined RGB spaces. It is particularly useful for applications
 * involving color management, digital imaging, and rendering where strict adherence to gamut boundaries is required.
 *
 * # Example
 * ```rust
 * # use colorimetry::rgb::Rgb;
 * # use approx::assert_abs_diff_eq;
 *
 * // Create an sRGB color with normalized RGB values
 * let rgb = Rgb::new(0.5, 0.25, 0.75, None, None).unwrap();
 * assert_abs_diff_eq!(rgb.to_array().as_ref(), [0.5, 0.25, 0.75].as_ref(), epsilon = 1e-6);
 * ```
 *
 * # Notes
 * - The `Rgb` struct strictly enforces the `[0.0, 1.0]` range for each component. Any attempt to create values
 *   outside this range will result in an error.
 * - The `observer` field allows for color conversion accuracy under different lighting and viewing conditions,
 *   enhancing the reliability of transformations to other color spaces such as XYZ.
 */
export class Rgb {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RgbFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_rgb_free(ptr, 0);
    }
}
if (Symbol.dispose) Rgb.prototype[Symbol.dispose] = Rgb.prototype.free;

/**
 * Spectrally based color space, using spectral representations of the primaries and the
 * reference white.
 *
 * Using the CIE 1931 standard observer, using a wavelength domain from 380 top 780
 * nanometer with 1 nanometer steps, these result in their usual chromaticity
 * values.  The most common _sRGB_ color space is obtained using the
 * `RgbSpace::srgb()` constructor. For this instance, the blue and green primaries
 * are direct Gaussian-filtered D65 spectra. A mixture of the blue primary and a
 * G1aussian-filtered red component is used for the red primary. Similar
 * constructors are provided for the `Adobe` and `DisplayP3` color spaces.
 *
 * The benefit of spectral primaries is that color management and color profiles
 * can use updated Colorimetric Observers, such as the Cone-Fundamental based CIE
 * 2015 observers, which don't have the CIE 1931 deficiencies. For example, they
 * can also be optimized for special observers by considering an observer's age or
 * health conditions.
 * @enum {0 | 1 | 2 | 3}
 */
export const RgbSpace = Object.freeze({
    SRGB: 0, "0": "SRGB",
    Adobe: 1, "1": "Adobe",
    DisplayP3: 2, "2": "DisplayP3",
    CieRGB: 3, "3": "CieRGB",
});

/**
 *
 * This container holds spectral values within a wavelength domain ranging from 380
 * to 780 nanometers, with an interval size of 1 nanometer and a total of 401
 * values. It also includes a category tag and an optional 'total' value for the
 * aggregate value associated with the spectrum.
 *
 * A `Spectrum` can be constructed from data, but many other construction methods
 * are available in this library, such as standard illuminants A and D65, Planckian
 * (Black Body) illuminants, or a `Stimulus` spectrum for a pixel of an sRGB
 * display.
 *
 */
export class Spectrum {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Spectrum.prototype);
        obj.__wbg_ptr = ptr;
        SpectrumFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SpectrumFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_spectrum_free(ptr, 0);
    }
    /**
     * Returns the spectral data values, as a Float64Array containing 401 data
     * points, over a wavelength domain from 380 t0 780 nanometer, with a
     * stepsize of 1 nanometer.
     * @returns {Float64Array}
     */
    Values() {
        const ret = wasm.spectrum_Values(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * This function maps spectral data with irregular intervals or intervals different than 1
     * nanometer to the standard spectrum as used in this library.
     *
     * For domains with a regular interval, the wavelength slice should have a size of two, containing
     * the minimum and maximum wavelength values, both also in units of meters or nanometers.
     *
     * For irregular domains, this function requires a slice of wavelengths and a slice of spectral
     * data, both of the same size. The wavelengths can be specified in units of meters or nanometers.
     *
     * In case of duplicate wavelength values the last data values is used, so it is impossible to
     * define filters with vertical edges using this method.
     *
     * ```rust
     * // Creates a linear gradient filter, with a zero transmission at 380 nanometer, and full
     * // transmission at 780 nanometer. This is an example using a uniform wavelength domain as input.
     * use colorimetry::prelude::*;
     * use approx::assert_ulps_eq;
     * let data = [0.0, 1.0];
     * let wl = [380.0, 780.0];
     * let mut spd = Spectrum::linear_interpolate(&wl, &data).unwrap();
     * assert_ulps_eq!(spd[380], 0.);
     * assert_ulps_eq!(spd[380+100], 0.25);
     * assert_ulps_eq!(spd[380+200], 0.5);
     * assert_ulps_eq!(spd[380+300], 0.75);
     * assert_ulps_eq!(spd[380+400], 1.0);
     *
     * // Creates a top hat filter, with slanted angles, using an irregular
     * // wavelength domain.
     * let data = vec![0.0, 1.0, 1.0, 0.0];
     * let wl = vec![480.0, 490.0, 570.0, 580.0];
     * let spd = Spectrum::linear_interpolate(&wl, &data).unwrap();
     * assert_ulps_eq!(spd[380+0], 0.0);
     * assert_ulps_eq!(spd[380+100], 0.0);
     * assert_ulps_eq!(spd[380+110], 1.0);
     * assert_ulps_eq!(spd[380+190], 1.0);
     * assert_ulps_eq!(spd[380+200], 0.0);
     * assert_ulps_eq!(spd[380+300], 0.0);
     * assert_ulps_eq!(spd[380+400], 0.0);
     * ```
     * @param {Float64Array} wavelengths
     * @param {Float64Array} data
     * @returns {Spectrum}
     */
    static linearInterpolate(wavelengths, data) {
        const ptr0 = passArrayF64ToWasm0(wavelengths, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.spectrum_linearInterpolate(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Spectrum.__wrap(ret[0]);
    }
    /**
     * Create a new spectrum from the given data.
     *
     * The data must be the 401 values from 380 to 780 nm, with an interval size of 1 nanometer.
     *
     * If the Spectral data you have uses another wavelength domain and/or a different
     * wavelength interval, use the linear interpolate constructor,
     * which takes a wavelength domain and spectral data as arguments.
     * @param {Float64Array} data
     */
    constructor(data) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.spectrum_new_js(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        SpectrumFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Spectrum.prototype[Symbol.dispose] = Spectrum.prototype.free;

/**
 * CIECAM viewing conditions.
 *
 * The ViewConditions as recommended by CIE248:2022 are provided for various scenarios as constants, and are included as:
 * - [`CIE248_CABINET`] Viewing a surface in a cabinet
 * - [`CIE248_HOME_SCREEN`] Viewing a self-luminous display at home
 * - [`CIE248_PROJECTED_DARK`] Viewing projected images in a darkened room
 * - [`CIE248_OFFICE_SCREEN`] Viewing a self-luminous display under office illumination
 *
 * The TM30 and Color Fidelity ViewConditions are provided as [`TM30VC`].
 */
export class ViewConditions {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ViewConditionsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_viewconditions_free(ptr, 0);
    }
}
if (Symbol.dispose) ViewConditions.prototype[Symbol.dispose] = ViewConditions.prototype.free;

/**
 * Represents a color stimulus using unconstrained Red, Green, and Blue (RGB) floating-point values
 * within a device's RGB color space. The values can extend beyond the typical 0.0 to 1.0 range,
 * allowing for out-of-gamut colors that cannot be accurately represented by the device.
 */
export class WideRgb {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WideRgbFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_widergb_free(ptr, 0);
    }
}
if (Symbol.dispose) WideRgb.prototype[Symbol.dispose] = WideRgb.prototype.free;

/**
 * Represents a color by its tristimulus value XYZ color space.
 *
 * The `XYZ` struct represents the tristimulus values (X, Y, Z) and the associated observer.
 * The observer defines the color matching functions used for the conversion.
 */
export class XYZ {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        XYZFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_xyz_free(ptr, 0);
    }
    /**
     * Get the chromaticity coordinates
     * @returns {Array<any>}
     */
    chromaticity() {
        const ret = wasm.xyz_chromaticity(this.__wbg_ptr);
        return ret;
    }
    /**
     * Create an XYZ Tristimuls Values object.
     *
     * Accepts as arguments
     *
     * - x and y chromaticity coordinates only , using the "Cie::Cie1931" observer as default
     * - x and y chromaticity coordinates, and standard observer ID as 3rd argument
     * - X, Y, and Z tristimulus values, using the "Cie::Cie1931" observer as default
     * - X, Y, and Z tristimulus values, and a standard Observer ID as 4th argument
     *
     * When only x and y chromaticity coordinates are specified, the luminous
     * value is set to 100.0 candela per square meter.
     *
     * ```javascript, ignore
     * // Create a new XYZ object using D65 CIE 1931 chromaticity coordinates
     * const xyz = new cmt.XYZ(0.31272, 0.32903);
     *
     * // Get and check the corresponding tristimulus values, with a luminous value
     * // of 100.0
     * const [x, y, z] = xyz.to_array();
     * assert.assertAlmostEquals(x, 95.047, 5E-3); // D65 wikipedia
     * assert.assertAlmostEquals(y, 100.0);
     * assert.assertAlmostEquals(z, 108.883, 5E-3);
     *
     * // and get back the orgiinal chromaticity coordinates:
     * const [xc, yc] = xyz.chromaticity();
     * assert.assertAlmostEquals(xc, 0.31272);
     * assert.assertAlmostEquals(yc, 0.32903);
     *
     * // to get the luminous value:
     * const l = xyz.luminousValue();
     * assert.assertAlmostEquals(l, 100.0);
     * // D65 CIE 1931 chromaticity coordinates
     * const xyz = new cmt.XYZ(0.31272, 0.32903);
     * ```
     * @param {number} x
     * @param {number} y
     * @param {...Array<any>} opt
     */
    constructor(x, y, ...opt) {
        const ret = wasm.xyz_new_js(x, y, opt);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        XYZFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get the XYZ tristimulus value as an array.
     * @returns {Array<any>}
     */
    values() {
        const ret = wasm.xyz_values(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get the luminous value, Y.
     * @returns {number}
     */
    y() {
        const ret = wasm.xyz_y(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) XYZ.prototype[Symbol.dispose] = XYZ.prototype.free;

/**
 * Alpha-weighted subtractive (multiply) blend. Both slices are flat RGBA u8 of equal length.
 * For each pixel: base_channel = base_channel × lerp(255, overlay_channel, overlay_alpha/255) / 255
 * This simulates transparent riso ink on paper: overlapping inks darken subtractively.
 * @param {Uint8Array} base
 * @param {Uint8Array} overlay
 * @returns {Uint8Array}
 */
export function blend_subtractive(base, overlay) {
    const ptr0 = passArray8ToWasm0(base, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(overlay, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.blend_subtractive(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Build a 3-D RGB lookup table for fast color separation.
 * `grid_size` cells per channel (e.g. 16 → 16³ = 4096 cells).
 * Each cell stores 7 weight bytes (one per riso color, 0–255).
 * @param {Uint8Array} riso_colors
 * @param {number} max_mix
 * @param {number} grid_size
 * @returns {Uint8Array}
 */
export function build_color_lut(riso_colors, max_mix, grid_size) {
    const ptr0 = passArray8ToWasm0(riso_colors, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.build_color_lut(ptr0, len0, max_mix, grid_size);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Evaluate multiple candidate palettes and return the average CIEDE2000
 * distance for each.  Lower score = better match to the original image.
 *
 * `image_data`     — flat RGBA source image.
 * `candidate_colors` — flattened RGB values for all palettes concatenated.
 * `candidate_counts` — number of colors in each palette (length = num candidates).
 * `max_mix`        — max colors mixed per LUT cell (1–3).
 * `grid_size`      — LUT resolution per channel (e.g. 16 or 32).
 *
 * Returns a `Vec<f64>` where each element is the average ΔE for the
 * corresponding candidate palette.
 * @param {Uint8Array} image_data
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} candidate_colors
 * @param {Uint32Array} candidate_counts
 * @param {number} max_mix
 * @param {number} grid_size
 * @returns {Float64Array}
 */
export function evaluate_palettes(image_data, width, height, candidate_colors, candidate_counts, max_mix, grid_size) {
    const ptr0 = passArray8ToWasm0(image_data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(candidate_colors, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray32ToWasm0(candidate_counts, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.evaluate_palettes(ptr0, len0, width, height, ptr1, len1, ptr2, len2, max_mix, grid_size);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * Extract just positions + hues as a flat [x, y, hue, ...] array for the GPU.
 * @param {Float32Array} data
 * @returns {Float32Array}
 */
export function extract_render_data(data) {
    const ptr0 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.extract_render_data(ptr0, len0);
    var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * Apply a simple threshold-based halftone to a single grayscale plate.
 * @param {Uint8Array} image_data
 * @param {number} width
 * @param {number} height
 * @param {number} cell_size
 * @returns {Uint8Array}
 */
export function halftone_plate(image_data, width, height, cell_size) {
    const ptr0 = passArray8ToWasm0(image_data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.halftone_plate(ptr0, len0, width, height, cell_size);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Initialize a particle system with `count` particles.
 * Returns a flat f32 array: [x0, y0, vx0, vy0, hue0, x1, y1, ...]
 * @param {number} count
 * @param {number} seed
 * @returns {Float32Array}
 */
export function init_particles(count, seed) {
    const ret = wasm.init_particles(count, seed);
    var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * Legacy API: builds a temporary LUT internally, then decomposes.
 * Slower than the two-step LUT approach but keeps the same signature.
 * @param {Uint8Array} image_data
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} riso_colors
 * @param {number} max_mix
 * @returns {Uint8Array}
 */
export function separate_colors(image_data, width, height, riso_colors, max_mix) {
    const ptr0 = passArray8ToWasm0(image_data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(riso_colors, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.separate_colors(ptr0, len0, width, height, ptr1, len1, max_mix);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Decompose an RGBA image into risograph plates using a pre-built LUT.
 * This is ~20–50× faster than per-pixel brute-force search.
 * @param {Uint8Array} image_data
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} lut
 * @param {number} grid_size
 * @param {number} num_colors
 * @returns {Uint8Array}
 */
export function separate_colors_with_lut(image_data, width, height, lut, grid_size, num_colors) {
    const ptr0 = passArray8ToWasm0(image_data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(lut, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.separate_colors_with_lut(ptr0, len0, width, height, ptr1, len1, grid_size, num_colors);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Simulate a physical risograph print by blending grayscale plates
 * with their ink colors using subtractive (multiply) blending.
 *
 * `plates` — flat RGBA array from `separate_colors_with_lut`.
 *            Layout: [plate0_rgba…, plate1_rgba…, …]  (0 = full ink, 255 = no ink)
 * `colors` — flat RGB array of ink colors, one per plate.
 * Returns a flat RGBA composite image.
 * @param {Uint8Array} plates
 * @param {Uint8Array} colors
 * @param {number} width
 * @param {number} height
 * @param {number} num_colors
 * @returns {Uint8Array}
 */
export function simulate_print(plates, colors, width, height, num_colors) {
    const ptr0 = passArray8ToWasm0(plates, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(colors, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.simulate_print(ptr0, len0, ptr1, len1, width, height, num_colors);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Step the simulation forward by `dt` seconds.
 * Mutates positions using velocities; wraps at ±1.
 * @param {Float32Array} data
 * @param {number} dt
 * @param {number} time
 */
export function step_particles(data, dt, time) {
    var ptr0 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.step_particles(ptr0, len0, data, dt, time);
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_55538483de6e3abe: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_copy_to_typed_array_2f7503a7f71d6632: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_number_get_769f3676dc20c1d7: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_f1161390414f9b59: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_5549492daedad139: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_try_into_number_fffecc56fa532ebc: function(arg0) {
            let result;
            try { result = +arg0 } catch (e) { result = e }
            const ret = result;
            return ret;
        },
        __wbg_get_94f5fc088edd3138: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_length_fae3e439140f48a4: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_of_b34b18dbe6239202: function(arg0, arg1) {
            const ret = Array.of(arg0, arg1);
            return ret;
        },
        __wbg_of_d52e1bec2c68faf0: function(arg0, arg1, arg2) {
            const ret = Array.of(arg0, arg1, arg2);
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./super_collage_bg.js": import0,
    };
}

const ChromaticityFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_chromaticity_free(ptr >>> 0, 1));
const CieLabFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_cielab_free(ptr >>> 0, 1));
const IlluminantFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_illuminant_free(ptr >>> 0, 1));
const RelXYZFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_relxyz_free(ptr >>> 0, 1));
const RgbFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_rgb_free(ptr >>> 0, 1));
const SpectrumFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_spectrum_free(ptr >>> 0, 1));
const ViewConditionsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_viewconditions_free(ptr >>> 0, 1));
const WideRgbFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_widergb_free(ptr >>> 0, 1));
const XYZFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_xyz_free(ptr >>> 0, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('super_collage_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
