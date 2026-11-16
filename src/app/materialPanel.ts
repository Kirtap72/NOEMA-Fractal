import {SurfaceDetailPanel} from './surfaceDetailPanel';
import {DisplacementPanel} from './displacementPanel';
import {MaterialTexturesPanel} from './materialTexturesPanel';
import {MaterialBrowser} from './materialBrowser';
import type {AuditionHost} from './materialAudition';
import type {ColorSettings} from '../engine/gradient';
import './materialTextures.css';
import { readNumber, setInputValue, isNumericEditing } from './numericRange';
import { MATERIAL_PROPERTIES, MATERIAL_SOURCES } from "../engine";
import {resolveMaterial,MATERIAL_PRESETS} from '../engine/material';
import {srgbChannelToLinear} from '../engine/materialTextures';
import type { DrivenProperty, MaterialPropertyName, MaterialSettings, MaterialSource } from "../engine";

export interface MaterialPanelHandlers {
  /** The user changed one property (already checked). */
  onChange(name: keyof MaterialSettings, value: MaterialSettings[keyof MaterialSettings]): void;
  onPreset?(material:MaterialSettings):void;
  color?():ColorSettings;
  onMaterialPreset?(material:MaterialSettings,color?:ColorSettings):void;
  /** Gives the library a non-destructive "Try" for the scene's own material. Left out: apply only, as before. */
  audition?:AuditionHost;
}

const LABELS: Record<MaterialPropertyName, string> = { metallic: "Metal", roughness: "Roughness", reflectivity: "Reflection" };
const TITLES: Record<MaterialPropertyName, string> = {
  metallic: "0 = like plastic or stone, 1 = metal (the colour of the surface becomes the mirror colour and the ordinary lighting disappears)",
  roughness: "0 = shiny mirror, 1 = duller and blurrier reflection. Only visible when metal or reflection is above 0.",
  reflectivity: "How much of the surroundings and the light sources is reflected, even without metal. 0 = no reflection.",
};
const SOURCE_LABELS: Record<MaterialSource, string> = {
  color: "Same as the colour",
  iterations: "Repeats",
  orbit_trap: "Orbit trap (nearest to the centre)",
  slope: "Slope",
  cavity: "Cavities",
  radius: "Distance from the centre",
};

interface Row {
  value: HTMLInputElement;
  valueText: HTMLSpanElement;
  source: HTMLSelectElement;
  driven: HTMLDivElement;
  low: HTMLInputElement;
  high: HTMLInputElement;
  cycles: HTMLInputElement;
  offset: HTMLInputElement;
  note: HTMLDivElement;
}

/**
 * Material: metal, roughness and reflectivity (ARCHITECTURE.md 8.22). Each is a number, or follows a measure of the
 * surface (like the colour does) through a curve. The panel edits curves of two points (a low and a high value); a
 * scene file can hold curves of up to 16 points, which the panel then leaves alone. Plain DOM; text only.
 */
export class MaterialPanel {
  private rows = new Map<MaterialPropertyName, Row>();
  private last: MaterialSettings | null = null;
  private extras=new Map<keyof MaterialSettings,HTMLInputElement>();
  private volume!:HTMLDetailsElement;
  private detail!:SurfaceDetailPanel;
  private textures!:MaterialTexturesPanel;
  private displacement!:DisplacementPanel;
  private orbit!:HTMLInputElement;
  private orbitNumber!:HTMLInputElement;
  private diffuse!:HTMLInputElement;
  private orbitNote!:HTMLDivElement;

  constructor(
    private root: HTMLElement,
    private handlers: MaterialPanelHandlers,
  ) {
    this.build();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private slider(min: number, max: number, step: number, title: string): HTMLInputElement {
    const s = this.el("input");
    s.type = "range";
    s.min = String(min);
    s.max = String(max);
    s.step = String(step);
    s.title = title;
    return s;
  }

  private row(label: string, ...controls: HTMLElement[]): HTMLElement {
    const r = this.el("label", "arow");
    r.append(this.el("span", undefined, label), ...controls);
    return r;
  }

  private build(): void {
    this.root.append(this.el("div", "ctitle", "Material"));
    this.root.append(this.el("div", "ainfo", "Metal, roughness and reflection. Most visible with an environment picture (HDRI) or lamps."));
    for (const name of MATERIAL_PROPERTIES) {
      const box = this.el("div", "matbox");
      const value = this.slider(0, 1, 0.01, TITLES[name]);
      const valueText = this.el("span", "value");
      const head = this.row(LABELS[name], value, valueText);
      head.className = "arow dense";
      const source = this.el("select");
      source.add(new Option("Fixed value", "fixed"));
      for (const s of MATERIAL_SOURCES) source.add(new Option(SOURCE_LABELS[s], s));
      source.title = "A fixed value, or let the properties of the surface (for example cavities) control it";
      const driven = this.el("div");
      driven.style.display = "none";
      driven.style.flexDirection = "column";
      driven.style.gap = "4px";
      const low = this.slider(0, 1, 0.01, "The value where the measure is low");
      const high = this.slider(0, 1, 0.01, "The value where the measure is high");
      const cycles = this.slider(0.1, 10, 0.05, "How many times the curve repeats over the measure");
      const offset = this.slider(0, 1, 0.01, "Shifts the curve");
      const note = this.el("div", "ainfo");
      driven.append(this.row("Low", low), this.row("High", high), this.row("Repetition", cycles), this.row("Offset", offset), note);
      box.append(head, this.row("Controlled by", source), driven);
      this.root.append(box);
      this.rows.set(name, { value, valueText, source, driven, low, high, cycles, offset, note });

      const change = () => this.emit(name);
      value.addEventListener("input", change);
      source.addEventListener("change", change);
      for (const s of [low, high, cycles, offset]) s.addEventListener("input", change);
    }
    const presets=this.el('select');presets.setAttribute('aria-label','Material preset');presets.add(new Option('Choose preset…',''));
    for(const name of Object.keys(MATERIAL_PRESETS))presets.add(new Option(name,name));
    presets.addEventListener('change',()=>{const m=MATERIAL_PRESETS[presets.value];if(m)this.handlers.onPreset?.(structuredClone(m));presets.value='';});
    this.root.prepend(this.row('Preset',presets));
    const surface=this.el('div');surface.append(this.el('div','ctitle','Surface'));this.root.append(surface);for(const name of ['metallic','roughness'] as const)surface.append(this.rows.get(name)!.value.closest('.matbox')!);
    this.orbit=this.slider(0,100,1,'Blends a chosen diffuse colour with the gradient. Mirror colour and material measures are kept.');
    this.orbit.dataset.numericCompanion='external';
    const orbitIdPrefix=this.root.id==='material'?'':'object-';
    this.orbit.id=orbitIdPrefix+'orbit-color-influence';this.orbit.setAttribute('aria-label','Influence of the orbit colour');
    this.orbitNumber=this.el('input');this.orbitNumber.type='number';this.orbitNumber.min='0';this.orbitNumber.max='100';this.orbitNumber.step='1';this.orbitNumber.id=orbitIdPrefix+'orbit-color-percent';this.orbitNumber.setAttribute('aria-label','Influence of the orbit colour in percent');
    this.orbitNumber.className='exact-number';
    this.orbit.addEventListener('input',()=>this.handlers.onChange('orbitColorInfluence',Number(this.orbit.value)/100));
    this.orbitNumber.addEventListener('change',()=>{if(this.orbitNumber.value!==''&&this.orbitNumber.checkValidity())this.handlers.onChange('orbitColorInfluence',Number(this.orbitNumber.value)/100);});
    this.diffuse=this.el('input');this.diffuse.type='color';this.diffuse.id=orbitIdPrefix+'orbit-diffuse-color';this.diffuse.setAttribute('aria-label','Diffuse colour at 0 percent');
    this.diffuse.addEventListener('input',()=>this.handlers.onChange('diffuseColor',[1,3,5].map(k=>srgbChannelToLinear(parseInt(this.diffuse.value.slice(k,k+2),16)/255)) as [number,number,number]));
    this.orbitNote=this.el('div','ainfo');this.orbitNote.id=orbitIdPrefix+'orbit-color-note';
    const orbitControls=this.el('span','numeric-range');orbitControls.append(this.orbit,this.orbitNumber);
    surface.append(this.row('Influence of the orbit colour (%)',orbitControls),this.row('Diffuse colour at 0 %',this.diffuse),this.orbitNote);
    const reflection=this.el('div');reflection.append(this.el('div','ctitle','Reflection / transmission'));reflection.append(this.rows.get('reflectivity')!.value.closest('.matbox')!);this.root.append(reflection);
    this.volume=this.el('details');this.volume.append(this.el('summary',undefined,'Volume / glass'));this.root.append(this.volume);
    const emission=this.el('details');emission.append(this.el('summary',undefined,'Emission'));this.root.append(emission);
    for(const [name,label,min,max,step,parent] of [
      ['transmission','Transmission',0,1,.01,reflection],['ior','IOR',1,4,.01,reflection],
      ['absorptionDensity','Absorption strength',0,1000,.01,this.volume],['emissionStrength','Emission strength',0,1000,.01,emission],
    ] as const){const input=this.el('input');input.type='number';input.min=String(min);input.max=String(max);input.step=String(step);input.setAttribute('aria-label',label);input.addEventListener('change',()=>{if(input.checkValidity())this.handlers.onChange(name,Number(input.value));});this.extras.set(name,input);parent.append(this.row(label,input));}
    for(const [name,label,parent] of [['baseColor','Base colour ×',surface],['absorptionColor','Absorption colour',this.volume],['emissionColor','Emission colour',emission]] as const){
      const input=this.el('input');input.type='color';input.setAttribute('aria-label',label);input.addEventListener('input',()=>{const c=[1,3,5].map(k=>(parseInt(input.value.slice(k,k+2),16)/255)**2.2) as [number,number,number];this.handlers.onChange(name,c);});this.extras.set(name,input);parent.append(this.row(label,input));
    }
    this.detail=new SurfaceDetailPanel(surface,d=>this.handlers.onChange('surfaceDetail',d));
    this.textures=new MaterialTexturesPanel(surface,material=>(this.handlers.onMaterialPreset??this.handlers.onPreset)?.(material));
    this.displacement=new DisplacementPanel(surface,d=>this.handlers.onChange('displacement',d));
    new MaterialBrowser(this.root,()=>this.last??{metallic:0,roughness:1,reflectivity:0},(m,color)=>this.handlers.onMaterialPreset?this.handlers.onMaterialPreset(m,color):this.handlers.onPreset?.(m),this.handlers.color,this.handlers.audition,undefined,material=>{
     // The surface colour comes from the colour gradient; the material's own colour and colour map are multiplied with it. A pale material on an orange gradient then looks almost unchanged.
     const influence=resolveMaterial(material).orbitColorInfluence;if(influence<=0.01)return null;
     const map=material.textures?.maps?.baseColor?.texture?' and the colour map':'';
     return {text:`Note: the colour of the surface comes from the colour gradient (Influence of the orbit colour ${Math.round(influence*100)} %). The colour of the material${map} is multiplied by it, so a light material can look almost unchanged. To see the colour of the material itself: use the button below, or lower the Influence of the orbit colour under Material.`,alternativeLabel:'Apply with the colour of the material itself',alternative:{...material,orbitColorInfluence:0}}});
    surface.append(this.el('div','ainfo','The base colour multiplies the gradient/texture or the colour of the object. White keeps it.'));
    reflection.append(this.el('div','ainfo','Glass requires geometric transport in Final Preview/final render. Closed spheres and boxes are volumes.'));
  }

  /** The property as the controls say it now. */
  private emit(name: MaterialPropertyName): void {
    const r = this.rows.get(name)!;
    const current = this.last?.[name];
    if (r.source.value === "fixed") {
      this.handlers.onChange(name, readNumber(r.value));
      return;
    }
    const previous = typeof current === "object" ? current : undefined;
    // A curve with more than two points (from a scene file) keeps its points; only a change of source, cycles or offset applies.
    const curve =
      previous && previous.curve.length > 2
        ? previous.curve
        : [
            { position: 0, value: readNumber(r.low) },
            { position: 1, value: readNumber(r.high) },
          ];
    const driven: DrivenProperty = {
      measure: r.source.value as MaterialSource,
      curve,
      cycles: readNumber(r.cycles),
      offset: readNumber(r.offset),
      wrap: previous?.wrap ?? "mirror",
    };
    this.handlers.onChange(name, driven);
  }

  /** Shows the scene's material. Leaves a control alone while it is being used. */
  update(material: MaterialSettings,target='fractal',orbitUnavailable?:string): void {
    this.last = material;
    this.detail.update(material.surfaceDetail);
    this.textures.update(material);
    this.displacement.update(material,target);
    const resolved=resolveMaterial(material);
    if(document.activeElement!==this.orbit)this.orbit.value=String(resolved.orbitColorInfluence*100);
    if(document.activeElement!==this.orbitNumber)this.orbitNumber.value=String(resolved.orbitColorInfluence*100);
    if(document.activeElement!==this.diffuse)this.diffuse.value='#'+resolved.diffuseColor.map(v=>Math.round((v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055)*255).toString(16).padStart(2,'0')).join('');
    this.orbit.disabled=this.orbitNumber.disabled=this.diffuse.disabled=!!orbitUnavailable||target!=='fractal';
    this.orbitNote.textContent=orbitUnavailable??(target!=='fractal'?'Orbit blending applies to the primary diffuse surface of the fractal.':`${Math.round(resolved.orbitColorInfluence*100)} % · Diffuse gradient colour only. Texture blending and Base colour × apply afterwards. The mirror colour is kept. At 100 % the chosen diffuse colour is dormant.`);
    this.volume.hidden=resolved.transmission===0;
    for(const [name,input] of this.extras){if(document.activeElement===input)continue;const value=resolved[name];if(Array.isArray(value))input.value='#'+value.map(c=>Math.round(c**(1/2.2)*255).toString(16).padStart(2,'0')).join('');else input.value=String(value);}
    for (const name of MATERIAL_PROPERTIES) {
      const r = this.rows.get(name)!;
      const p = material[name];
      const set = (input: HTMLInputElement, v: number) => {
        if (!isNumericEditing(input)) setInputValue(input, v);
      };
      if (typeof p === "number") {
        r.source.value = "fixed";
        r.driven.style.display = "none";
        r.value.disabled = false;
        set(r.value, p);
        r.valueText.textContent = p.toFixed(2);
      } else {
        r.source.value = p.measure;
        r.driven.style.display = "flex";
        r.value.disabled = true;
        r.valueText.textContent = "styrd";
        const simple = p.curve.length === 2 && p.curve[0]!.position === 0 && p.curve[1]!.position === 1;
        r.low.disabled = !simple;
        r.high.disabled = !simple;
        set(r.low, p.curve[0]!.value);
        set(r.high, p.curve[p.curve.length - 1]!.value);
        set(r.cycles, p.cycles);
        set(r.offset, p.offset);
        r.note.textContent = simple ? "" : `The curve has ${p.curve.length} points (changed in the scene file).`;
      }
    }
  }
}
