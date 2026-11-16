import {timeDraftInput,updateTimeDraft} from './timeDraft';
import {MathematicalTracksPanel} from './mathematicalTracksPanel';
import type {MathematicalHandlers} from './mathematicalTracksPanel';
import type {Formula} from '../engine/formula/types';
import {propertyTracks,bindingFor} from '../engine/propertyAnimation';
import {cameraKeys,defaultCameraFlight,flightTimecode,MAX_CAMERA_KEYS,MAX_FLIGHT_SECONDS} from '../engine/cameraFlight';
import type {CameraFlight,CameraFlightClock} from '../engine/cameraFlight';
import type {Scene} from '../engine/scene';
import {isNumericEditing,setInputValue} from './numericRange';
export interface CameraFlightHandlers {
 seek(t:number):void;play():void;pause():void;stop():void;capture(nextSeconds?:number):void;
 goto(id:string):void;update(id:string):void;remove(id:string):void;retime(id:string,time:number):void;segment(id:string,seconds:number):void;
 settings(changes:Partial<Pick<CameraFlight,'fps'|'duration_seconds'|'loop'|'enabled'>>):void;
 exit?():void;cameraEnabled?(enabled:boolean):void;
 interpolation(mode:'linear'|'smooth'):void;undo():void;canUndo():boolean;
}
/** Optional artist workspace; frame updates change only the playhead/text, never rebuild the track. */
export class CameraFlightPanel {
 private section=document.createElement('details');private body=document.createElement('div');private keys=document.createElement('div');
 private ruler=document.createElement('div');private markerArea=document.createElement('div');private head=document.createElement('div');
 private slider=document.createElement('input');private label=document.createElement('output');private status=document.createElement('small');
 private math:MathematicalTracksPanel|undefined;private cameraEnabled=document.createElement('input');
 private selected='';private signature='';private dragging=false;private clip=defaultCameraFlight();
 private selectedControls=document.createElement('div');private timeInput!:HTMLInputElement;private segmentInput!:HTMLInputElement;
 private duration!:HTMLInputElement;private fps=document.createElement('select');private interpolation=document.createElement('select');
 private loop=document.createElement('input');private enabled=document.createElement('input');private playButton!:HTMLButtonElement;private undoButton!:HTMLButtonElement;
 private nextInput!:HTMLInputElement;private nextButton!:HTMLButtonElement;private captureButton!:HTMLButtonElement;
 constructor(root:HTMLElement,private h:CameraFlightHandlers,private formulas:readonly Formula[]=[],mathHandlers?:MathematicalHandlers){
  this.section.id='camera-flight-workspace';const summary=document.createElement('summary');summary.textContent='Animation 2.0 · Camera, shape and light';this.section.append(summary,this.body);root.append(this.section);this.body.className='camera-flight-body';
  this.section.addEventListener('toggle',()=>{if(!this.section.open){this.h.pause();this.h.exit?.();}});
  const note=document.createElement('p');note.textContent='Animate camera, shape, material, gradient and light at the same playhead.';this.body.append(note);
  this.enabled.type='checkbox';this.enabled.onchange=()=>h.settings({enabled:this.enabled.checked});this.body.append(this.checkRow('Animation clip active',this.enabled));
  const transport=document.createElement('div');transport.className='rbuttons';this.playButton=this.button('Play from here',()=>h.play());transport.append(this.playButton,this.button('Pause',()=>h.pause()),this.button('Stop / 0 s',()=>h.stop()),this.button('Previous',()=>this.adjacent(-1)),this.button('Next',()=>this.adjacent(1)));this.body.append(transport,this.label);
  this.slider.type='range';this.slider.min='0';this.slider.step='.001';this.slider.setAttribute('aria-label','Camera flight: playhead (s)');this.slider.oninput=()=>h.seek(Number(this.slider.value));
  const track=document.createElement('div');track.className='camera-flight-track';this.ruler.className='flight-ruler';this.markerArea.className='flight-markers';this.head.className='flight-head';track.append(this.ruler,this.markerArea,this.head);this.body.append(track,this.slider);
  this.captureButton=this.button('Capture the current view',()=>h.capture());this.body.append(this.captureButton);
  this.nextInput=this.number('Next travel time (s)',.001,MAX_FLIGHT_SECONDS,()=>{});updateTimeDraft(this.nextInput,4);this.nextButton=this.button('Add the next camera key',()=>h.capture(Number(this.nextInput.value)));this.body.append(this.nextButton);
  this.keys.className='flight-key-list';this.body.append(this.keys);
  this.timeInput=this.number('Chosen key: time (s)',0,MAX_FLIGHT_SECONDS,v=>h.retime(this.selected,v),this.selectedControls);
  this.segmentInput=this.number('Travel time from the previous (s)',.001,MAX_FLIGHT_SECONDS,v=>h.segment(this.selected,v),this.selectedControls);
  const actions=document.createElement('div');actions.className='rbuttons';actions.append(this.button('Go to key',()=>h.goto(this.selected)),this.button('Update from the current view',()=>h.update(this.selected)),this.button('Delete key',()=>h.remove(this.selected)));this.selectedControls.append(actions);this.body.append(this.selectedControls);
  this.cameraEnabled.type='checkbox';this.cameraEnabled.onchange=()=>h.cameraEnabled?.(this.cameraEnabled.checked);this.body.append(this.checkRow('Camera track active',this.cameraEnabled));
  if(mathHandlers)this.math=new MathematicalTracksPanel(this.body,formulas,mathHandlers);
  this.duration=this.number('Clip length (s)',.1,MAX_FLIGHT_SECONDS,v=>h.settings({duration_seconds:v}));
  for(const n of [24,25,30,60])this.fps.add(new Option(String(n),String(n)));this.fps.setAttribute('aria-label','Camera flight FPS');this.fps.onchange=()=>h.settings({fps:Number(this.fps.value)});this.body.append(this.row('FPS',this.fps));
  this.interpolation.add(new Option('Smooth flight','smooth'));this.interpolation.add(new Option('Linear','linear'));this.interpolation.setAttribute('aria-label','Camera transition');this.interpolation.onchange=()=>h.interpolation(this.interpolation.value as 'smooth'|'linear');this.body.append(this.row('Transition',this.interpolation));
  this.loop.type='checkbox';this.loop.onchange=()=>h.settings({loop:this.loop.checked});this.body.append(this.checkRow('Loop preview',this.loop));
  this.undoButton=this.button('Undo the latest scene change',()=>h.undo());this.body.append(this.undoButton,this.status);
  const limits=document.createElement('small');limits.textContent='All tracks share the playhead. Close the workspace for base values. The picture format applies to the whole clip. Smooth position continues through keys; the camera rotation slows down at every key. A still render uses the current view.';this.body.append(limits);
 }
 private row(label:string,input:HTMLElement){const row=document.createElement('label');row.className='arow';const span=document.createElement('span');span.textContent=label;row.append(span,input);return row;}
 private checkRow(label:string,input:HTMLInputElement){const row=document.createElement('label');row.append(input,document.createTextNode(label));return row;}
 private button(text:string,run:()=>void){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=run;return b;}
 private number(label:string,min:number,max:number,change:(v:number)=>void,root=this.body){const input=timeDraftInput(label,min,change,max);root.append(this.row(label,input));return input;}
 private adjacent(direction:number){const t=Number(this.slider.value),camera=cameraKeys(this.clip),keys=[...camera,...propertyTracks(this.clip).filter(t=>t.enabled).flatMap(t=>t.keyframes)].sort((a,b)=>a.time_seconds-b.time_seconds);const k=direction<0?[...keys].reverse().find(k=>k.time_seconds<t-.0001):keys.find(k=>k.time_seconds>t+.0001);if(k){if(camera.some(c=>c.id===k.id)){this.select(k.id);this.h.goto(k.id);}else this.h.seek(k.time_seconds);}}
 select(id:string){this.selected=id;this.signature='';}
 reset(){this.selected='';this.signature='';this.status.textContent='';}
 setStatus(message:string){this.status.textContent=message;}
 update(scene:Scene,clock:CameraFlightClock,view=scene){
  this.math?.update(scene,view,clock.time);
  this.clip=scene.cameraFlight??defaultCameraFlight();const a=this.clip,keys=cameraKeys(a);if(!keys.some(k=>k.id===this.selected))this.selected='';
  const set=(input:HTMLInputElement,value:number)=>{if(input.type==='text')updateTimeDraft(input,value);else if(!isNumericEditing(input))setInputValue(input,value);};
  this.slider.max=String(a.duration_seconds);set(this.slider,clock.time);this.label.textContent=`${clock.time.toFixed(3)} / ${a.duration_seconds.toFixed(3)} s · ${flightTimecode(clock.time,a.fps)} · frame ${Math.round(clock.time*a.fps)}`;
  this.head.style.left=`${clock.time/a.duration_seconds*100}%`;set(this.duration,a.duration_seconds);this.enabled.checked=a.enabled;this.cameraEnabled.checked=a.tracks[0].enabled!==false;this.loop.checked=a.loop;
  if(![...this.fps.options].some(o=>o.value===String(a.fps)))this.fps.add(new Option(String(a.fps),String(a.fps)));this.fps.value=String(a.fps);this.interpolation.value=a.tracks[0].interpolation;
  this.playButton.disabled=!([a.tracks[0].enabled!==false?keys:[],...propertyTracks(a).filter(t=>t.enabled&&bindingFor(scene,this.formulas,t.target)).map(t=>t.keyframes)].some(keys=>keys.length>=2))||!a.enabled||clock.playing;this.nextButton.disabled=keys.length===0||keys.length>=MAX_CAMERA_KEYS;this.captureButton.disabled=keys.length>=MAX_CAMERA_KEYS;this.undoButton.disabled=!this.h.canUndo();
  const index=keys.findIndex(k=>k.id===this.selected);this.selectedControls.hidden=index<0;
  if(index>=0){set(this.timeInput,keys[index]!.time_seconds);this.segmentInput.disabled=index===0;set(this.segmentInput,index?keys[index]!.time_seconds-keys[index-1]!.time_seconds:0);}
  const signature=JSON.stringify([keys.map(k=>[k.id,k.time_seconds]),a.duration_seconds,this.selected]);if(signature===this.signature||this.dragging)return;this.signature=signature;
  this.ruler.replaceChildren();for(let i=0;i<=4;i++){const tick=document.createElement('span');tick.textContent=(a.duration_seconds*i/4).toFixed(1)+' s';this.ruler.append(tick);}
  this.markerArea.replaceChildren();this.keys.replaceChildren();keys.forEach((k,i)=>{
   const marker=this.button('◆',()=>{this.select(k.id);this.h.goto(k.id);});marker.className='flight-marker'+(k.id===this.selected?' selected':'');marker.style.left=`${k.time_seconds/a.duration_seconds*100}%`;marker.setAttribute('aria-label',`Camera key ${i+1}, ${k.time_seconds.toFixed(3)} seconds`);marker.setAttribute('aria-pressed',String(k.id===this.selected));marker.title='Click for the chosen view. Drag to move the time.';
   let start=0,latest=k.time_seconds,oldTime=clock.time,changed=false;
   marker.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();this.select(k.id);for(const m of this.markerArea.children){m.classList.toggle('selected',m===marker);m.setAttribute('aria-pressed',String(m===marker));}this.dragging=true;start=e.clientX;latest=k.time_seconds;oldTime=clock.time;changed=false;marker.setPointerCapture(e.pointerId);};
   marker.onpointermove=e=>{if(!this.dragging||!marker.hasPointerCapture(e.pointerId))return;changed=changed||Math.abs(e.clientX-start)>3;if(!changed)return;const rect=this.markerArea.getBoundingClientRect();latest=Math.round(Math.max(0,Math.min(a.duration_seconds,(e.clientX-rect.left)/rect.width*a.duration_seconds))*1000)/1000;marker.style.left=`${latest/a.duration_seconds*100}%`;this.h.seek(latest);};
   marker.onpointerup=e=>{if(!this.dragging)return;this.dragging=false;marker.releasePointerCapture(e.pointerId);if(changed)this.h.retime(k.id,latest);else this.h.goto(k.id);this.signature='';};
   marker.onpointercancel=()=>{this.dragging=false;this.signature='';this.h.seek(oldTime);};this.markerArea.append(marker);
   marker.onlostpointercapture=()=>{if(this.dragging){this.dragging=false;this.signature='';this.h.seek(oldTime);}};
   const choice=this.button(`Vy ${i+1} · ${k.time_seconds.toFixed(3)} s`,()=>{this.select(k.id);this.h.goto(k.id);});choice.setAttribute('aria-pressed',String(k.id===this.selected));choice.className=k.id===this.selected?'selected':'';this.keys.append(choice);
  });
 }
}
