/**
 * ARTIST-WORKFLOW 01: fog written in terms of the DEPTH OF THE PICTURE, not of one subject distance.
 *
 * Why. The older relative controls (subjectScale.ts) say "start at 1x the subject distance, N % one subject distance later". That is scale-free,
 * but a fractal usually fills a thin slice of depth around its subject: the visible surfaces may span only 10 to 30 % of the camera distance.
 * Then "start at the subject" fogs everything almost equally (the uniform fog "covers the whole image"), and moving the start behind the subject
 * leaves every surface clear (the fog "barely affects the background" however far the slider goes). The surfaces the artist sees are what
 * matters, so these controls are pinned to them:
 *
 *   near  = the closest visible surface (2nd percentile of the hit depths of a coarse depth grid)
 *   far   = the farthest visible surface (98th percentile)
 *   start = a position between near and far (0 % = at the nearest surface, 100 % = at the farthest)
 *   back  = how much fog covers the farthest surface (0 = none, 1 = only fog: see DEPTH_FULL_FOG)
 *
 * The scene still stores ordinary absolute fog (colour, density, start, mode): nothing new is saved, old scenes are read exactly as before, and
 * everything here is derived from the absolute values and a measurement, like subjectScale.ts. The same two numbers (start, back) give the same
 * picture in the exponential and the squared mode at the farthest surface; the mode only shapes the way there. Textbook fog, see fog.ts:
 *   exponential:         amount = 1 - exp(-density * (d - start))           =>  density = -ln(1 - back) / (far - start)
 *   exponential_squared: amount = 1 - exp(-(density * (d - start))^2)       =>  density = sqrt(-ln(1 - back)) / (far - start)
 */
import { FOG_LIMITS, fogAmount } from "./fog";
import type { FogMode, FogSettings } from "./fog";

/** The visible depth of a view, in scene units along the ray (the unit the fog shader uses). */
export interface DepthRange {
  near: number;
  far: number;
  /** Share of the sampled rays that hit a surface (0 to 1). */
  hitShare: number;
}

/** Fewer hits than this share of the grid, or fewer than MIN_HITS rays, is not a measurement worth building fog on. */
export const DEPTH_MIN_HIT_SHARE = 0.02;
export const DEPTH_MIN_HITS = 12;
/** Percentiles that stand for "closest" and "farthest": a few stray rays at a rim must not decide where the fog goes. */
export const DEPTH_PERCENTILES = [0.02, 0.98] as const;

/**
 * Reads the depth range from a depth layer (one number per ray: the distance to the surface, or a value that is not positive
 * or not finite when the ray missed). Returns null when too little is visible to say anything.
 */
export function depthRangeOf(depth: ArrayLike<number>): DepthRange | null {
  const hits: number[] = [];
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]!;
    if (Number.isFinite(d) && d > 0) hits.push(d);
  }
  if (hits.length < DEPTH_MIN_HITS || hits.length / Math.max(1, depth.length) < DEPTH_MIN_HIT_SHARE) return null;
  hits.sort((a, b) => a - b);
  const at = (p: number): number => hits[Math.min(hits.length - 1, Math.max(0, Math.floor(p * (hits.length - 1) + 0.5)))]!;
  const near = at(DEPTH_PERCENTILES[0]);
  const far = at(DEPTH_PERCENTILES[1]);
  return { near, far: Math.max(far, near), hitShare: hits.length / depth.length };
}

/** The controls an artist sees. */
export interface DepthFog {
  /** 0 = fog begins at the nearest visible surface, 1 = at the farthest. */
  start: number;
  /** Share of the colour of the farthest visible surface that is replaced by fog. */
  back: number;
}

export const DEPTH_FOG_LIMITS = { start: [0, 0.95], back: [0, 1] } as const;

/**
 * Textbook fog never reaches exactly 1 at a finite distance. "100 %" therefore means the share where the surface differs from the fog colour by
 * less than one part in two thousand (invisible in an 8-bit picture): amount 0.9995, density k = -ln(1 - 0.9995) = 7.6 over the build-up distance.
 * The readout rounds that to 100 %.
 */
export const DEPTH_FULL_FOG = 0.9995;

/** A flat view (all surfaces at nearly one depth) would make the controls meaningless; this keeps a usable span, as a share of the far depth. */
export const DEPTH_MIN_SPAN = 0.1;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The span the controls act on: the measured one, widened to at least DEPTH_MIN_SPAN of the far depth. */
export function effectiveSpan(range: DepthRange): number {
  return Math.max(range.far - range.near, DEPTH_MIN_SPAN * range.far);
}

export interface FogFromDepth {
  start: number;
  density: number;
  /** True when the scene's own limits (FOG_LIMITS, density at most 1e6) stopped the wanted value from being reached exactly. */
  limited: boolean;
}

/** The absolute fog start and density that give `wanted` over this depth range, in the given mode. */
export function fogFromDepth(wanted: DepthFog, range: DepthRange, mode: FogMode): FogFromDepth {
  const startFraction = clamp(Number.isFinite(wanted.start) ? wanted.start : 0, ...DEPTH_FOG_LIMITS.start);
  const back = clamp(Number.isFinite(wanted.back) ? wanted.back : 0, ...DEPTH_FOG_LIMITS.back);
  const span = effectiveSpan(range);
  const wantedStart = range.near + startFraction * span;
  // The distance over which the fog has to build up to `back`. Never below 5 % of the span, or a start at 95 % would ask for an enormous density.
  const run = Math.max(range.near + span - wantedStart, 0.05 * span);
  const k = -Math.log1p(-Math.min(back, DEPTH_FULL_FOG));
  const wantedDensity = (mode === "exponential_squared" ? Math.sqrt(k) : k) / run;
  const start = clamp(wantedStart, FOG_LIMITS.start[0], FOG_LIMITS.start[1]);
  const density = clamp(wantedDensity, FOG_LIMITS.density[0], FOG_LIMITS.density[1]);
  return { start, density, limited: start !== wantedStart || density !== wantedDensity };
}

/** The picture-depth reading of a scene's absolute fog. Always derived, never stored. Evaluates as if the fog were on. */
export function depthFogFromFog(fog: FogSettings, range: DepthRange): DepthFog {
  const span = effectiveSpan(range);
  return {
    start: clamp((fog.start - range.near) / span, 0, 1),
    back: fogAmount({ ...fog, enabled: true }, range.near + span),
  };
}

/** How much fog covers the closest and the farthest visible surface, 0 to 1. The direct answer to "is my picture washed out?". */
export function fogAcrossDepth(fog: FogSettings, range: DepthRange): { near: number; far: number } {
  const on = { ...fog, enabled: true };
  return { near: fogAmount(on, range.near), far: fogAmount(on, range.far) };
}

/** Artistic starting points. Numbers are the controls above, so they mean the same at any scale. `sky` fogs the backdrop too. */
export interface DepthFogPreset {
  id: string;
  label: string;
  hint: string;
  value: DepthFog;
  mode: FogMode;
  sky: boolean;
}

export const DEPTH_FOG_PRESETS: readonly DepthFogPreset[] = [
  { id: "haze", label: "Light haze", hint: "Weak air that takes the edge off the farthest parts. Near surfaces are untouched.", value: { start: 0.25, back: 0.3 }, mode: "exponential", sky: false },
  { id: "depth", label: "Deep fog", hint: "Clear near, dense far away. Gives clear depth without covering what is near.", value: { start: 0.05, back: 0.7 }, mode: "exponential_squared", sky: false },
  { id: "backdrop", label: "Background fog", hint: "What lies furthest back melts into the background. The background gets the colour of the fog.", value: { start: 0.2, back: 0.95 }, mode: "exponential_squared", sky: true },
  { id: "thick", label: "Dense fog", hint: "Even, heavy fog over the whole picture that still gives depth.", value: { start: 0, back: 0.9 }, mode: "exponential", sky: false },
];
