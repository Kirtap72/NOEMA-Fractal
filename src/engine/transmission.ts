import type {Vec3} from './camera';
import type {Scene} from './scene';
import {resolveMaterial} from './material';
export interface TransportSettings {enabled:boolean;maxBounces:number;}
export const defaultTransport=():TransportSettings=>({enabled:false,maxBounces:6});
export function readTransport(raw:unknown,errors:string[]):TransportSettings {
 const out=defaultTransport();if(raw===undefined)return out;
 if(!raw||typeof raw!=='object'||Array.isArray(raw)){errors.push('transport must be an object');return out;}
 const r=raw as Record<string,unknown>;if(typeof r.enabled!=='boolean')errors.push('transport.enabled must be boolean');else out.enabled=r.enabled;
 if(typeof r.maxBounces!=='number'||!Number.isInteger(r.maxBounces)||r.maxBounces<0||r.maxBounces>8)errors.push('transport.maxBounces must be an integer from 0 to 8');else out.maxBounces=r.maxBounces;
 if(Object.keys(r).some(k=>!['enabled','maxBounces'].includes(k)))errors.push('Unknown transport field');return out;
}
export function hasTransmissionVolumes(scene:Scene):boolean {
 return !scene.cutout.planes.some(p=>p.enabled)&&!!scene.primitives?.some(p=>{
  const m=resolveMaterial(p.material==='scene'?scene.material:p.material);
  return p.enabled&&p.type!=='plane'&&m.transmission>0&&typeof m.metallic==='number'&&m.metallic<1;
 });
}
export function transportWarnings(scene:Scene):string[]{
 if(!scene.transport?.enabled)return [];
 const warnings:string[]=[];
 if((scene.material.transmission??0)>0)warnings.push('Volume transmission is only supported for closed spheres and boxes; the material of the fractal uses an opaque approximation.');
 if(scene.primitives?.some(p=>{const m=p.material==='scene'?scene.material:p.material;return (m.transmission??0)>0&&(p.type==='plane'||typeof m.metallic!=='number');}))warnings.push('Plane and measure-controlled metallic are not supported as glass volumes.');
 if(scene.cutout.planes.some(p=>p.enabled))warnings.push('Open cuts lack a closed medium: geometric transmission is paused while cuts are activated.');
 return warnings;
}
/** Independent mathematical boundary reference. Normal faces the incoming ray; indices are explicit media. */
export function snell(incoming:Vec3,normal:Vec3,incidentIor:number,destinationIor:number):Vec3|null {
 const cosine=-incoming.reduce((s,v,i)=>s+v*normal[i]!,0),eta=incidentIor/destinationIor,k=1-eta*eta*(1-cosine*cosine);
 if(k<0)return null;return incoming.map((v,i)=>eta*v+(eta*cosine-Math.sqrt(k))*normal[i]!) as Vec3;
}
/** Exact unpolarized dielectric Fresnel, including the critical angle; equations independently expressed. */
export function dielectricFresnel(cosine:number,incidentIor:number,destinationIor:number):number {
 const c=Math.min(1,Math.max(0,Math.abs(cosine)));if(incidentIor===destinationIor)return 0;
 const sin2=(incidentIor/destinationIor)**2*(1-c*c);if(sin2>=1)return 1;
 const ct=Math.sqrt(1-sin2),a=incidentIor*c,b=destinationIor*ct,d=destinationIor*c,e=incidentIor*ct;
 return .5*(((a-b)/(a+b))**2+((d-e)/(d+e))**2);
}
/** Transmittance colour at unit density and world distance; logarithm is sigma, not a surface tint. */
export function beerLambert(color:Vec3,density:number,distance:number):Vec3 {
 return color.map(c=>Math.exp(Math.log(Math.max(c,1e-6))*density*distance)) as Vec3;
}
export interface OpticalMedium {objectId:string|null;ior:number;absorptionColor:Vec3;density:number;}
export const airMedium=():OpticalMedium=>({objectId:null,ior:1,absorptionColor:[1,1,1],density:0});
/** One closed medium is supported now. Invalid/nested boundaries are explicit, never silently treated as air. */
export function crossMedium(current:OpticalMedium,id:string,entering:boolean,next:Omit<OpticalMedium,'objectId'>):OpticalMedium|null {
 if(entering)return current.objectId===null?{...next,objectId:id}:null;
 return current.objectId===id?airMedium():null;
}
