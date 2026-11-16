/** Independent normalized equations: NewFormulas/preset-compatibility/*.md. */
import type {PreparedKernel,KernelState} from './kernels';
import {applyMatrix,nearestEven} from './primitives';
export function stepGatewayKernel(k:PreparedKernel,s:KernelState):void{
  const p=k.p,xyz=s.v.slice(0,3),n=(name:string)=>p[name]!,integer=(name:string)=>nearestEven(n(name));
  const rotated=(q:number[])=>applyMatrix(k.matrices[0]!,q);
  const add=()=>xyz.map((t,i)=>t+n('add_'+'xyz'[i]));
  const commit=(q:number[])=>{s.v=[q[0]!,q[1]!,q[2]!,s.v[3]];};
  if(k.id==='mb3d-amazingifs'){
    let q=xyz.map((t,i)=>{const f=n('fold_'+'zyx'[i]);return Math.abs(t+f)-Math.abs(t-f)-t;});
    q=rotated(q.map((t,i)=>t+n('add_'+'xyz'[i])));
    const rr=q.reduce((a,t)=>a+t*t,0);
    let scale=1/rr;if(scale>1){scale=Math.min(scale,n('p_1_min_r_gt_or_eq_1'));q=q.map(t=>t*scale);s.varyScale=Math.abs(s.varyScale*scale);}
    commit(q);
  }else if(k.id==='mb3d-polyfold-symifs'){
    const q=rotated(add()),order=integer('polyfold_order');if(order===0){s.invalid=true;return;}
    const sector=nearestEven((n('atan2_fixer')-Math.atan2(q[1]!,q[0]!))*.159154943*order);
    const angle=sector/order*6.283185307,c=Math.cos(angle),t=Math.sin(angle);
    commit([q[0]!*c-q[1]!*t,(q[0]!*t+q[1]!*c)*(sector&1?1:-1),q[2]!]);
  }else if(k.id==='mb3d-heightmapifs'){
    const q=rotated(xyz),f=(key:string)=>Math.fround(n(key)),h=f('h_scale'),off=f('h_offset');
    if(Math.abs(q[2]!+off-.5*h)>Math.abs(h)+s.mapPadding)s.fieldValue=.5*h-off-q[2]!;
    else{
      const color=k.sampleField?.(integer('map_nr'),q[0]!*f('x_scale')-f('x_offset'),q[1]!*f('y_scale')-f('y_offset'));
      const channel=integer('map_channel_0_2')&3,trap=integer('otrap_channel_0_2')&3;
      if(!color||channel>2||trap>2){s.invalid=true;return;}
      s.fieldValue=color[channel]!*h-off-q[2]!;
      s.free[0]=(color[trap]!+f('otrap_offset'))*f('otrap_multiplier');
    }
  }else{
    const scale=n('scale'),q=xyz.map((t,i)=>scale*t+n('xyz'[i]+'_add'));
    const apply=integer('apply_scale_add')!==0;
    if(apply){commit(q);s.varyScale*=scale;}
    if(k.id==='mb3d-roundedbox'){
      const border=n('border');s.fieldValue=Math.hypot(...q.map((t,i)=>Math.max(0,Math.abs(t)-n('xyz'[i]+'_halfwidth')+border)))-border;
      const channel=integer('otrap_option_0_3')&3;
      s.free[0]=[s.queryThreshold,...s.v.slice(0,3)][channel]!*Math.fround(n('otrap_scale'))+Math.fround(n('otrap_offset'));
    }else{
      for(const [a,b] of [[0,2],[0,1],[2,1]])if(q[a!]!+q[b!]!<=0)[q[a!],q[b!]]=[-q[b!]!,-q[a!]!];
      for(const [a,b] of [[0,2],[0,1],[2,1]])if(q[a!]!-q[b!]!<0)[q[a!],q[b!]]=[q[b!]!,q[a!]!];
      let [x,y,z]=[q[1]!,q[0]!,q[2]!];
      for(const [key,axis] of [['rotate_xz','z'],['rotate_xy','y']]){
        const angle=n(key!)*Math.PI/180,c=Math.cos(angle),t=Math.sin(angle),v=axis==='z'?z:y;
        const old=x;x=old*c-v*t;if(axis==='z')z=old*t+v*c;else y=old*t+v*c;
      }
      y-=n('sub_y');z-=n('sub_z');
      const tube=Math.hypot(y,z)-n('radius'),sphere=Math.hypot(Math.abs(x)-n('sphere_pos'),y,z)-n('sphere_r');
      s.fieldValue=Math.min(tube,sphere);s.free[0]=sphere>tube?n('otclr_tube'):n('otclr_sphere');
    }
    if(!apply)s.fieldValue/=scale;
  }
  s.invalid ||= ![...s.v,s.fieldValue,s.varyScale,...s.free].every(Number.isFinite);
}
export function gatewayBody(id:string,p:(name:string)=>string,m:readonly string[]):string{
  const n=(name:string)=>p(name),i=(name:string)=>`i32(round(${p(name)}))`;
  const add=['mb3d-amazingifs','mb3d-polyfold-symifs'].includes(id)?`vec3f(${n('add_x')},${n('add_y')},${n('add_z')})`:'';
  if(id==='mb3d-amazingifs')return `let f=vec3f(${n('fold_z')},${n('fold_y')},${n('fold_x')});var q=${m[0]}*(abs(s.v.xyz+f)-abs(s.v.xyz-f)-s.v.xyz+${add});let rr=dot(q,q);var k=${n('p_1_min_r_gt_or_eq_1')};if(rr>0.0){k=1.0/rr;}if(rr==0.0||k>1.0){k=min(k,${n('p_1_min_r_gt_or_eq_1')});q*=k;s.varyScale=abs(s.varyScale*k);}s.v=vec4f(q,s.v.w);`;
  if(id==='mb3d-polyfold-symifs')return `let q=${m[0]}*(s.v.xyz+${add});let order=${i('polyfold_order')};if(order==0){s.invalid=true;break;}let sector=i32(round((${n('atan2_fixer')}-atan2(q.y,q.x))*0.159154943*f32(order)));let angle=f32(sector)/f32(order)*6.283185307;let c=cos(angle);let t=sin(angle);s.v=vec4f(q.x*c-q.y*t,(q.x*t+q.y*c)*select(-1.0,1.0,(sector&1)!=0),q.z,s.v.w);`;
  if(id==='mb3d-heightmapifs')return `let q=${m[0]}*s.v.xyz;let h=${n('h_scale')};let off=${n('h_offset')};if(abs(q.z+off-0.5*h)>abs(h)+s.mapPadding){s.field=0.5*h-off-q.z;}else{let c=sampleFormulaField(${i('map_nr')},q.xy*vec2f(${n('x_scale')},${n('y_scale')})-vec2f(${n('x_offset')},${n('y_offset')}));let ch=${i('map_channel_0_2')}&3;let tr=${i('otrap_channel_0_2')}&3;if(c.w==0.0||ch>2||tr>2){s.invalid=true;break;}s.field=c[ch]*h-off-q.z;s.free.x=(c[tr]+${n('otrap_offset')})*${n('otrap_multiplier')};}`;
  const start=`let scale=${n('scale')};var q=scale*s.v.xyz+vec3f(${n('x_add')},${n('y_add')},${n('z_add')});let apply=${i('apply_scale_add')}!=0;if(apply){s.v=vec4f(q,s.v.w);s.varyScale*=scale;}`;
  if(id==='mb3d-roundedbox')return start+`let border=${n('border')};s.field=length(max(vec3f(0.0),abs(q)-vec3f(${n('x_halfwidth')},${n('y_halfwidth')},${n('z_halfwidth')})+vec3f(border)))-border;let values=vec4f(s.queryThreshold,s.v.xyz);s.free.x=values[${i('otrap_option_0_3')}&3]*${n('otrap_scale')}+${n('otrap_offset')};if(!apply){s.field/=scale;}`;
  const reflections=[[0,2],[0,1],[2,1]].map(([a,b])=>`if(q[${a}]+q[${b}]<=0.0){let v=q;q[${a}]=-v[${b}];q[${b}]=-v[${a}];}`).join('');
  const sort=[[0,2],[0,1],[2,1]].map(([a,b])=>`if(q[${a}]-q[${b}]<0.0){let v=q;q[${a}]=v[${b}];q[${b}]=v[${a}];}`).join('');
  return start+reflections+sort+`q=vec3f(q.y,q.x,q.z);let a=${n('rotate_xz')}*0.017453292519943295;let b=${n('rotate_xy')}*0.017453292519943295;q=vec3f(q.x*cos(a)-q.z*sin(a),q.y,q.x*sin(a)+q.z*cos(a));q=vec3f(q.x*cos(b)-q.y*sin(b),q.x*sin(b)+q.y*cos(b)-${n('sub_y')},q.z-${n('sub_z')});let tube=length(q.yz)-${n('radius')};let sphere=length(vec3f(abs(q.x)-${n('sphere_pos')},q.yz))-${n('sphere_r')};s.field=min(tube,sphere);s.free.x=select(${n('otclr_sphere')},${n('otclr_tube')},sphere>tube);if(!apply){s.field/=scale;}`;
}
