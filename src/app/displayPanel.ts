import {defaultDisplay} from '../engine/display';
import type {DisplaySettings} from '../engine/display';
export class DisplayPanel {
 private exposure:HTMLInputElement;
 private mode:HTMLSelectElement;
 private transfer:HTMLSelectElement;
 constructor(root:HTMLElement,change:(d:DisplaySettings)=>void){
  const row=(label:string,control:HTMLElement)=>{const r=document.createElement('label');r.className='arow';r.textContent=label;r.append(control);root.append(r);};
  this.exposure=document.createElement('input');this.exposure.type='number';this.exposure.min='-20';this.exposure.max='20';this.exposure.step='.25';this.exposure.setAttribute('aria-label','Exposure EV');row('Exposure (EV)',this.exposure);
  this.mode=document.createElement('select');this.mode.setAttribute('aria-label','Tone mapping');for(const [label,value] of [['Linear / clip','linear'],['Reinhard','reinhard'],['Filmic (ACES-like)','filmic']])this.mode.add(new Option(label,value));row('Tone mapping',this.mode);
  this.transfer=document.createElement('select');this.transfer.setAttribute('aria-label','Display transfer');this.transfer.add(new Option('Compatible gamma 2.2','legacy-gamma'));this.transfer.add(new Option('sRGB','srgb'));row('Display curve',this.transfer);
  const emit=()=>{if(this.exposure.checkValidity())change({exposure:Number(this.exposure.value),toneMapping:this.mode.value as DisplaySettings['toneMapping'],transfer:this.transfer.value as DisplaySettings['transfer']});};for(const c of [this.exposure,this.mode,this.transfer])c.addEventListener('change',emit);this.update();
 }
 update(d=defaultDisplay()){if(document.activeElement!==this.exposure)this.exposure.value=String(d.exposure);this.mode.value=d.toneMapping;this.transfer.value=d.transfer;}
}
