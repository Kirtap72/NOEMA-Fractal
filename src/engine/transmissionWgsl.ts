/** Bounded reflection/refraction transport over the existing SceneHit/queryScene. No diffuse GI. */
export const transmissionWgsl=/* wgsl */`
struct OpticalMedium {index:i32,ior:f32,sigma:vec3f};
fn airMedium()->OpticalMedium{return OpticalMedium(-1,1.0,vec3f(0.0));}
fn mediumFor(index:i32)->OpticalMedium{
 let saved=surfaceIndex;surfaceIndex=index;let optics=materialData(1u);let sigma=-log(max(materialData(2u).rgb,vec3f(1e-6)))*optics.y;surfaceIndex=saved;
 return OpticalMedium(index,optics.x,sigma);
}
fn closedTransmission(hit:SceneHit)->f32{
 if(hit.objectType!=1&&hit.objectType!=2){return 0.0;}
 if(any(u.clipFlags.xyz>vec3f(0.5))){return 0.0;}
 let p=primitiveStore.objects[u32(hit.index)];let head=select(u.matp[0],p.properties[0],p.identity.w>0.0);if(head.y>=0.0){return 0.0;}
 var core=vec3f(0.0);let metal=clamp(objectMatValue(0,core,hit.position,hit.normal,hit.steps),0.0,1.0);
 return materialData(0u).w*(1.0-metal);
}
fn mediumAt(origin:vec3f)->OpticalMedium{
 let saved=surfaceIndex;var medium=airMedium();
 for(var i=0;i<i32(primitiveStore.count.x);i++){
  let p=primitiveStore.objects[u32(i)];if(p.identity.x<0.5||p.identity.y==3.0){continue;}
  let q=vec3f(dot(p.inverse[0],vec4f(origin,1.0)),dot(p.inverse[1],vec4f(origin,1.0)),dot(p.inverse[2],vec4f(origin,1.0)));
  let inside=select(max(abs(q.x),max(abs(q.y),abs(q.z)))<1.0,dot(q,q)<1.0,p.identity.y==1.0);
  if(inside){surfaceIndex=i;var fake=emptySceneHit(0.0);fake.index=i;fake.objectType=i32(p.identity.y);fake.position=origin;if(closedTransmission(fake)>0.0){if(medium.index>=0){medium.index=-2;break;}medium=mediumFor(i);}}
 }surfaceIndex=saved;return medium;
}
fn dielectricFresnel(cosine:f32,ni:f32,nt:f32)->f32{
 if(ni==nt){return 0.0;}let c=clamp(abs(cosine),0.0,1.0);let s2=(ni/nt)*(ni/nt)*(1.0-c*c);if(s2>=1.0){return 1.0;}
 let ct=sqrt(1.0-s2);let a=ni*c;let b=nt*ct;let d=nt*c;let e=ni*ct;
 let rs=(a-b)/(a+b);let rp=(d-e)/(d+e);return 0.5*(rs*rs+rp*rp);
}
fn transportGeometry(view:vec3f,n:vec3f,outgoing:vec3f,rough:f32)->f32{
 if(rough==0.0){return 1.0;}
 let nv=max(1e-6,dot(n,view));let nl=max(1e-6,abs(dot(n,outgoing)));let a2=pow(rough,4.0);
 let rv=sqrt(nv*nv*(1.0-a2)+a2);let rl=sqrt(nl*nl*(1.0-a2)+a2);
 // Height-correlated Smith G2/G1; the VNDF and BTDF Jacobians cancel in throughput.
 return (2.0*nv*nl/(nl*rv+nv*rl))/(2.0*nv/(nv+rv));
}
fn transportPath(first:SceneHit,incoming:vec3f,origin:vec3f,pixel:vec2f,index:u32)->vec3f{
 var hit=first;var d=incoming;var medium=mediumAt(origin);var throughput=vec3f(1.0);var radiance=vec3f(0.0);var totalDistance=first.distance;var reflections=0;
 if(medium.index== -2){return radiance;}
 let limit=i32(u.transport.y);
 for(var vertex=0;vertex<=limit;vertex++){
  surfaceIndex=hit.index;
  throughput*=exp(-medium.sigma*hit.distance);
  let t=closedTransmission(hit);let n=select(hit.normal,-hit.normal,dot(hit.normal,d)>0.0);
  if(t>0.0){
   let entering=dot(hit.normal,d)<0.0;var destination=airMedium();
   if(entering){if(medium.index>=0){break;}destination=mediumFor(hit.index);}else{if(medium.index!=hit.index){break;}}
   var core=vec3f(0.0);var rough=clamp(objectMatValue(1,core,hit.position,n,hit.steps),0.0,1.0);if(medium.ior==destination.ior){rough=0.0;}
   let uv=reflectionSample(pixel,index^reflectionHash(0x657b193du+u32(vertex)*3u));let h=reflectionHalfVector(-d,n,rough,uv);
   let f=dielectricFresnel(dot(-d,h),medium.ior,destination.ior);let metal=clamp(objectMatValue(0,core,hit.position,n,hit.steps),0.0,1.0);
   let base=objectBaseColor(core,hit.position,n,hit.steps)*materialData(0u).rgb;
   let reflection=mix(vec3f(f),base,metal);let reflectionMass=max(reflection.x,max(reflection.y,reflection.z));let transmission=(1.0-f)*t;let mass=reflectionMass+transmission;
   var local=materialEmission();
   let diffuse=(1.0-f)*(1.0-metal)*(1.0-materialData(0u).w);
   if(diffuse>0.0){viewDir=-d;matF0=mix(vec3f(materialF0()),base,metal);matAlpha=max(0.045,rough)*max(0.045,rough);specAcc=vec3f(0.0);local+=base*lighting(hit.position,n,totalDistance)*diffuse;}
   let fog=select(select(fogAmount(hit.distance),0.0,vertex==0),0.0,(i32(u.view.w)&64)!=0);
   radiance+=throughput*mix(local,u.fogColor.rgb,fog);throughput*=1.0-fog;
   if(vertex>=limit||mass<=0.0){break;}
   let choice=reflectionSample(pixel,index^reflectionHash(0xae129f31u+u32(vertex)*3u)).x;var next=reflect(d,h);var transmitted=false;
   if(choice>=reflectionMass/mass){next=refract(d,h,medium.ior/destination.ior);transmitted=true;}
   if(dot(next,next)<0.5||select(dot(next,n)<=0.0,dot(next,n)>=0.0,transmitted)){break;}
   throughput*=select(reflection*(mass/max(1e-8,reflectionMass)),vec3f(mass),transmitted)*transportGeometry(-d,n,next,rough);
   if(transmitted){let eta=medium.ior/destination.ior;throughput*=eta*eta;medium=destination;}
   let bias=reflectionBias(hit.position,max(hit.epsilon,secondaryEpsilon(0.0,hit.position)));
   let o=hit.position+select(n,-n,transmitted)*bias;d=normalize(next);hit=traceSecondaryRay(o,d);
  }else{
   var shadeHit=hit;if(vertex==0){shadeHit.distance=0.0;}
   primaryTransportVertex=vertex==0;let surface=reflectionSurface(shadeHit,d,totalDistance);primaryTransportVertex=false;
   if(vertex>=limit||surface.gain<=0.0||u.reflection.x<0.5||reflections>=i32(u.reflectionSampling.w)){radiance+=throughput*surface.terminal;break;}
   radiance+=throughput*surface.local;let h=reflectionHalfVector(-d,surface.normal,surface.rough,reflectionSample(pixel,index^reflectionHash(0x445198b9u+u32(vertex))));
   let next=reflect(d,h);throughput*=reflectionWeight(-d,surface.normal,h,next,surface.rough,surface.f0)*surface.gain;
   if(!any(throughput>vec3f(0.0))){break;}reflections++;
   let o=hit.position+surface.normal*reflectionBias(hit.position,max(hit.epsilon,secondaryEpsilon(0.0,hit.position)));d=next;hit=traceSecondaryRay(o,d);
  }
  if(!hit.hit){if(medium.index== -1){radiance+=throughput*reflectionBackground(d);}break;}
  totalDistance+=hit.distance;
 }return radiance;
}
fn tracedTransport(first:SceneHit,incoming:vec3f,origin:vec3f,pixel:vec2f)->vec3f{
 let primary=surfaceIndex;var count=max(1,i32(u.reflectionSampling.x));if(!materialActive()&&closedTransmission(first)<=0.0){count=1;}var sum=vec3f(0.0);
 for(var sample=0;sample<count;sample++){
  surfaceIndex=primary;let index=u32(u.reflectionSampling.z)*u32(count)+u32(sample);sum+=transportPath(first,incoming,origin,pixel,index);
 }surfaceIndex=primary;return sum/f32(count);
}
`;
