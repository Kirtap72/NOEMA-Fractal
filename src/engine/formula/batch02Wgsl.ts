import type { KernelId } from "./kernels";
export const BATCH_02_PRIMITIVES_WGSL = /* wgsl */ `
fn kernelHamilton(a:vec4f,b:vec4f)->vec4f {return vec4f(a.x*b.x-a.y*b.y-a.z*b.z-a.w*b.w,a.x*b.y+a.y*b.x+a.z*b.w-a.w*b.z,a.x*b.z-a.y*b.w+a.z*b.x+a.w*b.y,a.x*b.w+a.y*b.z-a.z*b.y+a.w*b.x);}
fn kernelCommutative(a:vec4f,b:vec4f)->vec4f {return vec4f(a.x*b.x-a.y*b.y-a.z*b.z+a.w*b.w,a.x*b.y+a.y*b.x-a.z*b.w-a.w*b.z,a.x*b.z+a.z*b.x-a.y*b.w-a.w*b.y,a.x*b.w+a.w*b.x+a.y*b.z+a.z*b.y);}
fn kernelSort3(a:vec3f)->vec3f {return vec3f(max(a.x,max(a.y,a.z)),max(min(a.x,a.y),min(max(a.x,a.y),a.z)),min(a.x,min(a.y,a.z)));}
fn kernelRadial(rr:f32,lo:f32,hi:f32,inclusive:bool)->f32 {if(rr>hi || (inclusive && rr==hi)) {return 1.0;}return hi/max(rr,lo);}
fn kernelMenger(a:vec3f,scale:f32,c:vec3f)->vec3f {let offset=c.z*(scale-1.0)/scale;return vec3f(scale*a.xy-c.xy*(scale-1.0),scale*(offset-abs(a.z-offset)));}
fn kernelDihed(input:vec4f,c:vec4f,outer:i32,inner:i32)->KernelMapResult {
  var v=input;
  for(var o=0;o<outer;o++) {
    let rr=dot(v.xyz,v.xyz);if(rr>=1e10) {return KernelMapResult(vec4f(vec3f(1e10),v.w),false);}
    var radius=sqrt(rr);
    let chart=kernelChart(v.xyz,true);
    if(chart.z==0.0) {return KernelMapResult(input,true);}
    var u=chart.x;var t=chart.y;
    for(var j=0;j<inner;j++) {
      let h=u*u+t*t;if(h>=1e10) {return KernelMapResult(vec4f(vec3f(1e10),v.w),false);}
      let nx=u*(h-1.0)*(h*h+2.0*h+4.0*t*t+1.0);
      let ny=-t*(h+1.0)*(h-2.0*u-1.0)*(h+2.0*u-1.0);
      let factor=(h-2.0*t+1.0)*(h+2.0*t+1.0);let den=factor*factor;
      if(den==0.0) {return KernelMapResult(input,true);}
      let m=2.0/den;u=nx*m;t=ny*m;radius*=radius;
    }
    let inverse=kernelInverseChart(u,t,radius,1.0);
    if(inverse.w==0.0) {return KernelMapResult(input,true);}
    v=vec4f(inverse.xyz,v.w);
  }
  return KernelMapResult(vec4f(v.xyz+c.xyz,v.w),false);
}
`;

export function batch02Body(
  id: KernelId,
  p: (name: string) => string,
  m: string[],
): string {
  const v = (names: string[]) =>
    `vec${names.length}f(${names.map(p).join(",")})`;
  const on = (name: string) => `round(${p(name)})!=0.0`;
  switch (id) {
    case "beth-2422":
      return `let a=s.v;let sq=a*a;var result=vec4f(0.0);for(var i=0;i<4;i++) {var other=vec3f(0.0);var k=0;for(var j=0;j<4;j++) {if(j!=i) {other[k]=sq[j];k++;}}let u=a[i];result[i]=2.5*u*(3.0*sq[i]*sq[i]+7.0*dot(other,other)-10.0*sq[i]*(other.x+other.y+other.z)-6.0*(other.x*other.y+other.y*other.z+other.z*other.x))+s.c[i];}result.w+=${p("w_add")};s.v=result;`;
    case "ides-formula":
      return `let a=s.v;s.v=vec4f(${p("x_mul")}*a.x*a.x-${p("xsub_mul")}*(a.y*a.y+a.z*a.z)+s.c.x,${p("y_mul")}*a.x*a.y*a.z+s.c.y,${p("z_mul")}*a.z*a.z-${p("zsub_mul")}*(a.x*a.x+a.y*a.y)+s.c.z,a.w);`;
    case "aex-octo":
      return `let a=s.v;s.v=vec4f(${p("xz_mul")}*a.x*a.z+s.c.x,${p("sq_mul")}*(a.z*a.z-a.x*a.x)+s.c.y,a.y+s.c.z,a.w);`;
    case "lambda-4dc":
      return `s.v=kernelCommutative(${v(["dx", "dy", "dz", "dw"])}-kernelCommutative(s.v,s.v),s.c);`;
    case "barnsley-4dnc":
      return `let k=${v(["dx", "dy", "dz", "dw"])};let a=s.v;var c=s.c;var selectedBranch=false;var b=vec4f(0.0);if(${on("tent_mode")}) {selectedBranch=a.x>=length(k)/2.0;if(selectedBranch) {b=2.0*(k-a+vec4f(0.0,0.0,0.0,${p("w_add")}));}else {b=2.0*a+vec4f(0.0,0.0,0.0,${p("w_add")});}}else {selectedBranch=a.x>=${p("thresold")};b=a+vec4f(0.0,0.0,0.0,${p("w_add")})+select(k,-k,selectedBranch);}if(selectedBranch) {if(${on("conj_mode")}) {c.y=-c.y;}if(${on("flip_mode")}) {c=vec4f(c.y,c.x,c.z,c.w);}}s.v=kernelHamilton(b,c);`;
    case "kalisets-1":
      return `let den=dot(s.v.xyz,s.v.xyz)+${p("fix")};if(den==0.0) {s.invalid=true;break;}s.v=vec4f(${p("scale")}/den*abs(s.v.xyz)+s.c.xyz,s.v.w);`;
    case "menger-hyper":
      return `let scale=${p("scale")};if(scale==0.0) {s.invalid=true;break;}var a=abs(s.v.xyz);let lo=${p("min_radius")}*${p("cent_rad_mul")};let hi=${p("max_radius")}*${p("cent_rad_mul")};let rr=dot(a,a);if(rr<=hi && max(rr,lo)==0.0) {s.invalid=true;break;}a=kernelSort3(kernelRadial(rr,lo,hi,false)*a);let center=${v(["x_inv", "y_inv", "z_inv"])};a+=center;let rr2=dot(a,a);if(rr2<${p("max_radius")} && max(rr2,${p("min_radius")})==0.0) {s.invalid=true;break;}a=kernelRadial(rr2,${p("min_radius")},${p("max_radius")},true)*a-center;if(${on("fold_again")}) {a=kernelSort3(a);}s.v=vec4f(kernelMenger(a,scale,${v(["cscale_x", "cscale_y", "cscale_z"])}),s.v.w);s.derivative*=scale;`;
    case "octahedron-4":
      return `var a=abs(s.v);${[
        [0, 1],
        [0, 2],
        [1, 3],
        [0, 3],
        [2, 3],
      ]
        .map(
          ([i, j]) =>
            `if(a[${i}]<a[${j}]) {let tmp=a[${i}];a[${i}]=a[${j}];a[${j}]=tmp;}`,
        )
        .join(
          "",
        )}let b=${m[0]}*vec4f(a.z,a.x,a.y,a.w);let scale=${p("scale")};s.v=scale*b-(scale-1.0)*${v(["cscale_x", "cscale_y", "cscale_z", "cscale_w"])};s.derivative*=scale;`;
    case "tglad-dihed":
      return `let mapped=kernelDihed(s.v,s.c,kernelPasses(${p("log2_power")}),kernelPasses(${p("log2_map_power")}));if(mapped.invalid) {s.invalid=true;break;}s.v=mapped.v;`;
    case "scherk-fs":
      return `let scale=${p("scale")};let apply=${on("apply_scale_add")};if(!apply && scale==0.0) {s.invalid=true;break;}let a=scale*s.v.xyz+${v(["x_add", "y_add", "z_add"])};let b=${m[0]}*a;let cx=cos(b.x);let cy=cos(b.y);if(cx==0.0 || cy==0.0) {s.invalid=true;break;}let ratio=abs(cx/cy);if(!(ratio>0.0) || !kernelFinite(ratio)) {s.invalid=true;break;}let logarithm=log2(ratio);if(!kernelFinite(logarithm)) {s.invalid=true;break;}let d=max(${p("saddle_strength")}*${p("log_base")}*logarithm-b.z,max(abs(b.x),max(abs(b.y),abs(b.z)))-1.5);if(apply) {s.v=vec4f(a,s.v.w);s.varyScale*=scale;s.field=d;}else {s.field=d/scale;}`;
    default:
      throw new Error(`Not a batch 02 kernel: ${id}`);
  }
}
