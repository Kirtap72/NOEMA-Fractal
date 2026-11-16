import type { Vec3 } from "./camera";
import { LIGHT_LIMITS, defaultLight } from "./lights";
import type { LightSettings, LightType } from "./lights";
import type { Scene } from "./scene";

/**
 * Subject-relative spotlight strength (ARTIST-SCALE-03).
 *
 * The shader (shader.ts, lighting loop) weakens a point or spot light by `1 / max(dist * dist, 0.0001)` and then
 * multiplies by the light colour (linear) times `intensity`. So for a surface point at the distance `d` from the light,
 * facing the light, inside the cone, without shadow, the light that arrives is
 *
 *     illumination = intensity / max(d * d, 0.0001)
 *
 * We call that number "illumination at the target". It is NOT the final pixel brightness: the material colour, the angle of the
 * surface, other lights, ambient light, contact darkening, shadows, fog and exposure all come on top of it.
 * The distance is the straight distance from the light to the point (inverse-square law), not the distance along the
 * camera axis that depth of field uses.
 */

/** Same floor as the shader: closer than 0.01 the light stops getting stronger. */
export const FALLOFF_FLOOR = 0.0001;
export const MIN_LIGHT_DISTANCE = Math.sqrt(FALLOFF_FLOOR);
/** About as bright on the target as the old default sun (0.88) is on a surface facing it. */
export const DEFAULT_TARGET_ILLUMINATION = 0.8;
/** What the artist slider can reach. Other values stay reachable through "Strength". */
export const ILLUMINATION_LIMITS = { min: 0.02, max: 20 } as const;
export const ILLUMINATION_PRESETS = [
  { id: "dim", label: "Dim", value: 0.3 },
  { id: "normal", label: "Normal", value: DEFAULT_TARGET_ILLUMINATION },
  { id: "strong", label: "Strong", value: 1.6 },
  { id: "intense", label: "Very strong", value: 3.2 },
] as const;

/** The straight distance between two points. */
export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The factor the shader applies for a point or spot light at this distance. */
export function falloff(distance: number): number {
  return 1 / Math.max(distance * distance, FALLOFF_FLOOR);
}

/** Light arriving at a surface at `distance` that faces the light, for a light of this intensity. */
export function illuminationAt(intensity: number, distance: number): number {
  return intensity * falloff(distance);
}

export interface IntensityFit {
  ok: true;
  /** Full double precision. Never rounded: 0.00028 is a normal, useful value for a small subject. */
  intensity: number;
  /** What the light really gives at the target. Differs from the wanted level only when `limited`. */
  illumination: number;
  distance: number;
  /** The target is closer than 0.01: the shader's floor applies, so the intensity is computed with the floor too. */
  floorEngaged: boolean;
  /** The wanted level needed more than the schema allows; the intensity was held at the limit. */
  limited: "max" | null;
}
export interface FitRejection {
  ok: false;
  message: string;
}

/** The intensity that gives `illumination` at the target `distance` away. */
export function intensityForIllumination(distance: number, illumination: number): IntensityFit | FitRejection {
  if (!Number.isFinite(distance) || distance < 0) return { ok: false, message: "Invalid distance to the light target." };
  if (!Number.isFinite(illumination) || illumination <= 0) return { ok: false, message: "The wanted illumination must be a positive number." };
  const wanted = illumination / falloff(distance);
  const max = LIGHT_LIMITS.intensity[1];
  const limited = wanted > max ? "max" : null;
  const intensity = Math.min(max, wanted);
  if (!Number.isFinite(intensity) || intensity <= 0) return { ok: false, message: "The wanted illumination gives a light strength that cannot be stored." };
  return {
    ok: true,
    intensity,
    illumination: illuminationAt(intensity, distance),
    distance,
    floorEngaged: distance < MIN_LIGHT_DISTANCE,
    limited,
  };
}

/** Where a fitted spotlight was aimed, kept only while the app runs. Not stored in the scene file. */
export interface FitAnchor {
  lightId?: string;
  index: number;
  target: Vec3;
  /** The light's position and direction right after the fit. A later move or turn makes the anchor stale. */
  position: Vec3;
  direction: Vec3;
}

export interface SpotFit {
  ok: true;
  scene: Scene;
  fit: IntensityFit;
  previousIntensity: number;
  anchor: FitAnchor;
}

const same3 = (a: readonly number[], b: readonly number[]): boolean => a.length === 3 && b.length === 3 && a.every((v, i) => v === b[i]);

/**
 * Points the spotlight at a surface point and sets its intensity for the wanted illumination there. Changes only
 * `direction` and `intensity` of that one light; the id, colour, cone, shadows and every other light stay untouched.
 */
export function fitSpotToTarget(scene: Scene, index: number, target: Vec3, illumination: number): SpotFit | FitRejection {
  const light = scene.lights[index];
  if (light?.type !== "spot") return { ok: false, message: "The chosen light is not a spot light." };
  if (!target.every(Number.isFinite)) return { ok: false, message: "Invalid light target." };
  const direction = target.map((v, i) => v - light.position[i]!) as Vec3;
  const distance = Math.hypot(...direction);
  if (!direction.every(Number.isFinite) || distance <= 1e-15) return { ok: false, message: "The light is on the target. No direction can be computed." };
  const fit = intensityForIllumination(distance, illumination);
  if (!fit.ok) return fit;
  const next = { ...light, direction, intensity: fit.intensity };
  return {
    ok: true,
    scene: { ...scene, lights: scene.lights.map((l, i) => (i === index ? next : l)) },
    fit,
    previousIntensity: light.intensity,
    anchor: { ...(light.id ? { lightId: light.id } : {}), index, target: [...target], position: [...light.position], direction: [...direction] },
  };
}

/** The light an anchor still describes, or -1 if it was deleted, moved, turned, or is no longer a spotlight. */
export function resolveAnchor(scene: Scene, anchor: FitAnchor | undefined | null): number {
  if (!anchor) return -1;
  const index = anchor.lightId ? scene.lights.findIndex((l) => l.id === anchor.lightId) : anchor.index;
  const light = scene.lights[index];
  if (!light || light.type !== "spot") return -1;
  return same3(light.position, anchor.position) && same3(light.direction, anchor.direction) ? index : -1;
}

/** Straight distance from the light to the anchored target, and the illumination there with the current intensity. */
export function anchorReading(scene: Scene, anchor: FitAnchor | undefined | null): { index: number; distance: number; illumination: number; intensity: number } | null {
  const index = resolveAnchor(scene, anchor);
  if (index < 0 || !anchor) return null;
  const light = scene.lights[index]!;
  const distance = distanceBetween(light.position, anchor.target);
  return { index, distance, illumination: illuminationAt(light.intensity, distance), intensity: light.intensity };
}

/** Changes only the intensity of the anchored light so that the target gets `illumination`. */
export function setAnchoredIllumination(scene: Scene, anchor: FitAnchor | undefined | null, illumination: number): { ok: true; scene: Scene; fit: IntensityFit } | FitRejection {
  const index = resolveAnchor(scene, anchor);
  if (index < 0 || !anchor) return { ok: false, message: "The light has been moved, turned or removed since the target was chosen. Choose a new target." };
  const light = scene.lights[index]!;
  const fit = intensityForIllumination(distanceBetween(light.position, anchor.target), illumination);
  if (!fit.ok) return fit;
  return { ok: true, scene: { ...scene, lights: scene.lights.map((l, i) => (i === index ? { ...l, intensity: fit.intensity } : l)) }, fit };
}

/** Log slider: position 0..1 to illumination between the limits. Equal steps feel like equal changes in brightness. */
export function illuminationFromSlider(position: number): number {
  const t = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0));
  return ILLUMINATION_LIMITS.min * Math.pow(ILLUMINATION_LIMITS.max / ILLUMINATION_LIMITS.min, t);
}
export function sliderFromIllumination(illumination: number): number {
  if (!Number.isFinite(illumination) || illumination <= 0) return 0;
  const t = Math.log(illumination / ILLUMINATION_LIMITS.min) / Math.log(ILLUMINATION_LIMITS.max / ILLUMINATION_LIMITS.min);
  return Math.min(1, Math.max(0, t));
}

/** Three significant digits, never rounded to zero: 0.002 stays 0.002 and 0.00028 stays 0.00028. */
export function formatLightValue(value: number): string {
  if (!Number.isFinite(value)) return "–";
  if (value === 0) return "0";
  return String(Number(value.toPrecision(3)));
}

/**
 * A new light for the "+ Spot" / "+ Punkt" buttons. A point or spot light starts at the camera and looks at the camera's
 * target (the point the view turns around), with the intensity that gives the target a normal level of light.
 * Before this the strength came from the distance to the world origin, which is wrong for any subject that is not at the
 * origin and was a thousand times too strong for a small subject. Only new lights are affected; saved scenes are not read.
 */
export function newSubjectLight(camera: Scene["camera"], type: LightType): LightSettings {
  const base = { ...defaultLight(), type };
  if (type === "directional") return { ...base, intensity: 0.5, direction: [0.5, -1, -0.3] };
  const position: Vec3 = [camera.position[0], camera.position[1], camera.position[2]];
  const toTarget = camera.target.map((v, i) => v - position[i]!) as Vec3;
  const distance = Math.hypot(...toTarget);
  const usable = toTarget.every(Number.isFinite) && distance > 1e-9;
  // A camera sitting exactly on its target has no direction to look in: fall back to the old rule (look at the origin).
  const direction: Vec3 = usable ? toTarget : [-position[0], -position[1], -position[2]];
  const reach = usable ? distance : Math.hypot(...position) || 1;
  const fit = intensityForIllumination(reach, DEFAULT_TARGET_ILLUMINATION);
  const intensity = fit.ok ? fit.intensity : base.intensity;
  return { ...base, position, direction, intensity, cone_degrees: 30 };
}
