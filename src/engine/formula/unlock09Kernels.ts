/** Independent equations; source contracts and typed checks in preset-compatibility/Unlock09.validation.json. */
import type {PreparedKernel,KernelState} from './kernels';
import {nearestEven} from './primitives';
export function stepUnlock09(k:PreparedKernel,s:KernelState):void {
 const n=(key:string)=>k.p[key]!;

  const order=nearestEven(n('fold_order')),scale=n('scale');if(order===0||scale===0){s.invalid=true;return;}
  const [xx,yy,zz]=s.v.slice(0,3).map(v=>v*scale) as [number,number,number];
  const sector=nearestEven((1.57079632675-Math.atan2(xx,yy))*.159154943*order),angle=sector/order*-6.283185307;
  const x=xx*Math.cos(angle)-yy*Math.sin(angle)+n('wall_position'),y=xx*Math.sin(angle)+yy*Math.cos(angle)+n('door_position'),z=zz+n('z_add');
  if(order>=0){s.v=[x,y,z,s.v[3]];s.varyScale*=scale;}
  const a=n('wall_angle')*Math.PI/180,wallCoordinate=z*Math.sin(a)+x*Math.cos(a),wall=n('wall_width');
  let inside=Math.abs(wall)-Math.abs(wallCoordinate);
  const period=nearestEven(n('door_period'));
  if(period<=0||((sector+256)>>>0)%period===1){
   const b=n('door_angle')*Math.PI/180,side=Math.abs(y)*Math.cos(b)-z*Math.sin(b)-n('door_width'),height=-z-n('door_height'),arc=n('arc_radius');
   const radius=arc>=0?arc:n('door_width')-arc,center=arc>=0?0:arc;
   const top=Math.sqrt(height*height+(Math.abs(y)-center)**2)-radius;
   inside=Math.min(inside,Math.max(side,Math.min(height,top)));
  }
  let distance=-inside,roof=false;
  if(wall<0){const rd=Math.max(Math.abs(z+n('wall_height'))+wall,wallCoordinate+wall);roof=rd-30*s.mapPadding<=0&&n('orbit_roof')>0;distance=Math.min(distance,rd);}
  s.fieldValue=Math.max(distance,Math.abs(z+.5*n('wall_height'))-.5*n('wall_height'))/(order<0?scale:1);
  s.free[0]=roof?n('orbit_roof'):s.count*n('orbit_iterations')+n('orbit_offset');
 s.invalid||=![...s.v,...s.c,s.fieldValue,s.varyScale,...s.free].every(Number.isFinite);
}
export function unlock09Body(id:string,p:(key:string)=>string):string {
 return `let order=i32(round(${p('fold_order')}));let scale=${p('scale')};if(order==0||scale==0.0){s.invalid=true;break;}
 let q=s.v.xyz*scale;let sector=i32(round((1.57079632675-atan2(q.x,q.y))*0.159154943*f32(order)));let angle=f32(sector)/f32(order)*-6.283185307;
 let x=q.x*cos(angle)-q.y*sin(angle)+${p('wall_position')};let y=q.x*sin(angle)+q.y*cos(angle)+${p('door_position')};let z=q.z+${p('z_add')};
 if(order>=0){s.v=vec4f(x,y,z,s.v.w);s.varyScale*=scale;}
 let a=${p('wall_angle')}*0.017453292519943295;let wallCoordinate=z*sin(a)+x*cos(a);let wall=${p('wall_width')};var inside=abs(wall)-abs(wallCoordinate);
 let period=i32(round(${p('door_period')}));if(period<=0||bitcast<u32>(sector+256)%u32(max(period,1))==1u){
 let b=${p('door_angle')}*0.017453292519943295;let side=abs(y)*cos(b)-z*sin(b)-${p('door_width')};let height=-z-${p('door_height')};let arc=${p('arc_radius')};let radius=select(${p('door_width')}-arc,arc,arc>=0.0);let center=select(arc,0.0,arc>=0.0);let v=abs(y)-center;let top=sqrt(height*height+v*v)-radius;inside=min(inside,max(side,min(height,top)));}
 var distance=-inside;var roof=false;if(wall<0.0){let rd=max(abs(z+${p('wall_height')})+wall,wallCoordinate+wall);roof=rd-30.0*s.mapPadding<=0.0&&${p('orbit_roof')}>0.0;distance=min(distance,rd);}
 s.field=max(distance,abs(z+0.5*${p('wall_height')})-0.5*${p('wall_height')});if(order<0){s.field/=scale;}
 s.free.x=select(s.count*${p('orbit_iterations')}+${p('orbit_offset')},${p('orbit_roof')},roof);`;
}
