/** Independent normalized equations, validated in RecreationNine.validation.json. */
import type {PreparedKernel,KernelState} from './kernels';
import {applyMatrix,nearestEven} from './primitives';
import {updateVaryScale} from './essentialsKernels';
export function stepRecreationNine(k:PreparedKernel,s:KernelState):void {
 const n=(key:string)=>k.p[key]!,i=(key:string)=>nearestEven(n(key));let q=s.v.slice(0,3),w=s.v[3];
 if(k.id==='mb3d-transformifs'){
  q=applyMatrix(k.matrices[0]!,q.map((x,j)=>x*n('scale')+n('add_'+'xyz'[j]))).map((x,j)=>i('abs_'+'xyz'[j])!==0?Math.abs(x):x);s.varyScale*=n('scale');
 }else if(k.id==='mb3d-asurfsmoothfold'){
  for(const j of [0,1]){const x=q[j]!,a=Math.abs(x),r=n('fix_box')*a**i('sharpness');q[j]=(x<0||Object.is(x,-0)?-1:1)*(a+r*(2*n('fold')-a))/(1+r);}
  const scale=updateVaryScale(s,n('scale'),n('scale_vary')),low=Math.max(1e-40,n('min_r'))**2;let den=1;
  if(low<.99){const mid=(1+low)/2,half=(1-low)/2,d=q.reduce((a,x)=>a+x*x,0)-mid,t=Math.abs(d)/half,r=n('fix_ball')*t**(i('ball_sharpness')/2);den=mid+(d<0?-1:1)*half*(r+t)/(r+1);}
  const m=scale/den;q=applyMatrix(k.matrices[0]!,q.slice().reverse().map(x=>m*x)).reverse().map((x,j)=>x+s.c[j]!);w*=m;
 }else{
  const local=q.map((x,j)=>n('scale')*x+n('xyz'[j]+'_add'));
  if(i('apply_scale_add')!==0){q=local.slice();s.varyScale*=n('scale');}
  let [x,y,z]=local as [number,number,number];
  if(k.id==='mb3d-boardifs'){
   [x,y,z]=applyMatrix(k.matrices[0]!,local) as [number,number,number];const r=x*x+y*y;
   switch(i('variation')){case 1:[x,y]=[x/r,y/r];break;case 2:{const d=x*x+(y+1)**2;[x,y]=[(r-1)/d,-2*x/d];break;}case 3:[x,y]=[x/Math.log2(r),y/Math.log2(r)];break;case 4:[x,y]=[Math.sqrt(r),Math.atan2(y,x)];}
   const checker=Math.sin(x*n('checker_scale'))*Math.sin(y*n('checker_scale'));s.free[0]=n(checker<0?'otrapclr_1':'otrapclr_2')+s.count*n('otraponits');s.fieldValue=Math.max(-z,Math.min(checker*300/n('checker_scale'),-z+n('bump')));
  }else{
   const radius=n('sph_radius'),cage=n('cage_radius'),parals=Math.min(1000,Math.max(2,i('parals'))),merids=i('merids');
   if(merids===0){s.invalid=true;return;}
   const angle=nearestEven((1.57079632675-Math.atan2(x,y))*.159154943*merids)/merids*6.283185307,projected=x*Math.cos(angle)+y*Math.sin(angle),perp=x*Math.sin(angle)-y*Math.cos(angle);
   s.fieldValue=Math.hypot(Math.hypot(projected,z)-radius,perp)-cage;
   for(let j=1;j<=Math.floor(parals/2);j++){const h=-radius+j*radius*2/parals,ring=Math.sqrt(Math.max(0,radius*radius-h*h));s.fieldValue=Math.min(s.fieldValue,Math.hypot(Math.hypot(x,y)-ring,Math.abs(z)+h)-cage);}
  }
  if(i('apply_scale_add')===0)s.fieldValue/=n('scale');
 }
 s.v=[q[0]!,q[1]!,q[2]!,w];s.invalid||=![...s.v,s.fieldValue,s.varyScale,...s.free].every(Number.isFinite);
}
export function recreationNineBody(id:string,p:(key:string)=>string,m:readonly string[]):string {
 const v=(prefix:string,suffix='')=>`vec3f(${['x','y','z'].map(a=>p(prefix+a+suffix)).join(',')})`,i=(key:string)=>`i32(round(${p(key)}))`;
 if(id==='mb3d-transformifs')return `var q=${m[0]}*(s.v.xyz*${p('scale')}+${v('add_')});${['x','y','z'].map(a=>`if(${i('abs_'+a)}!=0){q.${a}=abs(q.${a});}`).join('')}s.v=vec4f(q,s.v.w);s.varyScale*=${p('scale')};`;
 if(id==='mb3d-asurfsmoothfold')return `var q=s.v.xyz;${['x','y'].map(a=>`{let x=q.${a};let r=${p('fix_box')}*pow(abs(x),f32(${i('sharpness')}));q.${a}=select(1.0,-1.0,(bitcast<u32>(x)&0x80000000u)!=0u)*(abs(x)+r*(2.0*${p('fold')}-abs(x)))/(1.0+r);}`).join('')}if(s.firstIteration<=0.0){s.firstIteration+=1.0;s.first=s.firstIteration>0.0;s.varyScale=${p('scale')};}s.varyScale+=${p('scale_vary')}*(abs(s.varyScale)-1.0);let low=${p('min_r')}*${p('min_r')};var den=1.0;if(low<0.99){let mid=(1.0+low)*0.5;let half=(1.0-low)*0.5;let d=dot(q,q)-mid;let t=abs(d)/half;let r=${p('fix_ball')}*pow(t,f32(${i('ball_sharpness')})*0.5);den=mid+select(1.0,-1.0,d<0.0)*half*(r+t)/(r+1.0);}let scale=s.varyScale/den;s.v=vec4f((${m[0]}*(q.zyx*scale)).zyx+s.c.xyz,s.v.w*scale);`;
 const setup=`let local=s.v.xyz*${p('scale')}+${v('','_add')};if(${i('apply_scale_add')}!=0){s.v=vec4f(local,s.v.w);s.varyScale*=${p('scale')};}`;
 const finish=`if(${i('apply_scale_add')}==0){s.field/=${p('scale')};}`;
 if(id==='mb3d-boardifs')return setup+`let q=${m[0]}*local;var xy=q.xy;let r=dot(xy,xy);switch(${i('variation')}){case 1:{xy/=r;}case 2:{let d=xy.x*xy.x+(xy.y+1.0)*(xy.y+1.0);xy=vec2f(r-1.0,-2.0*xy.x)/d;}case 3:{xy/=log2(r);}case 4:{xy=vec2f(sqrt(r),atan2(xy.y,xy.x));}default:{}}if(!kernelFinite(xy.x)||!kernelFinite(xy.y)){s.invalid=true;break;}let checker=sin(xy.x*${p('checker_scale')})*sin(xy.y*${p('checker_scale')});s.free.x=select(${p('otrapclr_2')},${p('otrapclr_1')},checker<0.0)+s.count*${p('otraponits')};s.field=max(-q.z,min(checker*300.0/${p('checker_scale')},-q.z+${p('bump')}));`+finish;
 return setup+`let radius=${p('sph_radius')};let cage=${p('cage_radius')};let parals=clamp(${i('parals')},2,1000);let merids=${i('merids')};if(merids==0){s.invalid=true;break;}let angle=round((1.57079632675-atan2(local.x,local.y))*0.159154943*f32(merids))/f32(merids)*6.283185307;let projected=local.x*cos(angle)+local.y*sin(angle);let perp=local.x*sin(angle)-local.y*cos(angle);s.field=length(vec2f(length(vec2f(projected,local.z))-radius,perp))-cage;for(var j=1;j<=parals/2;j++){let h=-radius+f32(j)*radius*2.0/f32(parals);let ring=sqrt(max(0.0,radius*radius-h*h));s.field=min(s.field,length(vec2f(length(local.xy)-ring,abs(local.z)+h))-cage);}`+finish;
}
