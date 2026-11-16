import {readMathematicalTracks} from './propertyAnimation';
import type {MathematicalTrack,MathematicalTarget} from './propertyAnimation';
import {cameraBasis,readSceneCamera} from './camera';
import type {SceneCamera,Vec3} from './camera';
import {cameraFov,defaultDof,focusDistance,lensFromFov} from './cameraOptics';
import {quaternionFromAxes,rotateByQuaternion} from './cameraPath';
import type {FovAxis} from './renderSetup';

/** All property tracks use the explicit typed whitelist and persistent identities. */
export type AnimationPropertyTarget = MathematicalTarget;
export interface PropertyTrackContract<T extends number|Vec3|string|boolean> {
 id:string;kind:'property';enabled:boolean;target:AnimationPropertyTarget;valueType:'float'|'vector'|'color'|'step';
 interpolation:'linear'|'smooth'|'step';keyframes:{id:string;time_seconds:number;value:T}[];
}
export interface CameraView {camera:SceneCamera;fov_axis:FovAxis}
export interface CameraFlightKey extends CameraView {id:string;time_seconds:number}
export interface CameraFlight {
 version:1|2|3;enabled:boolean;duration_seconds:number;fps:number;loop:boolean;
 tracks:[{id:'camera';kind:'camera';enabled?:boolean;target:{kind:'scene-camera'};interpolation:'linear'|'smooth';keyframes:CameraFlightKey[]},...MathematicalTrack[]];
}
export const MAX_CAMERA_KEYS=64,MAX_FLIGHT_SECONDS=Math.floor(Number.MAX_SAFE_INTEGER/4096),MIN_KEY_GAP=.001;
export const defaultCameraFlight=():CameraFlight=>({version:1,enabled:true,duration_seconds:10,fps:30,loop:false,tracks:[{id:'camera',kind:'camera',target:{kind:'scene-camera'},interpolation:'smooth',keyframes:[]}]});
export const cameraKeys=(clip:CameraFlight)=>clip.tracks[0].keyframes;
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
function onlyKeys(x:Record<string,unknown>,allowed:string[],where:string,errors:string[]){for(const k of Object.keys(x))if(!allowed.includes(k))errors.push(where+'.'+k+' is unsupported');}
function readCameraV1(raw:unknown,where:string,errors:string[]):CameraFlight|undefined {
 const before=errors.length;if(!obj(raw)){errors.push(where+' must be a camera-flight clip');return;}
 onlyKeys(raw,['version','enabled','duration_seconds','fps','loop','tracks'],where,errors);
 if(raw.version!==1||typeof raw.enabled!=='boolean'||typeof raw.loop!=='boolean')errors.push(where+' requires version 1, enabled and loop');
 if(!finite(raw.duration_seconds)||raw.duration_seconds<.1||raw.duration_seconds>MAX_FLIGHT_SECONDS)errors.push(where+'.duration_seconds exceeds safe time/frame arithmetic');
 if(!Number.isInteger(raw.fps)||Number(raw.fps)<1||Number(raw.fps)>120)errors.push(where+'.fps must be an integer 1–120');
 const track=Array.isArray(raw.tracks)&&raw.tracks.length===1?raw.tracks[0]:undefined;
 if(!obj(track)||track.kind!=='camera'||track.id!=='camera'||!obj(track.target)||track.target.kind!=='scene-camera'){errors.push(where+'.tracks: only the scene-camera track is supported in Phase 10A');return;}
 onlyKeys(track,['id','kind','target','interpolation','keyframes'],where+'.tracks[0]',errors);onlyKeys(track.target,['kind'],where+'.target',errors);
 if(!['linear','smooth'].includes(String(track.interpolation)))errors.push(where+'.interpolation is invalid');
 if(!Array.isArray(track.keyframes)||track.keyframes.length>MAX_CAMERA_KEYS){errors.push(where+'.keyframes must contain at most 64 keys');return;}
 const ids=new Set<string>();let last=-Infinity,projection:string|undefined;const keys:CameraFlightKey[]=[];
 track.keyframes.forEach((key:unknown,i:number)=>{
  const w=where+'.keyframes['+i+']';if(!obj(key)){errors.push(w+' is invalid');return;}onlyKeys(key,['id','time_seconds','camera','fov_axis'],w,errors);
  if(typeof key.id!=='string'||!/^[-\w]{1,64}$/.test(key.id)||ids.has(key.id))errors.push(w+'.id must be unique');ids.add(String(key.id));
  if(!finite(key.time_seconds)||key.time_seconds<0||key.time_seconds>Number(raw.duration_seconds)||key.time_seconds-last<MIN_KEY_GAP-1e-10)errors.push(w+'.time_seconds must be ordered, within the clip, and at least .001 seconds apart');last=Number(key.time_seconds);
  const camera=readSceneCamera(key.camera,w+'.camera',errors);if(key.fov_axis!=='horizontal'&&key.fov_axis!=='vertical')errors.push(w+'.fov_axis is invalid');
  if(camera){if(![...cameraBasis(camera).forward,...cameraBasis(camera).up].every(Number.isFinite))errors.push(w+': camera axes must be finite');const p=camera.projection??'perspective';if(projection&&projection!==p)errors.push(w+': mixed perspective/orthographic projection is unsupported');projection=p;keys.push({id:String(key.id),time_seconds:Number(key.time_seconds),camera,fov_axis:key.fov_axis as FovAxis});}
 });
 if(errors.length!==before)return;
 return {version:1,enabled:raw.enabled as boolean,loop:raw.loop as boolean,duration_seconds:raw.duration_seconds as number,fps:raw.fps as number,tracks:[{id:'camera',kind:'camera',target:{kind:'scene-camera'},interpolation:track.interpolation as 'linear'|'smooth',keyframes:keys}]};
}
/** V2 adds mathematics; V3 adds appearance. An absent camera becomes an empty muted track. */
export function readCameraFlight(raw:unknown,where:string,errors:string[]):CameraFlight|undefined {
 if(!obj(raw)||(raw.version!==2&&raw.version!==3))return readCameraV1(raw,where,errors);
 const before=errors.length;
 if(!Array.isArray(raw.tracks)){errors.push(where+'.tracks must be an array');return;}
 const cameras=raw.tracks.filter(t=>obj(t)&&t.kind==='camera');
 if(cameras.length>1)errors.push('Only one camera track is allowed');
 const camera=cameras[0]??{...defaultCameraFlight().tracks[0],enabled:false};
 if(!obj(camera)){errors.push('Invalid camera track');return;}
 if(camera.enabled!==undefined&&typeof camera.enabled!=='boolean')errors.push('Invalid camera mute flag');
 const {enabled,...legacyCamera}=camera;
 const parsed=readCameraV1({...raw,version:1,tracks:[legacyCamera]},where,errors);
 const properties=readMathematicalTracks(raw.tracks.filter(t=>!obj(t)||t.kind!=='camera'),Number(raw.duration_seconds),errors);
 if(!parsed||errors.length!==before)return;
 if(raw.version===2&&properties.some(t=>t.target.kind!=='formula-parameter'&&t.target.kind!=='julia')){errors.push('Appearance tracks require clip version 3');return;}
 return {...parsed,version:raw.version,tracks:[{...parsed.tracks[0],...(enabled!==undefined?{enabled:enabled as boolean}:{})},...properties]};
}
function checked(clip:CameraFlight):CameraFlight {const errors:string[]=[];const parsed=readCameraFlight(clip,'cameraFlight',errors);if(!parsed)throw Error(errors.join('; '));return parsed;}
export function captureCameraKey(view:CameraView,time:number,id:string):CameraFlightKey {return {...structuredClone(view),id,time_seconds:Math.round(time*1000)/1000};}
export function putCameraKey(clip:CameraFlight,key:CameraFlightKey):CameraFlight {
 const keys=cameraKeys(clip).filter(k=>k.id!==key.id&&Math.abs(k.time_seconds-key.time_seconds)>=MIN_KEY_GAP);
 keys.push(structuredClone(key));keys.sort((a,b)=>a.time_seconds-b.time_seconds);
 return checked({...clip,duration_seconds:Math.max(clip.duration_seconds,key.time_seconds),tracks:[{...clip.tracks[0],keyframes:keys},...clip.tracks.slice(1) as MathematicalTrack[]]});
}
/** Retime preserves identity and never silently replaces another key. */
export function retimeCameraKey(clip:CameraFlight,id:string,time:number):CameraFlight {
 const key=cameraKeys(clip).find(k=>k.id===id);if(!key)return clip;
 const t=Math.round(time*1000)/1000;if(cameraKeys(clip).some(k=>k.id!==id&&Math.abs(k.time_seconds-t)<MIN_KEY_GAP))throw Error('A camera key already exists at this time. Choose another time.');
 return putCameraKey(clip,{...key,time_seconds:t});
}
/** Travel time moves this key and its successors together; earlier segment durations stay intact. */
export function setCameraSegmentSeconds(clip:CameraFlight,id:string,seconds:number):CameraFlight {
 const keys=cameraKeys(clip),i=keys.findIndex(k=>k.id===id);if(i<1)return clip;
 if(!Number.isFinite(seconds)||seconds<MIN_KEY_GAP)throw Error('The travel time must be at least 0.001 second.');
 const shift=keys[i-1]!.time_seconds+seconds-keys[i]!.time_seconds;
 return checked({...clip,duration_seconds:Math.max(.1,clip.duration_seconds+shift,...clip.tracks.slice(1).flatMap(t=>t.keyframes.map(k=>k.time_seconds))),tracks:[{...clip.tracks[0],keyframes:keys.map((k,j)=>j<i?k:{...k,time_seconds:Math.round((k.time_seconds+shift)*1000)/1000})},...clip.tracks.slice(1) as MathematicalTrack[]]});
}
export function deleteCameraKey(clip:CameraFlight,id:string):CameraFlight {return {...clip,tracks:[{...clip.tracks[0],keyframes:cameraKeys(clip).filter(k=>k.id!==id)},...clip.tracks.slice(1) as MathematicalTrack[]]};}
export function changeCameraFlight(clip:CameraFlight,changes:Partial<Pick<CameraFlight,'fps'|'enabled'|'duration_seconds'|'loop'>>):CameraFlight {const duration=Math.max(changes.duration_seconds??clip.duration_seconds,...clip.tracks.flatMap(t=>t.keyframes.map(k=>k.time_seconds)));return checked({...clip,...changes,duration_seconds:duration});}
export const frameToSeconds=(frame:number,fps:number)=>{if(!Number.isSafeInteger(frame)||frame<0||!Number.isInteger(fps)||fps<1||fps>120)throw Error('Unsafe frame/time arithmetic');return frame/fps;};
export const secondsToFrame=(seconds:number,fps:number)=>{const frame=Math.round(seconds*fps);if(!Number.isFinite(seconds)||seconds<0||!Number.isInteger(fps)||fps<1||fps>120||!Number.isSafeInteger(frame))throw Error('Unsafe time/frame arithmetic');return frame;};
export function flightTimecode(seconds:number,fps:number):string {let f=secondsToFrame(seconds,fps);const ff=f%fps;f=Math.floor(f/fps);return [Math.floor(f/3600),Math.floor(f/60)%60,f%60,ff].map(v=>String(v).padStart(2,'0')).join(':');}
type Quaternion=[number,number,number,number];
const normalize=(q:readonly number[]):Quaternion=>{const n=Math.hypot(...q);if(!n)throw Error('Invalid quaternion');return q.map(v=>v/n) as Quaternion;};
/** Shortest-arc spherical interpolation; own implementation. Shoemake 1985, DOI 10.1145/325165.325242. */
export function slerpCameraQuaternion(a:readonly number[],b:readonly number[],u:number):Quaternion {
 const p=normalize(a);let q=normalize(b),d=p.reduce((s,v,i)=>s+v*q[i]!,0);if(d<0){q=q.map(v=>-v) as Quaternion;d=-d;}
 d=Math.min(1,Math.max(-1,d));if(d>.9995)return normalize(p.map((v,i)=>v+(q[i]!-v)*u));
 const angle=Math.acos(d),den=Math.sin(angle);return normalize(p.map((v,i)=>(v*Math.sin((1-u)*angle)+q[i]!*Math.sin(u*angle))/den));
}
const rotation=(c:SceneCamera)=>{const b=cameraBasis(c);return quaternionFromAxes(b.right,b.up,b.forward.map(v=>-v) as Vec3);};
const lerp=(a:number,b:number,u:number)=>a+(b-a)*u;
/** Shared authored up means a level horizon. Fade the bank correction near its pole, where
 * horizon projection is singular; the quaternion frame remains continuous through the pole.
 */
function horizonUp(a:SceneCamera,b:SceneCamera,forward:Vec3,up:Vec3):Vec3 {
 const unit=(v:Vec3)=>v.map(x=>x/Math.hypot(...v)) as Vec3,p=unit(a.up),r=unit(b.up);
 if(p.some((x,k)=>Math.abs(x-r[k]!)>1e-6))return up;
 const d=p.reduce((s,x,k)=>s+x*forward[k]!,0),amount=Math.max(0,Math.min(1,(.99-Math.abs(d))/.04));if(amount===0)return up;
 const h=unit(p.map((x,k)=>x-forward[k]!*d) as Vec3),cross:Vec3=[up[1]*h[2]-up[2]*h[1],up[2]*h[0]-up[0]*h[2],up[0]*h[1]-up[1]*h[0]];
 const angle=Math.atan2(cross.reduce((s,x,k)=>s+x*forward[k]!,0),up.reduce((s,x,k)=>s+x*h[k]!,0))*(amount*amount*(3-2*amount));
 return rotateByQuaternion([...forward.map(x=>x*Math.sin(angle/2)),Math.cos(angle/2)],up);
}
/** Time-aware bounded shared Hermite tangents. Weighted harmonic mean follows Fritsch/Butland 1984,
 * DOI 10.1137/0905021. Endpoint tangents are zero; no component overshoots a segment's endpoints.
 */
function tangent(keys:CameraFlightKey[],i:number,axis:number):number {
 if(i===0||i===keys.length-1)return 0;
 const a=keys[i-1]!,b=keys[i]!,c=keys[i+1]!,h0=b.time_seconds-a.time_seconds,h1=c.time_seconds-b.time_seconds;
 const d0=(b.camera.position[axis]!-a.camera.position[axis]!)/h0,d1=(c.camera.position[axis]!-b.camera.position[axis]!)/h1;
 if(d0*d1<=0)return 0;const w0=2*h1+h0,w1=h1+2*h0;return (w0+w1)/(w0/d0+w1/d1);
}
export function evaluateCameraAtTime(clip:CameraFlight,t:number,aspect=16/9):CameraView|undefined {
 const keys=cameraKeys(clip);if(!keys.length||!clip.enabled||clip.tracks[0].enabled===false)return;
 const time=Math.min(clip.duration_seconds,Math.max(0,Number.isFinite(t)?t:0));
 const exact=keys.find(k=>Math.abs(k.time_seconds-time)<1e-10)??(time<keys[0]!.time_seconds?keys[0]:time>keys.at(-1)!.time_seconds?keys.at(-1):undefined);
 if(exact)return {camera:structuredClone(exact.camera),fov_axis:exact.fov_axis};
 let i=0;while(keys[i+1]!.time_seconds<time)i++;
 const a=keys[i]!,b=keys[i+1]!,h=b.time_seconds-a.time_seconds,u=(time-a.time_seconds)/h,smooth=clip.tracks[0].interpolation==='smooth',v=smooth?u*u*(3-2*u):u;
 const position=a.camera.position.map((x,k)=>smooth?(2*u**3-3*u*u+1)*x+(u**3-2*u*u+u)*h*tangent(keys,i,k)+(-2*u**3+3*u*u)*b.camera.position[k]!+(u**3-u*u)*h*tangent(keys,i+1,k):lerp(x,b.camera.position[k]!,u)) as Vec3;
 const q=slerpCameraQuaternion(rotation(a.camera),rotation(b.camera),v),forward=rotateByQuaternion(q,[0,0,-1]),up=horizonUp(a.camera,b.camera,forward,rotateByQuaternion(q,[0,1,0]));
 const distance=Math.max(lerp(Math.hypot(...a.camera.target.map((x,k)=>x-a.camera.position[k]!)),Math.hypot(...b.camera.target.map((x,k)=>x-b.camera.position[k]!)),v),Number.EPSILON*Math.max(Number.MIN_VALUE,...position.map(Math.abs))*16);
 const horizontal=(key:CameraFlightKey)=>{const f=cameraFov(key.camera,key.fov_axis,aspect,1);return key.fov_axis==='horizontal'?f:360/Math.PI*Math.atan(Math.tan(f*Math.PI/360)*aspect);};
 let axis=a.fov_axis;const hfov=lerp(horizontal(a),horizontal(b),v),fov=axis==='horizontal'?hfov:360/Math.PI*Math.atan(Math.tan(hfov*Math.PI/360)/aspect);
 const camera:SceneCamera={...structuredClone(a.camera),position,target:position.map((x,k)=>x+forward[k]!*distance) as Vec3,up,fov_degrees:fov};
 if(a.camera.lens&&b.camera.lens)camera.lens={focal_length_mm:lerp(a.camera.lens.focal_length_mm,b.camera.lens.focal_length_mm,v),sensor_width_mm:lerp(a.camera.lens.sensor_width_mm,b.camera.lens.sensor_width_mm,v)};
 else if(a.camera.lens||b.camera.lens||a.fov_axis!==b.fov_axis){
  const ratio=2*Math.tan(hfov*Math.PI/360),focal=Math.max(1,Math.min(2000,lensFromFov(hfov,36))),sensor=focal*ratio;
  if(sensor>=1-1e-10&&sensor<=200+1e-10)camera.lens={sensor_width_mm:Math.max(1,Math.min(200,sensor)),focal_length_mm:focal};
  else{delete camera.lens;axis='vertical';camera.fov_degrees=360/Math.PI*Math.atan(Math.tan(hfov*Math.PI/360)/aspect);}
 }
 // Legacy numeric FOV is bounded by the scene schema, even when a physical lens is authoritative.
 if(camera.lens)camera.fov_degrees=Math.min(120,Math.max(10,camera.fov_degrees));
 if(a.camera.ortho_height!==undefined||b.camera.ortho_height!==undefined)camera.ortho_height=lerp(a.camera.ortho_height??4,b.camera.ortho_height??4,v);
 if(a.camera.dof||b.camera.dof){const ad=a.camera.dof??defaultDof(),bd=b.camera.dof??defaultDof(),target=ad.focus_mode==='target'&&bd.focus_mode==='target';camera.dof={enabled:ad.enabled,focus_mode:target?'target':'manual',focus_distance:target?lerp(ad.focus_distance,bd.focus_distance,v):Math.max(1e-9,lerp(focusDistance(a.camera),focusDistance(b.camera),v)),aperture_radius:lerp(ad.aperture_radius,bd.aperture_radius,v)};}
 return {camera,fov_axis:axis};
}

/** UI-independent preview clock. Seek is random-access; tick skips elapsed frames without a render queue. */
export class CameraFlightClock {
 time=0;playing=false;private last=0;
 seek(time:number,duration:number){this.time=Math.max(0,Math.min(duration,time));}
 play(now:number,duration:number){if(this.time>=duration)this.time=0;this.last=now;this.playing=true;}
 pause(){this.playing=false;}
 stop(){this.pause();this.time=0;}
 tick(now:number,clip:CameraFlight){if(!this.playing)return false;const time=this.time+Math.max(0,now-this.last)/1000;this.last=now;if(time>=clip.duration_seconds){this.time=clip.loop?time%clip.duration_seconds:clip.duration_seconds;this.playing=clip.loop;}else this.time=time;return true;}
}
