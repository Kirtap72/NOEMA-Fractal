import type { Vec3 } from './camera';
import { clipRay } from './renderDetails';
import type { CutoutSettings } from './renderDetails';

/** Bounded specular paths; resource/quality limits never alter the fractal field. */
export interface ReflectionSettings {
  enabled: boolean;
  /** Isolated VISUAL-02 artist request; absent direct API inputs retain gain one. */
  secondary_radiance_gain?: number;
  max_steps: number;
  max_distance: number;
  hit_threshold: number;
  samples: number;
  maxReflectionBounces: number;
}
export const REFLECTION_LIMITS = {secondary_radiance_gain:[0,1],maxReflectionBounces:[0,4],max_steps:[1,1024],max_distance:[0.001,1000000],hit_threshold:[1e-8,0.1],samples:[1,32]} as const;
export const defaultReflections = ():ReflectionSettings => ({secondary_radiance_gain:0,enabled:false,max_steps:128,max_distance:30,hit_threshold:0.0001,samples:4,maxReflectionBounces:1});
export function readReflections(raw:unknown, errors:string[]):ReflectionSettings {
  const value=defaultReflections();
  if(raw===undefined)return value;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){errors.push('reflections must be an object');return value;}
  const o=raw as Record<string,unknown>;
  if(o.enabled!==undefined){if(typeof o.enabled!=='boolean')errors.push('reflections.enabled must be boolean');else value.enabled=o.enabled;}
  for(const key of Object.keys(REFLECTION_LIMITS) as (keyof typeof REFLECTION_LIMITS)[]){
    const n=o[key],limits=REFLECTION_LIMITS[key];
    if(n===undefined)continue;
    if(typeof n!=='number'||!Number.isFinite(n)||n<limits[0]||n>limits[1]||(['samples','max_steps','maxReflectionBounces'].includes(key)&&!Number.isInteger(n)))errors.push('invalid reflections.'+key);
    else value[key]=n;
  }
  for(const key of Object.keys(o))if(key!=='enabled'&&!Object.hasOwn(REFLECTION_LIMITS,key))errors.push('unknown reflections.'+key);
  return value;
}
export interface ReflectionBudget {maxSteps?:number;samples?:number;maxBounces?:number}
export function packReflections(settings:ReflectionSettings,budget:ReflectionBudget|undefined,seed:number,sample:number):number[]{
  return [settings.enabled?1:0,Math.min(settings.max_steps,budget?.maxSteps??settings.max_steps),settings.max_distance,settings.hit_threshold,
    Math.min(settings.samples,budget?.samples??settings.samples),seed%16777216,sample,Math.min(settings.maxReflectionBounces,budget?.maxBounces??settings.maxReflectionBounces)];
}
const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,n,i)=>s+n*b[i]!,0);
const unit=(v:Vec3):Vec3=>{const d=Math.hypot(...v);return v.map(x=>x/d) as Vec3;};
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function reflectIncoming(incoming:Vec3,normal:Vec3):Vec3{return incoming.map((x,i)=>x-2*dot(incoming,normal)*normal[i]!) as Vec3;}
export function reflectionBias(p:Vec3,primaryEpsilon:number):number{return 2*Math.max(primaryEpsilon,2e-6*(1+Math.hypot(...p)));}
/** Independent mathematical reference, Heitz 2018 GGX visible-normal construction (not copied sample code).
 * https://jcgt.org/published/0007/04/01/ ; correlated Smith G2 / G1 cancels the VNDF PDF.
 */
export function sampleReflection(incoming:Vec3,n:Vec3,rough:number,uv:readonly [number,number],f0:Vec3):{direction:Vec3;weight:Vec3}{
  const view=incoming.map(x=>-x) as Vec3,nv=Math.max(1e-6,dot(n,view));
  let h=n;
  const alpha=rough*rough;
  if(rough>0){
    const x=unit(cross(n,Math.abs(n[1])>.9?[1,0,0]:[0,1,0])),y=cross(n,x);
    const v=unit([alpha*dot(view,x),alpha*dot(view,y),nv]);
    const axis=v[0]*v[0]+v[1]*v[1]>1e-12?unit([-v[1],v[0],0]):[1,0,0] as Vec3,other=cross(v,axis);
    const radius=Math.sqrt(uv[0]),angle=2*Math.PI*uv[1],a=radius*Math.cos(angle),s=.5*(1+v[2]);
    const b=(1-s)*Math.sqrt(Math.max(0,1-a*a))+s*radius*Math.sin(angle);
    const c=Math.sqrt(Math.max(0,1-a*a-b*b));
    const disc=axis.map((t,i)=>a*t+b*other[i]!+c*v[i]!) as Vec3;
    const local=unit([alpha*disc[0],alpha*disc[1],Math.max(0,disc[2])]);
    h=unit(n.map((t,i)=>local[0]*x[i]!+local[1]*y[i]!+local[2]*t) as Vec3);
  }
  const direction=reflectIncoming(incoming,h),nl=dot(direction,n);
  if(nl<=0)return {direction,weight:[0,0,0]}; // rejected samples contribute zero, not a mirror fallback
  const root=(v:number)=>Math.sqrt(v*v*(1-alpha*alpha)+alpha*alpha);
  const g1=2*nv/(nv+root(nv)),g2=2*nv*nl/(nl*root(nv)+nv*root(nl));
  const grazing=(1-Math.max(0,dot(view,h)))**5;
  return {direction,weight:f0.map(f=>(f+(1-f)*grazing)*g2/g1) as Vec3};
}
export interface SecondaryHit {hit:boolean;exhausted:boolean;distance:number;position:Vec3;steps:number;epsilon:number}
/** CPU reference for bounded secondary visibility, including open clips and invalid-domain exits. */
export function traceSecondary(field:(p:Vec3,epsilon:number)=>number,origin:Vec3,dir:Vec3,settings:ReflectionSettings,stepFactor=.8,cutout?:CutoutSettings):SecondaryHit{
  const interval:[number,number]=cutout?clipRay(origin,dir,settings.max_distance,cutout):[0,settings.max_distance];
  let t=interval[0],steps=0,escape=false,previous=t;
  const at=(d:number)=>origin.map((x,i)=>x+dir[i]!*d) as Vec3;
  const epsilon=(p:Vec3,d:number)=>Math.max(settings.hit_threshold*(1+d),2e-6*(1+Math.hypot(...p)));
  for(;steps<settings.max_steps&&t<=interval[1];steps++){
    const p=at(t),e=epsilon(p,t),d=field(p,e);
    if(!Number.isFinite(d)||Math.abs(d)>=1e18){t=interval[1]+1;break;}
    if(steps===0&&t>0&&d>=0&&d<e)escape=true;
    if(escape){
      if(d>e){let lo=previous,hi=t;for(let i=0;i<8;i++){const mid=(lo+hi)*.5;if(field(at(mid),e)>e)hi=mid;else lo=mid;}
        return {hit:true,exhausted:false,distance:hi,position:at(hi),steps,epsilon:e};}
      previous=t;t+=e*2;continue;
    }
    if(Math.abs(d)<e)return {hit:true,exhausted:false,distance:t,position:p,steps,epsilon:e};
    t+=Math.abs(d)*stepFactor;
  }
  return {hit:false,exhausted:t<=interval[1],distance:t,position:at(t),steps,epsilon:epsilon(at(t),t)};
}

export interface DiffuseGiSettings {enabled:boolean;}
export const DEFAULT_DIFFUSE_GI:DiffuseGiSettings={enabled:false};
export const defaultDiffuseGi=():DiffuseGiSettings=>({...DEFAULT_DIFFUSE_GI});
export function readDiffuseGi(raw:unknown,errors:string[]):DiffuseGiSettings {
  if(raw===undefined)return defaultDiffuseGi();
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>k!=='enabled')||typeof (raw as DiffuseGiSettings).enabled!=='boolean'){errors.push('diffuseGi needs only a boolean enabled');return defaultDiffuseGi();}
  return {enabled:(raw as DiffuseGiSettings).enabled};
}
