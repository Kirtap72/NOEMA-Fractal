import {MAX_FLIGHT_SECONDS} from '../engine/cameraFlight';

/** A time draft is independent of the per-frame presentation update. No commit on input. */
export function parseTimeDraft(text:string,min=0,max=MAX_FLIGHT_SECONDS):number {
 const match=text.trim().replace(',','.').match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(s|sec|min|m|h)?$/i);
 const factor=match?.[2]?.toLowerCase();const value=match?Number(match[1])*(factor==='h'?3600:factor==='min'||factor==='m'?60:1):NaN;
 if(!Number.isFinite(value)||value<min||value>max)throw Error('Enter a valid time, for example 20, 90 s, 20 min or 3 h. The time must fit in safe second/frame arithmetic.');
 return value;
}
const drafts=new WeakMap<HTMLInputElement,{dirty:boolean;committed:number}>();
export function timeDraftInput(label:string,min:number,commit:(value:number)=>void,max=MAX_FLIGHT_SECONDS):HTMLInputElement {
 const input=document.createElement('input');input.type='text';input.inputMode='decimal';input.setAttribute('role','spinbutton');input.setAttribute('aria-label',label);input.setAttribute('aria-valuemin',String(min));
 const feedback=document.createElement('small');feedback.setAttribute('role','alert');const state={dirty:false,committed:min};drafts.set(input,state);
 input.addEventListener('input',()=>{state.dirty=true;input.setCustomValidity('');input.removeAttribute('aria-invalid');feedback.textContent='';});
 const save=()=>{if(!state.dirty)return;try{const value=parseTimeDraft(input.value,min,max);commit(value);state.committed=value;state.dirty=false;input.value=String(value);input.setCustomValidity('');input.removeAttribute('aria-invalid');feedback.textContent='';}catch(e){input.setCustomValidity((e as Error).message);input.setAttribute('aria-invalid','true');feedback.textContent=(e as Error).message;input.after(feedback);}};
 input.addEventListener('blur',save);input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save();}if(e.key==='Escape'){state.dirty=false;input.value=String(state.committed);input.setCustomValidity('');input.removeAttribute('aria-invalid');feedback.textContent='';e.stopPropagation();}});
 return input;
}
export function updateTimeDraft(input:HTMLInputElement,value:number){const state=drafts.get(input);if(state){state.committed=value;if(state.dirty)return;}if(state||document.activeElement!==input)input.value=String(value);input.setAttribute('aria-valuenow',String(value));}
