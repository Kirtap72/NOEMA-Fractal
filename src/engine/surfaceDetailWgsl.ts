import {integrateProceduralDetail} from './proceduralDetailWgsl';
/** Hit-only surface shading. No formula/distance/normal-estimation code is changed. */
export const surfaceWgsl=/* wgsl */`
struct SurfaceRecord {maps:vec4f,transform:vec4f,options:vec4f};
@group(0) @binding(12) var surfaceTex:texture_2d_array<f32>;
@group(0) @binding(13) var surfaceSampler:sampler;
@group(0) @binding(14) var<storage,read> surfaceRecords:array<SurfaceRecord>;
var<private> detailGeometric:vec3f;
var<private> detailBaseNormal:vec3f;
fn detailChart(axis:i32,sgn:f32)->mat3x3f{
 if(axis==0){return mat3x3f(vec3f(0,0,-sgn),vec3f(0,1,0),vec3f(sgn,0,0));}
 if(axis==1){return mat3x3f(vec3f(1,0,0),vec3f(0,0,-sgn),vec3f(0,sgn,0));}
 return mat3x3f(vec3f(sgn,0,0),vec3f(0,1,0),vec3f(0,0,sgn));
}
fn detailSample(layer:f32,uv:vec2f,lod:f32)->vec3f{return textureSampleLevel(surfaceTex,surfaceSampler,uv*vec2f(1,-1),i32(layer),lod).rgb;}
fn detailProjection(n:vec3f,chart:mat3x3f,uv:vec2f,metric:vec2f,lod:f32,record:SurfaceRecord)->vec3f{
 let angle=record.transform.y;let c=cos(angle);let s=sin(angle);
 let coordinate=vec2f(c*uv.x-s*uv.y,s*uv.x+c*uv.y)*record.transform.x+record.transform.zw;
 let tangent=c*chart[0]-s*chart[1];let bitangent=s*chart[0]+c*chart[1];var slope=vec3f(0.0);
 if(record.maps.x>=0.0&&record.maps.z>0.0){
  let step=exp2(lod)/record.options.y;
  let du=(detailSample(record.maps.x,coordinate+vec2f(step,0),lod).r-detailSample(record.maps.x,coordinate-vec2f(step,0),lod).r)/(2.0*step);
  let dv=(detailSample(record.maps.x,coordinate+vec2f(0,step),lod).r-detailSample(record.maps.x,coordinate-vec2f(0,step),lod).r)/(2.0*step);
  let gradientU=c*chart[0]*metric.x-s*chart[1]*metric.y;let gradientV=s*chart[0]*metric.x+c*chart[1]*metric.y;
  slope-=record.maps.z*(gradientU*du+gradientV*dv);
 }
 if(record.maps.y>=0.0&&record.maps.w>0.0){var sampled=detailSample(record.maps.y,coordinate,lod)*2.0-1.0;sampled.y*=select(1.0,-1.0,record.options.w>0.5);slope+=record.maps.w*(tangent*sampled.x+bitangent*sampled.y)/max(.1,sampled.z);}
 return slope-n*dot(n,slope);
}
fn detailEnvironment(direction:vec3f,rough:f32)->vec3f{if(dot(direction,detailGeometric)<=0.0){return vec3f(0.0);}return environmentSpecular(direction,rough);}
fn detailConstrain(candidate:vec3f,geometric:vec3f,view:vec3f,glass:bool)->vec3f{
 let n=normalize(geometric);let h=normalize(candidate);let d=dot(n,h);var tangent=h-n*d;let size=length(tangent);
 if(size>0.0){tangent*=min(size/max(.1,d),select(1.73205,.176327,glass))/size;}
 let nv=max(0.0,dot(n,view));let tv=dot(tangent,view);if(tv<0.0){tangent*=min(1.0,nv*.8/(-tv));}
 return normalize(n+tangent);
}
fn surfaceShadingNormal(p:vec3f,geometric:vec3f,base:vec3f,view:vec3f,distance:f32,glass:bool)->vec3f{
 detailGeometric=geometric;detailBaseNormal=base;
 if((i32(u.view.w)&8)!=0){return base;}
 let record=surfaceRecords[DETAIL_SLOT];if(all(record.maps.xy<vec2f(0.0))){return base;}
 var q=p;var localN=base;var rows=mat3x3f(vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1));var stretch=1.0;var objectType=0;
 DETAIL_OBJECT_TRANSFORM
 let incidence=max(.15,abs(dot(geometric,view)));
 let footprint=max(1e-8,pixelSize(distance)*record.transform.x*stretch/incidence);
 let lod=clamp(log2(max(1.0,footprint*record.options.y)),0.0,record.options.z);
 var weights=pow(abs(localN),vec3f(4.0));weights/=max(1e-10,weights.x+weights.y+weights.z);var slope=vec3f(0.0);
 if(record.options.x>0.5&&objectType>1){let biggest=max(weights.x,max(weights.y,weights.z));weights=select(vec3f(0.0),vec3f(1.0),weights>=vec3f(biggest));weights/=weights.x+weights.y+weights.z;}
 for(var axis=0;axis<3;axis++){if(weights[axis]<.001){continue;}let chart=detailChart(axis,select(-1.0,1.0,localN[axis]>=0.0));let uv=vec2f(dot(q,chart[0]),dot(q,chart[1]));slope+=weights[axis]*detailProjection(localN,chart,uv,vec2f(1.0),lod,record);}
 if(record.options.x>0.5&&objectType==1){
  let radial=normalize(q);let pole=abs(radial.y);let weight=1.0-smoothstep(.90,.98,pole);
  if(weight>0.0){let phi=atan2(radial.z,radial.x);let theta=asin(clamp(radial.y,-1.0,1.0));let chart=mat3x3f(vec3f(sin(phi),0,-cos(phi)),vec3f(-cos(phi)*sin(theta),cos(theta),-sin(phi)*sin(theta)),radial);
   let metric=vec2f(1.0/(6.283185307*max(.1,cos(theta))),1.0/3.141592654);
   let sphereLod=clamp(lod+log2(max(1.0,max(metric.x,metric.y))),0.0,record.options.z);
   let sphereSlope=detailProjection(localN,chart,vec2f(.5-phi/6.283185307,.5+theta/3.141592654),metric,sphereLod,record);slope=mix(slope,sphereSlope,weight);
  }
 }
 let world=normalize(rows*(localN+slope));return detailConstrain(world,geometric,view,glass);
}
`;

/** The frame of an object hit (local point, local normal, rows, size, type) read from primitiveStore: Live LookDev 2 gives its shading kernel a store of the same shape. */
export const DETAIL_OBJECT_TRANSFORM:string=/* wgsl */`if(surfaceIndex>=0){let object=primitiveStore.objects[u32(surfaceIndex)];let r0=object.inverse[0].xyz;let r1=object.inverse[1].xyz;let r2=object.inverse[2].xyz;
    q=vec3f(dot(object.inverse[0],vec4f(p,1)),dot(object.inverse[1],vec4f(p,1)),dot(object.inverse[2],vec4f(p,1)));
    let det=dot(r0,cross(r1,r2));let col0=cross(r1,r2)/det;let col1=cross(r2,r0)/det;let col2=cross(r0,r1)/det;
    localN=normalize(vec3f(dot(col0,base),dot(col1,base),dot(col2,base)));rows=mat3x3f(r0,r1,r2);stretch=max(length(r0),max(length(r1),length(r2)));objectType=i32(object.identity.y);
  }`;

export function integrateSurfaceDetailShader(shader:string,primitives=false,procedural=false):string {
  const slot=primitives?'u32(surfaceIndex+1)':'0u';
  const transform=primitives?DETAIL_OBJECT_TRANSFORM:'';
  const primary=primitives?'var n=rawNormal;if(surfaceIndex<0){n=softenedNormal(p,rawNormal,primaryNormalStep(t,p));}':'let n = softenedNormal(p, rawNormal, primaryNormalStep(t, p));';
  if(!shader.includes(primary))throw Error('Surface detail primary anchor missing');
  shader=shader.replace(primary,primary.replace('let n =','var n =')+'\n n=surfaceShadingNormal(p,rawNormal,n,-dir,t,false);');
  if(primitives)shader=shader.replace('var normal=n;if(surfaceIndex<0){normal=softenedNormal(p,n,step);}', 'var normal=n;if(surfaceIndex<0){normal=softenedNormal(p,n,step);}normal=surfaceShadingNormal(p,n,normal,-dir,totalDistance,false);');
  else shader=shader.replace('let normal=softenedNormal(p,n,step);','let normal=surfaceShadingNormal(p,n,softenedNormal(p,n,step),-dir,totalDistance,false);');
  shader=shader.replace('detailVisibility(p, n, u.ao','detailVisibility(p, detailGeometric, u.ao').replace('p + n * (6.0 * hit)','p + detailGeometric * (6.0 * hit)').replace('let diffuse = max(dot(n, toLight), 0.0);','let diffuse = select(0.0,max(dot(n, toLight), 0.0),dot(detailGeometric,toLight)>0.0);');
  shader=shader.replaceAll('cavityResponse(p, n,','cavityResponse(p, detailGeometric,').replaceAll('cavityResponse(p,n,','cavityResponse(p,detailGeometric,').replaceAll('cavityResponse(p,normal,','cavityResponse(p,detailGeometric,');
  // Keep gradient/texture measures tied to the pre-detail surface; the effect changes lighting only.
  shader=shader.replaceAll('surfaceBaseColorWith(core, p, n,','surfaceBaseColorWith(core, p, detailBaseNormal,').replaceAll('surfaceBaseColorWith(core,p,normal,','surfaceBaseColorWith(core,p,detailBaseNormal,').replaceAll('objectBaseColor(core,p,n,','objectBaseColor(core,p,detailBaseNormal,').replaceAll('objectBaseColor(core,p,normal,','objectBaseColor(core,p,detailBaseNormal,');
  shader=shader.replaceAll('environmentSpecular(reflect(dir,normal),rough)','detailEnvironment(reflect(dir,normal),rough)').replaceAll('environmentSpecular(reflect(dir, n), rough)','detailEnvironment(reflect(dir, n), rough)');
  shader=shader.replace('environment=tracedReflection(p,reflectionNormal,','environment=tracedReflection(p,n,');
  shader=shader.replace('normal:vec3f,rough:f32,f0:vec3f,gain:f32','normal:vec3f,rough:f32,f0:vec3f,gain:f32,geometric:vec3f');
  shader=shader.replace(',n,pathRough,pathF0,gain*cavity*(1.0-fog))',',normal,pathRough,pathF0,gain*cavity*(1.0-fog),n)');
  shader=shader.replaceAll('hit.position+surface.normal*reflectionBias','hit.position+surface.geometric*reflectionBias');
  shader=shader.replace('let origin=p+n*bias;','let origin=p+primaryGeometric*bias;');
  shader=shader.replace('fn tracedReflection(p:vec3f,n:vec3f,incoming:vec3f,primaryDistance:f32,rough:f32,f0:vec3f,pixel:vec2f)->vec3f{','fn tracedReflection(p:vec3f,n:vec3f,incoming:vec3f,primaryDistance:f32,rough:f32,f0:vec3f,pixel:vec2f)->vec3f{\n let primaryGeometric=detailGeometric;');
  shader=shader.replace('let weight=reflectionWeight(-incoming,n,h,direction,rough,f0);','let weight=select(vec3f(0.0),reflectionWeight(-incoming,n,h,direction,rough,f0),dot(direction,primaryGeometric)>0.0);');
  shader=shader.replace('sum+=reflectionPath(origin,direction,weight,primaryDistance,pixel,index);','sum+=reflectionPath(origin,direction,weight,primaryDistance,pixel,index);detailGeometric=primaryGeometric;');
  shader=shader.replace('sum+=radiance*weight;','detailGeometric=primaryGeometric;sum+=radiance*weight;');
  shader=shader.replace('return sum/f32(count);','detailGeometric=primaryGeometric;return sum/f32(count);');
  shader=shader.replace('next,surface.rough,surface.f0)*surface.gain;', 'next,surface.rough,surface.f0)*surface.gain*select(0.0,1.0,dot(next,surface.geometric)>0.0);');
  if(primitives){
    shader=shader.replace('if(t>0.0){\n', 'if(t>0.0){\n   let shading=surfaceShadingNormal(hit.position,n,n,-d,totalDistance,true);\n');
    shader=shader.replace('let h=reflectionHalfVector(-d,n,rough,uv);','let h=reflectionHalfVector(-d,select(shading,n,medium.ior==destination.ior),rough,uv);');
    shader=shader.replace('lighting(hit.position,n,totalDistance)','lighting(hit.position,shading,totalDistance)').replace('transportGeometry(-d,n,next,rough)','transportGeometry(-d,shading,next,rough)');
    shader=shader.replace('let primary=surfaceIndex;var count=', 'let primaryGeometric=detailGeometric;let primary=surfaceIndex;var count=').replace('}surfaceIndex=primary;return sum/f32(count);','}surfaceIndex=primary;detailGeometric=primaryGeometric;return sum/f32(count);');
  }
  let surface=surfaceWgsl;if(procedural){const extended=integrateProceduralDetail(shader,surface);shader=extended.shader;surface=extended.surface;}
  return shader+'\n'+surface.replace('DETAIL_SLOT',slot).replace('DETAIL_OBJECT_TRANSFORM',transform);
}
