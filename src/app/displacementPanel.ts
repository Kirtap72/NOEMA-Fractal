import {defaultDisplacement,displacementUnsupported} from '../engine/displacement';
import type {MaterialSettings} from '../engine/material';
import type {DisplacementSettings} from '../engine/displacement';
import {readMaterialMap} from './materialMapLoader';

/** Explicit opt-in; importing an M2A height set never activates this panel. */
export class DisplacementPanel {
 private last:MaterialSettings={metallic:0,roughness:1,reflectivity:0};private target='fractal';private enabled=document.createElement('input');private fields=new Map<string,HTMLInputElement>();private note=document.createElement('p');private name=document.createElement('span');private preview=new Image();private status=document.createElement('output');private loader?:AbortController;
 constructor(root:HTMLElement,private change:(d:DisplacementSettings)=>void){
  const section=document.createElement('details');section.className='geometric-displacement';section.append(Object.assign(document.createElement('summary'),{textContent:'Displacement · real geometry'}));root.append(section);
  const row=(label:string,element:HTMLElement)=>{const r=document.createElement('label');r.className='arow';r.append(Object.assign(document.createElement('span'),{textContent:label}),element);section.append(r);};
  const button=(label:string,click:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=click;section.append(b);return b;};
  this.enabled.type='checkbox';this.enabled.setAttribute('aria-label','Geometric displacement on');this.enabled.onchange=()=>this.edit(d=>d.enabled=this.enabled.checked);row('Activate geometry',this.enabled);
  for(const [key,label,max,step] of [['strength','Displacement strength',1,.01],['heightScale','Geometric height scale',.25,.001],['reference','Displacement zero level',1,.01]] as const){const input=document.createElement('input');input.type='number';input.min='0';input.max=String(max);input.step=String(step);input.setAttribute('aria-label',label);input.onchange=()=>{if(input.checkValidity()&&Number.isFinite(Number(input.value)))this.edit(d=>d[key]=Number(input.value));};this.fields.set(key,input);row(label,input);}
  const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg';file.hidden=true;file.setAttribute('aria-label','Displacement height map');section.append(file);button('Choose displacement map…',()=>file.click());
  file.onchange=()=>{const f=file.files?.[0];file.value='';if(f)void this.load(f);};
  button('Use the existing bump map',()=>{const texture=this.last.surfaceDetail?.bump.texture;if(texture)this.edit(d=>d.texture=structuredClone(texture));else this.status.textContent='There is no bump map to copy.';});
  button('Remove the displacement map',()=>{this.loader?.abort();this.edit(d=>{d.enabled=false;delete d.texture;});});
  button('Cancel displacement reading',()=>{this.loader?.abort();this.status.textContent='The picture reading was cancelled without changes.';});
  this.preview.width=64;this.preview.height=48;this.preview.alt='Displacement height map';this.preview.onerror=()=>{this.preview.hidden=true;this.status.textContent='The preview of the height map could not be read.';};
  this.note.className='ainfo';section.append(this.preview,this.name,this.note,this.status,Object.assign(document.createElement('p'),{className:'ainfo',textContent:'Bump/normal change the light. Displacement moves the surface, the silhouette and the ray hits. The red channel is linear height. Height scale is in local object units (at most 0.25); zero level 0.5. Plane uses XZ, spheres triplanar projection on the base sphere. Common map scale/rotation/offset is found under Texture set · PBR. Navigation keeps the geometry. Dense maps/grazing rays can reach the ray budget; test the final render. Grounding uses the base shape of the object. Mesh/SDF export does not bake these own objects.'}));
 }
 private edit(edit:(d:DisplacementSettings)=>void){this.loader?.abort();const d=structuredClone(this.last.displacement??defaultDisplacement());edit(d);this.change(d);}
 private async load(file:File){this.loader?.abort();const control=this.loader=new AbortController(),original=this.last;this.status.textContent='Reading the height map…';try{const image=await readMaterialMap(file,control.signal);control.signal.throwIfAborted();if(this.last!==original)throw Error('The material changed during the reading. No map was changed.');this.edit(d=>d.texture=image);this.status.textContent='The map is saved; activate displacement explicitly.';}catch(error){if(!control.signal.aborted)this.status.textContent=String(error);}}
 update(material:MaterialSettings,target='fractal'){
  this.last=material;this.target=target;const d=material.displacement??defaultDisplacement(),reason=displacementUnsupported(material,this.target);
  this.enabled.checked=d.enabled;this.enabled.disabled=!!reason&&!d.enabled;this.note.textContent=reason??'Supported: opaque own object. Bump and normal can be used at the same time.';
  for(const [key,input] of this.fields)if(document.activeElement!==input)input.value=String(d[key as 'strength'|'heightScale'|'reference']);
  this.name.textContent=d.texture?.name??(d.texture?'Embedded height map':'No height map');this.preview.hidden=!d.texture;if(d.texture&&this.preview.getAttribute('src')!==d.texture.data)this.preview.src=d.texture.data;if(!d.texture)this.preview.removeAttribute('src');
 }
}
