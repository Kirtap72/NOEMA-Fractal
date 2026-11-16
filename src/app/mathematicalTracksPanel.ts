import {timeDraftInput,updateTimeDraft} from './timeDraft';
import {availableBindings,bindingFor,propertyTracks,targetKey} from '../engine/propertyAnimation';
import type {MathematicalTrack,MathematicalValue,MathematicalTarget} from '../engine/propertyAnimation';
import type {Scene} from '../engine/scene';
import type {Formula} from '../engine/formula/types';
import {setInputValue,isNumericEditing} from './numericRange';

export interface MathematicalHandlers {
 add(target:MathematicalTarget):void;capture(trackId:string,keyId?:string):void;
 value(trackId:string,value:MathematicalValue):void;
 change(trackId:string,changes:Partial<Pick<MathematicalTrack,'enabled'|'interpolation'>>):void;
 remove(trackId:string,keyId?:string):void;retime(trackId:string,keyId:string,time:number):void;
 seek(time:number):void;
}
/** Mathematical rows share the camera workspace's ruler, playhead and transport. No second clock. */
export class MathematicalTracksPanel {
 private picker=document.createElement('select');private rows=document.createElement('div');private signature='';
 private expanded=new Map<string,boolean>();private selected=new Map<string,string>();private bindings:ReturnType<typeof availableBindings>=[];
 private refs=new Map<string,{inputs:HTMLInputElement[];current:HTMLOutputElement}>();
 constructor(root:HTMLElement,private formulas:readonly Formula[],private h:MathematicalHandlers){
  const box=document.createElement('div');box.className='math-animation';const title=document.createElement('strong');title.textContent='Shape, material, colour and light';
  this.picker.setAttribute('aria-label','Animate parameter');const add=document.createElement('button');add.textContent='Animate the chosen parameter';add.onclick=()=>{const b=this.bindings.find(b=>targetKey(b.target)===this.picker.value);if(b)h.add(b.target);};
  const note=document.createElement('small');note.textContent='Choose a track, seek a time and change its value. Capture the value explicitly. Base values are saved separately. Julia XYZ requires active Julia mode or its Active track. Colours and linear RGB are entered with their own sliders. Maps, material family, geometry and the special fields of formula kernels are not animated.';
  box.append(title,this.picker,add,note,this.rows);root.append(box);
 }
 update(base:Scene,view:Scene,time:number){
  const tracks=propertyTracks(base.cameraFlight),bindings=availableBindings(base,this.formulas);
  const signature=JSON.stringify([bindings.map(b=>[targetKey(b.target),b.label]),tracks,time<0]);
  // Track edits rebuild only the edited state; playback updates numeric labels/inputs in place.
  if(signature!==this.signature){
   this.signature=signature;this.bindings=bindings;const previous=this.picker.value;this.picker.replaceChildren();
   for(const b of bindings)this.picker.add(new Option(b.label,targetKey(b.target)));if(bindings.some(b=>targetKey(b.target)===previous))this.picker.value=previous;
   this.rows.replaceChildren();this.refs.clear();
   for(const track of tracks){
    const binding=bindingFor(base,this.formulas,track.target),row=document.createElement('details');row.open=this.expanded.get(track.id)??true;row.addEventListener('toggle',()=>{if(row.isConnected)this.expanded.set(track.id,row.open);});row.className='math-track';row.dataset.trackId=track.id;
    const heading=document.createElement('summary');heading.textContent=binding?.label??'Unresolved track · '+(track.target.kind==='formula-parameter'?track.target.formulaId+' / '+track.target.parameter:track.target.kind);row.append(heading);
    const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=track.enabled;enabled.onchange=()=>this.h.change(track.id,{enabled:enabled.checked});const mute=document.createElement('label');mute.append(enabled,'Track active');row.append(mute);
    const interpolation=document.createElement('select');for(const [name,v] of [['Linear','linear'],['Soft','smooth'],['Hold','step']])interpolation.add(new Option(name,v));interpolation.value=track.interpolation;interpolation.disabled=track.valueType==='step';interpolation.setAttribute('aria-label','Parameter transition');interpolation.onchange=()=>hChange();const hChange=()=>this.h.change(track.id,{interpolation:interpolation.value as MathematicalTrack['interpolation']});row.append(interpolation);
    const current=document.createElement('output');row.append(current);const inputs:HTMLInputElement[]=[];
    if(binding){
     const count=track.valueType==='vector'||track.valueType==='color'&&Array.isArray(binding.value)?3:1;
     for(let i=0;i<count;i++){
      const input=document.createElement('input');input.type=track.valueType==='step'?'checkbox':track.valueType==='color'&&typeof binding.value==='string'?'color':'number';input.step='any';input.min=String(binding.min);input.max=String(binding.max);input.setAttribute('aria-label',count===3?'Track value '+['X','Y','Z'][i]:'Track value');
      input.onchange=()=>{if(inputs.some(n=>n.type!=='checkbox'&&n.type!=='color'&&(!n.value.trim()||!n.checkValidity())))return;const value:MathematicalValue=track.valueType==='step'?input.checked:input.type==='color'?input.value:count===3?inputs.map(n=>Number(n.value)) as [number,number,number]:Number(input.value);this.h.value(track.id,value);};inputs.push(input);row.append(input);
     }
    }else{const warning=document.createElement('p');warning.className='math-unresolved';warning.textContent='The target is missing or not supported. The track affects nothing; delete it and choose a new target for a deliberate rebinding.';row.append(warning);}
    const button=(text:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=text;b.onclick=run;row.append(b);return b;};
    button('Capture parameter value',()=>this.h.capture(track.id)).disabled=!binding;
    const selected=track.keyframes.find(k=>k.id===this.selected.get(track.id));
    button('Update the chosen parameter key',()=>this.h.capture(track.id,selected?.id)).disabled=!binding||!selected;
    const markers=document.createElement('div');markers.className='math-markers';row.append(markers);
    for(const key of track.keyframes){
     const marker=document.createElement('button');marker.textContent='◆ '+key.time_seconds.toFixed(3)+' s';marker.setAttribute('aria-pressed',String(selected?.id===key.id));marker.className=selected?.id===key.id?'selected':'';
     marker.onclick=()=>{this.selected.set(track.id,key.id);this.signature='';this.h.seek(key.time_seconds);};marker.title='Choose and show the key. Change the time below.';markers.append(marker);
    }
    if(selected){const input=timeDraftInput('Parameter key: time (s)',0,value=>this.h.retime(track.id,selected.id,value));updateTimeDraft(input,selected.time_seconds);row.append(input);button('Delete parameter key',()=>this.h.remove(track.id,selected.id));}
    button('Delete parameter track',()=>this.h.remove(track.id));this.refs.set(track.id,{inputs,current});this.rows.append(row);
   }
  }
  for(const track of tracks){const ref=this.refs.get(track.id),b=bindingFor(view,this.formulas,track.target);if(!ref||!b)continue;ref.current.textContent=`${track.enabled?'Shown':'Base value'} at ${time.toFixed(3)} s: ${JSON.stringify(b.value)}`;
   ref.inputs.forEach((input,i)=>{if(isNumericEditing(input))return;if(input.type==='checkbox')input.checked=b.value as boolean;else if(input.type==='color')input.value=b.value as string;else setInputValue(input,Array.isArray(b.value)?b.value[i]!:b.value as number);});
  }
 }
}
