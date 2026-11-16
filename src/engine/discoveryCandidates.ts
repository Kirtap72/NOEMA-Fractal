import {readSceneCamera} from './camera';
import {propertyTracks} from './propertyAnimation';
import {Random,attemptSeed} from './randomChain';
import {buildDiscoveryCatalog,discoveryHash,DISCOVERY_VERSION} from './discoveryCatalog';
import type {DiscoveryCatalog,DiscoveryEntry} from './discoveryCatalog';
import type {Formula} from './formula/types';
import {createDefaultScene,defaultStep,parseScene,resolveScene,toChainSteps,collectCredits} from './scene';
import type {Scene,ChainStepData} from './scene';
import {generateChain} from './formula/chain';
import {compileChainCpu} from './formula/cpu';
import {defaultAnimation} from './animation';

export interface DiscoveryOptions {seed:string|number;mode:'variety'|'family'|'hybrid';family?:string;strength:number;maxSteps:1|2;count:number}
export interface DiscoveryRecipe {
 version:typeof DISCOVERY_VERSION;catalogFingerprint:string;id:string;seed:string;seed32:number;slot:number;
 mode:DiscoveryOptions['mode'];strength:number;maxSteps:1|2;family:string;parentId?:string;
 chain:{formula:string;iterations:number;parameters:Record<string,number>}[];rounds:number;
}
export interface DiscoveryCandidate {recipe:DiscoveryRecipe;scene:Scene;signature:string}
export interface DiscoveryBatch {options:DiscoveryOptions;catalogFingerprint:string;candidates:DiscoveryCandidate[];rejected:{slot:number;reason:string}[]}
export function normalizedDiscoverySeed(seed:string|number):{text:string;value:number}{
 if(typeof seed!=='number'&&typeof seed!=='string')throw Error('The seed must be an integer or text.');
 if(typeof seed==='number'&&!Number.isSafeInteger(seed))throw Error('The seed must be an integer or text.');
 const text=String(seed).trim().normalize('NFC');if(!text||text.length>128)throw Error('The seed must have 1–128 characters.');
 return {text,value:parseInt(discoveryHash(text),16)};
}
function checkOptions(options:DiscoveryOptions){normalizedDiscoverySeed(options.seed);if(!['variety','family','hybrid'].includes(options.mode)||!Number.isFinite(options.strength)||options.strength<0||options.strength>1||![1,2].includes(options.maxSteps)||!Number.isInteger(options.count)||options.count<1||options.count>12)throw Error('Invalid discovery settings. At most 12 candidates and two steps.');}

function variation(entry:DiscoveryEntry,formula:Formula,rng:Random,strength:number,parent?:DiscoveryRecipe):ChainStepData{
 const step=defaultStep(formula);step.iterations=entry.iterations;
 for(const c of entry.controls){const center=parent?.chain.find(s=>s.formula===entry.id)?.parameters[c.name]??c.default;
  let value=c.kind==='fixed'?c.default:Math.max(c.min,Math.min(c.max,center+(rng.next()-.5)*(c.max-c.min)*strength*2));
  if(c.kind==='integer')value=Math.round(value);if(c.kind==='float')value=Number(value.toPrecision(7));step.parameters[c.name]=value;
 }
 return step;
}
export function validateDiscoveryScene(scene:Scene,formulas:readonly Formula[]):string[] {
 const parsed=parseScene(scene);if(!parsed.ok)return parsed.errors;const r=resolveScene(scene,formulas);if(!r.ok)return r.errors;
 const errors:string[]=[];for(const step of r.chain)for(const [i,p] of step.formula.parameters.entries()){const v=step.parameterValues[i]!;const raw=scene.content[0]!.chain[r.chain.indexOf(step)]!.parameters[p.name];if(typeof raw!=='number'||!Number.isFinite(raw)||raw<p.min||raw>p.max||v!==raw)errors.push('Value outside metadata: '+p.name);}
 const wgsl=generateChain(toChainSteps(r),r.rounds);if(!wgsl.ok)errors.push(...wgsl.errors);return errors;
}
export function candidateFromRecipe(recipe:DiscoveryRecipe,formulas:readonly Formula[],catalog=buildDiscoveryCatalog(formulas)):DiscoveryCandidate {
 if(!/^[a-f0-9]{8}$/.test(recipe.id)||!Number.isFinite(recipe.strength)||recipe.strength<0||recipe.strength>1)throw Error('Invalid recipe identity/variation strength.');
 if(recipe.version!==DISCOVERY_VERSION||recipe.catalogFingerprint!==catalog.fingerprint)throw Error('The recipe requires the same version and runtime catalogue.');
 const root=formulas.find(f=>f.id===recipe.family),entry=catalog.entries.find(e=>e.id===recipe.family&&e.eligible);if(!root||!entry)throw Error('The family is not supported in this selection.');
 if(!Array.isArray(recipe.chain)||recipe.chain.length<1||recipe.chain.length>2||!Number.isInteger(recipe.rounds)||recipe.rounds<1||recipe.rounds>8)throw Error('Disallowed recipe complexity.');
 const ids=recipe.chain.map(s=>s.formula);
 if(ids.at(-1)!==recipe.family||ids.length===2&&!(ids[0]==='rotate'&&entry.modes.includes('rotation')||entry.modes.includes('hybrid')&&catalog.entries.some(e=>e.id===ids[0]&&e.eligible&&e.modes.includes('hybrid'))))throw Error('The chain lacks an approved composition rule.');
 const hybrid=ids.length===2&&ids[0]!=='rotate';
 if(recipe.rounds!==(hybrid?6:1)||recipe.chain.some((s,i)=>s.iterations!==(hybrid||s.formula==='rotate'?1:entry.iterations)))throw Error('The rounds of the recipe deviate from the limited composition rule.');
 for(const stage of recipe.chain){
  const f=formulas.find(f=>f.id===stage.formula);if(!f)throw Error('The formula is missing');
  const policy=catalog.entries.find(e=>e.id===stage.formula)!;
  if(Object.keys(stage.parameters).some(n=>!f.parameters.some(p=>p.name===n)))throw Error('Unknown recipe parameter');
  for(const p of f.parameters){const v=stage.parameters[p.name];if(typeof v!=='number'||!Number.isFinite(v))throw Error('Invalid parameter');
   if(stage.formula==='rotate'){if(Math.abs(v)>30)throw Error('Rotation outside the curated range');}
   else {const c=policy.controls.find(c=>c.name===p.name)!;if(v<c.min-1e-7||v>c.max+1e-7||c.kind==='fixed'&&v!==c.default||c.kind==='integer'&&!Number.isInteger(v))throw Error('Parameter outside the typed curated range: '+p.name);}
  }
 }
 const scene=createDefaultScene(root);scene.content=[{id:'fg-'+recipe.id+'-content',type:'fractal',chain:recipe.chain.map((s,i)=>({...structuredClone(s),id:'fg-'+recipe.id+'-step-'+i})),rounds:recipe.rounds}];
 scene.render.quality.step_factor=.65; // candidate's conservative march margin, never user's final settings
 scene.credits=collectCredits(scene,formulas);
 const errors=validateDiscoveryScene(scene,formulas);if(errors.length)throw Error(errors.join('; '));
 const r=resolveScene(scene,formulas);if(!r.ok)throw Error(r.errors.join());
 const cpu=compileChainCpu(toChainSteps(r),r.rounds,{round32:true});let finite=0,positive=0;const radius=(root.cameraDistance??4)*.5;
 // Bounded numerical screening, not a proof of nonempty or attractive geometry and not a view search.
 for(const x of [-.7,.07,.6])for(const y of [-.55,.11,.65])for(const z of [-.6,.13,.7]){const d=cpu([x*radius,y*radius,z*radius],r.parameterValues).dist;if(Number.isFinite(d)&&Math.abs(d)<1e20)finite++;if(d>0)positive++;}
 if(finite<25||positive===0)throw Error('Numerically unstable or completely filled sample domain (27 limited CPU samples).');
 return {recipe:structuredClone(recipe),scene,signature:discoveryHash(JSON.stringify([recipe.chain,recipe.rounds]))};
}

export function generateDiscoveryBatch(formulas:readonly Formula[],options:DiscoveryOptions,parent?:DiscoveryRecipe,catalog=buildDiscoveryCatalog(formulas)):DiscoveryBatch {
 checkOptions(options);const seed=normalizedDiscoverySeed(options.seed),rng=new Random(seed.value);
 const allowed=catalog.entries.filter(e=>e.eligible&&(options.mode!=='family'||e.id===options.family)&&(options.mode!=='hybrid'||options.maxSteps===2&&e.modes.includes('hybrid')));
 if(!allowed.length)throw Error('No compatible family in this selection.');
 if(parent&&(parent.catalogFingerprint!==catalog.fingerprint||parent.family!==options.family||options.mode!=='family'))throw Error('Variants around the chosen candidate require the same family/catalogue.');
 const pool=[...allowed];for(let i=pool.length-1;i>0;i--){const j=rng.int(0,i);[pool[i],pool[j]]=[pool[j]!,pool[i]!];}
 const candidates:DiscoveryCandidate[]=[],rejected:DiscoveryBatch['rejected']=[],signatures=new Set<string>();
 for(let slot=0;slot<options.count;slot++){
  const entry=pool[slot%pool.length]!,formula=formulas.find(f=>f.id===entry.id)!;let accepted=false,last='';
  for(let attempt=0;attempt<3;attempt++){
   const random=new Random(attemptSeed(seed.value,slot*3+attempt)),step=variation(entry,formula,random,options.strength,parent);let rounds=1,chain=[step];
   if(options.mode==='hybrid'){
    const partner=random.pick(allowed.filter(e=>e.id!==entry.id));if(!partner){last='Needs two different compatible main formulas';break;}
    chain=[variation(partner,formulas.find(f=>f.id===partner.id)!,random,options.strength),step];chain.forEach(s=>s.iterations=1);rounds=6;
   }else if(options.maxSteps===2&&entry.modes.includes('rotation')&&(entry.controls.every(c=>c.kind==='fixed')||random.chance(.5))){
    const rotate=defaultStep(formulas.find(f=>f.id==='rotate')!);rotate.iterations=1;for(const p of ['ax','ay','az'])rotate.parameters[p]=Math.round(random.range(-30,30)*options.strength*100)/100;chain=[rotate,step];
   }
   const body={version:DISCOVERY_VERSION as typeof DISCOVERY_VERSION,catalogFingerprint:catalog.fingerprint,seed:seed.text,seed32:seed.value,slot,mode:options.mode,strength:options.strength,maxSteps:options.maxSteps,family:entry.id,...(parent?{parentId:parent.id}:{}),chain:chain.map(({formula,iterations,parameters})=>({formula,iterations:iterations!,parameters})),rounds};
   const recipe:DiscoveryRecipe={...body,id:discoveryHash(JSON.stringify(body))};
   try{const candidate=candidateFromRecipe(recipe,formulas,catalog);if(signatures.has(candidate.signature)){last='The same structure/parameters as an earlier candidate';continue;}signatures.add(candidate.signature);candidates.push(candidate);accepted=true;break;}catch(e){last=e instanceof Error?e.message:String(e);}
  }
  if(!accepted)rejected.push({slot,reason:last});
 }
 return {options:structuredClone(options),catalogFingerprint:catalog.fingerprint,candidates,rejected};
}

/** Explicit replacement transaction. Old mathematical targets stay unresolved; no hidden retarget/conversion. */
export function applyDiscoveryCandidate(base:Scene,candidate:DiscoveryCandidate,formulas:readonly Formula[],makeId:()=>string,frameCamera:boolean):Scene {
 if(base.animation.keyframes.length)throw Error('Legacy keys must be empty before the chain is replaced; no automatic conversion is made.');
 const checked=candidateFromRecipe(candidate.recipe,formulas),used=new Set([...base.content.flatMap(c=>[c.id,...c.chain.map(s=>s.id)]),...propertyTracks(base.cameraFlight).flatMap(t=>t.target.kind==='formula-parameter'?[t.target.contentId,t.target.stepId]:t.target.kind==='julia'?[t.target.contentId]:[])]);
 const fresh=()=>{const id=makeId();if(!/^[-\w]{1,64}$/.test(id)||used.has(id))throw Error('New instance IDs must be valid and unique.');used.add(id);return id;};
 const c=checked.scene.content[0]!;const content=[{...structuredClone(c),id:fresh(),chain:c.chain.map(s=>({...structuredClone(s),id:fresh()}))}];
 const cameraErrors:string[]=[];const camera=readSceneCamera(candidate.scene.camera,'candidate.camera',cameraErrors);if(!camera)throw Error(cameraErrors.join('; '));
 return {...base,content,...(frameCamera&&!base.composition?.locked?{camera:structuredClone(camera)}:{})};
}
