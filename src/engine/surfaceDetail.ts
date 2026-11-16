import {materialTexturesActive,PBR_CHANNELS,isColorMap} from './materialTextures';
import {defaultProceduralDetail,readProceduralDetail,PROCEDURAL_PATTERNS} from './proceduralDetail';
import type {ProceduralDetailSettings} from './proceduralDetail';
import { readTexture } from './gradient';
import type { MaterialSettings } from './material';
import { defaultMaterial } from './material';
import { texturedEntries } from './materialRamp';
import type { RampStop } from './materialRamp';

export interface SurfaceImage { data:string; name?:string; /** GPU preparation only, never serialized on image resources. */ colorSpace?:'srgb' }
export interface SurfaceMap { enabled:boolean; strength:number; texture?:SurfaceImage }
export interface SurfaceDetailSettings {
  normalFlipY?:boolean;
  procedural?:ProceduralDetailSettings;
  bump:SurfaceMap;
  normal:SurfaceMap;
  mapping:'triplanar'|'analytic';
  /** Repetitions per object unit; normal strength is independent of this frequency. */
  scale:number;
  rotation:number;
  offset:[number,number];
}
export function defaultSurfaceDetail():SurfaceDetailSettings {
  return {bump:{enabled:false,strength:.08},normal:{enabled:false,strength:1},mapping:'triplanar',scale:1,rotation:0,offset:[0,0]};
}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export function readSurfaceDetail(raw:unknown,where:string,errors:string[]):SurfaceDetailSettings|undefined {
  if(!obj(raw)){errors.push(`${where} must be an object`);return;}
  const before=errors.length;const out=defaultSurfaceDetail();
  for(const key of Object.keys(raw))if(!['bump','normal','mapping','scale','rotation','offset','procedural','normalFlipY'].includes(key))errors.push(`${where}.${key} is unknown`);
  for(const key of ['bump','normal'] as const){
    const map=raw[key];if(map===undefined)continue;
    if(!obj(map)){errors.push(`${where}.${key} must be an object`);continue;}
    for(const k of Object.keys(map))if(!['enabled','strength','texture'].includes(k))errors.push(`${where}.${key}.${k} is unknown`);
    if(map.enabled!==undefined){if(typeof map.enabled!=='boolean')errors.push(`${where}.${key}.enabled must be boolean`);else out[key].enabled=map.enabled;}
    if(map.strength!==undefined){if(!finite(map.strength)||map.strength<0||map.strength>4)errors.push(`${where}.${key}.strength must be within 0 to 4`);else out[key].strength=map.strength;}
    if(map.texture!==undefined){
      if(!obj(map.texture)){errors.push(`${where}.${key}.texture must be an image`);continue;}
      for(const k of Object.keys(map.texture))if(!['data','name'].includes(k))errors.push(`${where}.${key}.texture.${k} is unknown`);
      const t=readTexture({...map.texture,mapping:'triplanar',scale:1,strength:1},`${where}.${key}.texture`,errors);
      if(t)out[key].texture={data:t.data,...(t.name===undefined?{}:{name:t.name})};
    }
  }
  if(raw.normalFlipY!==undefined){if(typeof raw.normalFlipY!=='boolean')errors.push(where+'.normalFlipY must be boolean');else out.normalFlipY=raw.normalFlipY;}
  if(raw.mapping!==undefined){if(raw.mapping!=='triplanar'&&raw.mapping!=='analytic')errors.push(`${where}.mapping must be triplanar or analytic`);else out.mapping=raw.mapping;}
  for(const [key,lo,hi] of [['scale',.000001,16777216],['rotation',-36000,36000]] as const){const v=raw[key];if(v!==undefined){if(!finite(v)||v<lo||v>hi)errors.push(`${where}.${key} must be within ${lo} to ${hi}`);else out[key]=v;}}
  if(raw.offset!==undefined){const v=raw.offset;if(!Array.isArray(v)||v.length!==2||v.some(x=>!finite(x)||Math.abs(x)>1e6))errors.push(`${where}.offset needs two finite values within ±1000000`);else out.offset=[v[0] as number,v[1] as number];}
  if(raw.procedural!==undefined){const d=readProceduralDetail(raw.procedural,`${where}.procedural`,errors);if(d)out.procedural=d;}
  return errors.length===before?out:undefined;
}
export function surfaceDetailActive(material:MaterialSettings):boolean {
  const d=material.surfaceDetail;return materialTexturesActive(material)||!!d&&(!!d.procedural?.enabled||(['bump','normal'] as const).some(k=>d[k].enabled&&!!d[k].texture));
}
/**
 * Which surface features change the shading NORMAL (and therefore need a composition rule with Geometry Detail's micro normal).
 * PBR colour-class maps (base colour, roughness, metallic, AO, emission) are not in this list: they sample an image at the hit
 * point and change the shading only.
 */
export function surfaceBlocksGeometry(material:MaterialSettings,kind:'normal-bump'|'procedural'):boolean {
  const d=material.surfaceDetail;if(!d)return false;
  return kind==='procedural'?!!d.procedural?.enabled:(['bump','normal'] as const).some(k=>d[k].enabled&&!!d[k].texture);
}
/** Slot zero is the fractal; primitive slots include inherited materials so mapping remains object-local. */
/**
 * MATERIAL-GRADIENT-02: the textured materials of the colour gradient, as ordinary materials (maps + one texture scale) so that the
 * existing image atlas, record packing and eligibility rules see them. They are appended AFTER the primitives, so no existing slot moves.
 * Slot of entry e = 1 + primitive count + e (see rampTextures.ts, which gives the shader the same number).
 */
export function rampVirtualMaterials(color:{gradient:{stops:readonly RampStop[]}}|undefined):MaterialSettings[]{
  if(!color)return [];
  return texturedEntries(color.gradient.stops).map(e=>({...defaultMaterial(),textures:e.material.textures!,surfaceDetail:{...defaultSurfaceDetail(),scale:e.material.textureScale??1}}));
}
export function surfaceMaterials(scene:{material:MaterialSettings;primitives?:{material?:MaterialSettings|"scene"}[];color?:{gradient:{stops:readonly RampStop[]}}}):MaterialSettings[]{return [scene.material,...(scene.primitives??[]).map(p=>p.material&&p.material!=="scene"?p.material:scene.material),...rampVirtualMaterials(scene.color)];}
/** Surface slots: the fractal, 32 objects, and up to four textured gradient materials. */
export const SURFACE_SLOTS=33+4;
export function surfaceImages(materials:readonly MaterialSettings[]):SurfaceImage[]{
  const images=new Map<string,SurfaceImage>();for(const m of materials){const d=m.surfaceDetail;if(d)for(const k of ['bump','normal'] as const){const t=d[k].texture;if(d[k].enabled&&t)images.set('data:'+t.data,t);}
    for(const k of PBR_CHANNELS){const map=m.textures?.maps[k],t=map?.texture;if(map?.enabled&&map.strength>0&&t)images.set((isColorMap(k)?'srgb:':'data:')+t.data,{...t,...(isColorMap(k)?{colorSpace:'srgb' as const}:{})});}}return [...images.values()];
}
export const SURFACE_RECORD_FLOATS=12;
export function packSurfaceDetails(materials:readonly MaterialSettings[],images:readonly SurfaceImage[],side:number,out=new Float32Array(SURFACE_SLOTS*SURFACE_RECORD_FLOATS)):Float32Array {
  out.fill(0);for(let i=0;i<materials.length;i++){const d=materials[i]!.surfaceDetail??defaultSurfaceDetail();const layer=(k:'bump'|'normal')=>d[k].enabled&&d[k].texture?images.findIndex(t=>!t.colorSpace&&t.data===d[k].texture!.data):-1;out.set([layer('bump'),layer('normal'),d.bump.strength,d.normal.strength,d.scale,d.rotation*Math.PI/180,...d.offset,d.mapping==='analytic'?1:0,side,Math.log2(side),d.normalFlipY?1:0],i*SURFACE_RECORD_FLOATS);}return out;
}

type V3=readonly [number,number,number];
const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const unit=(v:V3):[number,number,number]=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l) as [number,number,number];};
/** Signed right-handed planar charts; green (+V) is the bitangent. */
export function surfaceChart(axis:0|1|2,sign:number):{t:V3;b:V3;n:V3}{const s=sign<0?-1:1;return axis===0?{t:[0,0,-s],b:[0,1,0],n:[s,0,0]}:axis===1?{t:[1,0,0],b:[0,0,-s],n:[0,s,0]}:{t:[s,0,0],b:[0,1,0],n:[0,0,s]};}
export function triplanarWeights(n:V3):[number,number,number]{const w=n.map(x=>Math.abs(x)**4);const sum=w.reduce((a,b)=>a+b,0)||1;return w.map(x=>x/sum) as [number,number,number];}
/** Covector transform: inverse rows map object shading normals back to world space. */
export function transformDetailNormal(n:V3,inverseRows:readonly V3[]):[number,number,number]{return unit([0,1,2].map(k=>inverseRows[0]![k]!*n[0]+inverseRows[1]![k]!*n[1]+inverseRows[2]![k]!*n[2]) as [number,number,number]);}
/** Bound tangent slope, then fade it when it would face away from the incident view. */
export function constrainDetailNormal(candidate:V3,geometric:V3,view:V3,glass=false):[number,number,number]{
  const n=unit(geometric),h=unit(candidate);const d=dot(h,n);let t=h.map((x,k)=>x-n[k]!*d) as [number,number,number];const l=Math.hypot(...t);if(l>0)t=t.map(x=>x/l*Math.min(l/Math.max(.1,d),glass?.176327:1.73205)) as [number,number,number];const nv=Math.max(0,dot(n,view)),tv=dot(t,view);if(tv<0){const w=Math.min(1,nv*.8/(-tv));t=t.map(x=>x*w) as [number,number,number];}return unit(n.map((x,k)=>x+t[k]!) as [number,number,number]);
}

/** Image-only materials keep their Phase-6A stride; procedural shaders use six vec4 records. */
export function packProceduralSurfaceDetails(materials:readonly MaterialSettings[],images:readonly SurfaceImage[],side:number):Float32Array {
  const imageData=packSurfaceDetails(materials,images,side),out=new Float32Array(SURFACE_SLOTS*24);
  materials.forEach((m,i)=>{out.set(imageData.subarray(i*12,i*12+12),i*24);const d=m.surfaceDetail?.procedural??defaultProceduralDetail();out.set([d.enabled?PROCEDURAL_PATTERNS.indexOf(d.pattern)+1:0,d.strength,d.scale,d.octaves,d.lacunarity,d.persistence,d.seed,d.rotation*Math.PI/180,d.anisotropy,d.roughnessModulation,0,0],i*24+12);});return out;
}
export function withProceduralDetail(settings:Partial<ProceduralDetailSettings>){return {...defaultSurfaceDetail(),procedural:{...defaultProceduralDetail(),enabled:true,...settings}};}
