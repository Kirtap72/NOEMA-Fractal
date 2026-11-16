import type {Vec3} from './camera';
import {defaultMaterial,packMaterial,readMaterial} from './material';
import type {MaterialSettings} from './material';

export const MAX_PRIMITIVES=32;
export const PRIMITIVE_FLOATS=160;
export type PrimitiveType='sphere'|'box'|'plane';
export interface PlacementAnchor {position:Vec3;normal:Vec3;objectId:string;keepGrounded:boolean;}
/** Rotation is Euler XYZ in degrees (Rz Ry Rx), scale is positive. Local sphere radius/box half extent = 1; plane y=0. */
export interface ScenePrimitive {
 id:string; type:PrimitiveType; enabled:boolean; position:Vec3; rotation:Vec3; scale:Vec3;
 /** Scene assignment inherits the fractal's driven material; custom uses the same material model. Color is linear. */
 material:'scene'|MaterialSettings; color:Vec3;
 placement?:PlacementAnchor;
}
export function defaultPrimitive(type:PrimitiveType,id:string):ScenePrimitive{return {id,type,enabled:true,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],material:defaultMaterial(),color:[.65,.65,.65]};}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function readPrimitives(raw:unknown,errors:string[]):ScenePrimitive[]{
 if(raw===undefined)return [];
 if(!Array.isArray(raw)||raw.length>MAX_PRIMITIVES){errors.push(`primitives must be an array of at most ${MAX_PRIMITIVES} objects`);return [];}
 const ids=new Set<string>();const result:ScenePrimitive[]=[];
 raw.forEach((p,i)=>{
  const at=`primitives[${i}]`,before=errors.length;
  if(!object(p)){errors.push(`${at} must be an object`);return;}
  for(const k of Object.keys(p))if(!['id','type','enabled','position','rotation','scale','material','color','placement'].includes(k))errors.push(`${at}.${k} is unknown`);
  if(p.placement!==undefined){
   const a=p.placement;
   if(!object(a))errors.push(`${at}.placement must be an object`);
   else {
    if(Object.keys(a).some(k=>!['position','normal','objectId','keepGrounded'].includes(k)))errors.push(`${at}.placement has unknown fields`);
    for(const k of ['position','normal'])if(!Array.isArray(a[k])||a[k].length!==3||a[k].some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1e6))errors.push(`${at}.placement.${k} needs three finite values`);
    if(Array.isArray(a.normal)&&Math.abs(Math.hypot(...a.normal)-1)>1e-5)errors.push(`${at}.placement.normal must be unit length`);
    if(typeof a.objectId!=='string'||!/^[-\w]{1,64}$/.test(a.objectId)||typeof a.keepGrounded!=='boolean')errors.push(`${at}.placement needs objectId and keepGrounded`);
   }
  }
  if(typeof p.id!=='string'||!/^[-\w]{1,64}$/.test(p.id)||ids.has(p.id))errors.push(`${at}.id must be a unique stable identifier`);else ids.add(p.id);
  if(!['sphere','box','plane'].includes(p.type as string))errors.push(`${at}.type is unsupported`);
  if(typeof p.enabled!=='boolean')errors.push(`${at}.enabled must be boolean`);
  for(const k of ['position','rotation','scale','color']){
   const v=p[k];if(!Array.isArray(v)||v.length!==3||v.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1e6||(k==='scale'&&n<1e-4)||(k==='color'&&(n<0||n>1))))errors.push(`${at}.${k} needs three finite values within its limits`);
  }
  const material=p.material==='scene'?'scene':readMaterial(p.material,`${at}.material`,errors);
  if(p.material===undefined)errors.push(`${at}.material is required`);
  if(errors.length===before)result.push({...p,material} as unknown as ScenePrimitive);
 });return result;
}
/** Inverse affine rows. Do not normalize the transformed ray: its parameter remains world distance. */
export function primitiveInverse(p:ScenePrimitive):number[][]{
 const [x,y,z]=p.rotation.map(n=>n*Math.PI/180),cx=Math.cos(x!),sx=Math.sin(x!),cy=Math.cos(y!),sy=Math.sin(y!),cz=Math.cos(z!),sz=Math.sin(z!);
 const columns=[[cz*cy,sz*cy,-sy],[cz*sy*sx-sz*cx,sz*sy*sx+cz*cx,cy*sx],[cz*sy*cx+sz*sx,sz*sy*cx-cz*sx,cy*cx]];
 return columns.map((v,i)=>{const r=v.map(n=>n/p.scale[i]!);return [...r,-dot(r,p.position)];});
}
const dot=(a:readonly number[],b:readonly number[])=>a[0]!*b[0]!+a[1]!*b[1]!+a[2]!*b[2]!;
const norm=(a:number[]):Vec3=>{const l=Math.hypot(...a);return a.map(v=>v/l) as Vec3;};
/** World support point relative to the centre: exact ellipsoid, rotated box, or plane. */
export function primitiveSupport(p:ScenePrimitive,normal:Vec3):Vec3 {
 if(p.type==='plane')return [0,0,0];
 const axes=primitiveInverse(p).map((r,i)=>r.slice(0,3).map(v=>v*p.scale[i]!));
 const local=axes.map(a=>dot(a,normal));
 const length=Math.hypot(...local.map((n,i)=>n*p.scale[i]!));
 const weights=local.map((n,i)=>p.type==='sphere'?n*p.scale[i]!**2/length:Math.abs(n)<1e-8?0:Math.sign(n)*p.scale[i]!);
 return [0,1,2].map(k=>axes.reduce((sum,a,i)=>sum+a[k]!*weights[i]!,0)) as Vec3;
}
export function groundPrimitive(p:ScenePrimitive):ScenePrimitive {
 if(!p.placement?.keepGrounded)return p;
 const support=primitiveSupport(p,p.placement.normal);
 return {...p,position:p.placement.position.map((v,i)=>v+support[i]!) as Vec3};
}
/** Manual translation carries the anchor; scale/rotation recompute contact only when requested. */
export function transformPrimitive(p:ScenePrimitive,patch:Partial<Pick<ScenePrimitive,'position'|'rotation'|'scale'>>):ScenePrimitive {
 let next={...p,...patch};
 if(p.placement&&patch.position)next={...next,placement:{...p.placement,position:p.placement.position.map((v,i)=>v+patch.position![i]!-p.position[i]!) as Vec3}};
 return groundPrimitive(next);
}
export function placePrimitive(p:ScenePrimitive,hit:Pick<SceneHit,'position'|'normal'|'objectId'>,alignPlane=true):ScenePrimitive {
 const normal=norm([...hit.normal]);
 const rotation=p.type==='plane'&&alignPlane?[Math.asin(Math.max(-1,Math.min(1,normal[2])))*180/Math.PI,0,Math.atan2(-normal[0],normal[1])*180/Math.PI] as Vec3:p.rotation;
 return groundPrimitive({...p,rotation,placement:{position:[...hit.position],normal,objectId:hit.objectId,keepGrounded:true}});
}
export interface SceneHit {hit:boolean;distance:number;position:Vec3;normal:Vec3;objectType:'fractal'|PrimitiveType;objectId:string;materialId:string;}
export function intersectPrimitive(p:ScenePrimitive,origin:Vec3,dir:Vec3,min=0,max=Infinity):SceneHit|null{
 if(!p.enabled)return null;
 const rows=primitiveInverse(p),o=rows.map(r=>dot(r,origin)+r[3]!),d=rows.map(r=>dot(r,dir));
 let roots:number[]=[];
 if(p.type==='sphere'){
  const a=dot(d,d),b=dot(o,d),c=dot(o,o)-1,disc=b*b-a*c;
  if(disc<0||a===0)return null;const s=Math.sqrt(disc),q=-b-(b>=0?s:-s);
  roots=q===0?[-b/a]:[q/a,c/q].sort((a,b)=>a-b);
 }else if(p.type==='plane'){
  if(Math.abs(d[1]!)<1e-12)return null;roots=[-o[1]!/d[1]!];
 }else{
  let lo=-Infinity,hi=Infinity;
  for(let k=0;k<3;k++){if(Math.abs(d[k]!)<1e-12){if(Math.abs(o[k]!)>1)return null;continue;}
   const a=(-1-o[k]!)/d[k]!,b=(1-o[k]!)/d[k]!;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}
  if(lo>hi)return null;roots=[lo,hi];
 }
 const t=roots.find(t=>Number.isFinite(t)&&t>=Math.max(min,1e-7)&&t<=max);if(t===undefined)return null;
 const local=o.map((v,k)=>v+d[k]!*t);let n:number[];
 if(p.type==='sphere')n=local;else if(p.type==='plane')n=[0,1,0];else{const k=local.reduce((best,v,i)=>Math.abs(v)>Math.abs(local[best]!)?i:best,0);n=[0,0,0];n[k]=Math.sign(local[k]!);}
 const normal=norm([0,1,2].map(k=>rows.reduce((sum,r,i)=>sum+r[k]!*n[i]!,0)));
 return {hit:true,distance:t,position:origin.map((v,k)=>v+dir[k]!*t) as Vec3,normal,objectType:p.type,objectId:p.id,materialId:p.material==='scene'?'scene':p.id};
}
/** Shared nearest-surface ordering; an optional fractal query keeps the analytical layer independent of formula math. */
export function queryScene(primitives:readonly ScenePrimitive[],origin:Vec3,dir:Vec3,max:number,fractal?:(far:number)=>SceneHit|null):SceneHit|null{
 let nearest:SceneHit|null=null;for(const p of primitives){const h=intersectPrimitive(p,origin,dir,0,nearest?.distance??max);if(h&&(!nearest||h.distance<nearest.distance))nearest=h;}
 const f=fractal?.(nearest?.distance??max);return f&&f.distance<=(nearest?.distance??max)?f:nearest;
}
/** Fixed bounded descriptor storage. IDs in GPU hits are stable indices resolved through the scene's ID table. */
export function packPrimitives(primitives:readonly ScenePrimitive[]):Float32Array{
 const out=new Float32Array(4+MAX_PRIMITIVES*PRIMITIVE_FLOATS);out[0]=primitives.length;
 primitives.forEach((p,i)=>{const offset=4+i*PRIMITIVE_FLOATS;primitiveInverse(p).forEach((r,k)=>out.set(r,offset+k*4));out.set([p.enabled?1:0,['sphere','box','plane'].indexOf(p.type)+1,i+1,p.material==='scene'?0:i+1],offset+12);out.set([...p.color,Math.min(...p.scale)],offset+16);out.set(packMaterial(p.material==='scene'?defaultMaterial():p.material,0),offset+20);});return out;
}
