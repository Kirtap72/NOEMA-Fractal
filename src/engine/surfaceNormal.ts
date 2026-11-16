import type {SceneCamera} from './camera';
import {cameraFov} from './cameraOptics';
import {checkOutputSize,verticalFovDegrees} from './renderSetup';
import type {RenderSetup} from './renderSetup';

export interface ReferenceFilm {width:number;height:number}
/** Independent of the dispatch/ROI size; the same target film is used throughout a preview run. */
export function normalFilmData(camera:SceneCamera,render:RenderSetup,film:ReferenceFilm,enabled=true,hitEnabled=true):[number,number,number,number]{
 const error=checkOutputSize(film.width,film.height);if(error)throw Error('Invalid normal reference film: '+error);
 const fov=verticalFovDegrees(cameraFov(camera,render.fov_axis,film.width,film.height),render.fov_axis,film.width,film.height);
 // w is the independent primary-hit flag; reuse the same immutable target-film coefficients.
 return [enabled&&render.quality.normal_policy==='film-detail'?1:0,2*Math.tan(fov*Math.PI/360)/film.height,camera.projection==='orthographic'?(camera.ortho_height??4)/film.height:0,hitEnabled&&render.quality.hit_policy==='film-half-pixel'?1:0];
}

/** Same pixel-relative acceptance and Float32 floor as legacy pixel precision; a smaller saved tolerance wins. */
export function filmHitThreshold(saved:number,pixel:number,position:readonly number[]):number{
 return Math.max(2e-6*(1+Math.hypot(...position)),Math.min(saved,.5*pixel));
}

/** CPU reference for the shader's primary-only policy. Primary marching and secondary offsets are separate. */
export function filmNormalOffset(saved:number,pixel:number,position:readonly number[]):number{
 return Math.max(2e-6*(1+Math.hypot(...position)),Math.min(saved,pixel));
}
