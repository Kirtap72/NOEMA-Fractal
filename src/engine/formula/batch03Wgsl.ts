import type { KernelId } from "./kernels";

export const BATCH_03_PRIMITIVES_WGSL = /* wgsl */ `
fn kernelBilinear(v:vec4f,a:vec4f,zw:f32,yw:f32,yz:f32)->vec4f {
  return vec4f(v.x*a.x-v.y*a.y-v.z*a.z-v.w*a.w+(v.z*a.w+v.w*a.z)*zw,
    v.x*a.y+v.y*a.x, v.x*a.z+v.z*a.x+(v.y*a.w+v.w*a.y)*yw,
    v.x*a.w+v.w*a.x+(v.y*a.z+v.z*a.y)*yz);
}
// Stable sinh for small positive radii; the caller still rejects r=0.
fn kernelSinh(r:f32)->f32 {
  if(r<=0.1) {let rr=r*r;return r*(1.0+rr*(1.0/6.0+rr*(1.0/120.0+rr*(1.0/5040.0+rr/362880.0))));}
  let e=exp(r);return 0.5*(e-1.0/e);
}
fn kernelQuaternionSine(v:vec4f,amplitude:f32)->KernelMapResult {
  let r=length(v.yzw);if(r==0.0) {return KernelMapResult(v,true);}
  let e=exp(r);let ch=0.5*(e+1.0/e);let f=amplitude*cos(v.x)*kernelSinh(r)/r;
  return KernelMapResult(vec4f(amplitude*sin(v.x)*ch,f*v.yzw),false);
}
fn kernelDirectionAngle(numerator:f32,denominator:f32)->f32 {
  if(numerator==0.0 && denominator==0.0) {return 0.0;}
  return atan2(numerator,denominator);
}
fn kernelDifsAffine(v:vec3f,scale:f32,offset:vec3f)->vec3f {return scale*v+offset;}
fn kernelDifsCommit(input:KernelOrbit,q:vec3f,scale:f32,apply:bool,field:f32)->KernelOrbit {
  var s=input;s.field=field;
  if(apply) {s.v=vec4f(q,s.v.w);s.varyScale*=scale;} else {s.field/=scale;}
  return s;
}
`;

/** Formula mathematics only; all output RHS read the old input unless explicitly recursive. */
export function batch03Body(
  id: KernelId,
  p: (name: string) => string,
  m: string[],
): string {
  const on = (key: string) => `round(${p(key)})!=0.0`;
  const v = (keys: string[]) => `vec${keys.length}f(${keys.map(p).join(",")})`;
  switch (id) {
    case "faehrten":
      return `let old=s.v;
      s.v=vec4f(old.x*(${p("y_multiplier")}*old.y+${p("z_multiplier")}*old.z)+s.c.x,
      old.y*old.y+${p("squares_multiplier")}*(old.x*old.x+old.z*old.z)+${p("twist")}*old.x*old.z+s.c.y,
      old.z*old.z+${p("squares_multiplier")}*(old.x*old.x+old.y*old.y)+${p("twist")}*old.x*old.y+s.c.z,old.w);`;
    case "mandel-4d-bic":
      return `let old=s.v;
      s.v=vec4f(old.x*old.x-old.y*old.y,2.0*old.x*old.y,old.z*old.z-old.w*old.w,2.0*old.z*old.w)+s.c+vec4f(0,0,0,${p("w_add")});`;
    case "hyperd-1":
      return `var n=round(${p("int_power")});if(n<1.0 || n>16.0) {n=2.0;}
      let old=s.v;var accumulator=old+vec4f(0,0,0,${p("w_add")});
      for(var k=0;k<max(1,i32(n)-1);k++) {accumulator=kernelBilinear(old,accumulator,${p("zw_mul")},${p("yw_mul")},${p("yz_mul")});}
      s.v=accumulator+s.c;`;
    case "makin-4d-p2a":
      return `let old=s.v;let aa=dot(old.xy,old.xy);let bb=dot(old.zw,old.zw);
      if(aa==0.0 && bb==0.0) {s.invalid=true;break;}
      var pair=old.zw;var k=0.0;if(bb<aa) {pair=old.xy;k=1.0-bb/aa;} else {k=aa/bb-1.0;}
      s.v=vec4f((pair.x*pair.x-pair.y*pair.y)*k,2.0*pair.x*pair.y*k,
      2.0*(old.x*old.z-old.y*old.w),2.0*(old.x*old.w+old.y*old.z))+s.c+vec4f(0,0,0,${p("w_add")});`;
    case "sin-4d-plus":
      return `let next=kernelQuaternionSine(s.v+${v(["px", "py", "pz", "pw"])},${p("a")});
      if(next.invalid) {s.invalid=true;break;}s.v=next.v;`;
    case "riemann-2":
      return `let rotated=${m[0]}*s.v.xyz;let radius=length(rotated);
      if(radius==0.0) {s.invalid=true;break;}
      let sphere=rotated*(${p("scale")}/radius);let denominator=1.0-sphere.x;
      var factor=1.0;if(denominator>${p("smallest_value")}) {factor=1.0/denominator;}
      let st=sphere.zy*factor;let exponent=${p("rpow")}*(1.0+dot(st,st));
      let folded=abs(abs(sin(3.1415926535898*st+${v(["s_shift", "t_shift"])}))+vec2f(${p("sin_add_fold")}));
      let radial=pow(radius,exponent)+${p("r_shift")};let h=2.0/(1.0+dot(folded,folded));
      s.v=vec4f(radial*(1.0-h)+${p("x_shift")},radial*folded.y*h,radial*folded.x*h,s.v.w);`;
    case "torus-ellip-ifs":
    case "klein-bagel-ifs":
    case "helix-ifs": {
      const begin = `let scale=${p("scale")};if(scale==0.0) {s.invalid=true;break;}
        let q=kernelDifsAffine(s.v.xyz,scale,${v(["x_add", "y_add", "z_add"])});var field=0.0;`;
      let shape: string;
      if (id === "torus-ellip-ifs")
        shape = `var rho=length(q.xy);if(${on("boxy_xy")}) {rho=max(abs(q.x),abs(q.y));}
        let radial=rho-${p("radius_1")};var outer=length(vec2f(radial,q.z));
        if(${on("boxy_z")}) {outer=max(abs(radial),abs(q.z));}
        field=outer-${p("radius_2")}+q.x*${p("elliptic")};`;
      else if (id === "klein-bagel-ifs")
        shape = `let theta=0.5*round(${p("mobius")})*kernelDirectionAngle(q.x,q.y);
        let sn=sin(theta);let cs=cos(theta);let xa=q.x*${p("aspect_ratio")};var rho=length(vec2f(xa,q.y));
        if(${on("boxy_xy")}) {rho=max(abs(xa),abs(q.y));}
        let radial=rho-${p("radius_1")};let uu=radial*sn-q.z*cs;let hh=radial*cs+q.z*sn;
        let hs=hh*hh;field=0.5*sqrt(abs(hs*hs-hs+uu*uu))-${p("radius_2")};`;
      else
        shape = `let coord=round(${p("coord")});var plane=vec3f(q.z,q.y,q.x);
        if(coord==0.0) {plane=q;} else if(coord==1.0) {plane=vec3f(q.y,q.x,q.z);}
        let strands=((i32(round(${p("helix_count")}))-1)&15)+1;
        var delta=3.141592653589793;if(strands>2) {delta=6.283185307179586/f32(strands);}
        var angle=plane.x*${p("helix_stretch")};field=10000.0;
        for(var k=0;k<strands;k++) {
          let center=vec2f(${p("diameter_2")}*cos(angle),${p("diameter_1")}*sin(angle));
          field=min(field,length(plane.yz-center));angle+=delta;
        }field-=${p("string_radius")};`;
      return `${begin}${shape}s=kernelDifsCommit(s,q,scale,${on("apply_scale_add")},field);`;
    }
    case "hopalong":
      return `let old=s.v;let t=${p("beta")}*old.x-${p("gamma")}*old.z+${p("delta")};
      let h=sqrt(abs(t));let xx=select(old.y-h,old.y+h,t>0.0);
      s.v=vec4f(xx,(${p("alpha")}-old.x)*${p("strength")},old.z+(${p("alpha")}*old.y-${p("beta")}*old.x)*${p("epsilon")},old.w);`;
    default:
      throw new Error(`Not a batch 03 kernel: ${id}`);
  }
}
