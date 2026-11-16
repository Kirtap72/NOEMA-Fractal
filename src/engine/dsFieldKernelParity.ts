/**
 * GEO-DETAIL-COMPAT-03A. Parity of a single DS FIELD kernel (HeightMapIFS, HeightMapLimIFS ...) against the float64 reference, on the GPU,
 * with real formula maps bound exactly as the engine binds them. Pure module: it builds the compute shader, the maps, the input points
 * and the reference results; `tests/gpu/dsParity.ts` runs the shader.
 *
 * Reference = `stepKernel` in float64 with `createFieldSampler(maps)` (the periodic bicubic B-spline with f32-rounded weights).
 */
import {DS_ARITHMETIC,dsArithmetic} from './geometryDoubleSingle';
import {DS_KERNEL_REGISTRY} from './geometryDsRegistry';
import {dsParityStep} from './dsParity';
import type {DsParityCase} from './dsParity';
import {FIELD_MAP_WGSL,createFieldSampler} from './fieldMaps';
import type {FieldMap} from './fieldMaps';
import {bytesToBase64} from './fieldMapCodec';
import {freshKernelState,prepareKernel,stepKernel} from './formula/kernels';
import type {KernelId} from './formula/kernels';
import type {V4} from './formula/primitives';
void DS_ARITHMETIC;

/** Maps for the tests: each one stresses something different. Deterministic. */
export function dsParityMaps():FieldMap[]{
  let s=987654321;const rnd=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  const make=(id:number,width:number,height:number,texel:(x:number,y:number)=>[number,number,number]):FieldMap=>{
    const bytes=new Uint8Array(width*height*3);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const t=texel(x,y);for(let k=0;k<3;k++)bytes[(y*width+x)*3+k]=Math.max(0,Math.min(255,Math.round(t[k]!)));}
    return {id,reference:'dsParity-'+id,sampler:'periodic-bspline',width,height,rgb8:bytesToBase64(bytes)};
  };
  return [
    // 1: smooth hills, not a power of two, all three channels different
    make(1,64,48,(x,y)=>[128+100*Math.sin(x/7)*Math.cos(y/5),128+120*Math.sin((x+y)/11),(x*255)/63]),
    // 2: white noise with hard edges (worst case for interpolation and wrapping), odd size
    make(2,257,129,()=>[rnd()*255,rnd()*255,rnd()*255]),
    // 3: large, smooth gradient plus hard steps (discontinuities in the data)
    make(3,1024,1024,(x,y)=>[(x*255)/1023,(y*255)/1023,((x>>6)+(y>>6))%2?250:5]),
    // 4: tiny maps: every lookup wraps
    make(4,4,4,(x,y)=>[x*60+10,y*60+10,((x+y)%2)*255]),
    // 5: one texel (everything wraps onto itself)
    make(5,1,1,()=>[200,100,50]),
  ];
}

/** A field-kernel case. `parameters` are the kernel's parameters; `points` bias toward the interesting regions. */
export interface DsFieldKernelCase extends DsParityCase {kind:'field'}

export function dsFieldKernelShader(c:DsParityCase,product:'fma'|'split'='split',mutate?:(wgsl:string)=>string):string{
  const kernel=DS_KERNEL_REGISTRY[c.id];if(!kernel||kernel.role!=='field')throw Error('No DS field function for '+c.id);
  let fn=kernel.emit(dsParityStep(c),0,{sourceParameters:true,julia:[...c.julia,1]});
  if(mutate)fn=mutate(fn);
  return dsArithmetic(product)+'\n'+FIELD_MAP_WGSL+`
struct DSField{v:DSP,vary:vec2f,d:vec2f,h:f32}
`+(kernel.prelude??'')+fn+`
@group(0) @binding(0) var<storage,read> pts:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> outp:array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
  if(id.x>=arrayLength(&pts)/2u){return;}
  let a=pts[2u*id.x];let b=pts[2u*id.x+1u];
  let r=dsField0(DSP(vec2f(a.x,b.x),vec2f(a.y,b.y),vec2f(a.z,b.z)),vec2f(1.0,0.0));
  outp[id.x]=vec4f(r.d.x,r.d.y,r.h,0.0);
}
`;
}

/** Reference value of a field kernel at a point: the field distance (fieldValue/varyScale) and the orbit-trap value. */
export function dsFieldKernelReference(c:DsParityCase,maps:readonly FieldMap[]):(p:readonly number[])=>{d:number;trap:number;invalid:boolean}{
  const prepared=prepareKernel(c.id as KernelId,c.parameters,createFieldSampler(maps));
  return p=>{
    const state=freshKernelState([p[0]!,p[1]!,p[2]!,1] as V4,[c.julia[0],c.julia[1],c.julia[2],0] as V4,3);
    stepKernel(prepared,state);
    return {d:state.fieldValue/state.varyScale,trap:state.free[0],invalid:state.invalid};
  };
}

export interface DsFieldKernelStats {n:number;compared:number;skipped:number;maxError:number;p99Error:number;worstIndex:number;worstPoint?:number[];trapMaxError:number}
/** Scaled error |ds - ref| / max(1, |ref|) on the distance; the trap value (colour only) is reported with a loose f32 level. */
export function dsFieldKernelCompare(points:readonly (readonly number[])[],ref:(p:readonly number[])=>{d:number;trap:number;invalid:boolean},gpu:Float32Array):DsFieldKernelStats{
  const errors:number[]=[];let skipped=0,worst=0,worstIndex=-1,trapWorst=0;
  points.forEach((p,i)=>{
    const want=ref(p),got=gpu[i*4]!+gpu[i*4+1]!;
    if(want.invalid||!Number.isFinite(want.d)||Math.abs(want.d)>=1e19||Math.abs(got)>=1e19){skipped++;return;}
    const err=Number.isFinite(got)?Math.abs(got-want.d)/Math.max(1,Math.abs(want.d)):Infinity;
    errors.push(err);if(err>worst){worst=err;worstIndex=i;}
    if(want.trap!==0||gpu[i*4+2]!==0)trapWorst=Math.max(trapWorst,Math.abs(gpu[i*4+2]!-want.trap)/Math.max(1,Math.abs(want.trap)));
  });
  const sorted=[...errors].sort((a,b)=>a-b);
  return {n:points.length,compared:errors.length,skipped,maxError:sorted.at(-1)??0,p99Error:sorted[Math.floor(sorted.length*0.99)]??0,worstIndex,...(worstIndex>=0?{worstPoint:[...points[worstIndex]!]}:{}),trapMaxError:trapWorst};
}

/** Points for a field kernel: random in a box, plus the edge lines where maps wrap and where the slab branch changes. */
export function dsFieldKernelPoints(count:number,extent:number,seed=24680):number[][]{
  let s=seed>>>0;const rnd=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296*2-1;};
  const pts:number[][]=[];
  const lattice=[0,0.5,1,-1,0.25,-0.25,0.125,2,-2,1.5,-1.5,0.99999,1.00001,-0.99999,1e-7,-1e-7];
  for(const a of lattice)for(const b of [0,0.37,-0.81])pts.push([a*extent/2,b*extent/2,(a+b)*0.3]);
  while(pts.length<count)pts.push([rnd()*extent,rnd()*extent,rnd()*extent*0.6]);
  return pts.slice(0,count);
}

/**
 * The cases the harness runs for the formula-map kernels. `defaults(id)` = the formula's default parameters.
 * Extreme scales, negative scales and heights, rotations, the empty map slot, every map size, an invalid channel and an all-far case.
 */
export function dsFieldKernelCases(defaults:(id:string)=>Record<string,number>):DsParityCase[]{
  const J:[number,number,number]=[0.4,-0.2,0.1];
  const c=(id:string,name:string,over:Record<string,number>):DsParityCase=>({id,name,julia:J,parameters:{...defaults(id),...over}});
  const hm=(name:string,over:Record<string,number>)=>c('mb3d-heightmapifs','heightmapifs '+name,{map_nr:1,x_scale:1,y_scale:1,x_offset:0,y_offset:0,h_scale:1,h_offset:0,map_channel_0_2:0,otrap_channel_0_2:1,otrap_offset:0,otrap_multiplier:1,rotation_x:0,rotation_y:0,rotation_z:0,...over});
  const lim=(name:string,over:Record<string,number>)=>c('mb3d-heightmaplimifs','heightmaplimifs '+name,{map_nr:1,x_scale:1,y_scale:1,h_scale:1,thickness:0.05,x_size:2,y_size:2,source_variant:0,map_channel_0_2:0,otrap_channel_0_2:1,otrap_offset:0,otrap_multiplier:1,rotation_x:0,rotation_y:0,rotation_z:0,...over});
  return [
    hm('smooth map 64x48',{}),
    hm('noise map 257x129, offsets, negative y scale',{map_nr:2,x_scale:3.7,y_scale:-2.1,x_offset:0.3,y_offset:-0.7,h_scale:0.8,h_offset:0.1,map_channel_0_2:1,otrap_channel_0_2:2}),
    hm('large map 1024x1024, very small scale 0.05, negative height',{map_nr:3,x_scale:0.05,y_scale:0.05,h_scale:-1.2}),
    hm('tiny map 4x4, scale 5000',{map_nr:4,x_scale:5000,y_scale:3000.5,map_channel_0_2:2}),
    hm('tiny map 4x4, scale 1e-3',{map_nr:4,x_scale:0.001,y_scale:0.001}),
    hm('one texel map',{map_nr:5,x_scale:7,y_scale:7}),
    hm('rotations 23/-41/77',{map_nr:2,rotation_x:23,rotation_y:-41,rotation_z:77,x_scale:2.3,y_scale:2.3}),
    hm('empty map slot 0',{map_nr:0}),
    hm('invalid channel 3 (reference marks the step invalid)',{map_channel_0_2:3}),
    hm('all far (h_offset 50)',{h_offset:50}),
    hm('thin height 1e-3, noise map',{map_nr:2,h_scale:0.001,x_scale:11,y_scale:13}),
    lim('smooth map',{}),
    lim('noise map, source_variant 1, size 1.2 x 0.7',{map_nr:2,source_variant:1,x_size:1.2,y_size:0.7,x_scale:2.9,y_scale:3.1,h_scale:0.9,thickness:0.2}),
    lim('large map, rotations, negative height',{map_nr:3,rotation_x:15,rotation_y:5,rotation_z:-60,h_scale:-0.7,x_scale:0.3,y_scale:0.4}),
    lim('tiny map, scale 4000',{map_nr:4,x_scale:4000,y_scale:2000.25}),
  ];
}
