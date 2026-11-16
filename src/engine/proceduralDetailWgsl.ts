/** Own C2 value lattice and bounded cellular signal, with analytic spatial gradients. */
export const proceduralDetailWgsl=/* wgsl */`
var<private> detailRoughnessAdjustment:f32;
fn procHash(value:u32)->u32{var v=value;v^=v>>16u;v*=0x7feb352du;v^=v>>15u;v*=0x846ca68bu;return v^(v>>16u);}
fn procCellHash(cell:vec3i,seed:u32)->u32{let c=vec3u((cell%vec3i(1048576)+vec3i(1048576))%vec3i(1048576));return procHash((c.x*0x9e3779b9u)^(c.y*0x85ebca6bu)^(c.z*0xc2b2ae35u)^seed);}
fn procRandom(value:u32)->f32{return (f32(value>>8u)+.5)/16777216.0;}
fn procValueNoise(point:vec3f,seed:u32)->vec4f{
 let cell=vec3i(floor(point));let f=fract(point);let s=f*f*f*(f*(f*6.0-15.0)+10.0);let ds=30.0*f*f*(f-1.0)*(f-1.0);var height=0.0;var gradient=vec3f(0.0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let corner=vec3i(x,y,z);let w=select(1.0-s,s,corner>vec3i(0));let dw=select(-ds,ds,corner>vec3i(0));let h=2.0*procRandom(procCellHash(cell+corner,seed))-1.0;
  height+=h*w.x*w.y*w.z;gradient+=h*vec3f(dw.x*w.y*w.z,w.x*dw.y*w.z,w.x*w.y*dw.z);
 }}}return vec4f(height,gradient);
}
fn procCellular(point:vec3f,seed:u32)->vec4f{
 let cell=vec3i(floor(point));let f=fract(point);var closest=1e10;var delta=vec3f(0.0);
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let at=cell+vec3i(x,y,z);let h=procCellHash(at,seed);let jitter=.3+.4*vec3f(procRandom(procHash(h^0x68bc21ebu)),procRandom(procHash(h^0x02e5be93u)),procRandom(procHash(h^0x967a889bu)));
  let d=f-vec3f(vec3i(x,y,z))-jitter;let distance=dot(d,d);if(distance<closest){closest=distance;delta=d;}
 }}}let height=-exp(-4.0*closest);return vec4f(height,-8.0*height*delta);
}
fn procFrequencyWeight(footprint:f32)->f32{return 1.0-smoothstep(.25,.75,footprint);}
fn proceduralSignal(point:vec3f,record:SurfaceRecord,footprint:f32)->vec4f{
 let settings=record.procedural;let angle=record.noise.w;let c=cos(angle);let s=sin(angle);let anisotropy=select(1.0,record.effects.x,settings.x==3.0);
 let q=vec3f(c*point.x-s*point.y,(s*point.x+c*point.y)/anisotropy,point.z)*settings.z;
 var signal=vec4f(0.0);var norm=0.0;var frequency=1.0;var amplitude=1.0;let octaves=select(i32(settings.w),1,settings.x==1.0||settings.x==4.0);
 for(var octave=0;octave<octaves;octave++){
  norm+=amplitude;let weight=procFrequencyWeight(footprint*frequency);
  if(weight>0.0&&amplitude>0.0){
   var n:vec4f;if(settings.x==4.0){n=procCellular(q*frequency,u32(record.noise.z));}else{n=procValueNoise(q*frequency,u32(record.noise.z)+u32(octave)*1013u);}
   if(settings.x==6.0){n=vec4f(1.0-abs(n.x),-sign(n.x)*n.yzw);}
   if(settings.x==5.0){let den=.15+n.x*n.x;n=vec4f(n.x/sqrt(den),n.yzw*(.15/pow(den,1.5)));}
   signal+=vec4f(n.x,n.yzw*frequency)*amplitude*weight;
  }
  frequency*=record.noise.x;amplitude*=record.noise.y;
 }
 signal/=max(norm,1e-10);let g=signal.yzw;return vec4f(signal.x,vec3f(c*g.x+s*g.y/anisotropy,-s*g.x+c*g.y/anisotropy,g.z)*settings.z);
}
`;

/** Keeps the Phase-6A shader byte-identical when this opt-in extension is absent. */
export function integrateProceduralDetail(shader:string,surface:string):{shader:string;surface:string}{
  surface=surface.replace('options:vec4f};','options:vec4f,procedural:vec4f,noise:vec4f,effects:vec4f};');
  surface=surface.replace('detailGeometric=geometric;detailBaseNormal=base;','detailGeometric=geometric;detailBaseNormal=base;detailRoughnessAdjustment=0.0;');
  surface=surface.replace('if(all(record.maps.xy<vec2f(0.0)))','if(all(record.maps.xy<vec2f(0.0))&&record.procedural.x<=0.0)');
  surface=surface.replace(' let world=normalize(rows*(localN+slope));',/* wgsl */`
 if(record.procedural.x>0.0&&(record.procedural.y>0.0||record.effects.y!=0.0)){
  let footprintProc=max(pixelSize(distance),precisionFloor(p))*record.procedural.z*stretch/incidence;
  let signal=proceduralSignal(q,record,footprintProc);let gradient=signal.yzw/max(1e-6,record.procedural.z);
  slope-=record.procedural.y*(gradient-localN*dot(localN,gradient));detailRoughnessAdjustment=record.effects.y*signal.x;
 }
 let world=normalize(rows*(localN+slope));`);
  // Only constant property-1 calls are modified. Driven curves remain the base value; every hit resets the adjustment.
  shader=shader.replace(/(?:objectMatValue|matValue)\(\s*1\s*,[^()]*\)/g,call=>`(${call}+detailRoughnessAdjustment)`);
  return {shader,surface:surface+'\n'+proceduralDetailWgsl};
}
