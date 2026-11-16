import {generateSynthesisBatch,describeSynthesizedDefinition} from '../engine/synthesizedFormula';
import type {SynthesizedDefinition} from '../engine/synthesizedFormula';
import {synthesizedCandidateScene} from '../engine/synthesizedScene';
import {buildDiscoveryCatalog} from '../engine/discoveryCatalog';
import {generateDiscoveryBatch,candidateFromRecipe} from '../engine/discoveryCandidates';
import type {DiscoveryCandidate,DiscoveryRecipe,DiscoveryOptions} from '../engine/discoveryCandidates';
import {DiscoveryQueue} from '../engine/discoveryQueue';
import {createEngine} from '../engine/engine';
import type {Engine} from '../engine/engine';
import type {Formula} from '../engine/formula/types';
import {measureThumbnail} from '../engine/thumbnailMeasures';
import {FULL_VIEWPORT_FEATURES} from '../engine/viewportQuality';
import type {Scene} from '../engine/scene';
import {serializeScene} from '../engine/scene';
import './discoveryGallery.css';

interface GalleryImage {url:string;scene:Scene;milliseconds:number;hitShare:number;framingAttempt:number;width:number;height:number}
export interface DiscoveryChoice {id:string;scene:Scene;signature:string;definition?:SynthesizedDefinition;parentDefinition?:SynthesizedDefinition;variation?:DiscoveryCandidate}
interface GalleryItem {candidate:DiscoveryChoice;image?:GalleryImage;large?:GalleryImage;error?:string;kept:boolean}
interface GalleryRequest {item:GalleryItem;large:boolean}
export interface DiscoveryGalleryHandlers {
 library():readonly Formula[];currentScene():Scene;apply(candidate:DiscoveryChoice,frameCamera:boolean):void;
 saveFormula?(definition:SynthesizedDefinition,thumbnail:string):Promise<void>;savePreset?(scene:Scene,thumbnail:string):Promise<void>;undo():void;
 beforePreview(signal:AbortSignal):Promise<void>;afterPreview():void;available():boolean;
}
const KEEP_KEY='fraktal-discovery-fg2a-kept';
const QUALITY={samples_per_pixel:1,max_steps:144,shadow_steps:16,step_factor:.65,hit_precision:.0015,normal_epsilon:.0015,seed:0};
const FEATURES={...FULL_VIEWPORT_FEATURES,shadows:false,occlusion:false,reflections:false,secondaryReflections:false,simpleLight:false,maxTransportBounces:0};
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Cancelled','AbortError');};

/** Bounded visual extension at the existing Formula Generator entry point. Never selects the authored scene implicitly. */
export class DiscoveryGallery {
 private overlay=document.createElement('div');private cells=document.createElement('div');private selectedBox=document.createElement('div');
 private modePresentation=()=>{};private status=document.createElement('output');private seed=document.createElement('input');private family=document.createElement('select');
 private mode=document.createElement('select');private strength=document.createElement('select');private steps=document.createElement('select');
 private items:GalleryItem[]=[];private selected:GalleryItem|undefined;private queue=new DiscoveryQueue<GalleryRequest,GalleryImage>();
 private engine:Engine|undefined;private cache=new Map<string,GalleryImage>();private catalog:ReturnType<typeof buildDiscoveryCatalog>;
 private progress=0;private batchGeneration=0;private kept:DiscoveryRecipe[]=[];private applyButton!:HTMLButtonElement;
 constructor(root:HTMLElement,private h:DiscoveryGalleryHandlers){
  this.catalog=buildDiscoveryCatalog(h.library());
  const title=document.createElement('strong');title.textContent='Formula discovery';root.append(title,this.button('Discover new mathematics',()=>{this.batchGeneration++;this.overlay.hidden=false;this.seed.focus();}));
  this.overlay.id='discovery-gallery';this.overlay.hidden=true;this.overlay.setAttribute('role','dialog');this.overlay.setAttribute('aria-modal','true');this.overlay.setAttribute('aria-label','Formula generator 2.0');
  const panel=document.createElement('div');panel.className='discovery-panel';const heading=document.createElement('h2');heading.textContent='Discover new mathematics';
  const note=document.createElement('p');note.textContent='Create new mathematical iteration definitions. Read the operations, develop a chosen formula and save its mathematics separately from a picture preset. Preview keeps your scene. Apply replaces the chain with Undo.';
  const settings=document.createElement('div');settings.className='discovery-settings';
  this.seed.type='text';this.seed.value='FG2B-MATH';this.seed.maxLength=128;settings.append(this.label('Seed',this.seed));
  for(const [v,n] of [['synthesis','New mathematical formulas'],['variety','Existing formulas · varied selection'],['family','Existing formula · variation'],['hybrid','Existing formulas · compatible hybrid']])this.mode.add(new Option(n,v));settings.append(this.label('Discovery mode',this.mode));
  for(const entry of this.catalog.entries.filter(e=>e.eligible))this.family.add(new Option(entry.name,entry.id));settings.append(this.label('Family',this.family));
  for(const [v,n] of [['0.25','Careful'],['0.55','Balanced'],['0.9','Adventurous (limited)']])this.strength.add(new Option(n,v));this.strength.value='0.55';settings.append(this.label('Variation',this.strength));
  this.steps.add(new Option('Simple','1'));this.steps.add(new Option('Extended','2'));this.steps.value='2';settings.append(this.label('Complexity',this.steps));
  this.modePresentation=()=>{const novel=this.mode.value==='synthesis';heading.textContent=novel?'Discover new mathematics':'Variations of existing formulas';note.textContent=novel?'Create new mathematical iteration definitions. Develop a chosen source; Save formula keeps the mathematics and Save candidate preset keeps the scene. Apply is explicit with Undo.':'Choose and vary already installed formulas. These recipes are existing formula variations, not new mathematical definitions.';};this.family.disabled=true;this.mode.onchange=()=>{if(this.mode.value==='hybrid')this.steps.value='2';this.steps.disabled=this.mode.value==='hybrid';this.family.disabled=this.mode.value==='synthesis'||this.mode.value==='variety';this.modePresentation();};
  const actions=document.createElement('div');actions.className='discovery-actions';actions.append(this.button('Generate 6',()=>this.generate()),this.button('Stop',()=>{this.queue.cancel();this.batchGeneration++;this.status.textContent='Cancelled. GPU work already sent may finish; no late pictures are added.';}),this.button('Close Discover',()=>this.close()));
  this.status.textContent='New flat AST · 3–6 operations · finite distance approximation. Choose a seed and Generate.';
  this.cells.className='discovery-cells';this.selectedBox.className='discovery-selected';panel.append(heading,note,settings,actions,this.status,this.cells,this.selectedBox);this.overlay.append(panel);document.body.append(this.overlay);
  this.overlay.addEventListener('keydown',e=>{if(e.key==='Escape')this.close();if(e.key==='Tab'){const focus=[...this.overlay.querySelectorAll<HTMLElement>('button,input,select')].filter(el=>!el.hasAttribute('disabled')&&el.getClientRects().length>0);const first=focus[0],last=focus.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
  try{const raw=JSON.parse(localStorage.getItem(KEEP_KEY)??'[]');if(Array.isArray(raw))for(const recipe of raw.slice(0,8)){try{candidateFromRecipe(recipe,h.library(),this.catalog);this.kept.push(recipe);}catch{}}}catch{}
  this.overlay.dataset.kept=JSON.stringify(this.kept.map(r=>r.id));if(this.kept.length)this.status.textContent+=' · '+this.kept.length+' saved kept candidates';
 }
 developSource(definition:SynthesizedDefinition){this.batchGeneration++;this.overlay.hidden=false;this.overlay.scrollTop=0;this.seed.value=(definition.seed.slice(0,110)+'-child');this.steps.value=definition.nodes.length>4?'2':'1';this.generate({id:definition.id,definition,scene:synthesizedCandidateScene(definition),signature:definition.fingerprint});}
 private close(){this.queue.cancel();const generation=++this.batchGeneration;this.overlay.hidden=true;void(async()=>{while(this.queue.busy){await new Promise(resolve=>setTimeout(resolve,16));if(generation!==this.batchGeneration)return;}if(generation===this.batchGeneration&&this.overlay.hidden){this.engine?.destroy();this.engine=undefined;}})();}
 private button(text:string,run:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=run;return b;}
 private label(text:string,input:HTMLElement){const l=document.createElement('label');l.append(document.createTextNode(text),input);input.setAttribute('aria-label',text);return l;}
 private options():DiscoveryOptions {if(this.mode.value==='hybrid')this.steps.value='2';return {seed:this.seed.value,mode:this.mode.value as DiscoveryOptions['mode'],family:this.family.value,strength:Number(this.strength.value),maxSteps:Number(this.steps.value) as 1|2,count:8};}
 private generate(parent?:DiscoveryChoice){
  if(!this.h.available()){this.status.textContent='End the main rendering/surface search before the gallery preview.';return;}
  const generation=++this.batchGeneration;this.queue.cancel();this.overlay.dataset.results='[]';delete this.overlay.dataset.complete;
  try{
   let choices:DiscoveryChoice[],rejected:{slot:number;reason:string}[]=[];
   const seed=this.seed.value;
   if(this.mode.value==='synthesis'||parent?.definition){
    this.mode.value='synthesis';this.family.disabled=true;this.steps.disabled=false;if(parent?.definition&&parent.definition.nodes.length>4)this.steps.value='2';
    const batch=generateSynthesisBatch(this.h.library(),this.catalog.fingerprint,{seed,count:6,maxNodes:this.steps.value==='1'?4:6,strength:Number(this.strength.value)},parent?.definition);
    choices=batch.definitions.map(definition=>({id:definition.id,definition,scene:synthesizedCandidateScene(definition),signature:definition.fingerprint,...(parent?.definition?{parentDefinition:parent.definition}:{})}));rejected=batch.rejected;
    if(parent?.definition)choices=[parent,...choices.slice(0,5)];
   }else{
    const options=this.options();options.count=6;if(parent?.variation){options.mode='family';options.family=parent.variation.recipe.family;this.mode.value='family';this.family.value=options.family;}
    const batch=generateDiscoveryBatch(this.h.library(),options,parent?.variation?.recipe,this.catalog);rejected=batch.rejected;
    const convert=(variation:DiscoveryCandidate):DiscoveryChoice=>({id:variation.recipe.id,scene:variation.scene,signature:variation.signature,variation});
    const kept=this.kept.map(recipe=>convert(candidateFromRecipe(recipe,this.h.library(),this.catalog)));
    choices=[...kept,...batch.candidates.map(convert).filter(c=>!kept.some(k=>k.signature===c.signature))].slice(0,8);
   }
   this.steps.disabled=this.mode.value==='hybrid';this.family.disabled=this.mode.value==='synthesis'||this.mode.value==='variety';
   this.modePresentation();
   this.items=choices.map(candidate=>({candidate,kept:!!parent&&candidate===parent||this.kept.some(r=>r.id===candidate.id)}));
   this.selected=undefined;this.progress=0;this.redraw();
   const reasons=rejected.map(r=>`${r.slot+1}: ${r.reason}`).join(' · ');this.status.textContent=`Seed ${seed} · 0/${this.items.length} pictures${reasons?' · CPU-rejected: '+reasons:''}`;
   this.overlay.dataset.batch=JSON.stringify({seed,mode:this.mode.value,rejected,definitions:choices.flatMap(c=>c.definition?[c.definition]:[]),recipes:choices.flatMap(c=>c.variation?[c.variation.recipe]:[])});
   this.queue.request(this.items.map(item=>({item,large:false})),(r,signal)=>this.preview(r,generation,signal),(r,result)=>{
    if(result instanceof Error)r.item.error=result.message;else r.item.image=result;this.progress++;this.overlay.dataset.results=JSON.stringify(this.items.map(i=>({id:i.candidate.id,family:i.candidate.definition?'synthesized':i.candidate.variation!.recipe.family,error:i.error,...(i.image?{milliseconds:i.image.milliseconds,hitShare:i.image.hitShare,framingAttempt:i.image.framingAttempt}: {})})));this.redraw();
    this.status.textContent=`Seed ${seed} · ${this.progress}/${this.items.length} pictures · ${this.items.filter(i=>i.error).length} picture errors${reasons?' · CPU-rejected: '+reasons:''}`;
   },()=>{this.status.textContent+=' · done';this.overlay.dataset.complete=String(generation);});
  }catch(e){this.items=[];this.selected=undefined;this.redraw();this.status.textContent=String(e instanceof Error?e.message:e);}
 }
 private redraw(){
  this.cells.replaceChildren();for(const item of this.items){const cell=this.button('',()=>this.pick(item));cell.className='discovery-cell'+(item===this.selected?' selected':'')+(item.kept?' kept':'');cell.dataset.candidateId=item.candidate.id;cell.setAttribute('aria-label','Kandidat '+item.candidate.id);cell.setAttribute('aria-pressed',String(item===this.selected));
   if(item.image){const img=document.createElement('img');img.src=item.image.url;img.alt=item.candidate.definition?.name??item.candidate.variation!.recipe.chain.map(s=>s.formula).join(' → ');cell.append(img);}else{const message=document.createElement('span');message.textContent=item.error??'Waiting for a real GPU preview…';cell.append(message);}
   const name=document.createElement('strong');name.textContent=item.candidate.definition?(item.candidate.definition.name+' · '+item.candidate.definition.mutation):item.candidate.variation!.recipe.chain.map(s=>this.h.library().find(f=>f.id===s.formula)?.name??s.formula).join(' → ');const id=document.createElement('small');id.textContent=item.candidate.id+(item.kept?' · kept':'');cell.append(name,id);this.cells.append(cell);
  }
  this.showSelected();
 }
 private pick(item:GalleryItem){this.selected=item;this.redraw();if(!item.image)return;
  if(this.queue.busy){this.status.textContent+=' · wait until the batch is finished for a larger preview';return;}
  const generation=this.batchGeneration;this.queue.request([{item,large:true}],(r,signal)=>this.preview(r,generation,signal),(r,result)=>{if(result instanceof Error){if(this.selected===r.item)this.status.textContent=result.message;}else{r.item.large=result;if(this.selected===r.item)this.showSelected(result);}},()=>{});
 }
 private showSelected(large?:GalleryImage){
  this.selectedBox.replaceChildren();const item=this.selected;if(!item)return;
  const image=large??item.large??item.image;if(image){const img=document.createElement('img');img.src=image.url;img.alt='Larger candidate preview';this.selectedBox.append(img);}
  const info=document.createElement('div'),title=document.createElement('strong');title.textContent=item.candidate.definition?.name??item.candidate.variation!.recipe.family;
  const recipe=document.createElement('pre');recipe.textContent=item.candidate.definition?describeSynthesizedDefinition(item.candidate.definition)+'\nID: '+item.candidate.id+'\nSeed: '+item.candidate.definition.seed+'\nParent: '+(item.candidate.definition.parent?.id??'ingen')+'\nChild: '+item.candidate.definition.mutation:JSON.stringify(item.candidate.variation!.recipe,null,2);
  const credits=document.createElement('p');credits.textContent=item.candidate.definition?'Composed from textbook geometry; origin unknown, not a global uniqueness proof. DE applies to a finite sub-level set, picture approximation. Julia and mixed chains are not supported in the MVP.':'Variation of an existing formula, no new mathematical definition.';
  const keep=this.button(item.kept?'Release the candidate':'Keep the candidate',()=>{item.kept=!item.kept;this.kept=this.items.filter(i=>i.kept&&i.candidate.variation).map(i=>i.candidate.variation!.recipe).slice(0,8);try{localStorage.setItem(KEEP_KEY,JSON.stringify(this.kept));}catch{this.status.textContent='Kept in this batch; local storage failed.';}this.redraw();});
  const frame=document.createElement('input');frame.type='checkbox';frame.checked=true;const frameLabel=this.label('Frame the camera of the candidate when applying',frame);
  const warning=document.createElement('p');warning.className='discovery-warning';warning.textContent='Apply replaces the fractal chain and gets new instance IDs. Existing mathematical animation targets become unresolved. Legacy keys must be empty for the chain to be replaced safely. Material and final quality are preserved.';
  this.applyButton=this.button('Apply to scene',()=>{this.queue.cancel();this.batchGeneration++;try{this.h.apply({...item.candidate,scene:item.large?.scene??item.image!.scene},frame.checked);this.close();}catch(e){this.status.textContent=String(e instanceof Error?e.message:e);}});this.applyButton.disabled=!item.image||!!item.error||this.h.currentScene().animation.keyframes.length>0;
  if(item.candidate.definition&&this.h.saveFormula){info.append(this.button('Save formula',()=>{const generation=this.batchGeneration;void(async()=>{if(item.candidate.parentDefinition)await this.h.saveFormula!(item.candidate.parentDefinition,this.cache.get(item.candidate.parentDefinition.fingerprint+'-thumb')?.url??'');await this.h.saveFormula!(item.candidate.definition!,item.image?.url??'');if(generation===this.batchGeneration)this.status.textContent='Mathematical formula and any parent saved in My fractals.';})().catch(e=>{if(generation===this.batchGeneration)this.status.textContent=String(e);});}));}
  if(this.h.savePreset)info.append(this.button('Save candidate preset',()=>{const generation=this.batchGeneration;void this.h.savePreset!(item.large?.scene??item.image?.scene??item.candidate.scene,item.image?.url??'').then(()=>{if(generation===this.batchGeneration)this.status.textContent='Picture preset saved in My fractals.';}).catch(e=>{if(generation===this.batchGeneration)this.status.textContent=String(e);});}));
  info.append(title,recipe,credits,...(item.candidate.variation?[keep]:[]),this.button('Develop from this one',()=>this.generate(item.candidate)),this.button('Download recipe',()=>this.download((item.candidate.definition?'fg2b-':'fg2a-')+item.candidate.id+'.recipe.json',JSON.stringify(item.candidate.definition??item.candidate.variation!.recipe,null,2))),this.button('Download the scene of the candidate',()=>this.download((item.candidate.definition?'fg2b-':'fg2a-')+item.candidate.id+'.scene.json',serializeScene(item.candidate.scene,this.h.library()))),frameLabel,warning,this.applyButton,this.button('Undo scene change',()=>this.h.undo()));this.selectedBox.append(info);
 }
 private download(name:string,text:string){const a=document.createElement('a');a.download=name;a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.click();URL.revokeObjectURL(a.href);}
 private async preview(request:GalleryRequest,generation:number,signal:AbortSignal):Promise<GalleryImage>{
  stopped(signal);const cacheKey=request.item.candidate.signature+(request.large?'-large':'-thumb');const cached=this.cache.get(cacheKey);if(cached)return cached;
  let acquired=false;const start=performance.now();try{
   await this.h.beforePreview(signal);acquired=true;this.overlay.dataset.activeJobs='1';stopped(signal);
   if(!this.engine){this.engine=await createEngine({});this.engine.setFormulas(this.h.library());}stopped(signal);
   let scene=structuredClone(request.item.image?.scene??request.item.candidate.scene);const width=request.large?480:192,height=request.large?360:144;
   for(let attempt=0;attempt<2;attempt++){
    const set=await this.engine.setScene(scene);stopped(signal);if(set.errors.length)throw Error(set.errors.join('; '));
    const layers=await this.engine.renderLayersToBuffer(width,height,{quality:QUALITY,features:FEATURES,tilePixels:width*32,signal,dofMode:'off'});stopped(signal);
    const measures=measureThumbnail({width,height,depth:layers.depth,normal:layers.normal,color:layers.color});
    if(measures.hitShare>=.01&&measures.hitShare<=.65){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(layers.color),width,height),0,0);const image={url:canvas.toDataURL('image/png'),scene,milliseconds:performance.now()-start,hitShare:measures.hitShare,framingAttempt:attempt,width,height};this.cache.set(cacheKey,image);while(this.cache.size>16)this.cache.delete(this.cache.keys().next().value!);this.overlay.dataset.lastPreview=JSON.stringify({generation,id:request.item.candidate.id,milliseconds:image.milliseconds,hitShare:image.hitShare,large:request.large});return image;}
    const factor=measures.hitShare>.65?1.5:.7;scene={...scene,camera:{...scene.camera,position:scene.camera.position.map((v,i)=>scene.camera.target[i]!+(v-scene.camera.target[i]!)*factor) as [number,number,number]}};
   }
   throw Error('No usable surface coverage in two limited camera views. This does not prove that the formula is empty.');
  }finally{if(acquired){this.overlay.dataset.activeJobs='0';this.h.afterPreview();}}
 }
}
