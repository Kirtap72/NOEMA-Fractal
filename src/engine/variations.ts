import type {Formula} from './formula/types';
import type {Scene} from './scene';
import {parseScene,resolveScene,toChainSteps} from './scene';
import {generateChain} from './formula/chain';
import {buildDiscoveryCatalog,discoveryHash} from './discoveryCatalog';
import {Random,attemptSeed} from './randomChain';

export const VARIATION_VERSION='FV2A-1';
export type VariationStrength='gentle'|'moderate'|'experimental';
export interface VariationOptions {seed:string;strength:VariationStrength;color:boolean;material:boolean}
export interface VariationDelta {step:number;parameter:string;label:string;before:number;after:number}
export interface VariationRecipe {
 version:typeof VARIATION_VERSION;id:string;sourceId:string;catalog:string;parentId?:string;
 generation:number;slot:number;attempt:number;options:VariationOptions;changes:VariationDelta[];
}
export interface VariationSource {id:string;scene:Scene;catalog:string;frame:string;aspect:number}
export interface VariationCandidate {recipe:VariationRecipe;scene:Scene}
export interface VariationControl {step:number;name:string;label:string;min:number;max:number;radius:number;positive:boolean}
export function variationImageProblem(image:{hitShare:number;colorSpread:number;normalSpread:number},difference:number):string|undefined {
 if(![image.hitShare,image.colorSpread,image.normalSpread,difference].every(Number.isFinite))return 'Invalid picture measurements';
 if(image.hitShare<.002)return 'No visible surface in the locked camera';
 if(image.colorSpread<.006&&image.normalSpread<.01)return 'Almost single-colour flat surface in the locked camera';
 if(difference<.006)return 'Too little picture difference in the locked camera';
}

/** Why an image was set aside although its calculation is valid. "dark" is a label only; darkness alone never rejects a variation. */
export type FindReason='monochrome'|'similar'|'dark';
export interface VariationVerdict {kind:'ok'|'drop'|'unexpected';problem?:string;reasons:FindReason[]}
export const FIND_REASON_LABELS:Record<FindReason,string>={monochrome:'almost single-colour',similar:'similar to another choice',dark:'dark'};
/** Mean brightness (0 to 1, as shown on screen) of the coarse picture signature: groups of four numbers, red, green, blue and 1 where a surface was hit. */
export function signatureBrightness(signature:readonly number[]):number {
 let sum=0,n=0;for(let i=0;i+3<signature.length;i+=4){sum+=.2126*signature[i]!+.7152*signature[i+1]!+.0722*signature[i+2]!;n++;}return n?sum/n:0;
}
/**
 * ARTIST-WORKFLOW 02: the same gate as variationImageProblem, but it says WHAT kind of rejection it is. Only a measured, finite picture with a visible
 * surface is a discovery worth keeping ("unexpected"): a nearly flat or single-coloured picture, or one too like another. Invalid measurements and
 * pictures with no surface at all are dropped, as are shader failures (they never reach this function: no picture exists).
 */
export function classifyVariationImage(image:{hitShare:number;colorSpread:number;normalSpread:number;signature?:readonly number[]},difference:number):VariationVerdict {
 const problem=variationImageProblem(image,difference);
 if(!problem)return {kind:'ok',reasons:[]};
 if(![image.hitShare,image.colorSpread,image.normalSpread,difference].every(Number.isFinite)||image.hitShare<.002)return {kind:'drop',problem,reasons:[]};
 const reasons:FindReason[]=[];
 if(image.colorSpread<.006&&image.normalSpread<.01)reasons.push('monochrome');
 if(difference<.006)reasons.push('similar');
 if(image.signature&&signatureBrightness(image.signature)<.06)reasons.push('dark');
 return {kind:'unexpected',problem,reasons};
}

// Explicitly reviewed continuous controls, NOT every admissible kernel option.
// Discrete flags, map IDs, variants, constants, host state and DE options stay fixed.
const KERNEL_CONTROLS:Record<string,readonly string[]>={
 'mb3d-aboxplatinum':['scale','minr_ir','fold','rotate_x','rotate_y','rotate_z','inv_radius','foldx_xy_angle','foldx_xz_angle','foldy_xy_angle','foldy_yz_angle'],
 'mb3d-aboxplatinumb':['scale','minr_ir','fold','rotate_x','rotate_y','rotate_z','inv_radius','foldx_xy_angle','foldx_xz_angle','foldy_xy_angle','foldy_yz_angle'],
 'mb3d-randcubesifs':['scale','z_add','y_add','x_add','zflight'],
 'mb3d-heightmapifs':['x_offset','y_offset','h_offset','x_scale','y_scale','h_scale','rotation_x','rotation_y','rotation_z'],
};

/** Clone editable state once. Huge immutable field resources are shared by all descendants. */
export function copyVariationScene(scene:Scene):Scene {
 const {formulaFields,...rest}=scene;
 return {...structuredClone(rest),...(formulaFields?{formulaFields:formulaFields.map(m=>({...m}))}: {})};
}
function freeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  Object.freeze(value);for(const child of Object.values(value))freeze(child);
 }return value;
}
export function variationCatalog(formulas:readonly Formula[]):string {
 return discoveryHash(JSON.stringify([VARIATION_VERSION,[...formulas].sort((a,b)=>a.id.localeCompare(b.id,'en'))]));
}
export function captureVariationSource(visible:Scene,formulas:readonly Formula[],frame:string,aspect=4/3):VariationSource {
 const scene=copyVariationScene(visible);
 // A candidate is a still of this evaluated frame. Keys stay readable, disabled until explicitly played.
 if(scene.cameraFlight)scene.cameraFlight={...scene.cameraFlight,enabled:false};
 const errors=validateVariationScene(scene,formulas);if(errors.length)throw Error(errors.join('; '));
 // One full fingerprint at capture, never eight copies of map pixels.
 const catalog=variationCatalog(formulas),id=discoveryHash(JSON.stringify([catalog,scene,aspect]));
 if(!Number.isFinite(aspect)||aspect<.1||aspect>10)throw Error('Invalid picture proportions');
 return freeze({id,scene,catalog,frame,aspect});
}
export function validateVariationScene(scene:Scene,formulas:readonly Formula[]):string[]{
 const parsed=parseScene({...scene,formulaFields:undefined});if(!parsed.ok)return parsed.errors;
 const r=resolveScene(scene,formulas);if(!r.ok)return r.errors;
 if(scene.content.length!==1)return ['Variation supports one visible fractal entry; other entries must not be ignored.'];
 const errors:string[]=[];
 r.chain.forEach((s,i)=>{
  const raw=scene.content[0]!.chain[i]!.parameters;
  for(const name of Object.keys(raw))if(!s.formula.parameters.some(p=>p.name===name))errors.push('An unknown parameter is not locked silently: '+name);
  s.formula.parameters.forEach(p=>{const v=raw[p.name]??p.default;if(!Number.isFinite(v)||v<p.min||v>p.max)errors.push('Invalid parameter: '+p.name);});
  if(s.formula.id==='mandelbox'){
   const value=(name:string)=>raw[name]??s.formula.parameters.find(p=>p.name===name)!.default;
   if(value('min_radius')>value('fixed_radius'))errors.push('Mandelbox requires inner radius ≤ outer radius.');
  }
 });
 const generated=generateChain(toChainSteps(r),r.rounds,{mode:r.mode,execution:r.execution});
 if(!generated.ok)errors.push(...generated.errors);return errors;
}
export function auditVariationControls(scene:Scene,formulas:readonly Formula[]):{controls:VariationControl[];locked:string[]}{
 const catalog=buildDiscoveryCatalog(formulas),controls:VariationControl[]=[],locked:string[]=[];
 scene.content[0]?.chain.forEach((step,i)=>{
  const f=formulas.find(f=>f.id===step.formula);if(!f){locked.push(step.formula+': missing');return;}
  const curated=catalog.entries.find(e=>e.id===f.id);
  for(const p of f.parameters){
   const v=step.parameters[p.name]??p.default;
   const expression=!f.kernel&&curated?.eligible&&curated.controls.find(c=>c.name===p.name&&c.kind!=='fixed');
   const kernel=f.kernel&&KERNEL_CONTROLS[f.kernel]?.includes(p.name);
   if(!expression&&!kernel){locked.push(`${i+1} · ${p.label??p.name}: unreviewed continuous control`);continue;}
   const angle=/^(a[xyz]|rotate_|rotation_|fold.*angle)/.test(p.name),power=p.name==='power';
   const positive=/scale|minr_ir|inv_radius|min_radius|fixed_radius|min_r/.test(p.name);
   let radius=power?1.5:angle?(kernel ? .4 : 8):Math.max(Math.abs(v)*(kernel ? .03 : .12),kernel ? .0025 : .025);
   // ABox's repeated near-unit scale is highly sensitive; do not cross its current unit-scale boundary.
   if(kernel&&p.name==='scale'&&Math.abs(Math.abs(v)-1)>.00001)radius=Math.min(radius,Math.abs(Math.abs(v)-1)*.3);
   radius=Math.min(radius,(p.max-p.min)*.12);
   // No sign crossing or approach to singular denominators. Source at zero is locked.
   if(positive&&Math.abs(v)<1e-5){locked.push(`${i+1} · ${p.name}: zero/singularity limit`);continue;}
   const min=Math.max(p.min,positive&&v>0?Math.max(1e-5,v*.55):-Infinity),max=Math.min(p.max,positive&&v<0?v*.55:Infinity);
   if(radius>1e-8&&min<max)controls.push({step:i,name:p.name,label:`${i+1} · ${f.name} · ${p.label??p.name}`,min,max,radius,positive});
  }
 });return {controls,locked};
}
/** Restore a saved recipe only against its exact source and runtime catalog. */
export function sceneFromVariation(source:VariationSource,recipe:VariationRecipe,formulas:readonly Formula[]):Scene {
 if(recipe.version!==VARIATION_VERSION||recipe.sourceId!==source.id||recipe.catalog!==source.catalog||recipe.catalog!==variationCatalog(formulas))throw Error('The source or catalogue of the recipe does not match.');
 const scene={...source.scene,content:structuredClone(source.scene.content)},audit=auditVariationControls(source.scene,formulas);
 const seen=new Set<string>();
 for(const d of recipe.changes){
  const key=d.step+':'+d.parameter;if(seen.has(key)||!Number.isFinite(d.after))throw Error('Invalid variation recipe');seen.add(key);
  if(d.step>=0){const c=audit.controls.find(c=>c.step===d.step&&c.name===d.parameter),step=scene.content[0]!.chain[d.step];
   if(!c||!step||d.after<c.min||d.after>c.max||d.before!==(source.scene.content[0]!.chain[d.step]!.parameters[d.parameter]??formulas.find(f=>f.id===step.formula)!.parameters.find(p=>p.name===d.parameter)!.default))throw Error('Disallowed parameter change');
   step.parameters[d.parameter]=d.after;
  }else if(d.step===-1&&d.parameter==='offset'&&recipe.options.color&&d.before===source.scene.color.offset&&d.after>=0&&d.after<=1)scene.color={...scene.color,offset:d.after};
  else if(d.step===-2&&recipe.options.material&&['roughness','metallic','reflectivity'].includes(d.parameter)&&typeof source.scene.material[d.parameter as 'roughness']==='number'&&d.before===source.scene.material[d.parameter as 'roughness']&&d.after>=0&&d.after<=1)scene.material={...scene.material,[d.parameter]:d.after};
  else throw Error('Disallowed appearance change');
 }
 const errors=validateVariationScene(scene,formulas);if(errors.length)throw Error(errors.join('; '));
 return freeze(scene);
}
/** Deterministic slot/attempt streams; GPU scheduling cannot change recipe ordering. */
export function generateVariation(source:VariationSource,formulas:readonly Formula[],options:VariationOptions,slot:number,attempt=0,parent?:VariationCandidate):VariationCandidate {
 if(!options.seed.trim()||options.seed.length>128||!['gentle','moderate','experimental'].includes(options.strength)||!Number.isInteger(slot)||slot<0||slot>7||!Number.isInteger(attempt)||attempt<0||attempt>2)throw Error('Invalid variation settings');
 if(parent&&(parent.recipe.sourceId!==source.id||parent.recipe.catalog!==source.catalog))throw Error('The parent belongs to another source');
 const audit=auditVariationControls(source.scene,formulas);
 if(!audit.controls.length)throw Error('No reviewed numeric geometry controls. No replacement formula is used.');
 const seed=parseInt(discoveryHash(options.seed.normalize('NFC')),16),rng=new Random(attemptSeed(seed,slot*3+attempt+(parent?.recipe.generation??0)*24));
 const center=parent?sceneFromVariation(source,parent.recipe,formulas):source.scene,mult={gentle:.65,moderate:1.5,experimental:2.7}[options.strength]*(1+attempt*.45),changes:VariationDelta[]=[];
 // A few controls per candidate keeps small changes interpretable, rather than multiplying every sensitive input.
 const pool=[...audit.controls];for(let i=pool.length-1;i>0;i--){const j=rng.int(0,i);[pool[i],pool[j]]=[pool[j]!,pool[i]!];}
 const chosen=pool.slice(0,options.strength==='gentle'?Math.min(2,pool.length):Math.min(4,pool.length));
 const values=new Map<string,number>();
 for(const c of chosen){const f=formulas.find(f=>f.id===center.content[0]!.chain[c.step]!.formula)!,p=f.parameters.find(p=>p.name===c.name)!,v=center.content[0]!.chain[c.step]!.parameters[c.name]??p.default;
  const sign=rng.next()<.5?-1:1,value=Number(Math.max(c.min,Math.min(c.max,v+sign*(.3+rng.next()*.7)*c.radius*mult)).toPrecision(9));values.set(c.step+':'+c.name,value);}
 for(const c of audit.controls){const s=source.scene.content[0]!.chain[c.step]!,f=formulas.find(f=>f.id===s.formula)!,before=s.parameters[c.name]??f.parameters.find(p=>p.name===c.name)!.default;
  const after=values.get(c.step+':'+c.name)??center.content[0]!.chain[c.step]!.parameters[c.name]??before;
  if(after!==before)changes.push({step:c.step,parameter:c.name,label:c.label,before,after});}
 if(options.color){const before=source.scene.color.offset,after=Number((((center.color.offset+(rng.next()-.5)*mult*.3)%1+1)%1).toFixed(7));changes.push({step:-1,parameter:'offset',label:'Gradient · offset',before,after});}
 if(options.material)for(const parameter of ['roughness','metallic','reflectivity'] as const){const before=source.scene.material[parameter],v=center.material[parameter];if(typeof before==='number'&&typeof v==='number'){const after=Number(Math.max(0,Math.min(1,v+(rng.next()-.5)*mult*.4)).toFixed(7));if(after!==before)changes.push({step:-2,parameter,label:'Material · '+parameter,before,after});}}
 if(!changes.length)throw Error('No numeric difference within the valid domain');
 const body={version:VARIATION_VERSION as typeof VARIATION_VERSION,sourceId:source.id,catalog:source.catalog,...(parent?{parentId:parent.recipe.id}:{}),generation:(parent?.recipe.generation??0)+1,slot,attempt,options:{...options},changes};
 const recipe:VariationRecipe={...body,id:discoveryHash(JSON.stringify(body))};return freeze({recipe,scene:sceneFromVariation(source,recipe,formulas)});
}
/** Keep authored animation/IDs; only the explicitly selected still mathematics and opted-in appearance change. */
export function applyVariation(base:Scene,source:VariationSource,candidate:VariationCandidate,formulas:readonly Formula[]):Scene {
 const verified=sceneFromVariation(source,candidate.recipe,formulas);
 if(JSON.stringify(base.content.map(c=>[c.id,c.chain.map(s=>[s.id,s.formula])]))!==JSON.stringify(source.scene.content.map(c=>[c.id,c.chain.map(s=>[s.id,s.formula])])))throw Error('The identity of the scene has changed. Capture a new source first.');
 const next={...base,content:structuredClone(verified.content),...(candidate.recipe.options.color?{color:verified.color}:{}),...(candidate.recipe.options.material?{material:verified.material}:{})};
 const errors=validateVariationScene(next,formulas);if(errors.length)throw Error(errors.join('; '));return next;
}
