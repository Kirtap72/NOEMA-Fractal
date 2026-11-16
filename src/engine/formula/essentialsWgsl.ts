/** GPU equations independently authored from the authorized Essentials specifications. */
import type { KernelId } from "./kernels";
import { sourceKey } from "./essentialsKernels";
export const ESSENTIALS_PRIMITIVES_WGSL = /* wgsl */ `
fn essentialBox(t:f32,f:f32)->f32 {return abs(t+f)-abs(t-f)-t;}
fn essentialBox3(v:vec3f,f:f32)->vec3f {return abs(v+vec3f(f))-abs(v-vec3f(f))-v;}
fn essentialSphere(rr:f32,low:f32,k:f32,inner:f32)->f32 {if(rr<low){return inner/low;}if(rr<1.0){return k/rr;}return k;}
fn essentialSmooth(t:f32,s:f32)->f32 {if(s>=0.0){return sqrt(t*t+abs(s));}return abs(t)*abs(t)*abs(t)/(t*t+abs(s));}
fn essentialFastPow(t:f32,p:i32)->f32 {if(p<=1){return t;}var value=1.0;var base=t;var n=p;loop {if(n<=0){break;}if((n&1)!=0){value*=base;}base*=base;n=n>>1;}return value;}
fn essentialTriplex(a:vec3f,b:vec3f)->vec3f {let r=length(a.xy);let R=length(b.xy);if(r*R==0.0){return vec3f(-a.z*b.z,a.z*b.z,r*b.z+R*a.z);}let f=1.0-a.z*b.z/(r*R);return vec3f((a.x*b.x-a.y*b.y)*f,(a.y*b.x+a.x*b.y)*f,r*b.z+R*a.z);}
fn essentialVary(s:ptr<function,KernelOrbit>,scale:f32,vary:f32)->f32 {if((*s).firstIteration<=0.0){(*s).firstIteration+=1.0;(*s).first=(*s).firstIteration>0.0;(*s).varyScale=scale;}(*s).varyScale+=vary*(abs((*s).varyScale)-1.0);return (*s).varyScale;}
fn essentialNormPower(t:f32,p:f32,s:ptr<function,KernelOrbit>)->f32 {if(t==0.0){if(p<0.0){(*s).invalid=true;return 0.0;}return select(0.0,1.0,p==0.0);}let value=pow(t,p);if(!kernelFinite(value)){(*s).invalid=true;}return value;}
fn essentialAngle(a:f32,b:f32)->f32 {if(a==0.0&&b==0.0){return 0.0;}return atan2(a,b);}
fn essentialBilinearBeth(u:f32,v:f32,t:f32,C:f32)->f32 {let uu=u*u;let vv=v*v;let tt=t*t;return C-0.15625*u*(20.65247584249853*vv*vv-10.652475842498529*tt*tt-2.0*(30.0*vv*tt-(-10.652475842498529*vv+20.65247584249853*tt)*uu+uu*uu));}
fn essentialFoldAngle(a:f32,n:f32)->f32 {let h=3.141592653589793/n;return abs(a-max(0.0,ceil((a-h)/(2.0*h)))*2.0*h);}
fn essentialTetraStep(u:vec3f,R:mat3x3f,f:f32,tglad:bool,k:f32)->vec3f {var v=R*u;v.x=select(f-abs(v.x-f),essentialBox(v.x,f),tglad)*k;return transpose(R)*v;}
fn essentialMul32(a:u32,b:u32)->vec2u {
 let a0=a&65535u;let a1=a>>16u;let b0=b&65535u;let b1=b>>16u;
 let p0=a0*b0;let p1=a1*b0;let p2=a0*b1;
 let middle=(p0>>16u)+(p1&65535u)+(p2&65535u);
 return vec2u((p0&65535u)|(middle<<16u),a1*b1+(p1>>16u)+(p2>>16u)+(middle>>16u));
}
fn essentialHash(t:u32,r:i32,raw:u32)->u32 {let q=(t-bitcast<u32>(r))*t+raw;return ((q>>8u)^(q<<8u))&65535u;}
fn essentialWarpAngle(k:i32,v:vec3f)->f32 {
 let X=v.x;let Y=v.y;let Z=v.z;let x=abs(X);let y=abs(Y);let z=abs(Z);
 let pairs=array<vec2f,24>(vec2f(X,Y),vec2f(X,Z),vec2f(Y,X),vec2f(Y,Z),vec2f(Z,X),vec2f(Z,Y),vec2f(X,length(v.yz)),vec2f(Y,length(v.xz)),vec2f(Z,length(v.xy)),vec2f(length(v.yz),X),vec2f(length(v.xz),Y),vec2f(length(v.xy),Z),vec2f(X,max(y,z)),vec2f(Y,max(x,z)),vec2f(Z,max(x,y)),vec2f(max(y,z),X),vec2f(max(x,z),Y),vec2f(max(x,y),Z),vec2f(X,y),vec2f(Y,x),vec2f(Z,y),vec2f(y,X),vec2f(x,Y),vec2f(x,Z));
 return essentialAngle(pairs[k].x,pairs[k].y);
}
`;
export function essentialsBody(
  id: KernelId,
  p: (name: string) => string,
  m: string[],
): string {
  const P = (label: string) => p(sourceKey(label));
  const vec = (labels: string[]) =>
    `vec${labels.length}f(${labels.map(P).join(",")})`;
  const low = `pow(max(1e-40,${P("Min R")}),2.0)`;
  const vary = `essentialVary(&s,${P("Scale")},${P("Scale vary")})`;
  const xyz = (expr: string) => `s.v=vec4f(${expr},s.v.w);`;
  switch (id) {
    case "mb3d-folding1":
      return xyz(`essentialBox3(s.v.xyz,${P("R fold")})`);
    case "mb3d-folding2":
      return xyz(
        `s.v.xyz+abs(s.v.xyz-vec3f(2.0*${P("R fold")}))-abs(s.v.xyz-vec3f(${P("R fold")}))-vec3f(${P("R fold")})`,
      );
    case "mb3d-rotate":
      return xyz(`${m[0]}*s.v.xyz`);
    case "mb3d-rotate4d":
      return `s.v=${m[0]}*s.v;`;
    case "mb3d-rotatedfolding":
    case "mb3d-rotatedabs":
      return `var q=${m[0]}*s.v.xyz;q.x=${id === "mb3d-rotatedfolding" ? `essentialBox(q.x,${P("Fold of x")})` : `abs(q.x+${P("AddX")})-${P("SubX")}`};${xyz(`transpose(${m[0]})*q`)}`;
    case "mb3d-scaling":
      return `s.v*=${P("Scale")};`;
    case "mb3d-scalingplus":
      return `s.v*=${vec(["x scale", "y scale", "z scale", "w scale"])};`;
    case "mb3d-translate":
      return xyz(`s.v.xyz+${vec(["X add", "Y add", "Z add"])}`);
    case "mb3d-addc":
      return xyz(
        `s.v.xyz+s.c.xyz*${vec(["Cx multiplier", "Cy multiplier", "Cz multiplier"])}`,
      );
    case "mb3d-partlyjulia":
      return [..."XYZ"]
        .map(
          (a, i) =>
            `if(s.original[${i}]>${P(a + " above")}||s.original[${i}]<=${P(a + " below")}){s.c[${i}]=s.original[${i}]+${P(a + " add")};}`,
        )
        .join("\n");
    case "mb3d-partlyjuliar":
      return `
 let centre=${vec(["X Center", "Y Center", "Z Center"])};let seed=${vec(["X Seed", "Y Seed", "Z Seed"])};let q=s.v.xyz-centre;
 let shape=i32(round(${P("Shape")}));let rmax=${P("R Max")};let speed=${P("Speed (max 1)")};let recenter=${P("Recenter")};
 if(!(rmax>0.0)||speed<0.0||speed>1.0){s.invalid=true;break;}
 var metric=length(q);if(shape==1){metric=max(abs(q.x),max(abs(q.y),abs(q.z)));}else if(shape==2){if(q.z==0.0){s.invalid=true;break;}metric=sqrt(dot(q.xy,q.xy)/(q.z*q.z));}else if(shape==3){metric=length(q.xy);}else if(shape== -2){metric=rmax;if(q.z>0.0){metric=length(q.xy)/q.z;}}else if(shape==4){if(q.z==0.0){s.invalid=true;break;}metric=max(abs(q.x),abs(q.y))/abs(q.z);}else if(shape== -4){metric=rmax;if(q.z>0.0){metric=max(abs(q.x),abs(q.y))/abs(q.z);}}
 let radius=metric/rmax;var rc=0.0;var next=s.c.xyz;
 if(i32(round(${P("Inside mode")}))==1){if(radius<1.0){var t=radius-speed;if(t>0.0){t/=1.0-speed;next=t*next+(1.0-t)*seed;rc=recenter*(1.0-t);}else{next=seed;rc=recenter;}}}
 else {if(radius>=1.0){next=seed;}else{var t=radius-speed;if(t>0.0){t/=1.0-speed;next=(1.0-t)*(next-recenter*centre)+t*seed;rc=recenter*(1.0-t);}else{next-=recenter*centre;rc=recenter;}}}
 s.c=vec4f(next,s.c.w);${xyz("s.v.xyz-rc*centre")}`;
    case "mb3d-sphereinv":
      return `
 let centre=${vec(["X center", "Y center", "Z center"])};let q=s.v.xyz+centre;let rad=${P("Radius")};let divisor=select(1e-40,rad,abs(rad)>=1e-40);let rr=dot(q,q)/divisor;let mode=i32(round(${P("FoldMode (1 or 2)")}));let inner=${P("Rad2")};
 if(!(mode!=0&&rr>1.0)){var factor=0.0;if(rr<inner){if(mode==2){if(2.0*inner-rr==0.0){s.invalid=true;break;}factor=1.0/(2.0*inner-rr);}else{factor=1.0/max(1e-40,inner);}}else{if(rr==0.0){s.invalid=true;break;}factor=1.0/rr;}${xyz("factor*q-centre")}}`;
    case "mb3d-amazingbox":
    case "mb3d-amazingbox2":
    case "mb3d-amazing-surf":
    case "mb3d-aboxvaryscale":
    case "mb3d-aboxmodkali":
    case "mb3d-asurfmod1":
    case "mb3d-aboxvaryscale4d": {
      const scale = P("Scale"),
        f = id === "mb3d-amazingbox" ? "1.0" : P("Fold");
      const varying = [
        "mb3d-amazing-surf",
        "mb3d-aboxvaryscale",
        "mb3d-asurfmod1",
        "mb3d-aboxvaryscale4d",
      ].includes(id);
      const init = `let scale=${scale};let current=${varying ? vary : "scale"};`;
      if (id === "mb3d-amazingbox2")
        return `${init}
   let a=${P("FoldX, XZ angle")}*0.017453292519943295;let b=${P("FoldX, XY angle")}*0.017453292519943295;let v=s.v.xyz;
   var X=v.x*cos(a)-v.z*sin(a);let Z=v.x*sin(a)+v.z*cos(a);let Y=X*sin(b)+v.y*cos(b);X=essentialBox(X*cos(b)-v.y*sin(b),${f});X=(X*cos(b)-Y*sin(b))*cos(a)-Z*sin(a);
   let centre=${vec(["Inv xC", "Inv yC", "Inv zC"])};let q=vec3f(X,essentialBox(v.y,${f}),essentialBox(v.z,${f}))+centre;
   let ir=${P("Inv Radius")};let rr=dot(q,q)/select(1e-40,ir,abs(ir)>=1e-40);let factor=essentialSphere(rr,${low},scale,scale);
   s.v=vec4f(${m[0]}*(factor*q-scale*centre)+s.c.xyz,factor*s.v.w);`;
      if (id === "mb3d-aboxvaryscale4d")
        return `${init}let q=abs(s.v+vec4f(${f}))-abs(s.v-vec4f(${f}))-s.v;let raw=dot(q,q);let rr=essentialNormPower(raw,${P("R power")},&s);if(s.invalid){break;}let factor=essentialSphere(rr,${low},current,current);s.v=factor*q+s.c;s.v.w+=${P("W add")};s.derivative*=factor;`;
      const fold =
        id === "mb3d-aboxmodkali"
          ? `${vec(["X add", "Y add", "Z add"])}-abs(s.v.xyz)`
          : id === "mb3d-asurfmod1"
            ? `vec3f(${f}-abs(abs(s.v.x+${P("FoldXMod")})-${f})-abs(${P("FoldXMod")}),${f}-abs(abs(s.v.y+${P("FoldYMod")})-${f})-abs(${P("FoldYMod")}),s.v.z)`
            : id === "mb3d-amazing-surf"
              ? `vec3f(essentialBox(s.v.x,${f}),essentialBox(s.v.y,${f}),s.v.z)`
              : id === "mb3d-aboxvaryscale"
                ? `s.v.xyz`
                : `essentialBox3(s.v.xyz,${f})`;
      const branch =
        id === "mb3d-aboxvaryscale"
          ? `for(var axis=0;axis<3;axis++){if(q[axis]>=${f}){q[axis]=2.0*${f}-q[axis];}else if(q[axis]< -${f}){q[axis]=-2.0*${f}-q[axis];}}`
          : "";
      const rr =
        id === "mb3d-amazing-surf"
          ? `dot(q.xy,q.xy)+select(0.0,q.z*q.z,i32(round(${P("Sphere or Cylinder")}))==0)`
          : "dot(q,q)";
      const modifier =
        id === "mb3d-aboxvaryscale"
          ? `rr=essentialNormPower(rr,${P("R power")},&s);if(s.invalid){break;}`
          : id === "mb3d-asurfmod1"
            ? `rr*=${P("1/Radius")};`
            : "";
      const out =
        id === "mb3d-amazingbox"
          ? "factor*q"
          : id === "mb3d-amazing-surf"
            ? `${m[0]}*(factor*q+s.c.xyz)`
            : id === "mb3d-asurfmod1"
              ? `(${m[0]}*(factor*q.zyx)).zyx+s.c.yxz`
              : "factor*q+s.c.xyz";
      return `${init}var q=${fold};${branch}var rr=${rr};${modifier}let factor=essentialSphere(rr,${low},current,scale);s.v=vec4f(${out},factor*${id === "mb3d-aboxmodkali" ? "abs(s.v.w)" : "s.v.w"});`;
    }
    case "mb3d-aboxsmoothfold":
      return `
 let sharp=i32(round(${P("Sharpness (Integer 2+)")}));let ball=i32(round(${P("Sh. of BallFold (Int 3+)")}));if(sharp<0||ball<0){s.invalid=true;break;}var q=vec3f(0.0);
 for(var i=0;i<3;i++){let t=s.v[i];let a=abs(t);let rp=${P("Fix (BoxFold)")}*essentialFastPow(a,sharp);let denom=1.0+rp;if(denom==0.0){s.invalid=true;break;}q[i]=select(-1.0,1.0,t>=0.0)*(a+rp*(2.0*${P("Fold")}-a))/denom;}
 let current=${vary};let low=${low};var radius=1.0;if(low<0.99){let mid=(1.0+low)*0.5;let half=(1.0-low)*0.5;let d=dot(q,q)-mid;let t=abs(d)/half;let rp=${P("Fix (BallFold)")}*essentialFastPow(select(t,sqrt(t),(ball&1)!=0),select(ball/2,ball,(ball&1)!=0));if(rp+1.0==0.0){s.invalid=true;break;}radius=mid+select(-1.0,1.0,d>=0.0)*half*(rp+t)/(rp+1.0);}if(radius==0.0){s.invalid=true;break;}let factor=current/radius;s.v=vec4f(factor*q+s.c.xyz,factor*s.v.w);`;
    case "mb3d-menger3":
      return `var q=${m[0]}*abs(s.v.xyz);if(q.x<q.y){q=vec3f(q.y,q.x,q.z);}if(q.x<q.z){q=vec3f(q.z,q.y,q.x);}if(q.y<q.z){q=vec3f(q.x,q.z,q.y);}q=${m[1]}*q;let k=${P("Scale")};let d=k-1.0;var out=k*q-d*${vec(["CScale X", "CScale Y", "CScale Z"])};out.z=k*q.z;if(out.z>=0.5*${P("CScale Z")}*d){out.z-=${P("CScale Z")}*d;}s.v=vec4f(out,k*s.v.w);`;
    case "mb3d-mengersmt":
      return `let k=${P("Scale")};if(k==0.0){s.invalid=true;break;}let L=${P("LSmoothing (+-)")};let E=${P("ESmoothing (+-)")};var q=vec3f(essentialSmooth(s.v.x,L),essentialSmooth(s.v.y,L),essentialSmooth(s.v.z,L));${[
        [0, 1],
        [0, 2],
        [1, 2],
      ]
        .map(
          ([a, b]) =>
            `{let t=0.5*(q[${a}]-q[${b}]-essentialSmooth(q[${a}]-q[${b}],E));q[${a}]-=t;q[${b}]+=t;}`,
        )
        .join(
          "",
        )}q=${m[0]}*q;let d=k-1.0;let offset=${P("CScale Z")}*d/k;s.v=vec4f(k*q.x-${P("CScale X")}*d,k*q.y-${P("CScale Y")}*d,k*(offset-essentialSmooth(q.z-offset,L)),k*s.v.w);`;
    case "mb3d-foldingicosa":
      return xyz(`kernelGolden(abs(${m[0]}*s.v.xyz))`);
    case "mb3d-foldingtetra3d":
      return `var q=s.v.xyz;let first=i32(round(${P("Fold 1st half")}));let second=i32(round(${P("Fold 2nd half")}));${[
        [0, 1],
        [0, 2],
        [1, 2],
      ]
        .map(
          ([a, b]) =>
            `if(first!=0&&q[${a}]+q[${b}]<=0.0){let old=q;q[${a}]=-old[${b}];q[${b}]=-old[${a}];}`,
        )
        .join("")}${[
        [0, 1],
        [0, 2],
        [1, 2],
      ]
        .map(
          ([a, b]) =>
            `if((first==0||second!=0)&&q[${a}]-q[${b}]<=0.0){let old=q;q[${a}]=old[${b}];q[${b}]=old[${a}];}`,
        )
        .join("")}${xyz("q")}`;
    case "mb3d-generalquat":
      return `let a=s.v;var q=vec4f(a.x*a.x-a.y*a.y,2.0*a.x*a.y,2.0*a.x*a.z,2.0*a.x*a.w);${["IJ yz", "JI yz", "JJ zz", "IK yw", "KI yw", "JK zw", "KJ zw", "KK ww"].map((key, i) => `{let sel=i32(round(${P(key)}));let index=(abs(sel)-1)&3;q[index]+=select(-1.0,1.0,sel>0)*${["a.y*a.z", "a.y*a.z", "a.z*a.z", "a.y*a.w", "a.y*a.w", "a.z*a.w", "a.z*a.w", "a.w*a.w"][i]};}`).join("")}s.v=q+s.c;`;
    case "mb3d-commquat":
      return `let a=s.v;s.v=vec4f(${P("X mul")}*(a.x*a.x-a.y*a.y-2.0*a.z*a.w)+s.c.x,${P("Y mul")}*(2.0*a.x*a.y+a.z*a.z-a.w*a.w)+s.c.y,${P("Z mul")}*(2.0*a.x*a.z-2.0*a.y*a.w)+s.c.z,${P("W mul")}*(2.0*a.x*a.w+2.0*a.y*a.z)+${P("W add")}+s.c.w);`;
    case "mb3d-benesi1pow2":
      return `let a=s.v.xyz;let radius=length(a.yz);if(radius==0.0){s.invalid=true;break;}let k=2.0*a.x/radius;${xyz("vec3f(a.x*a.x-a.y*a.y-a.z*a.z+s.c.x,abs(s.c.y)-abs(k*(a.y*a.y-a.z*a.z)),abs(s.c.z)-abs(2.0*k*a.y*a.z))")}`;
    case "mb3d-beth1522":
      return `let a=s.v.xyz;${xyz("vec3f(essentialBilinearBeth(a.x,a.y,a.z,s.c.x),essentialBilinearBeth(a.y,a.z,a.x,s.c.y),essentialBilinearBeth(a.z,a.x,a.y,s.c.z))")}`;
    case "mb3d-magvsxyzabs3":
      return `let a=s.v.xyz;let rr=dot(a,a);let power=${P("Power")};let b=power*${P("Axiom 1")};let coeff=${vec(["CosShift", "CxM", "CyM"])};var q=vec3f(0.0);for(var i=0;i<3;i++){let t=a[i];let base=${P("Axiom 2")}*t*t+rr;if(!(base>0.0)){s.invalid=true;break;}q[i]=select(-1.0,1.0,t<0.0)*pow(base,power*0.5)*cos(power*essentialAngle(sqrt(rr),b*abs(t))+${P("CosShift")})+s.c[i]*coeff[i];}${xyz("q")}`;
    case "mb3d-ikenagabulb":
      return `let v=s.v.xyz;let C=s.c.xyz;let a=${vec(["a-x", "a-y", "a-z"])};let b=${vec(["b-x", "b-y", "b-z"])};let rr=dot(v.xy,v.xy);var f=0.0;if(rr!=0.0){f=1.0-3.0*v.z*v.z/rr;}let v3=vec3f(v.x*(v.x*v.x-3.0*v.y*v.y)*f,v.y*(3.0*v.x*v.x-v.y*v.y)*f,v.z*(3.0*rr-v.z*v.z));let q=essentialTriplex(v,a);var ac=essentialTriplex(q,C);let rho=length(q.xy);let RHO=length(C.xy);if(rho*RHO!=0.0){ac.y=(C.x*q.y+q.z*C.y)*(1.0-q.z*C.z/(rho*RHO));}let vb=essentialTriplex(v,b);${xyz("vec3f(v3.xy+ac.xy-vb.xy-C.xy,v3.z+ac.z)")}`;
    case "mb3d-mobiustpx":
      return `let v=s.v.xyz;let den=essentialTriplex(v,${vec(["c-x", "c-y", "c-z"])})+${vec(["d-x", "d-y", "d-z"])};let norm=dot(den,den);if(norm<=0.0){s.invalid=true;break;}let num=essentialTriplex(v,${vec(["a-x", "a-y", "a-z"])})+${vec(["b-x", "b-y", "b-z"])};let rho=length(num.xy);let RHO=length(den.xy);var out=vec3f(0.0);if(rho*RHO==0.0){out.x=num.z*den.z;out.y=-out.x;}else{let f=(1.0+num.z*den.z/(rho*RHO))/norm;out.x=(num.x*den.x+num.y*den.y)*f;out.y=(den.x*num.y-num.x*den.y)*f;}out.z=(RHO*num.z-rho*den.z)/norm;${xyz("out")}`;
    case "mb3d-tetrafolding-pow2": {
      const A = [
          [0, 2],
          [1, 2],
          [2, 0],
          [2, 1],
        ],
        B = [
          [0, 1],
          [1, 2],
          [1, 0],
          [2, 1],
        ],
        C = [
          [0, 2],
          [0, 1],
          [2, 0],
          [1, 0],
        ];
      const flip = (pairs: number[][]) =>
        pairs
          .map(([row, col]) => `R[${col}][${row}]=-R[${col}][${row}];`)
          .join("");
      return `var R=${m[0]};let f=${P("Fold")};let tglad=i32(round(${P("Tglad folding")}))==1;var q=essentialTetraStep(s.v.xyz,R,f,tglad,${P("Z mul 2")});let mode=i32(round(${P("Modes (0 to 3)")}));for(var j=0;j<3;j++){if(mode==0){if(j==1){${flip(B)}}else{${flip(A)}}}else if(mode==1){if(j==1){${flip(A)}}else{${flip(B)}}}else if(mode==2){if(j==1){${flip(B)}}else{${flip(C)}}}else{if(j==1){${flip(C)}}else{${flip(B)}}}q=essentialTetraStep(q,R,f,tglad,1.0);}let rr=dot(q.xy,q.xy)+${P("HRadius")};if(rr<0.0){${xyz("vec3f(0.0)")}}else if(rr==0.0){${xyz("s.c.xyz")}}else{let factor=${P("ZRadius")}-q.z*q.z/rr;${xyz(`vec3f((q.x*q.x-q.y*q.y)*${P("X mul")}*factor+s.c.x,q.x*q.y*${P("Y mul")}*factor+s.c.y,q.z*sqrt(rr)*${P("Z mul")}+s.c.z)`)}}`;
    }
    case "mb3d-polyfoldifs":
      return `let q=${m[0]}*(s.v.xyz+${vec(["Add X", "Add Y", "Add Z"])});let n=round(${P("PolyFold Order")});if(n==0.0){s.invalid=true;break;}let k=round((${P("Atan2 fixer")}-essentialAngle(q.y,q.x))*0.159154943*n);let a=k/n*6.283185307;${xyz("vec3f(q.x*cos(a)-q.y*sin(a),q.x*sin(a)+q.y*cos(a),q.z)")}`;
    case "mb3d-polyfolding":
    case "mb3d-ngon":
    case "mb3d-ngon2": {
      const init = `let n=${P("Order")};if(n==0.0){s.invalid=true;break;}let X=s.v.x+${P("Shift x")};let Y=s.v.y+${P("Shift y")};let t=(essentialAngle(Y,X)+(${P("Shift (deg)")}+${P("Skew (deg)")})*0.017453293)/6.283185307*n;let k=round(t);let a=-k/n*6.283185307+${P("Shift (deg)")}*0.017453293;`;
      if (id === "mb3d-polyfolding")
        return (
          init +
          `let old=s.v.xy;s.v.x=old.y*sin(a)-old.x*cos(a);s.v.y=old.x*sin(a)+old.y*cos(a);`
        );
      if (id === "mb3d-ngon")
        return (
          init +
          `var residual=t;if(i32(round(${P("No yfold")}))==0){residual=t-k;if((i32(k)&1)==0){residual=-residual;}}s.v.x=Y*sin(a)-X*cos(a)-${P("Shift x")};s.v.y=residual/n*6.283185307-${P("Shift y")};`
        );
      return (
        init +
        `var q=Y*cos(a)+X*sin(a);if((i32(k)&1)==0){q=-q;}s.v.x=q-${P("Shift x")};s.v.y=length(vec2f(X,Y))/n*6.283185307-${P("Shift y")};`
      );
    }
    case "mb3d-bstellahedron-f-sphere":
      return `let n=${P("Sides")};let n2=${P("Sides2")};if(!(n>0.0)||!(n2>0.0)){s.invalid=true;break;}let a=essentialFoldAngle(abs(essentialAngle(s.v.z,s.v.y)),n);let h=3.141592653589793/(2.0*n);let den=cos(h-${P("StellAngle")});if(den==0.0){s.invalid=true;break;}let factor=cos(h)*cos(a-${P("StellAngle")})/den;s.v.y*=factor;s.v.z*=factor;let b=essentialFoldAngle(abs(essentialAngle(length(s.v.yz),s.v.x)),n2);let h2=3.141592653589793/(2.0*n2);let den2=cos(h2-${P("StellAngle2")});if(den2==0.0){s.invalid=true;break;}let factor2=cos(h2)*cos(b-${P("StellAngle2")})/den2;${xyz("s.v.xyz*factor2")}`;
    case "mb3d-boxtiling":
      return [..."xyzw"]
        .map(
          (a, i) =>
            `{let size=${P(a + " size")};if(size!=0.0){s.v[${i}]-=round(s.v[${i}]/size)*size;}}`,
        )
        .join("");
    case "mb3d-gencwarp":
      return `let old=s.c.xyz;let q=${m[0]}*old;let thsel=i32(round(${P("Th(args 0-23)")}));let phsel=i32(round(${P("Ph(args 0-23)")}));let recipe=i32(round(${P("Recipe 0-2")}));if(thsel<0||thsel>23||phsel<0||phsel>23||recipe<0||recipe>2){s.invalid=true;break;}let th=essentialWarpAngle(thsel,q)*${P("Theta-AnglePow")};let ph=essentialWarpAngle(phsel,q)*${P("Phi-AnglePow")};let r=length(q);var next=vec3f(r*cos(th)*cos(ph),r*sin(th)*cos(ph),r*sin(ph));if(recipe==1){next=vec3f(r*cos(th)*sin(ph),r*sin(th)*sin(ph),r*cos(ph));}else if(recipe==2){next=vec3f(r*cos(th)*cos(ph),r*sin(th),r*cos(th)*sin(ph));}let t=${P("Strength (0 to 1)")};next=(1.0-t)*old+t*next;let xyzStrength=${P("Xyz-Strength (0 to 1)")};s.c=vec4f((1.0-xyzStrength)*next+xyzStrength*s.v.xyz,s.c.w);`;
    case "mb3d-randcubesifs":
      return `
 let scale=${P("Scale")};if(scale==0.0){s.invalid=true;break;}let k= -6.86656e-6;let q=scale*s.v.xyz+${vec(["X add", "Y add", "Z add"])};let apply=i32(round(${P("Apply scale+add")}))!=0;
 if(apply){s.v=vec4f(q,s.v.w);s.varyScale*=scale;}let rx=round(q.x);let ry=round(q.y);if(rx< -2147483648.0||rx>=2147483648.0||ry< -2147483648.0||ry>=2147483648.0){s.invalid=true;break;}
 var X=abs(q.x-rx);var Y=abs(q.y-ry);var Z=q.z;let tileU=bitcast<u32>(i32(rx))^0x9d81u;let tileV=bitcast<u32>(i32(ry))^0xb641u;let prod=essentialMul32(tileU,tileV);let raw=~prod.x;
 var B=(raw&0x5a5au)^(prod.y|0x5a5au);var A=(tileU&0x5a5au)^(tileV|0x5a5au);A=essentialHash(A,i32(round(${P("RandomizerX")})),raw);B=essentialHash(B,i32(round(${P("RandomizerY")})),raw);
 let H=((A>>6u)^(B<<6u))&65535u;let F=(A&0xaaaau)^(B&0x5555u);Z-=f32(F)*k*${P("ZFlight")};let dz=abs(Z)+f32(H)*k*${P("ZMaxSz")};s.free.x=f32(H)*1.5e-5;
 let vx=${P("XVtn (0-1)")};let vy=${P("YVtn (0-1)")};let shape=i32(round(select(${P("ShapeType 1")},${P("ShapeType 2")},(A&0x40u)!=0u)));let ax=f32(A)*k*vx+(1.0-vx)*(-0.45);let by=f32(B)*k*vy+(1.0-vy)*(-0.45);var d=0.0;
 if(shape==1){d=max(dz,length(vec2f(X,Y))+ax-f32(B)*k*vy*abs(Z));}
 else if(shape==2){let rad=X*X+Y*Y-Z*Z*f32(A)*(-1.37331e-5)*vx;if(rad<0.0){s.invalid=true;break;}d=max(dz,sqrt(rad)+by);}
 else if(shape==3){d=max(dz,max(X-f32(A)*k*vx*abs(Z),Y-f32(B)*k*vy*abs(Z))-0.45);}
 else if(shape==4){if(A>=B){let old=X;X=Y;Y=old;}let h=Z-f32(H)*k*${P("ZMaxSz")};let tmp=(h-abs(h))*(-0.45);d=max(Z,max(X+ax,sqrt(tmp*tmp+Y*Y)+by));}
 else if(shape==5){if(A>=B){let old=X;X=Y;Y=old;let oldA=A;A=B;B=oldA;}let fa=abs(f32(A)*(-3.1e-6)*vx);let fb=f32(B)*(-1.03e-5)*vy;let h=Z-f32(H)*k*${P("ZMaxSz")};let tmp=(h-abs(h))*(-0.45);let t=tmp*tmp;let rad=t+Y*Y+X*X+fa*fb*fb;if(rad<0.0){s.invalid=true;break;}d=max(Z,sqrt(rad)+sqrt(sqrt(t+X*X))*fb);}
 else if(shape==6){let fb=f32(B)*(-1.03e-5)*vy;let j=ax-fb;let terms=vec3f(X+j,Y+j,dz+j);let positive=(terms+abs(terms))*(-0.45);d=length(positive)+fb;}
 else{d=max(dz,max(X+ax,Y+by));}if(!apply){d/=scale;}s.field=d;`;
    default:
      throw new Error("Unknown Essentials shader " + id);
  }
}
