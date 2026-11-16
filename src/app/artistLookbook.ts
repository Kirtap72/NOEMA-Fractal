import type {Scene} from '../engine/scene';
import type {ImageBuffer,RenderOptions} from '../engine/engine';
import {LIGHT_RIGS,applyRig} from '../engine/lightRigs';
import {lookDevRequest,lookDevEffectiveSamples} from '../engine/lookDev';

/** Small, full-geometry stills. Only the existing rig changes; no authored quality is written. */
export function lookbookVariants(source:Scene,film:{width:number;height:number}){
 const request=lookDevRequest(source,film,{width:256,samples:1,geometry:'scene'});
 const scale=Math.min(1,256/request.size.height);
 const size={width:Math.max(1,Math.round(request.size.width*scale)),height:Math.max(1,Math.round(request.size.height*scale))};
 const variants=LIGHT_RIGS.map(rig=>{
  const applied=applyRig(request.scene,rig.id,'replace-directional',{shadows:true});
  if(!applied.ok)throw Error(applied.message);
  return {id:rig.id,name:rig.name,scene:applied.scene,summary:applied.summary};
 });
 return {variants,size,options:{...request.options,referenceFilm:size,tilePixels:4096},samples:lookDevEffectiveSamples(source,1)};
}
interface Host {
 current():Scene;
 capture():{scene:Scene;film:{width:number;height:number}};
 render(scene:Scene,size:{width:number;height:number},options:RenderOptions):Promise<ImageBuffer>;
 apply(lights:Scene['lights']):void;
 canUndo():boolean;undo():boolean;
}
/** A frozen comparison. Any live edit invalidates approval, including edits during compilation. */
export class ArtistLookbook {
 readonly element=document.createElement('dialog');
 private status=document.createElement('p');private grid=document.createElement('div');
 private update=document.createElement('button');private cancel=document.createElement('button');
 private abort?:AbortController;private source?:Scene;private applied=false;
 private undo=document.createElement('button');
 private buttons:HTMLButtonElement[]=[];busy=false;
 constructor(root:HTMLElement,private host:Host){
  const launch=document.createElement('button');launch.id='lookbook-open';launch.type='button';launch.textContent='Compare lights';launch.title='Three light rigs on the same fractal and camera. The scene only changes when you choose Use.';
  root.append(launch);this.element.id='artist-lookbook';this.element.setAttribute('aria-labelledby','lookbook-title');
  const head=document.createElement('div');head.className='lookbook-head';
  const title=document.createElement('h2');title.id='lookbook-title';title.textContent='One subject · three lights';
  const close=document.createElement('button');close.type='button';close.id='lookbook-close';close.textContent='Close';close.onclick=()=>this.element.close();head.append(title,close);
  const note=document.createElement('p');note.textContent='Same geometry, camera and material. Existing directional lights are replaced; spot and point lights, environment and ambient are kept. Soft shadows on the main light of the rig. Use makes a single undoable change.';
  this.grid.className='lookbook-grid';this.status.id='lookbook-status';this.status.setAttribute('role','status');
  this.update.type=this.cancel.type='button';this.update.id='lookbook-refresh';this.update.textContent='Refresh comparison';this.update.onclick=()=>void this.run();
  this.cancel.id='lookbook-cancel';this.cancel.textContent='Cancel';this.cancel.hidden=true;this.cancel.onclick=()=>{this.abort?.abort();this.status.textContent='Cancelling… The scene is unchanged.';};
  this.undo.type='button';this.undo.id='lookbook-undo';this.undo.textContent='Undo light choice';this.undo.disabled=true;this.undo.onclick=()=>{if(this.host.undo()){this.applied=false;this.undo.disabled=true;this.status.textContent='The light choice is undone. The original scene is restored.';this.element.dataset.state='undone';}};
  this.element.append(head,note,this.grid,this.status,this.update,this.cancel,this.undo);document.body.append(this.element);
  launch.onclick=()=>{this.element.showModal();void this.run();};
  this.element.addEventListener('close',()=>{this.abort?.abort();this.source=undefined;});
 }
 observe(){
  this.undo.disabled=this.busy||!this.host.canUndo();
  if(this.source&&this.host.current()!==this.source){
   this.source=undefined;this.abort?.abort();for(const b of this.buttons)b.disabled=true;
   if(!this.applied)this.status.textContent='The scene has changed. Refresh the comparison before choosing a light.';
  }
 }
 private async run(){
  if(this.busy)return;
  this.busy=true;this.applied=false;this.update.disabled=true;this.cancel.hidden=false;
  this.grid.replaceChildren();this.buttons=[];this.element.dataset.state='rendering';
  const abort=new AbortController();this.abort=abort;
  const timer=setTimeout(()=>{abort.abort();this.status.textContent='Time limit for small preview pictures reached. No change to the scene.';},30000);
  try{
   const captured=this.host.capture();this.source=captured.scene;
   const {variants,size,options,samples}=lookbookVariants(captured.scene,captured.film);
   const cards=variants.map(v=>{
    const card=document.createElement('section');card.className='lookbook-card';card.dataset.rig=v.id;
    const image=document.createElement('canvas');image.width=size.width;image.height=size.height;image.setAttribute('aria-label',v.name);
    const title=document.createElement('h3');title.textContent=v.name;
    const use=document.createElement('button');use.type='button';use.textContent='Use';use.disabled=true;use.setAttribute('aria-label','Use '+v.name);
    use.onclick=()=>{
     this.observe();if(!this.source||this.busy)return;
     try{this.host.apply(v.scene.lights);this.applied=true;this.source=undefined;for(const b of this.buttons)b.disabled=true;use.setAttribute('aria-pressed','true');use.textContent='Use';this.status.textContent=v.name+' is applied. Undo with Undo light choice.';this.element.dataset.state='applied';}
     catch(e){this.status.textContent=String(e);}
    };
    this.buttons.push(use);card.append(image,title,use);this.grid.append(card);return image;
   });
   for(let i=0;i<variants.length;i++){
    abort.signal.throwIfAborted();this.status.textContent=`${i+1}/3 · ${variants[i]!.name} · ${size.width}×${size.height} · ${samples} samples${samples>1?' (depth of field)':''}…`;
    const image=await this.host.render(variants[i]!.scene,size,{...options,signal:abort.signal});
    abort.signal.throwIfAborted();this.observe();if(!this.source)return;
    cards[i]!.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data),image.width,image.height),0,0);
   }
   for(const b of this.buttons)b.disabled=false;
   this.element.dataset.state='complete';this.status.textContent=`Three preview pictures · ${size.width}×${size.height} · ${samples} samples. The scene is unchanged. Choose Use on the light you prefer.`;
  }catch(e){
   this.element.dataset.state=abort.signal.aborted?'cancelled':'error';
   if(!abort.signal.aborted)this.status.textContent='The comparison could not be made: '+String(e);
   else if(this.status.textContent?.startsWith('Cancelling'))this.status.textContent='Cancelled. The scene is unchanged.';
   for(const b of this.buttons)b.disabled=true;
  }finally{clearTimeout(timer);this.busy=false;this.update.disabled=false;this.cancel.hidden=true;}
 }
}
