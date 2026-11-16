import type { SceneCamera } from "./camera";
import { cameraBasis } from "./camera";
import { cameraFov, defaultDof } from "./cameraOptics";
import type { DepthOfField } from "./cameraOptics";
import { verticalFovDegrees } from "./renderSetup";
import type { FovAxis } from "./renderSetup";
import type { Scene } from "./scene";
import { SUBJECT_MAX_DISTANCE, SUBJECT_MIN_DISTANCE } from "./subjectScale";

/**
 * Focus and depth of field in terms an artist can reason about (ARTIST-SCALE-02).
 *
 * Optical meaning, taken from the actual renderer (`shader.ts` lens branch, `cameraOptics.cameraRay`, `previewDof`):
 * the focus plane is perpendicular to the view direction, and `focus_distance` is measured ALONG the optical axis,
 * not along the ray. A surface 30 degrees off axis at ray length 1 is at focus distance cos(30 deg), not 1.
 *
 * Nothing here is stored in the scene. The relative depth-of-field value is always derived from the saved
 * `aperture_radius`, `focus_distance` and field of view, so an untouched scene renders exactly as before.
 */

/** The scene schema's own limits (camera.ts `readSceneCamera`). */
export const DOF_LIMITS = { focus: [1e-9, 1e6] as const, aperture: [0, 1000] as const };

/** Distance along the optical axis from the camera to a point. Negative means behind the camera. */
export function axialDistance(camera: Pick<SceneCamera, "position" | "target" | "up">, point: readonly number[]): number {
  const forward = cameraBasis(camera as SceneCamera).forward;
  return forward.reduce((sum, f, i) => sum + f * (point[i]! - camera.position[i]!), 0);
}

export type FocusRejection = "orthographic" | "invalid-point" | "behind-camera" | "out-of-range";
export type FocusResult =
  | { ok: true; scene: Scene; distance: number; rayLength: number; offAxisDegrees: number }
  | { ok: false; reason: FocusRejection; message: string };

/**
 * Focus on a picked world-space surface point. Only `camera.dof` changes: position, target, up, FOV, lens,
 * projection and film are kept by reference. Depth of field itself is not switched on and the aperture is not touched;
 * a scene that had no `dof` block gets the existing defaults (disabled) plus the new focus.
 */
export function focusAtPoint(scene: Scene, point: readonly number[]): FocusResult {
  const camera = scene.camera;
  if (camera.projection === "orthographic")
    return { ok: false, reason: "orthographic", message: "Focus only applies to perspective cameras. DOF is not supported with an orthographic camera. No change." };
  if (point.length !== 3 || !point.every(Number.isFinite))
    return { ok: false, reason: "invalid-point", message: "Invalid focus point. No change." };
  const distance = axialDistance(camera, point);
  if (!(distance > 0))
    return { ok: false, reason: "behind-camera", message: "The point is behind the camera. No change." };
  if (!(distance >= SUBJECT_MIN_DISTANCE && distance <= SUBJECT_MAX_DISTANCE) || distance < DOF_LIMITS.focus[0] || distance > DOF_LIMITS.focus[1])
    return { ok: false, reason: "out-of-range", message: "The focus distance is unreasonably small or large. No change." };
  const rayLength = Math.hypot(...point.map((v, i) => v - camera.position[i]!));
  const dof: DepthOfField = { ...(camera.dof ?? defaultDof()), focus_mode: "manual", focus_distance: distance };
  return {
    ok: true,
    scene: { ...scene, camera: { ...camera, dof } },
    distance,
    rayLength,
    offAxisDegrees: (Math.acos(Math.min(1, distance / rayLength)) * 180) / Math.PI,
  };
}

/** True when depth of field is actually sampled. Mirrors engine.ts (`hasDof`) and previewDof: perspective only. */
export function dofSampled(camera: SceneCamera): boolean {
  return !!camera.dof?.enabled && camera.projection !== "orthographic";
}

/** Final and Still LookDev average at least this many lens samples when DOF is on (engine.ts `dofSamples ?? 16`, lookDev.ts). */
export const DOF_SAMPLE_FLOOR = 16;

/** Camera samples per pixel that will really be used: never fewer than the floor while DOF is sampled. */
export function effectiveCameraSamples(samplesPerPixel: number, camera: SceneCamera): number {
  const saved = Math.max(1, Math.floor(samplesPerPixel));
  return dofSampled(camera) ? Math.max(saved, DOF_SAMPLE_FLOOR) : saved;
}

// ---- relative depth of field ----------------------------------------------------------------------------------

/** What the renderer is given: the film the field of view is measured on. */
export interface Film { width: number; height: number }

export interface DofGeometry {
  /** Focus distance along the optical axis. */
  focus: number;
  /** Height of the visible frame at the focus plane, in scene units. */
  frameHeight: number;
}

/** Validated focus distance and frame height. Throws RangeError so an unusable input can never become extreme blur. */
export function dofGeometry(camera: SceneCamera, axis: FovAxis, film: Film): DofGeometry {
  if (camera.projection === "orthographic") throw new RangeError("Depth of field is not supported by an orthographic camera.");
  if (!(film.width > 0) || !(film.height > 0) || !Number.isFinite(film.width) || !Number.isFinite(film.height))
    throw new RangeError("The film size must be positive.");
  const dof = camera.dof ?? defaultDof();
  const focus = dof.focus_mode === "manual" ? dof.focus_distance : Math.hypot(...camera.target.map((v, i) => v - camera.position[i]!));
  if (!Number.isFinite(focus) || focus < SUBJECT_MIN_DISTANCE || focus > SUBJECT_MAX_DISTANCE)
    throw new RangeError("The focus distance is not usable: " + focus);
  const fov = verticalFovDegrees(cameraFov(camera, axis, film.width, film.height), axis, film.width, film.height);
  const tan = Math.tan((fov * Math.PI) / 360);
  if (!Number.isFinite(tan) || !(tan > 0)) throw new RangeError("The field of view is not usable: " + fov);
  return { focus, frameHeight: 2 * tan * focus };
}

/**
 * The relative aperture b = aperture_radius / frameHeight(at focus).
 *
 * Meaning: with the thin-lens model the renderer uses (blur radius in pixels = aperture * focalPixels * |1/z - 1/focus|),
 * b * filmHeight is the blur radius, in pixels, of anything infinitely far behind the focus plane. So b is the blur of the
 * far background as a FRACTION OF THE IMAGE HEIGHT. It does not change with the render resolution, nor when the
 * scene and the camera are scaled together, and it keeps that meaning when the field of view or the focus distance
 * change. It is NOT a physical f-number: two lenses with different focal lengths and the same b give the same background
 * blur relative to the frame, which is not the same bokeh a real lens pair would give.
 */
export function relativeAperture(camera: SceneCamera, axis: FovAxis, film: Film): number {
  const { frameHeight } = dofGeometry(camera, axis, film);
  const aperture = (camera.dof ?? defaultDof()).aperture_radius;
  if (!Number.isFinite(aperture) || aperture < 0) throw new RangeError("The aperture is not usable: " + aperture);
  return aperture / frameHeight;
}

/** Largest relative aperture the artist control offers: 5 % of the image height of blur for the far background. */
export const RELATIVE_DOF_MAX = 0.05;

export interface ApertureFromRelative { aperture_radius: number; limited: boolean }

/** Relative aperture to the scene's `aperture_radius`, clamped to the schema range. `limited` says it was clamped. */
export function apertureFromRelative(relative: number, camera: SceneCamera, axis: FovAxis, film: Film): ApertureFromRelative {
  if (!Number.isFinite(relative) || relative < 0) throw new RangeError("The relative aperture must be zero or positive.");
  const { frameHeight } = dofGeometry(camera, axis, film);
  const wanted = relative * frameHeight;
  const aperture = Math.min(DOF_LIMITS.aperture[1], Math.max(DOF_LIMITS.aperture[0], wanted));
  return { aperture_radius: aperture, limited: aperture !== wanted };
}

/** Changes only `camera.dof.aperture_radius`. Focus mode, focus distance and the on/off switch are left alone. */
export function withRelativeAperture(scene: Scene, relative: number, film: Film): { scene: Scene; limited: boolean } {
  const { aperture_radius, limited } = apertureFromRelative(relative, scene.camera, scene.render.fov_axis, film);
  const dof: DepthOfField = { ...(scene.camera.dof ?? defaultDof()), aperture_radius };
  return { scene: { ...scene, camera: { ...scene.camera, dof } }, limited };
}

/** Starting points, expressed as the blur of the far background in percent of the image height. */
export const RELATIVE_DOF_PRESETS = [
  { id: "deep", label: "Deep", value: 0.001 },
  { id: "medium", label: "Moderate", value: 0.004 },
  { id: "shallow", label: "Shallow", value: 0.012 },
  { id: "very-shallow", label: "Very shallow", value: 0.03 },
] as const;

/** Slider position 0..1 to relative aperture. Quadratic: fine steps where the blur is subtle, and exactly 0 at the left end. */
export function relativeFromSlider(position: number): number {
  const t = Math.min(1, Math.max(0, position));
  return RELATIVE_DOF_MAX * t * t;
}
export function sliderFromRelative(relative: number): number {
  return Math.sqrt(Math.min(RELATIVE_DOF_MAX, Math.max(0, relative)) / RELATIVE_DOF_MAX);
}

/** Blur radius, in pixels of a film of this height, of the far background. */
export function backgroundBlurPixels(relative: number, filmHeight: number): number {
  return relative * filmHeight;
}

/**
 * The depth range that stays within `tolerancePx` pixels of blur, along the optical axis. Blur radius at depth z is
 * B * |focus / z - 1| with B = relative * filmHeight, so the range is focus / (1 + c/B) .. focus / (1 - c/B),
 * unbounded behind the focus when B <= c.
 */
export function sharpRange(relative: number, focus: number, filmHeight: number, tolerancePx = 1): { near: number; far: number } {
  if (!(focus > 0) || !(filmHeight > 0) || !(tolerancePx > 0) || !(relative >= 0)) throw new RangeError("Unusable depth-of-field range input.");
  const blur = relative * filmHeight;
  if (blur <= 0) return { near: 0, far: Infinity };
  const ratio = tolerancePx / blur;
  return { near: focus / (1 + ratio), far: ratio < 1 ? focus / (1 - ratio) : Infinity };
}
