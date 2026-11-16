import {MaterialStore} from './materialStore';
import {createMaterialRecord,readMaterialRecord} from '../engine/materialPresets';
import type {MaterialRecord} from '../engine/materialPresets';
import type {MaterialSettings} from '../engine/material';
import type {ColorSettings} from '../engine/gradient';
import {approximateSwatch,materialTraits,searchMaterials,sortMaterials,traitsNotes,traitsSummary,unknownSwatch} from '../engine/materialBrowse';
import type {MaterialOrder} from '../engine/materialBrowse';
import {MaterialAudition} from './materialAudition';
import type {AuditionHost} from './materialAudition';
import {desktop} from './desktop';
import {readLibraryBackupFile} from './libraryBackupFile';
import {PolyHavenPanel} from './polyHavenPanel';

/** Cards that get their approximate swatch and trait line, loaded one at a time so the list appears at once. */
const HYDRATE_LIMIT=150;
type Entry=Omit<MaterialRecord,'payload'>;

/** The library can also be opened to PICK a material for something else (a gradient stop) instead of applying it to the surface. */
export interface PickOptions{buttonLabel:string;heading:string;actionLabel:string;intro:string;onPick:(record:MaterialRecord)=>void;onOpen?:()=>void}
/** Plain-language note about what applying a material will (not) do, with an optional one-click remedy. */
export type ApplyExplanation=(material:MaterialSettings)=>{text:string;alternativeLabel?:string;alternative?:MaterialSettings}|null;

/**
 * The material library. Search, ordering, approximate swatches and (when the owner gives an audition host) a
 * non-destructive "Try / Apply / Restore" flow. Without a host it behaves as before: pick, then apply.
 * The library format has no thumbnails, so the swatches are always approximations drawn from the numbers.
 */
export class MaterialBrowser{
 private dialog=document.createElement('dialog');private list=document.createElement('div');private detail=document.createElement('div');private status=document.createElement('output');private name=document.createElement('input');private color=document.createElement('input');private store=new MaterialStore();private selected?:MaterialRecord;private generation=0;private busy=false;
 private search=document.createElement('input');private order=document.createElement('select');private count=document.createElement('div');private banner=document.createElement('div');private restoreTop=document.createElement('button');private undoTop=document.createElement('button');
 private entries:Entry[]=[];private tiles=new Map<string,{swatch:HTMLElement;info:HTMLElement}>();private payloads=new Map<string,{fingerprint:string;record?:MaterialRecord}>();private listGeneration=0;
 private audition?:MaterialAudition;
 constructor(root:HTMLElement,private current:()=>MaterialSettings,private apply:(material:MaterialSettings,color?:ColorSettings)=>void,private currentColor?:()=>ColorSettings,auditionHost?:AuditionHost,private pick?:PickOptions,private explain?:ApplyExplanation){
  if(auditionHost)this.audition=new MaterialAudition(auditionHost,()=>this.showTrial());
  root.append(this.button(this.pick?.buttonLabel??'Material library…',()=>void this.open()));this.dialog.className='material-library'+(this.audition||this.pick?' docked':'');this.dialog.setAttribute('aria-label',this.pick?.heading??'Material library');this.name.placeholder='Name of the material';this.name.maxLength=120;this.name.setAttribute('aria-label','Name of the material preset');this.color.type='checkbox';this.color.checked=false;this.color.disabled=!currentColor;this.color.setAttribute('aria-label','Include / apply gradient and colour');
  this.color.addEventListener('change',()=>this.audition?.setWithColor(this.color.checked));
  const colorLabel=document.createElement('label');colorLabel.append(this.color,' Include on save / apply the saved gradient and colour');
  const file=document.createElement('input');file.type='file';file.hidden=true;file.accept='.json,.gz';file.setAttribute('aria-label','Import material backup');file.onchange=()=>{const f=file.files?.[0];file.value='';if(f)void this.task(async()=>{const r=await this.store.import(await readLibraryBackupFile(f));this.status.textContent=`Imported ${r.added}, ${r.duplicates} existing materials.`;await this.refresh()})};
  const actions=document.createElement('div');actions.className='material-library-actions';actions.append(this.name,colorLabel,this.button('Save the current one as a new material',()=>void this.task(async()=>{const record=createMaterialRecord({kind:'material',material:this.current(),...(this.color.checked&&currentColor?{color:currentColor()}:{})},this.name.value.trim()||'Unnamed material','material:'+crypto.randomUUID());await this.store.put(record);this.status.textContent='The material was saved. The scene is unchanged.';await this.refresh();await this.select(record.id,false)})),this.button('Import material backup…',()=>file.click()),this.button('Export material backup…',()=>void this.task(async()=>{if(desktop?.materials){const result=await desktop.materials('exportFile');this.status.textContent=result?'Material backup exported.':'The export was cancelled.';return}const backup=await this.store.export(),blob=new Blob([JSON.stringify(backup)],{type:'application/json'});if(blob.size>128*1024*1024)throw Error('The material backup exceeds 128 MiB. Export fewer materials.');const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download='material.library.json';a.click();URL.revokeObjectURL(url);this.status.textContent='Material backup exported.'})),file,this.button('Close the material library',()=>this.close()));
  this.search.type='search';this.search.placeholder='Search by name, tags or note';this.search.setAttribute('aria-label','Search materials');this.search.dataset.materialSearch='';this.search.addEventListener('input',()=>this.render());
  for(const [value,label] of [['name','Name A–Z'],['newest','Newest first']] as const)this.order.add(new Option(label,value));this.order.setAttribute('aria-label','Sort materials');this.order.dataset.materialOrder='';this.order.addEventListener('change',()=>this.render());
  this.count.className='material-count';this.count.setAttribute('aria-live','polite');
  const finder=document.createElement('div');finder.className='material-finder';finder.append(this.search,this.order,this.count);
  this.banner.className='material-trial-banner';this.banner.setAttribute('role','status');this.banner.dataset.materialTrial='';
  this.restoreTop.type='button';this.restoreTop.textContent='Restore original';this.restoreTop.dataset.materialRestore='';this.restoreTop.onclick=()=>this.audition?.restore();
  this.undoTop.type='button';this.undoTop.textContent='Undo apply';this.undoTop.dataset.materialUndo='';this.undoTop.onclick=()=>void this.audition?.undoApply();
  const trial=document.createElement('div');trial.className='material-trial';trial.append(this.banner,this.restoreTop,this.undoTop);if(!this.audition)trial.hidden=true;
  const note=Object.assign(document.createElement('small'),{className:'material-swatch-note',textContent:'The colour dot is an approximate picture calculated from the values of the material. It is not a rendering and does not show how the material will look on your fractal.'});
  this.list.className='material-preset-list';this.detail.className='material-preset-detail';this.dialog.append(Object.assign(document.createElement('h2'),{textContent:this.pick?.heading??'Material library'}),Object.assign(document.createElement('p'),{textContent:this.pick?this.pick.intro:this.audition?'Click a material to try it. The trial is only visible in the picture and is not saved until you choose Apply material. Scene, camera, light and animation are preserved.':'Material presets change the surface. Scene, camera, light and animation are preserved. Save picture preset still uses My fractals.'}),trial,finder,this.list,note,this.detail,actions,this.status);document.body.append(this.dialog);
  // Poly Haven is a second source in the same dialog: two tabs, the existing library untouched underneath.
  {const mine=document.createElement('div');mine.className='material-mine';const intro=this.dialog.querySelector(':scope > p');for(const n of [intro,trial,finder,this.list,note,this.detail,actions])if(n)mine.append(n);
   const tabs=document.createElement('div');tabs.className='material-tabs';tabs.setAttribute('role','tablist');
   const tabMine=this.button('My materials',()=>show('mine')),tabPh=this.button('Poly Haven',()=>show('polyhaven'));for(const [b,l] of [[tabMine,'My materials'],[tabPh,'Poly Haven – free CC0 materials']] as const){b.setAttribute('role','tab');b.setAttribute('aria-label',l)}
   const store=this.store;const ph=desktop?.polyHaven?new PolyHavenPanel((op,...a)=>desktop!.polyHaven!(op,...a),store,(id)=>{void this.task(async()=>{await this.refresh();show('mine');await this.select(id)})},desktop?.onPolyHavenProgress?cb=>desktop!.onPolyHavenProgress!(cb):undefined):undefined;
   const show=(which:'mine'|'polyhaven')=>{const poly=which==='polyhaven'&&!!ph;mine.hidden=poly;if(ph){if(poly)ph.activate();else ph.deactivate()}tabMine.setAttribute('aria-selected',String(!poly));tabPh.setAttribute('aria-selected',String(poly))};
   if(ph)tabs.append(tabMine,tabPh);this.dialog.insertBefore(tabs,this.status);this.dialog.insertBefore(mine,this.status);if(ph)this.dialog.insertBefore(ph.root,this.status);show('mine');}
  this.dialog.addEventListener('cancel',()=>{this.generation++;this.listGeneration++;this.audition?.close()});
  this.showTrial();
 }
 private button(label:string,click:()=>void){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=click;return b}
 private async task(work:()=>Promise<void>){if(this.busy)return;this.busy=true;this.dialog.setAttribute('aria-busy','true');for(const b of this.dialog.querySelectorAll('button'))b.disabled=true;try{await work()}catch(error){this.status.textContent='Material library: '+String(error instanceof Error?error.message:error)}finally{this.busy=false;this.dialog.removeAttribute('aria-busy');for(const b of this.dialog.querySelectorAll('button'))b.disabled=false;this.showTrial()}}
 private async open(){if(this.audition||this.pick)this.dialog.show();else this.dialog.showModal();this.pick?.onOpen?.();await this.task(()=>this.refresh())}
 /** Closing never leaves a trial behind and makes any answer still on its way useless. */
 private close(){this.generation++;this.listGeneration++;this.audition?.close();this.dialog.close()}
 private showTrial(){const a=this.audition;if(!a)return;this.banner.textContent=a.message;this.restoreTop.disabled=!a.trial||this.busy;this.undoTop.disabled=!a.canUndoApply||this.busy;if(a.trial)this.dialog.dataset.trialId=a.trial.id;else delete this.dialog.dataset.trialId}
 private async refresh(){const {entries,total}=await this.store.page();this.entries=entries;this.dialog.dataset.total=String(total);this.render()}
 /** Redraws the cards for the current search and order. Nothing is read or written besides the screen. */
 private render(){
  const shown=sortMaterials(searchMaterials(this.entries,this.search.value),this.order.value as MaterialOrder);
  this.tiles.clear();this.list.replaceChildren();
  for(const r of shown){
   const tile=document.createElement('div');tile.className='material-tile';
   const b=this.button(r.title,()=>void this.task(()=>this.select(r.id)));b.className='material-preset-card';b.dataset.materialId=r.id;
   const swatch=document.createElement('span');swatch.className='material-swatch';swatch.setAttribute('aria-hidden','true'); // no text: the card's text stays exactly the name
   const info=document.createElement('small');info.className='material-tile-info';
   b.prepend(swatch);tile.append(b,info);this.list.append(tile);this.tiles.set(r.id,{swatch,info});
   const cached=this.payloads.get(r.id);this.paint(r,cached&&cached.fingerprint===r.fingerprint?cached.record:undefined,!cached||cached.fingerprint!==r.fingerprint);
  }
  this.count.textContent=this.entries.length===shown.length?`${shown.length} material`:`${shown.length} av ${this.entries.length} material`;
  void this.hydrate(shown);
 }
 private paint(r:Entry,record:MaterialRecord|undefined,pending:boolean){
  const t=this.tiles.get(r.id);if(!t)return;
  if(!record){const s=unknownSwatch();t.swatch.style.background=s.background;t.swatch.title=s.description;t.info.textContent=pending?'':'Could not be read';return}
  const {material,color}=record.payload,s=approximateSwatch(material,color);t.swatch.style.background=s.background;t.swatch.title=s.description;t.info.textContent=traitsSummary(materialTraits(material,color));
 }
 /** Reads the values of the visible presets one by one, to draw their swatch and trait line. */
 private async hydrate(shown:Entry[]){
  const generation=++this.listGeneration;let loaded=0;
  for(const r of shown){
   if(generation!==this.listGeneration||!this.dialog.open)return;
   const cached=this.payloads.get(r.id);if(cached&&cached.fingerprint===r.fingerprint)continue;
   if(++loaded>HYDRATE_LIMIT)return;
   let record:MaterialRecord|undefined;try{record=await this.store.get(r.id)}catch{record=undefined}
   if(generation!==this.listGeneration)return;
   this.payloads.set(r.id,{fingerprint:r.fingerprint,record});this.paint(r,record,false);
  }
 }
 private async select(id:string,tryIt=true){const generation=++this.generation;this.selected=undefined;delete this.dialog.dataset.selectedId;this.detail.textContent='Reading materials…';const r=await this.store.get(id);if(generation!==this.generation||!this.dialog.open)return;if(!r)throw Error('The material is missing');this.selected=r;this.dialog.dataset.selectedId=id;this.name.value=r.title;this.inspect(r);
  // Clicking a card shows it at once, but only as a trial: nothing in the scene changes until Applicera material.
  if(tryIt&&this.audition)void this.audition.tryMaterial(r.id,async()=>r,this.color.checked)}
 private inspect(r:MaterialRecord){this.detail.replaceChildren();const traits=materialTraits(r.payload.material,r.payload.color);const note=document.createElement('p');note.textContent=`${r.title} · ${r.createdAt} · ${r.payload.color?'Saved gradient/colour included':'No saved gradient'} · ${Object.entries(r.payload.material.textures?.maps??{}).filter(([,v])=>v?.texture).map(([k,v])=>k+': '+v!.texture!.name).join(', ')}`;
  const facts=document.createElement('ul');facts.className='material-facts';for(const line of [traitsSummary(traits),...traitsNotes(traits)]){const li=document.createElement('li');li.textContent=line;facts.append(li)}
  this.detail.append(note,facts,
  ...(this.pick?[this.button(this.pick.actionLabel,()=>{this.pick!.onPick(structuredClone(r));this.close()})]:[
  this.button('Applicera material',()=>{
   if(this.audition){if(this.audition.trial?.id===r.id){this.audition.apply();return}
    // Not the one on trial: apply it directly, as before, but never leave an older trial standing.
    this.audition.close();}
   this.apply(structuredClone(r.payload.material),this.color.checked&&this.currentColor&&r.payload.color?structuredClone(r.payload.color):undefined);if(!this.audition)this.dialog.close()}),
  ...(()=>{const ex=this.explain?.(r.payload.material);if(!ex)return [];const p=document.createElement('p');p.className='material-explain';p.textContent=ex.text;p.setAttribute('role','note');
   const alt=ex.alternative?[this.button(ex.alternativeLabel??'Apply with the colour of the material itself',()=>{if(this.audition)this.audition.close();this.apply(structuredClone(ex.alternative!),this.color.checked&&this.currentColor&&r.payload.color?structuredClone(r.payload.color):undefined);if(!this.audition)this.dialog.close();this.status.textContent='Applied with the colour of the material itself. The influence of the orbit colour is 0 %: the gradient no longer colours the surface. Change it under Material ▸ Influence of the orbit colour.'})]:[];return [p,...alt]})()]),
  ...(this.audition?[this.button('Restore original',()=>this.audition?.restore())]:[]),
  ...(this.pick?[]:[
  this.button('Rename material',()=>void this.task(async()=>{const title=this.name.value.trim();if(!title)throw Error('Enter the name of the material');await this.store.put(readMaterialRecord({...r,title}));await this.refresh();await this.select(r.id,false)})),
  this.button('Duplicate material',()=>void this.task(async()=>{const copy=readMaterialRecord({...r,id:'material:'+crypto.randomUUID(),title:(this.name.value.trim()||r.title)+' – copy',createdAt:new Date().toISOString()});await this.store.put(copy);await this.refresh();await this.select(copy.id,false)})),
  this.button('Update the chosen one from the current surface',()=>void this.task(async()=>{if(!confirm('Replace the material preset '+r.title+' with the current surface (the real material of the scene, not a trial)?'))return;const next=createMaterialRecord({kind:'material',material:this.current(),...(this.color.checked&&this.currentColor?{color:this.currentColor()}:{})},this.name.value.trim()||r.title,r.id,r.createdAt);await this.store.put(next);await this.refresh();await this.select(r.id,false)})),
  this.button('Delete material',()=>void this.task(async()=>{if(!confirm('Delete the material '+r.title+'?'))return;if(this.audition?.trial?.id===r.id)this.audition.restore();await this.store.remove(r.id);this.selected=undefined;delete this.dialog.dataset.selectedId;this.detail.replaceChildren();await this.refresh()}))
  ]));
 }
}
