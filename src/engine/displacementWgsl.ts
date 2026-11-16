/** Opt-in analytical-object adapter. Legacy source is returned untouched by buildShader. */
const geometry=/* wgsl */`
struct DisplacementRecord {map:vec4f,limits:vec4f,transform:vec4f};
@group(0) @binding(16) var<storage,read> displacements:array<DisplacementRecord,32>;
fn geometryEnabled(index:i32)->bool {if(index<0||index>=32){return false;}return displacements[u32(index)].map.x>0.5;}
fn geometrySample(d:DisplacementRecord,uv:vec2f)->f32{
 let c=cos(d.transform.y);let s=sin(d.transform.y);
 let coord=vec2f(c*uv.x-s*uv.y,s*uv.x+c*uv.y)*d.transform.x+d.transform.zw;
 return detailSample(d.map.y,coord,0.0).r;
}
fn geometryField(q:vec3f,d:DisplacementRecord)->f32{
 var base=q.y;var height=0.0;
 if(d.limits.w==1.0){
  let radius=length(q);base=radius-1.0;var n=vec3f(0,1,0);if(radius>1e-12){n=q/radius;}
  var w=n*n*n*n;w/=w.x+w.y+w.z;
  for(var k=0;k<3;k++){let chart=detailChart(k,select(-1.0,1.0,n[k]>=0.0));height+=w[k]*geometrySample(d,vec2f(dot(n,chart[0]),dot(n,chart[1])));}
 }else{height=geometrySample(d,vec2f(q.x,-q.z));}
 return base-d.map.z*(height-d.map.w);
}
fn geometryDistance(q:vec3f,d:DisplacementRecord)->f32{
 let f=geometryField(q,d);var distance=abs(f)/d.limits.x;
 if(d.limits.w==1.0&&length(q)<1.0-d.map.z){distance=1.0-d.map.z-length(q);}
 // A plane is a two-sided open sheet, not a solid negative half-space for AO.
 return select(distance,-distance,f<0.0&&d.limits.w==1.0)*d.limits.z;
}
fn displacedDistance(p:vec3f,index:i32)->f32{
 if(!geometryEnabled(index)){return legacyPrimitiveDistance(p,index);}
 let object=primitiveStore.objects[u32(index)];let q=vec3f(dot(object.inverse[0],vec4f(p,1)),dot(object.inverse[1],vec4f(p,1)),dot(object.inverse[2],vec4f(p,1)));
 return geometryDistance(q,displacements[u32(index)]);
}
fn displacedHit(index:i32,origin:vec3f,dir:vec3f,near:f32,far:f32)->SceneHit{
 if(!geometryEnabled(index)){return legacyPrimitiveHit(index,origin,dir,near,far);}
 let object=primitiveStore.objects[u32(index)];var miss=emptySceneHit(far);if(object.identity.x<0.5){return miss;}
 let d=displacements[u32(index)];
 let o=vec3f(dot(object.inverse[0],vec4f(origin,1)),dot(object.inverse[1],vec4f(origin,1)),dot(object.inverse[2],vec4f(origin,1)));
 let v=vec3f(dot(object.inverse[0].xyz,dir),dot(object.inverse[1].xyz,dir),dot(object.inverse[2].xyz,dir));
 var low=max(near,1e-7);var high=far;
 if(d.limits.w==1.0){
  let a=dot(v,v);if(a<=0.0){return miss;}let center=-dot(o,v)/a;let closest=o+v*center;
  let radius=1.0+d.map.z;let chord=radius*radius-dot(closest,closest);if(chord<0.0){return miss;}
  let half=sqrt(chord/a);low=max(low,center-half);high=min(high,center+half);
 }else{
  if(abs(v.y)<1e-12){if(abs(o.y)>d.map.z){return miss;}}
  else{let a=(-d.map.z-o.y)/v.y;let b=(d.map.z-o.y)/v.y;low=max(low,min(a,b));high=min(high,max(a,b));}
 }
 if(low>high){return miss;}
 var t=low;var previous=t;var previousF=geometryField(o+v*t,d);var steps=0;var found=false;var epsilon=0.0;
 // Geometry is never paused by Navigate. Finite budget is independent of lighting/viewport quality.
 for(var j=0;j<256;j++){
  if(t>high){break;}steps=j+1;let world=origin+dir*t;let q=o+v*t;let f=geometryField(q,d);
  if(!(abs(f)<1e18)){return miss;}
  epsilon=max(precisionFloor(world),min(hitThreshold(t,world),0.0001*d.limits.y));
  if(j>0&&f*previousF<0.0){
   var lo=previous;var hi=t;var flo=previousF;
   for(var k=0;k<16;k++){let mid=(lo+hi)*.5;let fm=geometryField(o+v*mid,d);if(flo*fm<=0.0){hi=mid;}else{lo=mid;flo=fm;}}
   t=(lo+hi)*.5;found=true;break;
  }
  // This is a field residual in world units, NOT the divided marching bound.
  if(abs(f)*d.limits.y<=epsilon){found=true;break;}
  let distance=abs(geometryDistance(q,d));let next=t+distance*.9;
  if(!(next>t)||!(next<1e29)){miss.exhausted=true;return miss;}
  previous=t;previousF=f;t=next;
 }
 if(!found){miss.steps=steps;miss.exhausted=t<=high;return miss;}
 let q=o+v*t;let h=max(1e-5,min(.001,.25/(f32(textureDimensions(surfaceTex).x)*d.transform.x)));
 let n=vec3f(geometryField(q+vec3f(h,0,0),d)-geometryField(q-vec3f(h,0,0),d),geometryField(q+vec3f(0,h,0),d)-geometryField(q-vec3f(0,h,0),d),geometryField(q+vec3f(0,0,h),d)-geometryField(q-vec3f(0,0,h),d));
 let covector=object.inverse[0].xyz*n.x+object.inverse[1].xyz*n.y+object.inverse[2].xyz*n.z;
 if(!(length(covector)>1e-20)||!(length(covector)<1e18)){return miss;}
 return SceneHit(origin+dir*t,t,normalize(covector),epsilon,steps,true,false,i32(object.identity.y),i32(object.identity.z),i32(object.identity.w),index);
}
fn primitiveHit(index:i32,origin:vec3f,dir:vec3f,near:f32,far:f32)->SceneHit{return displacedHit(index,origin,dir,near,far);}
fn primitiveDistance(p:vec3f,index:i32)->f32{return displacedDistance(p,index);}
`;
export function integrateDisplacementShader(shader:string):string{
 for(const name of ['primitiveHit','primitiveDistance']){const anchor=`fn ${name}(`;if(!shader.includes(anchor))throw Error('Displacement needs native geometry: '+name);shader=shader.replace(anchor,`fn legacy${name[0]!.toUpperCase()+name.slice(1)}(`);}
 return shader+'\n'+geometry;
}
