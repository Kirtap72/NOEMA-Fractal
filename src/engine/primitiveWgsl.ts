/** Exact analytical intersections; the local ray keeps world t even under non-uniform scale. */
import {transmissionWgsl} from './transmissionWgsl';
export const primitiveQueryWgsl=/* wgsl */ `
struct Primitive {inverse:array<vec4f,3>, identity:vec4f, color:vec4f, material:vec4f, properties:array<vec4f,30>,extras:array<vec4f,4>};
struct PrimitiveStore {count:vec4f, objects:array<Primitive,32>};
@group(0) @binding(10) var<storage,read> primitiveStore:PrimitiveStore;
struct SceneHit {position:vec3f,distance:f32,normal:vec3f,epsilon:f32,steps:i32,hit:bool,exhausted:bool,objectType:i32,objectId:i32,materialId:i32,index:i32};
var<private> surfaceIndex:i32=-1;
fn emptySceneHit(far:f32)->SceneHit{return SceneHit(vec3f(0.0),far,vec3f(0.0),0.0,0,false,false,0,0,0,-1);}
fn primitiveHit(index:i32,origin:vec3f,dir:vec3f,near:f32,far:f32)->SceneHit{
 let p=primitiveStore.objects[u32(index)];var result=emptySceneHit(far);if(p.identity.x<0.5){return result;}
 let o=vec3f(dot(p.inverse[0],vec4f(origin,1.0)),dot(p.inverse[1],vec4f(origin,1.0)),dot(p.inverse[2],vec4f(origin,1.0)));
 let d=vec3f(dot(p.inverse[0].xyz,dir),dot(p.inverse[1].xyz,dir),dot(p.inverse[2].xyz,dir));
 let kind=i32(p.identity.y);var enter=1e30;var exit=1e30;
 if(kind==1){
  // Closest approach avoids subtracting two O(distance^2) terms in a far-away Float32 discriminant.
  let a=dot(d,d);if(a==0.0){return result;}let center=-dot(o,d)/a;let closest=o+d*center;
  let chord=1.0-dot(closest,closest);if(chord<0.0){return result;}
  let half=sqrt(chord/a);enter=center-half;exit=center+half;
 }else if(kind==3){
  if(abs(d.y)<1e-12){return result;}enter=-o.y/d.y;exit=enter;
 }else{
  enter=-1e30;exit=1e30;
  for(var k=0u;k<3u;k++){
   if(abs(d[k])<1e-12){if(abs(o[k])>1.0){return result;}}
   else{let a=(-1.0-o[k])/d[k];let b=(1.0-o[k])/d[k];enter=max(enter,min(a,b));exit=min(exit,max(a,b));}
  }
  if(enter>exit){return result;}
 }
 let low=max(near,1e-7);let t=select(exit,enter,enter>=low);if(t<low||t>far||t>=1e29){return result;}
 let local=o+d*t;var n=local;
 if(kind==3){n=vec3f(0.0,1.0,0.0);}else if(kind==2){var k=0u;if(abs(local.y)>abs(local.x)){k=1u;}if(abs(local.z)>abs(local[k])){k=2u;}n=vec3f(0.0);n[k]=sign(local[k]);}
 let normal=normalize(p.inverse[0].xyz*n.x+p.inverse[1].xyz*n.y+p.inverse[2].xyz*n.z);
 result=SceneHit(origin+dir*t,t,normal,precisionFloor(origin+dir*t),0,true,false,kind,i32(p.identity.z),i32(p.identity.w),index);return result;
}
// Analytic candidates are tested once per ray, not once per fractal marching step.
fn queryPrimitives(origin:vec3f,dir:vec3f,near:f32,far:f32)->SceneHit{
 var best=emptySceneHit(far);if(near>far){return best;}
 for(var i=0;i<i32(primitiveStore.count.x);i++){let candidate=primitiveHit(i,origin,dir,near,best.distance);if(candidate.hit&&(!best.hit||candidate.distance<best.distance)){best=candidate;}}
 return best;
}
fn objectMaterialData(k:u32)->vec4f{
 if(surfaceIndex>=0&&primitiveStore.objects[u32(surfaceIndex)].identity.w>0.0){return primitiveStore.objects[u32(surfaceIndex)].extras[k];}return u.matdata[k];
}
fn materialActive()->bool{
 if(surfaceIndex>=0&&primitiveStore.objects[u32(surfaceIndex)].identity.w>0.0){return primitiveStore.objects[u32(surfaceIndex)].material.x>0.5;}return u.mata.x>0.5;
}
fn objectBaseColor(core:vec3f,p:vec3f,n:vec3f,steps:i32)->vec3f{
 if(surfaceIndex>=0){return primitiveStore.objects[u32(surfaceIndex)].color.rgb;}return surfaceBaseColorWith(core,p,n,steps);
}
fn objectMatValue(k:i32,core:vec3f,p:vec3f,n:vec3f,steps:i32)->f32{
 if(surfaceIndex<0||primitiveStore.objects[u32(surfaceIndex)].identity.w==0.0){return matValue(k,core,p,n,steps);}
 let material=primitiveStore.objects[u32(surfaceIndex)];let base=u32(k*10);let head=material.properties[base];
 if(head.y< -0.5){return head.x;}
 var which=i32(head.y+0.5);if(which==5){which=i32(u.color.x+0.5);}
 var t=measureValue(which,core,p,n,steps)*head.z+head.w;
 if(material.properties[base+1u].x>0.5){let m=t-2.0*floor(t*0.5);t=1.0-abs(1.0-m);}else{t=fract(t);}
 let f=clamp(t,0.0,1.0)*31.0;let i=u32(floor(f));let j=min(i+1u,31u);
 return mix(material.properties[base+2u+(i>>2u)][i&3u],material.properties[base+2u+(j>>2u)][j&3u],f-floor(f));
}
fn primitiveDistance(p:vec3f,index:i32)->f32{
 let object=primitiveStore.objects[u32(index)];let local=vec3f(dot(object.inverse[0],vec4f(p,1.0)),dot(object.inverse[1],vec4f(p,1.0)),dot(object.inverse[2],vec4f(p,1.0)));
 var d=abs(local.y);
 if(object.identity.y==1.0){d=length(local)-1.0;}else if(object.identity.y==2.0){let q=abs(local)-vec3f(1.0);d=length(max(q,vec3f(0.0)))+min(max(q.x,max(q.y,q.z)),0.0);}
 return d*object.color.w;
}
fn sceneOcclusionDistance(p:vec3f)->f32{
 var d=formulaDistance(p);for(var i=0;i<i32(primitiveStore.count.x);i++){if(primitiveStore.objects[u32(i)].identity.x>0.5){d=min(d,primitiveDistance(p,i));}}return d;
}
`;

/** Reuses the established field marcher, with an analytical upper bound. kind 0 = camera; 1 = secondary. */
function sceneQueryWgsl(thresholdCore:boolean):string{return /* wgsl */ `
fn queryScene(origin:vec3f,dir:vec3f,kind:i32)->SceneHit{
 let secondary=kind==1;let distanceLimit=select(u.march.w,u.reflection.z,secondary);
 let interval=clipInterval(origin,dir,distanceLimit);let analytic=queryPrimitives(origin,dir,interval.x,interval.y);
 let far=select(interval.y,min(interval.y,analytic.distance),analytic.hit);var t=interval.x;var steps=0;var hit=false;
 let clipped=any(u.clipFlags.xyz>vec3f(0.5));var escape=false;var previous=t;
 let budget=select(i32(u.march.z),i32(u.reflection.y),secondary);var epsilon=0.0;
 for(var i=0;i<budget;i++){
  if(t>far){break;}steps=i;let p=origin+dir*t;epsilon=select(primaryHitThreshold(t,p),secondaryEpsilon(t,p),secondary);
  let raw=${thresholdCore?'formulaCoreAtThreshold(p,epsilon).x':'formulaDistance(p)'};
  if(!(abs(raw)<1e18)){t=far+1.0;break;}
  let d=select(select(raw,abs(raw),clipped),abs(raw),secondary);
  if(i==0&&interval.x>0.0&&clipped&&raw>=0.0&&raw<epsilon){escape=true;}
  if(escape){
   if(raw>epsilon){var lo=previous;var hi=t;for(var j=0;j<8;j++){let mid=(lo+hi)*0.5;if(formulaDistance(origin+dir*mid)>epsilon){hi=mid;}else{lo=mid;}}t=hi;hit=true;break;}
   previous=t;t+=select(max(epsilon*2.0,normalStep(t,p)),epsilon*2.0,secondary);continue;
  }
  if(d<epsilon){hit=true;break;}t+=d*u.march.y;
 }
 if(hit&&(!analytic.hit||t<analytic.distance)){
  let p=origin+dir*t;let step=select(primaryNormalStep(t,p),max(precisionFloor(p),min(normalStep(t,p),epsilon)),secondary);
  return SceneHit(p,t,sceneNormal(p,step),epsilon,steps,true,false,0,0,0,-1);
 }
 if(analytic.hit){return analytic;}
 var miss=emptySceneHit(t);miss.steps=steps;miss.exhausted=t<=interval.y;return miss;
}
`;}

/** Only the scene-object shader variant changes. The zero-object shader stays byte-for-byte unchanged. */
export function integratePrimitiveShader(shader:string,thresholdCore:boolean,transport=true):string{
 const primaryStart=shader.indexOf('  let interval = clipInterval(origin, dir, u.march.w);',shader.indexOf('fn fs('));
 const primaryEnd=shader.indexOf('  // A ray that neither hit',primaryStart);
 if(primaryStart<0||primaryEnd<0)throw Error('Primary scene query anchor missing');
 shader=shader.slice(0,primaryStart)+`  let sceneHit=queryScene(origin,dir,0);
  surfaceIndex=sceneHit.index;
  let interval=clipInterval(origin,dir,u.march.w);
  let clipped=any(u.clipFlags.xyz>vec3f(0.5));
  let t=sceneHit.distance;let hit=sceneHit.hit;let steps=sceneHit.steps;
`+shader.slice(primaryEnd);
 shader=shader.replace('let outward = sceneNormal(p, primaryNormalStep(t, p));','let outward = sceneHit.normal;');
 shader=shader.replace('let n = softenedNormal(p, rawNormal, primaryNormalStep(t, p));','var n=rawNormal;if(surfaceIndex<0){n=softenedNormal(p,rawNormal,primaryNormalStep(t,p));}');
 // Double-sided/inside shading and layer normals follow the existing view-facing open-surface convention.
 shader=shader.replace('clipped && dot(outward, dir) > 0.0','(clipped || surfaceIndex>=0) && dot(outward, dir) > 0.0');
 shader=shader.replace('  let core = formulaCore(p);','  var core=vec3f(0.0);if(surfaceIndex<0){core=formulaCore(p);}');
 // Existing fractal heuristic is not applied to exact analytical geometry.
 shader=shader.replace('(i32(u.view.w) & 2) != 0 || u.ao.w', 'surfaceIndex>=0 || (i32(u.view.w) & 2) != 0 || u.ao.w');
 shader=shader.replace('fn materialData(k:u32)->vec4f{return u.matdata[k];}','fn materialData(k:u32)->vec4f{return objectMaterialData(k);}')
 shader=shader.replaceAll('u.mata.x > 0.5','materialActive()').replaceAll('u.mata.x>0.5','materialActive()');
 shader=shader.replaceAll('clamp(matValue(', 'clamp(objectMatValue(').replace('surfaceBaseColorWith(core, p, n, steps)*materialData(0u).rgb','objectBaseColor(core,p,n,steps)*materialData(0u).rgb');
 shader=shader.replace('  lit *= cavityResponse(p, n, u.cavity, hitThreshold(t, p));','  if(surfaceIndex<0){lit *= cavityResponse(p,n,u.cavity,hitThreshold(t,p));}');
 // The shared analytical query also bounds shadow visibility. Primitive penumbra is deliberately hard in Phase 1.
 shader=shader.replace('  var t = max(hit * 2.0, interval.x);','  let analytic=queryPrimitives(origin,dir,max(hit*2.0,interval.x),interval.y);if(analytic.hit){return 0.0;}\n  var t = max(hit * 2.0, interval.x);');
 // AO sees the union's contact field; local cavity/bevel remain fractal-only.
 const detailStart=shader.indexOf('fn detailVisibility('),detailEnd=shader.indexOf('fn cavityResponse(',detailStart);
 shader=shader.slice(0,detailStart)+shader.slice(detailStart,detailEnd).replace('let raw = formulaDistance(q);','let raw = sceneOcclusionDistance(q);')+shader.slice(detailEnd);
 const secondaryStart=shader.indexOf('struct SecondaryHit'),secondaryEnd=shader.indexOf('// Visible GGX normal',secondaryStart);
 shader=shader.slice(0,secondaryStart)+`fn secondaryEpsilon(t:f32,p:vec3f)->f32{return max(u.reflection.w*(1.0+t),precisionFloor(p));}
fn reflectionBias(p:vec3f,epsilon:f32)->f32{return 2.0*max(epsilon,precisionFloor(p));}
fn traceSecondaryRay(origin:vec3f,dir:vec3f)->SceneHit{return queryScene(origin,dir,1);}
`+shader.slice(secondaryEnd);
 shader=shader.replaceAll('hit:SecondaryHit','hit:SceneHit').replaceAll('->SecondaryHit','->SceneHit').replace('/*SCENE_NORMAL*/','h.normal=sceneNormal(h.position,max(precisionFloor(h.position),h.epsilon));');
 shader=shader.replace(' let outward=sceneNormal(p,step);',' surfaceIndex=hit.index;let outward=hit.normal;');
 shader=shader.replace('let normal=softenedNormal(p,n,step);let core=formulaCore(p);let base=surfaceBaseColorWith(core,p,normal,hit.steps)*materialData(0u).rgb;','var normal=n;if(surfaceIndex<0){normal=softenedNormal(p,n,step);}var core=vec3f(0.0);if(surfaceIndex<0){core=formulaCore(p);}let base=objectBaseColor(core,p,normal,hit.steps)*materialData(0u).rgb;');
 shader=shader.replace('u.ao.w>0.5||u.cavity.w>0.5','surfaceIndex>=0||u.ao.w>0.5||u.cavity.w>0.5');
 shader=shader.replace('cavity=cavityResponse(p,normal,u.cavity,hit.epsilon);','if(surfaceIndex<0){cavity=cavityResponse(p,normal,u.cavity,hit.epsilon);}');
 // Terminal shading mutates material selection; restore it after every secondary sample.
 shader=shader.replace(' let bias=reflectionBias(p,', ' let primaryIndex=surfaceIndex;let bias=reflectionBias(p,');
 shader=shader.replace('  sum+=radiance*weight;', '  surfaceIndex=primaryIndex;sum+=radiance*weight;');
 shader=shader.replace('sum+=reflectionPath(origin,direction,weight,primaryDistance,pixel,index);continue;', 'sum+=reflectionPath(origin,direction,weight,primaryDistance,pixel,index);surfaceIndex=primaryIndex;continue;');
 if(transport){
  shader=shader.replace('  var lit : vec3f;','  var lit : vec3f;let transportPrimary=u.transport.x>0.5&&(i32(u.view.w)&172)==0&&(closedTransmission(sceneHit)>0.0||(u.reflection.x>0.5&&u.reflectionSampling.w>0.5&&materialActive()&&max(objectMatValue(0,core,p,n,steps),objectMatValue(2,core,p,n,steps))>0.0));');
  shader=shader.replace('  if ((i32(u.view.w) & 8) != 0) {','  if(transportPrimary){lit=tracedTransport(sceneHit,dir,origin,transportPixel);}else if ((i32(u.view.w) & 8) != 0) {');
  shader=shader.replace('  if(surfaceIndex<0){lit *= cavityResponse(p,n,u.cavity,hitThreshold(t,p));}','  if(!transportPrimary&&surfaceIndex<0){lit *= cavityResponse(p,n,u.cavity,hitThreshold(t,p));}');
  shader=shader.replace('  lit += materialEmission();','  if(!transportPrimary){lit += materialEmission();}');
 }
 return shader+'\n'+primitiveQueryWgsl+'\n'+sceneQueryWgsl(thresholdCore)+(transport?'\n'+transmissionWgsl:'');
}
