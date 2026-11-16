import type { SceneCamera, Vec3 } from "./camera";
import { blendFog } from "./fog";
import { blendAmbient, blendLights, cloneLights } from "./lights";
import type { AmbientSettings, LightSettings } from "./lights";
import type { FogSettings } from "./fog";
import { gradientAt, MAX_GRADIENT_STOPS } from "./gradient";
import type { ColorSettings, Gradient } from "./gradient";
import { MAX_KEYFRAMES } from "./animation";
import type { Animation, AnimationKeyframe } from "./animation";
import type { Scene } from "./scene";

/**
 * Everything that turns keyframes into a picture at a given time.
 * All pure functions: no graphics card needed (except where a distance
 * function is passed in), so everything here can be tested.
 */

// ---- smooth curves

/** Catmull-Rom spline through p1 and p2 (u from 0 to 1). It also bends smoothly through the neighbours p0 and p3. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** Like catmullRom, but never leaves the range between p1 and p2. Used for parameters, which must stay inside their limits. */
export function catmullRomClamped(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const v = catmullRom(p0, p1, p2, p3, u);
  return Math.min(Math.max(p1, p2), Math.max(Math.min(p1, p2), v));
}

/** The four keyframes around segment i (the stretch between keyframe i and i+1). The ends repeat themselves. */
function around<T>(items: readonly T[], i: number): [T, T, T, T] {
  const at = (k: number): T => items[Math.min(items.length - 1, Math.max(0, k))]!;
  return [at(i - 1), at(i), at(i + 1), at(i + 2)];
}

function splineVec3(points: readonly Vec3[], i: number, u: number): Vec3 {
  const [a, b, c, d] = around(points, i);
  return [0, 1, 2].map((k) => catmullRom(a[k]!, b[k]!, c[k]!, d[k]!, u)) as Vec3;
}

/** Where the camera is at fraction u of segment i, on the smooth path through all keyframe positions. */
export function cameraPositionAt(keyframes: readonly AnimationKeyframe[], i: number, u: number): Vec3 {
  return splineVec3(keyframes.map((k) => k.camera.position), i, u);
}

// ---- timing: how fast the camera moves along each segment

/** Number of steps each segment is divided into when measuring. */
export const TIMING_SAMPLES = 48;
export const ADAPTIVE_MIN_DISTANCE = 0.02;
export const ADAPTIVE_MAX_DISTANCE = 2;

/**
 * For each segment, a table that turns the fraction of time spent into the fraction of the
 * path travelled. Null means "no change" (smooth, same as the plain curve).
 */
export interface Timing {
  segments: (Float32Array | null)[];
}

/** The points at which the distance to the surface is measured for segment i. */
export function segmentSamplePoints(keyframes: readonly AnimationKeyframe[], i: number): Vec3[] {
  return Array.from({ length: TIMING_SAMPLES + 1 }, (_, k) => cameraPositionAt(keyframes, i, k / TIMING_SAMPLES));
}

/**
 * Builds the table for one segment from sample points and (for adaptive speed) the distance to the
 * surface at each of them. Speed is proportional to the distance, so time spent on a stretch is
 * proportional to length / distance. The whole segment still takes exactly the same time.
 */
export function timingTable(points: readonly Vec3[], distances: readonly number[] | null): Float32Array | null {
  const n = points.length - 1;
  const cumulative = new Float64Array(n + 1);
  let pathLength = 0;
  for (let k = 0; k < n; k++) {
    const a = points[k]!;
    const b = points[k + 1]!;
    const step = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    pathLength += step;
    let weight = step;
    if (distances) {
      const d = (Math.abs(distances[k]!) + Math.abs(distances[k + 1]!)) / 2;
      weight = step / Math.min(ADAPTIVE_MAX_DISTANCE, Math.max(ADAPTIVE_MIN_DISTANCE, Number.isFinite(d) ? d : ADAPTIVE_MAX_DISTANCE));
    }
    cumulative[k + 1] = cumulative[k]! + Math.max(weight, 1e-12);
  }
  if (pathLength < 1e-9) return null; // the camera does not move: nothing to adjust
  const total = cumulative[n]!;
  const table = new Float32Array(n + 1);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const target = (j / n) * total;
    while (k < n - 1 && cumulative[k + 1]! < target) k++;
    const span = cumulative[k + 1]! - cumulative[k]!;
    const f = span > 0 ? (target - cumulative[k]!) / span : 0;
    table[j] = (k + Math.min(1, Math.max(0, f))) / n;
  }
  table[0] = 0;
  table[n] = 1;
  return table;
}

/** Path fraction for a given fraction of the segment's time. */
export function warpFraction(table: Float32Array | null, tau: number): number {
  const t = Math.min(1, Math.max(0, tau));
  if (!table) return t;
  const x = t * (table.length - 1);
  const j = Math.min(table.length - 2, Math.floor(x));
  return table[j]! + (table[j + 1]! - table[j]!) * (x - j);
}

/** A way to ask for the distance to the surface at many points (the engine provides it). */
export type DistanceFn = (scene: Scene, points: Vec3[]) => Promise<ArrayLike<number>>;

/** A key that changes whenever the timing has to be calculated again. Parameter values of the working scene are not part of it. */
export function timingKey(scene: Scene): string {
  const fractal = scene.content[0];
  const chain = fractal ? [fractal.chain.map((s) => [s.formula, s.iterations]), fractal.rounds, ...(fractal.execution ? [fractal.execution] : [])] : null;
  return JSON.stringify([scene.animation, chain]);
}

/** Measures and builds the timing of the whole animation. Uniform speed needs no measuring. */
export async function computeTiming(scene: Scene, distanceAt: DistanceFn): Promise<Timing> {
  const { keyframes, speed_mode } = scene.animation;
  const segments: (Float32Array | null)[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const points = segmentSamplePoints(keyframes, i);
    let distances: ArrayLike<number> | null = null;
    if (speed_mode === "adaptive") {
      // Measure in the shape as it looks halfway through the segment.
      const middle = (keyframes[i]!.time_seconds + keyframes[i + 1]!.time_seconds) / 2;
      distances = await distanceAt(evaluateAnimation(scene, middle, null), points);
    }
    segments.push(timingTable(points, distances ? Array.from(distances) : null));
  }
  return { segments };
}

// ---- keyframes at a time

/** Where we are in the animation: which segment, how far through it in time, and how far along the path. */
function locate(keyframes: readonly AnimationKeyframe[], t: number, timing: Timing | null | undefined): { i: number; tau: number; u: number } {
  const last = keyframes.length - 2;
  if (t <= keyframes[0]!.time_seconds) return { i: 0, tau: 0, u: 0 };
  if (t >= keyframes[keyframes.length - 1]!.time_seconds) return { i: last, tau: 1, u: 1 };
  let i = 0;
  while (i < last && keyframes[i + 1]!.time_seconds <= t) i++;
  const a = keyframes[i]!.time_seconds;
  const b = keyframes[i + 1]!.time_seconds;
  const tau = (t - a) / (b - a);
  const table = timing && timing.segments.length === keyframes.length - 1 ? timing.segments[i] ?? null : null;
  return { i, tau, u: warpFraction(table, tau) };
}

function blendGradients(a: Gradient, b: Gradient, f: number): Gradient {
  const toHex = (rgb: [number, number, number]): string =>
    "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");
  const count = Math.min(MAX_GRADIENT_STOPS, Math.max(16, a.stops.length, b.stops.length));
  const stops = Array.from({ length: count }, (_, k) => {
    const x = k / (count - 1);
    const ca = gradientAt(a.stops, x);
    const cb = gradientAt(b.stops, x);
    return { position: x, color: toHex([ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]) };
  });
  return { stops };
}

/** Colour settings between two keyframes. Numbers and gradients blend; measure and edge mode switch halfway. */
function blendColor(kfs: readonly AnimationKeyframe[], i: number, tau: number): ColorSettings {
  const [c0, c1, c2, c3] = around(kfs.map((k) => k.color), i);
  const same = JSON.stringify(c1.gradient.stops) === JSON.stringify(c2.gradient.stops);
  const gradient: Gradient = same
    ? c1.gradient
    : tau <= 0
      ? c1.gradient
      : tau >= 1
        ? c2.gradient
        : blendGradients(c1.gradient, c2.gradient, tau);
  const to = tau >= 0.5 ? c2 : c1;
  // The picture switches halfway, unless both keyframes use the same one: then its strength and scale blend.
  const t1 = c1.texture;
  const t2 = c2.texture;
  const texture =
    t1 && t2 && t1.data === t2.data
      ? { ...to.texture!, scale: lerp(t1.scale, t2.scale, tau), strength: lerp(t1.strength, t2.strength, tau) }
      : to.texture;
  return {
    gradient,
    measure: to.measure,
    wrap: to.wrap,
    cycles: catmullRomClamped(c0.cycles, c1.cycles, c2.cycles, c3.cycles, tau),
    offset: catmullRomClamped(c0.offset, c1.offset, c2.offset, c3.offset, tau),
    ...(texture ? { texture } : {}),
  };
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/**
 * The scene as it looks at time t seconds: camera, parameter values and colour taken from the keyframes.
 * Everything else (the chain, iterations) stays as in `scene`. Without keyframes the scene is returned unchanged.
 */
export function evaluateAnimation(scene: Scene, t: number, timing?: Timing | null): Scene {
  const kfs = scene.animation.keyframes;
  if (kfs.length === 0) return scene;
  const fractal = scene.content[0];
  if (!fractal) return scene;

  let camera: SceneCamera;
  let steps: Record<string, number>[];
  let weights: (number | undefined)[];
  let juliaC: Vec3 | undefined;
  let color: ColorSettings;
  let fog: FogSettings;
  let lights: LightSettings[];
  let ambient: AmbientSettings;

  if (kfs.length === 1) {
    const k = kfs[0]!;
    camera = { ...k.camera, position: [...k.camera.position], target: [...k.camera.target], up: [...k.camera.up] };
    steps = k.steps.map((s) => ({ ...s.parameters }));
    weights = fractal.chain.map((base, j) => k.steps[j]?.weight ?? base.weight);
    juliaC = k.julia_c ?? fractal.julia?.c;
    color = k.color;
    fog = k.fog ?? scene.fog;
    lights = k.lights ?? scene.lights;
    ambient = k.ambient ?? scene.ambient;
  } else {
    const { i, tau, u } = locate(kfs, t, timing);
    const position = cameraPositionAt(kfs, i, u);
    const target = splineVec3(kfs.map((k) => k.camera.target), i, u);
    const [, a, b] = around(kfs, i);
    const up: Vec3 = [0, 1, 2].map((k) => lerp(a.camera.up[k]!, b.camera.up[k]!, u)) as Vec3;
    camera = { ...(u<0.5?a.camera:b.camera), position, target, up, fov_degrees: lerp(a.camera.fov_degrees, b.camera.fov_degrees, u) };
    if(a.camera.lens&&b.camera.lens)camera.lens={focal_length_mm:lerp(a.camera.lens.focal_length_mm,b.camera.lens.focal_length_mm,u),sensor_width_mm:lerp(a.camera.lens.sensor_width_mm,b.camera.lens.sensor_width_mm,u)};
    if(a.camera.dof&&b.camera.dof)camera.dof={...(u<0.5?a.camera.dof:b.camera.dof),focus_distance:lerp(a.camera.dof.focus_distance,b.camera.dof.focus_distance,u),aperture_radius:lerp(a.camera.dof.aperture_radius,b.camera.dof.aperture_radius,u)};
    if(a.camera.ortho_height!==undefined&&b.camera.ortho_height!==undefined)camera.ortho_height=lerp(a.camera.ortho_height,b.camera.ortho_height,u);

    steps = fractal.chain.map((base, j) => {
      const names = new Set<string>();
      for (const k of [kfs[i]!, kfs[i + 1]!]) for (const n of Object.keys(k.steps[j]?.parameters ?? {})) names.add(n);
      const out: Record<string, number> = { ...base.parameters };
      for (const name of names) {
        const [k0, k1, k2, k3] = around(kfs, i);
        const v = (k: AnimationKeyframe): number => k.steps[j]?.parameters[name] ?? base.parameters[name] ?? 0;
        out[name] = catmullRomClamped(v(k0), v(k1), v(k2), v(k3), tau);
      }
      return out;
    });
    // Weights and the Julia constant blend like parameters (smooth, without overshooting the keyframe values).
    weights = fractal.chain.map((base, j) => {
      const [k0, k1, k2, k3] = around(kfs, i);
      if ([k1, k2].every((k) => k.steps[j]?.weight === undefined)) return base.weight;
      const v = (k: AnimationKeyframe): number => k.steps[j]?.weight ?? base.weight ?? 1;
      return Math.max(0, catmullRomClamped(v(k0), v(k1), v(k2), v(k3), tau));
    });
    {
      const [k0, k1, k2, k3] = around(kfs, i);
      const own = fractal.julia?.c;
      if (k1.julia_c || k2.julia_c) {
        const v = (k: AnimationKeyframe, n: number): number => (k.julia_c ?? own ?? [0, 0, 0])[n]!;
        juliaC = [0, 1, 2].map((n) => catmullRomClamped(v(k0, n), v(k1, n), v(k2, n), v(k3, n), tau)) as Vec3;
      } else juliaC = own;
    }
    color = blendColor(kfs, i, tau);
    const [, f1, f2] = around(kfs, i);
    fog = f1.fog || f2.fog ? blendFog(f1.fog ?? scene.fog, f2.fog ?? scene.fog, tau) : scene.fog;
    lights = f1.lights || f2.lights ? blendLights(f1.lights ?? scene.lights, f2.lights ?? scene.lights, tau) : scene.lights;
    ambient = f1.ambient || f2.ambient ? blendAmbient(f1.ambient ?? scene.ambient, f2.ambient ?? scene.ambient, tau) : scene.ambient;
  }

  return {
    ...scene,
    camera,
    color,
    fog,
    lights,
    ambient,
    content: [
      {
        ...fractal,
        chain: fractal.chain.map((s, j) => {
          const w = weights[j];
          return { ...s, parameters: steps[j] ?? s.parameters, ...(w !== undefined ? { weight: w } : {}) };
        }),
        ...(fractal.julia && juliaC ? { julia: { ...fractal.julia, c: [...juliaC] as Vec3 } } : {}),
      },
      ...scene.content.slice(1),
    ],
  };
}

// ---- editing keyframes

/** A keyframe made from the scene as it looks now. */
export function captureKeyframe(scene: Scene, time: number): AnimationKeyframe {
  const fractal = scene.content[0];
  return {
    time_seconds: Math.round(time * 1000) / 1000,
    camera: { ...scene.camera, position: [...scene.camera.position], target: [...scene.camera.target], up: [...scene.camera.up], ...(scene.camera.lens?{lens:{...scene.camera.lens}}:{}), ...(scene.camera.dof?{dof:{...scene.camera.dof}}:{}) },
    // In interpolate mode the weight is always kept (also 1, which the scene leaves out), so a keyframe at weight 1 stays 1.
    steps: (fractal?.chain ?? []).map((s) => ({ parameters: { ...s.parameters }, ...(fractal?.mode === "interpolate" || s.weight !== undefined ? { weight: s.weight ?? 1 } : {}) })),
    ...(fractal?.julia ? { julia_c: [...fractal.julia.c] as Vec3 } : {}),
    color: structuredClone(scene.color),
    fog: { ...scene.fog },
    lights: cloneLights(scene.lights),
    ambient: { ...scene.ambient },
  };
}

const SAME_TIME = 0.005;

/** Puts a keyframe at its time, replacing one that is already there. Keyframes stay in order. At most MAX_KEYFRAMES. */
export function setKeyframe(scene: Scene, keyframe: AnimationKeyframe): Scene {
  const list = scene.animation.keyframes.filter((k) => Math.abs(k.time_seconds - keyframe.time_seconds) >= SAME_TIME);
  const replaced = list.length !== scene.animation.keyframes.length;
  if (!replaced && list.length >= MAX_KEYFRAMES) return scene;
  list.push(keyframe);
  list.sort((a, b) => a.time_seconds - b.time_seconds);
  const duration = Math.max(scene.animation.duration_seconds, keyframe.time_seconds);
  return { ...scene, animation: { ...scene.animation, duration_seconds: duration, keyframes: list } };
}

export function removeKeyframe(scene: Scene, index: number): Scene {
  if (!scene.animation.keyframes[index]) return scene;
  return { ...scene, animation: { ...scene.animation, keyframes: scene.animation.keyframes.filter((_, i) => i !== index) } };
}

/** Changes duration, frame rate or speed mode. Duration cannot end before the last keyframe. */
export function withAnimationSettings(scene: Scene, changes: Partial<Pick<Animation, "duration_seconds" | "fps" | "speed_mode">>): Scene {
  const a = scene.animation;
  const last = a.keyframes[a.keyframes.length - 1]?.time_seconds ?? 0;
  const duration = Math.max(changes.duration_seconds ?? a.duration_seconds, last, 0.1);
  const fps = Math.min(120, Math.max(1, Math.round(changes.fps ?? a.fps)));
  return { ...scene, animation: { ...a, ...changes, duration_seconds: duration, fps } };
}

/** The length of the camera path between each pair of keyframes. */
export function segmentLengths(keyframes: readonly AnimationKeyframe[]): number[] {
  return Array.from({ length: Math.max(0, keyframes.length - 1) }, (_, i) => {
    const pts = segmentSamplePoints(keyframes, i);
    let sum = 0;
    for (let k = 0; k < pts.length - 1; k++) sum += Math.hypot(pts[k + 1]![0] - pts[k]![0], pts[k + 1]![1] - pts[k]![1], pts[k + 1]![2] - pts[k]![2]);
    return sum;
  });
}

/** Sets the keyframe times so the camera travels at a fixed speed (units per second). The first keyframe keeps its time. */
export function retimeForFixedSpeed(scene: Scene, speed: number): Scene {
  const a = scene.animation;
  if (a.keyframes.length < 2 || !(speed > 0)) return scene;
  const lengths = segmentLengths(a.keyframes);
  let time = a.keyframes[0]!.time_seconds;
  const keyframes = a.keyframes.map((k, i) => {
    if (i > 0) time += Math.max(0.05, lengths[i - 1]! / speed);
    return { ...k, time_seconds: Math.round(time * 1000) / 1000 };
  });
  const duration = Math.max(0.1, keyframes[keyframes.length - 1]!.time_seconds);
  return { ...scene, animation: { ...a, duration_seconds: Math.min(duration, 3600), keyframes } };
}

// ---- frames to render

/** Number of frames of a whole animation: one at every 1/fps seconds, including both the first and the last moment. */
export function frameCount(animation: Pick<Animation, "duration_seconds" | "fps">): number {
  return Math.round(animation.duration_seconds * animation.fps) + 1;
}

/** The times to render. `step` 3 renders every third frame (the last one is always included). */
export function frameTimes(animation: Pick<Animation, "duration_seconds" | "fps">, step = 1): number[] {
  const n = frameCount(animation);
  const s = Math.max(1, Math.round(step));
  const times: number[] = [];
  for (let i = 0; i < n; i += s) times.push(i / animation.fps);
  if ((n - 1) % s !== 0) times.push((n - 1) / animation.fps);
  return times;
}
