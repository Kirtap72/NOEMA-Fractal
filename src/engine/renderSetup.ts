/**
 * Image format and size: the proportions of the picture (16:9, 2:3, ...), how long its longest side is, and which
 * direction the camera's field of view is measured in. Stored in the scene as `render` (added in scene version 6).
 * The maths is plain geometry (see ARCHITECTURE.md 8.16, step 1).
 */

export const FORMAT_PRESETS = ["free", "16:9", "3:2", "2:3", "1:1", "4:3", "3:4", "9:16", "21:9", "4:5", "5:4", "A4 portrait", "A4 landscape", "custom"] as const;
export type FormatPreset = (typeof FORMAT_PRESETS)[number];

export const FOV_AXES = ["vertical", "horizontal"] as const;
export type FovAxis = (typeof FOV_AXES)[number];

export interface RenderFormat {
  /** "free" follows the window (as before version 6); "custom" uses `ratio`. */
  preset: FormatPreset;
  /** Width and height proportions, only for "custom". */
  ratio?: [number, number];
}

/**
 * How carefully a picture is drawn. These are the "detail" controls: the preview uses cheap values, a final
 * picture can use much finer ones (smaller hit precision, more steps, several samples per pixel).
 */
export const PRECISION_MODES = ["fixed", "pixel"] as const;
export type PrecisionMode = (typeof PRECISION_MODES)[number];

export interface QualitySettings {
  /** Opt-in per-pixel nested-scrambled camera coverage. Absent retains the original R2 sequence. */
  camera_sampling?: "legacy" | "stratified";
  /** Opt-in primary shading offset, capped by one pixel of the target film. Absent preserves legacy arithmetic. */
  normal_policy?: "legacy" | "film-detail";
  /** Opt-in primary acceptance cap at half a target-film pixel. Does not change normals or step budgets. */
  hit_policy?: "legacy" | "film-half-pixel";
  /**
   * Opt-in (scene version 44): scales the Float32 floor of the hit threshold and normal step, which is 2e-6 x (1 + distance from the origin) and
   * otherwise stops finer settings from adding detail in deep zooms. 1 or absent = the floor every earlier scene had. Smaller values reach
   * deeper into what 32-bit arithmetic can still tell apart; the distance estimate must stay clearly below the new floor (see INTELLIGENT_RENDERING_02).
   */
  precision_floor?: number;
  /** Samples per pixel (smooth edges). 1 = one sample at the pixel centre. Deterministic: the same seed gives the same picture. */
  samples_per_pixel: number;
  /**
   * How close to the surface a ray counts as a hit, as a fraction of the distance travelled (plus a small constant).
   * Smaller = finer detail but slower. 0.0004 is the long-standing default and suits about 1080 pixels of height.
   */
  hit_precision: number;
  /** Fraction of the distance estimate that each step moves (1 = full, smaller = safer for rough distance estimates). */
  step_factor: number;
  /** The most steps one ray may take. */
  max_steps: number;
  /** Rays that get further than this are counted as misses. */
  max_distance: number;
  /** Size of the step used to find the surface direction (the normal). */
  normal_epsilon: number;
  /** The most steps a shadow ray may take (version 9). */
  shadow_steps: number;
  /**
   * How the hit threshold and the normal step are set (version 10). "fixed": hit_precision * (1 + distance) and
   * normal_epsilon, the same at every picture size (what scenes had before). "pixel": a share of the size of one pixel
   * at that distance (hit_pixels, normal_pixels), so they follow the resolution: an 8K picture gets four times finer
   * thresholds than a 1080p one. Pixel mode has a Float32 floor; legacy fixed mode retains its original arithmetic.
   */
  precision_mode: PrecisionMode;
  /** "pixel" mode: the hit threshold as a share of one pixel. */
  hit_pixels: number;
  /** "pixel" mode: the step used to find the surface direction, as a share of one pixel. */
  normal_pixels: number;
  /** Starts the pattern of sample positions, so a picture can be reproduced exactly. */
  seed: number;
}

export const QUALITY_LIMITS = {
  samples_per_pixel: [1, 64],
  hit_precision: [1e-7, 0.05],
  step_factor: [0.05, 1],
  max_steps: [20, 20000],
  max_distance: [1, 1000],
  normal_epsilon: [1e-7, 0.05],
  shadow_steps: [4, 2048],
  hit_pixels: [0.01, 4],
  precision_floor: [0.02, 1],
  normal_pixels: [0.05, 16],
  seed: [0, 2147483647],
} as const;

/** The values scenes had before version 7: exactly what the shader used to have built in. */
export const DEFAULT_QUALITY: QualitySettings = {
  samples_per_pixel: 1,
  hit_precision: 0.0004,
  step_factor: 0.75,
  max_steps: 220,
  max_distance: 60,
  normal_epsilon: 0.0008,
  shadow_steps: 32,
  precision_mode: "fixed",
  hit_pixels: 0.5,
  normal_pixels: 1,
  seed: 0,
};

export function defaultQuality(): QualitySettings {
  return { ...DEFAULT_QUALITY };
}

/**
 * Where inside the pixel sample number `index` is taken, as an offset in pixels from the centre (each from -0.5 to 0.5).
 * Sample 0 is always the centre (so one sample per pixel is exactly the old picture). The others follow the
 * "R2" sequence (a low-discrepancy sequence built from the plastic number, M. Roberts 2018), started at a point
 * that depends on the seed. Plain geometry and arithmetic: deterministic and well spread.
 */
export function sampleJitter(index: number, seed = 0): [number, number] {
  if (index === 0) return [0, 0];
  const g = 1.32471795724474602596; // the plastic number: the real root of x^3 = x + 1
  const a1 = 1 / g;
  const a2 = 1 / (g * g);
  const frac = (x: number): number => x - Math.floor(x);
  const x = frac(0.5 + seed * a1 + index * a1);
  const y = frac(0.5 + seed * a2 + index * a2);
  return [x - 0.5, y - 0.5];
}

/** The picture settings that hold for the whole scene. */
export interface RenderSetup {
  /** Exact still-image dimensions. Omitted means the existing format/long-side workflow. */
  resolution?: { width: number; height: number };
  format: RenderFormat;
  /** Which direction `camera.fov_degrees` is measured in. "vertical" is what scenes had before version 6. */
  fov_axis: FovAxis;
  /** Pixels on the longest side. */
  long_side: number;
  /** Detail controls for final pictures (added in version 7). */
  quality: QualitySettings;
}

/** Float32 raster coordinates must retain half-pixel centres. GPU textures are tiled separately. */
export const MAX_LONG_SIDE = 2 ** 23;
/** @deprecated No art-resolution pixel cap. Only exact integer arithmetic is required. */
export const MAX_PIXELS = Number.MAX_SAFE_INTEGER;
export const MIN_LONG_SIDE = 16;
/** Proportions beyond this (more than 10 to 1) are refused: they are almost always a typing mistake. */
export const MAX_ASPECT = 10;

export const DEFAULT_RENDER_SETUP: RenderSetup = { format: { preset: "free" }, fov_axis: "vertical", long_side: 1920, quality: { ...DEFAULT_QUALITY } };

export function defaultRenderSetup(): RenderSetup {
  return structuredClone(DEFAULT_RENDER_SETUP);
}

/** The setup with some quality values changed. */
export function withQuality(setup: RenderSetup, changes: Partial<QualitySettings>): RenderSetup {
  return { ...setup, quality: { ...setup.quality, ...changes } };
}

/** Width divided by height of the chosen format, or null for "free" (it depends on the window). */
export function formatAspect(format: RenderFormat): number | null {
  if (format.preset === "free") return null;
  if (format.preset === "custom") return format.ratio ? format.ratio[0] / format.ratio[1] : null;
  if(format.preset==='A4 portrait')return 210/297;
  if(format.preset==='A4 landscape')return 297/210;
  const [w, h] = format.preset.split(":").map(Number) as [number, number];
  return w / h;
}

/** Rounds to the nearest even whole number (video encoders need even sizes), at least 2. */
const even = (n: number): number => Math.max(2, 2 * Math.round(n / 2));

/**
 * The width and height in pixels. The longest side is `long_side`; the other follows the proportions and is
 * rounded to an even number. For the "free" format `windowAspect` (width / height of the window) is used.
 */
export function outputSize(setup: RenderSetup, windowAspect = 16 / 9): { width: number; height: number } {
  if (setup.resolution) return { ...setup.resolution };
  const aspect = formatAspect(setup.format) ?? windowAspect;
  const long = even(setup.long_side);
  return aspect >= 1 ? { width: long, height: even(long / aspect) } : { width: even(long * aspect), height: long };
}

/** Genuine coordinate/arithmetic constraints; allocation/encoding limits are handled by the chosen output path. */
export function checkOutputSize(width: number, height: number): string | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return "the size must be whole numbers, 1 or more";
  if (Math.max(width, height) > MAX_LONG_SIDE) return `Float32 half-pixel coordinates support at most ${MAX_LONG_SIDE} pixels on a side`;
  if (!Number.isSafeInteger(width * height)) return "the pixel count exceeds exact integer arithmetic";
  return null;
}

export function outputCost(width: number, height: number): { megapixels: number; rgbaBytes: number; layerBytes: number; rgbBytes: number; warning: string | null } {
  const pixels = width * height;
  return { megapixels: pixels / 1e6, rgbaBytes: pixels * 4, layerBytes: pixels * 20, rgbBytes: pixels * 3,
    warning: pixels >= 100_000_000 ? "Large picture: use streaming PNG to file. Memory, disk and the rendering can become extensive." : pixels >= 33_177_600 ? "Large picture: tiles are used. Streaming PNG avoids storing the whole picture in memory." : null };
}

/** Scale a manual or preset frame down for an explicitly requested test render, preserving its aspect. */
export function testRenderSetup(setup: RenderSetup, longSide: number): RenderSetup {
  if (!setup.resolution) return { ...setup, long_side: longSide };
  const scale = longSide / Math.max(setup.resolution.width, setup.resolution.height);
  return { ...setup, resolution: { width: even(setup.resolution.width * scale), height: even(setup.resolution.height * scale) } };
}

/**
 * The vertical field of view in degrees that the shader needs, given how `fov` is measured.
 * Horizontal: tan(vertical / 2) = tan(horizontal / 2) / (width / height).
 */
export function verticalFovDegrees(fov: number, axis: FovAxis, width: number, height: number): number {
  if (axis === "vertical" || !(width > 0) || !(height > 0)) return fov;
  return (2 * Math.atan(Math.tan((fov * Math.PI) / 360) / (width / height)) * 180) / Math.PI;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Reads and checks the `render` block. Left out means the defaults (what scenes were before version 6). */
export function readRenderSetup(raw: unknown, where: string, errors: string[]): RenderSetup | undefined {
  if (raw === undefined) return defaultRenderSetup();
  if (!isObj(raw)) return void errors.push(`${where} must be an object`);
  const before = errors.length;
  const def = DEFAULT_RENDER_SETUP;

  let format: RenderFormat = { preset: "free" };
  if (raw.format !== undefined) {
    const f = raw.format;
    if (!isObj(f) || typeof f.preset !== "string" || !(FORMAT_PRESETS as readonly string[]).includes(f.preset)) {
      errors.push(`${where}.format.preset must be one of: ${FORMAT_PRESETS.join(", ")}`);
    } else if (f.preset === "custom") {
      const r = f.ratio;
      const ok = Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1000);
      if (!ok) errors.push(`${where}.format.ratio must be two numbers above 0 (width, height)`);
      else if ((r as number[])[0]! / (r as number[])[1]! > MAX_ASPECT || (r as number[])[1]! / (r as number[])[0]! > MAX_ASPECT) {
        errors.push(`${where}.format.ratio must not be more than ${MAX_ASPECT} to 1`);
      } else format = { preset: "custom", ratio: [(r as number[])[0]!, (r as number[])[1]!] };
    } else {
      format = { preset: f.preset as FormatPreset };
    }
  }

  let axis: FovAxis = def.fov_axis;
  if (raw.fov_axis !== undefined) {
    if (typeof raw.fov_axis === "string" && (FOV_AXES as readonly string[]).includes(raw.fov_axis)) axis = raw.fov_axis as FovAxis;
    else errors.push(`${where}.fov_axis must be "vertical" or "horizontal"`);
  }

  let long = def.long_side;
  if (raw.long_side !== undefined) {
    const l = raw.long_side;
    if (!Number.isInteger(l) || (l as number) < MIN_LONG_SIDE || (l as number) > MAX_LONG_SIDE) {
      errors.push(`${where}.long_side must be a whole number from ${MIN_LONG_SIDE} to ${MAX_LONG_SIDE}`);
    } else long = l as number;
  }

  const quality = readQuality(raw.quality, `${where}.quality`, errors);

  if (errors.length > before) return undefined;
  const setup: RenderSetup = { format, fov_axis: axis, long_side: long, quality: quality! };
  if (raw.resolution !== undefined) {
    const r = raw.resolution;
    const problem = !isObj(r) ? "resolution must be an object" : checkOutputSize(r.width as number, r.height as number);
    if (problem) { errors.push(`${where}.resolution: ${problem}`); return undefined; }
    setup.resolution = { width: (r as Record<string, number>).width!, height: (r as Record<string, number>).height! };
  }
  // Fixed/manual dimensions can be checked now; a free viewport is checked when rendering.
  if (formatAspect(format) !== null) {
    const { width, height } = outputSize(setup);
    const problem = checkOutputSize(width, height);
    if (problem) {
      errors.push(`${where}: ${problem}`);
      return undefined;
    }
  }
  return setup;
}

const INTEGER_QUALITY = new Set<keyof typeof QUALITY_LIMITS>(["samples_per_pixel", "max_steps", "shadow_steps", "seed"]);

/** Reads and checks the `quality` block. Missing values get the defaults. */
export function readQuality(raw: unknown, where: string, errors: string[]): QualitySettings | undefined {
  if (raw === undefined) return defaultQuality();
  if (!isObj(raw)) return void errors.push(`${where} must be an object`);
  const before = errors.length;
  const out = defaultQuality();
  if(raw.camera_sampling!==undefined){
    if(raw.camera_sampling==='legacy'||raw.camera_sampling==='stratified')out.camera_sampling=raw.camera_sampling;
    else errors.push(`${where}.camera_sampling must be "legacy" or "stratified"`);
  }
  for (const key of Object.keys(QUALITY_LIMITS) as (keyof typeof QUALITY_LIMITS)[]) {
    const v = raw[key];
    if (v === undefined) continue;
    const [lo, hi] = QUALITY_LIMITS[key];
    const whole = INTEGER_QUALITY.has(key);
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) {
      errors.push(`${where}.${key} must be ${whole ? "a whole number" : "a number"} from ${lo} to ${hi}`);
    } else out[key] = v;
  }
  if (raw.precision_mode !== undefined) {
    if (typeof raw.precision_mode === "string" && (PRECISION_MODES as readonly string[]).includes(raw.precision_mode)) out.precision_mode = raw.precision_mode as PrecisionMode;
    else errors.push(`${where}.precision_mode must be "fixed" or "pixel"`);
  }
  if (raw.normal_policy !== undefined) {
    if (raw.normal_policy === "legacy" || raw.normal_policy === "film-detail") out.normal_policy = raw.normal_policy;
    else errors.push(`${where}.normal_policy must be "legacy" or "film-detail"`);
  }
  if (raw.hit_policy !== undefined) {
    if (raw.hit_policy === "legacy" || raw.hit_policy === "film-half-pixel") out.hit_policy = raw.hit_policy;
    else errors.push(`${where}.hit_policy must be "legacy" or "film-half-pixel"`);
  }
  return errors.length > before ? undefined : out;
}

/** A hit precision that fits the picture's height, so the finest detail the pixels can show is also found. */
export function suggestedHitPrecision(fovDegrees: number, verticalPixels: number): number {
  // Half a pixel's footprint per unit of distance: tan(fov / 2) * 2 / pixels / 2. Rounded to two digits.
  const raw = Math.tan((fovDegrees * Math.PI) / 360) / Math.max(1, verticalPixels);
  const clamped = Math.min(Math.max(raw, QUALITY_LIMITS.hit_precision[0]), 0.0004);
  return Number(clamped.toPrecision(2));
}

/** Linear image scales for fast preview modes (50%, 75%, 100%). A 50% linear scale renders 25% as many pixels, not a guaranteed 4x wall-time speedup. */
/**
 * The hit and normal thresholds that make a smaller picture see the same surface as the full-size one. In pixel mode the thresholds are
 * a share of one pixel, so a picture drawn at 1/14 of the final size would otherwise accept hits 14 times coarser in world units
 * (LOOKDEV-04: that is why a small preview of a dense fractal showed other geometry than the final render). Film-based policies already
 * follow the unscaled reference film and are left alone.
 */
export function finalGeometryQuality(baseQuality: QualitySettings, previewHeight: number, fullHeight: number): Partial<QualitySettings> {
  if (baseQuality.precision_mode !== "pixel") return {};
  const heightRatio = previewHeight / Math.max(1, fullHeight);
  return {
    ...(baseQuality.hit_policy !== "film-half-pixel" ? { hit_pixels: Math.max(QUALITY_LIMITS.hit_pixels[0], baseQuality.hit_pixels * heightRatio) } : {}),
    ...(baseQuality.normal_policy !== "film-detail" ? { normal_pixels: Math.max(QUALITY_LIMITS.normal_pixels[0], baseQuality.normal_pixels * heightRatio) } : {}),
  };
}

export const PREVIEW_SCALES = [0.5, 0.75, 1] as const;
export type PreviewScale = (typeof PREVIEW_SCALES)[number];

/** Independently selectable light/image sample budgets for fast noisy previews or higher-quality rendering. */
export const PREVIEW_LIGHT_SAMPLES = [1, 2, 4, 8, 16] as const;
export type PreviewLightSamples = (typeof PREVIEW_LIGHT_SAMPLES)[number];

export interface ScaledPreviewPlan {
  scale: PreviewScale;
  /** Fraction of full-resolution pixels (0.25 at 50%, 0.5625 at 75%, 1.0 at 100%). */
  pixelRatio: number;
  /** Unscaled full film dimensions, preserving Geometry Detail, DS precision, Box Cut and hit/normal policies. */
  referenceFilm: { width: number; height: number };
  /** Scaled film dimensions passed to renderToBuffer. */
  film: { width: number; height: number };
  /** Scaled region within the scaled film. */
  region: { x: number; y: number; width: number; height: number };
  /** Quality overrides for the preview call (never mutates saved scene.render.quality). */
  quality: Partial<QualitySettings>;
  /** Effective samples per pixel for the preview render. */
  samplesPerPixel: number;
}

/**
 * Computes a scaled preview render plan (50%, 75% or 100% linear scale + optional independent light sample budget)
 * while preserving the unscaled referenceFilm and world-space hit/normal thresholds so Geometry Detail, DS precision,
 * Box Cut fidelity and formula iterations are never silently reduced.
 */
export function planScaledPreview(
  fullFilm: { width: number; height: number },
  baseQuality: QualitySettings,
  options: {
    scale?: PreviewScale;
    samplesPerPixel?: number | null;
    region?: { x: number; y: number; width: number; height: number };
  } = {},
): ScaledPreviewPlan {
  const scale: PreviewScale = options.scale ?? 1;
  if (!(PREVIEW_SCALES as readonly number[]).includes(scale)) {
    throw new Error(`Preview scale must be one of: ${PREVIEW_SCALES.join(", ")}`);
  }
  const samples = options.samplesPerPixel ?? baseQuality.samples_per_pixel;
  if (!Number.isInteger(samples) || samples < QUALITY_LIMITS.samples_per_pixel[0] || samples > QUALITY_LIMITS.samples_per_pixel[1]) {
    throw new Error(`Preview light samples must be a whole number from ${QUALITY_LIMITS.samples_per_pixel[0]} to ${QUALITY_LIMITS.samples_per_pixel[1]}`);
  }
  const baseRegion = options.region ?? { x: 0, y: 0, width: fullFilm.width, height: fullFilm.height };
  const filmWidth = scale === 1 ? fullFilm.width : Math.max(1, Math.round(fullFilm.width * scale));
  const filmHeight = scale === 1 ? fullFilm.height : Math.max(1, Math.round(fullFilm.height * scale));
  const rx = scale === 1 ? baseRegion.x : Math.min(filmWidth - 1, Math.max(0, Math.round(baseRegion.x * scale)));
  const ry = scale === 1 ? baseRegion.y : Math.min(filmHeight - 1, Math.max(0, Math.round(baseRegion.y * scale)));
  const rw = scale === 1 ? baseRegion.width : Math.max(1, Math.min(filmWidth - rx, Math.round(baseRegion.width * scale)));
  const rh = scale === 1 ? baseRegion.height : Math.max(1, Math.min(filmHeight - ry, Math.round(baseRegion.height * scale)));
  const quality: Partial<QualitySettings> = {
    samples_per_pixel: samples,
    ...(scale !== 1 ? finalGeometryQuality(baseQuality, filmHeight, fullFilm.height) : {}),
  };
  return {
    scale,
    pixelRatio: (rw * rh) / Math.max(1, baseRegion.width * baseRegion.height),
    referenceFilm: { width: fullFilm.width, height: fullFilm.height },
    film: { width: filmWidth, height: filmHeight },
    region: { x: rx, y: ry, width: rw, height: rh },
    quality,
    samplesPerPixel: samples,
  };
}
