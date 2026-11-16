/** Counted dIFS shapes interspersed with uncounted transforms. No format-specific identities. */
import type {ChainStep,ChainMode,ChainResult} from './chain';
import type {BoundedSequenceExecution,ChainGroup} from './groupExecution';
import {groupExecutionErrors} from './groupExecution';
import {KERNELS,freshKernelState,prepareKernel,stepKernel} from './kernels';
import type {KernelParameters} from './kernels';
import {kernelBody,kernelMatrices,KERNEL_PRIMITIVES_WGSL} from './kernelWgsl';
import {createFieldSampler,FIELD_MAP_WGSL} from '../fieldMaps';
import type {FieldMap} from '../fieldMaps';

export function difsExecutionErrors(steps:readonly ChainStep[],rounds:number,mode:ChainMode,e:BoundedSequenceExecution):string[]{
  const errors=groupExecutionErrors(e,steps.length);
  if(rounds!==1||mode!=='sequence'||steps.some(s=>(s.every??1)!==1||(s.start??0)!==0))errors.push('dIFS execution cannot combine with rounds/schedules');
  if(steps.some(s=>!s.formula.kernel||KERNELS[s.formula.kernel].dimension!==3||KERNELS[s.formula.kernel].method!=='difs'||
    (KERNELS[s.formula.kernel].role ? KERNELS[s.formula.kernel].role!=='difs-transform'||KERNELS[s.formula.kernel].hints.deoption!==21 : KERNELS[s.formula.kernel].hints.deoption!==20)))errors.push('dIFS execution requires exact 3D shapes and uncounted transforms');
  if(!errors.length&&!steps.slice(e.groups[0]!.repeat,e.groups[0]!.end+1).some(s=>!KERNELS[s.formula.kernel!].role))errors.push('dIFS repeat suffix needs a counted shape');
  return errors;
}
export function difsCallOrder(steps:readonly ChainStep[],g:ChainGroup):number[]{
  const calls:number[]=[];let count=0,slot=g.start,remaining=steps[slot]!.iterations;
  while(count<g.maxIterations){
    calls.push(slot);if(!KERNELS[steps[slot]!.formula.kernel!].role)count++;
    if(--remaining===0){slot=slot===g.end?g.repeat:slot+1;remaining=steps[slot]!.iterations;}
    // Bounds follow validated 8-slot, 64-quota and 256-count budgets; also guard direct utility misuse.
    if(calls.length>131072)throw Error('nonterminating dIFS group');
  }return calls;
}
export function compileDifsOrbit(steps:readonly ChainStep[],e:BoundedSequenceExecution,round32=false,maps:readonly FieldMap[]=[]){
  const errors=difsExecutionErrors(steps,1,'sequence',e);if(errors.length)throw Error(errors.join('; '));
  const order=difsCallOrder(steps,e.groups[0]!),sampler=createFieldSampler(maps),r=round32?Math.fround:(x:number)=>x;
  let previous:number[]=[],prepared:ReturnType<typeof prepareKernel>[]=[];
  return(point:readonly number[],params:readonly number[],julia:readonly number[]|null=null,threshold=0)=>{
    if(!prepared.length||params.length!==previous.length||params.some((v,i)=>v!==previous[i])){
      let offset=0;prepared=steps.map(step=>{const p:KernelParameters={};for(const d of step.formula.parameters)p[d.name]=r(params[offset++]!);return prepareKernel(step.formula.kernel!,p,sampler);});previous=[...params];
    }
    const pos=point.slice(0,3).map(r),s=freshKernelState([pos[0]!,pos[1]!,pos[2]!,1],[...(julia??pos).slice(0,3).map(r),0] as [number,number,number,number],3);
    s.first=false;s.trap=65535;s.queryThreshold=r(threshold*1.03);s.mapPadding=s.queryThreshold;
    const calls:number[]=[];
    for(const slot of order){
      calls.push(slot);stepKernel(prepared[slot]!,s);
      if(round32){s.v=s.v.map(r) as typeof s.v;s.fieldValue=r(s.fieldValue);s.varyScale=r(s.varyScale);s.free=s.free.map(r) as typeof s.free;}
      if(s.invalid)break;if(KERNELS[steps[slot]!.formula.kernel!].role)continue;
      s.count++;const d=r(s.fieldValue/s.varyScale);
      if(!Number.isFinite(d)){s.invalid=true;break;}
      if(d<s.bestDistance){s.bestDistance=d;s.bestIteration=s.count;s.free[1]=s.free[0];if(e.fieldStop!=='all'&&d<s.queryThreshold)break;}
    }
    s.trap=s.free[1];return {state:s,calls,dist:s.invalid?Infinity:s.bestDistance,iterations:s.bestIteration,trap:s.trap,invalid:s.invalid};
  };
}
export function generateDifsChain(steps:readonly ChainStep[],rounds:number,mode:ChainMode,e:BoundedSequenceExecution):ChainResult{
  const errors=difsExecutionErrors(steps,rounds,mode,e);if(errors.length)return {ok:false,errors};
  let offset=0;const declarations:string[]=[];
  const cases=steps.map((step,slot)=>{
    const indices=new Map(step.formula.parameters.map((p,k)=>[p.name,offset+k]));offset+=step.formula.parameters.length;
    const p=(key:string)=>{const i=indices.get(key)!;return `u.params[${Math.floor(i/4)}].${'xyzw'[i%4]}`;};
    const m=kernelMatrices(step.formula.kernel!,p,'dfm'+slot);declarations.push(...m.declarations);
    return `case ${slot}:{${kernelBody(step.formula.kernel!,p,m.args.map(a=>a.name))}counted=${!KERNELS[step.formula.kernel!].role};}`;
  }).join('\n');
  const g=e.groups[0]!,hasFields=steps.some(s=>KERNELS[s.formula.kernel!].fieldMapParameter),maxCalls=difsCallOrder(steps,g).length;
  return {ok:true,totalIterations:g.maxIterations,wgsl:`${KERNEL_PRIMITIVES_WGSL}\n${hasFields?FIELD_MAP_WGSL:''}
const FORMULA_ITERATIONS:f32=${g.maxIterations}.0;
fn formulaCoreAtThreshold(pos:vec3f,threshold:f32)->vec3f{
 ${declarations.join('\n')}
 var s:KernelOrbit;s.v=vec4f(pos,1.0);s.c=vec4f(select(pos,u.julia.xyz,u.julia.w>0.5),0.0);s.original=pos;s.derivative=1.0;s.varyScale=1.0;s.bestDistance=65535.0;s.queryThreshold=threshold*1.03;s.mapPadding=s.queryThreshold;
 var slot=${g.start};var remaining=${steps[g.start]!.iterations};
 for(var call=0;call<${maxCalls};call++){
  var counted=false;switch slot{${cases}default:{s.invalid=true;}}
  if(s.invalid||!kernelFinite(s.field)||!kernelFinite(s.varyScale)||!kernelFinite(s.free.x)||!kernelFinite(s.v.x)||!kernelFinite(s.v.y)||!kernelFinite(s.v.z)){s.invalid=true;break;}
  if(counted){s.count+=1.0;let d=s.field/s.varyScale;if(!kernelFinite(d)){s.invalid=true;break;}if(d<s.bestDistance){s.bestDistance=d;s.bestIteration=s.count;s.free.y=s.free.x;${e.fieldStop==='all'?'':'if(d<s.queryThreshold){break;}'}}if(s.count>=${g.maxIterations}.0){break;}}
  remaining--;if(remaining==0){slot++;if(slot>${g.end}){slot=${g.repeat};}switch slot{${steps.map((s,i)=>`case ${i}:{remaining=${s.iterations};}`).join('\n')}default:{s.invalid=true;}}}
 }
 if(s.invalid){return vec3f(1e20,s.count,s.free.y);}return vec3f(s.bestDistance,s.bestIteration,s.free.y);
}
fn formulaCore(pos:vec3f)->vec3f{return formulaCoreAtThreshold(pos,0.0);}
fn formulaDistance(pos:vec3f)->f32{return formulaCore(pos).x;}
`};
}
