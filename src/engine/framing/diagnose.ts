/**
 * VISUAL-RELIABILITY-01: cheap, bounded diagnostics for a preview, from the engine's own CPU marcher. They answer "is anything visible from this camera,
 * and if not, why" so that a blank picture is never read as a failed formula without evidence. At most a few thousand distance evaluations.
 */
import type { Formula } from '../formula/types';
import type { Scene } from '../scene';
import { marchImage, marchImageSteps, sceneDistance } from './rayMarch';

export type SurfaceStatus = 'surface-visible' | 'sparse' | 'nothing-hit-normal-march' | 'camera-inside-solid' | 'unavailable';
export interface VisibleDiagnostics {
  status: SurfaceStatus;
  /** Share of a small CPU test image in which a ray hits a surface (default march settings, the scene's own camera). */
  cpuHitShare: number | null;
  rays: { hit: number; miss: number; exhausted: number; inside: number; invalid: number } | null;
  /** When nothing was hit: does a much finer march find a surface? If so the distance estimate overshoots (not a camera problem, not an empty formula). */
  fineMarchHitShare: number | null;
  possibleCauses: string[];
  hint: string;
}

export function diagnoseVisible(scene: Scene, library: readonly Formula[], size: [number, number] = [28, 24], budgetMs = 1500): VisibleDiagnostics {
  const started = Date.now();
  const d = sceneDistance(scene, library);
  if (!d.ok) return { status: 'unavailable', cpuHitShare: null, rays: null, fineMarchHitShare: null, possibleCauses: [], hint: 'The chain cannot be calculated on the processor, so nothing can be said about visibility: ' + d.errors.slice(0, 1).join('; ') };
  const m = marchImage(d.distance, scene.camera, size[0], size[1], d.settings);
  const total = size[0] * size[1];
  if (m.counts.inside > 0.5 * total) return { status: 'camera-inside-solid', cpuHitShare: m.hitShare, rays: m.counts, fineMarchHitShare: null, possibleCauses: ['camera inside solid material'], hint: 'The camera is inside solid material, so the picture becomes single-colour. Move the camera away or use noema_frame_draft; the formula is not broken.' };
  if (m.counts.hit > 0.01 * total) return { status: m.hitShare < 0.05 ? 'sparse' : 'surface-visible', cpuHitShare: m.hitShare, rays: m.counts, fineMarchHitShare: null, possibleCauses: [], hint: m.hitShare < 0.05 ? 'Only a small part of the picture hits a surface; consider framing the fractal (noema_frame_draft).' : 'Surfaces are visible from this camera.' };
  // nothing hit: finer march on a small subset of the image
  let fine: number | null = null;
  if (Date.now() - started < budgetMs) {
    // a small, time-boxed fine march: stops cleanly (and reports nothing) when the budget is used up
    const g = marchImageSteps(d.distance, scene.camera, 10, 9, { ...d.settings, stepFactor: 0.1, maxSteps: 800 }, 1);
    for (;;) { const r = g.next(); if (r.done) { fine = r.value.hitShare; break; } if (Date.now() - started > budgetMs) break; }
  }
  const causes = ['the camera sees empty space (too far away, looking away, or the geometry is elsewhere)'];
  if (fine !== null && fine > 0.01) causes.unshift('sphere tracing overshoot: a much finer march finds a surface, so the distance estimate is too large here');
  if (m.counts.exhausted > 0.05 * total) causes.push('rays run out of steps');
  return { status: 'nothing-hit-normal-march', cpuHitShare: m.hitShare, rays: m.counts, fineMarchHitShare: fine,
    possibleCauses: causes, hint: fine !== null && fine > 0.01 ? 'A much finer march finds a surface: the distance estimate is too large here (the rays skip over the surface). Lower the step factor or frame; an empty picture does not mean the formula is wrong.' : 'No surface is hit from this camera. Try noema_frame_draft; an empty picture does not automatically mean the formula is wrong.' };
}
