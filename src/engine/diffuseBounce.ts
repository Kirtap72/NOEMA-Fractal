import type {Vec3} from './camera';
export {DEFAULT_DIFFUSE_GI,defaultDiffuseGi,readDiffuseGi} from './reflections';
export type {DiffuseGiSettings} from './reflections';
/** Bounded one-bounce diffuse GI. Default OFF; no legacy scene selects this implicitly. */
export type DiffuseBounceMode='off'|'one'|'four';
export const DIFFUSE_BOUNCE_STEPS=256,DIFFUSE_BOUNCE_DISTANCE=30,DIFFUSE_SHADOW_STEPS=32;
export function diffuseBounceSamples(mode:DiffuseBounceMode,eligible:boolean):number{return eligible?(mode==='one'?1:mode==='four'?4:0):0;}
/** Lambert f*cos/pdf = rho for p=cos/pi. PBRT4 Diffuse Reflection; independently expressed. */
export function diffuseBounceWeight(base:Vec3,metal:number):Vec3{return base.map(v=>v*(1-Math.min(1,Math.max(0,metal)))) as Vec3;}
export function cosineDiffuseDirection(n:Vec3,uv:readonly[number,number]):Vec3{
 const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const norm=(a:Vec3)=>{const l=Math.hypot(...a);return a.map(v=>v/l) as Vec3;};
 const x=norm(cross(n,Math.abs(n[1])>.9?[1,0,0]:[0,1,0])),y=cross(n,x),r=Math.sqrt(uv[0]),a=2*Math.PI*uv[1];
 return norm(n.map((v,i)=>x[i]!*r*Math.cos(a)+y[i]!*r*Math.sin(a)+v*Math.sqrt(1-uv[0])) as Vec3);
}
export function shaderFunction(source:string,name:string):{start:number;end:number;body:string}{
 const start=source.indexOf('fn '+name+'(');if(start<0)throw Error('GI1 missing helper '+name);let end=source.indexOf('{',start)+1,depth=1;
 while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}if(depth)throw Error('GI1 unbalanced helper '+name);return{start,end,body:source.slice(start,end)};
}
/** Local adapter reuses the existing traversal and material expressions, never a second renderer. */
export type DiffuseBounceView='combined'|'runtime';
export interface DiffuseBounceOptions{view?:DiffuseBounceView;}
export function integrateDiffuseBounce(original:string,options:DiffuseBounceOptions={}):string{
 const view=options.view??'combined';let s=original;const objects=s.includes('fn queryScene('),detail=s.includes('fn surfaceShadingNormal('),pbr=s.includes('fn pbrPrepare(');
 const change=(text:string,a:string,b:string)=>{if(text.split(a).length!==2)throw Error('GI1 anchor '+a);return text.replace(a,b);};
 let trace=shaderFunction(s,objects?'queryScene':'traceSecondaryRay').body;
 if(objects){
  trace=trace.replace('fn queryScene(','fn giTrace(').replace(',kind:i32','');
  trace=change(trace,'let secondary=kind==1;let distanceLimit=select(u.march.w,u.reflection.z,secondary);','let secondary=true;let distanceLimit=30.0;');trace=trace.split('secondaryEpsilon(').join('giEpsilonAt(');
  trace=change(trace,'let budget=select(i32(u.march.z),i32(u.reflection.y),secondary);','let budget=256;');
  trace=change(trace,'if(!(abs(raw)<1e18)){t=far+1.0;break;}','if(!(abs(raw)<1e18)){giStatus=4u;t=far+1.0;break;}');
  trace=change(trace,'if(d<epsilon){hit=true;break;}t+=d*u.march.y;','giCleared=true;if(d<epsilon){hit=true;break;}t+=d*giStepFactor();');
  trace=change(trace,'return SceneHit(p,t,','giStatus=1u;giStage=2u;return SceneHit(p,t,');
  trace=change(trace,'if(analytic.hit){return analytic;}','if(analytic.hit){if(giStatus!=4u){giStatus=select(1u,3u,t<=far);}return analytic;}');
  trace=change(trace,'miss.exhausted=t<=interval.y;return miss;','miss.exhausted=t<=interval.y;if(giStatus!=4u){giStatus=select(2u,3u,miss.exhausted);}return miss;');
 }else{
  trace=trace.replace('fn traceSecondaryRay(','fn giTrace(').replace('u.reflection.z','30.0').replace('i<i32(u.reflection.y)','i<256');trace=trace.split('secondaryEpsilon(').join('giEpsilonAt(');
  trace=change(trace,'var escape=false;','var escape=false;var launchBand=false;var prevAbs=1e20;giCleared=false;');
  trace=change(trace,'if(!(abs(d)<1e18)){t=interval.y+1.0;break;}','if(!(abs(d)<1e18)){giStatus=4u;t=interval.y+1.0;break;}let ad=abs(d);if(i==0){prevAbs=ad;if(ad>=2.0*epsilon){giCleared=true;}if(interval.x==0.0&&ad<epsilon){launchBand=true;t+=epsilon;continue;}}else{if(ad>prevAbs||ad>=2.0*epsilon){giCleared=true;}prevAbs=ad;}if(launchBand){if(ad>=epsilon){launchBand=false;}else if(!giCleared||t>4.0*epsilon){giStatus=5u;t=interval.y+1.0;break;}else{t+=epsilon;continue;}}');
  trace=change(trace,'if(abs(d)<epsilon){hit=true;break;}t+=abs(d)*u.march.y;','if(ad<epsilon){hit=true;break;}t+=ad*giStepFactor();');
  trace=change(trace,' return SecondaryHit(',' giLastSteps=steps;if(giStatus!=4u&&giStatus!=5u){giStatus=select(2u,3u,!hit&&t<=interval.y);if(hit){giStatus=1u;}}return SecondaryHit(');
 }
 let shadow=shaderFunction(s,'shadowAmount').body.replace('fn shadowAmount(','fn giShadow(').replace('let steps = i32(u.extra.w);','let steps = i32(u.extra.w);');
 shadow=change(shadow,'    let raw = formulaDistance(origin + dir * t);','    let raw = formulaDistance(origin + dir * t);if(!(abs(raw)<1e18)){giShadowUnknown+=1u;return 0.0;}');
 shadow=change(shadow,'    t += h * u.march.y;','    t += h * giStepFactor();');
 shadow=change(shadow,'  return clamp(res, 0.0, 1.0);','  if(t<interval.y){giShadowUnknown+=1u;return 0.0;}return clamp(res, 0.0, 1.0);');
 let light=shaderFunction(s,'lighting').body.replace('fn lighting(','fn giDirect(');
 const loop=light.indexOf('  let count ='),end=light.indexOf('    if (',light.indexOf('    sum = sum +'));if(loop<0||end<0)throw Error('GI1 direct-light ownership changed');
 light=light.slice(0,light.indexOf('{')+1)+'\n let ao=1.0;var sum=vec3f(0);\n'+light.slice(loop,end)+'  }\n return sum;\n}';
 light=light.replace('i32(u.ambient.w)','min(8,i32(u.ambient.w))').replace('shadowAmount(','giShadow(').replace('let hit = hitThreshold(tc, p);','let hit = giEpsilonAt(tc, p);');
 const reflected=shaderFunction(s,s.includes('fn reflectionSurface(')?'reflectionSurface':'shadeReflectionHit').body;
 const shadePrelude=reflected.slice(reflected.indexOf('{')+1,reflected.indexOf(' let occlusion='));
 const metal=/let metal=([^;]+);/.exec(reflected)?.[1];if(!metal||!shadePrelude.includes('let base='))throw Error('GI1 material helper ownership changed');
 const shade=/* wgsl */`fn giSurface(hit:${objects?'SceneHit':'SecondaryHit'},dir:vec3f,totalDistance:f32)->vec3f{
 giStage=2u;giNormalReads+=1u;${shadePrelude.replace(/(let|var) core=/,'giStage=3u;$1 core=')}
 giMaterialReads+=1u;var metal=0.0;if(${objects?'materialActive()':'u.mata.x>0.5'}){metal=${metal};}
 giStage=4u;let incoming=giDirect(p,normal,totalDistance);return base*(1.0-metal)*incoming+materialEmission();
}`;
 const header=/* wgsl */`
const GI_SAMPLES:f32=1.0;
fn giEpsilonAt(t:f32,p:vec3f)->f32{return max(hitThreshold(t,p),precisionFloor(p)*(1.0+t));}
fn giStepFactor()->f32{return max(u.march.y,0.45);}
var<private> giActive:bool;var<private> giStage:u32;var<private> giStatus:u32;var<private> giCleared:bool;var<private> giLastSteps:i32;
var<private> giCounts:vec4f;var<private> giUncertain:u32;var<private> giHorizon:u32;var<private> giEps:f32;var<private> giShadowUnknown:u32;
var<private> giWork:array<u32,4>;var<private> giCoreCalls:u32;
var<private> giNormalReads:u32;var<private> giMaterialReads:u32;
var<private> giRaw:vec3f;var<private> giLastDirection:vec3f;var<private> giLastDistance:f32;
fn giCosine(n:vec3f,uv:vec2f)->vec3f{
 let x=normalize(cross(n,select(vec3f(0,1,0),vec3f(1,0,0),abs(n.y)>.9)));let y=cross(n,x);let r=sqrt(uv.x);let a=6.283185307*uv.y;
 return normalize(x*r*cos(a)+y*r*sin(a)+n*sqrt(1.0-uv.x));
}
fn giBounce(p:vec3f,n:vec3f,geometric:vec3f,rho:vec3f,primaryDistance:f32,pixel:vec2f)->vec3f{
 giRaw=vec3f(0);giCounts=vec4f(0);giUncertain=0u;giHorizon=0u;giEps=0.0;giShadowUnknown=0u;giCoreCalls=0u;giNormalReads=0u;giMaterialReads=0u;giLastSteps=0;for(var k=0u;k<4u;k++){giWork[k]=0u;}
 if(GI_SAMPLES<0.5||!any(rho>vec3f(0))){return vec3f(0);}
 ${objects?'let primaryIndex=surfaceIndex;':''}${detail?'let primaryGeometric=detailGeometric;let primaryBaseNormal=detailBaseNormal;':''}${pbr?'let primaryPbr=pbrContext;':''}
 let count=min(4,i32(GI_SAMPLES));let epsilon=max(hitThreshold(primaryDistance,p),precisionFloor(p));let origin=p+geometric*reflectionBias(p,epsilon);giEps=epsilon;
 giActive=true;
 for(var i=0;i<count;i++){
  let index=(u32(u.reflectionSampling.z)*u32(count)+u32(i))^0x71b3a5d9u;
  let direction=giCosine(n,reflectionSample(pixel,index));giLastDirection=direction;
  if(dot(direction,geometric)<=0.0){giUncertain+=1u;giHorizon+=1u;continue;}
  giStage=1u;giStatus=0u;let hit=giTrace(origin,direction);giLastDistance=hit.distance;
  if(giStatus==1u&&(hit.distance<=1.5*max(epsilon,hit.epsilon)||(hit.distance<=4.0*max(epsilon,hit.epsilon)&&!giCleared))){giStatus=5u;}
  if(giStatus>=1u&&giStatus<=4u){giCounts[giStatus-1u]+=1.0;}else{giUncertain+=1u;}
  if(giStatus==1u){let le=giSurface(hit,direction,primaryDistance+hit.distance);let fog=select(fogAmount(hit.distance),0.0,(i32(u.view.w)&64)!=0);giRaw+=rho*le*(1.0-fog);}
  ${objects?'surfaceIndex=primaryIndex;':''}${detail?'detailGeometric=primaryGeometric;detailBaseNormal=primaryBaseNormal;':''}${pbr?'pbrContext=primaryPbr;':''}
 }
 giActive=false;giStage=0u;giRaw/=f32(count);return giRaw;
}
`;
 // Count actual production API invocations, including normal/material/shadow work.
 const fullCore=s.includes('fn geoFullCore(');
 for(const [name,signature,args]of [['formulaDistance','p:vec3f','p'],['formulaCore','p:vec3f','p'],['formulaCoreAtThreshold','p:vec3f,e:f32','p,e']] as const){
  if(!s.includes('fn '+name+'('))continue;const result=name==='formulaDistance'?'f32':'vec3f';
  const fullExpr=name==='formulaDistance'?'geoFullCore(p,0.0).x':'geoFullCore(p,0.0)';
  s=change(s,'fn '+name+'(','fn giOriginal_'+name+'(')+`\nfn ${name}(${signature})->${result}{if(giActive){${name==='formulaCore'?'giCoreCalls+=1u;':'giWork[clamp(giStage,1u,4u)-1u]+=1u;'}}${fullCore?`if(giActive){return ${fullExpr};}`:''}return giOriginal_${name}(${args});}\n`;
 }
 const fs=shaderFunction(s,'fs');let primary=fs.body;
 const baseEnd=primary.indexOf('\n',primary.indexOf('let base ='));if(baseEnd<0)throw Error('GI1 primary material missing');
 primary=primary.slice(0,baseEnd)+'\n var giRho=base;var giMetalOut=0.0;'+primary.slice(baseEnd);
 primary=primary.replace(/(let metal = [^;]+;)/,'$1giRho=base*(1.0-metal);giMetalOut=metal;');
 // Insert immediately before existing cavity so it applies once to the new term too.
 const cavityToken=primary.indexOf('lit *= cavityResponse');const cavity=cavityToken<0?-1:primary.lastIndexOf('\n',cavityToken)+1;if(cavity<0)throw Error('GI1 primary cavity anchor');
 const call='giBounce(p,n,'+(detail?'detailGeometric':'rawNormal')+',giRho,t,'+(s.includes('let transportPixel =')?'transportPixel':'p0-u.extra.xy')+')',gate='GI_SAMPLES>0.5&&(i32(u.view.w)&140)==0&&materialData(0u).w==0.0';
 if(view==='combined'){primary=primary.slice(0,cavity)+'  if('+gate+'){lit+='+call+';}\n'+primary.slice(cavity);}
 else{
  // Runtime views share one compiled shader. The harness selects the view through the otherwise unused tile.w word:
  // 0 baseline (original expressions), 1 diffuse-indirect only, 2 hit status, 3 material albedo/metal, 4 baseline + indirect.
  const cut=(text:string,x:string,y:string)=>{if(text.split(x).length!==2)throw Error('GI2 view anchor '+x);return text.replace(x,()=>y);};
  primary=primary.slice(0,cavity)+'  let giView=i32(u.tile.w+0.5);var giTerm=vec3f(0.0);var giDiag=vec4f(0.0);var giUnresolved=0.0;\n  if((giView==1||giView==2||giView==4||giView>=5)&&'+gate+'){giTerm='+call+';giDiag=vec4f(giCounts.x,giCounts.y,giCounts.z,giCounts.w);giUnresolved=select(0.0,1.0,giCounts.z+giCounts.w>0.0||giUncertain>0u||giShadowUnknown>0u);if(giView==5){giDiag=vec4f(select(0.0,1.0,giStatus==5u),select(0.0,1.0,giHorizon>0u),select(0.0,1.0,giShadowUnknown>0u),select(0.0,1.0,giStatus==1u));}if(giView==6){giDiag=vec4f(giLastDistance,giEps,dot(giRaw,vec3f(0.2126,0.7152,0.0722)),t);}}\n  if(giView==4){lit+=giTerm;}else if(giView>0){lit=giTerm;}\n'+primary.slice(cavity);
  primary=cut(primary,'lit += materialEmission();','if(giView==0||giView==4){lit += materialEmission();}');
  primary=cut(primary,'let color = mix(lit, u.fogColor.rgb, fog);','let color = select(lit * (1.0 - fog), mix(lit, u.fogColor.rgb, fog), giView==0||giView==4);');
  primary=cut(primary,'out.color = vec4f(displayColor(color), 1.0);','var giOut=vec4f(displayColor(color), 1.0);if(giView==1){giOut=vec4f(displayColor(color),giUnresolved);}else if(giView==2||giView>=5){giOut=giDiag;}else if(giView==3){giOut=vec4f(base,giMetalOut);}out.color = giOut;');
  primary=cut(primary,'out.color = vec4f(displayColor(skyColor), 1.0);','out.color = select(vec4f(displayColor(skyColor), 1.0), vec4f(0.0), i32(u.tile.w+0.5)>0 && i32(u.tile.w+0.5)!=4);');
  if(primary.includes('out.data = vec4f(t, rawNormal.x, rawNormal.y, rawNormal.z);')){
   primary=cut(primary,'out.data = vec4f(t, rawNormal.x, rawNormal.y, rawNormal.z);','out.data = select(vec4f(t, rawNormal.x, rawNormal.y, rawNormal.z), vec4f(f32(giStatus), f32(giShadowUnknown), giLastDistance, f32(giLastSteps)), giView==1);');
  }
 }
 s=s.slice(0,fs.start)+primary+s.slice(fs.end);
 return header+trace+'\n'+shadow+'\n'+light+'\n'+shade+'\n'+s;
}
