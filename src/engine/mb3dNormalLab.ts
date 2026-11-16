/** GEO3C only. Own symmetric slope quadrature for the observed native S5
 * normal policy. Central offsets and tangent sampling are separate from hits.
 * The symmetric +/- sums cancel the native common mean analytically; native
 * roughness/SI/color reconstruction is deliberately not implied by this pass.
 * Reference: pinned Calc.RMCalculateNormals 776-904; independent Householder
 * tangent construction replaces the original trigonometric construction.
 */
type V=[number,number,number];
const dot=(a:V,b:V)=>a.reduce((sum,x,i)=>sum+x*b[i]!,0);
const unit=(a:V):V=>{const size=Math.hypot(...a);return size>0?a.map(x=>x/size) as V:[0,0,-1];};
export function nativeFiveNormal(field:(p:V)=>number,p:V,h:number,axes:V[]):{normal:V;queries:number} {
 if(!(h>0&&Number.isFinite(h))||axes.length!==3)throw Error('Finite positive native normal footprint and three axes required');
 let queries=0;
 const sample=(v:V,k:number)=>{queries++;return field(p.map((x,i)=>x+k*v[i]!) as V);};
 const gradient=axes.map(axis=>.5*(sample(axis,h)-sample(axis,-h))) as V,n=unit(gradient);
 const reflect=(axis:V):V=>{const v=[n[0],n[1],n[2]-1] as V,d=dot(v,v);return d>1e-24?axis.map((x,i)=>x-2*v[i]!*dot(v,axis)/d) as V:axis;};
 const tangents=[reflect([1,0,0]),reflect([0,1,0])];
 const step=h*12/11;
 const slopes=tangents.map(tangent=>{
   const world=[0,1,2].map(i=>tangent.reduce((sum,x,j)=>sum+x*axes[j]![i]!,0)) as V;
   let sum=0;for(let k=1;k<=5;k++)sum+=(sample(world,k*step)-sample(world,-k*step))/k;
   return sum*h/(10*step);
 });
 const camera=unit([gradient[0]+slopes[0]!,gradient[1]+slopes[1]!,gradient[2]]);
 return {normal:unit([0,1,2].map(i=>camera.reduce((sum,x,j)=>sum+x*axes[j]![i]!,0)) as V),queries};
}
export function nativeFiveShader(axes:number[][],stepWidth:number,deStop:number,adaptFactor:number):string {
 const f=(x:number)=>x.toExponential(16);
 const matrix='mat3x3f('+axes.map(a=>'vec3f('+a.map(f).join(',')+')').join(',')+')';
 return `
 fn geoFiveSample(offset:vec3f,t:f32)->f32{
  var p=geoDSPosition;p.x=dsA(p.x,vec2f(offset.x,0.0));p.y=dsA(p.y,vec2f(offset.y,0.0));p.z=dsA(p.z,vec2f(offset.z,0.0));
  let value=geoDSNative(p,geoNativeGoal(t)*1.03);return value.d.x+value.d.y;
 }
 fn geoFiveTangent(n:vec3f,axis:vec3f)->vec3f{
  let v=n-vec3f(0.0,0.0,1.0);let d=dot(v,v);if(d<1e-20){return axis;}return axis-2.0*v*dot(v,axis)/d;
 }
 fn geoFiveNormal(p:vec3f,t:f32)->vec3f{
  let basis=${matrix};let h=${f(stepWidth*Math.min(1,deStop)*.15)}*(1.0+t/${f(stepWidth)}*${f(adaptFactor)});
  var g=vec3f(0.0);for(var k=0u;k<3u;k++){g[k]=0.5*(geoFiveSample(basis[k]*h,t)-geoFiveSample(-basis[k]*h,t));}
  if(!(dot(g,g)>0.0)){return geoMicroNormal(p,t);}let n=normalize(g);
  let tx=basis*geoFiveTangent(n,vec3f(1.0,0.0,0.0));let ty=basis*geoFiveTangent(n,vec3f(0.0,1.0,0.0));let step=h*(12.0/11.0);
  var slopes=vec2f(0.0);for(var k=1u;k<=5u;k++){
   let distance=f32(k)*step;
   slopes.x+=(geoFiveSample(tx*distance,t)-geoFiveSample(-tx*distance,t))/f32(k);
   slopes.y+=(geoFiveSample(ty*distance,t)-geoFiveSample(-ty*distance,t))/f32(k);
  }
  let corrected=g+vec3f(slopes*h/(10.0*step),0.0);
  return normalize(basis*corrected);
 }
 `;
}
