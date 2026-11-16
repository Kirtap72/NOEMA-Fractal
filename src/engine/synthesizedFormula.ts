import type {Formula,Step,Variable} from './formula/types';
import {generateChain} from './formula/chain';
import {compileChainCpu} from './formula/cpu';
import {Random,attemptSeed} from './randomChain';
import {discoveryHash} from './discoveryCatalog';
import {normalizedDiscoverySeed} from './discoveryCandidates';

export const SYNTHESIS_VERSION='FG2B-1',SYNTHESIS_PREFIX='discovered-formula-';
export type MathNode=
 | {kind:'fold';fold:'abs'|'tetra'|'octa';axes?:'xyz'|'xy'|'xz'|'yz'}
 | {kind:'permute';order:'yzx'|'zxy'|'xzy'}
 | {kind:'rotate';axis:'x'|'y'|'z';angle:number}
 | {kind:'translate';offset:[number,number,number]}
 | {kind:'expand';scale:number;center:[number,number,number]};
export interface SynthesizedDefinition {
 version:typeof SYNTHESIS_VERSION;id:string;fingerprint:string;structureFingerprint:string;
 seed:string;catalogFingerprint:string;name:string;nodes:MathNode[];iterations:number;radius:number;
 parent?:{id:string;fingerprint:string};mutation:'original'|'structural'|'parameters';
 provenance:{author:string;source:string;reviewed:false;de:'finite-lipschitz-bound'};
}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fields(o:Record<string,unknown>,keys:string[]){if(Object.keys(o).some(k=>!keys.includes(k)))throw Error('Unsupported AST field');}
const number=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const vector=(v:unknown,min:number,max:number):v is [number,number,number]=>Array.isArray(v)&&v.length===3&&v.every(x=>number(x,min,max));
function canonicalNodes(nodes:MathNode[]):MathNode[]{return nodes.map(n=>{
 switch(n.kind){case 'fold':return {kind:n.kind,fold:n.fold,...(n.fold==='abs'?{axes:n.axes??'xyz'}:{})};case 'permute':return {kind:n.kind,order:n.order};case 'rotate':return {kind:n.kind,axis:n.axis,angle:n.angle};case 'translate':return {kind:n.kind,offset:[...n.offset]};case 'expand':return {kind:n.kind,scale:n.scale,center:[...n.center]};}
});}
export function mathematicalStructure(nodes:MathNode[]):unknown[]{return canonicalNodes(nodes).map(n=>n.kind==='fold'||n.kind==='permute'?n:n.kind==='rotate'?{kind:n.kind,axis:n.axis}:{kind:n.kind});}
function identity(nodes:MathNode[],iterations:number,radius:number){const fingerprint=discoveryHash(JSON.stringify([SYNTHESIS_VERSION,canonicalNodes(nodes),iterations,radius]));return {fingerprint,id:SYNTHESIS_PREFIX+fingerprint,structureFingerprint:discoveryHash(JSON.stringify([SYNTHESIS_VERSION,mathematicalStructure(nodes)]))};}

/** Imported AST is data: no expressions, shader fragments, user functions or recursive nodes. */
export function readSynthesizedDefinition(raw:unknown):SynthesizedDefinition {
 if(!plain(raw))throw Error('Missing mathematical AST');
 fields(raw,['version','id','fingerprint','structureFingerprint','seed','catalogFingerprint','name','nodes','iterations','radius','parent','mutation','provenance']);
 if(raw.version!==SYNTHESIS_VERSION||typeof raw.seed!=='string'||raw.seed.length>128||typeof raw.catalogFingerprint!=='string'||!/^[a-f0-9]{8}$/.test(raw.catalogFingerprint)||typeof raw.name!=='string'||raw.name.length<1||raw.name.length>120)throw Error('Invalid mathematical AST version/metadata');
 if(!Number.isInteger(raw.iterations)||!number(raw.iterations,6,16)||!number(raw.radius,.5,2)||!Array.isArray(raw.nodes)||raw.nodes.length<3||raw.nodes.length>6)throw Error('AST exceeds bounded iteration/node budget');
 for(const n of raw.nodes){if(!plain(n))throw Error('Invalid AST node');switch(n.kind){
  case 'fold':fields(n,['kind','fold','axes']);if(!['abs','tetra','octa'].includes(String(n.fold))||n.fold==='abs'&&!['xyz','xy','xz','yz'].includes(String(n.axes??'xyz'))||n.fold!=='abs'&&n.axes!==undefined)throw Error('Unsupported fold');break;
  case 'permute':fields(n,['kind','order']);if(!['yzx','zxy','xzy'].includes(String(n.order)))throw Error('Unsupported permutation');break;
  case 'rotate':fields(n,['kind','axis','angle']);if(!['x','y','z'].includes(String(n.axis))||!number(n.angle,-40,40))throw Error('Unsafe rotation');break;
  case 'translate':fields(n,['kind','offset']);if(!vector(n.offset,-.6,.6))throw Error('Unsafe translation');break;
  case 'expand':fields(n,['kind','scale','center']);if(!number(n.scale,1.8,2.8)||!vector(n.center,-1.5,1.5))throw Error('Unsafe expansion');break;
  default:throw Error('Unsupported mathematical operation');
 }}
 if(raw.nodes.reduce((count,n)=>count+(n.kind==='rotate'?1:n.kind==='translate'?3:n.kind==='expand'?4:0),1)>16)throw Error('AST parameter budget exceeded');
 if(raw.nodes.filter(n=>n.kind==='expand').length!==1||!raw.nodes.some(n=>n.kind==='fold')||raw.nodes.at(-1).kind!=='expand')throw Error('A bounded orbit needs folds and one final expansion');
 if(!['original','structural','parameters'].includes(String(raw.mutation)))throw Error('Invalid ancestry');
 if(raw.parent!==undefined){if(!plain(raw.parent))throw Error('Invalid parent');fields(raw.parent,['id','fingerprint']);if(typeof raw.parent.id!=='string'||raw.parent.id!==SYNTHESIS_PREFIX+raw.parent.fingerprint||typeof raw.parent.fingerprint!=='string'||!/^[a-f0-9]{8}$/.test(raw.parent.fingerprint))throw Error('Invalid parent identity');}
 if(!plain(raw.provenance)||raw.provenance.author!=='unknown'||raw.provenance.source!=='NOEMA bounded geometric AST synthesis; textbook geometry'||raw.provenance.reviewed!==false||raw.provenance.de!=='finite-lipschitz-bound')throw Error('Invalid provenance/DE contract');fields(raw.provenance,['author','source','reviewed','de']);
 const nodes=canonicalNodes(raw.nodes as MathNode[]),ids=identity(nodes,raw.iterations as number,raw.radius);
 if(raw.id!==ids.id||raw.fingerprint!==ids.fingerprint||raw.structureFingerprint!==ids.structureFingerprint)throw Error('Mathematical fingerprint mismatch');
 return structuredClone({...raw,nodes}) as unknown as SynthesizedDefinition;
}
export function describeSynthesizedDefinition(d:SynthesizedDefinition):string {
 return d.nodes.map((n,i)=>`${i+1}. `+(n.kind==='fold'?`fold ${n.fold}${n.axes?' '+n.axes:''}`:n.kind==='permute'?`z → z.${n.order}`:n.kind==='rotate'?`rotation ${n.axis}, ${n.angle}°`:n.kind==='translate'?`z → z + (${n.offset.join(', ')})`:`z → ${n.scale} z − (${n.center.join(', ')}) (${n.scale} − 1)`)).join('\n')+`\nRepeat ${d.iterations} times; D = (|z| − ${d.radius}) / L. Finite iteration approximation, no exact SDF.`;
}

/** Fixed templates only. The existing whitelist compiler validates every expression again. */
export function compileSynthesizedDefinition(input:SynthesizedDefinition):Formula {
 const d=readSynthesizedDefinition(input),parameters:Formula['parameters']=[],steps:Step[]=[],variables:Variable[]=[{name:'z',type:'vec3',init:'pos'},{name:'dr',type:'float',init:'1'},{name:'tmp',type:'vec3',init:'vec3(0,0,0)'}];
 const assign=(target:string,expr:string)=>steps.push({kind:'assign',target,op:'=',expr});
 const param=(i:number,name:string,value:number,min:number,max:number)=>{const id='n'+i+'_'+name;parameters.push({name:id,label:(i+1)+' '+name,default:value,min,max});return id;};
 d.nodes.forEach((n,i)=>{switch(n.kind){
  case 'fold':if(n.fold==='abs')assign('z',n.axes==='xyz'?'abs(z)':`vec3(${['x','y','z'].map(a=>n.axes!.includes(a)?`abs(z.${a})`:`z.${a}`).join(',')})`);
   else if(n.fold==='tetra'){assign('z','select(z,vec3(-z.y,-z.x,z.z),z.x+z.y < 0)');assign('z','select(z,vec3(-z.z,z.y,-z.x),z.x+z.z < 0)');assign('z','select(z,vec3(z.x,-z.z,-z.y),z.y+z.z < 0)');}
   else{assign('z','abs(z)');assign('z','select(z,z.yxz,z.x < z.y)');assign('z','select(z,z.zyx,z.x < z.z)');assign('z','select(z,z.xzy,z.y < z.z)');}break;
  case 'permute':assign('z','z.'+n.order);break;
  case 'rotate':{const a=param(i,'angle',n.angle,-40,40),t=`(${a} * pi / 180)`,c=`cos(${t})`,s=`sin(${t})`;assign('tmp','z');assign('z',n.axis==='x'?`vec3(tmp.x,${c}*tmp.y-${s}*tmp.z,${s}*tmp.y+${c}*tmp.z)`:n.axis==='y'?`vec3(${c}*tmp.x+${s}*tmp.z,tmp.y,-${s}*tmp.x+${c}*tmp.z)`:`vec3(${c}*tmp.x-${s}*tmp.y,${s}*tmp.x+${c}*tmp.y,tmp.z)`);break;}
  case 'translate':{const v=n.offset.map((v,j)=>param(i,'offset_'+['x','y','z'][j],v,-.6,.6));assign('z','z + vec3('+v.join(',')+')');break;}
  case 'expand':{const s=param(i,'scale',n.scale,1.8,2.8),v=n.center.map((v,j)=>param(i,'center_'+['x','y','z'][j],v,-1.5,1.5));assign('z',`z * ${s} - vec3(${v.join(',')}) * (${s} - 1)`);assign('dr',`dr * ${s}`);break;}
 }});
 if(parameters.length>=16)throw Error('AST parameter budget exceeded');parameters.push({name:'end_radius',label:'Radius of the final domain',default:d.radius,min:.5,max:2});
 const formula:Formula={id:d.id,name:d.name,description:describeSynthesizedDefinition(d),catalog:{category:'ifs',family:'Synthesized geometric orbit',tags:['discovered','finite-bound']},credits:[{name:'unknown',role:'Automatically composed definition; no claim of global novelty',status:'unverified'},{name:'General mathematics (textbook)',role:'Folds, isometries, affine maps and Lipschitz composition',status:'unverified'}],sources:[{reference:d.provenance.source,status:'unverified'}],addedBy:'FG2B typed synthesis',mathStatus:'Original composition of textbook operations. Finite Lipschitz field bound; not exact fractal SDF.',reviewed:false,parameters,iterations:d.iterations,variables,steps,distance:'(length(z) - end_radius) / max(dr, 0.000001)',orbitPoint:'z',carry:['z','dr'],cameraDistance:5};
 const generated=generateChain([{formula,iterations:d.iterations}],1);if(!generated.ok)throw Error(generated.errors.join('; '));return formula;
}
export function expressionSignature(f:Formula):string{return JSON.stringify([f.variables,f.steps,f.distance,f.carry]);}
export function synthesizedLibrary(definitions:readonly SynthesizedDefinition[]|undefined,installed:readonly Formula[]):Formula[]{
 if(!definitions?.length)return [...installed];if(definitions.length>32)throw Error('Scene embedded AST budget exceeded');
 const result=[...installed];for(const d of definitions){const f=compileSynthesizedDefinition(d),known=result.find(x=>x.id===f.id);if(known&&(expressionSignature(known)!==expressionSignature(f)||JSON.stringify(known.parameters)!==JSON.stringify(f.parameters)))throw Error('Discovered identity collision');if(!known)result.push(f);}return result;
}
export interface SynthesisOptions {seed:string|number;count:number;maxNodes:4|6;strength:number}
export function generateSynthesisBatch(library:readonly Formula[],catalogFingerprint:string,options:SynthesisOptions,parent?:SynthesizedDefinition):{definitions:SynthesizedDefinition[];rejected:{slot:number;reason:string}[]}{
 const seed=normalizedDiscoverySeed(options.seed);if(!Number.isInteger(options.count)||options.count<1||options.count>8||![4,6].includes(options.maxNodes)||!number(options.strength,0,1))throw Error('Unsafe synthesis options');if(parent){parent=readSynthesizedDefinition(parent);if(parent.nodes.length>options.maxNodes)throw Error('Parent needs extended complexity');}
 const seen=new Set<string>(),structural=new Set<string>(),definitions:SynthesizedDefinition[]=[],rejected:{slot:number;reason:string}[]=[];
 const installed=new Set(library.map(expressionSignature));
 for(let slot=0;slot<options.count;slot++){let reason='No distinct bounded structure';for(let attempt=0;attempt<3;attempt++){
  const rng=new Random(attemptSeed(seed.value,slot*3+attempt)),round=(x:number)=>Number(x.toFixed(4));
  let nodes:MathNode[]=[{kind:'fold',fold:rng.pick(['abs','tetra','octa'] as const),axes:undefined}];if(nodes[0]!.kind==='fold'&&nodes[0]!.fold==='abs')nodes[0]!.axes=rng.pick(['xyz','xy','xz','yz'] as const);
  const extras:MathNode[]=[{kind:'rotate',axis:rng.pick(['x','y','z'] as const),angle:round(rng.range(-20,20)*options.strength)},{kind:'permute',order:rng.pick(['yzx','zxy','xzy'] as const)},{kind:'translate',offset:[round(rng.range(-.12,.12)),round(rng.range(-.12,.12)),round(rng.range(-.12,.12))]}];
  if(rng.chance(.5))extras.reverse();nodes.push(...extras.slice(0,options.maxNodes===6?rng.int(2,3):rng.int(1,2)),{kind:'expand',scale:round(rng.range(1.95,2.2)),center:[1,1,1]});
  let mutation:SynthesizedDefinition['mutation']='original';
  if(parent){nodes=structuredClone(parent.nodes);mutation=slot%3===0?'parameters':'structural';if(mutation==='parameters'){const e=nodes.find(n=>n.kind==='expand')!;if(e.kind==='expand')e.scale=Math.max(1.8,Math.min(2.8,round(e.scale+rng.range(-.15,.15)*options.strength)));const r=nodes.find(n=>n.kind==='rotate');if(r?.kind==='rotate')r.angle=Math.max(-40,Math.min(40,round(r.angle+rng.range(-10,10)*options.strength)));}else{const folds=nodes.filter(n=>n.kind==='fold');if(slot%2===0&&nodes.length<options.maxNodes)nodes.splice(nodes.length-1,0,{kind:'permute',order:rng.pick(['yzx','zxy','xzy'] as const)});else{const f=folds[0]!;if(f.kind==='fold'){f.fold=rng.pick((['abs','tetra','octa'] as const).filter(v=>v!==f.fold));if(f.fold==='abs')f.axes=rng.pick(['xyz','xy','xz','yz'] as const);else delete f.axes;}}}}
  const ids=identity(nodes,parent?.iterations??12,parent?.radius??1.2),definition:SynthesizedDefinition={version:SYNTHESIS_VERSION,...ids,seed:seed.text,catalogFingerprint,name:'Discovery '+ids.fingerprint,nodes:canonicalNodes(nodes),iterations:parent?.iterations??12,radius:parent?.radius??1.2,mutation,...(parent?{parent:{id:parent.id,fingerprint:parent.fingerprint}}:{}),provenance:{author:'unknown',source:'NOEMA bounded geometric AST synthesis; textbook geometry',reviewed:false,de:'finite-lipschitz-bound'}};
  try{const f=compileSynthesizedDefinition(definition);if(installed.has(expressionSignature(f))||seen.has(ids.fingerprint)||!parent&&structural.has(ids.structureFingerprint)||parent&&ids.fingerprint===parent.fingerprint)throw Error('Duplicate or registered structure');
   const cpu=compileChainCpu([{formula:f,iterations:f.iterations}],1,{round32:true}),params=f.parameters.map(p=>p.default);for(const v of [[0,0,0],[.1,.2,.3],[-1,1,1],[3,2,1],[10,-4,6]])if(!Number.isFinite(cpu(v,params).dist))throw Error('Nonfinite CPU orbit');
   seen.add(ids.fingerprint);structural.add(ids.structureFingerprint);definitions.push(definition);reason='';break;
  }catch(e){reason=(e as Error).message;}
 }if(reason)rejected.push({slot,reason});}
 return {definitions,rejected};
}
