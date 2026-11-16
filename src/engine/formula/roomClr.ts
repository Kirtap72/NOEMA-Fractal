/** Independent equations: NewFormulas/preset-compatibility/roomclrIFS.md. */
import type {KernelInfo,KernelState,PreparedKernel} from './kernels';
import {nearestEven} from './primitives';
export const ROOM_CLR_ID='mb3d-roomclrifs' as const;
export const ROOM_CLR_INFO:KernelInfo={dimension:3,method:'difs',wMode:'preserve',hints:{deoption:20,descale:1,adescale:1,rstop:16,sipow:0},parameters:[
  {
    "name": "room_thickness",
    "label": "RoomThick",
    "default": 0.1,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "scale",
    "label": "Scale",
    "default": 2,
    "min": 0.000001,
    "max": 10000
  },
  {
    "name": "z_add",
    "label": "Z add",
    "default": 0,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "y_add",
    "label": "Y add",
    "default": 0,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "x_add",
    "label": "X add",
    "default": 0,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "pinch",
    "label": "Pinch / Punch",
    "default": 0.1,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "apply_scale_add",
    "label": "Apply scale+add",
    "default": 0,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "x_halfwidth",
    "label": "X halfwidth",
    "default": 1,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "y_halfwidth",
    "label": "Y halfwidth",
    "default": 1,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "z_halfwidth",
    "label": "Z halfwidth",
    "default": 1,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "orbit_left",
    "label": "OTClr L",
    "default": 2,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "orbit_right",
    "label": "OTClr R",
    "default": 0,
    "min": -10000,
    "max": 10000
  },
  {
    "name": "orbit_other",
    "label": "OTClr",
    "default": 1,
    "min": -10000,
    "max": 10000
  }
]};
export function stepRoomClr(k:PreparedKernel,s:KernelState):void {
 const p=k.p,scale=p.scale!;
 if(scale<=0){s.invalid=true;return;}
 const q=[s.v[0]*scale+p.x_add!,s.v[1]*scale+p.y_add!,s.v[2]*scale+p.z_add!] as const;
 const apply=nearestEven(p.apply_scale_add!)!==0;
 if(apply){s.v=[...q,s.v[3]];s.varyScale*=scale;}
 let wall=Math.abs(q[2])-p.z_halfwidth!;
 let color=q[2]<0?p.orbit_left!:p.orbit_right!;
 // Source ties belong to the later axis: y wins over z, then x over y.
 for(const axis of [1,0] as const){const d=Math.abs(q[axis])-p[axis===1?'y_halfwidth':'x_halfwidth']!;if(d>=wall){wall=d;color=p.orbit_other!;}}
 const radius=Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]);
 s.fieldValue=(Math.abs(wall+radius*p.pinch!)-p.room_thickness!)/(apply?1:scale);
 s.free[0]=color;
 s.invalid||=![...s.v,s.fieldValue,s.varyScale,...s.free].every(Number.isFinite);
}
export function roomClrBody(p:(key:string)=>string):string {
 return `let scale=${p('scale')};if(scale<=0.0){s.invalid=true;break;}
 let q=s.v.xyz*scale+vec3f(${p('x_add')},${p('y_add')},${p('z_add')});
 let apply=i32(round(${p('apply_scale_add')}))!=0;if(apply){s.v=vec4f(q,s.v.w);s.varyScale*=scale;}
 var wall=abs(q.z)-${p('z_halfwidth')};var color=select(${p('orbit_right')},${p('orbit_left')},q.z<0.0);
 let dy=abs(q.y)-${p('y_halfwidth')};if(dy>=wall){wall=dy;color=${p('orbit_other')};}
 let dx=abs(q.x)-${p('x_halfwidth')};if(dx>=wall){wall=dx;color=${p('orbit_other')};}
 let radius=sqrt((q.x*q.x+q.y*q.y)+q.z*q.z);s.field=abs(wall+radius*${p('pinch')})-${p('room_thickness')};if(!apply){s.field/=scale;}s.free.x=color;`;
}
