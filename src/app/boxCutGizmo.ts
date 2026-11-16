import { boxPoint, readBoxCut, type BoxCut } from '../engine/boxCut';
import type { Scene } from '../engine/scene';
import type { Vec3 } from '../engine/camera';
import { cameraBasis } from '../engine/camera';
import { cameraFov } from '../engine/cameraOptics';
import { verticalFovDegrees } from '../engine/renderSetup';
import { projectPoint, worldUnitsPerPixel } from './clipPlaneGeometry';
const NS = 'http://www.w3.org/2000/svg';
/** CSS-pixel overlay only. Gestures never participate in final rendering. */
export class BoxCutGizmo {
  readonly element = document.createElementNS(NS,'svg');
  private scene?: Scene;
  private active?: { id: number; x: number; y: number; handle: number; box: BoxCut; scene: Scene; width: number; height: number };
  constructor(private canvas: HTMLCanvasElement, private edit: (change: (s: Scene) => Scene) => void, private hold: (v: boolean) => void) {
    this.element.id='box-cut-gizmo'; this.element.setAttribute('aria-label','Box Cut i vyn');
    Object.assign(this.element.style,{position:'fixed',pointerEvents:'none',overflow:'hidden',touchAction:'none'});
    this.element.innerHTML = '<g fill="none" stroke="#ffd26a" stroke-width="1.3">'+Array.from({length:12},()=>'<line/>').join('')+'</g><g>'+Array.from({length:7},(_,i)=>`<circle data-box-handle="${i}" r="8" fill="${i===6?'#67b7ff':'#ffd26a'}" stroke="#25201b" role="slider" tabindex="0" aria-label="${i===6?'Move box':'Box wall '+['left','right','bottom','top','front','back'][i]}"/>`).join('')+'</g>';
    for (const node of this.element.querySelectorAll<SVGElement>('[data-box-handle]')) {
      Object.assign(node.style,{pointerEvents:'auto',cursor:'grab'});
      node.addEventListener('keydown',event=>{ const e=event as KeyboardEvent; if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)||!this.scene?.cutout.box)return;e.preventDefault();
        const b=this.scene.cutout.box, i=Number(node.dataset.boxHandle), value=(e.key==='ArrowUp'||e.key==='ArrowRight'?1:-1)*(e.shiftKey?0.2:1)*worldUnitsPerPixel(b.position,this.camera(this.scene),this.canvas.clientHeight)*5;
        const next=structuredClone(b);if(i===6)next.position[0]+=value;else next[i%2?'max':'min'][Math.floor(i/2)]!+=value;this.apply(next);
      });
    }
    this.element.addEventListener('pointerdown',e=>{const handle=(e.target as Element).getAttribute('data-box-handle');if(handle===null||e.button!==0||!this.scene?.cutout.box)return;e.preventDefault();e.stopPropagation();this.active={id:e.pointerId,x:e.clientX,y:e.clientY,handle:Number(handle),box:structuredClone(this.scene.cutout.box),scene:this.scene,width:this.canvas.clientWidth,height:this.canvas.clientHeight};this.element.setPointerCapture(e.pointerId);this.hold(true);});
    this.element.addEventListener('pointermove',e=>{
      const a=this.active;if(!a||e.pointerId!==a.id)return;
      const b=structuredClone(a.box), dx=e.clientX-a.x,dy=e.clientY-a.y,fine=e.shiftKey?0.2:1,c=this.camera(a.scene,a.width,a.height),units=worldUnitsPerPixel(b.position,c,a.height), basis=cameraBasis(c);
      if(a.handle===6)b.position=b.position.map((v,i)=>v+(basis.right[i]!*dx-basis.up[i]!*dy)*units*fine) as Vec3;
      else {
        const axis=Math.floor(a.handle/2), side=a.handle%2?'max':'min', center=b.min.map((v,i)=>(v+b.max[i]!)/2) as Vec3;center[axis]=b[side][axis]!;
        const world=boxPoint(b,center), delta=Math.max(units*50,1e-6), start=projectPoint(world,c,a.width,a.height),end=projectPoint(world.map((v,i)=>v+b.axes[axis]![i]!*delta) as Vec3,c,a.width,a.height);
        const sx=start&&end?end[0]-start[0]:0,sy=start&&end?end[1]-start[1]:0,length=sx*sx+sy*sy;
        b[side][axis]!+=(length>16?(dx*sx+dy*sy)/length*delta:-dy*units)*fine;
      }this.apply(b);
    });
    const finish=(cancel=false)=>{const a=this.active;if(!a)return;this.active=undefined;if(cancel)this.apply(a.box);if(this.element.hasPointerCapture(a.id))this.element.releasePointerCapture(a.id);this.hold(false);this.draw();};
    this.element.addEventListener('pointerup',()=>finish());this.element.addEventListener('pointercancel',()=>finish(true));this.element.addEventListener('lostpointercapture',()=>finish());window.addEventListener('blur',()=>finish(true));window.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.active){e.preventDefault();finish(true);}});
    document.body.append(this.element);new ResizeObserver(()=>this.draw()).observe(canvas);window.addEventListener('resize',()=>this.draw());
  }
  private apply(b: BoxCut): void { const errors:string[]=[];const box=readBoxCut(b,errors);if(box)this.edit(s=>({...s,cutout:{...s.cutout,box}})); }
  private camera(scene: Scene,width=this.canvas.clientWidth,height=this.canvas.clientHeight) {return {...scene.camera,fov_degrees:verticalFovDegrees(cameraFov(scene.camera,scene.render.fov_axis,width,height),scene.render.fov_axis,width,height)};}
  update(scene: Scene, visible=true): void {this.scene=scene;this.element.style.display=visible&&scene.cutout.box?.outline?'block':'none';this.draw();}
  private draw(): void {
    const scene=this.scene,b=scene?.cutout.box;if(!scene||!b)return;const r=this.canvas.getBoundingClientRect(),camera=this.camera(scene,r.width,r.height);
    Object.assign(this.element.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',opacity:b.enabled?'1':'0.5'});this.element.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);
    const project=(p:Vec3)=>projectPoint(boxPoint(b,p),camera,r.width,r.height), corners=Array.from({length:8},(_,i)=>project([i&1?b.max[0]:b.min[0],i&2?b.max[1]:b.min[1],i&4?b.max[2]:b.min[2]]));
    let line=0;for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit)){const node=this.element.children[0]!.children[line++]!,a=corners[i],c=corners[i|bit];node.setAttribute('visibility',a&&c?'visible':'hidden');if(a&&c)for(const [key,value] of Object.entries({x1:a[0],y1:a[1],x2:c[0],y2:c[1]}))node.setAttribute(key,String(value));}
    const center=b.min.map((v,i)=>(v+b.max[i]!)/2) as Vec3;
    for(let i=0;i<7;i++){const p=[...center] as Vec3;if(i<6)p[Math.floor(i/2)]=(i%2?b.max:b.min)[Math.floor(i/2)]!;const xy=project(p),node=this.element.children[1]!.children[i]!;node.setAttribute('visibility',xy?'visible':'hidden');if(xy){node.setAttribute('cx',String(xy[0]+(i===4?-28:i===5?28:0)));node.setAttribute('cy',String(xy[1]));}}
  }
}
