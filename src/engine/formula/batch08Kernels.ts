/**
 * Formula Library 08: fifteen formulas whose mathematics is written out in their own formula-file descriptions (the clear text after
 * [END]; the compiled [CODE] sections and any machine-code listing that follows a description were never read or used).
 * See NewFormulas/formula-08/BATCH-08.md for every equation, how ambiguous spots were read, and the candidates that were skipped.
 *
 *   counted 3D (numeric):   MsltoeSym4, Benesi3Pow2, BenesiPine2
 *   counted 3D (analytic):  ABoxMod1
 *   counted 4D (numeric):   Makin4D p2b, p4a, p4b, p8a, p8b (one family: a pass of two complex numbers, repeated, then C)
 *   counted 4D (analytic):  ABoxMod4d, ABoxSphereOffset4d
 *   uncounted helpers:      _BT3_Transform3 (also imported as _BenesiT3), _BRotateToMag, _QuadrayTransform, _QuadrayTransform2
 *
 * One place for metadata, the CPU step and the WGSL body so the two are read side by side. Authors are credited exactly as the files state them.
 * WGSL bodies are self-contained and never declare a local called `u` (the uniform block the parameters are read from).
 */
import type { KernelInfo, KernelParameters, KernelState } from "./kernels";
import type { Parameter } from "./types";
import { S, benesiFold2, fold2 } from "./batch06Kernels";

export const BATCH08_KERNEL_IDS = [
  "mb3d-msltoesym4", "mb3d-benesi3pow2", "mb3d-benesipine2",
  "mb3d-makin4d-p2b", "mb3d-makin4d-p4a", "mb3d-makin4d-p4b", "mb3d-makin4d-p8a", "mb3d-makin4d-p8b",
  "mb3d-aboxmod1", "mb3d-aboxmod4d", "mb3d-aboxsphereoffset4d",
  "mb3d-bt3-transform3", "mb3d-brotatetomag", "mb3d-quadraytransform", "mb3d-quadraytransform2",
] as const;
export type Batch08KernelId = (typeof BATCH08_KERNEL_IDS)[number];

const real = (name: string, label: string, def: number, min = -1000, max = 1000): Parameter => ({ name, label, default: def, min, max });
const HELPER_HINTS = { deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0 };
const counted = (bailout = 16): Parameter[] => [real("slice_w", "4D slice / extra w", 0, -4, 4), real("constant_w", "Julia constant w", 0, -4, 4), real("bailout_squared", "Escape limit (radius²)", bailout, 1, 65536)];
const analytic3 = (): Parameter[] => [real("constant_w", "Julia constant w", 0, -4, 4), real("bailout_squared", "Escape limit (radius²)", 1024, 1, 65536)];
const MAKIN_REPEATS: Record<string, { variant: "a" | "b"; repeats: number }> = {
  "mb3d-makin4d-p4a": { variant: "a", repeats: 2 }, "mb3d-makin4d-p8a": { variant: "a", repeats: 3 },
  "mb3d-makin4d-p2b": { variant: "b", repeats: 1 }, "mb3d-makin4d-p4b": { variant: "b", repeats: 2 }, "mb3d-makin4d-p8b": { variant: "b", repeats: 3 },
};
const makinInfo = (): KernelInfo => ({ dimension: 4, method: "numeric", parameters: [real("w_add", "w add", 0, -4, 4), ...counted()], hints: { deoption: 4, descale: 1, adescale: 1, rstop: 16, sipow: 2 } });

export const BATCH08_DEFINITIONS: Record<Batch08KernelId, KernelInfo> = {
  // MsltoeSym4 (Msltoe): DEscale 1, SIpower 2. Sym-mul: <= 0 off, 1 conditional, 1e30 unconditional.
  "mb3d-msltoesym4": { dimension: 3, method: "numeric", parameters: [real("xz_sym_mul", "XZ sym-mul", 1, -1, 1e30), real("xy_sym_mul", "XY sym-mul", 1, -1, 1e30), real("yz_sym_mul", "YZ sym-mul", 1, -1, 1e30), ...counted()], hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  // Benesi3Pow2 (Benesi): DEscale 1, SIpower 2.
  "mb3d-benesi3pow2": { dimension: 3, method: "numeric", parameters: counted(), hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  // BenesiPine2: "Benesi fold 2" then the pinetree; Scale 2, xOff 2.
  "mb3d-benesipine2": { dimension: 3, method: "numeric", parameters: [real("scale", "Scale", 2, -100, 100), real("x_off", "x-offset", 2, -100, 100), ...counted()], hints: { deoption: 0, descale: 1, adescale: 1, rstop: 16, sipow: 2 } },
  "mb3d-makin4d-p2b": makinInfo(), "mb3d-makin4d-p4a": makinInfo(), "mb3d-makin4d-p4b": makinInfo(), "mb3d-makin4d-p8a": makinInfo(), "mb3d-makin4d-p8b": makinInfo(),
  // ABoxMod1 (analytic w, DE-val 2, DEscale 0.2, RStop 1024). Its description writes x with Cy and y with Cx; followed exactly.
  "mb3d-aboxmod1": {
    dimension: 3, method: "analytic", wMode: "derivative",
    parameters: [real("scale", "Scale", 2, -8, 8), real("min_r", "Min R", 0, -8, 8), real("fold", "Fold", 2, -8, 8), real("scale_vary", "Scale vary", 0, -8, 8), real("fold_x_mod", "FoldXMod", 0, -8, 8), real("fold_y_mod", "FoldYMod", 0, -8, 8), real("fold_z_mod", "FoldZMod", 0, -8, 8), ...analytic3()],
    hints: { deoption: 2, descale: 0.2, adescale: 1, rstop: 1024, sipow: 2 },
  },
  // ABoxMod4d (4D analytic: derivative field, w a coordinate), DE-val 5.
  "mb3d-aboxmod4d": {
    dimension: 4, method: "analytic", wMode: "coordinate",
    parameters: [real("scale", "Scale", 2, -8, 8), real("fold", "Fold", 1, -8, 8), real("w_add", "W add", 0, -4, 4), ...counted(1024)],
    hints: { deoption: 5, descale: 0.2, adescale: 1, rstop: 1024, sipow: 2 },
  },
  "mb3d-aboxsphereoffset4d": {
    dimension: 4, method: "analytic", wMode: "coordinate",
    parameters: [real("scale", "Scale", 2, -8, 8), real("min_r", "Min R", 0.5, -8, 8), real("fold", "Fold", 1, -8, 8), real("offset_x", "Sphere offset X", 0, -8, 8), real("offset_y", "Sphere offset Y", 0, -8, 8), real("offset_z", "Sphere offset Z", 0, -8, 8), real("offset_w", "Sphere offset W", 0, -8, 8), real("w_add", "W add", 0, -4, 4), ...counted(1024)],
    hints: { deoption: 5, descale: 0.2, adescale: 1, rstop: 1024, sipow: 2 },
  },
  // _BT3_Transform3 / _BenesiT3 (Benesi): the "hollowing" transform with abs instead of squaring.
  "mb3d-bt3-transform3": { dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric"], parameters: [real("scale", "Scale", 1.7, -100, 100), real("x_off", "x-offset", 1.7, -100, 100)], hints: HELPER_HINTS },
  // _BRotateToMag: a pure rotation (the matrix is orthogonal), so it keeps every distance estimate valid.
  "mb3d-brotatetomag": { dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric", "analytic", "ifs"], parameters: [], hints: HELPER_HINTS },
  // _QuadrayTransform / _QuadrayTransform2: 3D point and C to a 4D quadray point (the 3D-to-4D lift of the file).
  "mb3d-quadraytransform": { dimension: 4, method: "numeric", role: "helper", wMode: "coordinate", helperMethods: ["numeric"], parameters: [], hints: HELPER_HINTS },
  "mb3d-quadraytransform2": { dimension: 4, method: "numeric", role: "helper", wMode: "coordinate", helperMethods: ["numeric"], parameters: [real("offset", "Offset", -1.35, -100, 100), real("scale", "Scale", 1, -100, 100)], hints: HELPER_HINTS },
};

// ---- CPU ------------------------------------------------------------------------------------------------------------------
type C2 = [number, number];
const cmul = (a: C2, b: C2): C2 => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

/**
 * One pass of Makin's two-complex-number formula. z = x + iy and w = z + iw of the file are the complex numbers of the coordinates
 * (x,y) and (z,w); |z| of the file is the SQUARED modulus (Ultra Fractal's meaning, the same reading as the batch 03 Makin4D p2a), cabs the modulus.
 *   a: s = |z|, t = |w|, wt = w, w = 2zw, s >= t ? z = z^2 (1 - t/s) : z = (s/t - 1) wt^2
 *   b: m = |z| + |w|, w = 2zw, z = 2 z^2, n = cabs(z), z = z (1 - m/n)
 * Returns null when the pass divides by zero.
 */
function makinPass(variant: "a" | "b", v: number[]): number[] | null {
  const Z: C2 = [v[0]!, v[1]!], W: C2 = [v[2]!, v[3]!];
  const s = Z[0] * Z[0] + Z[1] * Z[1], t = W[0] * W[0] + W[1] * W[1];
  const nextW = cmul(Z, W).map((q) => 2 * q) as C2;
  let nextZ: C2;
  if (variant === "a") {
    if (s >= t) {
      if (s === 0) return null;
      const k = 1 - t / s, zz = cmul(Z, Z);
      nextZ = [zz[0] * k, zz[1] * k];
    } else {
      const k = s / t - 1, ww = cmul(W, W);
      nextZ = [ww[0] * k, ww[1] * k];
    }
  } else {
    const zz = cmul(Z, Z), z2: C2 = [2 * zz[0], 2 * zz[1]], n = Math.hypot(z2[0], z2[1]);
    if (n === 0) return null;
    const k = 1 - (s + t) / n;
    nextZ = [z2[0] * k, z2[1] * k];
  }
  return [nextZ[0], nextZ[1], nextW[0], nextW[1]];
}

export function stepBatch08Kernel(id: Batch08KernelId, p: KernelParameters, s: KernelState): void {
  let [x, y, z, w] = s.v;
  const [cx, cy, cz, cw] = s.c;
  switch (id) {
    case "mb3d-msltoesym4": {
      const swap = (a: number, b: number): [number, number] => [b, a];
      if (Math.abs(x) < Math.abs(z) * p.xz_sym_mul!) [x, z] = swap(x, z);
      if (Math.abs(x) < Math.abs(y) * p.xy_sym_mul!) [x, y] = swap(x, y);
      if (Math.abs(y) < Math.abs(z) * p.yz_sym_mul!) [y, z] = swap(y, z);
      if (x * z < 0) z = -z;
      if (x * y < 0) y = -y;
      [x, y, z] = [x * x - y * y - z * z + cx, 2 * x * y + cy, 2 * x * z + cz];
      break;
    }
    case "mb3d-benesi3pow2": {
      let r1 = y * y + z * z;
      if (r1 === 0) { s.invalid = true; return; }
      const nx = cx < 0 || x < Math.sqrt(r1) ? x * x - r1 + cx : -x * x + r1 + cx;
      r1 = -(r1 ** -0.5) * 2 * Math.abs(x); // x is still the old x here, as in the description (x' is assigned, x is read)
      [x, y, z] = [nx, r1 * (y * y - z * z) + cy, r1 * 2 * y * z + cz];
      break;
    }
    case "mb3d-benesipine2": {
      [x, y, z] = benesiFold2(x, y, z, p.scale!, p.x_off!, true);
      const xt = x * x, yt = y * y, zt = z * z, t = (2 * x) / Math.sqrt(Math.max(yt + zt, 1e-40));
      // The description writes z before y, so y uses the new z (including Cy); C goes to x, z, y in that order, exactly as for BenesiPine1.
      x = xt - yt - zt + cx;
      z = t * (yt - zt) + cy;
      y = 2 * t * y * z + cz;
      break;
    }
    case "mb3d-makin4d-p2b": case "mb3d-makin4d-p4a": case "mb3d-makin4d-p4b": case "mb3d-makin4d-p8a": case "mb3d-makin4d-p8b": {
      const { variant, repeats } = MAKIN_REPEATS[id]!;
      let v: number[] | null = [x, y, z, w];
      for (let i = 0; i < repeats && v; i++) v = makinPass(variant, v);
      if (!v) { s.invalid = true; return; }
      [x, y, z, w] = [v[0]! + cx, v[1]! + cy, v[2]! + cz, v[3]! + cw + p.w_add!];
      break;
    }
    case "mb3d-aboxmod1": {
      const sc = p.scale! + p.scale_vary! * (Math.abs(p.scale!) - 1), f = p.fold!;
      const fold = (t: number, m: number) => f - Math.abs(Math.abs(t + m) - f) - Math.abs(m);
      x = fold(x, p.fold_x_mod!); y = fold(y, p.fold_y_mod!); z = fold(z, p.fold_z_mod!);
      const rr = x * x + y * y + z * z, low = p.min_r! * p.min_r!;
      if (!(rr < low) && rr === 0) { s.invalid = true; return; }
      const m = rr < low ? sc / low : rr < 1 ? sc / rr : sc;
      [x, y, z] = [x * m + cy, y * m + cx, z * m + cz];
      w *= m;
      break;
    }
    case "mb3d-aboxmod4d": {
      const f = p.fold!;
      x = Math.abs(x + f) - f; y = Math.abs(y + f) - f; z = Math.abs(z + f) - f; w = Math.abs(w + f) - f;
      const rr = x * x + y * y + z * z + w * w + 1e-60, m = rr < 1 ? p.scale! / rr : p.scale!;
      [x, y, z, w] = [x * m + cx, y * m + cy, z * m + cz, w * m + p.w_add! + cw];
      s.derivative *= m;
      break;
    }
    case "mb3d-aboxsphereoffset4d": {
      const f = p.fold!, off = [p.offset_x!, p.offset_y!, p.offset_z!, p.offset_w!];
      const u = [x, y, z, w].map((t, i) => Math.abs(t + f) - Math.abs(t - f) - t - off[i]!);
      const rr = u.reduce((a, b) => a + b * b, 0), low = p.min_r! * p.min_r!;
      if (!(rr < low) && rr === 0) { s.invalid = true; return; }
      const m = rr < low ? p.scale! / low : rr < 1 ? p.scale! / rr : p.scale!;
      [x, y, z, w] = [u[0]! * m + off[0]! + cx, u[1]! * m + off[1]! + cy, u[2]! * m + off[2]! + cz, u[3]! * m + off[3]! + p.w_add! + cw];
      s.derivative *= m;
      break;
    }
    case "mb3d-bt3-transform3": {
      // "Benesi fold 3": the statements in the order the description writes them (ty uses the tx just computed, x is read after it was changed).
      const sc = p.scale!, off = p.x_off!;
      let tx = (x * S_.s23 - z * S_.s13) * S_.s12;
      y = y * S_.s12;
      z = Math.abs(x * S_.s13 + z * S_.s23);
      tx = Math.abs(tx - y);
      const ty = Math.abs(tx + y);
      x = Math.abs(ty + z - off) * sc * S_.s12;
      y = Math.abs(tx + z - off) * sc * S_.s12;
      z = Math.abs(tx + ty - off) * sc;
      tx = y + x; y = y - x;
      x = z * S_.s13 + x * S_.s23;
      z = z * S_.s23 - x * S_.s13;
      break;
    }
    case "mb3d-brotatetomag": {
      const tx = (x * S_.s23 - z * S_.s13) * S_.s12, yy = y * S_.s12;
      [x, y, z] = [tx - yy, tx + yy, x * S_.s13 + z * S_.s23];
      break;
    }
    case "mb3d-quadraytransform": {
      [x, y, z, w] = [x + y + z, -x - y + z, -x + y - z, x - y - z];
      s.c = [cx + cy + cz, -cx - cy + cz, -cx + cy - cz, cx - cy - cz];
      break;
    }
    case "mb3d-quadraytransform2": {
      const k = p.scale!, o = p.offset!;
      [x, y, z, w] = [k * Math.abs(x + y + z) + o, k * Math.abs(-x - y + z) + o, k * Math.abs(-x + y - z) + o, k * Math.abs(x - y - z) + o];
      s.c = [k * Math.abs(cx + cy + cz) + o, k * Math.abs(-cx - cy + cz) + o, k * Math.abs(-cx + cy - cz) + o, k * Math.abs(cx - cy - cz) + o];
      break;
    }
  }
  s.v = [x, y, z, w];
  if (![...s.v, ...s.c].every(Number.isFinite)) s.invalid = true;
}
const S_ = { s23: Math.sqrt(2 / 3), s13: Math.sqrt(1 / 3), s12: Math.sqrt(1 / 2) };

// ---- WGSL ----------------------------------------------------------------------------------------------------------------
const makinPassWgsl = (variant: "a" | "b") => variant === "a"
  ? `{let zr=vec2f(q.x,q.y);let wr=vec2f(q.z,q.w);let s0=dot(zr,zr);let t0=dot(wr,wr);
    let nw=2.0*vec2f(zr.x*wr.x-zr.y*wr.y,zr.x*wr.y+zr.y*wr.x);var nz=vec2f(0.0);
    if(s0>=t0){if(s0==0.0){bad=true;}else{let k=1.0-t0/s0;nz=k*vec2f(zr.x*zr.x-zr.y*zr.y,2.0*zr.x*zr.y);}}
    else{let k=s0/t0-1.0;nz=k*vec2f(wr.x*wr.x-wr.y*wr.y,2.0*wr.x*wr.y);}
    q=vec4f(nz,nw);}`
  : `{let zr=vec2f(q.x,q.y);let wr=vec2f(q.z,q.w);let s0=dot(zr,zr);let t0=dot(wr,wr);
    let nw=2.0*vec2f(zr.x*wr.x-zr.y*wr.y,zr.x*wr.y+zr.y*wr.x);let z2=2.0*vec2f(zr.x*zr.x-zr.y*zr.y,2.0*zr.x*zr.y);let nn=length(z2);var nz=vec2f(0.0);
    if(nn==0.0){bad=true;}else{nz=z2*(1.0-(s0+t0)/nn);}
    q=vec4f(nz,nw);}`;

export function batch08Body(id: Batch08KernelId, p: (name: string) => string, _matrixNames: string[]): string {
  switch (id) {
    case "mb3d-msltoesym4":
      return `var x=s.v.x;var y=s.v.y;var z=s.v.z;
 if(abs(x)<abs(z)*${p("xz_sym_mul")}){let sw=x;x=z;z=sw;}
 if(abs(x)<abs(y)*${p("xy_sym_mul")}){let sw=x;x=y;y=sw;}
 if(abs(y)<abs(z)*${p("yz_sym_mul")}){let sw=y;y=z;z=sw;}
 if(x*z<0.0){z=-z;}if(x*y<0.0){y=-y;}
 s.v=vec4f(x*x-y*y-z*z+s.c.x,2.0*x*y+s.c.y,2.0*x*z+s.c.z,s.v.w);`;
    case "mb3d-benesi3pow2":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let r1=y*y+z*z;
 if(r1==0.0){s.invalid=true;}else{
 var nx=-x*x+r1+s.c.x;if(s.c.x<0.0||x<sqrt(r1)){nx=x*x-r1+s.c.x;}
 let k=-2.0*abs(x)/sqrt(r1);
 s.v=vec4f(nx,k*(y*y-z*z)+s.c.y,k*2.0*y*z+s.c.z,s.v.w);}`;
    case "mb3d-benesipine2":
      return `var x=s.v.x;var y=s.v.y;var z=s.v.z;
 ${fold2(p, true)}
 let xt=x*x;let yt=y*y;let zt=z*z;let t=2.0*x/sqrt(max(yt+zt,1.0e-30));
 x=xt-yt-zt+s.c.x;z=t*(yt-zt)+s.c.y;y=2.0*t*y*z+s.c.z;s.v=vec4f(x,y,z,s.v.w);`;
    case "mb3d-makin4d-p2b": case "mb3d-makin4d-p4a": case "mb3d-makin4d-p4b": case "mb3d-makin4d-p8a": case "mb3d-makin4d-p8b": {
      const { variant, repeats } = MAKIN_REPEATS[id]!;
      return `var q=s.v;var bad=false;
 ${Array.from({ length: repeats }, () => makinPassWgsl(variant)).join("\n ")}
 if(bad){s.invalid=true;}else{s.v=q+vec4f(s.c.x,s.c.y,s.c.z,s.c.w+${p("w_add")});}`;
    }
    case "mb3d-aboxmod1":
      return `var x=s.v.x;var y=s.v.y;var z=s.v.z;let fd=${p("fold")};let sc=${p("scale")}+${p("scale_vary")}*(abs(${p("scale")})-1.0);
 x=fd-abs(abs(x+${p("fold_x_mod")})-fd)-abs(${p("fold_x_mod")});y=fd-abs(abs(y+${p("fold_y_mod")})-fd)-abs(${p("fold_y_mod")});z=fd-abs(abs(z+${p("fold_z_mod")})-fd)-abs(${p("fold_z_mod")});
 let rr=x*x+y*y+z*z;let low=${p("min_r")}*${p("min_r")};
 if(!(rr<low)&&rr==0.0){s.invalid=true;}else{
 var m=sc;if(rr<low){m=sc/low;}else if(rr<1.0){m=sc/rr;}
 s.v=vec4f(x*m+s.c.y,y*m+s.c.x,z*m+s.c.z,s.v.w*m);}`;
    case "mb3d-aboxmod4d":
      // 1e-60 of the description is below the smallest f32; 1e-30 plays the same role (it only matters for a point at the exact origin).
      return `let fd=${p("fold")};let b=abs(s.v+vec4f(fd))-vec4f(fd);let rr=dot(b,b)+1.0e-30;var m=${p("scale")};if(rr<1.0){m=${p("scale")}/rr;}
 s.v=b*m+s.c+vec4f(0.0,0.0,0.0,${p("w_add")});s.derivative*=m;`;
    case "mb3d-aboxsphereoffset4d":
      return `let fd=${p("fold")};let off=vec4f(${p("offset_x")},${p("offset_y")},${p("offset_z")},${p("offset_w")});
 let b=abs(s.v+vec4f(fd))-abs(s.v-vec4f(fd))-s.v-off;let rr=dot(b,b);let low=${p("min_r")}*${p("min_r")};
 if(!(rr<low)&&rr==0.0){s.invalid=true;}else{
 var m=${p("scale")};if(rr<low){m=${p("scale")}/low;}else if(rr<1.0){m=${p("scale")}/rr;}
 s.v=b*m+off+s.c+vec4f(0.0,0.0,0.0,${p("w_add")});s.derivative*=m;}`;
    case "mb3d-bt3-transform3":
      return `var x=s.v.x;var y=s.v.y;var z=s.v.z;let sc=${p("scale")};let off=${p("x_off")};
 var tx=(x*${S.s23}-z*${S.s13})*${S.s12};y=y*${S.s12};z=abs(x*${S.s13}+z*${S.s23});
 tx=abs(tx-y);let ty=abs(tx+y);
 x=abs(ty+z-off)*sc*${S.s12};y=abs(tx+z-off)*sc*${S.s12};z=abs(tx+ty-off)*sc;
 tx=y+x;y=y-x;x=z*${S.s13}+x*${S.s23};z=z*${S.s23}-x*${S.s13};s.v=vec4f(x,y,z,s.v.w);`;
    case "mb3d-brotatetomag":
      return `let x=s.v.x;let y=s.v.y;let z=s.v.z;let tx=(x*${S.s23}-z*${S.s13})*${S.s12};let yy=y*${S.s12};
 s.v=vec4f(tx-yy,tx+yy,x*${S.s13}+z*${S.s23},s.v.w);`;
    case "mb3d-quadraytransform":
      return `let a=s.v.xyz;let c=s.c.xyz;
 s.v=vec4f(a.x+a.y+a.z,-a.x-a.y+a.z,-a.x+a.y-a.z,a.x-a.y-a.z);s.c=vec4f(c.x+c.y+c.z,-c.x-c.y+c.z,-c.x+c.y-c.z,c.x-c.y-c.z);`;
    case "mb3d-quadraytransform2":
      return `let a=s.v.xyz;let c=s.c.xyz;let k=${p("scale")};let o=${p("offset")};
 s.v=vec4f(k*abs(a.x+a.y+a.z)+o,k*abs(-a.x-a.y+a.z)+o,k*abs(-a.x+a.y-a.z)+o,k*abs(a.x-a.y-a.z)+o);
 s.c=vec4f(k*abs(c.x+c.y+c.z)+o,k*abs(-c.x-c.y+c.z)+o,k*abs(-c.x+c.y-c.z)+o,k*abs(c.x-c.y-c.z)+o);`;
  }
}
