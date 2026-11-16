import {validAppearanceValue,appearanceBindings,readAppearanceTarget,appearanceType,setAppearanceValue,colorToLinear,linearToColor} from './appearanceAnimation';
import type {AppearanceTarget} from './appearanceAnimation';
import {synthesizedLibrary,SYNTHESIS_PREFIX} from './synthesizedFormula';
import type {Scene} from './scene';
import type {Formula} from './formula/types';
import type {Vec3} from './camera';
import type {CameraFlight,PropertyTrackContract} from './cameraFlight';
import {MIN_KEY_GAP,MAX_CAMERA_KEYS} from './cameraFlight';
import {validAnimationId} from './animationIdentity';

export type FormulaAnimationTarget=
 | {kind:'formula-parameter';contentId:string;stepId:string;formulaId:string;parameter:string}
 | {kind:'julia';contentId:string;property:'c'|'x'|'y'|'z'|'enabled'};
export type MathematicalTarget=FormulaAnimationTarget|AppearanceTarget;
export type MathematicalValue=number|Vec3|boolean|string;
export interface PropertyKey {id:string;time_seconds:number;value:MathematicalValue}
export interface MathematicalTrack extends PropertyTrackContract<MathematicalValue> {
 id:string;kind:'property';enabled:boolean;target:MathematicalTarget;valueType:'float'|'vector'|'step'|'color';
 interpolation:'linear'|'smooth'|'step';keyframes:PropertyKey[];
}
export interface PropertyBinding {target:MathematicalTarget;label:string;valueType:MathematicalTrack['valueType'];min:number;max:number;value:MathematicalValue}
export const propertyTracks=(clip?:CameraFlight):MathematicalTrack[]=>clip?.tracks.slice(1) as MathematicalTrack[]??[];
export const targetKey=(target:MathematicalTarget)=>JSON.stringify(target.kind==='formula-parameter'?[target.kind,target.contentId,target.stepId,target.formulaId,target.parameter]:target.kind==='julia'?[target.kind,target.contentId,target.property]:target.kind==='material'||target.kind==='light'?[target.kind,target.objectId,target.property]:target.kind==='gradient-stop'?[target.kind,target.stopId,target.property]:[target.kind,target.property]);
const overlapping=(a:MathematicalTarget,b:MathematicalTarget)=>targetKey(a)===targetKey(b)||(a.kind==='julia'&&b.kind==='julia'&&a.contentId===b.contentId&&a.property!=='enabled'&&b.property!=='enabled'&&(a.property==='c'||b.property==='c'));
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const keysOnly=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).every(k=>keys.includes(k));

/** Structural reader: the formula library additionally checks actual metadata at load/resolve time. */
export function readMathematicalTracks(raw:unknown,duration:number,errors:string[]):MathematicalTrack[] {
 if(!Array.isArray(raw)||raw.length>32){errors.push('Property tracks must be an array, at most 32');return [];}
 const result:MathematicalTrack[]=[],ids=new Set(['camera']);
 for(const item of raw){
  const before=errors.length;
  if(!object(item)||!keysOnly(item,['id','kind','enabled','target','valueType','interpolation','keyframes'])){errors.push('Invalid mathematical track fields');continue;}
  if(!validAnimationId(item.id)||ids.has(String(item.id)))errors.push('Track IDs must be unique');ids.add(String(item.id));
  const t=item.target;
  const appearance=readAppearanceTarget(t);
  if(!appearance&&(!object(t)||!validAnimationId(t.contentId)||!(t.kind==='formula-parameter'&&keysOnly(t,['kind','contentId','stepId','formulaId','parameter'])&&validAnimationId(t.stepId)&&typeof t.formulaId==='string'&&typeof t.parameter==='string'&&/^[a-zA-Z_][\w]*$/.test(t.parameter)||t.kind==='julia'&&keysOnly(t,['kind','contentId','property'])&&['c','x','y','z','enabled'].includes(String(t.property))))){errors.push('Unsupported typed animation target');continue;}
  const target=t as unknown as MathematicalTarget;
  const expected=appearance?appearanceType(appearance):target.kind==='julia'?(target.property==='c'?'vector':target.property==='enabled'?'step':'float'):'float';
  if(item.kind!=='property'||typeof item.enabled!=='boolean'||item.valueType!==expected||!['linear','smooth','step'].includes(String(item.interpolation))||expected==='step'&&item.interpolation!=='step')errors.push('Invalid track type or interpolation');
  if(!Array.isArray(item.keyframes)||item.keyframes.length>MAX_CAMERA_KEYS){errors.push('At most 64 parameter keys');continue;}
  let last=-Infinity;const keyIds=new Set<string>();
  for(const k of item.keyframes){
   if(!object(k)||!keysOnly(k,['id','time_seconds','value'])){errors.push('Invalid parameter key');continue;}
   if(!validAnimationId(k.id)||keyIds.has(String(k.id)))errors.push('Parameter key IDs must be unique');keyIds.add(String(k.id));
   if(!finite(k.time_seconds)||k.time_seconds<0||k.time_seconds>duration||k.time_seconds-last<MIN_KEY_GAP-1e-10)errors.push('Parameter key time must be ordered and inside clip');last=Number(k.time_seconds);
   if(!(expected==='float'?finite(k.value):expected==='step'?typeof k.value==='boolean':expected==='color'&&typeof k.value==='string'?/^#[0-9a-fA-F]{6}$/.test(k.value):Array.isArray(k.value)&&k.value.length===3&&k.value.every(finite)))errors.push('Invalid finite typed parameter value');
   if(appearance&&!validAppearanceValue(appearance,k.value as MathematicalValue))errors.push('Appearance key outside typed limits');
   if(target.kind==='julia'&&expected!=='step'&&(Array.isArray(k.value)?k.value:[k.value]).some(v=>!finite(v)||Math.abs(v)>1000))errors.push('Julia values must be between -1000 and 1000');
  }
  const track=item as unknown as MathematicalTrack;
  if(result.some(p=>overlapping(p.target,track.target)))errors.push('Duplicate/overlapping mathematical bindings are not allowed, including muted tracks');
  if(before===errors.length)result.push(structuredClone(track));
 }
 return result;
}

/** Uniform-backed appearance plus expression parameters/Julia share the existing 10B contract. */
export function availableBindings(scene:Scene,formulas:readonly Formula[]):PropertyBinding[] {
 formulas=synthesizedLibrary(scene.discoveredFormulas,formulas);
 const c=scene.content[0];const out:PropertyBinding[]=appearanceBindings(scene);if(!c?.id)return out;
 c.chain.forEach((s,i)=>{const f=formulas.find(f=>f.id===s.formula);if(!s.id||!f||f.kernel)return;
  for(const p of f.parameters)out.push({target:{kind:'formula-parameter',contentId:c.id!,stepId:s.id,formulaId:f.id,parameter:p.name},label:`Formula ${i+1} · ${f.name} · ${p.label??p.name}`,valueType:'float',min:p.min,max:p.max,value:s.parameters[p.name]??p.default});
 });
 // Julia is a scene uniform; kernels may use their own C semantics, which are outside this supported subset.
 if(c.chain.every(s=>!s.formula.startsWith(SYNTHESIS_PREFIX)&&!formulas.find(f=>f.id===s.formula)?.kernel)){
  const j=c.julia??{enabled:false,c:[0,0,0] as Vec3};
  for(const property of ['enabled','c','x','y','z'] as const)out.push({target:{kind:'julia',contentId:c.id,property},label:'Julia · '+({enabled:'Active (hold)',c:'XYZ',x:'X',y:'Y',z:'Z'}[property]),valueType:property==='enabled'?'step':property==='c'?'vector':'float',min:-1000,max:1000,value:property==='enabled'?j.enabled:property==='c'?structuredClone(j.c):j.c[{x:0,y:1,z:2}[property]]!});
 }
 return out;
}
export function bindingFor(scene:Scene,formulas:readonly Formula[],target:MathematicalTarget){return availableBindings(scene,formulas).find(b=>targetKey(b.target)===targetKey(target));}
export function validBindingValue(binding:PropertyBinding,value:MathematicalValue):boolean {
 if(binding.valueType==='color'){if(typeof binding.value==='string')return typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value);if(!Array.isArray(value)||value.length!==3)return false;}
 if(binding.target.kind==='light'&&binding.target.property==='direction'&&(!Array.isArray(value)||Math.hypot(...value)<1e-9))return false;
 if(binding.valueType==='step')return typeof value==='boolean';
 if(binding.valueType==='float'&&typeof value!=='number')return false;
 if(binding.valueType==='vector'&&(!Array.isArray(value)||value.length!==3))return false;
 return (Array.isArray(value)?value:[value]).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=binding.min&&v<=binding.max);
}
export function mathematicalTrackDiagnostics(scene:Scene,formulas:readonly Formula[]){
 const errors:string[]=[],warnings:string[]=[];
 for(const track of propertyTracks(scene.cameraFlight)){
  const b=bindingFor(scene,formulas,track.target);
  if(!b){warnings.push(`The track ${track.id} is unresolved: the instance/parameter is missing or not supported. No rebinding is made.`);continue;}
  if(track.valueType!==b.valueType||track.keyframes.some(k=>!validBindingValue(b,k.value)))errors.push(`The track ${track.id}: the value is outside the allowed type/range of ${b.label}.`);
 }
 return {errors,warnings};
}
export function setMathematicalValue(scene:Scene,target:MathematicalTarget,value:MathematicalValue):Scene {
 if(target.kind!=='formula-parameter'&&target.kind!=='julia')return setAppearanceValue(scene,target,value);
 return {...scene,content:scene.content.map(c=>c.id!==target.contentId?c:target.kind==='formula-parameter'?{...c,chain:c.chain.map(s=>s.id===target.stepId&&s.formula===target.formulaId?{...s,parameters:{...s.parameters,[target.parameter]:value as number}}:s)}:{...c,julia:(()=>{const j=structuredClone(c.julia??{enabled:false,c:[0,0,0] as Vec3});if(target.property==='enabled')j.enabled=value as boolean;else if(target.property==='c')j.c=structuredClone(value as Vec3);else j.c[{x:0,y:1,z:2}[target.property]]=value as number;return j;})()})};
}

/** Time-aware bounded Hermite, same harmonic tangent rule as the 10A camera path (Fritsch/Butland). */
export function evaluatePropertyAtTime(track:MathematicalTrack,t:number):MathematicalValue|undefined {
 const keys=track.keyframes;if(!keys.length||!track.enabled)return;const time=Number.isFinite(t)?t:0;
 const exact=keys.find(k=>Math.abs(k.time_seconds-time)<1e-10)??(time<=keys[0]!.time_seconds?keys[0]:time>=keys.at(-1)!.time_seconds?keys.at(-1):undefined);if(exact)return structuredClone(exact.value);
 const i=keys.findIndex((k,j)=>j<keys.length-1&&k.time_seconds<time&&keys[j+1]!.time_seconds>time),a=keys[i]!,b=keys[i+1]!;
 if(track.interpolation==='step')return structuredClone(a.value);
 if(track.valueType==='color'&&typeof a.value==='string'){
  const linear={...track,valueType:'vector' as const,keyframes:keys.map(k=>({...k,value:colorToLinear(k.value as string)}))};
  return linearToColor(evaluatePropertyAtTime(linear,time) as Vec3);
 }
 const h=b.time_seconds-a.time_seconds,u=(time-a.time_seconds)/h;
 const component=(v:MathematicalValue,k:number)=>Array.isArray(v)?v[k]!:v as number;
 const tangent=(j:number,k:number)=>{if(j===0||j===keys.length-1)return 0;const p=keys[j-1]!,q=keys[j]!,r=keys[j+1]!,h0=q.time_seconds-p.time_seconds,h1=r.time_seconds-q.time_seconds,d0=(component(q.value,k)-component(p.value,k))/h0,d1=(component(r.value,k)-component(q.value,k))/h1;if(d0*d1<=0)return 0;return 3*(h0+h1)/((2*h1+h0)/d0+(h1+2*h0)/d1);};
 const sample=(k:number)=>{const av=component(a.value,k),bv=component(b.value,k);const v=track.interpolation==='linear'?av+(bv-av)*u:(2*u**3-3*u*u+1)*av+(u**3-2*u*u+u)*h*tangent(i,k)+(-2*u**3+3*u*u)*bv+(u**3-u*u)*h*tangent(i+1,k);return Math.max(Math.min(av,bv),Math.min(Math.max(av,bv),v));};
 const value=Array.isArray(a.value)?[sample(0),sample(1),sample(2)] as Vec3:sample(0);
 // Antipodal direction keys have no defined midpoint: hold the left direction at the singularity.
 return track.target.kind==='light'&&track.target.property==='direction'&&Array.isArray(value)&&Math.hypot(...value)<1e-9?structuredClone(a.value):value;
}
export function evaluateMathematics(base:Scene,t:number,formulas:readonly Formula[],drafts:ReadonlyMap<string,MathematicalValue>=new Map()):Scene {
 if(!base.cameraFlight?.enabled)return base;let out=base;const bindings=new Map(availableBindings(base,formulas).map(b=>[targetKey(b.target),b]));
 for(const track of propertyTracks(base.cameraFlight)){
  const binding=bindings.get(targetKey(track.target));if(!binding||!track.enabled)continue;
  const value=drafts.get(targetKey(track.target))??evaluatePropertyAtTime(track,Math.max(0,Math.min(base.cameraFlight.duration_seconds,t)));
  if(value!==undefined&&validBindingValue(binding,value))out=setMathematicalValue(out,track.target,value);
 }
 return out;
}
export function withMathematicalTrack(clip:CameraFlight,track:MathematicalTrack):CameraFlight {
 const previous=propertyTracks(clip),tracks=previous.some(t=>t.id===track.id)?previous.map(t=>t.id===track.id?track:t):[...previous,track];const errors:string[]=[];readMathematicalTracks(tracks,clip.duration_seconds,errors);if(errors.length)throw Error(errors.join('; '));
 return {...clip,version:tracks.some(t=>t.target.kind!=='formula-parameter'&&t.target.kind!=='julia')?3:Math.max(2,clip.version) as 2|3,tracks:[clip.tracks[0],...tracks]};
}
export function putPropertyKey(clip:CameraFlight,trackId:string,key:PropertyKey):CameraFlight {
 const track=propertyTracks(clip).find(t=>t.id===trackId);if(!track)throw Error('The track is missing');
 const keyframes=track.keyframes.filter(k=>k.id!==key.id&&Math.abs(k.time_seconds-key.time_seconds)>=MIN_KEY_GAP).concat(structuredClone(key)).sort((a,b)=>a.time_seconds-b.time_seconds);
 return withMathematicalTrack({...clip,duration_seconds:Math.max(clip.duration_seconds,key.time_seconds)},{...track,keyframes});
}
export function retimePropertyKey(clip:CameraFlight,trackId:string,keyId:string,time:number):CameraFlight {
 const track=propertyTracks(clip).find(t=>t.id===trackId),key=track?.keyframes.find(k=>k.id===keyId);if(!key)return clip;
 const t=Math.round(time*1000)/1000;if(track!.keyframes.some(k=>k.id!==keyId&&Math.abs(k.time_seconds-t)<MIN_KEY_GAP))throw Error('A key already exists at this time.');return putPropertyKey(clip,trackId,{...key,time_seconds:t});
}
