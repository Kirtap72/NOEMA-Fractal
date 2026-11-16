import type {Scene} from '../engine/scene';
import type {ArtistPreviewBudget,ArtistPreviewControl,ArtistPreviewFrame,ArtistPreviewOverrides,ArtistPreviewPlan,PreviewSize} from '../engine/artistPreview';
import {artistPreviewPlan,previewRoi} from '../engine/artistPreview';
import {PREVIEW_LIGHT_SAMPLES} from '../engine/renderSetup';
import type {PreviewScale} from '../engine/renderSetup';
import {encodePng,openFileStream} from './output';

export interface ArtistPreviewHost {
 capture():{scene:Scene;size:PreviewSize;timestamp:number};
 render(scene:Scene,plan:ArtistPreviewPlan,control:ArtistPreviewControl,roiOnly:boolean):Promise<void>;
}
/** Modeless frozen view. Authored edits stay available; an edit marks this snapshot stale, never auto-renders. */
export class ArtistRenderPreview {
 readonly element=document.createElement('section');
 private overview=document.createElement('canvas');private detail=document.createElement('canvas');
 private status=document.createElement('p');private warning=document.createElement('p');private description=document.createElement('p');
 private overviewLabel=document.createElement('p');private detailLabel=document.createElement('p');
 private budget=document.createElement('select');private scaleSelect=document.createElement('select');private samplesSelect=document.createElement('select');
 private x=document.createElement('input');private y=document.createElement('input');
 private pauseButton:HTMLButtonElement;private abort?:AbortController;private job?:Promise<void>;private generation=0;private paused=false;
 private source?:Scene;private snapshot?:Scene;private size?:PreviewSize;private plan?:ArtistPreviewPlan;private last?:ArtistPreviewFrame;
 private stale=false;private snapshotId=0;
 constructor(root:HTMLElement,private host:ArtistPreviewHost){
  root.prepend(this.button('Advanced frozen preview…',()=>this.open()));this.element.id='artist-render-preview';this.element.hidden=true;
  this.element.style.cssText='position:fixed;right:12px;top:76px;z-index:20;width:min(820px,calc(100vw - 24px));max-height:84vh;overflow:auto;background:#16242b;color:#eee;padding:16px;box-sizing:border-box;border:1px solid #879ca5;box-shadow:0 8px 35px #0009';
  const title=document.createElement('h2');title.textContent='Fast preview · frozen final render';title.style.margin='0';
  this.budget.setAttribute('aria-label','Budget of the preview');for(const [value,label]of [['quick','Quick'],['balanced','Balanced'],['detailed','Detailed']])this.budget.add(new Option(label,value));this.budget.value='balanced';
  this.scaleSelect.setAttribute('aria-label','Scale of the preview');for(const [value,label]of [['auto','Scale: by budget'],['0.5','50 % linear scale (25 % px)'],['0.75','75 % linear scale (56.25 % px)'],['1','100 % linear scale']])this.scaleSelect.add(new Option(label,value));this.scaleSelect.value='auto';
  this.samplesSelect.setAttribute('aria-label','Light samples of the preview');this.samplesSelect.add(new Option('Light samples: by budget','auto'));for(const s of PREVIEW_LIGHT_SAMPLES)this.samplesSelect.add(new Option(s===1?'1 sample (fast/noisy)':`${s} samples`,String(s)));this.samplesSelect.value='auto';
  this.pauseButton=this.button('Pause',()=>{this.paused=!this.paused;this.pauseButton.textContent=this.paused?'Continue':'Pause';if(this.paused)this.status.textContent='Pause after the current sample. The latest finished picture is kept.';});
  const actions=document.createElement('div');actions.append(this.budget,this.scaleSelect,this.samplesSelect,this.button('Update Preview',()=>this.request()),this.pauseButton,this.button('Cancel preview',()=>this.stop()),this.button('Close preview',()=>{this.stop();this.element.hidden=true;}));
  this.warning.style.cssText='color:#ffcf8a;font-weight:bold';this.warning.setAttribute('role','status');this.status.setAttribute('role','status');this.status.className='artist-preview-status';
  this.overview.style.cssText='display:block;max-width:100%;height:auto;cursor:crosshair';this.overview.hidden=true;
  this.detail.style.cssText='display:block;max-width:none;image-rendering:auto';this.detail.hidden=true;
  const roi=document.createElement('div');for(const [label,input]of [['ROI x',this.x],['ROI y',this.y]] as const){input.type='number';input.min='0';input.step='1';input.value='0';input.style.width='90px';input.setAttribute('aria-label',label);const l=document.createElement('label');l.textContent=label+' ';l.append(input);roi.append(l);}roi.append(this.button('Render 100 % cut-out',()=>this.request(true)));
  this.overview.onpointerup=e=>{if(!this.size)return;const r=this.overview.getBoundingClientRect();this.x.value=String(Math.floor((e.clientX-r.left)/r.width*this.size.width));this.y.value=String(Math.floor((e.clientY-r.top)/r.height*this.size.height));void this.request(true);};
  const hint=document.createElement('p');hint.textContent='Click in the whole picture to move the native cut-out. The whole picture is fitted to the panel; the cut-out shows 1 picture pixel per CSS pixel. All lights, shadows, AO, maps and glass transport follow the final render. Early samples are noisy/undersampled. No automatic update when editing.';
  this.element.append(title,actions,this.warning,this.description,this.status,this.overviewLabel,this.overview,roi,this.detailLabel,this.detail,this.button('Save the shown preview as PNG…',()=>this.save()),hint);document.body.append(this.element);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!this.element.hidden){this.stop();this.element.hidden=true;}});
 }
 private button(label:string,action:()=>void|Promise<void>){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.margin='4px';b.onclick=()=>{void Promise.resolve().then(action).catch(e=>this.status.textContent=String(e));};return b;}
 open(){this.element.hidden=false;void this.request();}
 stop(){this.generation++;this.abort?.abort();this.paused=false;this.pauseButton.textContent='Pause';this.status.textContent='Cancelled. GPU/compile work already submitted may need to finish before navigation is drawn again.';}
 observe(scene:Scene){if(this.source&&scene!==this.source&&!this.stale){this.stale=true;this.element.dataset.stale='true';this.warning.textContent='STALE PICTURE · scene/camera/time have changed. Update Preview is required for a new frozen picture.';this.abort?.abort();}}
 private async request(roiOnly=false){
  if(roiOnly&&!this.snapshot)return;const generation=++this.generation;this.abort?.abort();await this.job?.catch(()=>{});if(generation!==this.generation)return;
  this.paused=false;this.pauseButton.textContent='Pause';
  if(!roiOnly){const captured=this.host.capture();this.source=captured.scene;this.snapshot=structuredClone(captured.scene);this.size={...captured.size};this.snapshotId++;this.stale=false;this.element.dataset.stale='false';this.warning.textContent=this.overview.hidden?'':'The previous picture is shown until the new frozen picture is finished.';this.detail.hidden=true;this.description.textContent=`Frozen t=${captured.timestamp.toFixed(3)} s · final picture ${this.size.width}×${this.size.height}. Preview changes no saved settings.`;this.x.value=String(Math.floor(this.size.width/2));this.y.value=String(Math.floor(this.size.height/2));}
  const scene=this.snapshot!,size=this.size!,budget=this.budget.value as ArtistPreviewBudget;
  const overrides:ArtistPreviewOverrides={...(this.scaleSelect.value!=='auto'?{scale:Number(this.scaleSelect.value) as PreviewScale}:{}),...(this.samplesSelect.value!=='auto'?{samples:Number(this.samplesSelect.value)}:{})};
  this.plan=artistPreviewPlan(scene,size,budget,previewRoi(size,Number(this.x.value),Number(this.y.value),budget==='quick'?128:192),Object.keys(overrides).length?overrides:undefined);
  const plan=this.plan,abort=new AbortController();this.abort=abort;this.element.dataset.state='preparing';this.status.textContent='Preparing frozen scene, resources and final render pipeline…';
  const control:ArtistPreviewControl={signal:abort.signal,prepared:(phase,milliseconds)=>{this.element.dispatchEvent(new CustomEvent('artist-preview-prepared',{detail:{phase,milliseconds,snapshot:this.snapshotId}}));},wait:async()=>{while(this.paused){abort.signal.throwIfAborted();await new Promise(r=>setTimeout(r,30));}},progress:(kind,sample,target,fraction)=>{if(abort.signal.aborted||this.paused)return;this.status.textContent=`${kind==='roi'?'Native detail':kind==='initial'?'First whole picture':'Sample refinement'} · ${sample+1}/${target} samples · ${Math.round(fraction*100)} % of the current sample`;},present:frame=>{if(abort.signal.aborted)return;this.present(frame);}};
  this.job=(async()=>{try{await this.host.render(scene,plan,control,roiOnly);if(!abort.signal.aborted){this.element.dataset.state='complete';this.status.textContent='Done within the chosen preview budget. The final export keeps the full saved resolution/sample count of the scene.';}}catch(e){if(!abort.signal.aborted){this.element.dataset.state='error';this.status.textContent='The preview could not be rendered: '+String(e);}else this.element.dataset.state=this.stale?'stale':'cancelled';}})();
  await this.job;
 }
 private present(frame:ArtistPreviewFrame){
  const canvas=frame.kind==='roi'?this.detail:this.overview;canvas.width=frame.image.width;canvas.height=frame.image.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.image.data),canvas.width,canvas.height),0,0);canvas.hidden=false;
  const text=`${frame.image.width}×${frame.image.height} native · ${frame.samples}/${frame.targetSamples} lens/AA samples · ${(frame.elapsedMs/1000).toFixed(2)} s · full saved shading, ${frame.kind==='initial'?'first noisy sample, not a refined final picture':frame.complete?'chosen sample target':'undersampled'}`;
  if(frame.kind==='roi')this.detailLabel.textContent=`100 %-ROI (${frame.region!.x},${frame.region!.y}) · ${text}`;else{this.overviewLabel.textContent=`Whole picture, fitted to the panel · ${text}`;this.warning.textContent=this.stale?'STALE PICTURE · Update Preview is required.':'';}
  canvas.dataset.kind=frame.kind;canvas.dataset.samples=String(frame.samples);canvas.dataset.snapshot=String(this.snapshotId);this.last=frame;
  this.element.dataset.state=frame.kind;this.element.dataset.presented=String(Number(this.element.dataset.presented??0)+1);
  this.element.dispatchEvent(new CustomEvent('artist-preview-presented',{detail:{kind:frame.kind,samples:frame.samples,targetSamples:frame.targetSamples,width:canvas.width,height:canvas.height,region:frame.region,frameSize:frame.frameSize,elapsedMs:frame.elapsedMs,timings:frame.timings,snapshot:this.snapshotId}}));
 }
 private async save(){
  if(!this.last)throw Error('No finished preview exists.');const frame=this.last;
  const stream=await openFileStream('render-preview.png','image/png','.png');if(!stream)return;
  try{const png=await encodePng(frame.image);await stream.write(new Uint8Array(await png.arrayBuffer()));await stream.close();this.status.textContent='Visad '+(frame.kind==='roi'?'ROI':'helbild')+' saved as a preview PNG. This is not a Final Still export.';}catch(e){await stream.abort();throw e;}
 }
}
