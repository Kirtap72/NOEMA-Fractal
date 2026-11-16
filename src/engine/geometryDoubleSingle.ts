/** GEO3 removable lab. Independently evaluated normalized NOEMA mathematics.
 * Two f32 lanes carry coordinates AND the orbit; this is not native f64 and is
 * not certified for arbitrary formulas. Unsupported compositions fail closed.
 */
import type {ResolvedScene} from './scene';
import {KERNELS,prepareKernel} from './formula/kernels';
import {DS_KERNEL_REGISTRY,dsKernelIds,ds} from './geometryDsRegistry';
import {nearestEven} from './formula/primitives';
/** Kernels that have a hand-written double-single (DS) version. One list for the generator AND the eligibility check (COMPAT-02). */
export const DS_PRIMARY_KERNELS:readonly string[]=[...dsKernelIds('primary'),...dsKernelIds('helper')];
export const DS_FIELD_KERNELS:readonly string[]=dsKernelIds('field');
/** The RandCubesIFS variants the DS field was written and verified for. */
export function dsFieldShapeSupported(p:Record<string,number>):boolean{return [0,1].includes(p.shapetype_1!)&&[0,1].includes(p.shapetype_2!)&&p.inside_render===0;}
export interface DSDefinition {execution:{kind:string;groups:{start:number;end:number;repeat:number;maxIterations:number}[]};julia:number[];steps:{id:string;iterations:number;parameters:Record<string,number>;matrices:number[][][];
  /** Uncounted mapping helper (COMPAT-02): no count, no bailout test, analytic w preserved. Omitted for ordinary steps. */
  helper?:true}[]}
export function dsDefinition(r:ResolvedScene,sourceParameters=false):DSDefinition {
 if(r.execution?.kind!=='mapped-field'||!r.julia?.[3])throw Error('GEO3 DS requires mapped Julia');
 if(r.chainWeights?.some(w=>w!==1))throw Error('GEO3 DS weighted composition is unvalidated');
 return {execution:r.execution,julia:r.julia,steps:r.chain.map(c=>{const p=Object.fromEntries(c.formula.parameters.map((p,i)=>[p.name,sourceParameters?c.parameterValues[i]!:Math.fround(c.parameterValues[i]!)]));return {id:c.formula.id,iterations:c.iterations,parameters:p,matrices:prepareKernel(c.formula.kernel!,p).matrices,...(KERNELS[c.formula.kernel!].role==='helper'?{helper:true as const}:{})};})};
}
/** DS constants must invalidate the normal uniform-only shader cache. Camera
 * and quality do not belong to this field key. Default production is untouched. */
export function dsCompileKey(r:ResolvedScene,sourceParameters=false):string{return '|geo3-ds:'+JSON.stringify(dsDefinition(r,sourceParameters));}
export const DS_ARITHMETIC=`
fn dsN(a:f32,b:f32)->vec2f{let s=a+b;return vec2f(s,b-(s-a));}
fn dsA(a:vec2f,b:vec2f)->vec2f{let s=a.x+b.x;let v=s-a.x;let e=(a.x-(s-v))+(b.x-v);return dsN(s,e+a.y+b.y);}
fn dsNeg(a:vec2f)->vec2f{return -a;}
fn dsS(a:vec2f,b:vec2f)->vec2f{return dsA(a,-b);}
fn dsM(a:vec2f,b:vec2f)->vec2f{let p=a.x*b.x;let e=fma(a.x,b.x,-p);return dsN(p,e+a.x*b.y+a.y*b.x+a.y*b.y);}
fn dsD(a:vec2f,b:vec2f)->vec2f{let q=a.x/b.x;let r=dsS(a,dsM(b,vec2f(q,0.0)));return dsN(q,(r.x+r.y)/b.x);}
fn dsLT(a:vec2f,b:vec2f)->bool{return a.x<b.x || (a.x==b.x&&a.y<b.y);}
fn dsAbs(a:vec2f)->vec2f{return select(a,-a,dsLT(a,vec2f(0.0)));}
fn dsMin(a:vec2f,b:vec2f)->vec2f{return select(b,a,dsLT(a,b));}
fn dsMax(a:vec2f,b:vec2f)->vec2f{return select(a,b,dsLT(a,b));}
fn dsQ(a:vec2f)->vec2f{if(a.x<=0.0){return vec2f(0.0);}let q=sqrt(a.x);return dsN(q,dsD(dsS(a,dsM(vec2f(q,0.0),vec2f(q,0.0))),vec2f(2.0*q,0.0)).x);}
struct DSP{x:vec2f,y:vec2f,z:vec2f}
fn dsP(v:vec3f)->DSP{return DSP(vec2f(v.x,0.0),vec2f(v.y,0.0),vec2f(v.z,0.0));}
fn dsPoint(o:vec3f,d:vec3f,t:vec2f)->DSP{return DSP(dsA(vec2f(o.x,0.0),dsM(vec2f(d.x,0.0),t)),dsA(vec2f(o.y,0.0),dsM(vec2f(d.y,0.0),t)),dsA(vec2f(o.z,0.0),dsM(vec2f(d.z,0.0),t)));}
fn dsDot(p:DSP)->vec2f{return dsA(dsA(dsM(p.x,p.x),dsM(p.y,p.y)),dsM(p.z,p.z));}
fn dsScale(p:DSP,k:vec2f)->DSP{return DSP(dsM(p.x,k),dsM(p.y,k),dsM(p.z,k));}
fn dsBox(t:vec2f,f:vec2f)->vec2f{if(dsLT(dsAbs(f),t)){return dsS(dsM(vec2f(2.0,0.0),f),t);}if(dsLT(t,-dsAbs(f))){return dsS(dsM(vec2f(-2.0,0.0),f),t);}return select(dsM(vec2f(-3.0,0.0),t),t,!dsLT(f,vec2f(0.0)));}
fn dsRot(u:vec2f,v:vec2f,t:vec2f,ca:vec2f,sa:vec2f,cb:vec2f,sb:vec2f,f:vec2f)->DSP{
 let U=dsS(dsM(u,ca),dsM(t,sa));let T=dsA(dsM(u,sa),dsM(t,ca));let V=dsA(dsM(U,sb),dsM(v,cb));let F=dsBox(dsS(dsM(U,cb),dsM(v,sb)),f);let q=dsS(dsM(F,cb),dsM(V,sb));return DSP(dsS(dsM(q,ca),dsM(T,sa)),dsA(dsM(F,sb),dsM(V,cb)),dsA(dsM(q,sa),dsM(T,ca)));
}
fn dsRound(a:vec2f)->f32{let h=round(a.x);let delta=dsS(a,vec2f(h,0.0));if(dsLT(vec2f(0.5,0.0),delta)){return h+1.0;}if(dsLT(delta,vec2f(-0.5,0.0))){return h-1.0;}return h;}
struct DSResult{d:vec2f,core:vec3f}
`;
function order(d:DSDefinition,g:DSDefinition['execution']['groups'][number]){let i=g.start,n=d.steps[i]!.iterations,count=0;const out:number[]=[];while(count<g.maxIterations){out.push(i);if(!d.steps[i]!.helper)count++;if(--n===0){i=i===g.end?g.repeat:i+1;n=d.steps[i]!.iterations;}}return out;}
/** The DS arithmetic prelude. 'split' avoids relying on a fused fma (integer mantissa partition); shared by the generator and the parity harness. */
export function dsArithmetic(product:'fma'|'split'='fma'):string{
 return product==='fma'?DS_ARITHMETIC:DS_ARITHMETIC.replace('let e=fma(a.x,b.x,-p);',`let ah=bitcast<f32>(bitcast<u32>(a.x)&0xfffff000u);let bh=bitcast<f32>(bitcast<u32>(b.x)&0xfffff000u);let al=a.x-ah;let bl=b.x-bh;let e=((ah*bh-p)+ah*bl+al*bh)+al*bl;`);
}
export function doubleSingleField(d:DSDefinition,product:'fma'|'split'='fma',sourceParameters=false,nativeBailoutRadius?:number):string {
 if(nativeBailoutRadius!==undefined&&(!(nativeBailoutRadius>0)||!Number.isFinite(Math.fround(nativeBailoutRadius*nativeBailoutRadius))))throw Error('Invalid native bailout radius');
 if(d.execution.kind!=='mapped-field'||d.execution.groups.length!==2||d.julia[3]!==1)throw Error('Unsupported DS group/Julia semantics');
 const [g0,g1]=d.execution.groups;
 for(const i of order(d,g0!))if(!DS_PRIMARY_KERNELS.includes(d.steps[i]!.id))throw Error('Unsupported DS primary formula');
 for(const i of order(d,g1!)){const s=d.steps[i]!;if(!DS_FIELD_KERNELS.includes(s.id)||(s.id==='mb3d-randcubesifs'&&!dsFieldShapeSupported(s.parameters)))throw Error('Unsupported DS field formula/shape');}
 let functions='';
 for(const prelude of new Set(d.steps.map(st=>DS_KERNEL_REGISTRY[st.id]?.prelude).filter((x):x is string=>!!x)))functions+=prelude;
 for(const [i,s] of d.steps.entries()){
  const kernel=Object.hasOwn(DS_KERNEL_REGISTRY,s.id)?DS_KERNEL_REGISTRY[s.id]!:undefined;
  if(!kernel)throw Error('Unsupported DS kernel');
  functions+=kernel.emit(s,i,{sourceParameters,nativeBailoutRadius,julia:d.julia});
 }
 const o0=order(d,g0!),o1=order(d,g1!),primary=[...new Set(o0)];
 // Competing product residual: integer mantissa partition avoids relying on
 // WGSL fma being fused. It still needs measured validation on each backend.
 const arithmetic=dsArithmetic(product);
 let main=`
 fn geoDS(input:DSP)->DSResult{
 var v=input;var w=vec2f(1.0,0.0);var count=0.0;
 let sequence=array<i32,${o0.length}>(${o0.map(i=>i+'i').join(',')});
 for(var n=0u;n<${o0.length}u;n++){var result:DSOrbit;var bailout=vec2f(0.0);switch sequence[n]{${primary.map(i=>d.steps[i]!.helper?`case ${i}:{result=dsOrbit${i}(v,w);helperCall=true;}`:`case ${i}:{result=dsOrbit${i}(v,w);bailout=${ds(nativeBailoutRadius===undefined?d.steps[i]!.parameters.bailout_squared!:Math.fround(nativeBailoutRadius*nativeBailoutRadius))};}`).join('')}default:{return DSResult(vec2f(1e20,0.0),vec3f(0.0));}}v=result.v;w=result.w;count+=1.0;if(${nativeBailoutRadius===undefined?'dsLT(bailout,dsDot(v))':'!dsLT(dsDot(v),bailout)'}){break;}}
 let denominator=dsAbs(w);${nativeBailoutRadius===undefined?'':'if(!dsLT(vec2f(0.0),denominator)){return DSResult(vec2f(1e20,0.0),vec3f(1e20,count,0.0));}'}var vary=vec2f(1.0,0.0);var best=vec2f(65535.0,0.0);var bestI=0.0;var h=0.0;
 ${o1.map((i,j)=>`{let f=dsField${i}(v,vary);v=f.v;vary=f.vary;if(dsLT(f.d,best)){best=f.d;bestI=${j+1}.0;h=f.h;}}`).join('\n')}
 let distance=dsD(best,denominator);return DSResult(distance,vec3f(distance.x+distance.y,count+bestI,h));}
 `;
 // COMPAT-02: a scene with an uncounted helper in the mapping group gets a variant of the loop; scenes without one keep the exact old text.
 if(d.steps.some(st=>st.helper)){
  const tail=`count+=1.0;if(${nativeBailoutRadius===undefined?'dsLT(bailout,dsDot(v))':'!dsLT(dsDot(v),bailout)'}){break;}}`;
  if(!main.includes('v=result.v;w=result.w;'+tail))throw Error('DS helper anchor changed');
  main=main.replace('var bailout=vec2f(0.0);','var bailout=vec2f(0.0);var helperCall=false;').replace('v=result.v;w=result.w;'+tail,'v=result.v;w=result.w;if(!helperCall){'+tail.slice(0,-1)+'}}');
 }
 // Native query exits are independent of the unchanged full finite-field control.
 const native=nativeBailoutRadius===undefined?'':main.replace('fn geoDS(input:DSP)','fn geoDSNative(input:DSP,threshold:f32)').replace('var h=0.0;','var h=0.0;var done=false;').replaceAll('{let f=','if(!done){let f=').replaceAll('h=f.h;','h=f.h;if(dsLT(f.d,vec2f(threshold,0.0))){done=true;}');
 return arithmetic+`struct DSOrbit{v:DSP,w:vec2f}struct DSField{v:DSP,vary:vec2f,d:vec2f,h:f32}\n`+functions+main+native;
}
