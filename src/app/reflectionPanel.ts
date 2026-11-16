import {defaultReflections,REFLECTION_LIMITS} from '../engine';
import type {ReflectionSettings} from '../engine';
/** Scene controls stay separate from effective, temporary viewport budgets. */
export class ReflectionPanel {
  private denoise:HTMLInputElement;
  private diffuseGi:HTMLInputElement;
  private enabled:HTMLInputElement;
  private gainNote=document.createElement("div");
  private values=new Map<keyof typeof REFLECTION_LIMITS,HTMLInputElement>();
  constructor(root:HTMLElement,private change:(settings:ReflectionSettings)=>void,private changeDenoise?:(enabled:boolean)=>void,private changeDiffuseGi?:(enabled:boolean)=>void){
    const title=document.createElement('label');title.className='arow';title.textContent='Raytraced reflections';
    this.enabled=document.createElement('input');this.enabled.type='checkbox';this.enabled.setAttribute('aria-label','Raytraced reflections');title.append(this.enabled);root.append(title);
    const giRow=document.createElement('label');giRow.className='arow';giRow.textContent='Indirect diffuse GI (1 bounce)';this.diffuseGi=document.createElement('input');this.diffuseGi.type='checkbox';this.diffuseGi.setAttribute('aria-label','Diffuse GI');this.diffuseGi.addEventListener('change',()=>this.changeDiffuseGi?.(this.diffuseGi.checked));giRow.append(this.diffuseGi);root.append(giRow);giRow.hidden=!changeDiffuseGi;
    const denoiseRow=document.createElement('label');denoiseRow.className='arow';denoiseRow.textContent='Denoise';this.denoise=document.createElement('input');this.denoise.type='checkbox';this.denoise.setAttribute('aria-label','Denoise');this.denoise.addEventListener('change',()=>this.changeDenoise?.(this.denoise.checked));denoiseRow.append(this.denoise);root.append(denoiseRow);denoiseRow.hidden=!changeDenoise;
    const hint=document.createElement('div');hint.className='ainfo';hint.textContent='Reflections between the fractal and scene objects, up to four bounces. 0 uses environment reflection. Final Preview starts with one bounce and refines while the picture stands still. Explore turns it off; Inspect uses environment reflection.';root.append(hint);
    if(changeDiffuseGi){const giNote=document.createElement('div');giNote.className='ainfo';giNote.textContent='Indirect diffuse GI (1 bounce, GI2B): physically motivated secondary light in cavities with full DS/detail geometry. Default OFF (unchanged legacy rendering).';root.append(giNote);}
    if(changeDenoise){const note=document.createElement('div');note.className='ainfo';note.textContent='Denoise reduces noise and preserves surface edges. Final Preview is filtered after four accumulated samples; the final picture after the whole saved sample budget.';root.append(note);}
    const labels={secondary_radiance_gain:'Secondary reflection strength',maxReflectionBounces:'Max reflection bounces',samples:'Reflection samples (final)',max_steps:'Reflection steps',max_distance:'Reflection distance',hit_threshold:'Reflection hit threshold'};
    const emit=()=>{const settings=defaultReflections();settings.enabled=this.enabled.checked;for(const [key,input] of this.values){if(!input.checkValidity())return;settings[key]=Number(input.value);}this.change(settings);};
    this.enabled.addEventListener('change',emit);
    for(const key of Object.keys(labels) as (keyof typeof labels)[]){
      const row=document.createElement('label');row.className='arow';row.textContent=labels[key];const input=document.createElement('input');input.type='number';input.setAttribute('aria-label',labels[key]);input.min=String(REFLECTION_LIMITS[key][0]);input.max=String(REFLECTION_LIMITS[key][1]);input.step=['samples','max_steps','maxReflectionBounces'].includes(key)?'1':'any';input.addEventListener('change',emit);row.append(input);root.append(row);this.values.set(key,input);
    }
    this.gainNote.className="ainfo";this.gainNote.id="secondary-radiance-effective";root.append(this.gainNote);
    this.update(defaultReflections());
  }
  update(settings:ReflectionSettings,denoise=false,transport=false,diffuseGi=false){this.gainNote.textContent=`Research option · Gain ${(settings.secondary_radiance_gain??0).toLocaleString("en-GB",{minimumFractionDigits:1})}`+(!settings.enabled||settings.maxReflectionBounces===0?" — inactive: secondary tracing is off.":transport?" — inactive: transport uses the unchanged separate light path.":" · Secondary radiance only; direct specular light is preserved.");this.diffuseGi.checked=diffuseGi;this.diffuseGi.disabled=transport;this.denoise.checked=denoise;this.enabled.checked=settings.enabled;for(const [key,input] of this.values){if(document.activeElement!==input)input.value=String(settings[key]??0);input.disabled=key==='secondary_radiance_gain'?(!settings.enabled||settings.maxReflectionBounces===0||transport):key==='maxReflectionBounces'?!settings.enabled:!settings.enabled&&!transport;}}
}
