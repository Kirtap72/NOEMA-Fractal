/**
 * Subject scale: a safe "how far away is the thing I am looking at" number, so artist controls can be written
 * relative to the subject instead of in raw scene units. NOEMA scenes range from a subject 0.02 units away to
 * 15 units away, so a fixed absolute fog value looks right in one scene and wrong in another.
 *
 * Nothing here is stored in a scene. The scene keeps its absolute values; these helpers only translate between the
 * absolute values and a scale-free view of them, using the fog formula of the shader (see ./fog.ts, fogAmount):
 *   exponential:         amount = 1 - exp(-density * (distance - start))
 *   exponential_squared: amount = 1 - exp(-(density * (distance - start))^2)
 */
import type { SceneCamera, Vec3 } from "./camera";
import { FOG_LIMITS, fogAmount } from "./fog";
import type { FogSettings } from "./fog";

/** Where the reference distance came from. A picked surface is trusted more than the camera's pivot point. */
export type SubjectSource = "surface" | "camera-target";

export interface SubjectReference {
  /** Ray length from the camera to the subject, in scene units. Always finite and above SUBJECT_MIN_DISTANCE. */
  distance: number;
  source: SubjectSource;
}

/** Below this the number is noise (the shader's own hit tolerance is of this order), so no reference is offered. */
export const SUBJECT_MIN_DISTANCE = 1e-6;
export const SUBJECT_MAX_DISTANCE = 1e6;

const length = (v: readonly number[]): number => Math.hypot(v[0]!, v[1]!, v[2]!);
const valid = (d: number): boolean => Number.isFinite(d) && d >= SUBJECT_MIN_DISTANCE && d <= SUBJECT_MAX_DISTANCE;

/** The distance from the camera to its pivot point (the same line the camera looks along). */
export function cameraTargetDistance(camera: Pick<SceneCamera, "position" | "target">): number {
  return length(camera.target.map((v, i) => v - camera.position[i]!));
}

/**
 * The reference distance for relative controls. A world point that was measured on a real surface (for example the
 * image centre, picked with the engine's own surface query) wins; otherwise the camera-to-pivot distance is used.
 * Returns null when neither is usable, and the panel then offers only the absolute controls.
 */
export function subjectReference(camera: Pick<SceneCamera, "position" | "target">, surfacePoint?: Vec3 | null): SubjectReference | null {
  if (surfacePoint && surfacePoint.every(Number.isFinite)) {
    const d = length(surfacePoint.map((v, i) => v - camera.position[i]!));
    if (valid(d)) return { distance: d, source: "surface" };
  }
  const d = cameraTargetDistance(camera);
  return valid(d) ? { distance: d, source: "camera-target" } : null;
}

/** Artist-facing fog values that mean the same thing at any scene scale. */
export interface RelativeFog {
  /** Where the fog begins, in subject distances (1 = at the subject). */
  start_multiple: number;
  /** Share of a surface's colour replaced by fog one subject distance beyond the start: 0 = none, 0.95 = almost all. */
  strength: number;
}

export const RELATIVE_FOG_LIMITS = { start_multiple: [0, 10], strength: [0, 0.95] } as const;

export const RELATIVE_FOG_PRESETS: readonly { id: string; label: string; value: RelativeFog }[] = [
  { id: "subtle", label: "Subtle", value: { start_multiple: 1, strength: 0.15 } },
  { id: "soft", label: "Soft", value: { start_multiple: 1, strength: 0.35 } },
  { id: "clear", label: "Clear", value: { start_multiple: 0.5, strength: 0.6 } },
];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface FogFromRelative {
  start: number;
  density: number;
  /** True when the scene schema's own limits (FOG_LIMITS) stopped the artist's value from being reached exactly. */
  limited: boolean;
}

/**
 * The absolute fog start and density that give the requested relative values at this subject distance.
 * Inverts fogAmount: at one subject distance beyond the start, amount = strength, so
 *   exponential:         density = -ln(1 - strength) / R
 *   exponential_squared: density = sqrt(-ln(1 - strength)) / R
 */
export function fogFromRelative(relative: RelativeFog, reference: number, mode: FogSettings["mode"]): FogFromRelative {
  if (!valid(reference)) throw new RangeError("subject distance is not usable");
  const multiple = clamp(Number.isFinite(relative.start_multiple) ? relative.start_multiple : 0, ...RELATIVE_FOG_LIMITS.start_multiple);
  const strength = clamp(Number.isFinite(relative.strength) ? relative.strength : 0, ...RELATIVE_FOG_LIMITS.strength);
  const wantedStart = multiple * reference;
  const k = -Math.log1p(-strength);
  const wantedDensity = (mode === "exponential_squared" ? Math.sqrt(k) : k) / reference;
  const start = clamp(wantedStart, FOG_LIMITS.start[0], FOG_LIMITS.start[1]);
  const density = clamp(wantedDensity, FOG_LIMITS.density[0], FOG_LIMITS.density[1]);
  return { start, density, limited: start !== wantedStart || density !== wantedDensity };
}

/** The relative reading of a scene's absolute fog. Always derived, never stored, so it cannot disagree with the scene. */
export function relativeFromFog(fog: FogSettings, reference: number): RelativeFog {
  if (!valid(reference)) throw new RangeError("subject distance is not usable");
  return {
    start_multiple: fog.start / reference,
    // Evaluate as if switched on, so the readout also works while the fog is off.
    strength: fogAmount({ ...fog, enabled: true }, fog.start + reference),
  };
}

/** How much fog already covers the subject itself, 0 to 1. The most direct answer to "is my subject washed out?". */
export function fogOnSubject(fog: FogSettings, reference: number): number {
  return fogAmount({ ...fog, enabled: true }, reference);
}
