/**
 * VISUAL-RELIABILITY-01: an independent CPU sphere tracer that follows the shader's primary march (shader.ts, the `fs` loop) and the engine's CPU
 * distance evaluator. It exists for two jobs: telling WHY a picture is empty (nothing there, camera inside, too coarse a march, a distance estimate
 * that overshoots) and finding where geometry is, for framing. Pure functions, no DOM; a small, bounded amount of work per call.
 *
 * The march rule is the shader's: start at t = 0, evaluate d, hit when d < hitPrecision * (1 + t), otherwise t += d * stepFactor, stop after
 * maxSteps steps or when t passes maxDistance. The fixed-precision hit rule is used (the default mode of the application).
 */
import { compileChainCpu } from '../formula/cpu';
import type { Formula } from '../formula/types';
import { resolveScene, toChainSteps } from '../scene';
import type { Scene } from '../scene';
import { cameraBasis } from '../camera';
import type { SceneCamera, Vec3 } from '../camera';
import { defaultQuality, outputSize } from '../renderSetup';

export type DistanceFn = (p: readonly number[], threshold?: number) => number;

/** The scene's "pixel" precision mode: the hit threshold follows the pixel footprint at distance t (hitPixels * t * 2 * tan(fov/2) / height), like the shader. */
export interface PixelPrecision { hitPixels: number; tanHalf: number; height: number }
export interface MarchSettings { hitPrecision: number; stepFactor: number; maxSteps: number; maxDistance: number; pixel?: PixelPrecision }
export type RayStatus = 'hit' | 'miss' | 'exhausted' | 'inside' | 'invalid';
export interface RayResult { status: RayStatus; t: number; steps: number; /** The smallest distance estimate seen along the ray. */ minDistance: number }

/** The scene's own march settings (defaults where the scene leaves them out), as the shader receives them. */
export function sceneMarchSettings(scene: Scene, stepFactorOfChain = 1): MarchSettings {
  const q = { ...defaultQuality(), ...(scene.render?.quality ?? {}) };
  const pixel = q.precision_mode === 'pixel' ? { hitPixels: q.hit_pixels, tanHalf: Math.tan((scene.camera.fov_degrees * Math.PI) / 360), height: outputSize(scene.render).height } : undefined;
  return { hitPrecision: q.hit_precision, stepFactor: q.step_factor * stepFactorOfChain, maxSteps: q.max_steps, maxDistance: q.max_distance, ...(pixel ? { pixel } : {}) };
}

/** The chain's distance function on the processor, or the reason it cannot be built. */
export function sceneDistance(scene: Scene, library: readonly Formula[]): { ok: true; distance: DistanceFn; settings: MarchSettings } | { ok: false; errors: string[] } {
  const r = resolveScene(scene, library as Formula[]);
  if (!r.ok) return { ok: false, errors: r.errors };
  try {
    const f = compileChainCpu(toChainSteps(r), r.rounds, { mode: r.mode, execution: r.execution, fieldMaps: scene.formulaFields });
    const julia = r.julia[3] > 0.5 ? [r.julia[0], r.julia[1], r.julia[2]] : null;
    const distance: DistanceFn = (p, threshold = 0) => f(p, r.parameterValues, r.chainWeights, julia, threshold).dist;
    return { ok: true, distance, settings: sceneMarchSettings(scene, r.stepFactor) };
  } catch (e) { return { ok: false, errors: [String((e as Error).message ?? e)] }; }
}

export function marchRay(distance: DistanceFn, origin: Vec3, dir: Vec3, s: MarchSettings): RayResult {
  let t = 0, minD = Infinity;
  for (let i = 0; i < s.maxSteps; i++) {
    if (t > s.maxDistance) return { status: 'miss', t, steps: i, minDistance: minD };
    const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    // the shader's rules: fixed = hitPrecision * (1 + t); pixel = the pixel footprint, but never finer than 32-bit numbers can tell apart (precisionFloor)
    const threshold = s.pixel ? Math.max(s.pixel.hitPixels * (t * 2 * s.pixel.tanHalf) / s.pixel.height, 2e-6 * (1 + Math.hypot(p[0], p[1], p[2]))) : s.hitPrecision * (1 + t);
    const d = distance(p, threshold);
    if (!Number.isFinite(d)) return { status: 'invalid', t, steps: i, minDistance: minD };
    if (d < minD) minD = d;
    if (d < threshold) return { status: i === 0 ? 'inside' : 'hit', t, steps: i, minDistance: minD };
    t += d * s.stepFactor;
  }
  return { status: 'exhausted', t, steps: s.maxSteps, minDistance: minD };
}

/** Primary rays of an image `width` x `height`, exactly like the shader: ndc = (2x - w, h - 2y) / h, direction = forward + (right*ndc.x + up*ndc.y) * tan(fov/2). */
export function primaryRay(camera: SceneCamera, width: number, height: number, px: number, py: number): { origin: Vec3; dir: Vec3 } {
  const b = cameraBasis(camera); const k = Math.tan((camera.fov_degrees * Math.PI) / 360);
  const nx = (2 * px - width) / height, ny = (height - 2 * py) / height;
  const d: Vec3 = [b.forward[0] + (b.right[0] * nx + b.up[0] * ny) * k, b.forward[1] + (b.right[1] * nx + b.up[1] * ny) * k, b.forward[2] + (b.right[2] * nx + b.up[2] * ny) * k];
  const n = Math.hypot(d[0], d[1], d[2]);
  return { origin: [...b.position], dir: [d[0] / n, d[1] / n, d[2] / n] };
}

export interface ImageMarch { width: number; height: number; counts: Record<RayStatus, number>; hitShare: number; /** 1 per pixel: 1 where a ray hit. */ mask: Uint8Array; medianHitT: number | null; meanSteps: number }

/** The same image march as a generator that yields after every `rowsPerSlice` rows, so a caller can keep an interface responsive or stop early. */
export function* marchImageSteps(distance: DistanceFn, camera: SceneCamera, width: number, height: number, s: MarchSettings, rowsPerSlice = 2): Generator<void, ImageMarch, void> {
  const counts: Record<RayStatus, number> = { hit: 0, miss: 0, exhausted: 0, inside: 0, invalid: 0 }; const mask = new Uint8Array(width * height); const ts: number[] = []; let steps = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { origin, dir } = primaryRay(camera, width, height, x + 0.5, y + 0.5); const r = marchRay(distance, origin, dir, s);
      counts[r.status]++; steps += r.steps; if (r.status === 'hit') { mask[y * width + x] = 1; ts.push(r.t); }
    }
    if (y % rowsPerSlice === rowsPerSlice - 1) yield;
  }
  ts.sort((a, b) => a - b);
  return { width, height, counts, hitShare: (counts.hit + counts.inside) / (width * height), mask, medianHitT: ts.length ? ts[ts.length >> 1]! : null, meanSteps: steps / (width * height) };
}

export function marchImage(distance: DistanceFn, camera: SceneCamera, width: number, height: number, s: MarchSettings): ImageMarch {
  const g = marchImageSteps(distance, camera, width, height, s, 1 << 30); for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/**
 * Imported Mandelbulb 3D artworks are often zoomed in so far that the camera sits closer to a surface than the fixed hit threshold (0.0004 * (1 + t)).
 * The picture is then one flat colour although the artwork is fine. The "pixel" precision mode (threshold = pixel footprint) is what such a zoom needs.
 * This changes the setting only when the CPU marcher shows the problem: the camera is inside solid with the fixed rule and pixel mode shows surfaces
 * from outside. Otherwise the scene is returned unchanged. The answer is data (a changed quality field), reversible in the render settings.
 */
export function withNeededPixelPrecision(scene: Scene, library: readonly Formula[]): { scene: Scene; changed: boolean; reason: string } {
  const built = sceneDistance(scene, library);
  if (!built.ok) return { scene, changed: false, reason: 'the chain cannot be evaluated on the processor' };
  if (built.settings.pixel) return { scene, changed: false, reason: 'already in pixel mode' };
  const size: [number, number] = [24, 20];
  const fixed = marchImage(built.distance, scene.camera, size[0], size[1], built.settings);
  if (fixed.counts.inside <= 0.5 * size[0] * size[1]) return { scene, changed: false, reason: 'the camera is not inside solid with the fixed rule' };
  const q = { ...defaultQuality(), ...(scene.render?.quality ?? {}) };
  const pixel = { hitPixels: q.hit_pixels, tanHalf: Math.tan((scene.camera.fov_degrees * Math.PI) / 360), height: outputSize(scene.render).height };
  const px = marchImage(built.distance, scene.camera, size[0], size[1], { ...built.settings, pixel });
  if (px.counts.inside > 0.5 * size[0] * size[1] || px.counts.hit < 0.02 * size[0] * size[1]) return { scene, changed: false, reason: 'pixel precision does not reveal a surface either' };
  return { scene: { ...scene, render: { ...scene.render, quality: { ...(scene.render?.quality ?? {}), precision_mode: 'pixel' } } } as Scene, changed: true, reason: 'camera inside solid with the fixed hit threshold; the pixel precision mode shows the surface' };
}
