/**
 * GEO-DETAIL-COMPAT-02, WP4 step 4. Whole-field parity: the DS distance function `geoDS` of a complete mapped-field scene against
 * the float64 TypeScript reference (`compileMappedFieldOrbit`, the same code the CPU path uses). This is what proves that
 * orbit helpers (uncounted steps) are handled like the reference: call order, count, bailout and the preserved analytic w.
 * Pure module; `tests/gpu/dsParity.ts` runs the shader.
 */
import type {ResolvedScene} from './scene';
import {toChainSteps} from './scene';
import {dsArithmetic,doubleSingleField,dsDefinition} from './geometryDoubleSingle';
import {KERNEL_PRIMITIVES_WGSL} from './formula/kernelWgsl';
import {KERNELS} from './formula/kernels';
import {FIELD_MAP_WGSL} from './fieldMaps';
import {compileMappedFieldOrbit} from './formula/groupExecution';
import type {MappedFieldExecution} from './formula/groupExecution';

/** Compute shader: input 2 vec4f per point (hi xyz, lo xyz), output 1 vec4f per point (distance hi, lo, count+best, h). */
export function dsFieldParityShader(r:ResolvedScene,product:'fma'|'split'='split'):string{
  const def=dsDefinition(r,true);
  const usesMaps=r.chain.some(c=>KERNELS[c.formula.kernel!].fieldMapParameter);
  return KERNEL_PRIMITIVES_WGSL+'\n'+(usesMaps?FIELD_MAP_WGSL+'\n':'')+doubleSingleField(def,product,true)+`
@group(0) @binding(0) var<storage,read> pts:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> outp:array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
  if(id.x>=arrayLength(&pts)/2u){return;}
  let a=pts[2u*id.x];let b=pts[2u*id.x+1u];
  let r=geoDS(DSP(vec2f(a.x,b.x),vec2f(a.y,b.y),vec2f(a.z,b.z)));
  outp[id.x]=vec4f(r.d.x,r.d.y,r.core.y,r.core.z);
}
`;
}
// keep the unused-import linter honest: the arithmetic prelude is part of doubleSingleField's output
void dsArithmetic;

/** Reference distance at a point (float64, full finite field: no early exit), or undefined where the reference is invalid. */
export function dsFieldReference(r:ResolvedScene):(p:readonly number[])=>number|undefined{
  const orbit=compileMappedFieldOrbit(toChainSteps(r),r.execution as MappedFieldExecution,false,r.scene.formulaFields??[]);
  return p=>{const o=orbit(p,r.parameterValues,r.julia.slice(0,3),0,{allFieldIterations:true});return o.invalid||!Number.isFinite(o.distance)?undefined:o.distance;};
}

export interface DsFieldStats {n:number;compared:number;skipped:number;maxError:number;p99Error:number;worstIndex:number}
/** Scaled error |ds - ref| / max(1, |ref|); points where the reference is invalid or the DS returns its 1e20 failure sentinel are skipped and counted. */
export function dsFieldCompare(points:readonly (readonly number[])[],ref:(p:readonly number[])=>number|undefined,gpu:Float32Array):DsFieldStats{
  const errors:number[]=[];let skipped=0,worst=0,worstIndex=-1;
  points.forEach((p,i)=>{
    const want=ref(p),got=gpu[i*4]!+gpu[i*4+1]!;
    if(want===undefined||Math.abs(got)>=1e19||Math.abs(want)>=1e19){skipped++;return;}
    const err=Number.isFinite(got)?Math.abs(got-want)/Math.max(1,Math.abs(want)):Infinity;
    errors.push(err);if(err>worst){worst=err;worstIndex=i;}
  });
  const sorted=[...errors].sort((a,b)=>a-b);
  return {n:points.length,compared:errors.length,skipped,maxError:sorted.at(-1)??0,p99Error:sorted[Math.floor(sorted.length*0.99)]??0,worstIndex};
}
