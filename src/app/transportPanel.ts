import {defaultTransport} from '../engine';
import type {TransportSettings} from '../engine';
export class TransportPanel {
 private enabled:HTMLInputElement;
 private bounces:HTMLInputElement;
 constructor(root:HTMLElement,change:(settings:TransportSettings)=>void){
  const label=document.createElement('label');label.className='arow';label.textContent='Geometric transmission';this.enabled=document.createElement('input');this.enabled.type='checkbox';this.enabled.setAttribute('aria-label','Geometric transmission');label.append(this.enabled);root.append(label);
  const row=document.createElement('label');row.className='arow';row.textContent='Max transport bounces';this.bounces=document.createElement('input');this.bounces.type='number';this.bounces.min='0';this.bounces.max='8';this.bounces.step='1';this.bounces.setAttribute('aria-label','Max transport bounces');row.append(this.bounces);root.append(row);
  const emit=()=>{if(this.bounces.checkValidity())change({enabled:this.enabled.checked,maxBounces:Number(this.bounces.value)});};this.enabled.addEventListener('change',emit);this.bounces.addEventListener('change',emit);
  const note=document.createElement('div');note.className='ainfo';note.textContent='Choose a glass preset and turn on transmission. Final Preview/final render traces spheres and boxes with both entry and exit. Fractals, planes, open cuts and nested glass volumes are not supported as volumes. The same sample/step budget as reflections; the global limit counts all secondary rays.';root.append(note);this.update(defaultTransport());
 }
 update(settings:TransportSettings=defaultTransport()){this.enabled.checked=settings.enabled;this.bounces.disabled=!settings.enabled;if(document.activeElement!==this.bounces)this.bounces.value=String(settings.maxBounces);}
}
