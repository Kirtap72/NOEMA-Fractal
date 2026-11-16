import type {Formula} from './formula/types';
import {formulaCatalog} from './formula/catalog';
import {KERNELS} from './formula/kernels';
import {generateChain} from './formula/chain';
import {HYBRID_FRACTALS,SHAPES} from './randomChain';

export const DISCOVERY_VERSION='FG2A-1';
export type ExplorationControl={name:string;label:string;kind:'float'|'integer'|'fixed';min:number;max:number;default:number};
export interface DiscoveryEntry {
 id:string;name:string;family:string;dimension:3|4;kernel?:string;runtimeRegistered:boolean;standalone:boolean;
 eligible:boolean;reason:string;controls:ExplorationControl[];iterations:number;modes:('single'|'rotation'|'hybrid')[];
 julia:boolean;provenance:Formula['provenance'];credits:Formula['credits'];sources:Formula['sources'];
}
export interface DiscoveryCatalog {version:typeof DISCOVERY_VERSION;fingerprint:string;entries:DiscoveryEntry[]}
/** Non-cryptographic recipe/seed identity; never a provenance/security signature. */
export function discoveryHash(text:string):string {let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16).padStart(8,'0');}

/** Conservative exploration domains, separate from admissible stored metadata. Kernel options are fixed. */
function controls(formula:Formula):ExplorationControl[]{
 return formula.parameters.map(p=>{
  let kind:ExplorationControl['kind']='fixed',lo=p.default,hi=p.default;
  const special=formula.id==='mandelbulb'||formula.id==='iq-bulb';
  if(special&&p.name==='power'){kind='integer';lo=4;hi=10;}
  else if(p.name==='scale'&&Math.abs(p.default)>=1.4){kind='float';lo=p.default*.9;hi=p.default*1.1;if(lo>hi)[lo,hi]=[hi,lo];}
  else if(['min_radius','fixed_radius','min_r'].includes(p.name)&&p.default>0){kind='float';lo=p.default*.85;hi=p.default*1.15;}
  else if(!formula.kernel&&/^a[xyz]$/.test(p.name)){kind='float';lo=Math.max(-180,p.default-24);hi=Math.min(180,p.default+24);}
  else if(!formula.kernel&&p.min<p.default&&p.default<p.max&&Math.abs(p.default)>1e-7){kind='float';const radius=Math.min((p.max-p.min)*.08,Math.abs(p.default)*.18);lo=p.default-radius;hi=p.default+radius;}
  lo=Math.max(p.min,lo);hi=Math.min(p.max,hi);
  if(kind==='integer'){lo=Math.ceil(lo);hi=Math.floor(hi);}if(lo>hi||!Number.isFinite(lo+hi)||lo===hi){kind='fixed';lo=hi=p.default;}
  return {name:p.name,label:p.label??p.name,kind,min:lo,max:hi,default:p.default};
 });
}

/** Uses the actual registry. No formula equations, aliases or second formula database are introduced. */
export function buildDiscoveryCatalog(formulas:readonly Formula[]):DiscoveryCatalog {
 const entries=[...formulas].sort((a,b)=>a.id.localeCompare(b.id,'en')).map(f=>{
  const facts=formulaCatalog(f),k=f.kernel?KERNELS[f.kernel]:undefined;
  const iterations=Math.min(f.iterations,16);
  const generated=generateChain([{formula:f,iterations}],1),standalone=generated.ok;
  const runtimeRegistered=!!k||!f.kernel&&generateChain([{formula:f,iterations}],1,{allowNoDistance:true}).ok;
  let reason='';
  if(!runtimeRegistered)reason='No accepted runtime definition';
  else if(k?.role||!f.kernel&&!f.distance)reason='A helper/transform requires a compatible main formula';
  else if(k?.fieldMapParameter)reason='Requires a special field resource';
  else if(facts.dimension!==3)reason='4D slices/Julia/state are not curated automatically in FG2A';
  else if(k&&k.method==='analytic')reason='Analytic kernel box variants require separate host/camera curation; the first picture sample often gave filled views';
  else if(k&&(k.method==='numeric'||k.method==='difs'))reason='Numeric/dIFS-DE needs separate cost and domain curation';
  else if(SHAPES.includes(f.id)||facts.category==='spatial')reason='Analytic/periodic support geometry is not a fractal family in the default selection';
  else if(!standalone)reason='Cannot run standalone with the default chain';
  const c=controls(f);
  if(!reason&&c.every(p=>p.kind==='fixed')&&(f.kernel||!formulas.some(f=>f.id==='rotate')))reason='No curated numeric variations yet';
  const modes:DiscoveryEntry['modes']=['single'];if(!f.kernel&&facts.dimension===3&&f.distance&&formulas.some(f=>f.id==='rotate'))modes.push('rotation');if(HYBRID_FRACTALS.includes(f.id))modes.push('hybrid');
  return {id:f.id,name:f.name,family:f.catalog?.family??f.name,dimension:facts.dimension,kernel:f.kernel,runtimeRegistered,standalone,eligible:!reason,reason,controls:c,iterations,modes,julia:!f.kernel&&facts.dimension===3,provenance:f.provenance,credits:structuredClone(f.credits),sources:structuredClone(f.sources)};
 });
 // Changing registered mathematics, metadata or exploration policy intentionally changes reproduction identity.
 const fingerprint=discoveryHash(JSON.stringify([DISCOVERY_VERSION,[...formulas].sort((a,b)=>a.id.localeCompare(b.id,'en')),entries]));
 return {version:DISCOVERY_VERSION,fingerprint,entries};
}
