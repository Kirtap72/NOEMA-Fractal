import {desktop} from './desktop';
import {parsePresets} from '../engine/presets';
import {createLibraryRecord,readLibraryRecord} from '../engine/discoveryLibrary';
import type {LibraryRecord,LibraryPayload} from '../engine/discoveryLibrary';
import type {SynthesizedDefinition} from '../engine/synthesizedFormula';
import type {Scene} from '../engine/scene';
import {serializeScene} from '../engine/scene';
import {candidateFromRecipe} from '../engine/discoveryCandidates';
import type {Formula} from '../engine/formula/types';
import {FormulaStore} from './formulaStore';
import {DiscoveryLibraryStore,libraryStorageError} from './discoveryLibraryStore';
import {encodeLibraryBackupFile,readLibraryBackupFile} from './libraryBackupFile';
import {PresetThumbnailJobs,THUMBNAIL_QUALITIES,improvedThumbnailSamples,improvedThumbnailSize,presetThumbnailSize,thumbnailMessage,validateThumbnail} from './presetThumbnails';
import type {ThumbnailImage,ThumbnailQuality,ThumbnailRequest} from './presetThumbnails';
import './fractalLibrary.css';

export interface FractalLibraryHandlers {scene():Scene;thumbnail(scene:Scene,request:ThumbnailRequest):Promise<ThumbnailImage>;thumbnailSize?(scene:Scene):{width:number;height:number};formulas():readonly Formula[];discoveryFormulas():readonly Formula[];load(record:LibraryRecord):void;develop(definition:SynthesizedDefinition):void;undo():void}
const labels:Record<LibraryPayload['kind'],string>={formula:'Mathematical formula',preset:'Picture preset','legacy-variation':'Older formula variation','legacy-formula':'Older saved formula'};
export class FractalLibrary {
 private selection=0;private jobs:PresetThumbnailJobs;private cancelThumbnail!:HTMLButtonElement;
 readonly store=new DiscoveryLibraryStore();private overlay=document.createElement('div');private grid=document.createElement('div');private detail=document.createElement('div');private status=document.createElement('output');private search=document.createElement('input');private type=document.createElement('select');private offset=0;private generation=0;private previous!:HTMLButtonElement;private next!:HTMLButtonElement;private selected:LibraryRecord|undefined;private observer:IntersectionObserver|undefined;
 constructor(root:HTMLElement,private h:FractalLibraryHandlers){
  this.jobs=new PresetThumbnailJobs(this.store,(scene,request)=>h.thumbnail(scene,request),error=>{if(error)this.failure(error);this.thumbnailChanged();});
  this.jobs.progress=fraction=>{const id=this.jobs.activeId;if(id)this.improveNote(id,'Rendering preview '+Math.round(Math.max(0,Math.min(1,fraction))*100)+' %…');};
  root.append(this.button('My fractals',()=>this.open()),this.button('Save picture preset',()=>this.saveCurrentPreset()));
  this.overlay.id='fractal-library';this.overlay.className='library-dialog';this.overlay.hidden=true;this.overlay.setAttribute('role','dialog');this.overlay.setAttribute('aria-modal','true');this.overlay.setAttribute('aria-label','My fractals');
  const panel=document.createElement('div');panel.className='library-panel';const heading=document.createElement('h2');heading.textContent='My fractals';const note=document.createElement('p');note.textContent='Formula saves the mathematics; picture preset saves the currently shown view as a scene of its own with the animation keyframes preserved. The original scene is not changed. Saved locally: export a backup for portable restore. There is no fixed limit on the number of saved entries.';
  this.search.type='search';this.search.placeholder='Search names, tags or notes';this.search.setAttribute('aria-label','Search my fractals');this.search.oninput=()=>{this.offset=0;void this.render();};
  this.type.setAttribute('aria-label','Library type');this.type.add(new Option('All types',''));for(const [id,name] of Object.entries(labels))this.type.add(new Option(name,id));this.type.onchange=()=>{this.offset=0;void this.render();};
  const actions=document.createElement('div');actions.className='library-actions';const file=document.createElement('input');file.type='file';file.accept='.json,.gz';file.hidden=true;file.setAttribute('aria-label','Import library file');file.onchange=()=>{const source=file.files?.[0];file.value='';if(!source)return;void(async()=>{try{this.status.textContent='Reading and validating backup…';const raw=await readLibraryBackupFile(source) as Record<string,unknown>;let backup:unknown=raw;if(raw.presets_version===1){const old=parsePresets(JSON.stringify(raw));if(!old.ok)throw Error(old.errors.join('; '));backup={format:'noema-fractal-library',version:1,exportedAt:new Date().toISOString(),records:old.presets.map(p=>({...createLibraryRecord({kind:'preset',scene:p.scene},p.name,'','legacy-preset:'+p.id,p.created),rating:p.rating,notes:p.origin?JSON.stringify(p.origin):''}))};}const result=await this.store.import(backup);this.status.textContent=`Imported ${result.added}, skipped ${result.duplicates} duplicates.`;await this.render();}catch(e){this.failure(e);}})();};
  this.cancelThumbnail=this.button('Cancel thumbnail',()=>this.jobs.cancel());this.cancelThumbnail.disabled=true;
  actions.append(this.search,this.type,this.button('Export library',()=>{void this.exportLibrary().catch(e=>this.failure(e));}),this.button('Import library',()=>{if(!desktop){file.click();return;}this.status.textContent='Reading and saving backup…';void desktop.importLibrary().then(async result=>{if(result){this.status.textContent=`Imported ${result.added}, skipped ${result.duplicates} duplicates.`;await this.render();}}).catch(e=>this.failure(e));}),this.cancelThumbnail,this.button('Close library',()=>this.close()),file);
  this.grid.className='library-grid';this.detail.className='library-detail';this.previous=this.button('Previous page',()=>{this.offset=Math.max(0,this.offset-24);void this.render();});this.next=this.button('Next page',()=>{this.offset+=24;void this.render();});panel.append(heading,note,actions,this.status,this.previous,this.next,this.grid,this.detail);this.overlay.append(panel);document.body.append(this.overlay);
  this.overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){this.close();e.stopPropagation();}if(e.key==='Tab'){const controls=[...this.overlay.querySelectorAll<HTMLElement>('button,input,select,textarea')].filter(el=>!el.hasAttribute('disabled')&&el.getClientRects().length>0),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
  void this.migrateLegacy().catch(e=>this.failure(e));
 }
 private button(text:string,run:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=run;return b;}
 private failure(e:unknown){this.overlay.hidden=false;this.status.textContent=libraryStorageError(e);this.overlay.dataset.error=this.status.textContent;}
 open(){this.overlay.hidden=false;this.overlay.scrollTop=0;this.search.focus({preventScroll:true});void this.render();}
 private close(){this.selection++;this.jobs.cancel();this.overlay.hidden=true;this.generation++;this.observer?.disconnect();}
 private async exportLibrary(){if(desktop){this.status.textContent='Writing backup…';const result=await desktop.exportLibrary();this.status.textContent=result?`Exported ${result.count} entries to ${result.saved}.`:'Export cancelled.';return;}this.status.textContent='Exporting backup… large map packages are compressed losslessly.';const data=await this.store.export(),file=await encodeLibraryBackupFile(data),a=document.createElement('a'),url=URL.createObjectURL(file.blob);a.download=file.name;a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.status.textContent='Exported '+data.records.length+' entries to '+file.name+'.';}
 async saveFormula(definition:SynthesizedDefinition,thumbnail:string){const id='formula:'+definition.id,existing=await this.store.get(id),record=existing??createLibraryRecord({kind:'formula',definition},definition.name,thumbnail,id);await this.store.put({...record,thumbnail:thumbnail||record.thumbnail});return record;}
 private presetRecord(scene:Scene){const parsed=JSON.parse(serializeScene(structuredClone(scene),this.h.formulas())),record=createLibraryRecord({kind:'preset',scene:parsed},'Picture preset '+new Date().toLocaleString('en-GB'),'','preset:'+crypto.randomUUID());record.thumbnailState={status:'pending',generation:0,sourceFingerprint:record.fingerprint,...(this.h.thumbnailSize?.(scene)??presetThumbnailSize(scene)),message:'The preset is saved. Thumbnail pending; choose Try again when the GPU is free.'};return record;}
 private saveCurrentPreset(){
  // Freeze evaluated values, authored animation keys and original quality BEFORE any asynchronous work.
  let record:LibraryRecord;try{record=this.presetRecord(this.h.scene());}catch(e){this.failure(e);return;}
  this.overlay.hidden=false;this.status.textContent='Saving preset data…';
  void this.store.put(record).then(()=>{this.selected=record;this.open();this.inspect();return this.jobs.run(record.id);}).catch(e=>this.failure(e));
 }
 async savePreset(scene:Scene,thumbnail:string,title?:string,notes?:string){const record=this.presetRecord(scene);if(title)record.title=title.slice(0,120);if(notes)record.notes=notes.slice(0,2000);await this.store.put(record);if(thumbnail){try{const size=await validateThumbnail(thumbnail);await this.store.finishThumbnail(record.id,0,record.fingerprint,thumbnail,{...record.thumbnailState!,status:'ready',...size,message:undefined});}catch(e){await this.store.finishThumbnail(record.id,0,record.fingerprint,'',{...record.thumbnailState!,status:'failed',message:thumbnailMessage(e)});}}return (await this.store.get(record.id))!;}
 private thumbnailChanged(){this.cancelThumbnail.disabled=!this.jobs.busy;if(this.overlay.hidden)return;void this.render();const id=this.selected?.id;if(id)void this.store.get(id).then(record=>{if(record&&this.selected?.id===id&&!this.overlay.hidden){this.selected=record;this.detail.querySelector('.library-detail-preview')?.replaceWith(this.thumbnailPanel(record));}}).catch(e=>this.failure(e));}
 private thumbnailLabel(record:Pick<LibraryRecord,'thumbnailState'|'thumbnail'>){const state=record.thumbnailState;return state?.status==='failed'?'Thumbnail failed':state?.status==='pending'?'Thumbnail pending':record.thumbnail?'Thumbnail ready':'Thumbnail missing';}
 /** The message of "Rendera bättre förhandsbild…" lives with that preset's block, not in the shared list status, which the list redraws. */
 private improveNotes=new Map<string,string>();
 private improveNote(id:string,text:string){this.improveNotes.set(id,text);const el=this.detail.querySelector<HTMLElement>(`.library-improve[data-id="${CSS.escape(id)}"] .library-improve-status`);if(el)el.textContent=text;}
 /** ARTIST-UX-02 phase D: explicit, per preset, bounded. The old picture stays until the new one is finished. */
 private improveBlock(record:LibraryRecord){
  const box=document.createElement('div');box.className='library-improve';box.dataset.id=record.id;box.setAttribute('role','group');box.setAttribute('aria-label','Better preview');
  const scene=(record.payload.kind==='preset'||record.payload.kind==='legacy-variation')?record.payload.scene:undefined;
  const select=document.createElement('select');select.setAttribute('aria-label','Quality of the preview');
  const note=document.createElement('small');note.className='library-improve-note';
  const message=document.createElement('output');message.className='library-improve-status';message.setAttribute('role','status');message.textContent=this.improveNotes.get(record.id)??'';
  const fallback=record.thumbnailState?.width&&record.thumbnailState?.height?record.thumbnailState.width/record.thumbnailState.height:4/3;
  for(const quality of Object.keys(THUMBNAIL_QUALITIES) as ThumbnailQuality[]){const b=THUMBNAIL_QUALITIES[quality];select.add(new Option(`${b.label} · longest side ${b.longSide} px · ${b.samples} samples`,quality));}
  select.value='good';
  const describe=()=>{
   if(!scene){note.textContent='';return;}
   const quality=select.value as ThumbnailQuality,size=improvedThumbnailSize(scene,quality,fallback),samples=improvedThumbnailSamples(scene,quality);
   note.textContent=`Becomes ${size.width}×${size.height} px, ${samples} camera samples${samples>THUMBNAIL_QUALITIES[quality].samples?' (depth of field is on: at least 16 are used, takes longer)':''}. The saved scene and picture proportions are used; nothing else is changed. The old picture remains if you cancel.`;
  };
  select.onchange=describe;describe();
  const run=this.button('Render better preview…',()=>{
   const id=record.id,quality=select.value as ThumbnailQuality;
   if(this.jobs.busy){this.improveNote(id,'A thumbnail is already working. Wait or cancel it.');return;}
   this.improveNote(id,`Preparing preview (${THUMBNAIL_QUALITIES[quality].label})…`);
   void this.jobs.improve(id,quality).then(result=>{
    this.improveNote(id,result==='replaced'?'The preview is replaced. The scene, ID and other entries of the preset are unchanged.':result==='cancelled'?'Cancelled. The old picture remains.':result==='busy'?'A thumbnail is already working.':'The preset was changed or removed during the rendering; no picture was replaced.');
    void this.render();
   }).catch(e=>{this.improveNote(id,'The preview failed: '+thumbnailMessage(e)+' The old picture remains.');});
  });
  run.disabled=this.jobs.busy;run.title=this.jobs.busy?'A thumbnail is already working. Wait or cancel it.':'Render a better picture of exactly this saved preset and replace only its thumbnail.';
  box.append(select,note,run,message);return box;
 }
 private thumbnailPanel(record:LibraryRecord){const panel=document.createElement('div');panel.className='library-detail-preview';const img=document.createElement('img');img.alt=record.title;img.hidden=true;const message=document.createElement('p');message.textContent=this.thumbnailLabel(record)+(record.thumbnailState?.message?' · '+record.thumbnailState.message:'');panel.append(img,message);if(record.type==='preset'||record.type==='legacy-variation'){const retry=this.button('Try again with thumbnail',()=>{void this.jobs.run(record.id).catch(e=>this.failure(e));});retry.disabled=this.jobs.busy;retry.title=this.jobs.busy?'A thumbnail is already working. Wait or cancel it.':'Render only this saved scene.';panel.append(retry,this.improveBlock(record));}if(record.thumbnail)void validateThumbnail(record.thumbnail).then(()=>{if(!panel.isConnected)return;img.onload=()=>{img.hidden=false;};img.onerror=()=>{img.hidden=true;message.textContent='The thumbnail could not be shown. Try again; the preset data remains.';};img.src=record.thumbnail;}).catch(()=>{message.textContent='The thumbnail is broken. Try again; the preset data remains.';});return panel;}
 private async migrateLegacy(){
  const saved=await new FormulaStore().listFormulas();for(const old of saved){const id='legacy:'+old.id;if(await this.store.get(id))continue;try{await this.store.put({...createLibraryRecord({kind:'legacy-formula',text:old.text},'Older formula '+old.id,old.thumbnail??'',id,old.saved_at),rating:old.record?.rating.value??0});}catch(e){this.failure(e);}}
  const oldPresets=localStorage.getItem('fraktal.presets');if(oldPresets){const parsed=parsePresets(oldPresets);if(parsed.ok)for(const p of parsed.presets){const id='legacy-preset:'+p.id;if(!await this.store.get(id))await this.store.put({...createLibraryRecord({kind:'preset',scene:p.scene},p.name,'',id,p.created),rating:p.rating,notes:p.origin?JSON.stringify(p.origin):''});}}
  try{const kept=JSON.parse(localStorage.getItem('fraktal-discovery-fg2a-kept')??'[]');if(Array.isArray(kept))for(const recipe of kept){const id='variation:'+recipe.id;if(await this.store.get(id))continue;const candidate=candidateFromRecipe(recipe,this.h.discoveryFormulas());await this.store.put(createLibraryRecord({kind:'legacy-variation',scene:candidate.scene,recipe},'FG2A-variation '+recipe.family,'',id));}}catch(e){this.status.textContent='Older FG2A choices remain in their storage but could not be migrated: '+String(e);}
 }
 private async render(){
  const generation=++this.generation;this.observer?.disconnect();try{const {entries,total,notice}=await this.store.page(this.search.value,this.type.value,this.offset,24);if(generation!==this.generation)return;
   this.overlay.dataset.total=String(total);this.overlay.dataset.pageSize=String(entries.length);this.previous.disabled=this.offset===0;this.next.disabled=this.offset+24>=total;this.status.textContent=`${total} entries · showing ${total?this.offset+1:0}–${Math.min(this.offset+24,total)}. ${this.status.textContent.startsWith('Imported')?this.status.textContent:''}`;if(notice)this.status.textContent+=' '+notice;this.grid.replaceChildren();
   this.observer=new IntersectionObserver(changes=>{for(const change of changes)if(change.isIntersecting){const slot=change.target as HTMLElement;this.observer?.unobserve(slot);void this.store.thumbnail(slot.dataset.id!).then(async record=>{if(generation!==this.generation||!record)return;const caption=slot.querySelector('span')!,img=slot.querySelector('img')!;caption.textContent=this.thumbnailLabel(record);if(!record.thumbnail)return;try{await validateThumbnail(record.thumbnail);if(generation!==this.generation)return;img.onload=()=>{if(generation===this.generation){img.hidden=false;caption.hidden=true;}};img.onerror=()=>{img.hidden=true;caption.hidden=false;caption.textContent='The thumbnail is broken · choose the entry and try again';};img.src=record.thumbnail;}catch{caption.textContent='The thumbnail is broken · choose the entry and try again';}}).catch(e=>this.failure(e));}},{root:this.overlay});
   for(const entry of entries){const card=this.button('',()=>this.select(entry.id));card.className='library-card';card.dataset.libraryId=entry.id;const slot=document.createElement('div');slot.className='library-thumbnail';slot.dataset.id=entry.id;const img=document.createElement('img');img.loading='lazy';img.alt=entry.title;img.hidden=true;img.dataset.id=entry.id;const state=document.createElement('span');state.textContent='Reading thumbnail…';slot.append(img,state);const title=document.createElement('strong');title.textContent=entry.title;const caption=document.createElement('small');caption.textContent=labels[entry.type]+' · '+(entry.rating?'★'.repeat(entry.rating):'Unrated')+' · '+new Date(entry.createdAt).toLocaleDateString('en-GB');card.append(slot,title,caption);this.grid.append(card);this.observer.observe(slot);}
  }catch(e){this.failure(e);}
 }
 private select(id:string){
  const selection=++this.selection;this.selected=undefined;delete this.overlay.dataset.selectedId;
  this.detail.textContent='Loading the chosen library entry...';
  void this.store.get(id).then(record=>{
   if(selection!==this.selection||this.overlay.hidden)return;
   if(!record)throw Error('The library entry no longer exists.');
   this.selected=readLibraryRecord(record);this.inspect();
  }).catch(error=>{if(selection===this.selection&&!this.overlay.hidden)this.failure(error);});
 }
 private inspect(){
  this.overlay.dataset.selectedId=this.selected?.id??'';this.detail.replaceChildren();const record=this.selected;if(!record)return;this.detail.append(this.thumbnailPanel(record));
  const controls=document.createElement('div'),title=document.createElement('input');title.value=record.title;title.maxLength=120;title.setAttribute('aria-label','Name of the library entry');
  const rating=document.createElement('select');rating.setAttribute('aria-label','Star rating');rating.add(new Option('Unrated','0'));for(let n=1;n<=5;n++)rating.add(new Option('★'.repeat(n),String(n)));rating.value=String(record.rating);
  const tags=document.createElement('input');tags.value=record.tags;tags.maxLength=256;tags.setAttribute('aria-label','Taggar');const notes=document.createElement('textarea');notes.value=record.notes;notes.maxLength=2000;notes.setAttribute('aria-label','Note');
  const caption=document.createElement('p');caption.textContent=labels[record.type]+' · '+record.createdAt+' · '+record.fingerprint;const warning=document.createElement('p');warning.textContent=record.type==='preset'?'Load preset replaces the whole scene. The ordinary Undo restores it.':'Apply formula replaces the fractal chain with fresh IDs. Old mathematical animation targets become unresolved; other still settings are preserved.';
  controls.append(caption,title,rating,tags,notes,this.button('Save details',()=>{void this.store.updateMetadata(record.id,{title:title.value,rating:Number(rating.value),tags:tags.value,notes:notes.value}).then(updated=>{if(updated&&this.selected?.id===record.id){this.selected=updated;this.inspect();}void this.render();}).catch(e=>this.failure(e));}),warning,this.button(record.type==='preset'||record.type==='legacy-variation'?'Load preset':'Apply formula',()=>{if(!confirm(warning.textContent??'Replace the scene?'))return;try{this.h.load(record);this.close();}catch(e){this.failure(e);}}),this.button('Undo scene change',()=>this.h.undo()),this.button('Delete entry',()=>{if(!confirm('Delete '+record.title+' from the library? An exported backup is not affected.'))return;void this.store.remove(record.id).then(()=>{this.selected=undefined;this.detail.replaceChildren();void this.render();}).catch(e=>this.failure(e));}));
  if(record.payload.kind==='formula'){const definition=record.payload.definition;controls.append(this.button('Utveckla matematiken',()=>{this.close();this.h.develop(definition);}));}
  const source=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Mathematical source / preset data';source.addEventListener('toggle',()=>{if(!source.open||pre.textContent)return;const preview=JSON.stringify(record.payload,(key,value)=>typeof value==='string'&&['rgb8','data'].includes(key)&&value.length>8192?'[Embedded resource: '+value.length+' characters; full data follows the backup of the library]':value,2);pre.textContent=preview;});source.append(summary,pre);controls.append(source);this.detail.append(controls);
 }
}
