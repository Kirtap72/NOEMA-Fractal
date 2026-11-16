import type {Scene} from '../engine/scene';
import type {LibraryRecord,LibraryThumbnailState} from '../engine/discoveryLibrary';
import {outputSize,testRenderSetup} from '../engine/renderSetup';

export const THUMBNAIL_TIMEOUT_MS=20000;
export interface ThumbnailImage {png:string;width:number;height:number;generation:number;sourceFingerprint:string}
/** `quality` is only set for the user-triggered "Rendera bättre förhandsbild…"; the automatic thumbnail has none. */
export interface ThumbnailRequest {signal:AbortSignal;generation:number;sourceFingerprint:string;width:number;height:number;quality?:ThumbnailQuality;samples?:number;progress?:(fraction:number)=>void}

export type ThumbnailQuality='good'|'high';
/** Bounded budgets for the better preview: never a hidden full-size campaign. PNG validation caps a side at 1024 px. */
export const THUMBNAIL_QUALITIES:Record<ThumbnailQuality,{label:string;longSide:number;samples:number;timeoutMs:number}>={
 good:{label:'Bra',longSide:768,samples:4,timeoutMs:120000},
 high:{label:'High',longSide:1024,samples:8,timeoutMs:300000},
};
const even=(n:number)=>Math.max(2,2*Math.round(n/2));
/** The better preview keeps the preset's own picture shape (never stretched) and is scaled so its longest side is the budget. */
export function improvedThumbnailSize(scene:Scene,quality:ThumbnailQuality,fallbackAspect=4/3){
 const film=outputSize(scene.render,fallbackAspect),scale=THUMBNAIL_QUALITIES[quality].longSide/Math.max(film.width,film.height);
 return {width:even(film.width*scale),height:even(film.height*scale)};
}
/** Real depth of field never renders with fewer than 16 camera samples, so the user is told 16, not 4 or 8. */
export function improvedThumbnailSamples(scene:Scene,quality:ThumbnailQuality){
 const base=THUMBNAIL_QUALITIES[quality].samples;
 return scene.camera.dof?.enabled&&scene.camera.projection!=='orthographic'?Math.max(16,base):base;
}
export function presetThumbnailSize(scene:Scene,aspect=4/3){return outputSize(testRenderSetup(scene.render,240),aspect);}
export function thumbnailState(record:LibraryRecord):LibraryThumbnailState{return record.thumbnailState??{status:record.thumbnail?'ready':'pending',generation:0,sourceFingerprint:record.fingerprint};}
export function thumbnailMessage(e:unknown){return (e instanceof Error?e.message:String(e)).slice(0,500);}
export function checkThumbnailIdentity(record:LibraryRecord,image:ThumbnailImage){const state=thumbnailState(record);return image.generation===state.generation&&image.sourceFingerprint===record.fingerprint&&state.status==='pending';}

/** Decode bounded local PNGs; brightness is never a validity criterion. No object URL lifetime. */
export async function validateThumbnail(png:string,expected?:{width:number;height:number},signal?:AbortSignal):Promise<{width:number;height:number}>{
 if(signal?.aborted)throw signal.reason??new DOMException('The thumbnail was cancelled.','AbortError');
 if(png.length>10*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png))throw Error('The thumbnail is not a PNG picture.');
 let header:string;try{header=atob(png.slice(png.indexOf(',')+1,png.indexOf(',')+1+44));}catch{throw Error('The PNG data of the thumbnail is broken.');}
 if(header.length<24||header.slice(0,8)!=='\x89PNG\r\n\x1a\n'||header.slice(12,16)!=='IHDR')throw Error('The PNG header of the thumbnail is broken.');
 const n=(offset:number)=>((header.charCodeAt(offset)*2**24)+(header.charCodeAt(offset+1)<<16)+(header.charCodeAt(offset+2)<<8)+header.charCodeAt(offset+3));
 const width=n(16),height=n(20);if(width<1||height<1||width>1024||height>1024||width*height>1024*1024||expected&&(width!==expected.width||height!==expected.height))throw Error('The thumbnail has the wrong picture dimensions.');
 const image=new Image();
 await new Promise<void>((resolve,reject)=>{
  const finish=(error?:unknown)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=null;image.onerror=null;if(error){image.src='';reject(error);}else resolve();};
  const abort=()=>finish(signal?.reason??new DOMException('The thumbnail was cancelled.','AbortError'));
  const timer=setTimeout(()=>finish(Error('The PNG decoding took too long.')),5000);
  image.onload=()=>image.naturalWidth===width&&image.naturalHeight===height?finish():finish(Error('The PNG dimensions could not be verified.'));
  image.onerror=()=>finish(Error('The thumbnail could not be decoded.'));signal?.addEventListener('abort',abort,{once:true});image.src=png;
 });
 return {width,height};
}

export interface ThumbnailStore {
 beginThumbnail(id:string):Promise<LibraryRecord|undefined>;
 get?(id:string):Promise<LibraryRecord|undefined>;
 /** Replace the picture only if the preset is still exactly the one that was rendered. Nothing else is written. */
 replaceThumbnail?(id:string,sourceFingerprint:string,png:string,state:LibraryThumbnailState):Promise<boolean>;
 finishThumbnail(id:string,generation:number,sourceFingerprint:string,png:string,state:LibraryThumbnailState):Promise<boolean>;
}
/** One attempt, no GPU queue. A cancelled compile retains ownership until it settles. */
export class PresetThumbnailJobs {
 private active:{id:string;controller:AbortController}|undefined;
 progress?:(fraction:number)=>void;
 constructor(private store:ThumbnailStore,private capture:(scene:Scene,request:ThumbnailRequest)=>Promise<ThumbnailImage>,private changed:(error?:unknown)=>void,private timeout=THUMBNAIL_TIMEOUT_MS,private validate:typeof validateThumbnail=validateThumbnail){}
 get busy(){return !!this.active;}
 get activeId(){return this.active?.id;}
 cancel(){this.active?.controller.abort(new DOMException('The thumbnail was cancelled. The preset is saved; try again.','AbortError'));}
 async run(id:string):Promise<void>{
  if(this.active)return;
  const controller=new AbortController();this.active={id,controller};let record:LibraryRecord|undefined;
  const aborted=()=>{if(!record)return;const state=thumbnailState(record);void this.store.finishThumbnail(id,state.generation,record.fingerprint,'',{...state,status:'failed',message:thumbnailMessage(controller.signal.reason)}).then(()=>this.changed()).catch(e=>this.changed(e));};
  controller.signal.addEventListener('abort',aborted,{once:true});
  const timer=setTimeout(()=>controller.abort(Error('The time budget of the thumbnail ran out. The preset is saved; try again.')),this.timeout);
  try{
   record=await this.store.beginThumbnail(id);if(!record)return;
   const state=thumbnailState(record);this.changed();
   if(record.payload.kind!=='preset'&&record.payload.kind!=='legacy-variation')return;
   controller.signal.throwIfAborted();
   const size=state.width&&state.height?{width:state.width,height:state.height}:presetThumbnailSize(record.payload.scene);
   const image=await this.capture(structuredClone(record.payload.scene),{signal:controller.signal,generation:state.generation,sourceFingerprint:record.fingerprint,...size});
   if(controller.signal.aborted)throw controller.signal.reason;
   if(!checkThumbnailIdentity(record,image)||image.width!==size.width||image.height!==size.height)throw Error('The thumbnail belongs to a replaced scene or batch.');
   await this.validate(image.png,size,controller.signal);
   await this.store.finishThumbnail(id,state.generation,record.fingerprint,image.png,{...state,status:'ready',...size,message:undefined});
  }catch(error){
   if(record){const state=thumbnailState(record);await this.store.finishThumbnail(id,state.generation,record.fingerprint,'',{...state,status:'failed',message:thumbnailMessage(error)});}
   else throw error;
  }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',aborted);this.active=undefined;this.changed();}
 }

 /**
  * User-triggered: render a better picture of the SAVED preset and replace only its thumbnail.
  * Unlike run(), the old picture stays in place until the new one is finished and validated, so cancel, error and timeout
  * leave the library exactly as it was. Returns what happened, for the status line.
  */
 async improve(id:string,quality:ThumbnailQuality):Promise<'replaced'|'cancelled'|'stale'|'busy'>{
  if(this.active)return 'busy';
  const {get,replaceThumbnail}=this.store;if(!get||!replaceThumbnail)throw Error('The library lacks support for replacing a thumbnail.');
  const controller=new AbortController();this.active={id,controller};
  const budget=THUMBNAIL_QUALITIES[quality];
  const timer=setTimeout(()=>controller.abort(Error('The time budget of the preview ran out. The old picture remains.')),Math.max(this.timeout,budget.timeoutMs));
  try{
   const record=await get.call(this.store,id);
   if(!record||(record.payload.kind!=='preset'&&record.payload.kind!=='legacy-variation'))return 'stale';
   controller.signal.throwIfAborted();this.changed();
   const state=thumbnailState(record),scene=structuredClone(record.payload.scene);
   const fallback=state.width&&state.height?state.width/state.height:4/3,size=improvedThumbnailSize(scene,quality,fallback),samples=budget.samples; // the renderer itself lifts real DOF to 16
   const image=await this.capture(scene,{signal:controller.signal,generation:state.generation,sourceFingerprint:record.fingerprint,...size,quality,samples,progress:f=>this.progress?.(f)});
   if(controller.signal.aborted)throw controller.signal.reason;
   if(image.sourceFingerprint!==record.fingerprint||image.width!==size.width||image.height!==size.height)throw Error('The preview belongs to a replaced scene.');
   await this.validate(image.png,size,controller.signal);
   controller.signal.throwIfAborted();
   const stored=await replaceThumbnail.call(this.store,id,record.fingerprint,image.png,{status:'ready',generation:state.generation+1,sourceFingerprint:record.fingerprint,...size});
   return stored?'replaced':'stale';
  }catch(error){
   if(controller.signal.aborted&&(error as {name?:string}).name==='AbortError')return 'cancelled';
   throw error;
  }finally{clearTimeout(timer);this.active=undefined;this.changed();}
 }
}
