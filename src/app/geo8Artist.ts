import {encodePng} from './output';
/** Isolated artist integration; no normal profile or arbitrary native imports. */
import {createNativeStillSession} from '../engine/nativeStillSession';
import {readGeometryDetail,DEFAULT_GEOMETRY_DETAIL} from '../engine/adaptiveGeometry';
import type {Mb3dParityLab} from '../engine/mb3dParityLab';
import type {Scene} from '../engine/scene';
import type {Library} from '../engine/formula/library';
export interface Geo8Profile {id:'reference scene-geo7-v1';camera:Mb3dParityLab;header:unknown;original:string;map:string;environment:string;hashes:Record<string,string>;geometry:string;light:number[]}
export interface Geo8Document {kind:'noema-geo8-artist-scene';version:1;scene:unknown;profile:Geo8Profile;appearance:'artist'|'native-compatibility'}
declare global {interface Window {noemaGeo8?:{paint:(data:unknown)=>Promise<{rgba:string;paintMs:number}>;cancel:()=>Promise<void>;record:(data:unknown)=>Promise<string>;configure:(p:Geo8Profile)=>Promise<void>}}}
export const geo8Host=typeof window!=='undefined'?window.noemaGeo8:undefined;
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export function geometryIdentity(s:Scene){return JSON.stringify(stable([s.content,s.camera,s.cutout,s.formulaFields??[],s.primitives]));}
export function readGeo8Document(raw:any):Geo8Document|undefined {
 if(raw?.kind!=='noema-geo8-artist-scene')return;
 if(raw.version!==1||raw.profile?.id!=='reference scene-geo7-v1'||!['artist','native-compatibility'].includes(raw.appearance))throw Error('Unsupported GEO8 document');
 return raw;
}
export function nativeDetailCamera(c:Mb3dParityLab,raw:unknown){
 const q=readGeometryDetail(raw);const requested=8/q.detailLevel;
 const floor=1e-12/(c.deStop*c.stepWidth);
 const effective=Math.max(floor,requested);
 if(!Number.isFinite(effective)||!Number.isFinite(Math.fround(effective))||Math.fround(effective)<=0)throw Error('The requested detail cannot be represented.');
 return {camera:{...c,goalScale:effective===1?undefined:effective,raystep:q.stepMultiplier},limited:requested<floor,requested,effective};
}
const base64=(v:ArrayBufferLike|Uint8Array)=>{const b=v instanceof Uint8Array?v:new Uint8Array(v);let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
const unbase64=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
export class Geo8Artist {
 document?:Geo8Document;
 readonly root=document.createElement('fieldset');
 private select=document.createElement('select');
 private status=document.createElement('p');
 private session:ReturnType<typeof createNativeStillSession>;
 constructor(parent:HTMLElement,formulas:Library['formulas'],onAppearance?:()=>void){
 this.session=createNativeStillSession(formulas);this.root.id='geo8-appearance';this.root.innerHTML='<legend>GEO8 · isolated artist version</legend>';
 this.select.id='geo8-appearance-mode';this.select.add(new Option('NOEMA Artist','artist'));this.select.add(new Option('MB3D Compatible','native-compatibility'));
 this.select.onchange=()=>{if(this.document)this.document.appearance=this.select.value as Geo8Document['appearance'];this.status.textContent='The appearance changes no hits or normals. Render the cut-out again.';onAppearance?.();};
 this.root.append(this.select,this.status);parent.prepend(this.root);this.setDocument();
 }
 setDocument(d?:Geo8Document){this.document=d;this.select.value=d?.appearance??'artist';this.select.disabled=!d;this.status.textContent=d?'Native Common 7000×3938 · the NOEMA cut plane of the source scene is not part of this original profile · unchanged responsive NOEMA view. The final picture uses the camera of the original profile. The MB3D mode has the limited soft shadow of GEO7 and AO start value 5000; full native AO/optics is not supported. Use Review the details and Save cut-out.':'MB3D Compatible requires the included reference scene GEO8 scene with original resources. Ordinary scenes use unchanged NOEMA rendering.';}
 supports(scene:Scene){if(!this.document)return false;if(geometryIdentity(scene)!==this.document.profile.geometry)throw Error('The native profile does not match a changed formula/camera/geometry. Open the original GEO8 scene again. No silent fallback.');return true;}
 serialize(sceneText:string){return this.document?JSON.stringify({...this.document,scene:JSON.parse(sceneText)},null,2):sceneText;}
 async render(scene:Scene,roi:{x:number;y:number;width:number;height:number},signal:AbortSignal,progress:(text:string,fraction:number)=>void,qa?:{capacity?:number;onGeometry?:(d:any,s:Float32Array)=>void;onConsumed?:(d:any)=>void}){
 if(!this.supports(scene)||!geo8Host)throw Error('GEO8 profile/desktop host required');
 const doc=this.document!,p=doc.profile,q=readGeometryDetail(scene.geometryDetail??{...DEFAULT_GEOMETRY_DETAIL,enabled:true});
 if(!q.enabled)throw Error('Turn on Geometry Detail for the native profile.');
 const c=nativeDetailCamera(p.camera,q);this.session.prepare(scene,c.camera);
 await geo8Host.configure(p);
 const spp=scene.render.quality.samples_per_pixel,n=roi.width*roi.height;
 if(![roi.x,roi.y,roi.width,roi.height].every(Number.isInteger)||roi.x<0||roi.y<0||roi.width<1||roi.height<1||roi.x+roi.width>7000||roi.y+roi.height>3938||n>1048576)throw Error('GEO8 requires a valid native cut-out, at most 1,048,576 pixels. A whole film is not run by mistake.');
 const sum=new Float64Array(n*4),depth=new Float32Array(n*2),normal=new Float32Array(n*3);const records:any[]=[];let unresolved=0,visibilityUnresolved=0,queries=0,precisionLimited=c.limited?n:0;
 const cancel=()=>void geo8Host.cancel();signal.addEventListener('abort',cancel,{once:true});
 try{
 for(let k=0;k<spp;k++)for(let y=0;y<roi.height;y+=16){
 signal.throwIfAborted();const band={...roi,y:roi.y+y,height:Math.min(16,roi.height-y)};
 progress(`Native Common · sample ${k+1}/${spp}, row ${y}/${roi.height}. A cold shader preparation can take a minute.`,(k*roi.height+y)/(spp*roi.height));
 const a=await this.session.render({mode:'G6',layer:'diagnostic',roi:band,samples:1,sampleOffset:k,texture:true,settings:q,continuation:true,signal,qaRayBatchCapacity:qa?.capacity,onGeometry:qa?.onGeometry?(d:any,s:Float32Array)=>qa.onGeometry!({...d,sampleIndex:k},s):undefined,profileStage:doc.appearance==='native-compatibility'?1:0});
 signal.throwIfAborted();const bN=band.width*band.height,ds=new Float32Array(bN*2);let pending=0;
 for(let i=0;i<bN;i++){ds[i*2]=a.depth[i]!;ds[i*2+1]=a.normal[i*3]!;if(a.normal[i*3+1]!==1)pending++;queries+=a.normal[i*3+2]!;}
 unresolved+=pending;
 // Fixed-hit observer and painting are independent of appearance mode: both
 // retain exactly the same geometry, diagnostics and native S5 normals.
 const b=await this.session.colorProbe({roi:band,sampleOffset:k,shadowLight:p.light,softShadow:true},ds);
 signal.throwIfAborted();let rgba:Uint8Array,paintMs=0;
 if(doc.appearance==='native-compatibility'){
 const painted=await geo8Host.paint({roi:band,depth:base64(ds.buffer),diagnostic:base64(a.normal.buffer),state:base64(b.state.buffer),offset:b.offset});signal.throwIfAborted();rgba=unbase64(painted.rgba);paintMs=painted.paintMs;
 }else rgba=a.color;
 for(let i=0;i<bN;i++){
 const j=y*roi.width+i;if(b.state[i*8+7]!>1)visibilityUnresolved++;const ok=a.normal[i*3+1]===1&&b.state[i*8+7]!<=1;
 if(!ok){rgba.set([255,0,255,255],i*4);}
 if(k===0){depth[j*2]=ds[i*2]!;depth[j*2+1]=ds[i*2+1]!;normal.set(b.state.subarray(i*8+4,i*8+7),j*3);}
 for(let h=0;h<4;h++)sum[j*4+h]=sum[j*4+h]!+rgba[i*4+h]!;
 }
 qa?.onConsumed?.({sample:k,band,state:b.state,rgba});
 records.push({sample:k,band,primaryGpuMs:a.gpuMs,observerGpuMs:b.gpuMs,paintMs,compileMs:a.compileMs,observerCompileMs:b.compileMs,passes:a.passes,pending});
 await new Promise(r=>setTimeout(r,0));
 }
 const rgba=Uint8Array.from(sum,v=>Math.round(v/spp));
 const result={rgba,depth,normal,records,roi,samples:spp,unresolved,visibilityUnresolved,precisionLimited,queries,camera:c.camera,appearance:doc.appearance};
 const metadata={...result,rgba:undefined,depth:undefined,normal:undefined};
 const file=await geo8Host.record({metadata,depth:base64(depth.buffer),normal:base64(normal.buffer),png:base64(new Uint8Array(await (await encodePng({width:roi.width,height:roi.height,data:rgba})).arrayBuffer()))});
 this.root.dataset.lastResult=JSON.stringify({...metadata,file});
 this.status.textContent=`${unresolved} unfinished/invalid primary rays; ${visibilityUnresolved} unresolved visibility rays; ${precisionLimited} requested targets below the local DS warning limit. No certified general formula error limit. Native camera and S5; ${queries} primary queries (refinement/normal queries are added).`;
 return result;
 }finally{signal.removeEventListener('abort',cancel);}
 }
}
