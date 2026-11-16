/**
 * FINAL-FIXES-08: three formulas recovered from the equations in their own descriptions (see NewFormulas/final-fixes-08/BATCH-04.md):
 *   koch_cube (Luca GN 2011), ABoxVS_icen1 (Luca GN 2011) and _AmazingBoxSSE2 (author not named in the file).
 * One place for the metadata, the CPU step and the WGSL body so the two implementations are read side by side.
 * The [CODE] sections of the formula files were not read.
 */
import type { KernelInfo, KernelParameters, KernelState, PreparedKernel } from "./kernels";
import type { Parameter } from "./types";
import { applyMatrix } from "./primitives";

export const FOLLOWUP_KERNEL_IDS = ["mb3d-kochcube", "mb3d-aboxvsicen1", "mb3d-amazingboxsse2"] as const;
export type FollowupKernelId = (typeof FOLLOWUP_KERNEL_IDS)[number];

const real = (name: string, label: string, def: number, min = -1000, max = 1000): Parameter => ({ name, label, default: def, min, max });
// Every counted kernel carries the two host controls the other counted kernels have.
const hostControls = (): Parameter[] => [real("constant_w", "Julia constant w", 0, -4, 4), real("bailout_squared", "Escape limit (radius²)", 1024, 1, 65536)];

export const FOLLOWUP_DEFINITIONS: Record<FollowupKernelId, KernelInfo> = {
  // koch_cube: OPTIONS .DEoption 2, .DEscale 1, .SIpower 1, .RStop 5.
  "mb3d-kochcube": {
    dimension: 3, method: "analytic", wMode: "derivative",
    parameters: [
      real("postscale", "Post-scale", 1), real("xy_stretch", "XY Stretch", 1), real("z_fold", "Z Fold", 1),
      real("x_add", "X Add", 0), real("y_add", "Y Add", 0), real("z_add", "Z Add", 0),
      real("rotation_x", "Rotation X (degrees)", 0, -180, 180), real("rotation_y", "Rotation Y (degrees)", 0, -180, 180), real("rotation_z", "Rotation Z (degrees)", 0, -180, 180),
      ...hostControls(),
    ],
    hints: { deoption: 2, descale: 1, adescale: 1, rstop: 5, sipow: 1 },
  },
  // ABoxVS_icen1: OPTIONS .DEoption 11, .DEscale 0.2, .SIpower 2, .RStop 1024.
  "mb3d-aboxvsicen1": {
    dimension: 3, method: "analytic", wMode: "derivative",
    parameters: [
      real("scale", "Scale", 2, -8, 8), real("min_r", "Min R", 0.5, -8, 8), real("fold", "Fold", 1, -8, 8), real("scale_vary", "Scale vary", 0, -8, 8),
      real("inversion_radius", "Inversion radius", 1, -1000, 1000), real("inv_xc", "Inversion xC", 0.5), real("inv_yc", "Inversion yC", 0), real("inv_zc", "Inversion zC", 0),
      real("c_swap_mode", "C-Swap mode", 0, -1000, 1000),
      ...hostControls(),
    ],
    hints: { deoption: 11, descale: 0.2, adescale: 1, rstop: 1024, sipow: 2 },
  },
  // _AmazingBoxSSE2: OPTIONS .DEoption 11, .DEscale 0.2, .SIpower 2, .RStop 1024, "The amazing box formula without adding the C component".
  "mb3d-amazingboxsse2": {
    dimension: 3, method: "analytic", wMode: "derivative",
    parameters: [real("scale", "Scale", 2, -8, 8), real("min_r", "Min R", 0.5, -8, 8), real("fold", "Fold", 1, -8, 8), ...hostControls()],
    hints: { deoption: 11, descale: 0.2, adescale: 1, rstop: 1024, sipow: 2 },
  },
};

/** Rotation parameter prefix of a kernel that needs one matrix (CPU and WGSL build it the same way as for the other kernels). */
export const FOLLOWUP_ROTATIONS: Partial<Record<FollowupKernelId, string>> = { "mb3d-kochcube": "rotation" };

// The persistent variable scale, identical to updateVaryScale in essentialsKernels.ts (not imported: that module imports kernels.ts, which imports this one).
function updateVaryScale(s: KernelState, scale: number, vary: number): number {
  if (s.firstIteration <= 0) { s.firstIteration++; s.first = s.firstIteration > 0; s.varyScale = scale; }
  s.varyScale += vary * (Math.abs(s.varyScale) - 1);
  return s.varyScale;
}
const boxFold = (t: number, f: number) => Math.abs(t + f) - Math.abs(t - f) - t;
const finite = (v: readonly number[]) => v.every(Number.isFinite);

export function stepFollowupKernel(k: PreparedKernel, s: KernelState): void {
  const p: KernelParameters = k.p;
  let [x, y, z, w] = s.v;
  if (k.id === "mb3d-kochcube") {
    const stretch = p.xy_stretch!, post = p.postscale!;
    if (stretch === 0) { s.invalid = true; return; }
    // Fold into the positive octant and sort the axes descending (the description's three compare-and-swap steps).
    [x, y, z] = ([Math.abs(x) * 3, Math.abs(y) * 3, Math.abs(z) * 3].sort((a, b) => b - a)) as [number, number, number];
    [x, y, z] = applyMatrix(k.matrices[0]!, [x + p.x_add!, y + p.y_add!, z + p.z_add!]) as [number, number, number];
    const a = 3 - stretch, b = 3 + stretch, c = x - a, d = x - b;
    z = p.z_fold! - Math.abs(p.z_fold! - z);
    if (c < y) { x = c; y = y - a; }
    else if (d > y) { x = d; }
    else { x = y; y = d; }
    x = (x / stretch) * post; y = (y / stretch) * post; z *= post;
    // The map is a similarity of 3*|post| along z and 3*|post|/|stretch| in the plane. With the default stretch it is exact; otherwise the larger factor is
    // used so the distance never overshoots (the description does not give a derivative; this is my choice, documented in BATCH-04.md).
    w *= 3 * Math.abs(post) * Math.max(1, 1 / Math.abs(stretch));
  } else if (k.id === "mb3d-aboxvsicen1") {
    const scale = updateVaryScale(s, p.scale!, p.scale_vary!), low = Math.max(1e-40, p.min_r!) ** 2, ir = p.inversion_radius!;
    const centre = [p.inv_xc!, p.inv_yc!, p.inv_zc!], swapped = Math.round(p.c_swap_mode!) !== 0;
    const q = [x, y, z].map((t, i) => boxFold(t, p.fold!) + (swapped ? s.c[i]! : centre[i]!));
    const rr = q[0]! ** 2 + q[1]! ** 2 + q[2]! ** 2;
    if (rr === 0 && low === 0) { s.invalid = true; return; }
    const m = rr < low ? (ir * scale) / low : rr < ir ? (ir * scale) / rr : scale;
    [x, y, z] = q.map((t, i) => (swapped ? t * m - s.c[i]! + centre[i]! : t * m + s.c[i]! - centre[i]!)) as [number, number, number];
    w *= m;
  } else {
    const q = [x, y, z].map((t) => boxFold(t, p.fold!));
    const rr = q[0]! ** 2 + q[1]! ** 2 + q[2]! ** 2, low = Math.max(1e-40, p.min_r!) ** 2;
    if (rr === 0 && low === 0) { s.invalid = true; return; }
    const m = rr < low ? p.scale! / low : rr < 1 ? p.scale! / rr : p.scale!;
    [x, y, z] = q.map((t) => m * t) as [number, number, number];
    w *= m;
  }
  s.v = [x, y, z, w];
  if (!finite(s.v)) s.invalid = true;
}

/** WGSL body acting on the shared KernelOrbit `s`; same equations as stepFollowupKernel. */
export function followupBody(id: FollowupKernelId, p: (name: string) => string, matrixNames: string[]): string {
  if (id === "mb3d-kochcube") {
    return `let st=${p("xy_stretch")};let ps=${p("postscale")};if(st==0.0){s.invalid=true;break;}
 var q=abs(s.v.xyz)*3.0;if(q.y>q.x){q=q.yxz;}if(q.z>q.x){q=q.zyx;}if(q.z>q.y){q=q.xzy;}
 q=${matrixNames[0]!}*(q+vec3f(${p("x_add")},${p("y_add")},${p("z_add")}));
 let a=3.0-st;let b=3.0+st;let c=q.x-a;let d=q.x-b;let zf=${p("z_fold")};q.z=zf-abs(zf-q.z);
 if(c<q.y){q=vec3f(c,q.y-a,q.z);}else if(d>q.y){q.x=d;}else{q=vec3f(q.y,d,q.z);}
 q=vec3f(q.x/st,q.y/st,q.z)*ps;
 s.v=vec4f(q,s.v.w*3.0*abs(ps)*max(1.0,1.0/abs(st)));`;
  }
  if (id === "mb3d-aboxvsicen1") {
    return `let scale=essentialVary(&s,${p("scale")},${p("scale_vary")});let low=pow(max(1e-40,${p("min_r")}),2.0);let ir=${p("inversion_radius")};
 let centre=vec3f(${p("inv_xc")},${p("inv_yc")},${p("inv_zc")});let swapped=i32(round(${p("c_swap_mode")}))!=0;
 let q=essentialBox3(s.v.xyz,${p("fold")})+select(centre,s.c.xyz,swapped);let rr=dot(q,q);
 if(!kernelFinite(rr)||(rr==0.0&&low==0.0)){s.invalid=true;break;}
 let m=select(select(scale,ir*scale/rr,rr<ir),ir*scale/low,rr<low);
 s.v=vec4f(select(q*m+s.c.xyz-centre,q*m-s.c.xyz+centre,swapped),m*s.v.w);`;
  }
  return `let q=essentialBox3(s.v.xyz,${p("fold")});let rr=dot(q,q);let low=pow(max(1e-40,${p("min_r")}),2.0);
 if(!kernelFinite(rr)||(rr==0.0&&low==0.0)){s.invalid=true;break;}
 let m=essentialSphere(rr,low,${p("scale")},${p("scale")});s.v=vec4f(m*q,m*s.v.w);`;
}
