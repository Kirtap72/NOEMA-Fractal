/**
 * VISUAL-RELIABILITY-01: "Frame Fractal". Looks for visible geometry of the scene's chain with a small, bounded amount of CPU work and proposes a camera
 * (target, distance) that shows it. It only PROPOSES: the scene is never changed here, so the artist's own camera stays until a proposal is approved.
 *
 * Method (all with the engine's own distance function, ordinary chains and grouped executions alike):
 *  1. Visible surface: rays are shot inward from a ring of directions around the scene and marched with the shader's own rule (rayMarch.ts). A hit is a
 *     point that really is visible, so camera-inside-solid and misses are accounted for.
 *  2. Near-surface volume: random points in nested cubes whose distance estimate is small. Used when marching finds nothing, to tell "no geometry"
 *     from "geometry exists but sphere tracing steps over it" (an inaccurate distance estimate).
 *  3. The target is the median of the hits, the radius a high percentile of their distance from it; the distance fits that sphere into the vertical
 *     field of view. The proposal is checked by marching a small image from the proposed camera; if it shows too little, other distances are tried.
 * The result states how reliable it is. It never hides a rendering problem by moving the camera: when marching and volume disagree it says so.
 */
import type { Formula } from '../formula/types';
import type { Scene } from '../scene';
import type { SceneCamera, Vec3 } from '../camera';
import { marchImageSteps, marchRay, sceneDistance } from './rayMarch';
import type { DistanceFn, MarchSettings } from './rayMarch';

export type FrameStatus = 'ok' | 'low-confidence' | 'marching-unreliable' | 'no-geometry' | 'camera-inside' | 'unavailable';
export interface FrameProposal {
  status: FrameStatus;
  /** Plain-language explanation for the artist and the AI. */
  message: string;
  camera?: { position: Vec3; target: Vec3; distance: number; fov_degrees: number };
  radius?: number;
  center?: Vec3;
  /** Share of a small test image (from the proposed camera) in which a ray hits a surface. */
  visibleShare?: number;
  evidence: { hitRays: number; raysShot: number; nearVolumeShare: number | null; fineMarchHitShare: number | null; evaluations: number; milliseconds: number; stoppedByBudget: boolean };
  errors?: string[];
}
export interface FrameOptions { /** Wall-clock budget; the work stops cleanly when it is used up. */ budgetMs?: number; directions?: number; testSize?: [number, number] }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const norm = (v: Vec3): Vec3 => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]!; };
const percentile = (a: number[], p: number): number => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };

/** Directions spread evenly over a sphere (Fibonacci lattice). */
function sphereDirections(n: number): Vec3[] {
  const out: Vec3[] = []; const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), th = golden * i; out.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
  return out;
}

/** A generator, so a caller can run it in slices (it yields now and then) or to the end. */
export function* frameFractalSteps(scene: Scene, library: readonly Formula[], options: FrameOptions = {}): Generator<void, FrameProposal, void> {
  const started = Date.now(); const budget = options.budgetMs ?? 4000; let evaluations = 0;
  const built = sceneDistance(scene, library);
  const empty = { hitRays: 0, raysShot: 0, nearVolumeShare: null, fineMarchHitShare: null, evaluations: 0, milliseconds: 0, stoppedByBudget: false };
  if (!built.ok) return { status: 'unavailable', message: 'The engine cannot calculate this chain on the processor: ' + built.errors.slice(0, 2).join('; '), evidence: empty, errors: built.errors };
  const distance: DistanceFn = (p, t) => { evaluations++; return built.distance(p, t); };
  const settings: MarchSettings = built.settings;
  const fov = scene.camera.fov_degrees; const tanHalf = Math.tan((fov * Math.PI) / 360);
  const over = () => Date.now() - started > budget;
  const finish = (p: Omit<FrameProposal, 'evidence'> & { evidence?: Partial<FrameProposal['evidence']> }, ev: Partial<FrameProposal['evidence']>): FrameProposal => ({ ...p, evidence: { ...empty, ...ev, ...p.evidence, evaluations, milliseconds: Date.now() - started, stoppedByBudget: over() } });

  // 1. visible surface from a ring of viewpoints at several radii
  const hits: Vec3[] = []; let shot = 0; const dirs = sphereDirections(options.directions ?? 36);
  const centerGuess: Vec3 = [...scene.camera.target];
  for (const R of [4, 12]) {
    for (const d of dirs) {
      if (over()) break; shot++;
      const origin: Vec3 = [centerGuess[0] + d[0] * R, centerGuess[1] + d[1] * R, centerGuess[2] + d[2] * R]; const dir = norm(sub(centerGuess, origin));
      const r = marchRay(distance, origin, dir, { ...settings, maxDistance: R * 2.2 });
      if (r.status === 'hit') hits.push([origin[0] + dir[0] * r.t, origin[1] + dir[1] * r.t, origin[2] + dir[2] * r.t]);
      if (shot % 6 === 0) yield;
    }
  }
  // 2. near-surface volume (also the evidence for "geometry exists but marching misses it")
  let near = 0, probes = 0; const volumePoints: Vec3[] = []; let seed = 20241101; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (const R of [1.5, 3, 6, 12]) for (let i = 0; i < 600 && !over(); i++) {
    const p: Vec3 = [centerGuess[0] + (rnd() - 0.5) * 2 * R, centerGuess[1] + (rnd() - 0.5) * 2 * R, centerGuess[2] + (rnd() - 0.5) * 2 * R]; probes++;
    if (distance(p, 0.0004) < 0.02 * (R / 1.5)) { near++; volumePoints.push(p); }
    if (i % 100 === 99) yield;
  }
  const nearShare = probes ? near / probes : null;
  const fine: MarchSettings = { ...settings, stepFactor: 0.1, maxSteps: 1500 };
  let fineHits = 0, fineShot = 0; const fineHitPoints: Vec3[] = [];
  const usable = hits.length >= 3;

  if (!usable) {
    // Nothing visible with the normal march. Try a much finer march before judging.
    for (const R of [4, 12]) for (const d of dirs.slice(0, 18)) {
      if (over()) break; fineShot++; const origin: Vec3 = [centerGuess[0] + d[0] * R, centerGuess[1] + d[1] * R, centerGuess[2] + d[2] * R]; const dir = norm(sub(centerGuess, origin));
      const r = marchRay(distance, origin, dir, { ...fine, maxDistance: R * 2.2 }); if (r.status === 'hit') { fineHits++; fineHitPoints.push([origin[0] + dir[0] * r.t, origin[1] + dir[1] * r.t, origin[2] + dir[2] * r.t]); }
      if (fineShot % 4 === 0) yield;
    }
    const fineShare = fineShot ? fineHits / fineShot : null;
    if (fineHits >= 2) return finish({ status: 'marching-unreliable', message: 'Geometry exists, but the normal ray march skips it (the distance estimate is too large here). A much finer march finds the surface. Do not just move the camera: lower the step factor or use a formula with a preserved distance.', center: fineHitPoints.length ? [median(fineHitPoints.map((p) => p[0])), median(fineHitPoints.map((p) => p[1])), median(fineHitPoints.map((p) => p[2]))] : undefined },
      { hitRays: hits.length, raysShot: shot, nearVolumeShare: nearShare, fineMarchHitShare: fineShare });
    if ((nearShare ?? 0) > 0.002) return finish({ status: 'marching-unreliable', message: 'Points near a surface exist in the volume but no ray hits it, even with a fine march. Probably the distance estimate is much too large or the surface too thin for ray marching; the camera is not the problem.' }, { hitRays: 0, raysShot: shot, nearVolumeShare: nearShare, fineMarchHitShare: fineShare });
    return finish({ status: 'no-geometry', message: 'No surface was found in the examined areas (within radius 12 around the target point). The formula may lack a surface with these values, or lie further away.' }, { hitRays: 0, raysShot: shot, nearVolumeShare: nearShare, fineMarchHitShare: fineShare });
  }

  // 3. proposal from the visible hits
  const center: Vec3 = [median(hits.map((p) => p[0])), median(hits.map((p) => p[1])), median(hits.map((p) => p[2]))];
  const radius = Math.max(0.05, percentile(hits.map((p) => len(sub(p, center))), 0.9));
  const keep = sub(scene.camera.position, scene.camera.target); const viewDir = len(keep) > 1e-9 ? norm(keep) : ([0, 0, 1] as Vec3);
  const [tw, th] = options.testSize ?? [40, 36];
  let best: { distance: number; position: Vec3; share: number; status: string } | null = null;
  for (const factor of [1.25, 1.0, 1.7, 2.6]) {
    const D = (radius / Math.sin((fov * Math.PI) / 360)) * factor; const position: Vec3 = [center[0] + viewDir[0] * D, center[1] + viewDir[1] * D, center[2] + viewDir[2] * D];
    const cam: SceneCamera = { ...scene.camera, position, target: center };
    const m = yield* marchImageSteps(distance, cam, tw, th, settings, 2);
    const inside = m.counts.inside > 0.5 * tw * th;
    const share = m.hitShare;
    if (!inside && (!best || (share > best.share && share < 0.97) || best.status === 'inside')) best = { distance: D, position, share, status: 'ok' };
    if (!inside && share >= 0.05 && share < 0.9) break;
    if (over()) break; yield;
  }
  if (!best) return finish({ status: 'camera-inside', message: 'The examined camera distances end up inside solid material. No safe framing could be proposed; move the camera far away and try again.', center, radius }, { hitRays: hits.length, raysShot: shot, nearVolumeShare: nearShare });
  const confident = best.share >= 0.03 && hits.length >= Math.max(6, shot * 0.1);
  return finish({ status: confident ? 'ok' : 'low-confidence', message: confident ? `Proposal: target point (${center.map((v) => v.toFixed(2)).join(', ')}), distance ${best.distance.toFixed(2)}. About ${(best.share * 100).toFixed(0)} % of the picture hits a surface.` : `Uncertain proposal: only ${(best.share * 100).toFixed(1)} % of the test picture hits a surface. Review the picture and adjust by hand.`,
    camera: { position: best.position, target: center, distance: best.distance, fov_degrees: fov }, radius, center, visibleShare: best.share }, { hitRays: hits.length, raysShot: shot, nearVolumeShare: nearShare });
}

export function frameFractal(scene: Scene, library: readonly Formula[], options?: FrameOptions): FrameProposal {
  const g = frameFractalSteps(scene, library, options); for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** The same work in slices of the event loop, so the interface stays responsive. */
export async function frameFractalAsync(scene: Scene, library: readonly Formula[], options?: FrameOptions): Promise<FrameProposal> {
  const g = frameFractalSteps(scene, library, options);
  for (;;) { const r = g.next(); if (r.done) return r.value; await new Promise((res) => setTimeout(res, 0)); }
}

/** A scene whose camera is the proposal (the original scene is not changed). Keeps up vector, field of view and lens. */
export function withFramedCamera(scene: Scene, proposal: FrameProposal): Scene {
  if (!proposal.camera) return scene;
  return { ...scene, camera: { ...scene.camera, position: [...proposal.camera.position], target: [...proposal.camera.target] } };
}
