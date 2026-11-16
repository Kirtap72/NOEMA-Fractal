/**
 * GEO-DETAIL-COMPAT-02, WP4 step 3. Parity harness: does a kernel's double-single (DS) WGSL function compute what the float64
 * TypeScript reference computes? Pure module (no DOM, no GPU): it builds the compute shader text, the input buffer, the f64
 * reference results and the error statistics. `tests/gpu/dsParity.ts` runs the shader on the GPU.
 *
 * Reference = `stepKernel` in float64 (no Math.fround on inputs), the same stepper `compileMappedFieldCpu` uses.
 */
import {DS_KERNEL_REGISTRY} from './geometryDsRegistry';
import type {DsEmitContext,DsStep} from './geometryDsRegistry';
import {dsArithmetic} from './geometryDoubleSingle';
import {freshKernelState,prepareKernel,stepKernel} from './formula/kernels';
import type {KernelId} from './formula/kernels';
import type {V4} from './formula/primitives';

/** One test case: a kernel, its parameter values and the Julia constant the orbit adds. */
export interface DsParityCase {id:string;parameters:Record<string,number>;julia:[number,number,number];name:string}

export function dsParityStep(c:DsParityCase):DsStep{
  const prepared=prepareKernel(c.id as KernelId,c.parameters);
  return {id:c.id,iterations:1,parameters:{...c.parameters},matrices:prepared.matrices};
}

/** The compute shader: input = 2 vec4f per point (hi lanes x,y,z,w; lo lanes), output the same layout. */
export function dsParityShader(c:DsParityCase,product:'fma'|'split'='split',mutate?:(wgsl:string)=>string):string{
  const kernel=DS_KERNEL_REGISTRY[c.id];if(!kernel||kernel.role==='field')throw Error('No DS orbit function for '+c.id);
  const ctx:DsEmitContext={sourceParameters:true,julia:[...c.julia,1]};
  let fn=kernel.emit(dsParityStep(c),0,ctx);
  if(mutate)fn=mutate(fn);
  return dsArithmetic(product)+`
struct DSOrbit{v:DSP,w:vec2f}
`+fn+`
@group(0) @binding(0) var<storage,read> pts:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> outp:array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
  if(id.x>=arrayLength(&pts)/2u){return;}
  let a=pts[2u*id.x];let b=pts[2u*id.x+1u];
  let v=DSP(vec2f(a.x,b.x),vec2f(a.y,b.y),vec2f(a.z,b.z));
  let r=dsOrbit0(v,vec2f(a.w,b.w));
  outp[2u*id.x]=vec4f(r.v.x.x,r.v.y.x,r.v.z.x,r.w.x);
  outp[2u*id.x+1u]=vec4f(r.v.x.y,r.v.y.y,r.v.z.y,r.w.y);
}
`;
}

/** Deterministic input points: random in [-extent,extent]^3 with analytic w = 1, plus edge cases. */
export function dsParityPoints(count:number,extent=3,seed=12345):V4[]{
  let s=seed>>>0;const rnd=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296*2-1;};
  const pts:V4[]=[];
  const edge=[0,-0,1,-1,0.5,-0.5,1e-6,-1e-6,2,-2,1e3,-1e3,0.67,-0.67,3.9999,-3.9999];
  for(const a of edge)for(const b of [0,0.3,-1.7])pts.push([a,b,a*0.5-b,1]);
  while(pts.length<count)pts.push([rnd()*extent,rnd()*extent,rnd()*extent,1+rnd()*0.5]);
  return pts.slice(0,count);
}

/** Split an f64 into the (hi, lo) f32 pair the DS arithmetic consumes. */
export function dsSplit(x:number):[number,number]{const hi=Math.fround(x);return [hi,Math.fround(x-hi)];}

export function dsParityInput(points:readonly V4[]):Float32Array{
  const out=new Float32Array(points.length*8);
  points.forEach((p,i)=>{for(let k=0;k<4;k++){const [hi,lo]=dsSplit(p[k]!);out[i*8+k]=hi;out[i*8+4+k]=lo;}});
  return out;
}

/** The float64 reference: one orbit call of the kernel on the point (state.v = [x, y, z, analytic w]). */
export function dsReferenceStep(c:DsParityCase,p:V4):{v:V4;invalid:boolean}{
  const prepared=prepareKernel(c.id as KernelId,c.parameters);
  const state=freshKernelState([...p] as V4,[c.julia[0],c.julia[1],c.julia[2],c.parameters.constant_w??0] as V4,3);
  stepKernel(prepared,state);
  return {v:[...state.v] as V4,invalid:state.invalid};
}

export interface DsParityStats {n:number;compared:number;skipped:number;maxError:number;p99Error:number;worstIndex:number;worstComponent:number;perComponentMax:number[]}

/** Error is scaled: |ds - ref| / max(1, |ref|). Points where the f64 reference is invalid or non-finite are skipped and counted. */
export function dsParityCompare(c:DsParityCase,points:readonly V4[],gpu:Float32Array):DsParityStats{
  const errors:number[]=[],per=[0,0,0,0];let skipped=0,worst=0,worstIndex=-1,worstComponent=-1;
  points.forEach((p,i)=>{
    const ref=dsReferenceStep(c,p);
    if(ref.invalid||!ref.v.every(Number.isFinite)||ref.v.some(x=>Math.abs(x)>1e30)){skipped++;return;}
    for(let k=0;k<4;k++){
      const got=gpu[i*8+k]!+gpu[i*8+4+k]!; // hi + lo summed in f64
      const err=Number.isFinite(got)?Math.abs(got-ref.v[k]!)/Math.max(1,Math.abs(ref.v[k]!)):Infinity;
      errors.push(err);per[k]=Math.max(per[k]!,err);
      if(err>worst){worst=err;worstIndex=i;worstComponent=k;}
    }
  });
  const sorted=[...errors].sort((x,y)=>x-y);
  return {n:points.length,compared:errors.length/4,skipped,maxError:sorted.at(-1)??0,p99Error:sorted[Math.floor(sorted.length*0.99)]??0,worstIndex,worstComponent,perComponentMax:per};
}

/** The cases the harness runs. `defaults(id)` returns the formula's default parameters (from the formula library). */
export function dsParityCases(defaults:(id:string)=>Record<string,number>):DsParityCase[]{
  const J:[number,number,number]=[0.4,-0.2,0.1];
  const c=(id:string,name:string,over:Record<string,number>={},julia:[number,number,number]=J):DsParityCase=>({id,name,julia,parameters:{...defaults(id),...over}});
  const baseline={scale:1.007,minr_ir:0.07,fold:1.35,rotate_y:7,rotate_z:2,inv_xc:-1,inv_yc:1,inv_zc:-0.1,inv_radius:0.9,foldy_xy_angle:-0.2,foldy_yz_angle:0.4,abs_xyz_switches:0,bailout_squared:1024};
  return [
    c('mb3d-amazingbox','amazingbox defaults'),
    c('mb3d-amazingbox','amazingbox scale -1.8, min_r 0.2',{scale:-1.8,min_r:0.2}),
    c('mb3d-aboxplatinum','aboxplatinum defaults'),
    c('mb3d-aboxplatinum','aboxplatinum baseline scene',baseline),
    c('mb3d-aboxplatinum','aboxplatinum abs switches 5, rotations',{...baseline,abs_xyz_switches:5,foldx_xy_angle:23,foldx_xz_angle:-17,foldy_xy_angle:41,inv_radius:-0.6},[-0.37,0.12,0.81]),
    c('mb3d-aboxplatinum','aboxplatinum min radius 0',{...baseline,minr_ir:0,scale:-2.1,fold:0.25}),
    c('mb3d-aboxplatinumb','aboxplatinumb defaults'),
    c('mb3d-aboxplatinumb','aboxplatinumb baseline scene',baseline),
    c('mb3d-aboxplatinumb','aboxplatinumb abs switches 3, rotations',{...baseline,abs_xyz_switches:3,foldx_xz_angle:12,foldy_yz_angle:-33},[0.9,0.9,-0.9]),
    c('mb3d-celticmode','celticmode defaults'),
    c('mb3d-celticmode','celticmode evil rune, mystic z',{good:-1.7,evil:0.35,mystic:0.8,heretic:-0.4},[0.9,-0.3,0.6]),
    c('mb3d-celticmode','celticmode good rune 3, mystic off',{good:3,evil:-0.2,mystic:0,heretic:1},[-0.5,0.2,0.1]),
    c('mb3d-reciprocalz3b','reciprocalz3b defaults'),
    c('mb3d-reciprocalz3b','reciprocalz3b small limiters, negative mul',{limiter1:0.01,limiter2:0.003,mul1:-1.7,mul2:2.5}),
    c('mb3d-reciprocalz3b','reciprocalz3b large limiters',{limiter1:8,limiter2:5,mul1:0.3,mul2:-0.4}),
    c('mb3d-reciprocalx3b','reciprocalx3b defaults'),
    c('mb3d-reciprocalx3b','reciprocalx3b small limiters, negative mul',{limiter1:0.01,limiter2:0.003,mul1:-1.7,mul2:2.5}),
  ];
}
