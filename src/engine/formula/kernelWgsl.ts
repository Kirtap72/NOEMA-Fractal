import {importedHelperBody,isImportedHelperId} from './importedHelper';
import {ROOM_CLR_ID,roomClrBody} from './roomClr';
import {UNLOCK09_KERNEL_IDS} from './unlock09Metadata';
import {unlock09Body} from './unlock09Kernels';
import {RECREATION_NINE_KERNEL_IDS,RECREATION_NINE_DEFINITIONS} from './recreationNineMetadata';
import {recreationNineBody} from './recreationNineKernels';
import {GATEWAY_KERNEL_IDS,GATEWAY_DEFINITIONS} from './gatewayMetadata';
import {RECREATION_SIX_KERNEL_IDS,RECREATION_SIX_DEFINITIONS} from './recreationSixMetadata';
import {recreationSixBody} from './recreationSixKernels';
import {C_VECTOR_KERNEL_IDS,cVectorBody} from './cVector';
import {FOLLOWUP_KERNEL_IDS,followupBody} from './followupKernels';
import type {FollowupKernelId} from './followupKernels';
import {BATCH05_KERNEL_IDS,batch05Body} from './batch05Kernels';
import type {Batch05KernelId} from './batch05Kernels';
import {BATCH06_KERNEL_IDS,batch06Body} from './batch06Kernels';
import type {Batch06KernelId} from './batch06Kernels';
import {BATCH07_KERNEL_IDS,batch07Body} from './batch07Kernels';
import type {Batch07KernelId} from './batch07Kernels';
import {BATCH08_KERNEL_IDS,batch08Body} from './batch08Kernels';
import type {Batch08KernelId} from './batch08Kernels';
import type {CVectorKernelId} from './cVector';
import {AXIS_MAP_KERNEL_IDS,axisMapBody} from './axisMaps';
import type {AxisMapKernelId} from './axisMaps';
import {gatewayBody} from './gatewayKernels';
import { PLATINUM_PRIMITIVES_WGSL, platinumBody } from "./platinum";
import { FOLD_PAIRS, ROTATION_PLANES } from "./primitives";
import type { KernelId } from "./kernels";
import { batch02Body, BATCH_02_PRIMITIVES_WGSL } from "./batch02Wgsl";
import { batch03Body, BATCH_03_PRIMITIVES_WGSL } from "./batch03Wgsl";
import { essentialsBody, ESSENTIALS_PRIMITIVES_WGSL } from "./essentialsWgsl";
import {
  ESSENTIALS_DEFINITIONS,
  ESSENTIALS_KERNEL_IDS,
} from "./essentialsMetadata";

/** GPU implementation of the handoff primitives, independent of the CPU evaluator. */
export const KERNEL_PRIMITIVES_WGSL = /* wgsl */ `
struct KernelOrbit { v: vec4f, c: vec4f, history: vec4f, derivative: f32, count: f32, rho: f32, trap: f32, field: f32, varyScale: f32, bestDistance: f32, bestIteration: f32, first: bool, invalid: bool, escaped: bool, original: vec3f, firstIteration:f32, temporary:f32, free:vec2f, extraDerivatives:vec2f, queryThreshold:f32, mapPadding:f32 }
struct KernelMapResult { v: vec4f, invalid: bool }
fn kernelFinite(x: f32) -> bool { return x == x && abs(x) <= 3.402823e38; }
fn kernelRadius(v: vec4f, dimension: i32) -> f32 { if (dimension == 4) { return dot(v,v); } return dot(v.xyz,v.xyz); }
fn quadrayLift(v: vec3f) -> vec4f { return abs(vec4f(v.x+v.y+v.z,-v.x-v.y+v.z,-v.x+v.y-v.z,v.x-v.y-v.z)); }
fn quadraySquare(v: vec4f) -> vec4f { return vec4f(v.x*v.x-v.y*v.y+2.0*v.w*v.z,v.y*v.y-v.x*v.x+2.0*v.w*v.z,v.z*v.z-v.w*v.w+2.0*v.x*v.y,v.w*v.w-v.z*v.z+2.0*v.x*v.y); }
fn kernelRotation3(angles: vec3f) -> mat3x3f {
  let s=sin(angles*0.017453292519943295); let c=cos(angles*0.017453292519943295);
  return mat3x3f(vec3f(c.y*c.z,s.x*s.y*c.z+c.x*s.z,s.x*s.z-c.x*s.y*c.z),vec3f(-c.y*s.z,c.x*c.z-s.x*s.y*s.z,c.x*s.y*s.z+s.x*c.z),vec3f(s.y,-s.x*c.y,c.x*c.y));
}
fn kernelPlane(angle: f32, a: i32, b: i32) -> mat4x4f {
  var m=mat4x4f(vec4f(1,0,0,0),vec4f(0,1,0,0),vec4f(0,0,1,0),vec4f(0,0,0,1));
  let c=cos(angle*0.017453292519943295); let s=sin(angle*0.017453292519943295);
  m[a][a]=c; m[b][b]=c; m[b][a]=-s; m[a][b]=s; return m;
}
fn kernelGolden(input: vec3f) -> vec3f {
  var v=input; let n=vec3f(0.309016994374947,-0.5,-0.809016994374947);
  for(var i=0;i<3;i++) { let d=dot(v,n); if(d<0.0) {v-=2.0*d*n;} v.y=abs(v.y);v.z=abs(v.z); } return v;
}
fn kernelPairs(input: vec4f) -> vec4f {
  var v=input;
  ${FOLD_PAIRS.map(([a, b]) => `if(v[${a}]+v[${b}]<=0.0) {let old=v;v[${a}]=-old[${b}];v[${b}]=-old[${a}];}`).join("\n  ")}
  return v;
}
fn kernelPasses(x: f32) -> i32 { return max(1,i32(round(x)) & 7); }
fn kernelChart(v:vec3f,dihedral:bool)->vec3f {
  let radius=length(v);
  if(!(radius>0.0) || v.x==0.0 || !(1.0+v.z/radius>0.0)) {return vec3f(0.0);}
  let q=(length(v.xy)-v.y)/v.x;
  let a=sqrt((1.0-v.z/radius)/(1.0+v.z/radius))/(1.0+q*q);
  if(dihedral) {return vec3f(2.0*a*q,a*(1.0-q*q),radius);}
  return vec3f(a*(q*q-1.0),2.0*a*q,radius);
}
fn kernelInverseChart(u:f32,t:f32,radius:f32,sign:f32)->vec4f {
  if(u==0.0) {return vec4f(0.0);}
  let h=u*u+t*t;let mag=sqrt(h);let q=(mag-t)/u;let a=1.0/(1.0+q*q);let b=2.0/(1.0+h);
  return vec4f(radius*vec3f(2.0*q*a*b*mag,(1.0-q*q)*a*b*mag,sign*(b-1.0)),1.0);
}
fn kernelTglad(input: vec4f, c: vec4f, outer: i32, inner: i32) -> KernelMapResult {
  var v=input;
  for(var o=0;o<outer;o++) {
    let rr=dot(v.xyz,v.xyz);
    if(rr>=1e10) {return KernelMapResult(vec4f(vec3f(1e10),v.w),false);}
    var radius=sqrt(rr);
    let chart=kernelChart(v.xyz,false);
    if(chart.z==0.0) {return KernelMapResult(input,true);}
    var u=chart.x;var t=chart.y;
    for(var j=0;j<inner;j++) {
      let bigS=u*u*u-3.0*u*t*t;
      if(bigS>=1e10) {return KernelMapResult(vec4f(vec3f(1e10),v.w),false);}
      let bigT=t*t*t-3.0*t*u*u;
      let den=bigT*bigT+(bigS+0.3535533905932738)*(bigS+0.3535533905932738);
      if(den==0.0) {return KernelMapResult(input,true);}
      let aa=(bigS+0.3535533905932738)*(2.8284271247461903-bigS)-bigT*bigT;
      let bb=3.181980515339464*bigT; let cc=-0.3535533905932738/den;
      let oldU=u; u=(aa*u-bb*t)*cc;t=(aa*t+bb*oldU)*cc;radius*=radius;
    }
    let oldU=u;u=t;t=oldU;
    let inverse=kernelInverseChart(u,t,radius,-1.0);
    if(inverse.w==0.0) {return KernelMapResult(input,true);}
    v=vec4f(inverse.xyz,v.w);
  }
  return KernelMapResult(vec4f(v.xyz+c.xyz,v.w),false);
}
${BATCH_02_PRIMITIVES_WGSL}
${BATCH_03_PRIMITIVES_WGSL}
${ESSENTIALS_PRIMITIVES_WGSL}
${PLATINUM_PRIMITIVES_WGSL}
`;

export function kernelMatrices(
  id: KernelId,
  p: (name: string) => string,
  prefix: string,
): { declarations: string[]; args: { name: string; type: string }[] } {
  const declarations: string[] = [],
    args: { name: string; type: string }[] = [];
  const add3 = (paramPrefix: string, suffix: string) => {
    const name = `${prefix}${suffix}`;
    args.push({ name, type: "mat3x3f" });
    declarations.push(
      `let ${name}=kernelRotation3(vec3f(${["x", "y", "z"].map((a) => p(`${paramPrefix}_${a}`)).join(",")}));`,
    );
  };
  if (id === "mb3d-aboxplatinum" || id === "mb3d-aboxplatinumb") { add3("rotate", "a"); return { declarations, args }; }
  if (id === "mb3d-rotatec") { add3("rotation_c", "a"); return { declarations, args }; }
  if (id === "mb3d-kochcube") { add3("rotation", "a"); return { declarations, args }; }
  const recreation=[...RECREATION_SIX_DEFINITIONS,...RECREATION_NINE_DEFINITIONS].find(d=>d.id===id);
  if(recreation){recreation.rotations.forEach((prefix,i)=>add3(prefix,String(i)));return {declarations,args};}
  const definition = ESSENTIALS_DEFINITIONS.find((d) => d.id === id);
  if (definition) {
    definition.rotations.forEach((rotation, index) => {
      if (rotation.dimension === 3) add3(rotation.prefix, String(index));
      else {
        const name = prefix + index;
        args.push({ name, type: "mat4x4f" });
        declarations.push(
          `var ${name}=mat4x4f(vec4f(1,0,0,0),vec4f(0,1,0,0),vec4f(0,0,1,0),vec4f(0,0,0,1));`,
        );
        ROTATION_PLANES.forEach(([a, b], i) =>
          declarations.push(
            `${name}=kernelPlane(${p(rotation.prefix + "_" + ["yz", "xz", "xy", "xw", "yw", "zw"][i])},${a},${b})*${name};`,
          ),
        );
      }
    });
    return { declarations, args };
  }
  if(GATEWAY_DEFINITIONS.find(d=>d.id===id)?.rotation||id==="mb3d-helispiral")add3("rotation","a");
  if (id === "menger-ifs" || id === "riemann-2") add3("rotation", "a");
  if (id === "icosahedron-ifs") {
    add3("rotation1", "a");
    add3("rotation2", "b");
  }
  if (id === "manowar-bulb") add3("manowar_rot", "a");
  if (id === "scherk-fs") add3("scherkrot", "a");
  if (id === "sierpinski-4" || id === "octahedron-4") {
    const name = `${prefix}a`;
    args.push({ name, type: "mat4x4f" });
    declarations.push(
      `var ${name}=mat4x4f(vec4f(1,0,0,0),vec4f(0,1,0,0),vec4f(0,0,1,0),vec4f(0,0,0,1));`,
    );
    ROTATION_PLANES.forEach(([a, b], i) =>
      declarations.push(
        `${name}=kernelPlane(${p(`rotation_${["yz", "xz", "xy", "xw", "yw", "zw"][i]}`)},${a},${b})*${name};`,
      ),
    );
  }
  return { declarations, args };
}

/** Body acts on a shared KernelOrbit named s; host bookkeeping follows every call. */
export function kernelBody(
  id: KernelId,
  p: (name: string) => string,
  matrixNames: string[],
): string {
  if (isImportedHelperId(id)) return importedHelperBody(id, p);
  if((AXIS_MAP_KERNEL_IDS as readonly string[]).includes(id))return axisMapBody(id as AxisMapKernelId,p);
  if((C_VECTOR_KERNEL_IDS as readonly string[]).includes(id))return cVectorBody(id as CVectorKernelId,p,matrixNames);
  if((FOLLOWUP_KERNEL_IDS as readonly string[]).includes(id))return followupBody(id as FollowupKernelId,p,matrixNames);
  if((BATCH05_KERNEL_IDS as readonly string[]).includes(id))return batch05Body(id as Batch05KernelId,p,matrixNames);
  if((BATCH06_KERNEL_IDS as readonly string[]).includes(id))return batch06Body(id as Batch06KernelId,p,matrixNames);
  if((BATCH07_KERNEL_IDS as readonly string[]).includes(id))return batch07Body(id as Batch07KernelId,p,matrixNames);
  if((BATCH08_KERNEL_IDS as readonly string[]).includes(id))return batch08Body(id as Batch08KernelId,p,matrixNames);
  if (id === "mb3d-absy") return `s.v.y=abs(s.v.y+${p('fix_y')})-${p('fix_y')};`;
  if (id === "mb3d-absz") return `s.v.z=abs(s.v.z+${p('fix_z')})-${p('fix_z')};`;
  if (id === "mb3d-absx") return `s.v.x=abs(s.v.x+${p('fix_x')})-${p('fix_x')};`;
  if (id === "mb3d-celticmode") return `let old=s.v;let shift=s.c.x*${p('good')};
    s.v.x=abs(old.x+shift)-shift+old.x*${p('evil')};
    if(${p('mystic')}!=0.0){s.v.z=abs(old.z+s.c.z*${p('mystic')})-s.c.z*${p('heretic')};}`;
  if (id === "mb3d-reciprocalz3b") return `let z=s.v.z;let l1=${p('limiter1')};let l2=${p('limiter2')};
    let a=1.0/max(1e-40,l1)-1.0/(abs(z*${p('mul1')})+l1);
    let b=1.0/max(1e-40,l2)-1.0/(abs(z*z*${p('mul2')})+l2);
    s.v.z=select(a+b,-(a+b),(bitcast<u32>(z)&0x80000000u)!=0u);`;
  if (id === "mb3d-reciprocalx3b") return `let x=s.v.x;let l1=${p('limiter1')};let l2=${p('limiter2')};
    let a=1.0/max(1e-40,l1)-1.0/(abs(x*${p('mul1')})+l1);
    let b=1.0/max(1e-40,l2)-1.0/(abs(x*x*${p('mul2')})+l2);
    s.v.x=select(a+b,-(a+b),(bitcast<u32>(x)&0x80000000u)!=0u);`;
  if((GATEWAY_KERNEL_IDS as readonly string[]).includes(id))return gatewayBody(id,p,matrixNames);
  if(id===ROOM_CLR_ID)return roomClrBody(p);
  if((UNLOCK09_KERNEL_IDS as readonly string[]).includes(id))return unlock09Body(id,p);
  if((RECREATION_NINE_KERNEL_IDS as readonly string[]).includes(id))return recreationNineBody(id,p,matrixNames);
  if((RECREATION_SIX_KERNEL_IDS as readonly string[]).includes(id))return recreationSixBody(id,p,matrixNames);
  if (id === "mb3d-dodecahedronifs")
    return `let previous=s.derivative;s.derivative=s.v.w;{${kernelBody("icosahedron-ifs", p, matrixNames)}}s.v.w=s.derivative;s.derivative=previous;`;
  if (id === "mb3d-aboxplatinum") return platinumBody(p,matrixNames[0]!);
  if (id === "mb3d-aboxplatinumb") return platinumBody(p,matrixNames[0]!,true);
  if(id==='mb3d-internal-amazingbox')return `let q=vec3f(essentialBox(s.v.x,${p('fold')}),essentialBox(s.v.y,${p('fold')}),essentialBox(s.v.z,${p('fold')}));
    let rr=dot(q,q);let low=pow(max(1e-40,${p('min_r')}),2.0);
    if(!kernelFinite(rr)||(low==0.0&&rr==0.0)){s.invalid=true;break;}
    let m=essentialSphere(rr,low,${p('scale')},${p('scale')});s.v=vec4f(m*q+s.c.xyz,m*s.v.w);`;
  if ((ESSENTIALS_KERNEL_IDS as readonly string[]).includes(id))
    return essentialsBody(id, p, matrixNames);
  const v = (names: string[]) =>
    `vec${names.length}f(${names.map(p).join(",")})`;
  const m = matrixNames;
  switch (id) {
    case "faehrten":
    case "mandel-4d-bic":
    case "hyperd-1":
    case "makin-4d-p2a":
    case "sin-4d-plus":
    case "riemann-2":
    case "torus-ellip-ifs":
    case "klein-bagel-ifs":
    case "helix-ifs":
    case "hopalong":
      return batch03Body(id, p, m);
    case "beth-2422":
    case "ides-formula":
    case "aex-octo":
    case "lambda-4dc":
    case "barnsley-4dnc":
    case "kalisets-1":
    case "menger-hyper":
    case "octahedron-4":
    case "tglad-dihed":
    case "scherk-fs":
      return batch02Body(id, p, matrixNames);
    case "cubic-quat":
      return `let a=s.v; s.v=vec4f(${p("x_mul")}*a.x*a.x-${p("y_mul")}*a.y*a.y-${p("z_mul")}*a.z*a.z-${p("w_mul")}*a.w*a.w+s.c.x+${p("x_twist")}*s.c.y,2.0*${p("y_mul")}*a.x*a.y+s.c.y+${p("y_twist")}*s.c.x,2.0*${p("z_mul")}*a.x*a.z+s.c.z,2.0*${p("w_mul")}*a.x*a.w+s.c.w+${p("w_add")});`;
    case "hopf-4d":
      return `let a=s.v;let aa=dot(a.xy,a.xy);let bb=dot(a.zw,a.zw);if(!(aa>0.0) || !(bb>0.0)) {s.invalid=true;break;}let h=1.0-bb/aa;let t=2.0*sqrt(aa/bb);s.v=vec4f((a.x*a.x-a.y*a.y)*h+s.c.x,2.0*a.x*a.y*h+s.c.y,${p("z_mul")}*(a.z*a.z-a.w*a.w)*t+s.c.z,a.z*a.w*t+s.c.w+${p("w_add")});`;
    case "quadray-brot":
      return "s.v=quadraySquare(s.v)+quadrayLift(s.c.xyz);";
    case "aexion-1":
      return `if(!s.first) {s.first=true;s.firstIteration=1.0;s.c=quadrayLift(s.c.xyz)+vec4f(${p("c_add")});s.v=quadrayLift(s.v.xyz)+vec4f(${p("c_add")});}s.v=quadraySquare(s.v)+s.c;`;
    case "menger-ifs":
      return `let scale=${p("scale")};if(scale==0.0) {s.invalid=true;break;}let a=abs(s.v.xyz);let top=max(a.x,max(a.y,a.z));let bottom=min(a.x,min(a.y,a.z));let middle=max(min(a.x,a.y),min(max(a.x,a.y),a.z));let b=${m[0]}*vec3f(top,middle,bottom);let offset=${p("cscale_z")}*(scale-1.0)/scale;s.v=vec4f(scale*b.x-${p("cscale_x")}*(scale-1.0),scale*b.y-${p("cscale_y")}*(scale-1.0),scale*(offset-abs(b.z-offset)),s.v.w);s.derivative*=scale;`;
    case "icosahedron-ifs":
      return `let b=${m[1]}*kernelGolden(abs(${m[0]}*s.v.xyz));let scale=${p("scale")};s.v=vec4f(scale*b-(scale-1.0)*${v(["cscale_x", "cscale_y", "cscale_z"])},s.v.w);s.derivative*=scale;`;
    case "sierpinski-4":
      return `let b=${m[0]}*kernelPairs(s.v);let scale=${p("scale")};s.v=scale*b-(scale-1.0)*${v(["cscale_x", "cscale_y", "cscale_z", "cscale_w"])};s.derivative*=scale;`;
    case "tglad-tetra-2":
      return `let mapped=kernelTglad(s.v,s.c,kernelPasses(${p("log2_power")}),kernelPasses(${p("log2_map_power")}));if(mapped.invalid) {s.invalid=true;break;}s.v=mapped.v;`;
    case "manowar-bulb":
      return `if(!s.first) {s.first=true;s.history=vec4f(0.0);}else{let a=s.v;let radius=length(a.xyz);if(!(radius>0.0)) {s.invalid=true;break;}let old=s.history;s.history=a;let phi=${p("power")}*atan2(a.y,a.x);let theta=${p("power")}*atan2(a.z,length(a.xy));let bulb=pow(radius,${p("power")})*vec3f(cos(phi)*cos(theta),sin(phi)*cos(theta),${p("z_mul")}*sin(theta));let memory=${m[0]}*(${p("manowar_strength")}*vec3f(old.x,old.y,old.w));s.v=vec4f(bulb+memory+${p("phoenix_strength")}*a.xyz+s.c.xyz,a.w);}`;
    case "fuzzy":
      return `let a=s.v;let ratio=a.z/sqrt(s.rho);if(!(s.rho>0.0) || !(abs(ratio)<=1.0)) {s.invalid=true;break;}let k=(s.count+1.0)*${p("power")};let theta=k*asin(ratio);let phi=k*atan2(a.y,a.x);let amplitude=pow(s.rho,${p("power")}-1.0);s.v=vec4f(amplitude*cos(theta)*cos(phi)+s.c.x,amplitude*cos(theta)*sin(phi)*${p("y_multiplier")}+s.c.y,s.c.z-amplitude*sin(theta),a.w);`;
  }
  throw new Error("Unregistered kernel shader " + id);
}
