import {defaultSurfaceDetail} from '../engine/surfaceDetail';
import type {SurfaceImage} from '../engine/surfaceDetail';
import {PBR_CHANNELS,TEXTURE_CHANNELS,defaultPbrMap,proposeTextureAssignments} from '../engine/materialTextures';
import type {TextureChannel,PbrChannel} from '../engine/materialTextures';
import type {MaterialSettings} from '../engine/material';
import {readMaterialMap} from './materialMapLoader';
import {SIZE_SLIDER_MAX,SIZE_SLIDER_MIN,SIZE_MAX,SIZE_MIN,describeTextureSize,formatSize,scaleFromSize,sizeFromScale,sizeToSlider,sliderToSize} from '../engine/textureSize';
export const MAP_LABELS:Record<TextureChannel,string>={baseColor:'Base colour',roughness:'Roughness',metallic:'Metal',normal:'Normal',height:'Height / bump',ao:'AO',emission:'Emission'};
interface Controls{enabled:HTMLInputElement;strength:HTMLInputElement;mode?:HTMLSelectElement;name:HTMLElement;preview:HTMLImageElement;remove:HTMLButtonElement}
/** One compact disclosure, with an explicit review step for importing a set. */
export class MaterialTexturesPanel{
 private last:MaterialSettings={metallic:0,roughness:1,reflectivity:0};private controls=new Map<TextureChannel,Controls>();private status=document.createElement('output');private loader?:AbortController;private edited=0;
 private normalFlip=document.createElement('input');private transform=new Map<string,HTMLInputElement>();private mapping=document.createElement('select');private review=document.createElement('dialog');private reviewFiles:File[]=[];
 constructor(root:HTMLElement,private change:(material:MaterialSettings)=>void){
  const section=document.createElement('details');section.className='pbr-textures';section.append(Object.assign(document.createElement('summary'),{textContent:'Texture set · PBR'}));root.append(section);section.append(this.buildSizeControl());
  const actions=document.createElement('div'),files=this.input('file','PBR texture files');files.multiple=true;files.accept='image/png,image/jpeg';files.hidden=true;const folder=this.input('file','PBR texture folder');folder.multiple=true;folder.setAttribute('webkitdirectory','');folder.hidden=true;
  actions.append(this.button('Choose maps…',()=>files.click()),this.button('Choose folder…',()=>folder.click()),this.button('Cancel picture loading',()=>{this.loader?.abort();this.status.textContent='The picture loading was cancelled; the material is unchanged.'}),files,folder);section.append(actions);
  for(const input of [files,folder])input.onchange=()=>{const selected=Array.from(input.files??[]);input.value='';this.showAssignments(selected)};
  for(const channel of TEXTURE_CHANNELS){
   const box=document.createElement('fieldset');box.className='pbr-map';box.append(Object.assign(document.createElement('legend'),{textContent:MAP_LABELS[channel]}));const enabled=this.input('checkbox',`PBR ${channel} enabled`),strength=this.input('number',`PBR ${channel} strength`);strength.min='0';strength.max=channel==='normal'||channel==='height'?'4':'1';strength.step='.01';
   const name=document.createElement('span'),preview=new Image();preview.width=48;preview.height=36;preview.alt=MAP_LABELS[channel]+' map';preview.hidden=true;preview.onerror=()=>{preview.hidden=true;this.status.textContent='The preview of the map could not be read. Replace or remove the map.'};
   const file=this.input('file',`PBR ${channel} file`);file.type='file';file.accept='image/png,image/jpeg';file.hidden=true;const remove=this.button('Remove',()=>this.editMap(channel,m=>{delete m.texture;m.enabled=false}));remove.setAttribute('aria-label',`PBR ${channel} remove`);
   box.append(this.row('On',enabled),preview,name,this.button('Choose / replace…',()=>file.click()),remove,file,this.row('Strength',strength));const controls:Controls={enabled,strength,name,preview,remove};
   if((PBR_CHANNELS as readonly string[]).includes(channel)){const mode=document.createElement('select');mode.setAttribute('aria-label',`PBR ${channel} combination`);mode.add(new Option('Multiply the existing value','multiply'));mode.add(new Option('Blend / replace the existing value','replace'));mode.disabled=channel==='ao';mode.onchange=()=>this.editMap(channel,m=>Object.assign(m,{mode:mode.value}));box.append(this.row('Combine',mode));controls.mode=mode;}
   enabled.onchange=()=>this.editMap(channel,m=>m.enabled=enabled.checked);strength.onchange=()=>{if(strength.checkValidity()&&Number.isFinite(Number(strength.value)))this.editMap(channel,m=>m.strength=Number(strength.value))};file.onchange=()=>{const f=file.files?.[0];file.value='';if(f)void this.load([{channel,file:f}])};section.append(box);this.controls.set(channel,controls);
  }
  this.normalFlip.type='checkbox';this.normalFlip.setAttribute('aria-label','PBR normal DirectX flip Y');this.normalFlip.onchange=()=>{const material={...this.last,surfaceDetail:{...(this.last.surfaceDetail??defaultSurfaceDetail()),normalFlipY:this.normalFlip.checked}};this.emit(material)};section.append(this.row('DirectX normal (flip green/Y)',this.normalFlip));
  const transform=document.createElement('details');transform.append(Object.assign(document.createElement('summary'),{textContent:'Shared mapping / transform'}));section.append(transform);this.mapping.setAttribute('aria-label','PBR mapping');this.mapping.add(new Option('Triplanar','triplanar'));this.mapping.add(new Option('Analytic on primitives','analytic'));this.mapping.onchange=()=>this.emit({...this.last,surfaceDetail:{...(this.last.surfaceDetail??defaultSurfaceDetail()),mapping:this.mapping.value as 'triplanar'|'analytic'}});transform.append(this.row('Mapping',this.mapping));
  for(const [key,label,min,max] of [['rotation','Rotation',-36000,36000],['offsetU','Offset U',-1e6,1e6],['offsetV','Offset V',-1e6,1e6]] as const){const input=this.input('number','PBR '+key);input.min=String(min);input.max=String(max);input.step=key==='rotation'?'1':'.01';input.onchange=()=>{if(!input.checkValidity()||!Number.isFinite(Number(input.value)))return;const d=structuredClone(this.last.surfaceDetail??defaultSurfaceDetail());if(key==='offsetU'||key==='offsetV')d.offset[key==='offsetU'?0:1]=Number(input.value);else d[key]=Number(input.value);this.emit({...this.last,surfaceDetail:d})};this.transform.set(key,input);transform.append(this.row(label,input));}
  section.append(this.status,Object.assign(document.createElement('p'),{className:'ainfo',textContent:'Base colour is blended with or multiplies your existing gradient/colour. Metal/roughness use the red channel and the combination above with the sliders. AO only affects ambient/environment diffuse. Colour/emission: sRGB. Other maps: linear data. Normal: OpenGL +Y, optional DirectX flip. Height changes the light normal, not geometry, depth or shadow silhouette. All PBR maps share the Surface Details transform; the picture texture of the older gradient still has its own mapping.'}));
  this.review.className='pbr-import-dialog';this.review.setAttribute('aria-label','Review texture set');document.body.append(this.review);this.review.addEventListener('cancel',()=>{this.reviewFiles=[]});
 }

 private sizeSlider=document.createElement('input');private sizeNumber=document.createElement('input');private sizeNote=document.createElement('small');
 /** "Texturstorlek": one shared size for every map of the set. The stored field is surfaceDetail.scale = repeats per world unit. */
 private buildSizeControl(){
  const box=document.createElement('div');box.className='pbr-size';box.setAttribute('role','group');box.setAttribute('aria-label','Texture size');
  const title=Object.assign(document.createElement('strong'),{textContent:'Texture size'});
  this.sizeSlider.type='range';this.sizeSlider.min=String(SIZE_SLIDER_MIN);this.sizeSlider.max=String(SIZE_SLIDER_MAX);this.sizeSlider.step='0.01';this.sizeSlider.value='0';
  this.sizeSlider.setAttribute('aria-label','Texture size (logarithmic slider)');this.sizeSlider.dataset.numericCompanion='external';
  this.sizeSlider.title='Drag to change how large one repeat of the texture is. To the right = larger texture = fewer repeats. The value is applied when you release the slider.';
  this.sizeNumber.type='number';this.sizeNumber.min=String(SIZE_MIN);this.sizeNumber.max=String(SIZE_MAX);this.sizeNumber.step='any';this.sizeNumber.className='pbr-size-number';
  this.sizeNumber.setAttribute('aria-label','Texture size, exact value (world units per repeat)');this.sizeNumber.title='The size of one repeat in world units. 1 = as in earlier scenes.';
  const reset=this.button('1',()=>this.applySize(1));reset.title='Default (1), as in older scenes';reset.setAttribute('aria-label','Texture size: reset to 1');
  const row=document.createElement('div');row.className='pbr-size-row';row.append(this.sizeSlider,this.sizeNumber,reset);
  this.sizeNote.className='ainfo';this.sizeNote.setAttribute('aria-live','polite');
  this.sizeSlider.oninput=()=>{const size=sliderToSize(Number(this.sizeSlider.value));this.sizeNumber.value=formatSize(size);this.sizeNumber.setCustomValidity('');const scale=scaleFromSize(size);if(scale!==undefined)this.sizeNote.textContent=describeTextureSize(scale);};
  this.sizeSlider.onchange=()=>this.applySize(sliderToSize(Number(this.sizeSlider.value)));
  this.sizeNumber.onchange=()=>this.applySize(this.sizeNumber.value.trim()===''?NaN:Number(this.sizeNumber.value));
  box.append(title,row,this.sizeNote);return box;
 }
 /** The only writer of the shared scale from this control. An invalid size changes nothing. */
 private applySize(size:number){
  const scale=scaleFromSize(size);
  if(scale===undefined){this.sizeNumber.setCustomValidity('Enter a size between '+formatSize(SIZE_MIN)+' and '+formatSize(SIZE_MAX)+' world units.');this.sizeNumber.reportValidity();this.showSize(this.last.surfaceDetail?.scale??1);return;}
  this.sizeNumber.setCustomValidity('');
  const d=structuredClone(this.last.surfaceDetail??defaultSurfaceDetail());
  if(d.scale===scale){this.showSize(scale);return;}
  d.scale=scale;this.emit({...this.last,surfaceDetail:d});
 }
 private showSize(scale:number){
  const size=sizeFromScale(scale);
  if(document.activeElement!==this.sizeSlider)this.sizeSlider.value=String(sizeToSlider(size));
  if(document.activeElement!==this.sizeNumber)this.sizeNumber.value=formatSize(size);
  this.sizeNote.textContent=describeTextureSize(scale);
 }
 private input(type:string,label:string){const e=document.createElement('input');e.type=type;e.setAttribute('aria-label',label);return e}
 private row(label:string,input:HTMLElement){const row=document.createElement('label');row.className='arow';row.append(Object.assign(document.createElement('span'),{textContent:label}),input);return row}
 private button(label:string,click:()=>void){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=click;return b}
 private emit(material:MaterialSettings){this.last=material;this.edited++;this.change(material)}
 private editMap(channel:TextureChannel,edit:(map:{enabled:boolean;strength:number;texture?:SurfaceImage})=>void){
  const material={...this.last};if(channel==='normal'||channel==='height'){const d={...(material.surfaceDetail??defaultSurfaceDetail())},key=channel==='height'?'bump':'normal';d[key]={...d[key]};edit(d[key]);material.surfaceDetail=d;}
  else{const maps={...material.textures?.maps};maps[channel]={...(maps[channel]??defaultPbrMap(channel))};edit(maps[channel]!);material.textures={maps};}this.emit(material);
 }
 private showAssignments(files:File[]){
  this.loader?.abort();this.reviewFiles=files.filter(f=>/\.(png|jpe?g)$/i.test(f.name));if(this.reviewFiles.length>64||!this.reviewFiles.length){this.status.textContent='Choose 1–64 PNG/JPEG files. No map was changed.';return}
  this.review.replaceChildren(Object.assign(document.createElement('h2'),{textContent:'Review texture set'}),Object.assign(document.createElement('p'),{textContent:'Confirm the maps. Several matches require an explicit choice; other material channels are preserved.'}));const selects=new Map<TextureChannel,HTMLSelectElement>();
  for(const proposal of proposeTextureAssignments(this.reviewFiles.map(f=>f.name))){const select=document.createElement('select');select.setAttribute('aria-label','Assignment '+proposal.channel);if(proposal.ambiguous)select.add(new Option('Choose – several possible maps','choose'));select.add(new Option('No new map','none'));for(const [i,f]of this.reviewFiles.entries())select.add(new Option(f.webkitRelativePath||f.name,String(i)));select.value=proposal.proposed===undefined?(proposal.ambiguous?'choose':'none'):String(proposal.proposed);selects.set(proposal.channel,select);this.review.append(this.row(MAP_LABELS[proposal.channel]+(proposal.ambiguous?' · ambiguous':''),select));}
  const note=document.createElement('output');this.review.append(note,this.button('Import chosen maps',()=>{if([...selects.values()].some(s=>s.value==='choose')){note.textContent='Choose a file or No new map for each ambiguous channel.';return}const picks=[...selects].filter(([,s])=>s.value!=='none').map(([channel,s])=>({channel,file:this.reviewFiles[Number(s.value)]!}));this.review.close();this.reviewFiles=[];void this.load(picks)}),this.button('Cancel',()=>{this.reviewFiles=[];this.review.close()}));this.review.showModal();
 }
 private async load(picks:{channel:TextureChannel;file:File}[]){
  this.loader?.abort();const controller=this.loader=new AbortController(),original=this.last,edited=this.edited;this.status.textContent='Reading and checking maps…';
  try{const loaded:{channel:TextureChannel;image:SurfaceImage}[]=[];let total=0;for(const pick of picks){const image=await readMaterialMap(pick.file,controller.signal);total+=image.data.length;if(total>48*1024*1024)throw Error('The texture set exceeds 48 MiB.');loaded.push({channel:pick.channel,image})}controller.signal.throwIfAborted();if(this.last!==original||this.edited!==edited)throw Error('The material changed during the reading. The import was cancelled without changes.');
   let material={...original,textures:{maps:{...original.textures?.maps}},surfaceDetail:{...(original.surfaceDetail??defaultSurfaceDetail())}};
   for(const {channel,image}of loaded){if(channel==='normal'||channel==='height'){const key=channel==='height'?'bump':'normal';material.surfaceDetail[key]={...material.surfaceDetail[key],enabled:true,texture:image};if(channel==='normal'&&/(normaldx|nor_dx|normal_dx)/i.test(image.name??''))material.surfaceDetail.normalFlipY=true;else if(channel==='normal'&&/(normalgl|nor_gl|normal_gl)/i.test(image.name??''))material.surfaceDetail.normalFlipY=false;}else material.textures.maps[channel]={...(material.textures.maps[channel]??defaultPbrMap(channel)),enabled:true,texture:image};}
   if(!loaded.length){this.status.textContent='No new maps were chosen; the material is unchanged.';return;}this.emit(material);this.status.textContent=`${loaded.length} maps imported. Original pixels are embedded; the GPU preview filters to at most 1024 px within a limited atlas budget.`;
  }catch(error){if(this.loader===controller)this.status.textContent=controller.signal.aborted?'The import was cancelled; the material is unchanged.':String(error instanceof Error?error.message:error)}finally{if(this.loader===controller)this.loader=undefined}
 }
 update(material:MaterialSettings){this.last=material;for(const [channel,c]of this.controls){const d=material.surfaceDetail??defaultSurfaceDetail(),map=channel==='normal'?d.normal:channel==='height'?d.bump:material.textures?.maps[channel]??defaultPbrMap(channel as PbrChannel);c.enabled.checked=map.enabled;if(document.activeElement!==c.strength)c.strength.value=String(map.strength);c.name.textContent=map.texture?.name??(map.texture?'Embedded map':'No map');c.remove.disabled=!map.texture;c.preview.hidden=!map.texture;if(map.texture&&c.preview.getAttribute('src')!==map.texture.data)c.preview.src=map.texture.data;else if(!map.texture)c.preview.removeAttribute('src');if(c.mode)c.mode.value='mode'in map?String(map.mode):'multiply';}
  const d=material.surfaceDetail??defaultSurfaceDetail();this.showSize(d.scale);this.mapping.value=d.mapping;this.normalFlip.checked=!!d.normalFlipY;for(const [key,input]of this.transform)if(document.activeElement!==input)input.value=String(key==='offsetU'?d.offset[0]:key==='offsetV'?d.offset[1]:d[key as 'scale'|'rotation']);
 }
}
