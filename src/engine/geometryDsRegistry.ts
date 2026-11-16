/**
 * GEO-DETAIL-COMPAT-02, WP4. Registry of the kernels that have a hand-written double-single (DS) version.
 * The emitted WGSL of the four original kernels is moved here VERBATIM from geometryDoubleSingle.ts (tests/geometryDsGolden.test.ts
 * locks it with SHA-256 hashes recorded from the code before the move). One source of truth for the generator and the eligibility check.
 *  - primary: counted orbit step of the mapping group (changes xyz, multiplies the analytic w)
 *  - field:   finite field step of the second group (returns a signed distance)
 *  - helper:  uncounted mapping helper (changes xyz only; no count, no bailout test, w preserved), as in the CPU reference
 */
import type {DSDefinition} from './geometryDoubleSingle';
import {nearestEven} from './formula/primitives';
void nearestEven; // used inside the emitted templates
export const lit=(x:number)=>{if(!Number.isFinite(x))throw Error('Nonfinite DS coefficient');return x.toExponential(16);};
export const ds=(x:number)=>`vec2f(${lit(Math.fround(x))},${lit(Math.fround(x-Math.fround(x)))})`;
export type DsStep=DSDefinition['steps'][number];
export interface DsEmitContext {sourceParameters:boolean;nativeBailoutRadius?:number;julia:number[]}
export interface DsKernel {role:'primary'|'field'|'helper';emit(s:DsStep,i:number,ctx:DsEmitContext):string;
  /** Shared WGSL this kernel needs (emitted once per shader, before the step functions). Absent for the original kernels. */
  prelude?:string}

const emitRandCubes:DsKernel['emit']=(s,i)=>{
  const p=s.parameters,c=(k:string)=>ds(p[k]!);
  return `fn dsField${i}(input:DSP,vary0:vec2f)->DSField{let scale=${c('scale')};var v=input;var vary=vary0;let q=DSP(dsA(dsM(v.x,scale),${c('x_add')}),dsA(dsM(v.y,scale),${c('y_add')}),dsA(dsM(v.z,scale),${c('z_add')}));
   ${p.apply_scale_add!==0?'v=q;vary=dsM(vary,scale);':''}
   let rx=dsRound(q.x);let ry=dsRound(q.y);if(abs(rx)>=16777216.0||abs(ry)>=16777216.0){return DSField(v,vary,vec2f(1e20,0.0),0.0);}
   let X=dsAbs(dsS(q.x,vec2f(rx,0.0)));let Y=dsAbs(dsS(q.y,vec2f(ry,0.0)));var Z=q.z;
   let tileU=bitcast<u32>(i32(rx))^0x9d81u;let tileV=bitcast<u32>(i32(ry))^0xb641u;let prod=essentialMul32(tileU,tileV);let raw=~prod.x;
   var B=(raw&0x5a5au)^(prod.y|0x5a5au);var A=(tileU&0x5a5au)^(tileV|0x5a5au);A=essentialHash(A,${nearestEven(p.randomizerx!)}i,raw);B=essentialHash(B,${nearestEven(p.randomizery!)}i,raw);
   let H=((A>>6u)^(B<<6u))&65535u;let F=(A&0xaaaau)^(B&0x5555u);let k=${ds(-6.86656e-6)};
   Z=dsS(Z,dsM(dsM(vec2f(f32(F),0.0),k),${c('zflight')}));let dz=dsA(dsAbs(Z),dsM(dsM(vec2f(f32(H),0.0),k),${c('zmaxsz')}));
   let vx=${c('xvtn_0_1')};let vy=${c('yvtn_0_1')};let ax=dsA(dsM(dsM(vec2f(f32(A),0.0),k),vx),dsM(dsS(vec2f(1.0,0.0),vx),${ds(-.45)}));let by=dsA(dsM(dsM(vec2f(f32(B),0.0),k),vy),dsM(dsS(vec2f(1.0,0.0),vy),${ds(-.45)}));
   var distance=dsMax(dz,dsMax(dsA(X,ax),dsA(Y,by)));let shape=select(${p.shapetype_1}i,${p.shapetype_2}i,(A&0x40u)!=0u);
   if(shape==1){distance=dsMax(dz,dsS(dsA(dsQ(dsA(dsM(X,X),dsM(Y,Y))),ax),dsM(dsM(dsM(vec2f(f32(B),0.0),k),vy),dsAbs(Z))));}
   ${p.apply_scale_add===0?'distance=dsD(distance,scale);':''}
   return DSField(v,vary,dsD(distance,vary),f32(H)*1.5e-5);}
   `;
};

const emitAbox:DsKernel['emit']=(s,i,ctx)=>{
  const p=s.parameters,c=(k:string)=>ds(p[k]!);
  const {sourceParameters,nativeBailoutRadius,julia}=ctx;
  let body='';
  if(s.id==='mb3d-amazingbox')body=`var q=DSP(dsBox(v.x,vec2f(1.0,0.0)),dsBox(v.y,vec2f(1.0,0.0)),dsBox(v.z,vec2f(1.0,0.0)));let rr=dsDot(q);`;
  else{
   const rot=(u:string,v:string,t:string,a:string,b:string)=>{const av=p[a]!*Math.PI/180,bv=p[b]!*Math.PI/180;return `dsRot(${u},${v},${t},${ds(Math.cos(av))},${ds(Math.sin(av))},${ds(Math.cos(bv))},${ds(Math.sin(bv))},${c('fold')})`;};
   body=`let a=${rot('v.x','v.y','v.z','foldx_xz_angle','foldx_xy_angle')};`;
   body+=s.id==='mb3d-aboxplatinumb'?`let b=${rot('v.y','v.x','v.z','foldy_yz_angle','foldy_xy_angle')};var q=DSP(a.x,b.x,dsBox(v.z,${c('fold')}));`:`let b=${rot('a.y','a.x','a.z','foldy_yz_angle','foldy_xy_angle')};var q=DSP(b.y,b.x,dsBox(b.z,${c('fold')}));`;
   for(const [axis,j] of ['x','y','z'].map((a,j)=>[a,j] as const)){if(nearestEven(p.abs_xyz_switches!)&(1<<j))body+=`q.${axis}=dsAbs(q.${axis});`;body+=`q.${axis}=dsA(q.${axis},${c('inv_'+axis+'c')});`;}
   body+=`let rr=dsD(dsDot(q),${ds(Math.abs(p.inv_radius!)>=1e-40?p.inv_radius!:1e-40)});`;
  }
  const low=Math.max(1e-40,p[s.id==='mb3d-amazingbox'?'min_r':'minr_ir']!)**2;
  // Native minR=0 prepares a finite ~1e80 multiplier. DS shares f32's exponent
  // range: a zero underflowed squared radius cannot silently take the unit branch.
  if(nativeBailoutRadius!==undefined&&low<2**-149)body+='if(rr.x==0.0&&rr.y==0.0){return DSOrbit(q,vec2f(0.0));}';
  body+=`var factor=${c('scale')};if(dsLT(rr,${ds(low)})){factor=dsD(${c('scale')},${ds(low)});}else if(!dsLT(vec2f(1.0,0.0),rr)){factor=dsD(${c('scale')},rr);}q=dsScale(q,factor);`;
  if(s.id!=='mb3d-amazingbox'){
   for(const a of ['x','y','z'])body+=`q.${a}=dsS(q.${a},dsM(${c('scale')},${c('inv_'+a+'c')}));`;
   body+='let old=q;';
   for(let j=0;j<3;j++){const row=s.matrices[0]![j]!;body+=`q.${'xyz'[j]}=dsA(dsA(dsM(old.x,${ds(row[0]!)}),dsM(old.y,${ds(row[1]!)})),dsM(old.z,${ds(row[2]!)}));q.${'xyz'[j]}=dsA(q.${'xyz'[j]},${ds(sourceParameters?julia[j]!:Math.fround(julia[j]!))});`;}
  }
  return `fn dsOrbit${i}(v:DSP,w:vec2f)->DSOrbit{${body}return DSOrbit(q,dsM(w,factor));}\n`;
};

/** `mb3d-reciprocalz3b`: z -> sign(z) * (1/l1 - 1/(|z*mul1| + l1) + 1/l2 - 1/(|z*z*mul2| + l2)). Float64 reference: kernels.ts (stepKernel). */
const emitReciprocalZ3b:DsKernel['emit']=(s,i)=>{
  const p=s.parameters,c=(k:string)=>ds(p[k]!);
  return `fn dsOrbit${i}(v:DSP,w:vec2f)->DSOrbit{let z=v.z;let one=vec2f(1.0,0.0);
  let a=dsS(dsD(one,${ds(Math.max(1e-40,p.limiter1!))}),dsD(one,dsA(dsAbs(dsM(z,${c('mul1')})),${c('limiter1')})));
  let b=dsS(dsD(one,${ds(Math.max(1e-40,p.limiter2!))}),dsD(one,dsA(dsAbs(dsM(dsM(z,z),${c('mul2')})),${c('limiter2')})));
  let r=dsA(a,b);let nz=select(r,-r,(bitcast<u32>(z.x)&0x80000000u)!=0u);
  return DSOrbit(DSP(v.x,v.y,nz),w);}
`;
};

/** `mb3d-reciprocalx3b`: the same function on x. Float64 reference: kernels.ts (stepKernel). */
const emitReciprocalX3b:DsKernel['emit']=(s,i)=>{
  const p=s.parameters,c=(k:string)=>ds(p[k]!);
  return `fn dsOrbit${i}(v:DSP,w:vec2f)->DSOrbit{let x=v.x;let one=vec2f(1.0,0.0);
  let a=dsS(dsD(one,${ds(Math.max(1e-40,p.limiter1!))}),dsD(one,dsA(dsAbs(dsM(x,${c('mul1')})),${c('limiter1')})));
  let b=dsS(dsD(one,${ds(Math.max(1e-40,p.limiter2!))}),dsD(one,dsA(dsAbs(dsM(dsM(x,x),${c('mul2')})),${c('limiter2')})));
  let r=dsA(a,b);let nx=select(r,-r,(bitcast<u32>(x.x)&0x80000000u)!=0u);
  return DSOrbit(DSP(nx,v.y,v.z),w);}
`;
};

/**
 * COMPAT-03A. Double-single sampling of a formula field map (external image used as geometry), the same periodic bicubic B-spline as
 * `createFieldSampler` in fieldMaps.ts:
 *   x = fract(u) * width;  ix = floor(x);  t = x - ix;  weights = fround([a, 1-a-c-d, c, d]) with d=t^3/6, a=1/6+0.5 t (t-1) - d, c=t+a-2d
 *   value = sum over a 4x4 neighbourhood of (byte/255) * wx[i] * wy[j], texel index wrapped periodically.
 * The coordinates u, v and the fractional position t are double-single, the weights are rounded to f32 exactly as the reference does,
 * and every 8-bit texel enters as byte/255 with its exact residual (the texture hands out only the f32 nearest to byte/255).
 * Needs the same bindings as the f32 sampler (formulaFields, formulaFieldTex), which FIELD_MAP_WGSL declares.
 */
const DS_FIELD_MAP_PRELUDE=`
struct DSRgb{c:array<vec2f,3>,ok:bool}
fn dsFract(a:vec2f)->vec2f{
  var r=dsS(a,vec2f(floor(a.x),0.0));
  if(r.x<0.0||(r.x==0.0&&r.y<0.0)){r=dsA(r,vec2f(1.0,0.0));}
  else if(!dsLT(r,vec2f(1.0,0.0))){r=dsS(r,vec2f(1.0,0.0));}
  return r;
}
fn dsTexel(t:f32)->vec2f{
  let b=round(t*255.0);let th=bitcast<f32>(bitcast<u32>(t)&0xfffff000u);let tl=t-th;
  return vec2f(t,((b-th*255.0)-tl*255.0)/255.0);
}
fn dsWeights(t:vec2f)->array<f32,4>{
  let d=dsD(dsM(dsM(t,t),t),vec2f(6.0,0.0));
  let a=dsS(dsA(${ds(1/6)},dsM(dsM(vec2f(0.5,0.0),t),dsS(t,vec2f(1.0,0.0)))),d);
  let c=dsS(dsA(t,a),dsM(vec2f(2.0,0.0),d));
  let m=dsS(dsS(dsS(vec2f(1.0,0.0),a),c),d);
  return array<f32,4>(a.x,m.x,c.x,d.x);
}
fn dsSampleField(id:i32,u:vec2f,v:vec2f)->DSRgb{
  var out:DSRgb;out.ok=true;out.c=array<vec2f,3>(vec2f(0.0),vec2f(0.0),vec2f(0.0));
  if(id==0){return out;}
  for(var slot=1;slot<=i32(formulaFields[0].x);slot++){
    let m=formulaFields[slot];if(i32(m.x)!=id){continue;}
    let wh=vec2i(m.yz);
    let fx=dsM(dsFract(u),vec2f(m.y,0.0));let fy=dsM(dsFract(v),vec2f(m.z,0.0));
    var ix=floor(fx.x);var tx=dsS(fx,vec2f(ix,0.0));
    if(tx.x<0.0||(tx.x==0.0&&tx.y<0.0)){ix-=1.0;tx=dsA(tx,vec2f(1.0,0.0));}else if(!dsLT(tx,vec2f(1.0,0.0))){ix+=1.0;tx=dsS(tx,vec2f(1.0,0.0));}
    var iy=floor(fy.x);var ty=dsS(fy,vec2f(iy,0.0));
    if(ty.x<0.0||(ty.x==0.0&&ty.y<0.0)){iy-=1.0;ty=dsA(ty,vec2f(1.0,0.0));}else if(!dsLT(ty,vec2f(1.0,0.0))){iy+=1.0;ty=dsS(ty,vec2f(1.0,0.0));}
    var wx=dsWeights(tx);var wy=dsWeights(ty);
    let cell=vec2i(i32(ix),i32(iy));
    for(var j=0;j<4;j++){for(var i=0;i<4;i++){
      let c=(cell+vec2i(i-1,j-1)+wh)%wh;
      let t=textureLoad(formulaFieldTex,c,i32(m.w),0).xyz;
      let weight=vec2f(wx[i],0.0);let weightY=vec2f(wy[j],0.0);
      out.c[0]=dsA(out.c[0],dsM(dsM(dsTexel(t.x),weight),weightY));
      out.c[1]=dsA(out.c[1],dsM(dsM(dsTexel(t.y),weight),weightY));
      out.c[2]=dsA(out.c[2],dsM(dsM(dsTexel(t.z),weight),weightY));
    }}
    return out;
  }
  out.ok=false;return out;
}
`;

const f32=(x:number)=>Math.fround(x);
const rotateRows=(s:DsStep)=>{
  const m=s.matrices[0]!;
  return [0,1,2].map(j=>`dsA(dsA(dsM(v.x,${ds(m[j]![0]!)}),dsM(v.y,${ds(m[j]![1]!)})),dsM(v.z,${ds(m[j]![2]!)}))`);
};
const FIELD_FAILURE=(i:number)=>`fn dsField${i}(input:DSP,vary0:vec2f)->DSField{return DSField(input,vary0,vec2f(1e20,0.0),0.0);}\n`;

/**
 * `mb3d-heightmapifs`. Float64 reference: stepGatewayKernel (gatewayKernels.ts, the 'mb3d-heightmapifs' branch). The reference
 * rounds the scale/offset parameters to f32 (`f(key)`); so does this. mapPadding is 0 in a mapped-field chain.
 */
const emitHeightMap:DsKernel['emit']=(s,i)=>{
  const p=s.parameters,ch=nearestEven(p.map_channel_0_2!)&3,tr=nearestEven(p.otrap_channel_0_2!)&3;
  if(ch>2||tr>2)return FIELD_FAILURE(i); // the reference marks such a step invalid
  const f=(k:string)=>ds(f32(p[k]!)),[qx,qy,qz]=rotateRows(s);
  return `fn dsField${i}(input:DSP,vary0:vec2f)->DSField{
  let v=input;let qx=${qx};let qy=${qy};let qz=${qz};
  let h=${f('h_scale')};let off=${f('h_offset')};let hh=dsM(vec2f(0.5,0.0),h);
  if(dsLT(dsAbs(h),dsAbs(dsS(dsA(qz,off),hh)))){return DSField(v,vary0,dsD(dsS(dsS(hh,off),qz),vary0),0.0);}
  let s=dsSampleField(${nearestEven(p.map_nr!)},dsS(dsM(qx,${f('x_scale')}),${f('x_offset')}),dsS(dsM(qy,${f('y_scale')}),${f('y_offset')}));
  if(!s.ok){return DSField(v,vary0,vec2f(1e20,0.0),0.0);}
  let field=dsS(dsS(dsM(s.c[${ch}],h),off),qz);
  let trap=(s.c[${tr}].x+${lit(f32(p.otrap_offset!))})*${lit(f32(p.otrap_multiplier!))};
  return DSField(v,vary0,dsD(field,vary0),trap);}
`;
};

/** `mb3d-heightmaplimifs`. Float64 reference: stepRecreationSix (recreationSixKernels.ts, the last branch). */
const emitHeightMapLim:DsKernel['emit']=(s,i)=>{
  const p=s.parameters,ch=nearestEven(p.map_channel_0_2!)&3,tr=nearestEven(p.otrap_channel_0_2!)&3;
  if(ch>2||tr>2)return FIELD_FAILURE(i);
  const f=(k:string)=>ds(f32(p[k]!)),[rx,ry,rz]=rotateRows(s);
  const offset=nearestEven(p.source_variant!)===1?0.5:0;
  return `fn dsField${i}(input:DSP,vary0:vec2f)->DSField{
  let v=input;let rx=${rx};let ry=${ry};let rz=${rz};
  let h=${f('h_scale')};let thick=${f('thickness')};let hh=dsM(vec2f(0.5,0.0),h);
  let side=dsMax(dsS(dsAbs(rx),${f('x_size')}),dsS(dsAbs(ry),${f('y_size')}));
  let far=dsLT(vec2f(0.5,0.0),side)||dsLT(dsAbs(h),dsS(dsA(dsAbs(rz),thick),hh));
  if(far){return DSField(v,vary0,dsD(dsA(dsS(dsMax(side,dsAbs(rz)),thick),hh),vary0),0.0);}
  let s=dsSampleField(${nearestEven(p.map_nr!)},dsS(dsM(rx,${f('x_scale')}),${ds(offset)}),dsS(dsM(ry,${f('y_scale')}),${ds(offset)}));
  if(!s.ok){return DSField(v,vary0,vec2f(1e20,0.0),0.0);}
  let field=dsMax(side,dsS(dsA(dsAbs(rz),thick),dsM(s.c[${ch}],h)));
  let trap=(s.c[${tr}].x+${lit(f32(p.otrap_offset!))})*${lit(f32(p.otrap_multiplier!))};
  return DSField(v,vary0,dsD(field,vary0),trap);}
`;
};

/** `mb3d-celticmode` (helper): x -> |x+shift| - shift + x*evil, z optional; shift = c.x * good. Float64 reference: kernels.ts (stepKernel). */
const emitCelticMode:DsKernel['emit']=(s,i,ctx)=>{
  const p=s.parameters,j=(k:number)=>ctx.sourceParameters?ctx.julia[k]!:f32(ctx.julia[k]!);
  const shift=j(0)*p.good!,zs=j(2)*p.mystic!,zh=j(2)*p.heretic!;
  const z=p.mystic!==0?`dsS(dsAbs(dsA(v.z,${ds(zs)})),${ds(zh)})`:'v.z';
  return `fn dsOrbit${i}(v:DSP,w:vec2f)->DSOrbit{
  let x=dsA(dsS(dsAbs(dsA(v.x,${ds(shift)})),${ds(shift)}),dsM(v.x,${ds(p.evil!)}));
  return DSOrbit(DSP(x,v.y,${z}),w);}
`;
};

export const DS_KERNEL_REGISTRY:Readonly<Record<string,DsKernel>>={
  'mb3d-amazingbox':{role:'primary',emit:emitAbox},
  'mb3d-aboxplatinum':{role:'primary',emit:emitAbox},
  'mb3d-aboxplatinumb':{role:'primary',emit:emitAbox},
  'mb3d-reciprocalz3b':{role:'helper',emit:emitReciprocalZ3b},
  'mb3d-reciprocalx3b':{role:'helper',emit:emitReciprocalX3b},
  'mb3d-celticmode':{role:'helper',emit:emitCelticMode},
  'mb3d-heightmapifs':{role:'field',emit:emitHeightMap,prelude:DS_FIELD_MAP_PRELUDE},
  'mb3d-heightmaplimifs':{role:'field',emit:emitHeightMapLim,prelude:DS_FIELD_MAP_PRELUDE},
  'mb3d-randcubesifs':{role:'field',emit:emitRandCubes},
};
export const dsKernelRole=(id:string):DsKernel['role']|undefined=>Object.hasOwn(DS_KERNEL_REGISTRY,id)?DS_KERNEL_REGISTRY[id]!.role:undefined;
export const dsKernelIds=(role:DsKernel['role']):string[]=>Object.entries(DS_KERNEL_REGISTRY).filter(([,k])=>k.role===role).map(([id])=>id);
