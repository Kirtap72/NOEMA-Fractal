import {defaultSurfaceDetail,surfaceChart,triplanarWeights,readSurfaceDetail} from './surfaceDetail';
import type {SurfaceImage} from './surfaceDetail';
import type {MaterialSettings} from './material';
import type {ScenePrimitive} from './primitives';

/** Object-unit deformation. Independent of shading-only bump/normal maps. */
export interface DisplacementSettings {enabled:boolean;strength:number;heightScale:number;reference:number;texture?:SurfaceImage}
export interface HeightBounds {min:number;max:number;du:number;dv:number}
export const defaultDisplacement=():DisplacementSettings=>({enabled:false,strength:1,heightScale:.1,reference:.5});
export function readDisplacement(raw:unknown,where:string,errors:string[]):DisplacementSettings|undefined{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)){errors.push(where+' must be an object');return;}
 const r=raw as Record<string,unknown>,out=defaultDisplacement(),before=errors.length;
 for(const k of Object.keys(r))if(!['enabled','strength','heightScale','reference','texture'].includes(k))errors.push(where+'.'+k+' is unknown');
 if(r.enabled!==undefined){if(typeof r.enabled!=='boolean')errors.push(where+'.enabled must be boolean');else out.enabled=r.enabled;}
 for(const [key,hi] of [['strength',1],['heightScale',.25],['reference',1]] as const){const v=r[key];if(v===undefined)continue;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>hi)errors.push(`${where}.${key} must be finite within 0 to ${hi}`);else out[key]=v;}
 if(r.texture!==undefined){const d=readSurfaceDetail({bump:{texture:r.texture}},where,errors);if(d?.bump.texture)out.texture=d.bump.texture;}
 return errors.length===before?out:undefined;
}
export function displacementRequested(m:MaterialSettings):boolean {const d=m.displacement;return !!d?.enabled&&d.strength>0&&d.heightScale>0&&!!d.texture;}
export function displacementUnsupported(m:MaterialSettings,target:string):string|undefined{
 if(target!=='sphere'&&target!=='plane')return 'Geometric displacement is only supported on own spheres and planes, not on fractals, boxes or bridge objects.';
 if((m.transmission??0)>0)return 'Displacement is not yet supported with transmission/glass. The settings are preserved but the geometry is not activated.';
 const d=m.surfaceDetail??defaultSurfaceDetail();
 if(target==='sphere'&&d.mapping==='analytic')return 'Displacement of the sphere requires triplanar mapping; spherical UV seams are not yet supported.';
 if(d.scale>32)return 'Displacement supports at most 32 map repeats per object unit in this phase.';
 return;
}
type GeometryScene={material:MaterialSettings;primitives?:ScenePrimitive[]};
export function displacementActive(scene:GeometryScene):boolean{return !!scene.primitives?.some(p=>p.enabled&&displacementRequested(p.material==='scene'?scene.material:p.material)&&!displacementUnsupported(p.material==='scene'?scene.material:p.material,p.type));}
export function withDisplacementImages(scene:GeometryScene,images:SurfaceImage[]):SurfaceImage[]{
 const out=[...images];for(const p of scene.primitives??[]){const m=p.material==='scene'?scene.material:p.material,t=m.displacement?.texture;if(p.enabled&&t&&displacementRequested(m)&&!displacementUnsupported(m,p.type)&&!out.some(x=>!x.colorSpace&&x.data===t.data))out.push(t);}return out;
}
export function displacementWarnings(scene:GeometryScene):string[]{
 const warnings:string[]=[];
 if(displacementRequested(scene.material))warnings.push('Displacement: the DE of the fractal is unchanged. The displacement of the scene material only applies to compatible own objects.');
 for(const p of scene.primitives??[]){const m=p.material==='scene'?scene.material:p.material,why=displacementUnsupported(m,p.type);if(p.enabled&&displacementRequested(m)&&why)warnings.push(p.id+': '+why);}
 if(displacementActive(scene))warnings.push('Geometric displacement: limited ray budget; very dense maps and grazing rays can give gaps. Mesh/SDF export does not bake own objects.');
 return warnings;
}
/** One record per native object; no fractal or bridge slots can become active. */
export function packDisplacement(scene:GeometryScene,images:readonly SurfaceImage[],bounds:readonly HeightBounds[]):Float32Array{
 const out=new Float32Array(32*12);
 (scene.primitives??[]).forEach((p,i)=>{const m=p.material==='scene'?scene.material:p.material,d=m.displacement;if(!p.enabled||!d||!displacementRequested(m)||displacementUnsupported(m,p.type))return;
  const layer=images.findIndex(t=>!t.colorSpace&&t.data===d.texture!.data),b=bounds[layer];if(!b)return;
  const a=d.strength*d.heightScale,detail=m.surfaceDetail??defaultSurfaceDetail(),uv=Math.hypot(b.du,b.dv)*detail.scale;
  // Small inflation covers float32 interpolation/reduction roundoff.
  const lip=(1+a*(p.type==='sphere'?2*(uv+24*(b.max-b.min))/(1-a):uv))*1.0001;
  out.set([1,layer,a,d.reference,lip,Math.max(...p.scale),Math.min(...p.scale),p.type==='sphere'?1:3,detail.scale,detail.rotation*Math.PI/180,...detail.offset],i*12);
 });return out;
}

type V3=readonly [number,number,number];
type Sample=(u:number,v:number)=>number;
/** Independent CPU reference field, with a caller-supplied repeat bilinear sampler. */
export function displacementField(q:V3,target:'sphere'|'plane',m:MaterialSettings,sample:Sample):number{
 const d=m.displacement??defaultDisplacement(),s=m.surfaceDetail??defaultSurfaceDetail(),a=d.strength*d.heightScale;
 const projection=(uv:readonly number[])=>{const c=Math.cos(s.rotation*Math.PI/180),sn=Math.sin(s.rotation*Math.PI/180);return sample((c*uv[0]!-sn*uv[1]!)*s.scale+s.offset[0],-((sn*uv[0]!+c*uv[1]!)*s.scale+s.offset[1]));};
 let h:number;
 if(target==='plane')h=projection([q[0],-q[2]]);
 else{const r=Math.hypot(...q),n=(r>1e-12?q.map(x=>x/r):[0,1,0]) as [number,number,number],w=triplanarWeights(n);h=0;for(let k=0;k<3;k++){const ch=surfaceChart(k as 0|1|2,n[k]!);h+=w[k]!*projection([ch.t.reduce((v,x,j)=>v+x*n[j]!,0),ch.b.reduce((v,x,j)=>v+x*n[j]!,0)]);}}
 return (target==='plane'?q[1]:Math.hypot(...q)-1)-a*(h-d.reference);
}
export function displacementNormal(q:V3,target:'sphere'|'plane',m:MaterialSettings,sample:Sample):[number,number,number]{const h=1e-5,n=q.map((_,k)=>{const a=[...q] as [number,number,number],b=[...a] as [number,number,number];a[k]!+=h;b[k]!-=h;return displacementField(a,target,m,sample)-displacementField(b,target,m,sample);});const length=Math.hypot(...n)||1;return n.map(x=>x/length) as [number,number,number];}
