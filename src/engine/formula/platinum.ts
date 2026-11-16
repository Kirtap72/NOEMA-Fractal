/** Independent normalized recovery: NewFormulas/preset-compatibility/ABoxPlatinum.md. */
import type { KernelInfo, KernelState, PreparedKernel } from "./kernels";
import { applyMatrix, nearestEven } from "./primitives";
import { boxFold, sphereFactor } from "./essentialsKernels";

export const PLATINUM_INFO: KernelInfo = {
  dimension: 3,
  method: "analytic",
  wMode: "derivative",
  hints: { deoption: 2, descale: 0.2, adescale: 1, rstop: 1024, sipow: 2 },
  parameters: [
    ["scale", "Scale", 2, -8, 8],
    ["minr_ir", "MinR/IR", 0.5, -8, 8],
    ["fold", "Fold", 1, -8, 8],
    ...["x", "y", "z"].map((a) => [
      "rotate_" + a,
      "Rotate " + a.toUpperCase(),
      0,
      -180,
      180,
    ]),
    ...["x", "y", "z"].map((a) => [
      "inv_" + a + "c",
      "Inv " + a + "C",
      0,
      -8,
      8,
    ]),
    ["inv_radius", "Inv Radius", 1, -8, 8],
    ...["x_xy", "x_xz", "y_xy", "y_yz"].map((a) => [
      "fold" + a + "_angle",
      "Fold" + a + " angle",
      0,
      -180,
      180,
    ]),
    ["abs_xyz_switches", "Abs XYZ switches", 0, 0, 7],
    ["constant_w", "Julia constant w", 0, -4, 4],
    ["bailout_squared", "Escape limit (radius²)", 1024, 1, 65536],
  ].map(([name, label, def, min, max]) => ({
    name: name as string,
    label: label as string,
    default: def as number,
    min: min as number,
    max: max as number,
  })),
};

/** Rotate in a plane, fold the first coordinate, apply the recovered back-map.
 * The back-map's signs are intentional; an idealized inverse would change this formula. */
export function rotatedBoxFold(
  u: number,
  v: number,
  t: number,
  a: number,
  b: number,
  fold: number,
): number[] {
  const ca = Math.cos(a),
    sa = Math.sin(a),
    cb = Math.cos(b),
    sb = Math.sin(b);
  const U = u * ca - t * sa,
    T = u * sa + t * ca,
    V = U * sb + v * cb,
    F = boxFold(U * cb - v * sb, fold);
  const q = F * cb - V * sb;
  return [q * ca - T * sa, F * sb + V * cb, q * sa + T * ca];
}
export function stepPlatinum(
  { p, matrices }: PreparedKernel,
  s: KernelState,
): void {
  const rad = (key: string) => (p[key]! * Math.PI) / 180;
  let [x, y, z] = rotatedBoxFold(
    s.v[0],
    s.v[1],
    s.v[2],
    rad("foldx_xz_angle"),
    rad("foldx_xy_angle"),
    p.fold!,
  ) as [number, number, number];
  [y, x, z] = rotatedBoxFold(
    y,
    x,
    z,
    rad("foldy_yz_angle"),
    rad("foldy_xy_angle"),
    p.fold!,
  ) as [number, number, number];
  z = boxFold(z, p.fold!);
  finishPlatinum([x,y,z],p,matrices,s);
}

/** ABoxPlatinumB projects X and Y independently from the original point.
 * Reusing the sequential fold result would produce ABoxPlatinum instead. */
export function stepPlatinumB({p,matrices}:PreparedKernel,s:KernelState):void {
  const [x,y,z]=s.v,rad=(key:string)=>p[key]!*Math.PI/180;
  const projected=[
    rotatedBoxFold(x,y,z,rad('foldx_xz_angle'),rad('foldx_xy_angle'),p.fold!)[0]!,
    rotatedBoxFold(y,x,z,rad('foldy_yz_angle'),rad('foldy_xy_angle'),p.fold!)[0]!,
    boxFold(z,p.fold!),
  ];
  finishPlatinum(projected,p,matrices,s);
}

/** Shared displaced inversion and signed analytic derivative after the distinct folds. */
function finishPlatinum(folded:number[],p:PreparedKernel['p'],matrices:PreparedKernel['matrices'],s:KernelState):void {
  const mask = nearestEven(p.abs_xyz_switches!);
  const centre = [p.inv_xc!, p.inv_yc!, p.inv_zc!];
  const q = folded.map(
    (t, i) => (mask & (1 << i) ? Math.abs(t) : t) + centre[i]!,
  );
  const radius = Math.abs(p.inv_radius!) >= 1e-40 ? p.inv_radius! : 1e-40;
  const rr = q.reduce((sum, t) => sum + t * t, 0) / radius;
  const factor = sphereFactor(rr, Math.max(1e-40, p.minr_ir!) ** 2, p.scale!);
  const v = applyMatrix(
    matrices[0]!,
    q.map((t, i) => factor * t - p.scale! * centre[i]!),
  );
  s.v = [v[0]! + s.c[0], v[1]! + s.c[1], v[2]! + s.c[2], factor * s.v[3]];
  if (!s.v.every(Number.isFinite)) s.invalid = true;
}
export const PLATINUM_PRIMITIVES_WGSL = /* wgsl */ `
fn kernelRotatedBox(u:f32,v:f32,t:f32,a:f32,b:f32,f:f32)->vec3f {
 let ca=cos(a);let sa=sin(a);let cb=cos(b);let sb=sin(b);
 let U=u*ca-t*sa;let T=u*sa+t*ca;let V=U*sb+v*cb;let F=essentialBox(U*cb-v*sb,f);let q=F*cb-V*sb;
 return vec3f(q*ca-T*sa,F*sb+V*cb,q*sa+T*ca);
}`;
export function platinumBody(p: (name: string) => string, m: string, projected=false): string {
  const folding=projected ? `let a=kernelRotatedBox(s.v.x,s.v.y,s.v.z,${p("foldx_xz_angle")}*0.017453292519943295,${p("foldx_xy_angle")}*0.017453292519943295,${p("fold")});
 let b=kernelRotatedBox(s.v.y,s.v.x,s.v.z,${p("foldy_yz_angle")}*0.017453292519943295,${p("foldy_xy_angle")}*0.017453292519943295,${p("fold")});
 var folded=vec3f(a.x,b.x,essentialBox(s.v.z,${p("fold")}));` : `let a=kernelRotatedBox(s.v.x,s.v.y,s.v.z,${p("foldx_xz_angle")}*0.017453292519943295,${p("foldx_xy_angle")}*0.017453292519943295,${p("fold")});
 let b=kernelRotatedBox(a.y,a.x,a.z,${p("foldy_yz_angle")}*0.017453292519943295,${p("foldy_xy_angle")}*0.017453292519943295,${p("fold")});
 var folded=vec3f(b.y,b.x,essentialBox(b.z,${p("fold")}));`;
  return `${folding}let mask=i32(round(${p("abs_xyz_switches")}));
 for(var axis=0;axis<3;axis++){if((mask&(1<<u32(axis)))!=0){folded[axis]=abs(folded[axis]);}}
 let centre=vec3f(${p("inv_xc")},${p("inv_yc")},${p("inv_zc")});let q=folded+centre;
 let radius=${p("inv_radius")};let rr=dot(q,q)/select(1e-40,radius,abs(radius)>=1e-40);
 let low=pow(max(1e-40,${p("minr_ir")}),2.0);
 if(!kernelFinite(rr)||(low==0.0&&rr<=0.0)){s.invalid=true;break;}
 let factor=essentialSphere(rr,low,${p("scale")},${p("scale")});
 s.v=vec4f(${m}*(factor*q-${p("scale")}*centre)+s.c.xyz,factor*s.v.w);`;
}
