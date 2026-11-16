import type {Scene} from './scene';
import type {PreviewSize} from './artistPreview';
import type {RenderOptions} from './engine';
import {finalGeometryQuality} from './renderSetup';

export interface LookDevSettings {width:256|512|768|1024;samples:1|2|4;geometry:'normal'|'scene'}
export const DEFAULT_LOOKDEV:LookDevSettings={width:1024,samples:1,geometry:'normal'};
/** The "Snabb" choice in the viewport: 512 px wide (512×288 for 16:9 art). The UI starts a new session here. */
export const QUICK_LOOKDEV_WIDTH:LookDevSettings['width']=512;
/** Preview pixel size for a film shape: the width is the chosen number, the height follows the film's ratio (never stretched). */
export function lookDevDimensions(film:PreviewSize,width:number){return {width,height:Math.max(1,Math.round(width*film.height/film.width))};}
/** The camera samples a LookDev still really uses: real DOF never goes below 16, so it must not be shown as 1. */
export function lookDevEffectiveSamples(scene:Scene,samples:number){return scene.camera.dof?.enabled&&scene.camera.projection!=='orthographic'?Math.max(16,samples):samples;}
/** Session-only render intent: never write preview choices into the authored scene. */
/**
 * `accurate` (LOOKDEV-04): draw the small picture with the geometry thresholds of the FINAL film (reference film = the real picture size,
 * pixel thresholds rescaled). The surface is then the one the final render finds, only sampled coarsely, instead of the coarser surface a
 * 512 px picture would find on its own. The thumbnails keep the cheap default.
 */
export function lookDevRequest(source:Scene,film:PreviewSize,settings:LookDevSettings,accurate=false,refineSamples?:number){
 if(![256,512,768,1024].includes(settings.width)||![1,2,4].includes(settings.samples)||!['normal','scene'].includes(settings.geometry))throw Error('Invalid LookDev settings');
 if(!Number.isFinite(film.width)||!Number.isFinite(film.height)||film.width<=0||film.height<=0)throw Error('Invalid LookDev film');
 const size=lookDevDimensions(film,settings.width);
 const scene=structuredClone(source);
 if(settings.geometry==='normal'&&scene.geometryDetail)scene.geometryDetail.enabled=false;
 const options:RenderOptions={quality:{samples_per_pixel:settings.samples,...(accurate?finalGeometryQuality(scene.render.quality,size.height,film.height):{})},referenceFilm:accurate?{width:film.width,height:film.height}:size,tilePixels:16384};
 // A refinement pass of a stationary picture (LOOKDEV-04) draws more camera samples than the three the setting offers: one sample per pixel
 // is the largest part of the difference to the final picture, more than the geometry.
 if(refineSamples!==undefined){if(!Number.isInteger(refineSamples)||refineSamples<1||refineSamples>16)throw Error('Invalid LookDev refinement samples');options.quality!.samples_per_pixel=refineSamples;}
 const effectiveSamples=lookDevEffectiveSamples(scene,refineSamples??settings.samples);
 return {scene,size,options,effectiveSamples};
}

/** Describe the existing viewport approximation; never represent it as final-quality acceleration. */
export function fastLookDevDescription(plan:import('./viewportQuality').ViewportPlan):string {
 return `${plan.state==='navigate'?'navigation light/material':'material, light and fog'} · at most ${plan.quality.max_steps} steps · viewport approximation · see effect limitations`;
}
