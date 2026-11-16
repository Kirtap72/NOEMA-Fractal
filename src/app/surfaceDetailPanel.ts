import {defaultProceduralDetail,PROCEDURAL_PATTERNS,PROCEDURAL_LIMITS} from '../engine/proceduralDetail';
import type {ProceduralPattern,ProceduralDetailSettings} from '../engine/proceduralDetail';
import {defaultSurfaceDetail} from '../engine/surfaceDetail';
import type {SurfaceDetailSettings,SurfaceImage} from '../engine/surfaceDetail';
import {MAX_TEXTURE_DATA_LENGTH} from '../engine/gradient';
import {bytesToBase64} from '../engine/radiance';
import {readNumber,setInputValue,isNumericEditing} from './numericRange';

export class SurfaceDetailPanel {
  private last=defaultSurfaceDetail();
  private ranges=new Map<string,HTMLInputElement>();
  private maps=new Map<'bump'|'normal',{enabled:HTMLInputElement;name:HTMLElement;file:HTMLInputElement}>();
  private mapping=document.createElement('select');
  private status=document.createElement('div');
  private proceduralEnabled=document.createElement('input');
  private pattern=document.createElement('select');
  private proceduralControls=document.createElement('details');
  constructor(root:HTMLElement,private change:(detail:SurfaceDetailSettings)=>void){
    const section=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Surface Detail';section.append(summary);root.append(section);
    const row=(label:string,input:HTMLElement)=>{const r=document.createElement('label');r.className='arow';const text=document.createElement('span');text.textContent=label;r.append(text,input);return r;};
    const range=(key:string,label:string,min:number,max:number,step:number,parent=section)=>{
      const input=document.createElement('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.setAttribute('aria-label',label);input.dataset.numericMin=String(min);input.dataset.numericMax=String(max);this.ranges.set(key,input);parent.append(row(label,input));
      input.addEventListener('input',()=>{const d=structuredClone(this.last);const v=readNumber(input);if(key==='bump'||key==='normal')d[key].strength=v;else if(key==='offsetU'||key==='offsetV')d.offset[key==='offsetU'?0:1]=v;else if(key.startsWith('proc.')){d.procedural??=defaultProceduralDetail();Object.assign(d.procedural,{[key.slice(5)]:v});}else d[key as 'scale'|'rotation']=v;this.emit(d);});
    };
    for(const key of ['bump','normal'] as const){
      const label=key==='bump'?'Bump':'Normal';const enabled=document.createElement('input');enabled.type='checkbox';enabled.setAttribute('aria-label',label+' enabled');section.append(row(label,enabled));
      enabled.addEventListener('change',()=>{const d=structuredClone(this.last);d[key].enabled=enabled.checked;this.emit(d);});
      const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg';file.hidden=true;file.setAttribute('aria-label',label+' map file');
      const button=document.createElement('button');button.type='button';button.textContent=label+' picture…';button.setAttribute('aria-label',label+' map selector');button.addEventListener('click',()=>file.click());
      const name=document.createElement('span');name.className='ainfo';const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label',label+' map remove');remove.addEventListener('click',()=>{const d=structuredClone(this.last);delete d[key].texture;d[key].enabled=false;this.emit(d);});
      const files=document.createElement('div');files.append(button,name,remove,file);section.append(files);this.maps.set(key,{enabled,name,file});
      file.addEventListener('change',()=>{const f=file.files?.[0];file.value='';if(f)void this.load(key,f);});range(key,label+' strength',0,4,.01);
    }
    this.mapping.setAttribute('aria-label','Surface mapping');this.mapping.add(new Option('Triplanar','triplanar'));this.mapping.add(new Option('Analytic (primitives)','analytic'));this.mapping.addEventListener('change',()=>this.emit({...this.last,mapping:this.mapping.value as SurfaceDetailSettings['mapping']}));section.append(row('Mapping',this.mapping));
    range('scale','Detail scale',.000001,16777216,.01);const scale=this.ranges.get('scale')!;scale.min='.05';scale.max='128';
    const advanced=document.createElement('details');const title=document.createElement('summary');title.textContent='Rotation / offset';advanced.append(title);section.append(advanced);
    range('rotation','Detail rotation',-36000,36000,1,advanced);range('offsetU','Detail offset U',-1e6,1e6,.01,advanced);range('offsetV','Detail offset V',-1e6,1e6,.01,advanced);
    this.proceduralEnabled.type='checkbox';this.proceduralEnabled.setAttribute('aria-label','Procedural enabled');this.proceduralEnabled.addEventListener('change',()=>{const d=structuredClone(this.last);d.procedural={...(d.procedural??defaultProceduralDetail()),enabled:this.proceduralEnabled.checked};this.proceduralControls.open=this.proceduralEnabled.checked;this.emit(d);});section.append(row('Procedure',this.proceduralEnabled));
    this.proceduralControls.append(Object.assign(document.createElement('summary'),{textContent:'Procedure settings'}));section.append(this.proceduralControls);this.pattern.setAttribute('aria-label','Procedural pattern');
    for(const [i,name] of ['Fine Noise','Fractal Noise / FBM','Brushed / Directional','Hammered','Stone / Granular','Ridged'].entries())this.pattern.add(new Option(name,PROCEDURAL_PATTERNS[i]));
    this.pattern.addEventListener('change',()=>{const d=structuredClone(this.last);d.procedural={...(d.procedural??defaultProceduralDetail()),pattern:this.pattern.value as ProceduralPattern};this.emit(d);});this.proceduralControls.append(row('Pattern',this.pattern));
    for(const [key,label,step] of [['strength','Procedural strength',.01],['scale','Procedural scale',.01],['octaves','Detail octaves',1],['lacunarity','Noise frequency multiplier',.05],['persistence','Noise persistence',.01],['seed','Detail seed',1],['rotation','Grain rotation',1],['anisotropy','Pattern anisotropy',1],['roughnessModulation','Roughness modulation',.01]] as const){
      const limits=PROCEDURAL_LIMITS[key];range('proc.'+key,label,limits[0],limits[1],step,this.proceduralControls);const control=this.ranges.get('proc.'+key)!;if(key==='octaves'||key==='seed')control.dataset.integer='true';if(key==='scale'){control.min='.05';control.max='256';}if(key==='rotation'){control.min='-180';control.max='180';}if(key==='seed')control.max='1000';
    }
    const procNote=document.createElement('div');procNote.className='ainfo';procNote.textContent='Object coordinates, stable seed. Roughness is added to the base material. Anisotropy stretches the brushed pattern; GGX remains isotropic. Explore also pauses procedures.';this.proceduralControls.append(procNote);
    this.status.className='ainfo';this.status.setAttribute('role','status');section.append(this.status);const note=document.createElement('div');note.className='ainfo';note.textContent='PNG/JPEG as linear data. Normal: tangent space, OpenGL +Y (green up). Height: red channel. Fractals use triplanar; Explore pauses details.';section.append(note);
  }
  private emit(detail:SurfaceDetailSettings){this.last=detail;this.change(detail);}
  private async load(key:'bump'|'normal',file:File){
    const previous=this.last;this.status.textContent='Reading picture…';
    try {
      if(!['image/png','image/jpeg'].includes(file.type))throw Error('Choose PNG or JPEG.');
      if(file.size>5_999_950)throw Error('The data picture may be at most about 6 MB. Reduce the picture and try again.');
      const bytes=new Uint8Array(await file.arrayBuffer());const data=`data:${file.type};base64,`+bytesToBase64(bytes);if(data.length>MAX_TEXTURE_DATA_LENGTH)throw Error('The picture is too large.');
      const bitmap=await createImageBitmap(file,{colorSpaceConversion:'none',premultiplyAlpha:'none'});bitmap.close();
      if(this.last!==previous){this.status.textContent='The material changed during the picture loading. Choose the picture again.';return;}
      const texture:SurfaceImage={data,name:file.name.slice(0,100)};const d=structuredClone(this.last);d[key]={...d[key],enabled:true,texture};this.emit(d);this.status.textContent='';
    }catch(error){this.status.textContent=error instanceof Error?error.message:String(error);}
  }
  update(detail?:SurfaceDetailSettings){
    this.last=detail??defaultSurfaceDetail();this.mapping.value=this.last.mapping;const proc=this.last.procedural??defaultProceduralDetail();const wasEnabled=this.proceduralEnabled.checked;this.proceduralEnabled.checked=proc.enabled;if(proc.enabled&&!wasEnabled)this.proceduralControls.open=true;this.pattern.value=proc.pattern;
    for(const [key,controls] of this.maps){controls.enabled.checked=this.last[key].enabled;controls.name.textContent=this.last[key].texture?.name??(this.last[key].texture?'Embedded picture':'No picture');}
    for(const [key,input] of this.ranges){if(isNumericEditing(input))continue;const v=key.startsWith('proc.')?proc[key.slice(5) as Exclude<keyof ProceduralDetailSettings,'pattern'|'enabled'>]:key==='bump'||key==='normal'?this.last[key].strength:key==='offsetU'?this.last.offset[0]:key==='offsetV'?this.last.offset[1]:this.last[key as 'scale'|'rotation'];setInputValue(input,v);}
  }
}
