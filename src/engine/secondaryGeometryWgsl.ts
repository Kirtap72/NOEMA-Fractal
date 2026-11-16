import {integratePrimitiveShader} from './primitiveWgsl';

/** Opt-in adapter over the existing analytical scene query and bounded reflection paths.
 * The ordinary zero-object and native-object variants are untouched.
 */
export function integrateSecondaryGeometryShader(original:string,thresholdCore:boolean,primaryPrimitives:boolean):string{
 const start=original.indexOf('  let interval = clipInterval(origin, dir, u.march.w);',original.indexOf('fn fs('));
 const end=original.indexOf('  // A ray that neither hit',start);
 let shader=integratePrimitiveShader(original,thresholdCore,false);
 if(!primaryPrimitives){
  // Keep the original fractal primary marcher verbatim, independent of external analytical bounds.
  const s=shader.indexOf('  let sceneHit=queryScene(origin,dir,0);',shader.indexOf('fn fs(')),e=shader.indexOf('  // A ray that neither hit',s);
  shader=shader.slice(0,s)+original.slice(start,end)+`  surfaceIndex=-1;
  let sceneHit=SceneHit(origin+dir*t,t,vec3f(0.0),0.0,steps,hit,false,0,0,0,-1);
`+shader.slice(e);
  shader=shader.replace('let outward = sceneHit.normal;','let outward = sceneNormal(p, primaryNormalStep(t, p));');
 }
 // Native queries and AO retain their original membership. External records never affect the camera's diffuse/AO.
 shader=shader.replace('for(var i=0;i<i32(primitiveStore.count.x);i++){let candidate=primitiveHit','for(var i=0;i<i32(primitiveStore.count.y);i++){let candidate=primitiveHit');
 shader=shader.replace('for(var i=0;i<i32(primitiveStore.count.x);i++){if(primitiveStore.objects','for(var i=0;i<i32(primitiveStore.count.y);i++){if(primitiveStore.objects');
 shader=shader.replace('}else if(kind==3){','}else if(kind==3||kind==4){').replace('if(kind==3){n=','if(kind==3||kind==4){n=');
 shader=shader.replace(' let local=o+d*t;var n=local;',' let local=o+d*t;if(kind==4&&(abs(local.x)>1.0||abs(local.z)>1.0)){return result;}var n=local;');
 shader=shader.replace('let analytic=queryPrimitives(origin,dir,interval.x,interval.y);',`var analytic=queryPrimitives(origin,dir,interval.x,interval.y);
 if(secondary){let externalHit=queryExternalPrimitives(origin,dir,0.0,distanceLimit,false);if(externalHit.hit&&(!analytic.hit||externalHit.distance<analytic.distance)){analytic=externalHit;}}`);
 // Fractal cutouts do not clip external geometry, including when the entire shadow ray misses the cutout domain.
 shader=shader.replace('fn shadowAmount(origin : vec3f, dir : vec3f, tmax : f32, k : f32, mode : f32, hit : f32) -> f32 {',`fn shadowAmount(origin : vec3f, dir : vec3f, tmax : f32, k : f32, mode : f32, hit : f32) -> f32 {
  if(secondaryShading){let externalHit=queryExternalPrimitives(origin,dir,hit*2.0,tmax,true);if(externalHit.hit){return 0.0;}}`);
 shader=shader.replace('surfaceIndex=hit.index;let outward=hit.normal;','secondaryShading=true;surfaceIndex=hit.index;let outward=hit.normal;');
 shader=shader.replaceAll('surfaceIndex=primaryIndex;', 'surfaceIndex=primaryIndex;secondaryShading=false;');
 return shader+/* wgsl */`
var<private> secondaryShading:bool=false;
fn queryExternalPrimitives(origin:vec3f,dir:vec3f,near:f32,far:f32,shadow:bool)->SceneHit{
 var best=emptySceneHit(far);
 for(var i=i32(primitiveStore.count.y);i<i32(primitiveStore.count.x);i++){
  let p=primitiveStore.objects[u32(i)];if(p.identity.x<1.5||(shadow&&p.identity.x<2.5)){continue;}
  let h=primitiveHit(i,origin,dir,near,best.distance);if(h.hit&&(!best.hit||h.distance<best.distance)){best=h;}
 }return best;
}
`;
}
