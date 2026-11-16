import type {MaterialSettings} from './material';

export const PROCEDURAL_PATTERNS=['fine-noise','fbm','brushed','hammered','stone','ridged'] as const;
export type ProceduralPattern=(typeof PROCEDURAL_PATTERNS)[number];
export interface ProceduralDetailSettings {
  enabled:boolean; pattern:ProceduralPattern; strength:number; scale:number;
  octaves:number; lacunarity:number; persistence:number; seed:number;
  rotation:number; anisotropy:number; roughnessModulation:number;
}
export function defaultProceduralDetail():ProceduralDetailSettings{return {enabled:false,pattern:'fine-noise',strength:.2,scale:32,octaves:4,lacunarity:2,persistence:.5,seed:0,rotation:0,anisotropy:24,roughnessModulation:0};}
export const PROCEDURAL_LIMITS={strength:[0,4],scale:[.000001,16777216],octaves:[1,8],lacunarity:[1.25,4],persistence:[0,1],seed:[0,16777215],rotation:[-36000,36000],anisotropy:[1,128],roughnessModulation:[-1,1]} as const;
export function readProceduralDetail(raw:unknown,where:string,errors:string[]):ProceduralDetailSettings|undefined {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){errors.push(`${where} must be an object`);return;}
  const r=raw as Record<string,unknown>,before=errors.length,out=defaultProceduralDetail();
  for(const key of Object.keys(r))if(!['enabled','pattern',...Object.keys(PROCEDURAL_LIMITS)].includes(key))errors.push(`${where}.${key} is unknown`);
  if(r.enabled!==undefined){if(typeof r.enabled!=='boolean')errors.push(`${where}.enabled must be boolean`);else out.enabled=r.enabled;}
  if(r.pattern!==undefined){if(!(PROCEDURAL_PATTERNS as readonly unknown[]).includes(r.pattern))errors.push(`${where}.pattern is unknown`);else out.pattern=r.pattern as ProceduralPattern;}
  for(const [key,[min,max]] of Object.entries(PROCEDURAL_LIMITS)){const v=r[key];if(v===undefined)continue;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(['octaves','seed'].includes(key)&&!Number.isInteger(v)))errors.push(`${where}.${key} must be ${['octaves','seed'].includes(key)?'an integer':'finite'} within ${min} to ${max}`);else Object.assign(out,{[key]:v});}
  return errors.length===before?out:undefined;
}
export function proceduralDetailActive(m:MaterialSettings):boolean{return !!m.surfaceDetail?.procedural?.enabled;}
type V3=readonly [number,number,number];
export interface HeightGradient {height:number;gradient:[number,number,number]}
export function detailHash(value:number):number {let v=value>>>0;v^=v>>>16;v=Math.imul(v,0x7feb352d);v^=v>>>15;v=Math.imul(v,0x846ca68b);return (v^(v>>>16))>>>0;}
const hashCell=(p:V3,seed:number)=>detailHash((Math.imul(wrap(p[0]),0x9e3779b9)^Math.imul(wrap(p[1]),0x85ebca6b)^Math.imul(wrap(p[2]),0xc2b2ae35)^seed)>>>0);
const random=(hash:number)=>( (hash>>>8)+.5)/16777216;
const wrap=(v:number)=>v-Math.floor(v/1048576)*1048576;
const fade=(v:number)=>v*v*v*(v*(v*6-15)+10);
const derivative=(v:number)=>30*v*v*(v-1)*(v-1);
/** Own value-noise lattice, using Perlin's C2 quintic interpolant (2002), not his gradient-noise implementation. */
export function valueNoiseGradient(point:V3,seed:number):HeightGradient {
  const cell=point.map(Math.floor),f=point.map((v,i)=>v-cell[i]!),s=f.map(fade),ds=f.map(derivative);let height=0;const gradient:[number,number,number]=[0,0,0];
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
    const c=[x,y,z],w=c.map((v,i)=>v?s[i]!:1-s[i]!),dw=c.map((v,i)=>v?ds[i]!: -ds[i]!);const h=2*random(hashCell([cell[0]!+x,cell[1]!+y,cell[2]!+z],seed))-1;
    height+=h*w[0]!*w[1]!*w[2]!;for(let i=0;i<3;i++)gradient[i]=gradient[i]!+h*dw[i]!*w[(i+1)%3]!*w[(i+2)%3]!;
  }return {height,gradient};
}
/** One feature per cell, jitter in [0.3,0.7]: the nearest feature is guaranteed within the 27 neighbours. */
export function cellularDetailGradient(point:V3,seed:number):HeightGradient {
  const cell=point.map(Math.floor),f=point.map((v,i)=>v-cell[i]!);let closest=Infinity;let delta:[number,number,number]=[0,0,0];
  for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
    const at:[number,number,number]=[cell[0]!+x,cell[1]!+y,cell[2]!+z],h=hashCell(at,seed);const d=[x,y,z].map((v,i)=>f[i]!-v-(.3+.4*random(detailHash(h^([0x68bc21eb,0x02e5be93,0x967a889b][i]!))))) as [number,number,number];const distance=d.reduce((s,v)=>s+v*v,0);if(distance<closest){closest=distance;delta=d;}
  }
  const height=-Math.exp(-4*closest);return {height,gradient:delta.map(v=>-8*height*v) as [number,number,number]};
}
export function detailFrequencyWeight(footprint:number):number {const t=Math.max(0,Math.min(1,(footprint-.25)/.5));return 1-t*t*(3-2*t);}
/** Height is normalized; gradient is its true object-coordinate derivative, including scale and rotation. */
export function sampleProceduralDetail(point:V3,d:ProceduralDetailSettings,footprint=0):HeightGradient {
  const angle=d.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);const anisotropy=d.pattern==='brushed'?d.anisotropy:1;
  const q:V3=[(c*point[0]-s*point[1])*d.scale,(s*point[0]+c*point[1])*d.scale/anisotropy,point[2]*d.scale];
  const signal:HeightGradient={height:0,gradient:[0,0,0]};let norm=0,frequency=1,amplitude=1;
  const octaves=['fine-noise','hammered'].includes(d.pattern)?1:d.octaves;
  for(let octave=0;octave<octaves;octave++){
    norm+=amplitude;const weight=detailFrequencyWeight(footprint*frequency);if(weight>0&&amplitude>0){
      const p=q.map(v=>v*frequency) as [number,number,number];let n=d.pattern==='hammered'?cellularDetailGradient(p,d.seed):valueNoiseGradient(p,d.seed+octave*1013);
      if(d.pattern==='ridged'){n={height:1-Math.abs(n.height),gradient:n.gradient.map(v=>-Math.sign(n.height)*v) as [number,number,number]};}
      if(d.pattern==='stone'){const v=n.height,den=.15+v*v;n={height:v/Math.sqrt(den),gradient:n.gradient.map(g=>g*.15/den**1.5) as [number,number,number]};}
      signal.height+=n.height*amplitude*weight;for(let i=0;i<3;i++)signal.gradient[i]=signal.gradient[i]!+n.gradient[i]!*amplitude*frequency*weight;
    }
    frequency*=d.lacunarity;amplitude*=d.persistence;
  }
  const g=signal.gradient.map(v=>v/Math.max(norm,1e-10));return {height:signal.height/Math.max(norm,1e-10),gradient:[(c*g[0]!+s*g[1]!/anisotropy)*d.scale,(-s*g[0]!+c*g[1]!/anisotropy)*d.scale,g[2]!*d.scale]};
}
