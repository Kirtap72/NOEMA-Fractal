/**
 * Formula Library 07: fifteen formulas whose mathematics is written out in their own formula-file descriptions (the clear text after
 * [END]; the compiled [CODE] sections and any machine-code listing that follows a description were never read or used).
 * See NewFormulas/formula-07/BATCH-07.md for every equation, how ambiguous spots were read, and the candidates that were skipped.
 *
 *   counted 3D (numeric):   MsltoeSym2, MsltoeSym3, KaliDucks
 *   counted 4D (numeric):   PG-bulb, QuatPow, _Atan4D
 *   counted 4D (IFS):       Menger4
 *   uncounted 4D helpers:   _lorenz, _rossler, _vanderpol, _vanderpol2 (hyperchaotic systems as deformations), _FoldingInfy, _sqr_4D,
 *                           _SphereInvC4d, _ScaleC4d (both also act on the constant C)
 *
 * One place for metadata, the CPU step and the WGSL body so the two are read side by side. Authors are credited exactly as the files state them.
 * WGSL bodies are self-contained and never declare a local called `u` (the uniform block the parameters are read from).
 */
import type { KernelInfo, KernelParameters, KernelState } from "./kernels";
import type { Parameter } from "./types";
import { applyMatrix, rotation4 } from "./primitives";
import { roundHalfEven } from "./batch06Kernels";

export const BATCH07_KERNEL_IDS = [
  "mb3d-msltoesym2", "mb3d-msltoesym3", "mb3d-kaliducks", "mb3d-pgbulb", "mb3d-quatpow", "mb3d-atan4d", "mb3d-menger4",
  "mb3d-lorenz4d", "mb3d-rossler4d", "mb3d-vanderpol", "mb3d-vanderpol2", "mb3d-foldinginfy", "mb3d-sqr4d", "mb3d-sphereinvc4d", "mb3d-scalec4d",
] as const;
export type Batch07KernelId = (typeof BATCH07_KERNEL_IDS)[number];

const real = (name: string, label: string, def: number, min = -1000, max = 1000): Parameter => ({ name, label, default: def, min, max });
const flag = (name: string, label: string, def: number): Parameter => ({ name, label, default: def, min: 0, max: 1 });
const HELPER_HINTS = { deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0 };
const counted = (bailout = 16): Parameter[] => [real("slice_w", "4D slice / extra w", 0, -4, 4), real("constant_w", "Julia constant w", 0, -4, 4), real("bailout_squared", "Escape limit (radius²)", bailout, 1, 65536)];
const ROTATION_NAMES = ["yz", "xz", "xy", "xw", "yw", "zw"] as const;
const helper4d = (parameters: Parameter[]): KernelInfo => ({ dimension: 4, method: "numeric", role: "helper", wMode: "coordinate", helperMethods: ["numeric"], parameters, hints: HELPER_HINTS });

export const BATCH07_DEFINITIONS: Record<Batch07KernelId, KernelInfo> = {
  // MsltoeSym2 / MsltoeSym3 (Msltoe): DEscale 1, SIpower 2, numeric estimator.
  "mb3d-msltoesym2": { dimension: 3, method: "numeric", parameters: [real("y_multiplier", "Y multiplier", 1, -100, 100), ...counted()], hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  "mb3d-msltoesym3": { dimension: 3, method: "numeric", parameters: [real("y_multiplier", "Y multiplier", 1, -100, 100), ...counted()], hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  // KaliDucks (Kali): RStop 2, DEscale 0.5.
  "mb3d-kaliducks": { dimension: 3, method: "numeric", parameters: [real("scale", "Scale", 1, -100, 100), real("min_r", "Min R", 0.5, -100, 100), ...counted(2)], hints: { deoption: 0, descale: 0.5, adescale: 1, rstop: 2, sipow: 2 } },
  // PG-bulb (Pseudogenius; generalised by Luca GN): DEoption 4, DEscale 1, SIpower 2.
  "mb3d-pgbulb": { dimension: 4, method: "numeric", parameters: [real("w_add", "w add", 0, -4, 4), real("int_power", "IntPower (2 to 16)", 8, 2, 16), flag("old_angles", "Old angles", 1), ...counted()], hints: { deoption: 4, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  // QuatPow (Luca GN): DEoption 4. exp(log(S) * (apx..apw) q* P) + C * cmul.
  "mb3d-quatpow": {
    dimension: 4, method: "numeric",
    parameters: [real("p", "p", 2, -100, 100), real("p_i", "p of i", 0, -100, 100), real("p_j", "p of j", 0, -100, 100), real("p_k", "p of k", 0, -100, 100),
      real("apx", "apx", 1, -100, 100), real("apy", "apy", 1, -100, 100), real("apz", "apz", 1, -100, 100), real("apw", "apw", 1, -100, 100), real("c_mul", "C mul", 1, -100, 100), ...counted()],
    hints: { deoption: 4, descale: 1, adescale: 1, rstop: 16, sipow: 2 },
  },
  // _Atan4D (Luca GN): DEoption 4, SIpower 4 (the same family as _Log4D and _Exp4D, which are counted).
  "mb3d-atan4d": { dimension: 4, method: "numeric", parameters: [real("px", "Px", 0, -100, 100), real("py", "Py", 0, -100, 100), real("pz", "Pz", 0, -100, 100), real("pw", "Pw", 0, -100, 100), real("a", "a", 1.4, -100, 100), ...counted()], hints: { deoption: 4, descale: 1, adescale: 1, rstop: 16, sipow: 4 } },
  // Menger4 (Luca GN): DEoption 6 (4D IFS: the distance is the xyz length times scale^-i), DEscale 0.2, ADEscale 0.5, RStop 1024.
  "mb3d-menger4": {
    dimension: 4, method: "ifs",
    parameters: [real("scale", "Scale", 3, -8, 8), real("cscale_x", "CScale X", 1, -8, 8), real("cscale_y", "CScale Y", 1, -8, 8), real("cscale_z", "CScale Z", 0.5, -8, 8), real("cscale_w", "CScale W", 0.5, -8, 8),
      ...ROTATION_NAMES.map((n) => real(`rotation_${n}`, `rotation ${n.toUpperCase()} (degrees)`, 0, -180, 180)), ...counted(1024)],
    hints: { deoption: 6, descale: 0.2, adescale: 0.5, rstop: 1024, sipow: 2 },
  },
  // The 4D deformations (Luca GN, DEoption -1). Option names Alpha, Beta, Gamma, ... map to a, b, c, ... in the order the file lists them.
  "mb3d-lorenz4d": helper4d([real("strength", "Strength", 1), real("alpha", "Alpha (a)", 0.5), real("beta", "Beta (b)", -2), real("gamma", "Gamma (c)", 1), real("r", "r", -1.5)]),
  "mb3d-rossler4d": helper4d([real("strength", "Strength", 1), real("alpha", "Alpha (a)", 0.5), real("beta", "Beta (b)", 1), real("gamma", "Gamma (c)", 1.5), real("delta", "Delta (d)", 1)]),
  "mb3d-vanderpol": helper4d([real("strength", "Strength", 1), real("alpha", "Alpha (a)", 2), real("beta", "Beta (b)", 0.6), real("gamma", "Gamma (c)", 0.1), real("delta", "Delta (d)", 0.4), real("phi", "Phi (f)", 2), real("r1", "r1", 1.4), real("r2", "r2", 1.4)]),
  "mb3d-vanderpol2": helper4d([real("strength", "Strength", 1), real("alpha", "Alpha (a)", 0.7), real("beta", "Beta (b)", 0.7), real("gamma", "Gamma (c)", 0.7), real("delta", "Delta (d)", 0.2), real("epsilon", "Epsilon (e)", 0.2), real("phi", "Phi (f)", 0.2), real("rho", "Rho (g)", 0.8), real("r", "r", 1.4)]),
  // A seamless fold has slope +1 or -1 everywhere (an isometry piece by piece), so unlike the bending transforms it keeps analytic and IFS distance estimates valid.
  "mb3d-foldinginfy": { ...helper4d([real("x_fold", "x Fold", 5, 0), real("y_fold", "y Fold", 5, 0), real("z_fold", "z Fold", 5, 0), real("w_fold", "w Fold", 5, 0)]), helperMethods: ["numeric", "analytic", "ifs"] },
  "mb3d-sqr4d": helper4d([real("scale", "Scale", 1), real("fix_x", "fixX", 0), real("fix_y", "fixY", 0), real("fix_z", "fixZ", 0), real("fix_w", "fixW", 0)]),
  "mb3d-sphereinvc4d": helper4d([]),
  "mb3d-scalec4d": helper4d([real("scale", "Scale", 1), real("scale_c", "Scale C", 1)]),
};

// ---- CPU ------------------------------------------------------------------------------------------------------------------
const LOG_TINY = 1e-200;
/** Hamilton's quaternion product exactly as the QuatPow description writes it (non-commutative). */
const qmul = (a: number[], b: number[]): number[] => [
  a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]! - a[3]! * b[3]!,
  a[0]! * b[1]! + a[1]! * b[0]! + a[2]! * b[3]! - a[3]! * b[2]!,
  a[0]! * b[2]! - a[1]! * b[3]! + a[2]! * b[0]! + a[3]! * b[1]!,
  a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]! + a[3]! * b[0]!,
];
/**
 * The quaternion logarithm of _Log4D (batch 05) with one deliberate difference, on the real axis only (MATH-AUDIT 08). _Log4D takes its
 * own branch there (imaginary part atan2(x,0) = +-pi/2), which jumps from the value every neighbouring point approaches (0 for x > 0) and
 * makes QuatPow(p=2) of a real s equal to -s^2 instead of s^2. Inside QuatPow the continuous principal value is used: imaginary part 0
 * for x > 0 and pi (along i) for x < 0. _Log4D itself stays as the file describes it.
 */
function quatLog(x: number, y: number, z: number, w: number): number[] {
  const t1 = Math.sqrt(w * w + y * y + z * z);
  if (t1 !== 0) {
    const t2 = Math.atan2(t1, x) / t1, t3 = x * x + t1 * t1;
    return [t3 > LOG_TINY ? 0.5 * Math.log(t3) : -460, y * t2, z * t2, w * t2];
  }
  return [Math.abs(x) > LOG_TINY ? Math.log(Math.abs(x)) : -460, x < 0 ? Math.PI : 0, z, w];
}
/** The quaternion exponential of _Exp4D (batch 05). */
function quatExp(x: number, y: number, z: number, w: number): number[] {
  const t1 = Math.sqrt(w * w + y * y + z * z), e = Math.exp(x);
  let t2 = e * Math.sin(t1);
  if (t1 > LOG_TINY) t2 /= t1;
  return [e * Math.cos(t1), y * t2, z * t2, w * t2];
}

export function stepBatch07Kernel(id: Batch07KernelId, p: KernelParameters, s: KernelState): void {
  let [x, y, z, w] = s.v;
  switch (id) {
    case "mb3d-msltoesym2":
    case "mb3d-msltoesym3": {
      const sym3 = id === "mb3d-msltoesym3";
      if (Math.abs(y) < Math.abs(z)) [y, z] = [z, y];
      if (y > z) { x = -x; if (sym3) z = -z; }
      const r2 = x * x + y * y + z * z, zr = r2 === 0 ? 1 : 1 - (z * z) / r2;
      const nx = (x * x - y * y) * zr + s.c[0], ny = 2 * x * y * zr * p.y_multiplier! + s.c[1];
      const nz = 2 * z * Math.sqrt(x * x + y * y) + (sym3 ? s.c[2] : 0);
      [x, y, z] = [nx, ny, nz];
      break;
    }
    case "mb3d-kaliducks": {
      x = Math.abs(x); y = Math.abs(y); z = Math.abs(z);
      const m0 = x * x + y * y + z * z;
      if (m0 === 0 && p.min_r! <= 0) { s.invalid = true; return; }
      // The file writes 1/Sqr(Min_R): the square of Min R, and no Scale in that branch. Followed exactly.
      const m = m0 < p.min_r! ? 1 / (p.min_r! * p.min_r!) : p.scale! / m0;
      [x, y, z] = [x * m + s.c[0], y * m + s.c[1], z * m + s.c[2]];
      break;
    }
    case "mb3d-pgbulb": {
      let a = x, b = y, c = z, d = w + p.w_add!;
      const xx = x, yy = y, zz = z, ww = d; // the multiplier is the same number as the start of the power (also when w add is not 0)
      let n = Math.round(p.int_power!) - 1;
      if (!(n >= 1 && n <= 15)) n = 7; // "if power is not in range I force i=7"
      const [ra, rb] = p.old_angles! !== 0 ? [s.c[0], s.c[1]] : [x, y];
      const den = ra * ra + rb * rb;
      const cs = den === 0 ? 1 : (ra * ra - rb * rb) / den, sn = den === 0 ? 0 : (2 * ra * rb) / den;
      for (let i = 0; i < n; i++) {
        const na = a * xx - b * yy - cs * (c * zz) + sn * (c * ww + zz * d) + cs * (d * ww);
        const nb = a * yy + b * xx - sn * (c * zz) - cs * (c * ww + zz * d) + sn * (d * ww);
        const nc = a * zz + xx * c - b * ww - yy * d;
        const nd = a * ww + xx * d + b * zz + yy * c;
        [a, b, c, d] = [na, nb, nc, nd];
      }
      [x, y, z, w] = [a + s.c[0], b + s.c[1], c + s.c[2], d + s.c[3]];
      break;
    }
    case "mb3d-quatpow": {
      const l = quatLog(x, y, z, w);
      const scaled = [l[0]! * p.apx!, l[1]! * p.apy!, l[2]! * p.apz!, l[3]! * p.apw!];
      const prod = qmul(scaled, [p.p!, p.p_i!, p.p_j!, p.p_k!]);
      const e = quatExp(prod[0]!, prod[1]!, prod[2]!, prod[3]!);
      [x, y, z, w] = [e[0]! + s.c[0] * p.c_mul!, e[1]! + s.c[1] * p.c_mul!, e[2]! + s.c[2] * p.c_mul!, e[3]! + s.c[3] * p.c_mul!];
      break;
    }
    case "mb3d-atan4d": {
      x += p.px!; y += p.py!; z += p.pz!; w += p.pw!;
      const t1 = Math.sqrt(w * w + y * y + z * z);
      if (t1 < 1e-5 || (x === 0 && Math.abs(t1 - 1) < 1e-5)) x = Math.atan(x);
      else {
        // "y" in the description's T2 and T3 lines is the length of the imaginary part, T1 (otherwise only y would enter a quaternion formula).
        const t2 = (Math.atan2(x, 1 - t1) - Math.atan2(-x, 1 + t1)) * 0.5;
        const t3 = (Math.log((((t1 + 1) ** 2) + x * x) / (((1 - t1) ** 2) + x * x)) * 0.25) / t1;
        [x, y, z, w] = [t2, t3 * y, t3 * z, t3 * w];
      }
      [x, y, z, w] = [x * p.a!, y * p.a!, z * p.a!, w * p.a!];
      break;
    }
    case "mb3d-menger4": {
      const sc = p.scale!;
      if (sc === 0) { s.invalid = true; return; }
      [x, y, z, w] = [Math.abs(x), Math.abs(y), Math.abs(z), Math.abs(w)];
      // The six compare-and-swap steps in exactly the order the description lists them (a partial sort, not a complete one).
      if (x - y < 0) [x, y] = [y, x];
      if (x - z < 0) [x, z] = [z, x];
      if (y - z < 0) [y, z] = [z, y];
      if (x - w < 0) [x, w] = [w, x];
      if (y - w < 0) [y, w] = [w, y];
      if (z - w < 0) [z, w] = [w, z];
      [x, y, z, w] = applyMatrix(rotation4(ROTATION_NAMES.map((n) => p[`rotation_${n}`]!)), [x, y, z, w]) as [number, number, number, number];
      x = sc * x - p.cscale_x! * (sc - 1);
      y = sc * y - p.cscale_y! * (sc - 1);
      w = sc * w - p.cscale_w! * (sc - 1);
      const lift = (0.5 * p.cscale_z! * (sc - 1)) / sc;
      z = -Math.abs(-(z - lift)) + lift;
      z = sc * z;
      s.derivative *= sc;
      break;
    }
    case "mb3d-lorenz4d": {
      const k = p.strength!;
      [x, y, z, w] = [(p.alpha! * (y - x) + w) * k, (p.gamma! * x - y - x * z) * k, (x * y - p.beta! * z) * k, (p.r! * w - y * z) * k];
      break;
    }
    case "mb3d-rossler4d": {
      const k = p.strength!;
      [x, y, z, w] = [(-y - z) * k, (x + p.alpha! * y + w) * k, (p.beta! + x * z) * k, (p.delta! * w - p.gamma! * z) * k];
      break;
    }
    case "mb3d-vanderpol": {
      const k = p.strength!, a = p.alpha!, b = p.beta!, c = p.gamma!, d = p.delta!, f = p.phi!;
      // The strength multiplies only the first two lines in the description; the last two are written without it.
      [x, y, z, w] = [(z + b * x) * k, (w + b * y) * k, c * y - d * x + (a - p.r1! * x * x) * z, c * x - d * y + (f - p.r2! * y * y) * w];
      break;
    }
    case "mb3d-vanderpol2": {
      const k = p.strength!, a = p.alpha!, b = p.beta!, c = p.gamma!, d = p.delta!, e = p.epsilon!, f = p.phi!, g = p.rho!, r = p.r!;
      // Only the first line carries the strength in the description.
      [x, y, z, w] = [(g * x + a * y + b * z + c * w) * k, d * z * w - a * x + (a - r * x * x) * y, e * y * w - b * x + (b - r * x * x) * z, f * z * y - c * x + (c - r * x * x) * w];
      break;
    }
    case "mb3d-foldinginfy": {
      const v = [x, y, z, w], sizes = [p.x_fold!, p.y_fold!, p.z_fold!, p.w_fold!];
      for (let i = 0; i < 4; i++) {
        // A fold size is a box size: its magnitude. A negative sign would turn the slope of the fold from +1 into -3 and break both the
        // distance bound and continuity at the tile edges (MATH-AUDIT 08), so only the magnitude is used.
        const n = Math.abs(sizes[i]!), m = n * 4;
        if (n === 0) continue;
        const t = v[i]! - roundHalfEven(v[i]! / m) * m; // box tiling, then the seamless fold
        v[i] = Math.abs(t + n) - Math.abs(t - n) - t;
      }
      [x, y, z, w] = v as [number, number, number, number];
      break;
    }
    case "mb3d-sqr4d":
      [x, y, z, w] = [x * x * p.scale! + p.fix_x!, y * y * p.scale! + p.fix_y!, z * z * p.scale! + p.fix_z!, w * w * p.scale! + p.fix_w!];
      break;
    case "mb3d-sphereinvc4d": {
      const rc = s.c[0] ** 2 + s.c[1] ** 2 + s.c[2] ** 2 + s.c[3] ** 2, rz = x * x + y * y + z * z + w * w;
      if (rc === 0 || rz === 0) { s.invalid = true; return; }
      s.c = [s.c[0] / rc, s.c[1] / rc, s.c[2] / rc, s.c[3] / rc];
      [x, y, z, w] = [x / rz, y / rz, z / rz, w / rz];
      break;
    }
    case "mb3d-scalec4d":
      [x, y, z, w] = [x * p.scale!, y * p.scale!, z * p.scale!, w * p.scale!];
      s.c = [s.c[0] * p.scale_c!, s.c[1] * p.scale_c!, s.c[2] * p.scale_c!, s.c[3] * p.scale_c!];
      break;
  }
  s.v = [x, y, z, w];
  if (![...s.v, ...s.c].every(Number.isFinite)) s.invalid = true;
}

// ---- WGSL ----------------------------------------------------------------------------------------------------------------
export function batch07Body(id: Batch07KernelId, p: (name: string) => string, _matrixNames: string[]): string {
  switch (id) {
    case "mb3d-msltoesym2":
    case "mb3d-msltoesym3": {
      const sym3 = id === "mb3d-msltoesym3";
      return `var x=s.v.x;var y=s.v.y;var z=s.v.z;
 if(abs(y)<abs(z)){let sw=y;y=z;z=sw;}
 if(y>z){x=-x;${sym3 ? "z=-z;" : ""}}
 let r2=x*x+y*y+z*z;var zr=1.0;if(r2!=0.0){zr=1.0-z*z/r2;}
 s.v=vec4f((x*x-y*y)*zr+s.c.x,2.0*x*y*zr*${p("y_multiplier")}+s.c.y,2.0*z*sqrt(x*x+y*y)${sym3 ? "+s.c.z" : ""},s.v.w);`;
    }
    case "mb3d-kaliducks":
      return `let a=abs(s.v.xyz);let m0=dot(a,a);let mr=${p("min_r")};
 if(m0==0.0&&mr<=0.0){s.invalid=true;}else{var m=${p("scale")}/m0;if(m0<mr){m=1.0/(mr*mr);}
 s.v=vec4f(a*m+s.c.xyz,s.v.w);}`;
    case "mb3d-pgbulb":
      return `let xx=s.v.x;let yy=s.v.y;let zz=s.v.z;let ww=s.v.w+${p("w_add")};
 var a=xx;var b=yy;var c=zz;var d=ww;
 var n=i32(round(${p("int_power")}))-1;if(n<1||n>15){n=7;}
 var ra=xx;var rb=yy;if(${p("old_angles")}!=0.0){ra=s.c.x;rb=s.c.y;}
 let den=ra*ra+rb*rb;var cs=1.0;var sn=0.0;if(den!=0.0){cs=(ra*ra-rb*rb)/den;sn=2.0*ra*rb/den;}
 for(var i=0;i<n;i++){
  let na=a*xx-b*yy-cs*(c*zz)+sn*(c*ww+zz*d)+cs*(d*ww);
  let nb=a*yy+b*xx-sn*(c*zz)-cs*(c*ww+zz*d)+sn*(d*ww);
  let nc=a*zz+xx*c-b*ww-yy*d;
  let nd=a*ww+xx*d+b*zz+yy*c;
  a=na;b=nb;c=nc;d=nd;
 }
 s.v=vec4f(a,b,c,d)+s.c;`;
    case "mb3d-quatpow":
      return `let t1=sqrt(s.v.w*s.v.w+s.v.y*s.v.y+s.v.z*s.v.z);var lg=vec4f(0.0);
 if(t1!=0.0){let t2=atan2(t1,s.v.x)/t1;let t3=s.v.x*s.v.x+t1*t1;var lx=-460.0;if(t3>1.0e-37){lx=0.5*log(t3);}lg=vec4f(lx,s.v.y*t2,s.v.z*t2,s.v.w*t2);}
 else{var lx=-460.0;if(abs(s.v.x)>1.0e-37){lx=log(abs(s.v.x));}var ly=0.0;if(s.v.x<0.0){ly=3.141592653589793;}lg=vec4f(lx,ly,s.v.z,s.v.w);}
 let sc=lg*vec4f(${p("apx")},${p("apy")},${p("apz")},${p("apw")});let q=vec4f(${p("p")},${p("p_i")},${p("p_j")},${p("p_k")});
 let pr=vec4f(sc.x*q.x-sc.y*q.y-sc.z*q.z-sc.w*q.w,sc.x*q.y+sc.y*q.x+sc.z*q.w-sc.w*q.z,sc.x*q.z-sc.y*q.w+sc.z*q.x+sc.w*q.y,sc.x*q.w+sc.y*q.z-sc.z*q.y+sc.w*q.x);
 let e1=sqrt(pr.w*pr.w+pr.y*pr.y+pr.z*pr.z);let ee=exp(pr.x);var e2=ee*sin(e1);if(e1>1.0e-37){e2=e2/e1;}
 s.v=vec4f(ee*cos(e1),pr.y*e2,pr.z*e2,pr.w*e2)+s.c*${p("c_mul")};`;
    case "mb3d-atan4d":
      return `var q=s.v+vec4f(${p("px")},${p("py")},${p("pz")},${p("pw")});let t1=sqrt(q.w*q.w+q.y*q.y+q.z*q.z);
 if(t1<1.0e-5||(q.x==0.0&&abs(t1-1.0)<1.0e-5)){q.x=atan(q.x);}
 else{let t2=(atan2(q.x,1.0-t1)-atan2(-q.x,1.0+t1))*0.5;let ua=(t1+1.0)*(t1+1.0)+q.x*q.x;let ub=(1.0-t1)*(1.0-t1)+q.x*q.x;let t3=log(ua/ub)*0.25/t1;q=vec4f(t2,t3*q.y,t3*q.z,t3*q.w);}
 s.v=q*${p("a")};`;
    case "mb3d-menger4":
      return `let sc=${p("scale")};
 if(sc==0.0){s.invalid=true;}else{
 var q=abs(s.v);
 if(q.x-q.y<0.0){let t=q.x;q.x=q.y;q.y=t;}
 if(q.x-q.z<0.0){let t=q.x;q.x=q.z;q.z=t;}
 if(q.y-q.z<0.0){let t=q.y;q.y=q.z;q.z=t;}
 if(q.x-q.w<0.0){let t=q.x;q.x=q.w;q.w=t;}
 if(q.y-q.w<0.0){let t=q.y;q.y=q.w;q.w=t;}
 if(q.z-q.w<0.0){let t=q.z;q.z=q.w;q.w=t;}
 var rm=mat4x4f(vec4f(1,0,0,0),vec4f(0,1,0,0),vec4f(0,0,1,0),vec4f(0,0,0,1));
 rm=kernelPlane(${p("rotation_yz")},1,2)*rm;rm=kernelPlane(${p("rotation_xz")},0,2)*rm;rm=kernelPlane(${p("rotation_xy")},0,1)*rm;
 rm=kernelPlane(${p("rotation_xw")},0,3)*rm;rm=kernelPlane(${p("rotation_yw")},1,3)*rm;rm=kernelPlane(${p("rotation_zw")},2,3)*rm;
 q=rm*q;
 let km=sc-1.0;let lift=0.5*${p("cscale_z")}*km/sc;
 let nx=sc*q.x-${p("cscale_x")}*km;let ny=sc*q.y-${p("cscale_y")}*km;let nw=sc*q.w-${p("cscale_w")}*km;
 let nz=sc*(-abs(-(q.z-lift))+lift);
 s.v=vec4f(nx,ny,nz,nw);s.derivative*=sc;}`;
    case "mb3d-lorenz4d":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let w=s.v.w;let k=${p("strength")};
 s.v=vec4f((${p("alpha")}*(y-x)+w)*k,(${p("gamma")}*x-y-x*z)*k,(x*y-${p("beta")}*z)*k,(${p("r")}*w-y*z)*k);`;
    case "mb3d-rossler4d":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let w=s.v.w;let k=${p("strength")};
 s.v=vec4f((-y-z)*k,(x+${p("alpha")}*y+w)*k,(${p("beta")}+x*z)*k,(${p("delta")}*w-${p("gamma")}*z)*k);`;
    case "mb3d-vanderpol":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let w=s.v.w;let k=${p("strength")};let b=${p("beta")};
 s.v=vec4f((z+b*x)*k,(w+b*y)*k,${p("gamma")}*y-${p("delta")}*x+(${p("alpha")}-${p("r1")}*x*x)*z,${p("gamma")}*x-${p("delta")}*y+(${p("phi")}-${p("r2")}*y*y)*w);`;
    case "mb3d-vanderpol2":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let w=s.v.w;let k=${p("strength")};let a=${p("alpha")};let b=${p("beta")};let c=${p("gamma")};let r=${p("r")};
 s.v=vec4f((${p("rho")}*x+a*y+b*z+c*w)*k,${p("delta")}*z*w-a*x+(a-r*x*x)*y,${p("epsilon")}*y*w-b*x+(b-r*x*x)*z,${p("phi")}*z*y-c*x+(c-r*x*x)*w);`;
    case "mb3d-foldinginfy":
      return `var q=s.v;let sz=vec4f(${p("x_fold")},${p("y_fold")},${p("z_fold")},${p("w_fold")});
 for(var i=0;i<4;i++){let n=abs(sz[i]);if(n!=0.0){let m=n*4.0;let t=q[i]-round(q[i]/m)*m;q[i]=abs(t+n)-abs(t-n)-t;}}
 s.v=q;`;
    case "mb3d-sqr4d":
      return `s.v=s.v*s.v*${p("scale")}+vec4f(${p("fix_x")},${p("fix_y")},${p("fix_z")},${p("fix_w")});`;
    case "mb3d-sphereinvc4d":
      return `let rc=dot(s.c,s.c);let rz=dot(s.v,s.v);
 if(rc==0.0||rz==0.0){s.invalid=true;}else{s.c=s.c/rc;s.v=s.v/rz;}`;
    case "mb3d-scalec4d":
      return `s.v=s.v*${p("scale")};s.c=s.c*${p("scale_c")};`;
  }
}
