/** Generic bounded secondary visibility. Formula code is supplied by the existing chain generator. */
export function secondaryRayWgsl(thresholdCore:boolean,multiBounce=true):string{return /* wgsl */ `
var<private> primaryTransportVertex:bool=false;
struct SecondaryHit {position:vec3f, distance:f32, epsilon:f32, steps:i32, hit:bool, exhausted:bool};
fn secondaryEpsilon(t:f32,p:vec3f)->f32{return max(u.reflection.w*(1.0+t),precisionFloor(p));}
fn reflectionBias(p:vec3f,epsilon:f32)->f32{return 2.0*max(epsilon,precisionFloor(p));}
fn traceSecondaryRay(origin:vec3f,dir:vec3f)->SecondaryHit{
 let interval=clipInterval(origin,dir,u.reflection.z);var t=interval.x;var hit=false;var steps=0;
 var escape=false;var previous=t;var epsilon=secondaryEpsilon(t,origin+dir*t);
 for(var i=0;i<i32(u.reflection.y);i++){
  if(t>interval.y){break;}steps=i;let p=origin+dir*t;epsilon=secondaryEpsilon(t,p);
  let d=${thresholdCore?'formulaCoreAtThreshold(p,epsilon).x':'formulaDistance(p)'};
  if(!(abs(d)<1e18)){t=interval.y+1.0;break;}
  if(i==0&&interval.x>0.0&&d>=0.0&&d<epsilon){escape=true;}
  if(escape){
   if(d>epsilon){var lo=previous;var hi=t;for(var j=0;j<8;j++){let mid=(lo+hi)*0.5;if(formulaDistance(origin+dir*mid)>epsilon){hi=mid;}else{lo=mid;}}t=hi;hit=true;break;}
   previous=t;t+=epsilon*2.0;continue;
  }
  if(abs(d)<epsilon){hit=true;break;}t+=abs(d)*u.march.y;
 }
 return SecondaryHit(origin+dir*t,t,epsilon,steps,hit,!hit&&t<=interval.y);
}
// Visible GGX normal sampling: independently expressed ellipsoid projection, Heitz (JCGT 2018).
fn reflectionHalfVector(view:vec3f,n:vec3f,rough:f32,uv:vec2f)->vec3f{
 if(rough==0.0){return n;}
 let x=normalize(cross(n,select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),abs(n.y)>0.9)));let y=cross(n,x);
 let alpha=rough*rough;let v=normalize(vec3f(alpha*dot(view,x),alpha*dot(view,y),max(1e-6,dot(view,n))));
 var a=vec3f(1.0,0.0,0.0);if(dot(v.xy,v.xy)>1e-12){a=normalize(vec3f(-v.y,v.x,0.0));}let b=cross(v,a);
 let radius=sqrt(uv.x);let angle=6.283185307*uv.y;let dx=radius*cos(angle);let s=0.5*(1.0+v.z);
 let dy=(1.0-s)*sqrt(max(0.0,1.0-dx*dx))+s*radius*sin(angle);
 let disc=a*dx+b*dy+v*sqrt(max(0.0,1.0-dx*dx-dy*dy));
 let local=normalize(vec3f(alpha*disc.xy,max(0.0,disc.z)));
 return normalize(x*local.x+y*local.y+n*local.z);
}
fn reflectionWeight(view:vec3f,n:vec3f,h:vec3f,outgoing:vec3f,rough:f32,f0:vec3f)->vec3f{
 let nv=max(1e-6,dot(n,view));let nl=dot(n,outgoing);if(nl<=0.0){return vec3f(0.0);}
 let a2=rough*rough*rough*rough;let rv=sqrt(nv*nv*(1.0-a2)+a2);let rl=sqrt(nl*nl*(1.0-a2)+a2);
 let g1=2.0*nv/(nv+rv);let g2=2.0*nv*nl/(nl*rv+nv*rl);
 return (f0+(vec3f(1.0)-f0)*pow(1.0-max(0.0,dot(view,h)),5.0))*(g2/g1);
}
fn reflectionHash(value:u32)->u32{var v=value;v^=v>>16u;v*=0x7feb352du;v^=v>>15u;v*=0x846ca68bu;return v^(v>>16u);}
fn reflectionSample(pixel:vec2f,index:u32)->vec2f{
 let seed=reflectionHash(u32(pixel.x)^reflectionHash(u32(pixel.y))^u32(u.reflectionSampling.y));
 let a=reflectionHash(seed^reflectionHash(index*2u+1u));let b=reflectionHash(seed^reflectionHash(index*2u+2u));
 return (vec2f(f32(a>>8u),f32(b>>8u))+vec2f(0.5))/16777216.0;
}
fn reflectionBackground(dir:vec3f)->vec3f{
 if(u.fog.w>0.5&&u.fog.x>0.0&&(i32(u.view.w)&64)==0){return u.fogColor.rgb;}
 return environmentSpecular(dir,0.0);
}
// A reflection ray that used its whole step budget inside the scene (it did NOT leave it) is still next to a surface. Drawing it as sky or
// environment made large black or sky-coloured patches in complex fractals (reflection steps 40, several bounces); it is shaded as a hit at the
// point where it ended instead, the same convention the primary ray follows. PROGRESSIVE-REFLECT-14. Defined here, after the scene-object
// variant has replaced the trace function, so both variants get it (the return type is renamed with the hit type).
fn settleExhausted(origin:vec3f,dir:vec3f,hit:SecondaryHit)->SecondaryHit{
 var h=hit;
 if(!h.hit&&h.exhausted){h.hit=true;h.position=origin+dir*h.distance;h.epsilon=max(h.epsilon,secondaryEpsilon(h.distance,h.position));/*SCENE_NORMAL*/}
 return h;
}
// The terminal value retains Phase 1 exactly. Continued paths replace ONLY its environment term.
${multiBounce?'struct ReflectionSurface {terminal:vec3f,local:vec3f,normal:vec3f,rough:f32,f0:vec3f,gain:f32};':''}
fn ${multiBounce?'reflectionSurface':'shadeReflectionHit'}(hit:SecondaryHit,dir:vec3f,totalDistance:f32)->${multiBounce?'ReflectionSurface':'vec3f'}{
 let p=hit.position;let step=select(max(precisionFloor(p),min(normalStep(totalDistance,p),hit.epsilon)),primaryNormalStep(totalDistance,p),primaryTransportVertex);
 let outward=sceneNormal(p,step);var n=select(outward,-outward,dot(outward,dir)>0.0);
 if(!(dot(n,n)>0.5)){n=-dir;}
 let normal=softenedNormal(p,n,step);let core=formulaCore(p);let base=surfaceBaseColorWith(core,p,normal,hit.steps)*materialData(0u).rgb;
 // The step-count darkening is measured against at least 128 steps: an artist who lowers the reflection steps for speed (40 is common) must not
 // get nearly black reflections, which is what a share of a small budget gave (PROGRESSIVE-REFLECT-14). Budgets of 128 or more are unchanged.
 let occlusion=select(1.0-clamp(f32(hit.steps)/select(max(u.reflection.y,128.0),u.march.z,primaryTransportVertex),0.0,1.0)*1.6,1.0,u.ao.w>0.5||u.cavity.w>0.5||(i32(u.view.w)&2)!=0);
 var lit:vec3f;${multiBounce?'var local:vec3f;var gain=0.0;var pathRough=0.0;var pathF0=vec3f(0.0);':''}
 if(u.mata.x>0.5&&(i32(u.view.w)&4)==0){
  viewDir=-dir;let metal=clamp(matValue(0,core,p,normal,hit.steps),0.0,1.0);let rough=clamp(matValue(1,core,p,normal,hit.steps),0.045,1.0);let refl=clamp(matValue(2,core,p,normal,hit.steps),0.0,1.0);
  matF0=mix(vec3f(materialF0()),base,metal);matAlpha=rough*rough;specAcc=vec3f(0.0);let light=lighting(p,normal,totalDistance);
  let nv=clamp(dot(normal,viewDir),0.0,1.0);let fresnel=matF0+(max(vec3f(1.0-rough),matF0)-matF0)*pow(1.0-nv,5.0);
  lit=base*(1.0-metal)*light*clamp(occlusion,0.15,1.0)+max(refl,metal)*(specAcc+fresnel*environmentSpecular(reflect(dir,normal),rough)*clamp(occlusion,0.15,1.0));
  ${multiBounce?'local=base*(1.0-metal)*light*clamp(occlusion,0.15,1.0)+max(refl,metal)*specAcc;gain=max(refl,metal)*clamp(occlusion,0.15,1.0);pathRough=clamp(matValue(1,core,p,normal,hit.steps),0.0,1.0);pathF0=matF0;':''}
 }else{lit=base*lighting(p,normal,totalDistance)*clamp(occlusion,0.15,1.0);${multiBounce?'local=lit;':''}}
 var cavity=1.0; cavity=cavityResponse(p,normal,u.cavity,hit.epsilon);lit*=cavity;${multiBounce?'local*=cavity;':''}
 lit+=materialEmission();${multiBounce?'local+=materialEmission();':''}
 let fog=select(fogAmount(hit.distance),0.0,(i32(u.view.w)&64)!=0);
 return ${multiBounce?'ReflectionSurface(mix(lit,u.fogColor.rgb,fog),mix(local,u.fogColor.rgb,fog),n,pathRough,pathF0,gain*cavity*(1.0-fog))':'mix(lit,u.fogColor.rgb,fog)'};
}
${multiBounce?/* wgsl */`fn shadeReflectionHit(hit:SecondaryHit,dir:vec3f,totalDistance:f32)->vec3f{
 return reflectionSurface(hit,dir,totalDistance).terminal;
}
// Bounce zero preserves the Phase-1 sequence. Later vertices receive independent, stable dimensions.
fn reflectionPathSample(pixel:vec2f,index:u32,bounce:u32)->vec2f{
 if(bounce==0u){return reflectionSample(pixel,index);}
 return reflectionSample(pixel,index^reflectionHash(0x9e3779b9u*bounce));
}
fn reflectionPath(origin:vec3f,direction:vec3f,initialWeight:vec3f,primaryDistance:f32,pixel:vec2f,index:u32)->vec3f{
 var o=origin;var d=direction;var throughput=initialWeight;var radiance=vec3f(0.0);var distance=primaryDistance;
 // A uniform loop bound avoids requiring four statically expanded copies of the fractal/shading kernel.
 let limit=min(4,i32(u.reflectionSampling.w));
 for(var bounce=0;bounce<limit;bounce++){
  let hit=settleExhausted(o,d,traceSecondaryRay(o,d));
  if(!hit.hit){radiance+=throughput*reflectionBackground(d);break;}
  distance+=hit.distance;let surface=reflectionSurface(hit,d,distance);
  // The existing terminal approximation closes depth/budget/negligible-contribution paths.
  if(bounce+1>=limit||surface.gain<=0.0){radiance+=throughput*surface.terminal;break;}
  let half=reflectionHalfVector(-d,surface.normal,surface.rough,reflectionPathSample(pixel,index,u32(bounce+1)));
  let next=reflect(d,half);let weight=reflectionWeight(-d,surface.normal,half,next,surface.rough,surface.f0)*surface.gain;
  if(!any(throughput*vec3f(surface.gain)>vec3f(1e-5))){radiance+=throughput*surface.terminal;break;}
  radiance+=throughput*surface.local;throughput*=weight;
  // Rejected VNDF samples contribute zero; they must never become a mirror/environment fallback.
  if(!any(throughput>vec3f(0.0))){break;}
  o=hit.position+surface.normal*reflectionBias(hit.position,max(hit.epsilon,secondaryEpsilon(0.0,hit.position)));d=next;
 }
 return radiance;
}
`:''}
fn tracedReflection(p:vec3f,n:vec3f,incoming:vec3f,primaryDistance:f32,rough:f32,f0:vec3f,pixel:vec2f)->vec3f{
 let bias=reflectionBias(p,max(hitThreshold(primaryDistance,p),secondaryEpsilon(0.0,p)));let origin=p+n*bias;var sum=vec3f(0.0);
 let count=select(i32(u.reflectionSampling.x),1,rough==0.0);
 for(var i=0;i<count;i++){
  let index=u32(u.reflectionSampling.z)*u32(count)+u32(i);
  let h=reflectionHalfVector(-incoming,n,rough,reflectionSample(pixel,index));let direction=reflect(incoming,h);
  let weight=reflectionWeight(-incoming,n,h,direction,rough,f0);
  if(!any(weight>vec3f(0.0))){continue;}
  ${multiBounce?'if(u.reflectionSampling.w>1.5){sum+=reflectionPath(origin,direction,weight,primaryDistance,pixel,index);continue;}':''}
  let hit=settleExhausted(origin,direction,traceSecondaryRay(origin,direction));var radiance=reflectionBackground(direction);
  if(hit.hit){radiance=shadeReflectionHit(hit,direction,primaryDistance+hit.distance);}
  sum+=radiance*weight;
 }
 return sum/f32(count);
}
`;}
