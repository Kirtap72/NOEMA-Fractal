import {defaultPrimitive,intersectPrimitive,packPrimitives,MAX_PRIMITIVES,PRIMITIVE_FLOATS} from './primitives';
import type {ScenePrimitive,SceneHit} from './primitives';
import type {Vec3} from './camera';
import {readMaterial,packMaterial} from './material';
import type {MaterialSettings} from './material';

/** Temporary render input, not a scene-schema extension. All inverse rows map source-world rays to a unit shape. */
export interface SecondaryObject {
 id:string; type:'sphere'|'box'|'rectangle'; enabled:boolean; shadow:boolean;
 inverse:number[][]; color:Vec3; material:MaterialSettings;
}
export interface SecondaryGeometry {objects:SecondaryObject[]}
export function validateSecondaryGeometry(input:SecondaryGeometry,native:readonly ScenePrimitive[]=[]):void{
 if(!input||!Array.isArray(input.objects)||input.objects.length+native.length>MAX_PRIMITIVES)throw Error('Secondary geometry exceeds the shared 32-object budget');
 const ids=new Set(native.map(p=>p.id));
 for(const o of input.objects){
  if(!o||!/^[-\w]{1,64}$/.test(o.id)||ids.has(o.id)||!['sphere','box','rectangle'].includes(o.type)||typeof o.enabled!=='boolean'||typeof o.shadow!=='boolean')throw Error('Invalid secondary object identity / visibility');ids.add(o.id);
  if(!Array.isArray(o.inverse)||o.inverse.length!==3||o.inverse.some(r=>!Array.isArray(r)||r.length!==4||r.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6)))throw Error('Invalid secondary affine inverse');
  const [a,b,c]=o.inverse as [number[],number[],number[]];const det=a[0]!*(b[1]!*c[2]!-b[2]!*c[1]!)-a[1]!*(b[0]!*c[2]!-b[2]!*c[0]!)+a[2]!*(b[0]!*c[1]!-b[1]!*c[0]!);
  if(!Number.isFinite(det)||Math.abs(det)<1e-15)throw Error('Singular secondary geometry transform');
  if(!Array.isArray(o.color)||o.color.length!==3||o.color.some(n=>!Number.isFinite(n)||n<0||n>1))throw Error('Invalid secondary linear color');
  const errors:string[]=[];const material=readMaterial(o.material,'secondary material',errors);
  if(!material||errors.length||material.transmission||material.surfaceDetail?.bump.enabled||material.surfaceDetail?.normal.enabled||material.surfaceDetail?.procedural?.enabled)throw Error('Unsupported secondary material: opaque basic material required; '+errors.join('; '));
 }
}
/** Same 160-float object record as native primitives. count.y separates primary-native and secondary-only records. */
export function packSecondaryGeometry(native:readonly ScenePrimitive[],input:SecondaryGeometry):Float32Array{
 validateSecondaryGeometry(input,native);const out=packPrimitives(native);out[0]=native.length+input.objects.length;out[1]=native.length;
 input.objects.forEach((o,i)=>{const index=native.length+i,at=4+index*PRIMITIVE_FLOATS;o.inverse.forEach((r,k)=>out.set(r,at+k*4));
  out.set([o.enabled?(o.shadow?3:2):0,o.type==='sphere'?1:o.type==='box'?2:4,index+1,index+1],at+12);out.set([...o.color,0],at+16);out.set(packMaterial(o.material,0),at+20);
 });return out;
}
/** CPU reference reuses the existing unit-shape intersection. The transformed direction is never normalized. */
export function intersectSecondaryObject(o:SecondaryObject,origin:Vec3,dir:Vec3,near=0,far=Infinity):SceneHit|null{
 if(!o.enabled)return null;
 const dot=(r:number[],v:Vec3)=>r[0]!*v[0]+r[1]!*v[1]+r[2]!*v[2];
 const localOrigin=o.inverse.map(r=>dot(r,origin)+r[3]!) as Vec3,localDir=o.inverse.map(r=>dot(r,dir)) as Vec3;
 const p=defaultPrimitive(o.type==='rectangle'?'plane':o.type,o.id);const h=intersectPrimitive(p,localOrigin,localDir,near,far);
 if(!h||o.type==='rectangle'&&(Math.abs(h.position[0])>1||Math.abs(h.position[2])>1))return null;
 const n=[0,1,2].map(k=>o.inverse.reduce((sum,r,i)=>sum+r[k]!*h.normal[i]!,0)),length=Math.hypot(...n);
 return {...h,position:origin.map((v,k)=>v+dir[k]!*h.distance) as Vec3,normal:n.map(v=>v/length) as Vec3,materialId:o.id};
}
