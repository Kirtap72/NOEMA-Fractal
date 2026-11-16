/** Presentation authority only. Never migrates or rewrites authored requests. */
import type {Scene} from '../engine/scene';
import type {Formula} from '../engine/formula/types';
import {geometryEligibility,geometryReasonText} from '../engine/geometryEligibility';
import {DEFAULT_GEOMETRY_DETAIL} from '../engine/adaptiveGeometry';
export type QualityProfile='legacy'|'geometry'|'native';
/** First-and-only-string view of {@link geometryEligibility}; kept for older callers. All reasons are joined. */
export function geometryUnavailable(scene:Scene,formulas:readonly Formula[]):string|undefined {
 return geometryReasonText(geometryEligibility(scene,formulas));
}
export function qualityProfile(scene:Scene,native=false):QualityProfile{return native?'native':scene.geometryDetail?.enabled?'geometry':'legacy';}
export function qualitySummary(scene:Scene,profile:QualityProfile):string {
 const q=scene.render.quality,g=scene.geometryDetail??DEFAULT_GEOMETRY_DETAIL;
 const sampling=`${q.samples_per_pixel} samples/pixel${profile!=='native'&&scene.camera.dof?.enabled?' (DOF uses at least 16)':''}`;
 if(profile==='legacy')return `Older NOEMA · step ${q.step_factor} · at most ${q.max_steps} steps · ${q.precision_mode==='fixed'?'fixed hit limit '+q.hit_precision:'hit limit '+q.hit_pixels+' pixel'}${q.hit_policy==='film-half-pixel'?' limited to half a target film pixel with a Float32 floor':''} · ${sampling}. Detail Level is not activated.`;
 return `${profile==='native'?'MB3D Compatible · locked reference scene · original film 7000×3938 · S5 normal':'NOEMA Geometry Detail · DS micro-normal'} · Detail Level ${g.detailLevel} · step ${g.stepMultiplier} · ${g.budget==='automatic'?'automatic continuation':'manual budget'} up to ${g.maxSteps} queries/ray, 640/pass · ${sampling}.`;
}
