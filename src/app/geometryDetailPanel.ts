import type {QualityProfile} from './qualityAuthority';
import {GEOMETRY_REASON_CLASS_LABEL} from '../engine/geometryEligibility';
import type {GeometryReason} from '../engine/geometryEligibility';
import {FLOAT32_FALLBACK_ACTIVE,FLOAT32_FALLBACK_CHANGED,FLOAT32_FALLBACK_HELP,FLOAT32_FALLBACK_LABEL} from '../engine/floatFallback';
import {DEFAULT_GEOMETRY_DETAIL,readGeometryDetail} from '../engine/adaptiveGeometry';
import type {GeometryDetailSettings,GeometryDiagnostics} from '../engine/adaptiveGeometry';
/** Candidate controls inside the existing Still panel. No library/profile access. */
export class GeometryDetailPanel {
  readonly root=document.createElement('fieldset');
  private value={...DEFAULT_GEOMETRY_DETAIL};
  private message=document.createElement('p');
  private enabled=document.createElement('input');
  private profile:QualityProfile='legacy';
  private unavailable?:string;
  private busyFlag=false;
  private availability=document.createElement('p');
  /** COMPAT-02 WP1: every reason Geometry Detail is unavailable, one line each. */
  private reasonList=document.createElement('ul');
  private reasons:GeometryReason[]=[];
  /** COMPAT-02 WP3: the honest Float32 alternative, shown only where Geometry Detail is unavailable. */
  private fallback=document.createElement('div');
  private fallbackButton=document.createElement('button');
  private fallbackNote=document.createElement('small');
  private fallbackActive=false;
  private mode=document.createElement('select');
  private fields=new Map<string,HTMLInputElement>();
  private blocks=new Map<string,GeometryDiagnostics>();
  constructor(parent:HTMLElement,change:(s:GeometryDetailSettings)=>void,onFallback?:()=>void){
    this.root.id='geometry-detail';this.root.innerHTML='<legend>Geometry quality</legend>';
    const toggle=document.createElement('label');this.enabled.type='checkbox';this.enabled.id='geometry-enabled';toggle.append(this.enabled,' Geometry Detail for still picture and cut-out (opt-in)');this.reasonList.className='geometry-reasons';this.reasonList.setAttribute('role','list');this.reasonList.setAttribute('aria-label','Reasons why Geometry Detail is not available');this.reasonList.style.cssText='margin:2px 0 6px;padding-left:1.1rem;font-size:12px;line-height:1.35';this.root.append(toggle,this.availability,this.reasonList);
    this.fallback.id='geometry-fallback';this.fallback.style.cssText='margin:4px 0 8px;display:flex;flex-direction:column;gap:3px';
    this.fallbackButton.type='button';this.fallbackButton.id='geometry-fallback-button';this.fallbackButton.textContent=FLOAT32_FALLBACK_LABEL;
    this.fallbackButton.title='Only changes Fine hit and Fine detail. Can be undone.';
    this.fallbackButton.addEventListener('click',()=>{if(this.fallbackButton.disabled||this.fallbackActive)return;onFallback?.();this.fallbackNote.textContent=FLOAT32_FALLBACK_CHANGED;});
    const help=document.createElement('small');help.textContent=FLOAT32_FALLBACK_HELP;help.style.cssText='opacity:.85;line-height:1.35';
    this.fallbackNote.setAttribute('role','status');this.fallbackNote.style.cssText='color:#9fd1a0';
    this.fallback.append(this.fallbackButton,help,this.fallbackNote);this.fallback.hidden=true;this.root.append(this.fallback);
    const commit=()=>{try{const next=readGeometryDetail({enabled:this.enabled.checked,detailLevel:Number(this.fields.get('detailLevel')!.value),stepMultiplier:Number(this.fields.get('stepMultiplier')!.value),budget:this.mode.value,maxSteps:Number(this.fields.get('maxSteps')!.value)});change(next);this.value=next;this.message.textContent='The change applies to the final picture/cut-out. The responsive view keeps its budget.';}catch(e){this.show(this.value);this.message.textContent='The value was rejected; the previous setting is kept. '+String(e);}};
    const number=(key:string,label:string,slider=false)=>{
      const row=document.createElement('label');row.style.display='block';row.append(label+' ');
      const input=document.createElement('input');input.type='number';input.step=key==='maxSteps'?'1':'any';input.min=key==='maxSteps'?'1':'0';input.id='geometry-'+key;input.style.width='100px';input.addEventListener('change',commit);row.append(input);this.fields.set(key,input);
      if(slider){const range=document.createElement('input');range.type='range';range.dataset.numericCompanion='external';range.min='-3';range.max=key==='detailLevel'?'4':'0';range.step='any';range.id='geometry-'+key+'-slider';range.title='Logarithmic drag surface. The number field can enter values outside the drag surface.';range.addEventListener('input',()=>{input.value=String(10**Number(range.value));});range.addEventListener('change',commit);row.append(range);}
      return row;
    };
    this.root.append(number('detailLevel','Detail Level',true),number('stepMultiplier','Step Multiplier',true));
    const budget=document.createElement('label');budget.append('Computation budget ');for(const [value,text]of [['automatic','Automatic'],['manual','Manual (Advanced)']]){const o=document.createElement('option');o.value=value!;o.textContent=text!;this.mode.append(o);}this.mode.id='geometry-budget';budget.append(this.mode);this.root.append(budget);
    const advanced=document.createElement('details');advanced.innerHTML='<summary>Advanced</summary>';advanced.append(number('maxSteps','Safety limit steps/ray'));
    const explanation=document.createElement('p');explanation.textContent='640 search queries per GPU pass. Automatic continuation up to the safety limit; manual mode ends after the chosen limit. Unfinished/invalid rays are shown purple. Hit band = pixel size / Detail Level. DS floor ≈ 1e−12 is not a certified formula error limit. Camera input is still Float32; higher wishes do not guarantee a better shape. The candidate supports the verified ABox/RandCubes chain without maps or DOF. Unresolved cut interiors are reported separately.';advanced.append(explanation);this.root.append(advanced,this.message);parent.append(this.root);
    this.enabled.addEventListener('change',()=>{this.mode.value=this.value.budget;commit();});this.mode.addEventListener('change',()=>{const n=this.fields.get('maxSteps')!;n.value=this.mode.value==='automatic'?'65536':n.value;commit();});this.show();
  }
  show(settings?:GeometryDetailSettings){this.value=settings??{...DEFAULT_GEOMETRY_DETAIL};this.enabled.checked=this.value.enabled;this.mode.value=this.value.budget;for(const key of ['detailLevel','stepMultiplier','maxSteps']as const){this.fields.get(key)!.value=String(this.value[key]);const slider=this.root.querySelector<HTMLInputElement>('#geometry-'+key+'-slider');if(slider)slider.value=String(Math.log10(this.value[key]));}this.updateAvailability();}
  nativeProfile(value:boolean){const info=this.root.querySelector<HTMLElement>('details p');if(info){info.dataset.originalText??=info.textContent??'';if(!value){info.textContent=info.dataset.originalText;return;}}if(info&&value)info.textContent='GEO8 native Common: DS camera, unchanged finite formulas, the S5 normal footprint of the original. Detail Level 8 reproduces the native hit band of GEO7; another level scales the band with 8 / the level. Step Multiplier is independent. Automatic continues 640 queries/pass up to 65,536; manual budget up to 1,048,576. A requested band lower than the local DS warning limit 1e−12 is reported; not a certified formula error limit. Purple marks an unfinished or unsupported hit/background. The viewport uses the ordinary NOEMA camera and cheaper quality.';}
  setAuthority(profile:QualityProfile,unavailable?:string,reasons:readonly GeometryReason[]=[]){this.profile=profile;this.unavailable=unavailable;this.reasons=[...reasons];this.updateAvailability();}
  /** Called whenever the scene is shown: whether the two Float32 policies are already set. */
  setFallbackActive(active:boolean){this.fallbackActive=active;if(!active)this.fallbackNote.textContent='';this.updateAvailability();}
  private renderReasons(){
    this.reasonList.replaceChildren();this.reasonList.hidden=!this.unavailable||!this.reasons.length;
    for(const r of this.reasons){const li=document.createElement('li');li.dataset.code=r.code;li.dataset.class=r.cls;li.title=GEOMETRY_REASON_CLASS_LABEL[r.cls];li.textContent=r.text;if(r.hint){const hint=document.createElement('small');hint.style.cssText='display:block;opacity:.8';hint.textContent=r.hint;li.append(hint);}this.reasonList.append(li);}
  }
  private updateAvailability(){
    const active=this.profile!=='legacy';
    this.fields.get('stepMultiplier')!.parentElement!.hidden=!active;
    this.root.querySelector('details')!.hidden=!active;
    this.enabled.disabled=this.busyFlag||(this.profile==='native'&&this.enabled.checked)||(!this.enabled.checked&&!!this.unavailable);
    this.enabled.title=this.profile==='native'?'The original profile requires Geometry Detail. Open an ordinary scene for older rendering.':this.unavailable??'Activation is an explicit choice; no older values are overwritten.';
    for(const input of this.root.querySelectorAll<HTMLInputElement>('input:not(#geometry-enabled)'))input.disabled=this.busyFlag||!active||!!this.unavailable;
    this.fields.get('maxSteps')!.readOnly=this.value.budget==='automatic';
    this.mode.disabled=this.busyFlag||!active||!!this.unavailable;
    this.mode.value=active?this.value.budget:'manual';
    this.renderReasons();
    this.fallback.hidden=!(this.unavailable&&this.profile==='legacy');
    // `display:flex` would override the hidden attribute, so the visibility is set explicitly too.
    this.fallback.style.display=this.fallback.hidden?'none':'flex';
    this.fallbackButton.disabled=this.busyFlag||this.fallbackActive;
    this.fallbackButton.textContent=this.fallbackActive?FLOAT32_FALLBACK_ACTIVE:FLOAT32_FALLBACK_LABEL;
    this.availability.textContent=(this.unavailable?(this.reasons.length?`Geometry Detail is not available for this scene (${this.reasons.length===1?'1 reason':this.reasons.length+' reasons'}):`:this.unavailable):undefined)??(!active?'Detail Level and automatic continuation apply only to opt-in. An older scene uses Step Multiplier below and manually Max steps in Advanced.':`Effective safety limit: ${this.value.maxSteps} queries/ray. ${this.value.budget==='automatic'?'Automatic continues 640/pass up to the saved ceiling.':'Manual ceiling.'} Primary normals: ${this.profile==='native'?'the S5 of the original':'DS micro-normal, hard edges'}.`);
    for(const input of this.root.querySelectorAll<HTMLInputElement>('input:not(#geometry-enabled)'))if(!input.closest('[data-legacy-geometry]')){input.dataset.authorityTitle??=input.title;input.title=!active?'Inactive in the older render profile. Turn on Geometry Detail for a supported scene.':this.unavailable??input.dataset.authorityTitle;}
    if(active&&!this.unavailable)this.fields.get('maxSteps')!.title=this.value.budget==='automatic'?'The saved safety ceiling of the automatic mode (read-only). Choose Manual to enter another ceiling.':'The highest number of direct search queries per ray.';
    // The legacy step owner is an existing control moved here, never duplicated.
    const legacy=this.root.querySelector<HTMLInputElement>('#quality-step_factor');if(legacy)legacy.disabled=this.busyFlag||active;
  }
  busy(value:boolean){this.busyFlag=value;this.updateAvailability();if(value)this.blocks.clear();}
  status(d:GeometryDiagnostics){
    this.blocks.set(JSON.stringify([d.tile,d.sampleIndex]),d);
    const totals={...d,pixels:0,hits:0,pending:0,maxDistance:0,invalid:0,stagnated:0,clipUnresolved:0,precisionLimited:0};
    for(const b of this.blocks.values())for(const key of ['pixels','hits','pending','maxDistance','invalid','stagnated','clipUnresolved','precisionLimited']as const)totals[key]+=b[key];
    this.root.dataset.geometryDiagnostics=JSON.stringify(totals);
    this.message.textContent=`Block pass ${d.passes}, total calculated: ${totals.hits}/${totals.pixels} hits, ${totals.pending} unfinished, ${totals.maxDistance} max distance, ${totals.invalid} invalid, ${totals.stagnated} stagnation, ${totals.clipUnresolved} unresolved cuts, ${totals.precisionLimited} precision-limited. Current band requested ${d.requestedMin.toExponential(2)}, effective ${d.effectiveMin.toExponential(2)}. Camera: ${d.cameraPrecision==='native-split'?'native Common with DS position/direction':'Float32 input'}.`;
  }
}
