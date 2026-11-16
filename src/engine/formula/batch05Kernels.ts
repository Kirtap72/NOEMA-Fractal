/**
 * Formula Library Expansion 05: eleven formulas whose mathematics is written out in their own formula-file descriptions
 * (the text after [END]; the compiled [CODE] sections were never read). See NewFormulas/formula-05/BATCH-05.md for every
 * equation, how ambiguous spots were read, and which candidates were skipped because their text does not define the maths.
 *
 *   uncounted transforms (helpers):  _FoldingCTetra3d, _helispiral, _BPolyhedronFromSphere, _BPolyhedronToSphere, _kamtor
 *   uncounted 3D -> 4D transforms:   _DonutTransform, _HexaTransform
 *   counted formulas:                Quadrat3D, RuckerBrot1 (3D, numeric estimator), _Log4D, _Exp4D (4D, numeric estimator)
 *
 * One place for metadata, the CPU step and the WGSL body so the two are read side by side. Authors are credited exactly as
 * the files state them (Luca GN, M. Benesi); none is guessed.
 */
import type { KernelInfo, KernelParameters, KernelState } from "./kernels";
import type { Parameter } from "./types";
import { applyMatrix } from "./primitives";
import type { Matrix } from "./primitives";

export const BATCH05_KERNEL_IDS = [
  "mb3d-foldingctetra3d", "mb3d-helispiral", "mb3d-donuttransform", "mb3d-hexatransform", "mb3d-bpolyhedronfromsphere", "mb3d-bpolyhedrontosphere",
  "mb3d-kamtor", "mb3d-quadrat3d", "mb3d-ruckerbrot1", "mb3d-log4d", "mb3d-exp4d",
] as const;
export type Batch05KernelId = (typeof BATCH05_KERNEL_IDS)[number];

const real = (name: string, label: string, def: number, min = -1000, max = 1000): Parameter => ({ name, label, default: def, min, max });
const flag = (name: string, label: string, def: number): Parameter => ({ name, label, default: def, min: 0, max: 1 });
const HELPER_HINTS = { deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0 };
/** Host controls every counted kernel carries (the 4D start slice, the Julia w, and the escape radius squared). */
const counted4d = (): Parameter[] => [real("slice_w", "4D slice / extra w", 0, -4, 4), real("constant_w", "Julia constant w", 0, -4, 4), real("bailout_squared", "Escape limit (radius²)", 16, 1, 65536)];
const counted3d = (): Parameter[] => [real("slice_w", "4D slice / extra w", 0, -4, 4), real("constant_w", "Julia constant w", 0, -4, 4), real("bailout_squared", "Escape limit (radius²)", 16, 1, 65536)];

export const BATCH05_DEFINITIONS: Record<Batch05KernelId, KernelInfo> = {
  // _FoldingCTetra3d: DEoption -1. Tetrahedral symmetry folds of C (and optionally of xyz).
  "mb3d-foldingctetra3d": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric", "analytic"], mappingHelper: true,
    parameters: [flag("c_fold_first_half", "C-fold 1:a halvan", 1), flag("c_fold_second_half", "C-fold 2:a halvan", 1), flag("fold_xyz_too", "Also fold xyz", 0)],
    hints: HELPER_HINTS,
  },
  // _helispiral: DEoption -1. A turn of the xy plane that depends on z (helix) and on the radius (spiral). It bends space, so numeric estimators only.
  "mb3d-helispiral": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"],
    parameters: [real("rotation_x", "Reference rotation X (degrees)", 0, -180, 180), real("rotation_y", "Reference rotation Y (degrees)", 0, -180, 180), real("rotation_z", "Reference rotation Z (degrees)", 0, -180, 180),
      real("helix", "Helix", 0.03, -100, 100), real("spiral", "Spiral", 0.03, -100, 100), flag("rot_by_c_h", "Helix from Cz", 0), flag("rot_by_c_s", "Spiral from |Cxy|", 0), real("fix_rot", "Fixed rotation (degrees)", 0, -360, 360)],
    hints: HELPER_HINTS,
  },
  // _DonutTransform: DEoption -1. A 3D point becomes a 4D point (toroidal coordinates); the same is done to C. Meant for 4D formulas after it.
  "mb3d-donuttransform": {
    dimension: 4, method: "numeric", role: "helper", wMode: "coordinate", helperMethods: ["numeric"],
    parameters: [real("offset", "Offset", 4, -1000, 1000), real("r_offset", "R-offset", 0.5, -1000, 1000), real("order", "Order", 5, -1000, 1000)],
    hints: HELPER_HINTS,
  },
  // _HexaTransform: DEoption -1. abs() folds along three hexagonal directions, giving a 4D point; the same for C.
  "mb3d-hexatransform": {
    dimension: 4, method: "numeric", role: "helper", wMode: "coordinate", helperMethods: ["numeric"],
    parameters: [real("offset", "Offset", 0, -1000, 1000)],
    hints: HELPER_HINTS,
  },
  // _BPolyhedronFromSphere / _BPolyhedronToSphere (M. Benesi): DEoption -1, inverse functions of each other.
  "mb3d-bpolyhedronfromsphere": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"],
    parameters: [real("sides", "Sides", 4, 0.01, 1000), real("sides2", "Sides 2", 4, 0.01, 1000)],
    hints: HELPER_HINTS,
  },
  "mb3d-bpolyhedrontosphere": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"],
    parameters: [real("sides", "Sides", 4, 0.01, 1000), real("sides2", "Sides 2", 4, 0.01, 1000)],
    hints: HELPER_HINTS,
  },
  // _kamtor: DEoption -1. A "KAM torus" map with twelve polynomial coefficients and two softness values.
  "mb3d-kamtor": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"],
    parameters: [real("soft1", "Soft1", 1.05, -100, 100), real("soft2", "Soft2", -0.05, -100, 100),
      real("a1", "A1", 1, -100, 100), real("b1", "B1", 0, -100, 100), real("c1", "C1", 0, -100, 100), real("d1", "D1", 0, -100, 100), real("e1", "E1", 0, -100, 100), real("f1", "F1", 0, -100, 100),
      real("a2", "A2", 0, -100, 100), real("b2", "B2", -1, -100, 100), real("c2", "C2", 1, -100, 100), real("d2", "D2", 0, -100, 100), real("e2", "E2", 0, -100, 100), real("f2", "F2", 0, -100, 100)],
    hints: HELPER_HINTS,
  },
  // Quadrat3D: no DEoption in the file (numeric estimator), DEscale 1, SIpower 2.
  "mb3d-quadrat3d": {
    dimension: 3, method: "numeric",
    parameters: [real("x_mul", "X mul", 1, -100, 100), real("y_mul", "Y mul", 2, -100, 100), real("z_mul", "Z mul", -2, -100, 100), real("h_radius", "HRadius", 0, -100, 100), real("z_radius", "ZRadius", 1, -100, 100), ...counted3d()],
    hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 },
  },
  // RuckerBrot1: no DEoption (numeric estimator), DEscale 1, SIpower 2.
  "mb3d-ruckerbrot1": {
    dimension: 3, method: "numeric",
    parameters: [real("x_mul", "X mul", 1, -100, 100), real("y_mul", "Y mul", 2, -100, 100), real("z_mul", "Z mul", -2, -100, 100), real("cz_mul", "Cz mul", -1, -100, 100), ...counted3d()],
    hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 },
  },
  // _Log4D / _Exp4D: DEoption 4 (numeric 4D), DEscale 1, SIpower 4. Quaternion logarithm and exponential.
  "mb3d-log4d": { dimension: 4, method: "numeric", parameters: counted4d(), hints: { deoption: 4, descale: 1, adescale: 1, rstop: 16, sipow: 4 } },
  "mb3d-exp4d": { dimension: 4, method: "numeric", parameters: counted4d(), hints: { deoption: 4, descale: 1, adescale: 1, rstop: 16, sipow: 4 } },
};

/** Kernels that need the shared three-angle rotation matrix (named like _Rotate's). */
export const BATCH05_ROTATIONS: Partial<Record<Batch05KernelId, string>> = { "mb3d-helispiral": "rotation" };

// ---- shared pieces (CPU) ----------------------------------------------------------------------------------------------
/** The six compare-and-swap steps of the description; `first` and `second` select the halves. */
export function tetraFold(v: number[], first: boolean, second: boolean): number[] {
  let [x, y, z] = v as [number, number, number], t: number;
  if (first) {
    if (x + y < 0) { t = -y; y = -x; x = t; }
    if (x + z < 0) { t = -z; z = -x; x = t; }
    if (y + z < 0) { t = -z; z = -y; y = t; }
  }
  if (second) {
    if (x - y < 0) { t = y; y = x; x = t; }
    if (x - z < 0) { t = z; z = x; x = t; }
    if (y - z < 0) { t = z; z = y; y = t; }
  }
  return [x, y, z];
}
/** The description's `while (r > pi/n) r -= 2 pi/n` in closed form (same result, no loop that could run for ever). */
export function reduceAngle(r: number, sides: number): number {
  const half = Math.PI / sides, period = 2 * half;
  return r > half ? r - Math.ceil((r - half) / period) * period : r;
}
const HEX_K1 = Math.sqrt(3) / 2;
const hexa = (x: number, y: number, z: number, o: number): [number, number, number, number] =>
  [Math.abs(x) - o, Math.abs(y * HEX_K1 + x * 0.5) - o, Math.abs(z) - o, Math.abs(y * -HEX_K1 + x * 0.5) - o];
const donut = (x: number, y: number, z: number, offset: number, delta: number, order: number): [number, number, number, number] => {
  const angle = Math.atan2(y, x) * order, radius = Math.sqrt(x * x + y * y), t = radius - offset;
  return [Math.sin(angle) * radius - delta, Math.cos(angle) * radius - delta, z - delta, t * t + z * z - delta];
};
const LOG_TINY = 1e-200;

export function stepBatch05Kernel(id: Batch05KernelId, p: KernelParameters, matrices: Matrix[], s: KernelState): void {
  let [x, y, z, w] = s.v;
  const [cx, cy, cz] = s.c;
  switch (id) {
    case "mb3d-foldingctetra3d": {
      // The description: with the first half switched off the second half is done anyway, so the transform is never empty.
      const first = p.c_fold_first_half! !== 0, second = p.c_fold_second_half! !== 0 || !first;
      const c = tetraFold([cx, cy, cz], first, second);
      s.c = [c[0]!, c[1]!, c[2]!, s.c[3]];
      if (p.fold_xyz_too! !== 0) { const v = tetraFold([x, y, z], first, second); [x, y, z] = v as [number, number, number]; }
      break;
    }
    case "mb3d-helispiral": {
      // 1) turn the reference axis (C is left alone), 2) turn the xy plane by an angle from z (helix) and the radius (spiral), 3) turn back.
      const q = applyMatrix(matrices[0]!, [x, y, z]) as [number, number, number];
      const phi = p.rot_by_c_h! !== 0 ? cz : q[2], rho = p.rot_by_c_s! !== 0 ? Math.sqrt(cx * cx + cy * cy) : Math.sqrt(q[0] * q[0] + q[1] * q[1]);
      const a = p.fix_rot! * 0.017453293 + rho * p.spiral! + phi * p.helix!, sn = Math.sin(a), cs = Math.cos(a);
      const t = matrices[0]!, back = [0, 1, 2].map((r) => [0, 1, 2].map((k) => t[k]![r]!));
      [x, y, z] = applyMatrix(back, [q[0] * cs + q[1] * sn, q[1] * cs - q[0] * sn, q[2]]) as [number, number, number];
      break;
    }
    case "mb3d-donuttransform": {
      [x, y, z, w] = donut(x, y, z, p.offset!, p.r_offset!, p.order!);
      const c = donut(cx, cy, cz, p.offset!, p.r_offset!, p.order!);
      s.c = [c[0], c[1], c[2], c[3]];
      break;
    }
    case "mb3d-hexatransform": {
      [x, y, z, w] = hexa(x, y, z, p.offset!);
      const c = hexa(cx, cy, cz, p.offset!);
      s.c = [c[0], c[1], c[2], c[3]];
      break;
    }
    case "mb3d-bpolyhedronfromsphere":
    case "mb3d-bpolyhedrontosphere": {
      if (!(p.sides! > 0) || !(p.sides2! > 0)) { s.invalid = true; return; }
      const inverse = id === "mb3d-bpolyhedrontosphere";
      const r1 = reduceAngle(Math.abs(Math.atan2(z, y)), p.sides!), f1 = Math.cos(r1);
      if (inverse && Math.abs(f1) < 1e-12) { s.invalid = true; return; }
      y = inverse ? y / f1 : y * f1; z = inverse ? z / f1 : z * f1;
      const r2 = reduceAngle(Math.abs(Math.atan2(Math.sqrt(z * z + y * y), x)), p.sides2!), f2 = Math.cos(r2);
      if (inverse && Math.abs(f2) < 1e-12) { s.invalid = true; return; }
      x = inverse ? x / f2 : x * f2; y = inverse ? y / f2 : y * f2; z = inverse ? z / f2 : z * f2;
      break;
    }
    case "mb3d-kamtor": {
      const rr = Math.sqrt(x * x + y * y), zp = p.soft1! * z + p.soft2! * rr;
      // zp = 0 is valid (Soft1 = Soft2 = 0): |zp| < 1 gives t1 = zp = 0, and 1/zp is only taken for |zp| >= 1 (MATH-AUDIT 08).
      const t1 = Math.abs(zp) < 1 ? zp : 1 / zp, t2 = Math.sqrt(Math.max(0, 1 - t1 * t1));
      const poly = (a: number, b: number, c: number, d: number, e: number, f: number) => a * x + b * y + c * x * x + d * y * y + e * x * y + f * rr;
      const p1 = poly(p.a1!, p.b1!, p.c1!, p.d1!, p.e1!, p.f1!), p2 = poly(p.a2!, p.b2!, p.c2!, p.d2!, p.e2!, p.f2!);
      x = t2 * p1 + t1 * p2; y = t1 * p1 + t2 * p2; z = zp;
      break;
    }
    case "mb3d-quadrat3d": {
      const temp = p.h_radius! + x * x + y * y;
      if (temp === 0) { x = cx; y = cy; z = cz; }
      else if (temp < 0) { x = 0; y = 0; z = 0; }
      else {
        const k = p.z_radius! - (z * z) / temp;
        [x, y, z] = [p.x_mul! * (x * x - y * y) * k + cx, p.y_mul! * x * y * k + cy, p.z_mul! * z * Math.sqrt(temp) + cz];
      }
      break;
    }
    case "mb3d-ruckerbrot1": {
      const r2 = x * x + y * y + z * z, temp = r2 / (Math.sqrt(x * x + z * z) + 1e-10), d = y * y + x * x + 1e-10;
      [x, y, z] = [((x * x - y * y) / d) * Math.abs(x) * temp * p.x_mul! + cx, ((y * x * Math.abs(x)) / d) * temp * p.y_mul! + cy, z * Math.sqrt(r2) * p.z_mul! + Math.abs(cz) * p.cz_mul!];
      break;
    }
    case "mb3d-log4d": {
      const t1 = Math.sqrt(w * w + y * y + z * z);
      if (t1 !== 0) {
        const t2 = Math.atan2(t1, x) / t1, t3 = x * x + t1 * t1;
        x = t3 > LOG_TINY ? 0.5 * Math.log(t3) : -460;
        y *= t2; z *= t2; w *= t2;
      } else {
        y = Math.atan2(x, 0);
        x = x > LOG_TINY ? Math.log(x) : -460;
      }
      break;
    }
    case "mb3d-exp4d": {
      const t1 = Math.sqrt(w * w + y * y + z * z), e = Math.exp(x);
      x = e * Math.cos(t1);
      let t2 = e * Math.sin(t1);
      if (t1 > LOG_TINY) t2 /= t1;
      y *= t2; z *= t2; w *= t2;
      break;
    }
  }
  s.v = [x, y, z, w];
  if (![...s.v, ...s.c].every(Number.isFinite)) s.invalid = true;
}

// ---- WGSL ----------------------------------------------------------------------------------------------------------------
// The bodies are self-contained (no functions added to the shared primitives), so every existing shader text stays byte-identical.
// Local names must not be `u` (the uniform block the parameters are read from) or any other global of the engine shader.
// All float32; the thresholds below are the float32 stand-ins for 1e-200.

/** Tetrahedral fold of the vector in `tv[k]` (WGSL text, loop body); `first`/`second` are bool lets declared by the caller. */
const TETRA_BODY = `var x=tv[k].x;var y=tv[k].y;var z=tv[k].z;var t=0.0;
  if(first){if(x+y<0.0){t=-y;y=-x;x=t;}if(x+z<0.0){t=-z;z=-x;x=t;}if(y+z<0.0){t=-z;z=-y;y=t;}}
  if(second){if(x-y<0.0){t=y;y=x;x=t;}if(x-z<0.0){t=z;z=x;x=t;}if(y-z<0.0){t=z;z=y;y=t;}}
  tv[k]=vec3f(x,y,z);`;

export function batch05Body(id: Batch05KernelId, p: (name: string) => string, matrixNames: string[]): string {
  switch (id) {
    case "mb3d-foldingctetra3d":
      return `let first=${p("c_fold_first_half")}!=0.0;let second=${p("c_fold_second_half")}!=0.0||!first;
 var tv=array<vec3f,2>(s.c.xyz,s.v.xyz);
 for(var k=0;k<2;k++){if(k==1&&${p("fold_xyz_too")}==0.0){continue;}
  ${TETRA_BODY}}
 s.c=vec4f(tv[0],s.c.w);s.v=vec4f(tv[1],s.v.w);`;
    case "mb3d-helispiral":
      return `let q=${matrixNames[0]!}*s.v.xyz;
 let phi=select(q.z,s.c.z,${p("rot_by_c_h")}!=0.0);let rho=select(sqrt(q.x*q.x+q.y*q.y),sqrt(s.c.x*s.c.x+s.c.y*s.c.y),${p("rot_by_c_s")}!=0.0);
 let a=${p("fix_rot")}*0.017453293+rho*${p("spiral")}+phi*${p("helix")};let sn=sin(a);let cs=cos(a);
 s.v=vec4f(transpose(${matrixNames[0]!})*vec3f(q.x*cs+q.y*sn,q.y*cs-q.x*sn,q.z),s.v.w);`;
    case "mb3d-donuttransform":
      return `var src=array<vec3f,2>(s.v.xyz,s.c.xyz);var dst=array<vec4f,2>(vec4f(0.0),vec4f(0.0));
 for(var k=0;k<2;k++){let pt=src[k];let angle=atan2(pt.y,pt.x)*${p("order")};let radius=sqrt(pt.x*pt.x+pt.y*pt.y);let t=radius-${p("offset")};let delta=${p("r_offset")};
  dst[k]=vec4f(sin(angle)*radius-delta,cos(angle)*radius-delta,pt.z-delta,t*t+pt.z*pt.z-delta);}
 s.v=dst[0];s.c=dst[1];`;
    case "mb3d-hexatransform":
      return `var src=array<vec3f,2>(s.v.xyz,s.c.xyz);var dst=array<vec4f,2>(vec4f(0.0),vec4f(0.0));let o=${p("offset")};let k1=0.8660254037844386;
 for(var k=0;k<2;k++){let pt=src[k];dst[k]=vec4f(abs(pt.x)-o,abs(pt.y*k1+pt.x*0.5)-o,abs(pt.z)-o,abs(pt.y*(-k1)+pt.x*0.5)-o);}
 s.v=dst[0];s.c=dst[1];`;
    case "mb3d-bpolyhedronfromsphere":
    case "mb3d-bpolyhedrontosphere": {
      const inv = id === "mb3d-bpolyhedrontosphere", op = inv ? "/" : "*";
      return `if(!(${p("sides")}>0.0)||!(${p("sides2")}>0.0)){s.invalid=true;}else{
 var v=s.v.xyz;
 let h1=3.14159265358979/${p("sides")};var r1=abs(atan2(v.z,v.y));if(r1>h1){r1=r1-ceil((r1-h1)/(2.0*h1))*2.0*h1;}
 let f1=cos(r1);
 ${inv ? "if(abs(f1)<1.0e-6){s.invalid=true;}" : ""}
 v=vec3f(v.x,v.y${op}f1,v.z${op}f1);
 let h2=3.14159265358979/${p("sides2")};var r2=abs(atan2(sqrt(v.z*v.z+v.y*v.y),v.x));if(r2>h2){r2=r2-ceil((r2-h2)/(2.0*h2))*2.0*h2;}
 let f2=cos(r2);
 ${inv ? "if(abs(f2)<1.0e-6){s.invalid=true;}" : ""}
 v=v${op}f2;s.v=vec4f(v,s.v.w);}`;
    }
    case "mb3d-kamtor":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let rr=sqrt(x*x+y*y);let zp=${p("soft1")}*z+${p("soft2")}*rr;
 {
 var t1=zp;if(abs(zp)>=1.0){t1=1.0/zp;}let t2=sqrt(max(0.0,1.0-t1*t1));
 let p1=${p("a1")}*x+${p("b1")}*y+${p("c1")}*x*x+${p("d1")}*y*y+${p("e1")}*x*y+${p("f1")}*rr;
 let p2=${p("a2")}*x+${p("b2")}*y+${p("c2")}*x*x+${p("d2")}*y*y+${p("e2")}*x*y+${p("f2")}*rr;
 s.v=vec4f(t2*p1+t1*p2,t1*p1+t2*p2,zp,s.v.w);}`;
    case "mb3d-quadrat3d":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let temp=${p("h_radius")}+x*x+y*y;
 if(temp==0.0){s.v=vec4f(s.c.xyz,s.v.w);}else if(temp<0.0){s.v=vec4f(0.0,0.0,0.0,s.v.w);}else{
 let k=${p("z_radius")}-z*z/temp;
 s.v=vec4f(${p("x_mul")}*(x*x-y*y)*k+s.c.x,${p("y_mul")}*x*y*k+s.c.y,${p("z_mul")}*z*sqrt(temp)+s.c.z,s.v.w);}`;
    case "mb3d-ruckerbrot1":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let r2=x*x+y*y+z*z;let temp=r2/(sqrt(x*x+z*z)+1.0e-10);let d=y*y+x*x+1.0e-10;
 s.v=vec4f((x*x-y*y)/d*abs(x)*temp*${p("x_mul")}+s.c.x,(y*x*abs(x))/d*temp*${p("y_mul")}+s.c.y,z*sqrt(r2)*${p("z_mul")}+abs(s.c.z)*${p("cz_mul")},s.v.w);`;
    case "mb3d-log4d":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let w=s.v.w;let t1=sqrt(w*w+y*y+z*z);
 if(t1!=0.0){let t2=atan2(t1,x)/t1;let t3=x*x+t1*t1;var nx=-460.0;if(t3>1.0e-37){nx=0.5*log(t3);}s.v=vec4f(nx,y*t2,z*t2,w*t2);}
 else{var nx=-460.0;if(x>1.0e-37){nx=log(x);}s.v=vec4f(nx,atan2(x,0.0),z,w);}`;
    case "mb3d-exp4d":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let w=s.v.w;let t1=sqrt(w*w+y*y+z*z);let e=exp(x);
 var t2=e*sin(t1);if(t1>1.0e-37){t2=t2/t1;}
 s.v=vec4f(e*cos(t1),y*t2,z*t2,w*t2);`;
  }
}
