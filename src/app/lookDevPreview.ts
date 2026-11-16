import type {Scene} from '../engine/scene';
import {sameSurfacePickView} from './surfacePickView';
import type {ImageBuffer,RenderOptions} from '../engine/engine';
import type {PreviewSize} from '../engine/artistPreview';
import {DEFAULT_LOOKDEV,QUICK_LOOKDEV_WIDTH,lookDevDimensions,lookDevEffectiveSamples,lookDevRequest} from '../engine/lookDev';
import type {LookDevSettings} from '../engine/lookDev';
import {fastLookDevDescription} from '../engine/lookDev';
import {outputSize} from '../engine/renderSetup';
import type {ViewportPlan} from '../engine/viewportQuality';
import {GEOMETRY_LEVELS,describeQuality} from '../engine/qualityLevels';
import {modeForOutput,modeAfterOutput,RETURN_AFTER_OUTPUT_MS} from './lookDevOutput';

type PreviewMode='navigation'|'fast'|'still'|'interactive'|'live'|'live2';
/** What the artist sees. Release 1.0 has four modes; the old Render Preview ('fast') and the Live LookDev trial ('live') are no longer offered, their ids only remain inside the code. */
export const MODE_NAMES:Record<PreviewMode,string>={navigation:'Explore',live2:'Create',interactive:'Inspect',still:'Final Preview',fast:'Explore',live:'Create'};
export const MODE_HELP:Record<'navigation'|'live2'|'interactive'|'still',string>={
  navigation:'Explore: the fastest way to move the camera and feel the shape. Lighting is simplified and the picture is not final quality. Best when you look for a good view.',
  live2:'Create: change formulas, materials, lights, objects, glass and clipping and see the result at once, without waiting. Lighting is simplified. Best when you build and experiment.',
  interactive:'Inspect: the same surface as the final picture, and light, shadows and materials can be adjusted without recomputing anything; the picture gets cleaner with every sample. Best when you fine-tune the look.',
  still:'Final Preview: as close to the final render as possible, with the same geometry, reflections and refinement. Below, the mode lists what differs from the final picture. Best before a final render.',
};
interface Host {
 modeChanged?(mode:PreviewMode):void;
 capture():{scene:Scene;size:PreviewSize};
 /** The picture shape of the final film, read without side effects; used to show the preview size before rendering. */
 film?():PreviewSize;
 render(scene:Scene,size:PreviewSize,options:RenderOptions,preparing:(text:string)=>void):Promise<ImageBuffer>;
 /** LOOKDEV-05B: true when the picture just returned was drawn without the sculpting code because the exact shader was still being built. */
 approximate?():boolean;
 /** PROGRESSIVE-LOOKDEV-07: a picture of up to 16 samples whose surfaces are kept (see main.ts); `present` is called at every update, `run` ends when all samples are there or it is aborted. */
 interactive?:{run(scene:Scene,width:number,signal:AbortSignal,present:(p:{rgba:Uint8Array;width:number;height:number;samples:number;target:number;reshaded:boolean;fresh:boolean;gpuMs:number;limits:string[]})=>void):Promise<void>;refusal(scene:Scene):string|null;
   /** Gives the graphics memory of the kept surfaces back (the device and the compiled shader stay, so coming back needs no new shader build). */
   release?():void};
 /** LIVE-LOOKDEV-17 (trial): one small picture per change on an engine where objects are data (see main.ts liveRun). `samples` and `target` are both 1. */
 live?:{run(scene:Scene,width:number,signal:AbortSignal,present:(p:{rgba:Uint8Array;width:number;height:number;samples:number;target:number;reshaded:boolean;fresh:boolean;gpuMs:number;limits:string[]})=>void):Promise<void>;
  /** Gives the engine (and its compiled shader) back. Called only when a final render takes over, NOT while the graphics card is briefly busy (picking a surface to place an object): the shader would have to be built again. */
  release?():void};
 /** LIVE-ARCH-19, Live LookDev 2: the wavefront renderer (engine/liveWave.ts). A small picture at once, then more samples while nothing changes; only a change of formula builds a (small) shader. */
 live2?:{run(scene:Scene,width:number,signal:AbortSignal,present:(p:{rgba:Uint8Array;width:number;height:number;samples:number;target:number;reshaded:boolean;fresh:boolean;gpuMs:number;limits:string[]})=>void):Promise<void>;refusal?(scene:Scene):string|null;release?():void};
}
interface Preferences {width:number;spp:number;geometry:string;auto:boolean}
const PREFERENCE_KEY='noema-lookdev-prefs';
/**
 * One running still plus one replaceable intent, sharing the application's existing GPU gate.
 *
 * ARTIST-UX-02 phase C: the mode (ordinary viewport / Render Preview / LookDev – Stillbildskvalitet) is chosen with three buttons
 * in the box above the image, next to the viewport quality select, and that box also holds the options and the state of the
 * active mode. The hidden `mode` select is the single place that stores the mode; the buttons and every older route go
 * through changeMode(), so two controls can never disagree.
 */
export class LookDevPreview {
 readonly element=document.createElement('section');
 readonly surface=document.createElement('div');
 private access=document.createElement('div');private modeButtons=new Map<PreviewMode,HTMLButtonElement>();
 private image=document.createElement('canvas');private message=document.createElement('div');
 private failureNotice=document.createElement('div');private failureText=document.createElement('p');
 private mode=document.createElement('select');private choices=document.createElement('div');private note=document.createElement('small');private width=document.createElement('select');private spp=document.createElement('select');private geometry=document.createElement('select');
 private auto=document.createElement('input');private pause=document.createElement('button');private zoom=document.createElement('input');
 private statusLine=document.createElement('div');private cancelButton=document.createElement('button');private help=document.createElement('p');private finalDiff=document.createElement('small');private sizeNote=document.createElement('small');private lastFilm?:PreviewSize;
 private preferred:Preferences={width:QUICK_LOOKDEV_WIDTH,spp:1,geometry:'normal',auto:true};
 private abort?:AbortController;private running=false;private pending=false;private manual=false;private dirtyAt=0;private revision=0;private paused=false;
 private badge=document.createElement('div');private presentedView='';private currentView='';private stageLabel='';
 private presentedApprox=false;private presentedRevision=-1;private samplesShown=0;private samplesTarget=0;private lastUnavailable=false;private resumeFloor=0;private frameStart=0;private interactiveText='';private interactiveRefused='';private finalButton=document.createElement('button');private staleSince=0;private compileSince=0;
 private source?:Scene;private moving=false;private navigationUntil=0;private cameraKey='';private lastLabel='No finished picture';
 get fast(){return this.mode.value==='fast';}
 /** Fast LookDev (kept surfaces) and Live LookDev (one small picture per change) share the same loop, badge and viewport handling. */
 /** Live LookDev 2 is the mode being shown (its own trace kernel can then find surfaces without building any shader). */
 get isLive2(){return this.mode.value==='live2'&&this.active;}
 get interactiveLike(){return this.mode.value==='interactive'||this.mode.value==='live'||this.mode.value==='live2';}
 get active(){return this.mode.value!=='navigation';}
 /** The viewport rests only while a LookDev picture of the current view is on screen; until then (and while the camera moves) it draws its approximation, so the artist never sees an empty window. */
 get holdsViewport(){return this.fast?(this.running||(!this.manual&&(this.paused||!this.auto.checked))):this.interactiveLike?!this.interactiveRefused:this.active&&!this.moving&&!this.surface.hidden;}
 constructor(root:HTMLElement,private view:HTMLCanvasElement,private host:Host){
  this.element.id='lookdev-preview';this.element.style.cssText='display:flex;flex-direction:column;gap:4px';
  this.select(this.mode,'Display mode',[['fast','Explore (simplified view)'],['still','Final Preview'],['interactive','Inspect'],['live','Create (older trial)'],['live2','Create'],['navigation','Explore']],'still'); // LOOKDEV-05B: the artist starts in LookDev: the approximate viewport while the camera moves, the final-geometry picture as soon as it stops
  this.mode.hidden=true;
  this.select(this.width,'Preview width',[['512','Fast 512 px'],['768','768 px'],['1024','1024 px']],String(QUICK_LOOKDEV_WIDTH));
  this.select(this.spp,'Preview samples',[['1','1 spp'],['2','2 spp'],['4','4 spp']],'1');
  this.select(this.geometry,'Preview geometry profile',[['normal','Normal · Geometry Detail off'],['scene','Follow the scene setting']],'normal');
  this.restorePreferences();
  const size=document.createElement('label');size.style.cssText='display:flex;gap:6px;align-items:center;flex-wrap:wrap';size.append(document.createTextNode('Resolution '),this.width,this.sizeNote);
  this.choices.style.cssText='display:flex;flex-direction:column;gap:4px';this.choices.append(size,this.spp,this.geometry);
  this.auto.type='checkbox';this.auto.checked=this.preferred.auto;const automatic=this.label('Automatic update',this.auto);
  const actions=document.createElement('div'),update=document.createElement('button');actions.style.cssText='display:flex;gap:4px;flex-wrap:wrap;align-items:center';
  update.type='button';update.textContent='Update now';update.onclick=()=>{if(!this.active){this.mode.value='still';this.changeMode();}this.invalidate(true);};
  this.pause.type='button';this.pause.textContent='Pause';this.pause.onclick=()=>{this.paused=!this.paused;this.pause.textContent=this.paused?'Resume':'Pause';if(this.paused){this.abort?.abort();this.setStatus('Paused · the last finished picture is kept');}else this.invalidate();};
  this.cancelButton.type='button';this.cancelButton.textContent='Cancel';this.cancelButton.hidden=true;this.cancelButton.title='Cancel the running preview. The last finished picture is kept.';this.cancelButton.onclick=()=>this.cancel();
  this.zoom.type='checkbox';this.zoom.title='One picture pixel per CSS pixel; no extra rendering';this.zoom.onchange=()=>this.layout();this.finalButton.type='button';this.finalButton.id='lookdev-final';this.finalButton.textContent='Final Preview';this.finalButton.title='Switches to Final Preview: the same picture with the final geometry, reflections and refinement.';this.finalButton.hidden=true;this.finalButton.onclick=()=>this.choose('still');
  actions.append(update,this.pause,this.cancelButton,this.label('100 % pixel size',this.zoom));
  this.statusLine.id='lookdev-state';this.statusLine.setAttribute('role','status');this.statusLine.style.cssText='font-size:12px;color:#cfe6f5;min-height:1.2em';
  this.element.append(this.mode,this.choices,automatic,actions,this.statusLine,this.note);
  root.prepend(Object.assign(document.createElement('p'),{className:'ainfo',textContent:'Display mode (Explore, Create, Inspect, Final Preview), resolution and quality are chosen under the View tab. The final quality is saved unchanged.'}));
  this.surface.id='lookdev-image';this.surface.hidden=true;this.surface.style.cssText='position:fixed;z-index:0;pointer-events:none;overflow:hidden;background:#111';
  this.image.style.cssText='display:block;margin:auto';this.surface.append(this.image);
  // Live LookDev 2: the picture that was on screen is laid over the new one and fades out (see crossfadeFrom), so a camera move glides instead of jumping.
  this.fade.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;opacity:0;pointer-events:none';this.surface.append(this.fade);
  this.failureNotice.id='lookdev-failure';this.failureNotice.setAttribute('role','alert');
  this.failureNotice.style.cssText='display:none;position:absolute;inset:0;background:#171717;color:#fff;place-content:center;padding:32px;text-align:center;pointer-events:auto';
  const fallback=document.createElement('button');fallback.type='button';fallback.textContent='Show with Final Preview';fallback.onclick=()=>this.choose('still');
  this.failureNotice.append(this.failureText,fallback);this.surface.append(this.failureNotice);
  document.body.append(this.surface);
  this.badge.id='lookdev-badge';this.badge.setAttribute('role','status');this.badge.style.cssText='position:fixed;z-index:3;pointer-events:none;padding:3px 9px;font:600 12px system-ui;border-radius:3px;color:#fff;max-width:60vw';this.badge.hidden=true;document.body.append(this.badge);
  this.message.id='lookdev-status';this.message.setAttribute('role','status');this.message.style.cssText='position:fixed;bottom:32px;right:16px;z-index:3;max-width:65vw;background:#14212bea;color:#fff;padding:6px 10px;font-size:12px;pointer-events:none';this.message.hidden=true;document.body.append(this.message);
  this.mode.onchange=()=>{this.returnMode='';this.changeMode();};
  for(const select of [this.width,this.spp,this.geometry])select.onchange=()=>{this.savePreferences();this.invalidate();};
  this.auto.onchange=()=>{this.savePreferences();if(this.auto.checked)this.invalidate();};
  this.access.id='preview-access';this.access.setAttribute('role','group');this.access.setAttribute('aria-label','Preview');
  this.access.style.cssText='position:fixed;top:8px;z-index:4;display:flex;flex-direction:column;gap:4px;padding:6px;background:#182028ee;border:1px solid #71818b;border-radius:4px;max-width:min(32rem,calc(100vw - 24px))';
  const modes=document.createElement('div');modes.setAttribute('role','group');modes.setAttribute('aria-label','Preview mode');modes.style.cssText='display:flex;gap:4px;flex-wrap:wrap;align-items:center';
  for(const [value,label,title]of [['navigation','Explore',MODE_HELP.navigation+' The quality is chosen with Viewport next to it.'],['live2','Create',MODE_HELP.live2+' Click again to go back to Explore.'],['interactive','Inspect',MODE_HELP.interactive+' Click again to go back to Explore.'],['still','Final Preview',MODE_HELP.still+' Click again to go back to Explore.']] as const){
   const button=document.createElement('button');button.type='button';button.textContent=label;button.title=title+` Shortcut: F${this.shortcutModes.indexOf(value)+1}.`;button.dataset.previewMode=value;button.style.cssText='padding:4px 10px;font:13px system-ui;cursor:pointer';
   button.onclick=()=>this.choose(value);this.modeButtons.set(value,button);modes.append(button);
  }
  this.installShortcuts();
  // The viewport quality select moves next to the mode buttons: one place for "how is the picture made".
  const quality=document.getElementById('viewport-quality');
  if(quality){Object.assign(quality.style,{position:'static',background:'transparent',padding:'0',display:'inline-flex',gap:'4px',alignItems:'center'});modes.append(quality);}
  // The settings group (resolution, spp, geometry profile, actions, notes) collapses to the slim strip of mode buttons. Only a display toggle:
  // nothing about the scene, the camera, the framing or the render settings changes, and the choice is remembered.
  const collapse=document.createElement('button');collapse.type='button';collapse.id='preview-controls-toggle';collapse.style.cssText='margin-left:auto';
  const setCollapsed=(collapsed:boolean,remember=true)=>{this.access.dataset.collapsed=String(collapsed);collapse.textContent=collapsed?'Show preview settings ▾':'Hide settings ▴';collapse.setAttribute('aria-expanded',String(!collapsed));collapse.title=collapsed?'Show resolution, quality and the other preview settings':'Hide the settings and give the picture more room';collapse.setAttribute('aria-label',collapsed?'Show the preview settings':'Hide the preview settings');if(remember)try{localStorage.setItem('noema.previewControls.collapsed',String(collapsed));}catch{/* a remembered choice is only a convenience */}};
  let stored=false;try{stored=localStorage.getItem('noema.previewControls.collapsed')==='true';}catch{/* default: open */}
  collapse.onclick=()=>setCollapsed(this.access.dataset.collapsed!=='true');setCollapsed(stored,false);modes.append(this.finalButton,collapse); // the final-quality button sits with the mode buttons: the row of small actions below is not shown
  this.help.id='preview-mode-help';this.help.style.cssText='margin:2px 2px 0;font-size:12px;line-height:1.35;color:#cfe6f5;max-width:34rem';this.finalDiff.id='preview-final-diff';this.finalDiff.style.cssText='display:block;color:#bcd0dd;font-size:12px;line-height:1.35';
  this.access.append(modes,this.help,this.finalDiff,this.element);
  const focus=document.createElement('button'),restore=document.createElement('button');
  focus.type=restore.type='button';focus.id='lookdev-focus';restore.id='lookdev-restore';
  focus.textContent='Focus mode';focus.title='Hide the whole preview panel. The side panel is not affected.';
  restore.textContent='Show preview';restore.setAttribute('aria-controls','preview-access');
  restore.style.cssText='position:fixed;top:8px;right:12px;z-index:5;padding:6px 12px';
  const setFocus=(hidden:boolean)=>{this.access.hidden=hidden;restore.hidden=!hidden;focus.setAttribute('aria-expanded',String(!hidden));restore.setAttribute('aria-expanded',String(!hidden));try{localStorage.setItem('noema.lookdev.focus',String(hidden));}catch{/* Optional UI preference. */}};
  focus.onclick=()=>{setFocus(true);restore.focus();};restore.onclick=()=>{setFocus(false);focus.focus();};
  modes.append(focus);document.body.append(this.access,restore);
  let focused=false;try{focused=localStorage.getItem('noema.lookdev.focus')==='true';}catch{/* Default: open. */}setFocus(focused);
  this.changeMode();
  // Observe pointer activity before the viewport mutates camera state. Rendering resumes after idle.
  for(const name of ['pointerdown','pointermove','wheel'] as const)view.addEventListener(name,e=>{if(name==='pointermove'&&!(e as PointerEvent).buttons)return;if(this.active){this.dirtyAt=performance.now();this.navigationUntil=this.dirtyAt+300;if(!this.interactiveLike)this.abort?.abort();this.pending=true;}});
 }
 private restorePreferences(){
  try{
   const raw=JSON.parse(localStorage.getItem(PREFERENCE_KEY)??'null');
   if(raw&&[512,768,1024].includes(raw.width)&&[1,2,4].includes(raw.spp)&&['normal','scene'].includes(raw.geometry)){
    this.preferred={width:raw.width,spp:raw.spp,geometry:raw.geometry,auto:raw.auto!==false};this.width.value=String(raw.width);this.spp.value=String(raw.spp);this.geometry.value=raw.geometry;
   }
  }catch{/* A per-user convenience only. */}
 }
 private savePreferences(){
  this.preferred={width:Number(this.width.value),spp:Number(this.spp.value),geometry:this.geometry.value,auto:this.auto.checked};
  try{localStorage.setItem(PREFERENCE_KEY,JSON.stringify(this.preferred));}catch{/* A per-user convenience only. */}
 }
 /** The mode buttons. A second click on the active Render Preview / LookDev button goes back to the ordinary viewport. */
 /** F1-F4 (the four modes in order). Unlike a button click, pressing the key of the mode already shown does nothing; the camera and the scene are never touched. */
 private readonly shortcutModes:PreviewMode[]=['navigation','live2','interactive','still'];
 private installShortcuts(){
  window.addEventListener('keydown',e=>{
   const index=/^F[1-4]$/.test(e.key)?Number(e.key.slice(1))-1:-1;
   if(index<0||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey)return;
   e.preventDefault();
   const value=this.shortcutModes[index]!;
   if(this.modeButtons.get(value)?.disabled||this.mode.value===value)return;
   this.choose(value);
  });
 }
 private choose(value:PreviewMode){
  const next:PreviewMode=this.mode.value===value&&value!=='navigation'?'navigation':value;
  this.returnMode='';
  this.mode.value=next;this.changeMode();if(this.active)this.invalidate(true);
 }
 /** Stop the running preview. The mode and the last finished image stay. */
 cancel(){
  if(!this.running&&!this.pending)return;
  this.pending=false;this.manual=false;this.abort?.abort();this.cancelButton.hidden=true;this.element.dataset.state='cancelled';this.setStatus('Cancelled · the last finished picture is kept');
 }
 private refreshSize(scene?:Scene){
  if(!this.lastFilm)return;
  const d=lookDevDimensions(this.lastFilm,Number(this.width.value)),spp=Number(this.spp.value),effective=scene?lookDevEffectiveSamples(scene,spp):spp;
  this.sizeNote.textContent=`= ${d.width}×${d.height} px · ${effective} camera samples${effective>spp?' (depth of field needs at least 16)':''}`;
  if(scene){
    const out=outputSize(scene.render,this.lastFilm.width/Math.max(1,this.lastFilm.height)),final=scene.render.quality.samples_per_pixel,gd=!!scene.geometryDetail?.enabled,follows=this.geometry.value==='scene';
    const parts=[`The final render: ${out.width}×${out.height} px, ${final} samples.`,'Same geometry, light, materials and reflections.'];
    if(gd&&!follows)parts.push('Geometry Detail is on in the final render but off here: choose Follow the scene setting for an exact comparison.');else if(gd)parts.push('Geometry Detail follows the scene (can be slow).');
    if(scene.denoise?.enabled)parts.push('Denoising is only part of the final picture.');
    const smaller=d.width<out.width,fewer=effective<final;
    if(smaller||fewer)parts.push(`Here ${smaller?`the picture is smaller (${d.width}×${d.height})`:''}${smaller&&fewer?' and has ':''}${fewer?`${effective} samples against ${final}`:''}: finer noise and fine details can differ.`);
    this.finalDiff.textContent='Differences from the final render: '+parts.join(' ');
  }
 }
 private changeMode(){
  this.failureNotice.style.display='none';this.interactiveRefused='';
  this.revision++;this.abort?.abort();this.pending=false;this.manual=false;
  for(const [value,button] of this.modeButtons)button.setAttribute('aria-pressed',String(this.mode.value===value));
  this.access.dataset.mode=this.mode.value;
  this.choices.hidden=this.mode.value!=='still'&&this.mode.value!=='interactive'&&this.mode.value!=='live2';this.spp.hidden=this.geometry.hidden=this.mode.value==='interactive'||this.mode.value==='live2';this.finalButton.hidden=this.mode.value!=='interactive';this.element.hidden=this.mode.value==='navigation';this.cancelButton.hidden=true;this.zoom.checked=false;
  const helpKey=(this.mode.value==='live'?'live2':this.mode.value==='fast'?'navigation':this.mode.value) as keyof typeof MODE_HELP;this.help.textContent=MODE_HELP[helpKey];this.finalDiff.hidden=this.mode.value!=='still';
  this.note.textContent=this.mode.value==='live2'?'The first picture is coarser and gets sharper while you stand still. Close to the surface a deeper core takes over where the formula supports it (the label says when). Details are in the manual.':this.mode.value==='still'?'The picture is drawn quickly first and refined while the camera stands still. Depth of field uses at least 16 camera samples. 100 %: scroll to inspect the whole picture.':this.mode.value==='interactive'?'The picture appears once at least 4 samples are reshaded and then gets cleaner. A new camera, formula or quality starts a new picture. Depth of field and denoising are missing, so the picture is almost but not quite the final one. Draw final quality with Final Preview.':'';
  this.statusLine.textContent=MODE_NAMES[this.mode.value as PreviewMode];
  this.host.modeChanged?.(this.mode.value as PreviewMode);
  if(this.active){this.source=undefined;this.invalidate();}else this.surface.hidden=this.message.hidden=this.badge.hidden=true;
 }
 preparingFast(preparing=false){if(this.fast){this.element.dataset.state=preparing?'preparing':'rendering';this.setStatus(preparing?'Simplified view · preparing scene/pipeline, compiling if needed…':'Simplified view · updating the viewport…');}}
 /** WebGPU's presentation texture expires at the end of its task. Capture in the
  * render task, then publish only after the existing GPU fence completes. */
 captureViewport(){
  if(!this.fast)return;
  const frame=document.createElement('canvas');frame.width=this.view.width;frame.height=this.view.height;
  frame.getContext('2d')!.drawImage(this.view,0,0);return frame;
 }
 /** Copy only completed, current viewport frames. The previous overlay covers resize/unfinished GPU work. */
 presentViewport(frame:HTMLCanvasElement,scene:Scene,plan:ViewportPlan,elapsedMs:number){
  if(!this.fast)return;
  // Fast viewport uses the ordinary engine; Geometry Detail is a separate still engine.
  this.presentedScene=scene.geometryDetail?.enabled?{...scene,geometryDetail:{...scene.geometryDetail,enabled:false}}:scene;
  this.source=scene;this.image.width=frame.width;this.image.height=frame.height;
  this.image.getContext('2d')!.drawImage(frame,0,0);
  this.surface.hidden=false;this.layout();
  this.lastLabel=`${this.view.width}×${this.view.height} · 1 spp · ${(elapsedMs/1000).toFixed(3)} s · ${fastLookDevDescription(plan)}`;
  this.element.dataset.state='complete';this.element.dataset.presented=String(Number(this.element.dataset.presented??0)+1);this.setStatus('Simplified view · simplified preview');
  this.element.dispatchEvent(new CustomEvent('lookdev-presented',{detail:{kind:'fast',camera:structuredClone(scene.camera),state:plan.state,width:this.view.width,height:this.view.height,elapsedMs,responseMs:performance.now()-this.dirtyAt,quality:plan.quality,features:plan.features}}));
  if(plan.state==='lookdev'){this.manual=false;this.pending=false;}
 }
 private select(el:HTMLSelectElement,label:string,options:string[][],value:string){el.setAttribute('aria-label',label);for(const [v,text]of options)el.add(new Option(text!,v!));el.value=value;}
 private label(text:string,input:HTMLInputElement){const l=document.createElement('label');l.append(input,document.createTextNode(' '+text));return l;}
 private setStatus(text:string){
  this.message.textContent=text+' · '+this.lastLabel;this.message.hidden=!this.active;
  // The same state, readable in the box above the image: which mode, what is happening, and the last finished picture.
  this.statusLine.textContent=MODE_NAMES[this.mode.value as PreviewMode]+' · '+text;
  this.cancelButton.hidden=!(this.mode.value==='still'&&(this.element.dataset.state==='preparing'||this.element.dataset.state==='rendering'));
 }
 private invalidate(manual=false){this.revision++;this.abort?.abort();this.pending=true;this.manual=this.manual||manual;this.dirtyAt=performance.now();if(this.active){if(!this.running)this.element.dataset.state='pending';this.setStatus('Changed · waiting for update');}}
 /** Called by the existing app frame clock, also while a still is in flight. */
 /** Draws the picture again (for example when a background job, such as a shader that was being built, is ready). */
 redraw(){if(this.active&&this.interactiveLike&&!this.interactiveRefused)this.invalidate();}
 /** The mode a final render switched away from (see leaveInteractiveForOutput): the program goes back to it when the output is over. */
 private returnMode:PreviewMode|''='';private outputBusyBefore=false;private outputEndedAt=0;
 observe(scene:Scene,unavailable=false,outputBusy=false){
  if(outputBusy){this.outputBusyBefore=true;this.outputEndedAt=0;}
  else if(this.outputBusyBefore){
   if(!this.outputEndedAt)this.outputEndedAt=performance.now();
   else if(performance.now()-this.outputEndedAt>=RETURN_AFTER_OUTPUT_MS){
    this.outputBusyBefore=false;this.outputEndedAt=0;
    const back=modeAfterOutput(this.returnMode,this.mode.value as PreviewMode);this.returnMode='';
    if(back){this.mode.value=back;this.changeMode();this.setStatus('Back in '+MODE_NAMES[back as PreviewMode]+' after the final render');}
   }
  }
  const bounds=this.view.getBoundingClientRect();this.access.style.left=Math.min(bounds.left+8,window.innerWidth-this.access.offsetWidth-8)+'px';
  if(this.lastUnavailable!==unavailable){this.lastUnavailable=unavailable;if(this.interactiveLike&&this.active){if(unavailable)this.suspendForOutput();else this.resumeAfterOutput();}}
  if(!this.active)return;
  if(this.interactiveLike){this.observeInteractive(scene,unavailable);return;}
  if(unavailable){
   // Something else holds the renderer (a final render, the look thumbnails). A picture under way is given up, but the wish for one stays:
   // without this the render was lost for good and no final-quality picture ever came until the artist changed something (LOOKDEV-04).
   if(this.running||this.pending||!this.element.dataset.presented){this.abort?.abort();this.pending=true;}
   this.dirtyAt=performance.now();return;
  }
  const cameraKey=JSON.stringify(scene.camera);
  if(this.cameraKey&&this.cameraKey!==cameraKey)this.navigationUntil=performance.now()+300;this.cameraKey=cameraKey;
  if(this.source!==scene){this.source=scene;this.invalidate();}
  if(this.mode.value==='still'){const film=this.host.film?.()??this.view.getBoundingClientRect();if(film.width>0&&film.height>0){this.lastFilm={width:film.width,height:film.height};this.refreshSize(scene);}this.currentView=JSON.stringify([scene.camera,this.lastFilm]);}
  const now=performance.now();this.moving=now<this.navigationUntil;
  this.surface.hidden=(!this.fast&&this.moving)||!this.element.dataset.presented||(this.mode.value==='still'&&this.presentedView!==this.currentView);
  this.layout();this.updateBadge();
  if(this.fast)return;
  if(this.running||!this.pending||this.moving||now-this.dirtyAt<250)return;
  if(!this.manual&&(this.paused||!this.auto.checked))return;
  this.pending=false;this.manual=false;void this.render();
 }
 /** Display-only bounds for the existing world picker, including a scrolled 1:1 preview. */
 surfacePickView(scene:Scene){
  if(this.interactiveRefused)return null;
  if(!this.active||this.surface.hidden)return undefined;
  const p=this.presentedScene;
  if(!p||!sameSurfacePickView(p,scene))return null;
  const r=this.image.getBoundingClientRect(),clip=this.surface.getBoundingClientRect();
  const scale=Math.min(r.width/this.image.width,r.height/this.image.height),width=this.image.width*scale,height=this.image.height*scale;
  return {left:r.left+(r.width-width)/2,top:r.top+(r.height-height)/2,width,height,film:{width:this.image.width,height:this.image.height},clip:{left:clip.left,top:clip.top,width:clip.width,height:clip.height}};
 }
 /**
  * RENDER-PRIORITY: a final render (or another output) must have the graphics card to itself. LookDev stops at once, stops adding samples and gives the memory of the kept
  * surfaces back (the device and its compiled shader stay); when the render is over it starts again from the artist's own settings and does not replace the clean picture on
  * screen with a noisy one while it rebuilds the samples. `noema-test-suspend` (off | abort | free) exists for measurements only; the default is free.
  */
 /**
  * FINAL-FIXES-08: a final render leaves Progressive LookDev for Still Image LookDev (the artist's own, proven workaround) and the application stays there afterwards.
  * The progressive loop is stopped and its kept surfaces released first. Nothing is drawn or compiled on the way: while the render holds the card `observe` only keeps the wish
  * for a still picture, which is served after the render. `noema-test-autoswitch=off` exists for measurements only.
  */
 leaveInteractiveForOutput():boolean{
  let off=false;try{off=localStorage.getItem('noema-test-autoswitch')==='off';}catch{}
  if(off||modeForOutput(this.mode.value as PreviewMode)===this.mode.value)return false;
  if(!this.returnMode)this.returnMode=this.mode.value as PreviewMode; // the first mode of a series of renders: the one to come back to
  this.abort?.abort();this.host.interactive?.release?.();this.host.live?.release?.();this.host.live2?.release?.();this.resumeFloor=0;
  this.mode.value=modeForOutput(this.mode.value as PreviewMode);this.changeMode();
  this.setStatus('Final Preview · switched from '+MODE_NAMES[this.returnMode as PreviewMode]+' for the final render (you come back when it is done)');
  return true;
 }
 private suspendMode(){try{return localStorage.getItem('noema-test-suspend')??'free';}catch{return 'free';}}
 private suspendForOutput(){
  const mode=this.suspendMode();if(mode==='off')return;
  this.abort?.abort();
  if(mode==='free'){this.host.interactive?.release?.();this.resumeFloor=this.samplesShown;}
 }
 private resumeAfterOutput(){
  if(this.suspendMode()==='off')return;
  this.pending=true;this.dirtyAt=performance.now();
 }
 /** Interactive mode (INTERACTIVE-LOOKDEV-06): every change of the scene is drawn at once, newest first; there is no debounce and no manual refresh. */
 private observeInteractive(scene:Scene,unavailable:boolean){
  const now=performance.now();
  const cameraKey=JSON.stringify(scene.camera);
  if(this.cameraKey&&this.cameraKey!==cameraKey)this.navigationUntil=now+300;this.cameraKey=cameraKey;
  if(this.source!==scene){this.source=scene;this.interactiveRefused='';this.failureNotice.style.display='none';this.revision++;this.pending=true;this.dirtyAt=now;this.resumeFloor=0;if(this.running)this.abort?.abort();else this.element.dataset.state='pending';}
  const film=this.host.film?.()??this.view.getBoundingClientRect();
  if(film.width>0&&film.height>0){this.lastFilm={width:film.width,height:film.height};this.refreshSize(scene);}
  this.currentView=JSON.stringify([scene.camera,this.lastFilm]);
  this.moving=now<this.navigationUntil;
  // The picture stays on screen while the next one is calculated (dimmed and labelled once it is outdated); a camera move is a change like any other: the surface is
  // calculated again at the new camera, a few hundred milliseconds each, so there is no separate navigation viewport and nothing to wait for.
  this.surface.hidden=!this.element.dataset.presented&&!this.interactiveRefused;
  this.layout();this.updateBadge();
  if(unavailable||this.running||!this.pending||this.paused||!this.auto.checked&&!this.manual)return;
  const refusal=this.mode.value==='live2'?(this.host.live2?this.host.live2.refusal?.(scene)??null:'Create is not available in this version.'):this.mode.value==='live'?(this.host.live?null:'Create is not available in this version.'):this.host.interactive?this.host.interactive.refusal(scene):'Inspect is not available in this version.';
  if(refusal){this.failInteractive(refusal);return;}
  this.interactiveRefused='';this.pending=false;this.manual=false;void this.interactiveFrame();
 }
 private async interactiveFrame(){
  this.running=true;this.frameStart=performance.now();const revision=this.revision,abort=new AbortController();this.abort=abort;
  const captured=this.host.capture();this.source=captured.scene;
  const width=Number(this.width.value);const view=JSON.stringify([captured.scene.camera,captured.size]);
  this.lastFilm=captured.size;this.refreshSize(captured.scene);
  this.element.dataset.state='rendering';this.setStatus('Computing…');
  try{
   const runner=(this.mode.value==='live2'?this.host.live2:this.mode.value==='live'?this.host.live:this.host.interactive)!;
   await runner.run(captured.scene,width,abort.signal,frame=>{
    // Live LookDev 2: a coarse picture that was finished while a newer change had already arrived is still shown (a camera drag would otherwise show nothing until it stops:
    // each coarse picture takes longer than the time between two moves). The newer change then draws over it at once.
    const lateCoarse=this.mode.value==='live2'&&frame.samples===1&&frame.width<Number(this.width.value);
    if((abort.signal.aborted&&!lateCoarse)||!this.active||!this.interactiveLike)return;
    if(this.resumeFloor>0){if(frame.samples<this.resumeFloor)return;this.resumeFloor=0;} // after a final render: keep the clean picture until the rebuilt one is as clean
    // A picture of another camera position follows the one before it within about the time between the pictures, so the fade lasts that long (never longer than FADE_MS): a drag
    // then looks like a steady flow, not like a trail of ghosts. A picture of the same view (more samples, the sharp one after the coarse one) fades for the full FADE_MS.
    const cameraKey=JSON.stringify(captured.scene.camera),clock=performance.now(),movedView=this.shownCameraKey!==''&&this.shownCameraKey!==cameraKey;
    if(this.mode.value==='live2')this.crossfadeFrom(movedView?Math.min(LookDevPreview.FADE_MS,clock-this.lastPresentAt):LookDevPreview.FADE_MS);else this.fade.style.opacity='0';
    this.shownCameraKey=cameraKey;this.lastPresentAt=clock;
    this.image.width=frame.width;this.image.height=frame.height;this.image.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba),frame.width,frame.height),0,0);
    const elapsed=performance.now()-this.frameStart,done=frame.samples>=frame.target;
    this.presentedView=view;this.presentedRevision=revision;this.presentedApprox=false;this.presentedScene=undefined;
    this.interactiveText=frame.limits.join(', ');this.samplesShown=frame.samples;this.samplesTarget=frame.target;
    this.stageLabel=`${frame.width}×${frame.height} · ${frame.samples} of ${frame.target} samples${frame.reshaded?' · reshaded':''} · ${(elapsed/1000).toFixed(2)} s`;this.lastLabel=this.stageLabel;
    this.element.dataset.state=done?'complete':'refining';this.element.dataset.presented=String(Number(this.element.dataset.presented??0)+1);this.surface.hidden=false;this.layout();
    this.setStatus(done?'Done · '+frame.target+' samples':'Refining · '+frame.samples+' of '+frame.target+' samples');
    this.element.dispatchEvent(new CustomEvent('lookdev-presented',{detail:{kind:'interactive',camera:captured.scene.camera.position,cameraTarget:captured.scene.camera.target,final:done,startedAt:this.frameStart,samples:frame.samples,target:frame.target,reshaded:frame.reshaded,fresh:frame.fresh,wrote:frame.fresh,width:frame.width,height:frame.height,gpuMs:frame.gpuMs,elapsedMs:elapsed,responseMs:performance.now()-this.dirtyAt,limits:frame.limits}}));
    this.updateBadge();
   });
   if(!abort.signal.aborted&&this.element.dataset.state!=='error')this.element.dataset.state=this.samplesShown>=this.samplesTarget&&this.samplesTarget>0?'complete':this.element.dataset.state;
  }catch(e){if(!abort.signal.aborted){this.failInteractive(MODE_NAMES[this.mode.value as PreviewMode]+' could not draw: '+String(e instanceof Error?e.message:e));}else this.element.dataset.state='cancelled';}
  finally{this.running=false;this.updateBadge();}
 }
 private failInteractive(reason:string){
  this.pending=false;this.interactiveRefused=reason;this.element.dataset.state='error';
  this.fade.style.opacity='0';this.failureText.textContent=reason;
  this.failureNotice.style.display='grid';this.surface.hidden=false;this.layout();
  this.setStatus(reason);this.finalButton.hidden=false;this.updateBadge();
 }
 private presentedScene?:Scene;
 private readonly fade=document.createElement('canvas');
 /** How long the old picture takes to fade out (milliseconds). Short enough to feel immediate, long enough to take the edge off a jump. */
 static readonly FADE_MS=170;
 private lastPresentAt=0;private shownCameraKey='';
 /**
  * Live LookDev 2: call BEFORE the new picture is drawn into this.image. The picture on screen (including a fade that is still going on) is copied
  * to a layer on top that then fades away, so the screen goes from the old to the new picture smoothly. The pictures may differ in size
  * (the first one after a change is coarser): both are stretched to the same frame by the browser with smooth filtering.
  */
 private crossfadeFrom(duration:number){
  const old=this.image;if(old.width<2||old.height<2||!this.element.dataset.presented)return;
  if(duration<30){this.fade.style.transition='none';this.fade.style.opacity='0';return;} // pictures follow each other fast enough: a fade would only smear the motion
  const f=this.fade,live=Number(getComputedStyle(f).opacity)||0; // how visible the previous fade still is (the browser tracks the transition)
  const keep=document.createElement('canvas');keep.width=old.width;keep.height=old.height;const kc=keep.getContext('2d')!;
  kc.drawImage(old,0,0);
  if(live>0.02&&f.width>0){kc.globalAlpha=live;kc.drawImage(f,0,0,old.width,old.height);}
  f.width=old.width;f.height=old.height;f.getContext('2d')!.drawImage(keep,0,0);
  f.style.transition='none';f.style.opacity='1';void f.offsetWidth; // start from the old picture at full strength
  f.style.transition='opacity '+duration+'ms linear';f.style.opacity='0';
 }
 /**
  * One line that says what the artist is looking at: the approximate navigation picture, or a final-quality LookDev picture (and whether
  * it is the current one). Colour and wording both differ so the two are never mistaken for each other.
  */
 private updateBadge(){
  if(!this.active){this.badge.hidden=true;return;}
  if(this.interactiveLike){this.updateInteractiveBadge();return;}
  let text:string,colour:string,kind:string;
  const compiling=this.compileSince?` · compiling shader ${Math.round((performance.now()-this.compileSince)/1000)} s (the first time can take up to a minute)`:'';
  // Outdated means drawn BEFORE the last change. A picture of the current light that is still being refined is current, not outdated.
  const stale=!this.fast&&!this.surface.hidden&&this.presentedRevision!==this.revision;
  const refining=!stale&&(this.running||this.pending)&&!this.fast&&!this.surface.hidden;
  if(stale){this.staleSince||=performance.now();}else this.staleSince=0;
  if(this.fast){text='APPROXIMATION · navigation quality, simplified light and materials';colour='#8a4b00';kind='approximate';}
  else if(this.surface.hidden){text=this.running&&this.element.dataset.state==='preparing'?'Approximation · final quality is being prepared'+(compiling||' (the scene is compiling; the first time can take a while)'):this.running?'Approximation · final quality is being drawn…':'Approximation (navigation quality) · final quality is drawn when the camera stands still';colour='#8a4b00';kind='approximate';}
  else if(stale){text='OLD PICTURE · the light or material changed, the picture is updating… · '+this.stageLabel+compiling;colour='#7a2e00';kind='stale';}
  else if(this.presentedApprox){text='APPROXIMATE · new light and material, but broad occlusion and contact shadows are missing until the exact shader is ready'+compiling+(refining?' · refining…':'');colour='#8a4b00';kind='approximate';}
  else if(refining){text='FINAL PREVIEW (current light) · refining… · '+this.stageLabel;colour='#1f6b3a';kind='final';}
  else{text='FINAL PREVIEW · '+this.stageLabel;colour='#1f6b3a';kind='final';}
  // An outdated picture must not pass for the current one: it is dimmed once it has been outdated for a moment (a quick answer never flickers).
  this.surface.style.filter=stale&&performance.now()-this.staleSince>700?'grayscale(.75) brightness(.6)':'';
  this.badge.textContent=text;this.badge.style.background=colour;this.badge.hidden=false;this.badge.dataset.kind=kind;
 }
 private updateInteractiveBadge(){
  const now=performance.now();let text:string,colour:string,kind:string;
  const stale=!this.surface.hidden&&this.presentedRevision!==this.revision;
  if(stale){this.staleSince||=now;}else this.staleSince=0;
  const waited=this.running?Math.round((now-this.frameStart)/1000):0;
  const wait=waited>=2?` · ${waited} s${waited>=6?' (the first time the shader and the surface are built, up to a minute)':''}`:'';
  const live2=this.mode.value==='live2',live=this.mode.value==='live'||live2,name=live?'Create':'Inspect',tag=live?'CREATE':'INSPECT';
  const prov=this.samplesTarget>0?`${this.samplesShown} of ${this.samplesTarget} samples`:'';
  if(this.interactiveRefused){text=name+' cannot be used for this scene · '+this.interactiveRefused;colour='#7a2e00';kind='stale';}
  else if(this.surface.hidden){text=(live?'Create is starting':'Inspect: the picture is computed · the surface and shader are built the first time')+wait;colour='#8a4b00';kind='approximate';}
  // The picture shown while a change is being drawn is never dimmed or greyed and carries no warning: dimming made the picture look dark in heavy scenes, exactly when the artist
  // needs to judge material and reflections. A quiet blue "updating" line is enough; the picture itself is replaced as soon as the first re-shaded samples are ready.
  else if(stale){text=tag+' · updating… · '+(prov||'')+wait;colour='#1d4f7a';kind='interactive';}
  else if(this.samplesShown<this.samplesTarget){text=tag+' · '+prov+' · refining… · '+(live2?'':'same quality as the still-picture mode, ')+this.interactiveText+' · not final quality';colour='#1d4f7a';kind='interactive';}
  else{text=tag+' · '+(live?this.stageLabel:prov)+' · done · '+(live2?'':live?'objects are data, no new shader · ':'changes are shaded in at once · ')+this.interactiveText+' · not final quality';colour='#1d4f7a';kind='interactive';}
  this.surface.style.filter=''; // Progressive LookDev never darkens the picture
  this.badge.textContent=text;this.badge.style.background=colour;this.badge.hidden=false;this.badge.dataset.kind=kind;
 }
 private layout(){
  if(!this.active)return;const r=this.view.getBoundingClientRect();
  Object.assign(this.badge.style,{left:Math.max(0,r.left+8)+'px',bottom:Math.max(0,window.innerHeight-r.bottom+8)+'px'});
  Object.assign(this.surface.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',overflow:this.zoom.checked?'auto':'hidden',pointerEvents:this.zoom.checked?'auto':'none'});
  this.image.style.width=this.zoom.checked?this.image.width+'px':'100%';this.image.style.height=this.zoom.checked?this.image.height+'px':'100%';this.image.style.objectFit='contain';
 }
 /**
  * LOOKDEV-05: background work (the thumbnails of the starter presets) waits for LookDev instead of cancelling it, and does not start at all while
  * LookDev is showing pictures. It used to be the other way round: on a heavy fractal each thumbnail took about 7 s and cancelled the picture the
  * artist asked for, so LookDev got its turn only after all of them (38 s), and a click on a look was turned away while one was being drawn.
  * Returns at once when LookDev is not on (the ordinary viewport); the thumbnails then continue where they stopped.
  */
 async whenIdle(signal?:AbortSignal){
  // PRESET-PREVIEWS-09: wait until LookDev has FINISHED its picture (nothing running, nothing waiting), not for as long as LookDev is merely switched on.
  // The old condition never ended in the progressive/still modes, which are the default now: the Light and Material preset thumbnails never started.
  while(this.active&&!this.fast&&(this.running||this.pending)){
   if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
   await new Promise(r=>setTimeout(r,150));
  }
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 }
 /** The engine started or finished building a shader (see main.ts). Shown in the badge so a wait is never silent. */
 setCompiling(on:boolean){this.compileSince=on?(this.compileSince||performance.now()):0;}
 /** The exact shader is ready: if the picture on screen is only an approximation, draw it again with the exact one. */
 exactReady(){if(this.active&&!this.fast&&this.presentedApprox){this.abort?.abort();this.pending=true;this.dirtyAt=performance.now();}} // same light, exact shader: the picture shown is not outdated, so the revision is kept
 /** Let an explicit final export take priority without leaving LookDev mode. */
 async yieldToOutput(){
  // The output goes first, but the wish for a final-quality picture is kept and served afterwards (LOOKDEV-04: the look thumbnails used to
  // cancel it for good, so a heavy scene never got its picture while they were being drawn).
  const wanted=this.running||this.pending;
  this.pending=false;this.abort?.abort();
  while(this.running)await new Promise(r=>setTimeout(r,16));
  if(wanted&&this.active&&!this.fast){this.pending=true;this.dirtyAt=performance.now();}
 }
 private async render(){
  this.running=true;const revision=this.revision,abort=new AbortController();this.abort=abort;
  const captured=this.host.capture();this.source=captured.scene;
  const chosen:LookDevSettings={...DEFAULT_LOOKDEV,width:Number(this.width.value) as LookDevSettings['width'],samples:Number(this.spp.value) as LookDevSettings['samples'],geometry:this.geometry.value as LookDevSettings['geometry']};
  // Progressive: a quick full composition first, then the chosen size and sample count while the camera stays still.
  const quick:LookDevSettings={...chosen,width:QUICK_LOOKDEV_WIDTH,samples:1};
  const REFINED_SAMPLES=8;
  const stages:{settings:LookDevSettings;refine?:number}[]=[];
  if(chosen.width>QUICK_LOOKDEV_WIDTH||chosen.samples>1)stages.push({settings:quick});
  stages.push({settings:chosen});
  if(chosen.samples<REFINED_SAMPLES)stages.push({settings:chosen,refine:REFINED_SAMPLES});
  const view=JSON.stringify([captured.scene.camera,captured.size]);
  const level=describeQuality(captured.scene.render.quality).geometry,levelName=level?GEOMETRY_LEVELS.find(g=>g.id===level)?.label??level:'custom values';
  this.element.dataset.state='preparing';this.setStatus('Preparing / compiling the still pipeline if needed…');
  try{
   for(let index=0;index<stages.length;index++){
    const {settings,refine}=stages[index]!,last=index===stages.length-1,start=performance.now();let firstProgressMs:number|undefined;
    const {scene,size,options,effectiveSamples}=lookDevRequest(captured.scene,captured.size,settings,true,refine);
    this.lastFilm=captured.size;this.refreshSize(captured.scene);
    const image=await this.host.render(scene,size,{...options,signal:abort.signal,onProgress:p=>{if(!abort.signal.aborted){firstProgressMs??=performance.now()-start;this.element.dataset.state='rendering';this.setStatus((index===0&&stages.length>1?'Quick overview ':refine?'Refining ':'Rendering ')+Math.round(p.fraction*100)+' %');}}},text=>{if(!abort.signal.aborted)this.setStatus(text);});
    if(abort.signal.aborted||revision!==this.revision||!this.active)return;
    this.presentedScene=scene; // Actual geometry profile used for this displayed still.
    this.image.width=image.width;this.image.height=image.height;this.image.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data),image.width,image.height),0,0);
    const elapsed=performance.now()-start;
    this.presentedView=view;this.presentedRevision=revision;this.presentedApprox=this.host.approximate?.()??false;
    this.stageLabel=`${image.width}×${image.height} · ${refine??settings.samples} spp${effectiveSamples>(refine??settings.samples)?' (DOF: '+effectiveSamples+' camera samples)':''} · geometry ${settings.geometry==='normal'?levelName+' like the final picture, Geometry Detail off':levelName+', follows the scene'} · ${(elapsed/1000).toFixed(2)} s${last?'':' · refining…'}${this.presentedApprox?' · approximate':''}`;
    this.lastLabel=this.stageLabel;
    this.element.dataset.state=last?'complete':'refining';this.element.dataset.presented=String(Number(this.element.dataset.presented??0)+1);this.surface.hidden=false;this.layout();
    this.setStatus(last?'Done':'Refining · the picture gets sharper while the camera stands still');
    this.element.dispatchEvent(new CustomEvent('lookdev-presented',{detail:{kind:'still',stage:index+1,stages:stages.length,final:last,accurate:true,width:image.width,height:image.height,samples:refine??settings.samples,refined:!!refine,effectiveSamples,geometry:settings.geometry,elapsedMs:elapsed,firstProgressMs,referenceFilm:options.referenceFilm,quality:options.quality}}));
   }
  }catch(e){if(!abort.signal.aborted){this.element.dataset.state='error';this.setStatus('The preview could not be drawn: '+String(e));}else this.element.dataset.state='cancelled';}
  finally{this.running=false;this.cancelButton.hidden=true;this.updateBadge();}
 }
}
