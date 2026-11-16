import {cameraBasis} from '../engine/camera';
import type {SceneCamera,Vec3} from '../engine/camera';
const turn=(v:Vec3,axis:Vec3,angle:number):Vec3=>{const n=Math.hypot(...axis),a=axis.map(x=>x/n) as Vec3,c=Math.cos(angle),s=Math.sin(angle),d=v.reduce((sum,x,i)=>sum+x*a[i]!,0),cross=[a[1]*v[2]-a[2]*v[1],a[2]*v[0]-a[0]*v[2],a[0]*v[1]-a[1]*v[0]];return v.map((x,i)=>x*c+cross[i]!*s+a[i]!*d*(1-c)) as Vec3;};
export function flyLook(camera:SceneCamera,yaw:number,pitch:number):SceneCamera {
 const b=cameraBasis(camera),length=Math.hypot(...camera.target.map((v,i)=>v-camera.position[i]!)),f=turn(b.forward,camera.up,yaw),right=turn(b.right,camera.up,yaw);const elevation=Math.asin(Math.max(-1,Math.min(1,f.reduce((s,v,i)=>s+v*camera.up[i]!/Math.hypot(...camera.up),0))));const limit=Math.PI/2-.001;const p=Math.max(-limit-elevation,Math.min(limit-elevation,pitch));const forward=turn(f,right,p);
 return {...camera,target:camera.position.map((v,i)=>v+forward[i]!*length) as Vec3};
}
/** Free translation moves position and look target together; independent of orbit distance clamping. */
export function flyMove(camera:SceneCamera,forward:number,side:number,vertical:number,seconds:number,speed:number):SceneCamera {
 const b=cameraBasis(camera),n=Math.max(1,Math.hypot(forward,side,vertical)),step=Math.min(.05,Math.max(0,seconds))*speed/n,up=camera.up.map(v=>v/Math.hypot(...camera.up));const delta=b.forward.map((v,i)=>(v*forward+b.right[i]!*side+up[i]!*vertical)*step);
 return {...camera,position:camera.position.map((v,i)=>v+delta[i]!) as Vec3,target:camera.target.map((v,i)=>v+delta[i]!) as Vec3};
}
export class FlyCameraControl {
 active=false;private held=new Set<string>();private last=0;private speed=document.createElement('input');private button=document.createElement('button');
 constructor(root:HTMLElement,private canvas:HTMLCanvasElement,private changed:(active:boolean)=>void,private allowed:()=>boolean){
  canvas.tabIndex=0;this.button.type='button';this.button.textContent='Fly through the fractal';this.button.onclick=()=>this.setActive(!this.active);root.append(this.button);
  const row=document.createElement('label');row.textContent='Flight speed (units/s)';this.speed.type='number';this.speed.min='0.000000000001';this.speed.max='1000000';this.speed.step='any';this.speed.value='.5';this.speed.setAttribute('aria-label','Flight speed (units/s)');row.append(this.speed);root.append(row);
  const help=document.createElement('small');help.textContent='Fly: click in the picture, WASD forward/sideways, Q/E down/up. Left drag looks around. Shift gives fine speed. The wheel changes speed. Esc returns to orbit.';root.append(help);
  canvas.addEventListener('keydown',e=>{if(!this.active||!this.allowed()||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='Escape'){this.setActive(false);e.preventDefault();return;}if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){this.held.add(e.code);e.preventDefault();}});
  canvas.addEventListener('keyup',e=>this.held.delete(e.code));canvas.addEventListener('blur',()=>this.held.clear());window.addEventListener('blur',()=>this.held.clear());
 }
 setActive(active:boolean){if(this.active===active||active&&!this.allowed())return;this.active=active;this.held.clear();this.last=performance.now();this.button.textContent=active?'End flight':'Fly through the fractal';this.button.setAttribute('aria-pressed',String(active));this.changed(active);if(active)this.canvas.focus({preventScroll:true});}
 get moving(){return this.active&&['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE'].some(k=>this.held.has(k));}
 adjustSpeed(delta:number){const v=Number(this.speed.value);if(v>0)this.speed.value=String(Math.max(1e-12,Math.min(1e6,v*Math.exp(Math.max(-.25,Math.min(.25,-delta*.001))))));}
 tick(now:number,camera:SceneCamera):SceneCamera|undefined {const seconds=(now-this.last)/1000;this.last=now;if(!this.moving||!this.allowed())return;const held=(k:string)=>Number(this.held.has(k));const speed=Number(this.speed.value);if(!(speed>0&&speed<=1e6))return;return flyMove(camera,held('KeyW')-held('KeyS'),held('KeyD')-held('KeyA'),held('KeyE')-held('KeyQ'),seconds,speed*(this.held.has('ShiftLeft')||this.held.has('ShiftRight')?.1:1));}
}
