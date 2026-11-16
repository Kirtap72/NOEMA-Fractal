/**
 * Formula Library 06: thirteen formulas whose mathematics is written out in their own formula-file descriptions (the clear text after
 * [END]; the compiled [CODE] sections and any machine-code listing that follows a description were never read or used).
 * See NewFormulas/formula-06/BATCH-06.md for every equation, how ambiguous spots were read, and the candidates that were skipped.
 *
 *   uncounted 3D transforms:    _BT2_Transform2 (also imported as _BenesiT2), _BT4_Transform4, _SphereInvC, _JuliaSets, _PartlyJuliaRoff
 *   uncounted 4D transforms:    _BT1_4D_Transform1, _BT1_4D_clampXYZ
 *   counted 3D (numeric):       BenesiPine1, BristorBrot, Makin3D-1
 *   counted 3D (analytic w):    ABoxMod2
 *   counted 4D (numeric):       Lambda4Dnc, Barnsley4Dc
 *
 * One place for metadata, the CPU step and the WGSL body so the two are read side by side. Authors are credited exactly as the files state them.
 * WGSL bodies are self-contained and never declare a local called `u` (the uniform block the parameters are read from).
 */
import type { KernelInfo, KernelParameters, KernelState } from "./kernels";
import type { Parameter } from "./types";

export const BATCH06_KERNEL_IDS = [
  "mb3d-bt1-4d-transform1", "mb3d-bt1-4d-clampxyz", "mb3d-bt2-transform2", "mb3d-bt4-transform4", "mb3d-benesipine1", "mb3d-bristorbrot", "mb3d-makin3d-1",
  "mb3d-aboxmod2", "mb3d-lambda4dnc", "mb3d-barnsley4dc", "mb3d-sphereinvc", "mb3d-juliasets", "mb3d-partlyjuliaroff",
] as const;
export type Batch06KernelId = (typeof BATCH06_KERNEL_IDS)[number];

const real = (name: string, label: string, def: number, min = -1000, max = 1000): Parameter => ({ name, label, default: def, min, max });
const flag = (name: string, label: string, def: number): Parameter => ({ name, label, default: def, min: 0, max: 1 });
const HELPER_HINTS = { deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0 };
const counted = (): Parameter[] => [real("slice_w", "4D slice / extra w", 0, -4, 4), real("constant_w", "Julia constant w", 0, -4, 4), real("bailout_squared", "Escape limit (radius²)", 16, 1, 65536)];
const benesiParams = (): Parameter[] => [real("scale", "Scale", 2, -100, 100), real("x_off", "x-offset", 2, -100, 100)];

export const BATCH06_DEFINITIONS: Record<Batch06KernelId, KernelInfo> = {
  // _BT1_4D_Transform1 / _BT1_4D_clampXYZ (M. Benesi): DEoption -1, 4D helpers.
  "mb3d-bt1-4d-transform1": { dimension: 4, method: "numeric", role: "helper", wMode: "coordinate", helperMethods: ["numeric"], parameters: benesiParams(), hints: HELPER_HINTS },
  "mb3d-bt1-4d-clampxyz": { dimension: 4, method: "numeric", role: "helper", wMode: "coordinate", helperMethods: ["numeric"], parameters: benesiParams(), hints: HELPER_HINTS },
  // _BT2_Transform2 / _BT4_Transform4 (M. Benesi): the "hollowing" transforms. Option Scale = scale2, xOff = offset2 (the only two options, defaults 2 and 2).
  "mb3d-bt2-transform2": { dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"], parameters: benesiParams(), hints: HELPER_HINTS },
  "mb3d-bt4-transform4": { dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"], parameters: benesiParams(), hints: HELPER_HINTS },
  // BenesiPine1: DEscale 1, SIpower 2, no DEoption (numeric estimator).
  "mb3d-benesipine1": { dimension: 3, method: "numeric", parameters: [...benesiParams(), ...counted()], hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  // BristorBrot (Doug Bristor): DEscale 1, SIpower 2.
  "mb3d-bristorbrot": { dimension: 3, method: "numeric", parameters: [real("x_mul", "X mul", 2, -100, 100), real("y_mul", "Y mul", 1, -100, 100), real("z_mul", "Z mul", -1, -100, 100), ...counted()], hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  // Makin3D-1 (David Makin, WIP3D5): DEscale 1, SIpower 2.
  "mb3d-makin3d-1": { dimension: 3, method: "numeric", parameters: counted(), hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  // ABoxMod2: DEoption 2 (analytic w), DEscale 0.2, RStop 1024. The inversion is not conformal, as the file says; w still follows the multiplier m like the other ABox kernels.
  "mb3d-aboxmod2": {
    dimension: 3, method: "analytic", wMode: "derivative",
    parameters: [real("scale", "Scale", 2, -8, 8), real("min_r", "Min R", 0.5, -8, 8), real("fold_xy", "Fold XY", 1, -8, 8), real("fold_z", "Fold Z", 1.5, -8, 8), real("cyl_half_size", "Cyl HalfSize", 0.5, -8, 8),
      real("constant_w", "Julia constant w", 0, -4, 4), real("bailout_squared", "Escape limit (radius²)", 1024, 1, 65536)],
    hints: { deoption: 2, descale: 0.2, adescale: 1, rstop: 1024, sipow: 2 },
  },
  // Lambda4Dnc / Barnsley4Dc (Luca GN): DEoption 4 (numeric 4D), DEscale 1.
  "mb3d-lambda4dnc": { dimension: 4, method: "numeric", parameters: [real("dx", "dx", 1), real("dy", "dy", 0), real("dz", "dz", 0), real("dw", "dw", 0), ...counted()], hints: { deoption: 4, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  "mb3d-barnsley4dc": {
    dimension: 4, method: "numeric",
    parameters: [real("dx", "dx", 1), real("dy", "dy", 0), real("dz", "dz", 0), real("dw", "dw", 0), real("w_add", "w add", 0), real("threshold", "Threshold", 0), flag("conj_mode", "Conj mode", 0), flag("flip_mode", "Flip mode", 0), flag("tent_mode", "Tent mode", 0), ...counted()],
    hints: { deoption: 4, descale: 1, adescale: 1, rstop: 16, sipow: 2 },
  },
  // _SphereInvC / _JuliaSets / _PartlyJuliaRoff: transforms of the constant C (and z) that read the pixel position.
  "mb3d-sphereinvc": { dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"], parameters: [], hints: HELPER_HINTS },
  "mb3d-juliasets": { dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"], parameters: [real("separation", "Separation", 4, -1000, 1000), real("julia_factor", "Julia factor", 0.2, -1000, 1000)], hints: HELPER_HINTS },
  "mb3d-partlyjuliaroff": { dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"], parameters: [real("x_sphere", "X sphere", 0), real("y_sphere", "Y sphere", 0), real("z_sphere", "Z sphere", 0), real("radius_sphere", "Radius sphere", 0)], hints: HELPER_HINTS },
};

// ---- CPU ------------------------------------------------------------------------------------------------------------------
const S23 = Math.sqrt(2 / 3), S13 = Math.sqrt(1 / 3), S12 = Math.sqrt(1 / 2), S34 = Math.sqrt(3 / 4);
/** Delphi's Round and WGSL's round() both round halves to the even neighbour. */
export const roundHalfEven = (v: number): number => (Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : Math.round(v));
/** "Benesi fold 1" (the T1 loop's first part), statements in the order the description writes them. */
function benesiFold1(x: number, y: number, z: number): [number, number, number] {
  let tx = (x * S23 - z * S13) * S12;
  z = Math.abs(x * S13 + z * S23);
  x = Math.abs(tx - y * S12);
  y = Math.abs(tx + y * S12);
  tx = x * S12 + y * S12;
  y = -x * S12 + y * S12;
  x = tx * S23 + z * S13;
  z = -tx * S13 + z * S23;
  return [x, y, z];
}
/** "Benesi fold 2": the same statements for the plain and the square-root-free version (the description writes them one after the other, tx and x updated in place). */
export function benesiFold2(x: number, y: number, z: number, scale2: number, offset2: number, roots: boolean): [number, number, number] {
  let tx = (x * S23 - z * S13) * S12;
  y = y * S12;
  z = (x * S13 + z * S23) ** 2;
  tx = (tx - y) ** 2;
  const ty = (tx + y) ** 2; // uses the tx just computed, as written
  const f = (a: number) => (roots ? Math.sqrt(a) : a);
  x = Math.abs(f(ty + z) - offset2) * scale2 * S12;
  y = Math.abs(f(tx + z) - offset2) * scale2 * S12;
  z = Math.abs(f(tx + ty) - offset2) * scale2;
  tx = y + x;
  y = y - x;
  x = z * S13 + x * S23;
  z = z * S23 - x * S13; // uses the x just computed, as written ("code is correct, checked")
  return [x, y, z];
}
const qmulNonCommutative = (a: number[], b: number[]): number[] => [
  a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]! - a[3]! * b[3]!,
  a[0]! * b[1]! + a[1]! * b[0]! + a[2]! * b[3]! - a[3]! * b[2]!,
  a[0]! * b[2]! - a[1]! * b[3]! + a[2]! * b[0]! + a[3]! * b[1]!,
  a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]! + a[3]! * b[0]!,
];
const qmulCommutative = (a: number[], b: number[]): number[] => [
  a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]! + a[3]! * b[3]!,
  a[1]! * b[0]! + a[0]! * b[1]! - a[3]! * b[2]! - a[2]! * b[3]!,
  a[2]! * b[0]! - a[3]! * b[1]! + a[0]! * b[2]! - a[1]! * b[3]!,
  a[3]! * b[0]! + a[2]! * b[1]! + a[1]! * b[2]! + a[0]! * b[3]!,
];

export function stepBatch06Kernel(id: Batch06KernelId, p: KernelParameters, s: KernelState): void {
  let [x, y, z, w] = s.v;
  switch (id) {
    case "mb3d-bt1-4d-transform1":
    case "mb3d-bt1-4d-clampxyz": {
      const clamp = id === "mb3d-bt1-4d-clampxyz", rxyz0 = Math.sqrt(x * x + y * y + z * z), w0 = w;
      // Rotation in the x-w plane by 30 degrees (cos = sqrt(3/4), sin = 1/2) using the old x and w, then abs on the new w.
      w = Math.abs(x * 0.5 + w0 * S34);
      x = x * S34 - w0 * 0.5;
      let tx = (x * S23 - z * S13) * S12;
      z = Math.abs(x * S13 + z * S23);
      x = Math.abs(tx - y * S12);
      y = Math.abs(tx + y * S12);
      tx = x * S12 + y * S12;
      y = -x * S12 + y * S12;
      x = tx * S23 + z * S13;
      z = -tx * S13 + z * S23;
      tx = x * S34 + w * 0.5;
      w = -x * 0.5 + w * S34;
      if (clamp) {
        const len = Math.sqrt(x * x + y * y + z * z);
        if (len === 0) { s.invalid = true; return; }
        const k = rxyz0 / len;
        x *= k; y *= k; z *= k; // x is overwritten just below, exactly as the description writes it
      }
      x = p.scale! * tx - p.x_off!;
      y *= p.scale!; z *= p.scale!; w *= p.scale!;
      break;
    }
    case "mb3d-bt2-transform2":
    case "mb3d-bt4-transform4":
      [x, y, z] = benesiFold2(x, y, z, p.scale!, p.x_off!, id === "mb3d-bt2-transform2");
      break;
    case "mb3d-benesipine1": {
      [x, y, z] = benesiFold1(x, y, z);
      x = p.scale! * x - p.x_off!; y *= p.scale!; z *= p.scale!;
      // "Benesi pinetree". The description writes z before y, so y uses the new z (including Cy); C goes to x, z, y in that order.
      const xt = x * x, yt = y * y, zt = z * z, t = (2 * x) / Math.sqrt(Math.max(yt + zt, 1e-40));
      x = xt - yt - zt + s.c[0];
      z = t * (yt - zt) + s.c[1];
      y = 2 * t * y * z + s.c[2];
      break;
    }
    case "mb3d-bristorbrot":
      [x, y, z] = [x * x - y * y - z * z + s.c[0], y * (p.x_mul! * x + p.z_mul! * z) + s.c[1], z * (p.x_mul! * x + p.y_mul! * y) + s.c[2]];
      break;
    case "mb3d-makin3d-1":
      [x, y, z] = [x * x - y * y - z * z + s.c[0], 2 * x * y + s.c[1], 2 * z * (x - y) + s.c[2]];
      break;
    case "mb3d-aboxmod2": {
      const fold = (t: number, f: number) => Math.abs(t + f) - Math.abs(t - f) - t;
      x = fold(x, p.fold_xy!); y = fold(y, p.fold_xy!); z = fold(z, p.fold_z!);
      const zc = Math.abs(z) - p.cyl_half_size!, low = Math.max(1e-40, p.min_r!) ** 2;
      const rr = zc > 0 ? x * x + y * y + zc * zc : x * x + y * y;
      if (rr === 0 && low === 0) { s.invalid = true; return; }
      const m = rr < low ? p.scale! / low : rr < 1 ? p.scale! / rr : p.scale!;
      [x, y, z] = [x * m + s.c[0], y * m + s.c[1], z * m + s.c[2]];
      w *= m;
      break;
    }
    case "mb3d-lambda4dnc": {
      const ss = [x * x - y * y - z * z - w * w, 2 * x * y, 2 * x * z, 2 * w * x];
      const k = [p.dx!, p.dy!, p.dz!, p.dw!], a = [k[0]! - ss[0]!, k[1]! - ss[1]!, k[2]! - ss[2]!, k[3]! - ss[3]!];
      [x, y, z, w] = qmulNonCommutative(a, [s.c[0], s.c[1], s.c[2], s.c[3]]) as [number, number, number, number];
      break;
    }
    case "mb3d-barnsley4dc": {
      let cx = s.c[0], cy = s.c[1];
      if (p.conj_mode! !== 0) cy = -cy;
      if (p.flip_mode! !== 0) [cx, cy] = [cy, cx];
      const c = [cx, cy, s.c[2], s.c[3]], sv = [x, y, z, w + p.w_add!], k = [p.dx!, p.dy!, p.dz!, p.dw!];
      let r: number[];
      if (p.tent_mode! !== 0) {
        r = sv[0]! > Math.hypot(...k) / 2 ? qmulCommutative(k.map((v, i) => v - sv[i]!), c) : qmulCommutative(sv, c);
        r = r.map((v) => 2 * v);
      } else r = sv[0]! > p.threshold! ? qmulCommutative(sv.map((v, i) => v + k[i]!), c) : qmulCommutative(sv.map((v, i) => v - k[i]!), c);
      [x, y, z, w] = r as [number, number, number, number];
      break;
    }
    case "mb3d-sphereinvc": {
      const rc = s.c[0] ** 2 + s.c[1] ** 2 + s.c[2] ** 2, rz = x * x + y * y + z * z;
      if (rc === 0 || rz === 0) { s.invalid = true; return; }
      s.c = [s.c[0] / rc, s.c[1] / rc, s.c[2] / rc, s.c[3]];
      [x, y, z] = [x / rz, y / rz, z / rz];
      break;
    }
    case "mb3d-juliasets": {
      if (p.separation! === 0) { s.invalid = true; return; }
      const rs = 1 / p.separation!, o = s.originalPoint;
      const cx = roundHalfEven(o[0]! * rs), cy = roundHalfEven(o[1]! * rs), cz = roundHalfEven(o[2]! * rs);
      [x, y, z] = [(o[0]! * rs - cx) * p.separation!, (o[1]! * rs - cy) * p.separation!, (o[2]! * rs - cz) * p.separation!];
      s.c = [cx * p.julia_factor!, cy * p.julia_factor!, cz * p.julia_factor!, s.c[3]];
      break;
    }
    case "mb3d-partlyjuliaroff": {
      const o = s.originalPoint, xt = o[0]! - p.x_sphere!, yt = o[1]! - p.y_sphere!, zt = o[2]! - p.z_sphere!, r = Math.sqrt(xt * xt + yt * yt + zt * zt);
      if (r > p.radius_sphere!) {
        const m = (r - p.radius_sphere!) / Math.max(r, 1e-10);
        s.c = [s.c[0] + xt * m, s.c[1] + yt * m, s.c[2] + zt * m, s.c[3]];
      }
      break;
    }
  }
  s.v = [x, y, z, w];
  if (![...s.v, ...s.c].every(Number.isFinite)) s.invalid = true;
}

// ---- WGSL ----------------------------------------------------------------------------------------------------------------
export const S = {
  s23: "0.816496580927726", s13: "0.5773502691896258", s12: "0.7071067811865476", s34: "0.8660254037844386",
};
const FOLD1 = `var tx=(x*${S.s23}-z*${S.s13})*${S.s12};z=abs(x*${S.s13}+z*${S.s23});x=abs(tx-y*${S.s12});y=abs(tx+y*${S.s12});
 tx=x*${S.s12}+y*${S.s12};y=-x*${S.s12}+y*${S.s12};x=tx*${S.s23}+z*${S.s13};z=-tx*${S.s13}+z*${S.s23};`;
export const fold2 = (p: (name: string) => string, roots: boolean) => {
  const f = (a: string) => (roots ? `sqrt(${a})` : `(${a})`);
  return `var tx=(x*${S.s23}-z*${S.s13})*${S.s12};y=y*${S.s12};let q1=x*${S.s13}+z*${S.s23};z=q1*q1;let q2=tx-y;tx=q2*q2;let q3=tx+y;let ty=q3*q3;
 let sc=${p("scale")};let off=${p("x_off")};
 x=abs(${f("ty+z")}-off)*sc*${S.s12};y=abs(${f("tx+z")}-off)*sc*${S.s12};z=abs(${f("tx+ty")}-off)*sc;
 tx=y+x;y=y-x;x=z*${S.s13}+x*${S.s23};z=z*${S.s23}-x*${S.s13};`;
};

export function batch06Body(id: Batch06KernelId, p: (name: string) => string, _matrixNames: string[]): string {
  switch (id) {
    case "mb3d-bt1-4d-transform1":
    case "mb3d-bt1-4d-clampxyz": {
      const clamp = id === "mb3d-bt1-4d-clampxyz";
      return `var x=s.v.x;var y=s.v.y;var z=s.v.z;var w=s.v.w;let rxyz0=sqrt(x*x+y*y+z*z);let w0=w;
 w=abs(x*0.5+w0*${S.s34});x=x*${S.s34}-w0*0.5;
 ${FOLD1}
 tx=x*${S.s34}+w*0.5;w=-x*0.5+w*${S.s34};
 ${clamp ? `let len=sqrt(x*x+y*y+z*z);if(len==0.0){s.invalid=true;}else{let kk=rxyz0/len;y=y*kk;z=z*kk;}` : ""}
 let sc=${p("scale")};x=sc*tx-${p("x_off")};y=y*sc;z=z*sc;w=w*sc;s.v=vec4f(x,y,z,w);`;
    }
    case "mb3d-bt2-transform2":
    case "mb3d-bt4-transform4":
      return `var x=s.v.x;var y=s.v.y;var z=s.v.z;
 ${fold2(p, id === "mb3d-bt2-transform2")}
 s.v=vec4f(x,y,z,s.v.w);`;
    case "mb3d-benesipine1":
      return `var x=s.v.x;var y=s.v.y;var z=s.v.z;
 ${FOLD1}
 let sc=${p("scale")};x=sc*x-${p("x_off")};y=y*sc;z=z*sc;
 let xt=x*x;let yt=y*y;let zt=z*z;let t=2.0*x/sqrt(max(yt+zt,1.0e-30));
 x=xt-yt-zt+s.c.x;z=t*(yt-zt)+s.c.y;y=2.0*t*y*z+s.c.z;s.v=vec4f(x,y,z,s.v.w);`;
    case "mb3d-bristorbrot":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;
 s.v=vec4f(x*x-y*y-z*z+s.c.x,y*(${p("x_mul")}*x+${p("z_mul")}*z)+s.c.y,z*(${p("x_mul")}*x+${p("y_mul")}*y)+s.c.z,s.v.w);`;
    case "mb3d-makin3d-1":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;s.v=vec4f(x*x-y*y-z*z+s.c.x,2.0*x*y+s.c.y,2.0*z*(x-y)+s.c.z,s.v.w);`;
    case "mb3d-aboxmod2":
      return `var x=s.v.x;var y=s.v.y;var z=s.v.z;let fxy=${p("fold_xy")};let fz=${p("fold_z")};
 x=abs(x+fxy)-abs(x-fxy)-x;y=abs(y+fxy)-abs(y-fxy)-y;z=abs(z+fz)-abs(z-fz)-z;
 let zc=abs(z)-${p("cyl_half_size")};let low=pow(max(1.0e-40,${p("min_r")}),2.0);
 var rr=x*x+y*y;if(zc>0.0){rr=rr+zc*zc;}
 if(!kernelFinite(rr)||(rr==0.0&&low==0.0)){s.invalid=true;}else{
 var m=${p("scale")};if(rr<low){m=${p("scale")}/low;}else if(rr<1.0){m=${p("scale")}/rr;}
 s.v=vec4f(x*m+s.c.x,y*m+s.c.y,z*m+s.c.z,s.v.w*m);}`;
    case "mb3d-lambda4dnc":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let w=s.v.w;
 let a=vec4f(${p("dx")}-(x*x-y*y-z*z-w*w),${p("dy")}-2.0*x*y,${p("dz")}-2.0*x*z,${p("dw")}-2.0*w*x);let b=s.c;
 s.v=vec4f(a.x*b.x-a.y*b.y-a.z*b.z-a.w*b.w,a.x*b.y+a.y*b.x+a.z*b.w-a.w*b.z,a.x*b.z-a.y*b.w+a.z*b.x+a.w*b.y,a.x*b.w+a.y*b.z-a.z*b.y+a.w*b.x);`;
    case "mb3d-barnsley4dc":
      return `var cx=s.c.x;var cy=s.c.y;if(${p("conj_mode")}!=0.0){cy=-cy;}if(${p("flip_mode")}!=0.0){let swap=cx;cx=cy;cy=swap;}
 let b=vec4f(cx,cy,s.c.z,s.c.w);let sv=vec4f(s.v.x,s.v.y,s.v.z,s.v.w+${p("w_add")});let kv=vec4f(${p("dx")},${p("dy")},${p("dz")},${p("dw")});
 var a=sv-kv;var tentScale=1.0;
 if(${p("tent_mode")}!=0.0){tentScale=2.0;if(sv.x>length(kv)*0.5){a=kv-sv;}else{a=sv;}}
 else if(sv.x>${p("threshold")}){a=sv+kv;}
 s.v=tentScale*vec4f(a.x*b.x-a.y*b.y-a.z*b.z+a.w*b.w,a.y*b.x+a.x*b.y-a.w*b.z-a.z*b.w,a.z*b.x-a.w*b.y+a.x*b.z-a.y*b.w,a.w*b.x+a.z*b.y+a.y*b.z+a.x*b.w);`;
    case "mb3d-sphereinvc":
      return `let rc=s.c.x*s.c.x+s.c.y*s.c.y+s.c.z*s.c.z;let rz=dot(s.v.xyz,s.v.xyz);
 if(rc==0.0||rz==0.0){s.invalid=true;}else{s.c=vec4f(s.c.xyz/rc,s.c.w);s.v=vec4f(s.v.xyz/rz,s.v.w);}`;
    case "mb3d-juliasets":
      return `let sep=${p("separation")};
 if(sep==0.0){s.invalid=true;}else{let rs=1.0/sep;let o=s.original;let cj=round(o*rs);
 s.v=vec4f((o*rs-cj)*sep,s.v.w);s.c=vec4f(cj*${p("julia_factor")},s.c.w);}`;
    case "mb3d-partlyjuliaroff":
      return `let ot=s.original-vec3f(${p("x_sphere")},${p("y_sphere")},${p("z_sphere")});let rt0=length(ot);
 if(rt0>${p("radius_sphere")}){let mm=(rt0-${p("radius_sphere")})/max(rt0,1.0e-10);s.c=vec4f(s.c.xyz+ot*mm,s.c.w);}`;
  }
}
