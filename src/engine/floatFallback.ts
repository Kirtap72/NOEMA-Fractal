/**
 * GEO-DETAIL-COMPAT-02, WP3. "Hög detalj (Float32)": the honest alternative when Geometry Detail (double-single, direct depth search)
 * is not available for a scene. It is ordinary Float32 marching with two EXISTING, verified quality policies:
 *   quality.hit_policy    = 'film-half-pixel'  ("Fin träff",  R2C2)
 *   quality.normal_policy = 'film-detail'      ("Fin detalj", R2C1)
 * It never touches `geometryDetail`, the step budget, samples, resolution or anything else, and it is never saved or shown as
 * Geometry Detail, double-single or native. Pure; the caller decides when to apply it (always an explicit, undoable click).
 */
import type {Scene} from './scene';

export const FLOAT32_FALLBACK_QUALITY={hit_policy:'film-half-pixel',normal_policy:'film-detail'} as const;

export const FLOAT32_FALLBACK_LABEL='High detail (Float32) – not Geometry Detail';
export const FLOAT32_FALLBACK_HELP='Uses the ordinary Float32 rendering with Fine hit and Fine detail. No double precision and no directed depth search. Gives sharper hits than standard but can still miss very thin details. The step budget is not changed.';
export const FLOAT32_FALLBACK_ACTIVE='High detail (Float32) is already active';
export const FLOAT32_FALLBACK_CHANGED='Changed: Fine hit, Fine detail';

export function float32FallbackActive(scene:Pick<Scene,'render'>):boolean{
  const q=scene.render.quality;
  return q.hit_policy===FLOAT32_FALLBACK_QUALITY.hit_policy&&q.normal_policy===FLOAT32_FALLBACK_QUALITY.normal_policy;
}

/** A copy of the scene with exactly the two policies set. Everything else, including `geometryDetail`, is kept as it is. */
export function applyFloat32Fallback(scene:Scene):Scene{
  return {...scene,render:{...scene.render,quality:{...scene.render.quality,...FLOAT32_FALLBACK_QUALITY}}};
}
