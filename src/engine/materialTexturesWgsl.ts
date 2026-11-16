import {PBR_GRAD_TAIL} from "./rampTextures";
/** M2A decorates the native material inputs; distance, raw normal/depth and the BRDF remain shared. */
export function integrateMaterialTextures(shader:string,objects:boolean,gradient=false):string {
 const slot=objects?'u32(surfaceIndex+1)':'0u';
 const transform=objects?`if(surfaceIndex>=0){let object=primitiveStore.objects[u32(surfaceIndex)];let r0=object.inverse[0].xyz;let r1=object.inverse[1].xyz;let r2=object.inverse[2].xyz;q=vec3f(dot(object.inverse[0],vec4f(p,1)),dot(object.inverse[1],vec4f(p,1)),dot(object.inverse[2],vec4f(p,1)));let det=dot(r0,cross(r1,r2));localN=normalize(vec3f(dot(cross(r1,r2)/det,base),dot(cross(r2,r0)/det,base),dot(cross(r0,r1)/det,base)));stretch=max(length(r0),max(length(r1),length(r2)));kind=i32(object.identity.y);}`:'';
 shader=shader.replace('detailGeometric=geometric;detailBaseNormal=base;','detailGeometric=geometric;detailBaseNormal=base;pbrPrepare(p,base,view,distance);');
 shader=shader.replace(/(?:objectBaseColor|surfaceBaseColorWith)\(core,\s*(?:p|hit.position),\s*(?:detailBaseNormal|n|normal),\s*(?:steps|hit.steps)\)\*materialData\(0u\)\.rgb/g,call=>`pbrBase(${call})`);
 shader=shader.replace(/(?:objectMatValue|matValue)\(\s*[01]\s*,[^()]*\)/g,call=>`pbrScalar(${/\(\s*0/.test(call)?2:1}u,${call})`);
 shader=shader.replace('return e.rgb*e.w;','return pbrEmission(e.rgb*e.w);');
 shader=shader.replace('var sum = u.ambient.rgb * ao;','var sum = u.ambient.rgb * ao * pbrAO();').replace('envDiffuse(n) * ao','envDiffuse(n) * ao * pbrAO()');
 // Secondary hits have their own coordinates. Restore the primary context with
 // the existing surface-detail restoration, including multi-bounce transport.
 shader=shader.replaceAll('let primaryGeometric=detailGeometric;','let primaryGeometric=detailGeometric;let primaryPbr=pbrContext;').replaceAll('detailGeometric=primaryGeometric;','detailGeometric=primaryGeometric;pbrContext=primaryPbr;');
 // Medium classification and dielectric vertices query BRDF inputs before the
 // normal-shading hook. Give each query its own hit, including inside probes.
 shader=shader.replace('fn closedTransmission(hit:SceneHit)->f32{','fn closedTransmission(hit:SceneHit)->f32{\n let queryNormal=select(vec3f(0,1,0),hit.normal,dot(hit.normal,hit.normal)>1e-12);pbrPrepare(hit.position,queryNormal,queryNormal,max(hit.distance,1e-6));');
 if(gradient){
  // MATERIAL-GRADIENT-02: the gradient's parameter t is remembered where it is computed, so the PBR functions below can ask how much of each
  // textured gradient material is present at this hit. The same t, cycles, offset and wrap as the colour and the V1 scalar curves.
  const colorLine='var base = gradientColor(m * u.color.y + u.color.z);',valueLine='var t = measureValue(which, core, p, n, steps) * head.z + head.w;';
  if(!shader.includes(colorLine)||!shader.includes(valueLine))throw new Error('Gradient textures: the shader text has changed; update integrateMaterialTextures.');
  shader=shader.replace(colorLine,'pbrContext.gradT = m * u.color.y + u.color.z;\n  var base = gradientColor(pbrContext.gradT);').replace(valueLine,valueLine+'\n  if (which == i32(u.color.x + 0.5)) { pbrContext.gradT = t; }');
 }
 const body=/* wgsl */`
struct PbrRecord {maps:array<vec4f,5>};
@group(0) @binding(15) var<storage,read> pbrRecords:array<PbrRecord>;
struct PbrContext {point:vec3f,normal:vec3f,slot:u32,kind:i32,lod:f32};
var<private> pbrContext:PbrContext;
fn pbrPrepare(p:vec3f,base:vec3f,view:vec3f,distance:f32){
 var q=p;var localN=base;var stretch=1.0;var kind=0;${transform}
 let slot=${slot};let record=surfaceRecords[slot];let footprint=max(1e-8,pixelSize(distance)*record.transform.x*stretch/max(.15,abs(dot(base,view))));
 pbrContext=PbrContext(q,localN,slot,kind,clamp(log2(max(1.0,footprint*record.options.y)),0.0,record.options.z));
}
fn pbrProjected(layer:f32,uv:vec2f,lod:f32)->vec3f{
 let record=surfaceRecords[pbrContext.slot];let angle=record.transform.y;let c=cos(angle);let s=sin(angle);let coordinate=vec2f(c*uv.x-s*uv.y,s*uv.x+c*uv.y)*record.transform.x+record.transform.zw;
 return detailSample(layer,coordinate,lod);
}
fn pbrSample(layer:f32)->vec3f{
 let record=surfaceRecords[pbrContext.slot];let n=pbrContext.normal;let q=pbrContext.point;var weights=pow(abs(n),vec3f(4));weights/=max(1e-10,weights.x+weights.y+weights.z);
 if(record.options.x>0.5&&pbrContext.kind>1){let biggest=max(weights.x,max(weights.y,weights.z));weights=select(vec3f(0),vec3f(1),weights>=vec3f(biggest));weights/=weights.x+weights.y+weights.z;}
 var value=vec3f(0);for(var axis=0;axis<3;axis++){if(weights[axis]<.001){continue;}let chart=detailChart(axis,select(-1.0,1.0,n[axis]>=0.0));value+=weights[axis]*pbrProjected(layer,vec2f(dot(q,chart[0]),dot(q,chart[1])),pbrContext.lod);}
 if(record.options.x>0.5&&pbrContext.kind==1&&dot(q,q)>1e-20){let radial=q*inverseSqrt(max(dot(q,q),1e-20));let weight=1.0-smoothstep(.90,.98,abs(radial.y));if(weight>0.0){let uv=vec2f(.5-atan2(radial.z,radial.x)/6.283185307,.5+asin(clamp(radial.y,-1.0,1.0))/3.141592654);let lod=clamp(pbrContext.lod+log2(max(1.0,1.0/(6.283185307*max(.1,sqrt(max(0.0,1.0-radial.y*radial.y)))))),0.0,record.options.z);value=mix(value,pbrProjected(layer,uv,lod),weight);}}
 return value;
}
fn pbrBase(base:vec3f)->vec3f{let map=pbrRecords[pbrContext.slot].maps[0];if(map.x<0.0){return base;}let sample=pbrSample(map.x);return mix(base,select(base*sample,sample,map.z>0.5),map.y);}
fn pbrScalar(channel:u32,base:f32)->f32{let map=pbrRecords[pbrContext.slot].maps[channel];if(map.x<0.0){return base;}let sample=pbrSample(map.x).r;return clamp(mix(base,select(base*sample,sample,map.z>0.5),map.y),0.0,1.0);}
fn pbrAO()->f32{let map=pbrRecords[pbrContext.slot].maps[3];if(map.x<0.0){return 1.0;}return mix(1.0,pbrSample(map.x).r,map.y);}
fn pbrEmission(base:vec3f)->vec3f{let map=pbrRecords[pbrContext.slot].maps[4];if(map.x<0.0){return base;}let sample=pbrSample(map.x);return mix(base,select(base*sample,sample*materialData(3u).w,map.z>0.5),map.y);}
`;
 if(!gradient)return shader+body;
 const swap=(s:string,a:string,b:string)=>{if(!s.includes(a))throw new Error('Gradient textures: expected shader text not found: '+a.slice(0,60));return s.replace(a,b);};
 let g=body;
 g=swap(g,'struct PbrContext {point:vec3f,normal:vec3f,slot:u32,kind:i32,lod:f32};','struct PbrContext {point:vec3f,normal:vec3f,slot:u32,kind:i32,lod:f32,foot:f32,gradT:f32};');
 g=swap(g,'pbrContext=PbrContext(q,localN,slot,kind,clamp(log2(max(1.0,footprint*record.options.y)),0.0,record.options.z));','pbrContext=PbrContext(q,localN,slot,kind,clamp(log2(max(1.0,footprint*record.options.y)),0.0,record.options.z),max(1e-8,pixelSize(distance)*stretch/max(.15,abs(dot(base,view)))),0.0);');
 g=swap(g,'fn pbrProjected(layer:f32,uv:vec2f,lod:f32)->vec3f{\n let record=surfaceRecords[pbrContext.slot];','fn pbrProjected(layer:f32,uv:vec2f,lod:f32,slot:u32)->vec3f{\n let record=surfaceRecords[slot];');
 const s0=g.indexOf('fn pbrSample(layer:f32)->vec3f{'),s1=g.indexOf('fn pbrBase(');
 let sample=g.slice(s0,s1);
 sample=swap(sample,'fn pbrSample(layer:f32)->vec3f{\n let record=surfaceRecords[pbrContext.slot];','fn pbrSampleSlot(layer:f32,slot:u32,lodIn:f32)->vec3f{\n let record=surfaceRecords[slot];');
 sample=swap(sample,'pbrProjected(layer,vec2f(dot(q,chart[0]),dot(q,chart[1])),pbrContext.lod)','pbrProjected(layer,vec2f(dot(q,chart[0]),dot(q,chart[1])),lodIn,slot)');
 sample=swap(sample,'let lod=clamp(pbrContext.lod+log2(','let lod=clamp(lodIn+log2(');
 sample=swap(sample,'pbrProjected(layer,uv,lod)','pbrProjected(layer,uv,lod,slot)');
 g=g.slice(0,s0)+sample+'fn pbrSample(layer:f32)->vec3f{return pbrSampleSlot(layer,pbrContext.slot,pbrContext.lod);}\n'+g.slice(s1);
 g=swap(g,'fn pbrBase(base:vec3f)->vec3f{','fn pbrBaseOwn(base:vec3f)->vec3f{');
 g=swap(g,'fn pbrScalar(channel:u32,base:f32)->f32{','fn pbrScalarOwn(channel:u32,base:f32)->f32{');
 g=swap(g,'fn pbrAO()->f32{','fn pbrAOOwn()->f32{');
 return shader+g+/* wgsl */`
// ---- MATERIAL-GRADIENT-02: textured gradient materials. Active only for the fractal (slot 0) when the tail says K > 0 entries.
const PBR_GRAD_TAIL:u32=${PBR_GRAD_TAIL}u;
fn pbrTail(n:u32)->vec4f{return pbrRecords[PBR_GRAD_TAIL+n/5u].maps[n%5u];}
fn pbrGradActive()->bool{return pbrContext.slot==0u&&pbrTail(0u).x>0.5;}
// How much of entry e is present at this hit: the 32-node table, linear between nodes, wrapped like gradientColor.
fn pbrGradWeight(e:u32)->f32{
 var t=pbrContext.gradT;
 if(u.color.w>0.5){let m=t-2.0*floor(t*0.5);t=1.0-abs(1.0-m);}else{t=fract(t);}
 let f=clamp(t,0.0,1.0)*31.0;let i=u32(floor(f));let j=min(i+1u,31u);
 return mix(pbrTail(5u+e*8u+(i>>2u))[i&3u],pbrTail(5u+e*8u+(j>>2u))[j&3u],f-floor(f));
}
fn pbrBase(base:vec3f)->vec3f{
 if(!pbrGradActive()){return pbrBaseOwn(base);}
 let K=u32(pbrTail(0u).x+0.5);let first=u32(pbrTail(0u).y+0.5);var W=0.0;var acc=vec3f(0);
 for(var e=0u;e<K;e++){let w=pbrGradWeight(e);if(w<0.0005){continue;}W+=w;let slot=first+e;let map=pbrRecords[slot].maps[0];var c=base;
  if(map.x>=0.0){let s=pbrSampleSlot(map.x,slot,pbrLodFor(slot));c=mix(base,select(base*s,s,map.z>0.5),map.y);}acc+=w*c;}
 W=clamp(W,0.0,1.0);return acc+(1.0-W)*pbrBaseOwn(base);
}
fn pbrScalar(channel:u32,base:f32)->f32{
 if(!pbrGradActive()){return pbrScalarOwn(channel,base);}
 let K=u32(pbrTail(0u).x+0.5);let first=u32(pbrTail(0u).y+0.5);var W=0.0;var acc=0.0;var own=0.0;
 for(var e=0u;e<K;e++){let w=pbrGradWeight(e);if(w<0.0005){continue;}W+=w;let slot=first+e;let sv=pbrTail(1u+e);let s0=select(sv.y,sv.x,channel==2u);own+=w*s0;let map=pbrRecords[slot].maps[channel];var v=s0;
  if(map.x>=0.0){let s=pbrSampleSlot(map.x,slot,pbrLodFor(slot)).r;v=clamp(mix(s0,select(s0*s,s,map.z>0.5),map.y),0.0,1.0);}acc+=w*v;}
 W=clamp(W,0.0,1.0);let rest=clamp((base-own)/max(1.0-W,1e-4),0.0,1.0);return acc+(1.0-W)*pbrScalarOwn(channel,rest);
}
fn pbrAO()->f32{
 if(!pbrGradActive()){return pbrAOOwn();}
 let K=u32(pbrTail(0u).x+0.5);let first=u32(pbrTail(0u).y+0.5);var W=0.0;var acc=0.0;
 for(var e=0u;e<K;e++){let w=pbrGradWeight(e);if(w<0.0005){continue;}W+=w;let slot=first+e;let map=pbrRecords[slot].maps[3];var v=1.0;
  if(map.x>=0.0){v=mix(1.0,pbrSampleSlot(map.x,slot,pbrLodFor(slot)).r,map.y);}acc+=w*v;}
 W=clamp(W,0.0,1.0);return acc+(1.0-W)*pbrAOOwn();
}
// The texture detail level of a slot: its own scale decides how many texels fall on a pixel.
fn pbrLodFor(slot:u32)->f32{let r=surfaceRecords[slot];return clamp(log2(max(1.0,max(1e-8,pbrContext.foot*r.transform.x)*r.options.y)),0.0,r.options.z);}
`;
}
