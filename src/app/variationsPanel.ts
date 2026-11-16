import {DiscoveryQueue} from '../engine/discoveryQueue';
import {captureVariationSource,generateVariation,auditVariationControls,copyVariationScene,classifyVariationImage,FIND_REASON_LABELS} from '../engine/variations';
import type {FindReason} from '../engine/variations';
import {FindShelf} from '../engine/variationFinds';
import type {VariationSource,VariationCandidate,VariationOptions} from '../engine/variations';
import type {Scene} from '../engine/scene';
import type {Formula} from '../engine/formula/types';
import './variationsPanel.css';

export interface VariationImage {url:string;milliseconds:number;hitShare:number;signature:number[];shaderModules:number;colorSpread:number;normalSpread:number}
interface Item {candidate?:VariationCandidate;image?:VariationImage;large?:VariationImage;error?:string;slot:number;kept?:boolean;found?:readonly FindReason[]}
export interface VariationsHandlers {
 formulas():readonly Formula[];capture(signal:AbortSignal):Promise<{scene:Scene;frame:string;identity:Scene;aspect:number}>;
 current():Scene;render(scene:Scene,width:number,height:number,signal:AbortSignal):Promise<VariationImage>;
 apply(source:VariationSource,candidate:VariationCandidate):void;undo():void;
 save(scene:Scene,png:string,title:string,notes:string):Promise<string>;
}
export const VARIATION_CONFIRMATION='Apply the geometry of the variation to the scene? Camera and locked picture appearance are preserved. The keyframes of the animation are preserved; Undo restores the scene.';
export function imageDifference(a:number[],b:number[]):number {return a.length===b.length&&a.length?a.reduce((n,v,i)=>n+Math.abs(v-b[i]!),0)/a.length:1;}
const stop=(s:AbortSignal)=>s.throwIfAborted();

/** Small gallery on the existing renderer fence; no second device or cloned map payload per candidate. */
export class VariationsPanel {
 private overlay=document.createElement('div');private cells=document.createElement('div');private detail=document.createElement('div');private history=document.createElement('div');
 private status=document.createElement('output');private seed=document.createElement('input');private strength=document.createElement('select');private color=document.createElement('input');private material=document.createElement('input');
 private queue=new DiscoveryQueue<Item,VariationImage>();private session=0;private controller?:AbortController;private source?:VariationSource;private identity?:Scene;
 private original?:VariationImage;private items:Item[]=[];private selected?:Item;private ancestors:Item[]=[];private shortlist:Item[]=[];private parent?:VariationCandidate;
 private opener?:HTMLElement;
 private finds=new FindShelf<Item>();private foundBox=document.createElement('div');private keepFinds=document.createElement('input');
 constructor(root:HTMLElement,private h:VariationsHandlers){
  root.append(this.button('Create variations',()=>{void this.open();}));
  this.overlay.id='variations-gallery';this.overlay.hidden=true;this.overlay.setAttribute('role','dialog');this.overlay.setAttribute('aria-modal','true');this.overlay.setAttribute('aria-label','Fractal variations');
  const panel=document.createElement('div');panel.className='variations-panel';const heading=document.createElement('h2');heading.textContent='Fractal variations';
  const note=document.createElement('p');note.textContent='Starts from the most recently shown picture. Animation is paused: the visible moment is captured as a still picture. Camera, light, background, maps and final quality are locked. Keys are not changed by preview or Apply; saved variants have Animation 2.0 turned off.';
  this.seed.value='NOEMA-FV2A';this.seed.maxLength=128;this.strength.add(new Option('Careful','gentle'));this.strength.add(new Option('Moderate','moderate'));this.strength.add(new Option('Experimental','experimental'));this.color.type=this.material.type=this.keepFinds.type='checkbox';this.keepFinds.checked=true;
  const settings=document.createElement('div');settings.className='variations-settings';settings.append(this.label('Seed',this.seed),this.label('Strength',this.strength),this.label('Vary colour/gradient',this.color),this.label('Vary material',this.material),this.label('Save unexpected finds',this.keepFinds));
  for(const input of [this.seed,this.strength,this.color,this.material])input.addEventListener('change',()=>this.cancel('Setting changed. Generate a new batch; choices already made are preserved.'));
  const actions=document.createElement('div');actions.className='variations-actions';actions.append(this.button('Generate 8',()=>this.generate()),this.button('Cancel variations',()=>this.cancel('Cancelled. GPU work already sent may finish; late results are ignored.')),this.button('Capture the current view again',()=>{void this.open();}),this.button('Close variations',()=>this.close()));
  this.foundBox.className='variations-found';this.foundBox.hidden=true;this.cells.className='variations-cells';this.detail.className='variations-detail';this.history.className='variations-history';panel.append(heading,note,settings,actions,this.status,this.history,this.foundBox,this.cells,this.detail);this.overlay.append(panel);document.body.append(this.overlay);
  this.overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();this.close();}if(e.key==='Tab'){const focus=[...this.overlay.querySelectorAll<HTMLElement>('button,input,select')].filter(e=>!e.hasAttribute('disabled')&&e.getClientRects().length);if(e.shiftKey&&document.activeElement===focus[0]){e.preventDefault();focus.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===focus.at(-1)){e.preventDefault();focus[0]?.focus();}}});
 }
 private button(text:string,run:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=run;return b;}
 private label(text:string,input:HTMLElement){const l=document.createElement('label');l.append(text,input);input.setAttribute('aria-label',text);return l;}
 private options():VariationOptions{return {seed:this.seed.value,strength:this.strength.value as VariationOptions['strength'],color:this.color.checked,material:this.material.checked};}
 private cancel(message:string){this.session++;this.controller?.abort();this.queue.cancel();for(const item of this.items)if(!item.image&&!item.error)item.error='Cancelled';this.overlay.dataset.busy='false';delete this.overlay.dataset.complete;this.status.textContent=message;this.redraw();}
 private close(){this.cancel('Closed');this.overlay.hidden=true;this.opener?.focus();}
 private checkIdentity(){if(this.identity!==this.h.current())throw Error('The scene has changed. Capture the current view again before the next action.');}
 async open(){
  this.opener=document.activeElement as HTMLElement;this.cancel('Capturing the most recently shown scene…');this.overlay.hidden=false;this.seed.focus();const token=this.session,controller=this.controller=new AbortController();
  this.source=undefined;this.original=undefined;this.items=[];this.selected=undefined;this.cells.replaceChildren();this.detail.replaceChildren();delete this.overlay.dataset.results;delete this.overlay.dataset.source;
  try{
   const captured=await this.h.capture(controller.signal);stop(controller.signal);if(token!==this.session)return;
   this.source=captureVariationSource(captured.scene,this.h.formulas(),captured.frame,captured.aspect);this.finds.keepOnly(this.source.id);this.identity=captured.identity;this.original=undefined;this.items=[];this.selected=undefined;this.parent=undefined;this.ancestors=[];this.shortlist=[];this.redraw();
   this.overlay.dataset.source=this.source.id;this.overlay.dataset.frame=captured.frame;
   const audit=auditVariationControls(this.source.scene,this.h.formulas());this.status.textContent=`${captured.frame} · ${audit.controls.length} reviewed geometry controls. The original is unchanged.`;
   this.original=await this.h.render(this.source.scene,224,this.height(224),controller.signal);stop(controller.signal);if(token!==this.session)return;this.redraw();
   if(!audit.controls.length)this.status.textContent='No reviewed geometry controls for this scene. No other fractal replaces the source.';
  }catch(e){if(token===this.session)this.status.textContent=String(e instanceof Error?e.message:e);}
 }
 private height(width:number){return Math.max(48,Math.round(width/(this.source?.aspect??4/3)));}
 private generate(parent?:VariationCandidate){
  if(!this.source||!this.original){this.status.textContent='Wait until the source picture is ready.';return;}
  try{this.checkIdentity();}catch(e){this.status.textContent=String(e);return;}
  this.cancel('Generating…');const token=this.session,source=this.source,options=this.options();this.parent=parent;
  this.items=Array.from({length:8},(_,slot)=>({slot}));this.selected=undefined;this.redraw();this.overlay.dataset.busy='true';delete this.overlay.dataset.savedId;let completed=0;
  this.queue.request(this.items,async(item,signal)=>{
   this.checkIdentity();let last='';
   // A picture the gate sets aside although it is valid (flat, single-coloured, too alike) is kept as an "unexpected find" if the artist wants that.
   let pending:{candidate:VariationCandidate;image:VariationImage;reasons:readonly FindReason[]}|undefined;
   const keep=()=>{if(!pending||!this.keepFinds.checked||token!==this.session)return;const p=pending;this.finds.add({key:JSON.stringify(p.candidate.recipe.changes.map(d=>[d.step,d.parameter,d.after])),sourceId:source.id,reasons:p.reasons,signature:p.image.signature,item:{slot:-1,candidate:p.candidate,image:p.image,found:p.reasons}});};
   try{
   for(let attempt=0;attempt<3;attempt++){
    stop(signal);const candidate=generateVariation(source,this.h.formulas(),options,item.slot,attempt,parent);item.candidate=candidate;
    const signature=(c:VariationCandidate)=>JSON.stringify(c.recipe.changes.map(d=>[d.step,d.parameter,d.after]));
    if(this.items.some(i=>i!==item&&i.image&&i.candidate&&signature(i.candidate)===signature(candidate))){last='The same numeric change as an earlier choice';continue;}
    const image=await this.h.render(candidate.scene,224,this.height(224),signal);stop(signal);this.checkIdentity();
    const originals=[this.original!,...this.items.filter(i=>i!==item&&i.image).map(i=>i.image!)];
    const difference=Math.min(...originals.map(i=>imageDifference(image.signature,i.signature)));
    const verdict=classifyVariationImage(image,difference);
    if(verdict.kind==='unexpected'&&!pending)pending={candidate,image,reasons:verdict.reasons};
    if(verdict.kind!=='ok'){last=verdict.problem!;continue;}
    return image;
   }throw Error(last+' after three limited attempts.');
   }finally{keep();}
  },(item,result)=>{
   if(token!==this.session)return;if(result instanceof Error)item.error=result.message;else item.image=result;completed++;this.redraw();this.status.textContent=`${completed}/8 · ${this.items.filter(i=>i.error).length} limited/failed · Source ${source.frame}`;
   this.overlay.dataset.results=JSON.stringify(this.items.map(i=>({slot:i.slot,recipe:i.candidate?.recipe,error:i.error,...(i.image?{milliseconds:i.image.milliseconds,hitShare:i.image.hitShare,shaderModules:i.image.shaderModules,colorSpread:i.image.colorSpread,normalSpread:i.image.normalSpread,difference:imageDifference(i.image.signature,this.original!.signature)}:{})})));
  },()=>{if(token===this.session){this.overlay.dataset.complete='true';this.overlay.dataset.busy='false';this.status.textContent+=' · done';}});
 }
 private redraw(){
  this.cells.replaceChildren();if(this.original){const cell=this.button('Original',()=>this.select(undefined));const img=document.createElement('img');img.src=this.original.url;img.alt='Original · locked camera';cell.prepend(img);cell.dataset.original='true';this.cells.append(cell);}
  for(const item of this.items){const cell=this.button('',()=>this.select(item));cell.dataset.slot=String(item.slot);cell.className='variation-card'+(this.selected===item?' selected':'');cell.setAttribute('aria-label','Variation '+(item.slot+1));if(item.image){const img=document.createElement('img');img.src=item.image.url;img.alt='Variation '+(item.slot+1);cell.append(img);}const text=document.createElement('span');text.textContent=`${item.slot+1} · ${item.error??(item.image?Math.round(item.image.milliseconds)+' ms':'Waiting for GPU…')}`;cell.append(text);this.cells.append(cell);}
  this.drawFinds();
  this.history.replaceChildren();for(const item of [...new Set([...this.ancestors,...this.shortlist])])this.history.append(this.button(`Go back to ${item.candidate!.recipe.id}${item.kept?' ★':''}`,()=>this.select(item)));
  this.showSelected();
 }
 /** The shelf of unexpected finds: valid pictures the quality gate set aside. Selecting one works like selecting any variation (inspect, develop, apply, save). */
 private drawFinds(){
  const found=this.source?this.finds.list(this.source.id):[];this.foundBox.replaceChildren();this.foundBox.hidden=!found.length;this.foundBox.dataset.count=String(found.length);this.overlay.dataset.finds=JSON.stringify(found.map(e=>e.reasons));
  if(!found.length)return;
  const head=document.createElement('div');head.className='variations-found-head';const title=document.createElement('h3');title.textContent=`Unexpected finds (${found.length})`;head.append(title,this.button('Clear finds',()=>{this.finds.clear();this.selected=this.selected?.found?undefined:this.selected;this.redraw();}));
  const row=document.createElement('div');row.className='variations-found-row';
  for(const e of found){const item=e.item,cell=this.button('',()=>this.select(item));cell.className='variation-card variation-found'+(this.selected===item?' selected':'');cell.dataset.find=e.reasons.join(',');cell.setAttribute('aria-label','Unexpected find: '+e.reasons.map(r=>FIND_REASON_LABELS[r as FindReason]).join(', '));const img=document.createElement('img');img.src=item.image!.url;img.alt='';const cap=document.createElement('small');cap.textContent=e.reasons.map(r=>FIND_REASON_LABELS[r as FindReason]).join(' · ');cell.append(img,cap);row.append(cell);}
  this.foundBox.append(head,row);
 }
 private select(item?:Item){this.selected=item;this.redraw();if(!item?.image||item.large||this.queue.busy)return;
  const token=this.session;this.queue.request([item],async(i,signal)=>{this.checkIdentity();return this.h.render(i.candidate!.scene,560,this.height(560),signal);},(i,result)=>{if(token!==this.session)return;if(result instanceof Error)this.status.textContent=result.message;else i.large=result;if(this.selected===i)this.showSelected();},()=>{});
 }
 private showSelected(){
  this.detail.replaceChildren();const item=this.selected,image=item?(item.large??item.image):this.original;if(!image)return;
  const images=document.createElement('div');images.className='variation-comparison';for(const [url,alt] of [[this.original!.url,'Original'],[image.url,item?'Chosen variation':'Original']]){const img=document.createElement('img');img.src=url!;img.alt=alt!;images.append(img);}this.detail.append(images);
  if(!item?.candidate||item.error)return;const candidate=item.candidate;
  if(item.found){const why=document.createElement('p');why.textContent='Unexpected find ('+item.found.map(r=>FIND_REASON_LABELS[r]).join(', ')+'): valid mathematics and a real picture that the selection would otherwise have discarded. You can develop it further like any variation.';this.detail.append(why);}
  const info=document.createElement('pre');info.textContent=`Generation ${candidate.recipe.generation} · ${candidate.recipe.id} · parent ${candidate.recipe.parentId??'original'}\n`+candidate.recipe.changes.map(d=>`${d.label}: ${d.before} → ${d.after}`).join('\n');this.detail.append(info);
  const develop=this.button('Develop the chosen one',()=>{if(!this.ancestors.includes(item))this.ancestors.push(item);this.generate(candidate);});
  const apply=this.button('Apply to scene',()=>{try{this.checkIdentity();if(!confirm(VARIATION_CONFIRMATION))return;this.cancel('Applying…');this.h.apply(this.source!,candidate);this.close();}catch(e){this.status.textContent=String(e);}});
  const save=this.button('Save in My fractals',()=>{save.disabled=true;const token=this.session;const r=candidate.recipe,notes=JSON.stringify({version:r.version,id:r.id,sourceId:r.sourceId,parentId:r.parentId,generation:r.generation,catalog:r.catalog,options:r.options});void this.h.save(copyVariationScene(candidate.scene),item.image!.url,'Variation '+r.id,notes).then(id=>{if(token===this.session){this.overlay.dataset.savedId=id;this.status.textContent='Saved in My fractals with a complete still scene and a real thumbnail.';}}).catch(e=>{if(token===this.session)this.status.textContent=String(e);}).finally(()=>{save.disabled=false;});});
  const keep=this.button(item.kept?'Release favourite':'Keep favourite',()=>{item.kept=!item.kept;if(item.kept)this.shortlist.push(item);else this.shortlist=this.shortlist.filter(i=>i!==item);this.redraw();});
  this.detail.append(develop,apply,save,keep,this.button('Undo scene change',()=>this.h.undo()));
 }
}
