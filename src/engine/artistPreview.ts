import type {Engine,ImageBuffer,LayerBuffers,Region,RenderTiming} from './engine';
import type {Scene} from './scene';
import {PreviewAccumulator} from './finalPreview';
import {DENOISE_RADIUS} from './denoise';
import {PREVIEW_SCALES} from './renderSetup';
import type {PreviewScale} from './renderSetup';

export type ArtistPreviewBudget='quick'|'balanced'|'detailed';
export interface PreviewSize {width:number;height:number}
export interface ArtistPreviewOverrides {scale?:PreviewScale;samples?:number}
export interface ArtistPreviewPlan {
 initial:PreviewSize; refined:PreviewSize; output:PreviewSize; roi:Region;
 targetSamples:number; roiSamples:number;
}
const fit=(size:PreviewSize,longest:number):PreviewSize=>{
 const scale=Math.min(1,longest/Math.max(size.width,size.height));
 return {width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale))};
};
const scaleSize=(size:PreviewSize,scale:PreviewScale):PreviewSize=>({
 width:scale===1?size.width:Math.max(1,Math.round(size.width*scale)),
 height:scale===1?size.height:Math.max(1,Math.round(size.height*scale)),
});
export function previewRoi(size:PreviewSize,x:number,y:number,edge=192):Region {
 if(![x,y,edge].every(Number.isFinite)||!Number.isInteger(edge)||edge<1)throw Error('Invalid preview ROI');
 const width=Math.min(edge,size.width),height=Math.min(edge,size.height);
 return {x:Math.max(0,Math.min(size.width-width,Math.round(x-width/2))),y:Math.max(0,Math.min(size.height-height,Math.round(y-height/2))),width,height};
}
export function artistPreviewPlan(scene:Scene,size:PreviewSize,budget:ArtistPreviewBudget,roi?:Region,overrides?:ArtistPreviewOverrides):ArtistPreviewPlan {
 if(![size.width,size.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=32768))throw Error('Invalid preview output dimensions');
 const index=['quick','balanced','detailed'].indexOf(budget);if(index<0)throw Error('Unknown preview budget');
 if(overrides?.scale!==undefined&&!(PREVIEW_SCALES as readonly number[]).includes(overrides.scale))throw Error('Invalid preview scale');
 if(overrides?.samples!==undefined&&(!Number.isInteger(overrides.samples)||overrides.samples<1||overrides.samples>64))throw Error('Invalid preview sample budget');
 const dof=scene.camera.dof?.enabled&&scene.camera.projection!=='orthographic';
 const saved=Math.max(scene.render.quality.samples_per_pixel,dof?16:1);
 const defaultTarget=Math.min(saved,[4,16,64][index]!);
 const targetSamples=overrides?.samples??defaultTarget;
 const roiSamples=overrides?.samples!==undefined?Math.min(overrides.samples,4):Math.min(saved,index===0?2:4);
 const initial=overrides?.scale!==undefined?scaleSize(size,overrides.scale):fit(size,index===0?480:640);
 const refined=overrides?.scale!==undefined?scaleSize(size,overrides.scale):fit(size,[640,960,1280][index]!);
 return {initial,refined,output:{...size},roi:roi??previewRoi(size,size.width/2,size.height/2,index===0?128:192),targetSamples,roiSamples};
}
export interface ArtistPreviewFrame {
 kind:'initial'|'roi'|'refined';image:ImageBuffer;frameSize:PreviewSize;region?:Region;
 samples:number;targetSamples:number;complete:boolean;elapsedMs:number;timings:RenderTiming[];
}
export interface ArtistPreviewControl {
 signal:AbortSignal;
 prepared?(phase:'resources'|'scene',milliseconds:number):void;
 wait():Promise<void>;
 progress(kind:ArtistPreviewFrame['kind'],sample:number,target:number,fraction:number):void;
 present(frame:ArtistPreviewFrame):void|Promise<void>;
}
type Renderer=Pick<Engine,'renderToBuffer'|'renderLayersToBuffer'|'denoiseBuffer'>;
/** No shading implementation here: each sample uses the existing final output renderer.
 * Linear accumulation precedes the existing display/denoise paths; ROI keeps global image coordinates. */
export async function renderArtistPreview(engine:Renderer,scene:Scene,plan:ArtistPreviewPlan,control:ArtistPreviewControl,roiOnly=false):Promise<void>{
 const started=performance.now(),signal=control.signal;
 interface State {accumulator:PreviewAccumulator;guides?:LayerBuffers;last?:ImageBuffer}
 async function stage(kind:ArtistPreviewFrame['kind'],size:PreviewSize,target:number,region?:Region,reuse?:State):Promise<State>{
  const r=region??{x:0,y:0,...size},halo=scene.denoise?.enabled?DENOISE_RADIUS:0;
  const x=Math.max(0,r.x-halo),y=Math.max(0,r.y-halo);
  const expanded={x,y,width:Math.min(size.width,r.x+r.width+halo)-x,height:Math.min(size.height,r.y+r.height+halo)-y};
  const state:State=reuse??{accumulator:new PreviewAccumulator()},accumulator=state.accumulator;let guides=state.guides;
  if(accumulator.sampleCount>=target&&state.last){signal.throwIfAborted();await control.present({kind,image:state.last,frameSize:size,region,samples:accumulator.sampleCount,targetSamples:target,complete:true,elapsedMs:performance.now()-started,timings:[]});return state;}
  for(let sample=accumulator.sampleCount;sample<target;sample++){
   signal.throwIfAborted();await control.wait();signal.throwIfAborted();const timings:RenderTiming[]=[];
   const options={referenceFilm:plan.output,quality:{samples_per_pixel:1},dofSamples:1,sampleOffset:sample,denoise:false,region:expanded,tilePixels:16384,signal,onTiming:(t:RenderTiming)=>timings.push(t),onProgress:(p:{fraction:number})=>control.progress(kind,sample,target,p.fraction)};
   let input:ImageBuffer;
   if(scene.denoise?.enabled&&!guides){guides=await engine.renderLayersToBuffer(size.width,size.height,options);input={width:guides.width,height:guides.height,data:guides.color,linear:guides.linear,display:guides.display};}
   else input=await engine.renderToBuffer(size.width,size.height,options);
   signal.throwIfAborted();let image=accumulator.add(input);
   if(guides)image=await engine.denoiseBuffer({...guides,color:image.data,linear:image.linear,display:image.display},{signal,frameWidth:size.width,frameHeight:size.height});
   if(halo){const data=new Uint8Array(r.width*r.height*4),linear=new Float32Array(data.length);for(let row=0;row<r.height;row++){const from=((r.y-y+row)*expanded.width+r.x-x)*4;data.set(image.data.subarray(from,from+r.width*4),row*r.width*4);linear.set(image.linear!.subarray(from,from+r.width*4),row*r.width*4);}image={...image,width:r.width,height:r.height,data,linear};}
   signal.throwIfAborted();await control.present({kind,image,frameSize:size,region,samples:sample+1,targetSamples:target,complete:sample+1===target,elapsedMs:performance.now()-started,timings});
   state.last=image;state.guides=guides;
  }
  return state;
 }
 if(roiOnly){await stage('roi',plan.output,plan.roiSamples,plan.roi);return;}
 // The first whole composition and the native ROI are deliberately presented before a long integration.
 const initial=await stage('initial',plan.initial,1);
 await stage('roi',plan.output,plan.roiSamples,plan.roi);
 const same=plan.initial.width===plan.refined.width&&plan.initial.height===plan.refined.height;
 await stage('refined',plan.refined,plan.targetSamples,undefined,same?initial:undefined);
}
