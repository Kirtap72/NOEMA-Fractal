/** Independently reconstructed equations; see NewFormulas/preset-compatibility. */
import type {PreparedKernel,KernelState} from './kernels';
import {applyMatrix,nearestEven} from './primitives';
export function stepRecreationSix(k:PreparedKernel,s:KernelState):void {
 const p=k.p,n=(key:string)=>p[key]!,i=(key:string)=>nearestEven(n(key));
 let q=s.v.slice(0,3),w=s.v[3];
 if(k.id==='mb3d-reciprocaly3b'){
  const y=q[1]!,a=1/Math.max(1e-40,n('limiter1'))-1/(Math.abs(y*n('mul1'))+n('limiter1')),
   b=1/Math.max(1e-40,n('limiter2'))-1/(Math.abs(y*y*n('mul2'))+n('limiter2'));
  q[1]=(y<0||Object.is(y,-0)?-1:1)*(a+b);
 }else if(k.id==='mb3d-sierphilbert'){
  q=applyMatrix(k.matrices[0]!,q);
  for(const [a,b] of [[0,1],[0,2],[1,2]] as const)if(q[a]!+q[b]!<=0)[q[a],q[b]]=[-q[b]!,-q[a]!];
  if(n('edge1')>0)q[1]=n('edge1')-Math.abs(q[1]!-n('edge1'));
  if(n('edge2')>0)q[0]=n('edge2')-Math.abs(q[0]!-n('edge2'));
  q=applyMatrix(k.matrices[1]!,q).map((v,a)=>n('scale')*v-(n('scale')-1)*n('cscale_'+'xyz'[a]));w*=n('scale');
 }else if(k.id==='mb3d-trans-kochifs'){
  q=applyMatrix(k.matrices[0]!,q.map((v,a)=>v+n('add_'+'xyz'[a])));
  const order=i('polyfold_order');if(order===0){s.invalid=true;return;}
  const sector=nearestEven((Math.PI-Math.atan2(q[1]!,q[0]!))*.159154943*order),angle=sector/order*6.283185307;
  const xx=q[0]!,yy=q[1]!;let x=Math.abs(xx*Math.cos(angle)-yy*Math.sin(angle)),y=(xx*Math.sin(angle)+yy*Math.cos(angle))*(sector&1?1:-1),z=q[2]!;
  const co=Math.fround(Math.cos(n('koch_angle')*Math.PI/180)),si=Math.fround(Math.sin(n('koch_angle')*Math.PI/180));
  [x,z]=[x*co-z*si,x*si+z*co];x=Math.abs(x-n('koch_sub')*co);
  [x,z]=[x*co+z*si,z*co-x*si];x=Math.abs(x-n('koch_sub')*si);
  q=[x*n('koch_scale')-n('koch_fix_x'),y*n('koch_scale'),z*n('koch_scale')-n('koch_fix_z')];s.varyScale*=n('koch_scale');
 }else{
  const r=applyMatrix(k.matrices[0]!,q),f=(key:string)=>Math.fround(n(key)),h=f('h_scale'),thick=f('thickness');
  const side=Math.max(Math.abs(r[0]!)-f('x_size'),Math.abs(r[1]!)-f('y_size'));
  if(side>.5||Math.abs(r[2]!)+thick-.5*h>Math.abs(h)+s.mapPadding)s.fieldValue=Math.max(side,Math.abs(r[2]!))-thick+.5*h;
  else{
   const offset=i('source_variant')===1?.5:0;
   const color=k.sampleField?.(i('map_nr'),r[0]!*f('x_scale')-offset,r[1]!*f('y_scale')-offset),channel=i('map_channel_0_2')&3,trap=i('otrap_channel_0_2')&3;
   if(!color||channel>2||trap>2){s.invalid=true;return;}
   s.fieldValue=Math.max(side,Math.abs(r[2]!)+thick-color[channel]!*h);s.free[0]=(color[trap]!+f('otrap_offset'))*f('otrap_multiplier');
  }
 }
 s.v=[q[0]!,q[1]!,q[2]!,w];s.invalid||=![...s.v,s.fieldValue,s.varyScale,...s.free].every(Number.isFinite);
}
export function recreationSixBody(id:string,p:(name:string)=>string,m:readonly string[]):string {
 const v=(prefix:string)=>`vec3f(${['x','y','z'].map(a=>p(prefix+'_'+a)).join(',')})`,i=(key:string)=>`i32(round(${p(key)}))`;
 if(id==='mb3d-reciprocaly3b')return `let y=s.v.y;let a=1.0/${p('limiter1')}-1.0/(abs(y*${p('mul1')})+${p('limiter1')});let b=1.0/${p('limiter2')}-1.0/(abs(y*y*${p('mul2')})+${p('limiter2')});s.v.y=select(a+b,-(a+b),(bitcast<u32>(y)&0x80000000u)!=0u);`;
 if(id==='mb3d-sierphilbert')return `var q=${m[0]}*s.v.xyz;${[[0,1],[0,2],[1,2]].map(([a,b])=>`if(q[${a}]+q[${b}]<=0.0){let old=q;q[${a}]=-old[${b}];q[${b}]=-old[${a}];}`).join('')}if(${p('edge1')}>0.0){q.y=${p('edge1')}-abs(q.y-${p('edge1')});}if(${p('edge2')}>0.0){q.x=${p('edge2')}-abs(q.x-${p('edge2')});}s.v=vec4f((${m[1]}*q)*${p('scale')}-(${p('scale')}-1.0)*${v('cscale')},s.v.w*${p('scale')});`;
 if(id==='mb3d-trans-kochifs')return `var q=${m[0]}*(s.v.xyz+${v('add')});let order=${i('polyfold_order')};if(order==0){s.invalid=true;break;}let sector=i32(round((3.141592653589793-atan2(q.y,q.x))*0.159154943*f32(order)));let a=f32(sector)/f32(order)*6.283185307;let old=q;q=vec3f(abs(old.x*cos(a)-old.y*sin(a)),(old.x*sin(a)+old.y*cos(a))*select(-1.0,1.0,(sector&1)!=0),old.z);let co=cos(${p('koch_angle')}*0.017453292519943295);let si=sin(${p('koch_angle')}*0.017453292519943295);q=vec3f(q.x*co-q.z*si,q.y,q.x*si+q.z*co);q.x=abs(q.x-${p('koch_sub')}*co);q=vec3f(q.x*co+q.z*si,q.y,q.z*co-q.x*si);q.x=abs(q.x-${p('koch_sub')}*si);q=q*${p('koch_scale')}-vec3f(${p('koch_fix_x')},0.0,${p('koch_fix_z')});s.v=vec4f(q,s.v.w);s.varyScale*=${p('koch_scale')};`;
 return `let q=${m[0]}*s.v.xyz;let h=${p('h_scale')};let thick=${p('thickness')};let side=max(abs(q.x)-${p('x_size')},abs(q.y)-${p('y_size')});if(side>0.5||abs(q.z)+thick-0.5*h>abs(h)+s.mapPadding){s.field=max(side,abs(q.z))-thick+0.5*h;}else{let offset=select(0.0,0.5,${i('source_variant')}==1);let c=sampleFormulaField(${i('map_nr')},q.xy*vec2f(${p('x_scale')},${p('y_scale')})-vec2f(offset));let ch=${i('map_channel_0_2')}&3;let tr=${i('otrap_channel_0_2')}&3;if(c.w==0.0||ch>2||tr>2){s.invalid=true;break;}s.field=max(side,abs(q.z)+thick-c[ch]*h);s.free.x=(c[tr]+${p('otrap_offset')})*${p('otrap_multiplier')};}`;
}
