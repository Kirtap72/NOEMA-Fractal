import type {QualityProfile} from './qualityAuthority';
import {openFileStream} from './output';
import { PREVIEW_LIGHT_SAMPLES, QUALITY_LIMITS, readQuality } from "../engine";
import type { DebugView, PrecisionMode, PreviewScale, QualitySettings } from "../engine";

/** The detail values that are numbers (the precision mode is chosen separately). */
type NumericKey = keyof typeof QUALITY_LIMITS;

export type CropMode = "full" | "center" | "custom";
export type StillLayers = "none" | "depth" | "depth+normal";

export interface CropChoice {
  mode: CropMode;
  /** Side of the square cut-out around the middle (mode "center"). */
  size: number;
  /** mode "custom": in pixels of the final picture. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StillPanelHandlers {
  /** One or more detail values were changed (already checked). */
  onQuality(changes: Partial<QualitySettings>): void;
  /** Fits the hit precision to the size of the picture. */
  onAutoPrecision(): void;
  /** A ready-made set of detail values was chosen. */
  onPreset(id: string): void;
  /** Use the detail values in the live preview too (slower). */
  onPreviewDetail(on: boolean): void;
  /** A debug view for the preview and the cut-out (not saved in the scene). */
  onDebugView(view: DebugView): void;
  onCropPreview(): void;
  /** A whole picture with Geometry Detail only inside the chosen cut-out and the ordinary Float32 render everywhere else. */
  onSelectiveGd(): void;
  onRender(): void;
  onCancel(): void;
}

const PRESETS: [string, string][] = [
  ["custom", "Custom values"],
  ["fast", "Fast (1 sample, like the preview)"],
  ["good", "Good (4 samples)"],
  ["high", "High (16 samples, finer detail)"],
  ["extreme", "Extreme (64 samples, very fine detail, very slow)"],
];

const WHOLE = new Set<NumericKey>(["samples_per_pixel", "max_steps", "shadow_steps", "seed"]);

interface Field {
  key: NumericKey;
  label: string;
  hint: string;
  step: string;
}

const FIELDS: Field[] = [
  { key: "samples_per_pixel", label: "Samples per pixel", hint: "More samples give smoother edges and less noise. Time grows by the same factor (16 samples = 16 times longer).", step: "1" },
  { key: "hit_precision", label: "Hit precision", hint: "The hit limit of the final render. Smaller = finer detail but slower. Explore and Inspect use separate temporary values.", step: "any" },
  { key: "step_factor", label: "Step factor", hint: "How much of the distance estimate each step takes (1 = all of it). Smaller is safer for fractals with a poor estimate, but slower.", step: "any" },
  { key: "max_steps", label: "Max steps", hint: "The most steps a ray may take. More steps are needed for deep recesses and finer precision.", step: "1" },
  { key: "max_distance", label: "Max distance", hint: "Rays that travel further than this count as misses.", step: "any" },
  { key: "hit_pixels", label: "Hit limit (pixels)", hint: "In the 'follows the pixel size' mode: how close to the surface a ray counts as a hit, as a fraction of a pixel. 0.5 = half a pixel. Smaller = sharper and fewer rings, but slower.", step: "any" },
  { key: "normal_pixels", label: "Normal step (pixels)", hint: "In the 'follows the pixel size' mode: the step used to compute the surface direction, as a fraction of a pixel. Too small gives noise on fractals with an uneven distance estimate; 1 is a good start, 2–4 smooths.", step: "any" },
  { key: "precision_floor", label: "Precision floor (share of standard)", hint: "The Float32 floor for the hit limit and normal step is 2e-6 × (1 + distance from the origin). In deep zooms it is larger than a pixel and stops all finer detail. 1 = as before; 0.1 = a tenth (more detail, requires a sufficiently accurate distance estimate). See Maximum under Quality level.", step: "any" },
  { key: "shadow_steps", label: "Shadow steps", hint: "The most steps a shadow ray may take. More steps give softer and more accurate shadows but take longer.", step: "1" },
  { key: "normal_epsilon", label: "Normal step", hint: "The step size when the surface direction is computed. Should be of the same order as the hit precision.", step: "any" },
  { key: "seed", label: "Seed", hint: "Starts the pattern for where the samples are placed. The same seed gives exactly the same picture.", step: "1" },
];

/** The still picture mode: detail controls, a cut-out to check the detail, and the final render. Builds plain DOM; text only. */
export class StillPanel {
  readonly geometryMount=document.createElement('div');
  readonly imageSection=document.createElement('fieldset');
  readonly advanced=document.createElement('details');
  readonly legacyGeometry=document.createElement('div');
  private profile:QualityProfile='legacy';
  private unavailable?:string;
  private hasShadow=true;
  private imageNote=document.createElement('p');
  private summary=document.createElement('p');
  private authorityNote=document.createElement('p');
  private preset!: HTMLSelectElement;
  private inputs = new Map<NumericKey, HTMLInputElement>();
  private previewDetail!: HTMLInputElement;
  private debug!: HTMLSelectElement;
  private precision!: HTMLSelectElement;
  private normalPolicy!:HTMLSelectElement;
  private hitPolicy!:HTMLSelectElement;
  private cameraSampling!:HTMLSelectElement;
  private crop!: HTMLSelectElement;
  private cropSize!: HTMLSelectElement;
  private cropRow!: HTMLDivElement;
  private cropCustom!: HTMLDivElement;
  private cropInputs: HTMLInputElement[] = [];
  private previewScale!: HTMLSelectElement;
  private previewSamples!: HTMLSelectElement;
  private finalSampleQuick!: HTMLSelectElement;
  private layers!: HTMLSelectElement;
  private output!: HTMLSelectElement;
  private cropButton!: HTMLButtonElement;
  private selectiveButton!: HTMLButtonElement;
  private renderButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private autoButton!: HTMLButtonElement;
  private bar!: HTMLProgressElement;
  private status!: HTMLDivElement;
  private info!: HTMLDivElement;
  private previewBox!: HTMLDivElement;
  private previewCanvas!: HTMLCanvasElement;
  private nativeProfileEnabled=false;
  private busyFlag=false;
  private lastQuality: QualitySettings | null = null;

  constructor(
    private root: HTMLElement,
    private handlers: StillPanelHandlers,
  ) {
    this.build();
    this.consolidate();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private row(label: string, ...controls: HTMLElement[]): HTMLElement {
    const r = this.el("label", "arow");
    r.append(this.el("span", undefined, label), ...controls);
    return r;
  }

  private build(): void {
    this.root.append(this.el("div", "ctitle", "Still picture (camera mode)"));
    this.root.append(this.el('p','note','The detail values below apply to the final render. The viewport modes at FPS use temporary values and do not overwrite these.'));
    this.info = this.el("div", "rstatus");
    this.root.append(this.info);

    this.preset = this.el("select");
    for (const [value, label] of PRESETS) this.preset.add(new Option(label, value));
    this.preset.title = "Ready-made sets to start from. You can change every value afterwards.";
    this.preset.addEventListener("change", () => {
      if (this.preset.value !== "custom") this.handlers.onPreset(this.preset.value);
    });
    this.root.append(this.row("Older quality presets (several controls)", this.preset));

    this.normalPolicy=this.el('select');this.normalPolicy.id='surface-rendering';
    this.normalPolicy.add(new Option('Original','legacy'));this.normalPolicy.add(new Option('Fine detail','film-detail'));
    this.normalPolicy.title='Fine detail gives more local surface rendering in Final Preview and the final picture. Based on the size of the final picture. Explore and Inspect keep their faster rendering.';
    this.normalPolicy.addEventListener('change',()=>this.handlers.onQuality({normal_policy:this.normalPolicy.value as 'legacy'|'film-detail'}));
    this.root.append(this.row('Surface rendering',this.normalPolicy));

    this.hitPolicy=this.el('select');this.hitPolicy.id='hit-accuracy';
    this.hitPolicy.add(new Option('Original','legacy'));this.hitPolicy.add(new Option('Fine hit','film-half-pixel'));
    this.hitPolicy.title='Fine hit searches closer to the visible surface in Final Preview and the final picture. Can show smaller shapes and gaps, but takes longer and may need more Max steps. Based on the size of the final picture. Explore and Inspect keep their faster precision.';
    this.hitPolicy.addEventListener('change',()=>this.handlers.onQuality({hit_policy:this.hitPolicy.value as 'legacy'|'film-half-pixel'}));
    this.root.append(this.row('Hit accuracy',this.hitPolicy));
    this.cameraSampling=this.el('select');this.cameraSampling.id='camera-sampling';
    this.cameraSampling.add(new Option('Original','legacy'));this.cameraSampling.add(new Option('Even coverage','stratified'));
    this.cameraSampling.title='Spreads the camera sub-pixel samples separately per pixel in Final Preview and the final picture. Try 4 or 16 Samples per pixel. One sample keeps the pixel centre. No blur or change of surface detail.';
    this.cameraSampling.addEventListener('change',()=>this.handlers.onQuality({camera_sampling:this.cameraSampling.value as 'legacy'|'stratified'}));
    this.root.append(this.row('Anti-aliasing',this.cameraSampling));

    this.precision = this.el("select");
    this.precision.add(new Option("Fixed limit (not numeric precision)", "fixed"));
    this.precision.add(new Option("Follows the pixel size", "pixel"));
    this.precision.title =
      "Fixed: the hit limit and the normal step are the same number at every picture size. Follows the pixel size: they are a fraction of a pixel, so an 8K picture gets limits four times finer than a 1080p picture without you changing anything.";
    this.precision.addEventListener("change", () => {
      this.preset.value = "custom";
      this.handlers.onQuality({ precision_mode: this.precision.value as PrecisionMode });
    });
    this.root.append(this.row("Threshold model", this.precision));

    for (const f of FIELDS) {
      const input = this.el("input");
      input.type = "number";
      input.id="quality-"+f.key;
      input.step = f.step;
      input.title = f.hint;
      const [lo, hi] = QUALITY_LIMITS[f.key];
      input.min = String(lo);
      input.max = String(hi);
      input.addEventListener("change", () => this.changed(f.key, input));
      this.inputs.set(f.key, input);
      const row = this.row(f.label, input);
      row.title = f.hint;
      this.root.append(row);
    }

    this.autoButton = this.el("button", undefined, "Adapt the precision to the picture size");
    this.autoButton.title = "Sets the hit precision to half a pixel per distance unit for the chosen picture size, so that the finest detail a pixel can show is also found.";
    this.autoButton.addEventListener("click", () => this.handlers.onAutoPrecision());
    this.root.append(this.autoButton);

    const previewLabel = this.el("label", "arow");
    this.previewDetail = this.el("input");
    this.previewDetail.type = "checkbox";
    this.previewDetail.title = "Chooses Final view: a quick whole picture and progressive refinement with all lights within a separate viewport budget. Explore is at FPS. Export always uses the saved final quality and all samples.";
    this.previewDetail.addEventListener("change", () => this.handlers.onPreviewDetail(this.previewDetail.checked));
    previewLabel.append(this.el("span", undefined, "Details in the preview"), this.previewDetail);
    this.root.append(previewLabel);

    this.debug = this.el("select");
    this.debug.add(new Option("Off (ordinary picture)", "off"));
    this.debug.add(new Option("Steps per pixel (heat map)", "steps"));
    this.debug.add(new Option("Mark pixels that ran out of steps", "exhausted"));
    this.debug.title =
      "The heat map shows how much of the allowed steps each ray used: blue few, red many, dark = missed the surface. " +
      "Magenta = the ray ran out of steps before hitting or leaving the scene, so the colour there is a guess. Applies to the preview and the detail inspection, not the saved picture.";
    this.debug.addEventListener("change", () => this.handlers.onDebugView(this.debug.value as DebugView));
    this.root.append(this.row("Debug view", this.debug));

    // ---- cut-out: look at the detail at full resolution without rendering the whole picture
    this.crop = this.el("select");
    this.crop.add(new Option("Whole picture", "full"));
    this.crop.add(new Option("Cut-out in the middle", "center"));
    this.crop.add(new Option("Own cut-out …", "custom"));
    this.crop.value = "center";
    this.root.append(this.row("Inspect", this.crop));
    this.cropSize = this.el("select");
    for (const n of [256, 512, 1024, 2048]) this.cropSize.add(new Option(`${n} × ${n} pixels`, String(n)));
    this.cropSize.value = "512";
    this.cropRow = this.row("Size of the cut-out", this.cropSize) as HTMLDivElement;
    this.root.append(this.cropRow);
    this.cropCustom = this.el("div", "arow three");
    this.cropCustom.hidden = true;
    const names = ["x", "y", "width", "height"];
    this.cropCustom.append(this.el("span", undefined, "x, y, b, h"));
    ["0", "0", "512", "512"].forEach((v, i) => {
      const input = this.el("input");
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = v;
      input.title = names[i]!;
      this.cropInputs.push(input);
      this.cropCustom.append(input);
    });
    this.cropCustom.className = "arow four";
    this.root.append(this.cropCustom);
    this.crop.addEventListener("change", () => {
      this.cropRow.hidden = this.crop.value !== "center";
      this.cropCustom.hidden = this.crop.value !== "custom";
    });

    this.previewScale = this.el("select");
    this.previewScale.id = "preview-scale";
    this.previewScale.setAttribute("aria-label", "Preview scale");
    this.previewScale.add(new Option("50 % linear scale (25 % of the pixels)", "0.5"));
    this.previewScale.add(new Option("75 % linear scale (56.25 % of the pixels)", "0.75"));
    this.previewScale.add(new Option("100 % linear scale (full resolution)", "1"));
    this.previewScale.value = "1";
    this.previewScale.title = "50 % linear scale draws a quarter as many pixels (not a guaranteed 4× shorter wall time). Geometry Detail, DS precision, Box Cut, formula iterations and the saved final export are never changed.";
    this.root.append(this.row("Preview scale", this.previewScale));

    this.previewSamples = this.el("select");
    this.previewSamples.id = "preview-light-samples";
    this.previewSamples.setAttribute("aria-label", "Preview light samples");
    this.previewSamples.add(new Option("As the final picture", "scene"));
    for (const s of PREVIEW_LIGHT_SAMPLES) {
      this.previewSamples.add(new Option(s === 1 ? "1 sample (fast/noisy)" : `${s} samples`, String(s)));
    }
    this.previewSamples.value = "scene";
    this.previewSamples.title = "An independent sample budget for the detail inspection. Does not change the saved final quality or geometry.";
    this.root.append(this.row("Light samples (preview)", this.previewSamples));
    this.root.append(this.el("div", "ainfo", "50 % linear scale gives a quarter as many pixels (25 %), not a guaranteed 4× shorter wall time. Geometry Detail, DS precision, Box Cut and the full resolution of the final export are always kept."));

    this.finalSampleQuick = this.el("select");
    this.finalSampleQuick.id = "final-light-samples";
    this.finalSampleQuick.setAttribute("aria-label", "Final light samples");
    for (const s of [1, 2, 4, 8, 16, 32, 64]) {
      this.finalSampleQuick.add(new Option(s === 1 ? "1 sample (fast/noisy)" : `${s} samples/pixel`, String(s)));
    }
    this.finalSampleQuick.add(new Option("Custom value", "custom"));
    this.finalSampleQuick.title = "Quick choice of light/picture samples per pixel in the final picture without changing any geometry setting.";
    this.finalSampleQuick.addEventListener("change", () => {
      const n = Number(this.finalSampleQuick.value);
      if (Number.isInteger(n) && n >= 1) {
        this.preset.value = "custom";
        this.handlers.onQuality({ samples_per_pixel: n });
      }
    });

    this.cropButton = this.el("button", undefined, "Inspect details");
    this.cropButton.title = "Draws only the cut-out, at the real resolution of the picture and with your detail values, and shows it here. Also shows roughly how long the whole picture would take.";
    this.cropButton.addEventListener("click", () => this.handlers.onCropPreview());
    this.root.append(this.cropButton);
    this.selectiveButton = this.el("button", undefined, "Whole picture: Geometry Detail only in the cut-out");
    this.selectiveButton.id = "selective-gd";
    this.selectiveButton.title = "Draws the whole picture with ordinary Float32 rendering and puts Geometry Detail in the cut-out you chose. The cut-out replaces the picture exactly; over a soft edge outside it blends evenly into the rest, which is untouched. Requires Geometry Detail to be on and approved for the scene. Much cheaper than Geometry Detail on the whole picture.";
    this.selectiveButton.addEventListener("click", () => this.handlers.onSelectiveGd());
    this.root.append(this.selectiveButton);
    this.previewBox = this.el("div", "stillpreview");
    this.previewBox.hidden = true;
    this.previewCanvas = this.el("canvas");
    this.previewCanvas.title = "Shown at the real resolution of the picture (1 picture pixel = 1 screen pixel)";
    const save=document.createElement('button');save.textContent='Save cut-out…';save.id='still-save-region';
    save.onclick=async()=>{try{const stream=await openFileStream('utsnitt.png','image/png','.png');const blob=await new Promise<Blob>((resolve,reject)=>this.previewCanvas.toBlob(b=>b?resolve(b):reject(Error('PNG encoding failed')),'image/png'));await stream.write(new Uint8Array(await blob.arrayBuffer()));await stream.close();this.setStatus('Cut-out saved: '+stream.describe());}catch(e){this.setStatus('Saving cancelled: '+String(e));}};
    this.previewBox.append(this.previewCanvas,save);
    this.root.append(this.previewBox);

    // ---- final picture
    this.layers = this.el("select");
    this.layers.add(new Option("Colour picture only (PNG)", "none"));
    this.layers.add(new Option("Colour + depth (PNG + OpenEXR)", "depth"));
    this.layers.add(new Option("Colour + depth + normals (PNG + OpenEXR)", "depth+normal"));
    this.layers.title = "Continuous layers need the memory of the whole picture. PNG tiles + JSON can export layers in limited parts.";
    this.root.append(this.row("Layers", this.layers));
    this.output=this.el('select');this.output.setAttribute('aria-label','Still output');
    this.output.add(new Option('PNG (streaming whole picture)','image'));
    this.output.add(new Option('OpenEXR beauty (linear HDR, Half16)','exr'));
    this.output.add(new Option('OpenEXR beauty (linear HDR, Float32)','exr-float'));
    this.output.add(new Option('PNG tiles + JSON (limited memory)','tiles'));
    this.output.addEventListener('change',()=>{this.layers.disabled=this.exrOutput();if(this.exrOutput())this.layers.value='none';});
    this.output.title='PNG uses the display curve. OpenEXR keeps linear HDR before exposure and tone mapping. Tiles keep the full image projection; JSON gives the pixel positions. Use a file or folder when the browser supports it.';
    this.root.append(this.row('Output',this.output));

    const buttons = this.el("div", "rbuttons");
    this.renderButton = this.el("button", undefined, "Render still picture");
    this.renderButton.title = "Draws the camera view with the saved final quality and saves the chosen picture format";
    this.renderButton.addEventListener("click", () => this.handlers.onRender());
    this.cancelButton = this.el("button", undefined, "Cancel");
    this.cancelButton.hidden = true;
    this.cancelButton.addEventListener("click", () => this.handlers.onCancel());
    buttons.append(this.renderButton, this.cancelButton);
    this.root.append(buttons);

    this.bar = this.el("progress");
    this.bar.hidden = true;
    this.bar.max = 1000;
    this.status = this.el("div", "rstatus");
    this.root.append(this.bar, this.status);
  }

  /** The render and cancel buttons, the progress bar and the status line, so the Render tab can show them at its top. */
  takeActions(): { render: HTMLButtonElement; cancel: HTMLButtonElement; bar: HTMLProgressElement; status: HTMLElement } {
    return { render: this.renderButton, cancel: this.cancelButton, bar: this.bar, status: this.status };
  }

  /** Checks the value with the same rules as a scene file, then passes it on or shows what is wrong. */
  private changed(key: NumericKey, input: HTMLInputElement): void {
    const errors: string[] = [];
    const value = readQuality({ [key]: Number(input.value) }, "the value", errors);
    if (!value) {
      // Say it in Swedish and put the old value back, so the field never shows something that is not in use.
      const field = FIELDS.find((f) => f.key === key)!;
      const [lo, hi] = QUALITY_LIMITS[key];
      this.setStatus(`${field.label} must be ${WHOLE.has(key) ? "a whole number" : "a number"} from ${lo} to ${hi}.`);
      const last = this.lastQuality?.[key];
      if (last !== undefined) input.value = String(last);
      return;
    }
    this.preset.value = "custom";
    this.handlers.onQuality({ [key]: value[key] });
  }

  /** Shows the scene's detail values. Leaves a field alone while it is being typed in. */
  showQuality(q: QualitySettings): void {
    this.lastQuality = q;
    if (document.activeElement !== this.precision) this.precision.value = q.precision_mode;
    if(document.activeElement!==this.normalPolicy)this.normalPolicy.value=q.normal_policy??'legacy';
    if(document.activeElement!==this.hitPolicy)this.hitPolicy.value=q.hit_policy??'legacy';
    if(document.activeElement!==this.cameraSampling)this.cameraSampling.value=q.camera_sampling??'legacy';
    const pixel = q.precision_mode === "pixel";
    for (const [key, input] of this.inputs) {
      const row = input.parentElement;
      if (!row) continue;
      // Show the numbers that are in use: pixel shares in pixel mode, fixed numbers otherwise.
      if (key === "hit_pixels" || key === "normal_pixels") row.hidden = !pixel;
      if (key === "hit_precision" || key === "normal_epsilon") row.hidden = pixel;
    }
    for (const f of FIELDS) {
      const input = this.inputs.get(f.key)!;
      if (document.activeElement !== input) input.value = String(q[f.key] ?? (f.key === "precision_floor" ? 1 : ""));
    }
    if (document.activeElement !== this.finalSampleQuick) {
      const match = [1, 2, 4, 8, 16, 32, 64].includes(q.samples_per_pixel);
      this.finalSampleQuick.value = match ? String(q.samples_per_pixel) : "custom";
    }
  }

  setPreviewDetail(on: boolean): void {
    this.previewDetail.checked = on;
  }

  /** A line about the picture that will be drawn. */
  showInfo(text: string): void {
    this.info.textContent = text;
  }

  cropChoice(): CropChoice {
    const n = this.cropInputs.map((i) => Number(i.value));
    return {
      mode: this.crop.value === "full" || this.crop.value === "custom" ? this.crop.value : "center",
      size: Number(this.cropSize.value),
      x: n[0]!,
      y: n[1]!,
      width: n[2]!,
      height: n[3]!,
    };
  }

  previewChoice(): { scale: PreviewScale; samplesPerPixel: number | null } {
    const scaleVal = Number(this.previewScale.value);
    const scale: PreviewScale = scaleVal === 0.5 || scaleVal === 0.75 ? scaleVal : 1;
    const samplesPerPixel = this.previewSamples.value === "scene" ? null : Number(this.previewSamples.value);
    return { scale, samplesPerPixel };
  }

  layerChoice(): StillLayers {
    return this.layers.value === "depth" || this.layers.value === "depth+normal" ? this.layers.value : "none";
  }
  exrOutput():boolean{return this.output.value==='exr'||this.output.value==='exr-float';}
  exrPrecision():'half'|'float'{return this.output.value==='exr-float'?'float':'half';}
  tileOutput(): boolean { return this.output.value==='tiles'; }

  /** Shows a finished cut-out. Pixels are RGBA. */
  showPreview(width: number, height: number, rgba: Uint8Array): void {
    this.previewBox.hidden = false;
    this.previewCanvas.width = width;
    this.previewCanvas.height = height;
    const data = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), width, height);
    this.previewCanvas.getContext("2d")!.putImageData(data, 0, 0);
  }

  private consolidate():void {
    this.geometryMount.id='quality-geometry-mount';this.imageSection.id='quality-image';
    this.imageSection.innerHTML='<legend>Picture quality</legend>';
    this.imageSection.append(this.imageNote);
    this.advanced.id='quality-advanced';this.advanced.innerHTML='<summary>Advanced · older helper passes and thresholds</summary>';
    this.summary.id='quality-effective';this.summary.setAttribute('role','status');
    this.authorityNote.id='quality-authority-note';
    this.root.prepend(this.root.querySelector('.ctitle')!,this.summary,this.geometryMount,this.imageSection,this.advanced);
    this.advanced.append(this.authorityNote);
    for(const control of [this.preset,this.precision,this.hitPolicy,this.debug])this.advanced.append(control.parentElement!);
    this.advanced.append(this.autoButton);
    for(const [key,input] of this.inputs){
      const target=key==='step_factor'?this.legacyGeometry:['samples_per_pixel','shadow_steps'].includes(key)?this.imageSection:this.advanced;
      target.append(input.parentElement!);
      if(key==='step_factor')input.parentElement!.querySelector('span')!.textContent='Step Multiplier';
    }
    this.imageSection.append(this. row("Quick choice: light/picture samples", this.finalSampleQuick));
    this.imageSection.append(this.normalPolicy.parentElement!);
  }
  setAuthority(profile:QualityProfile,summary:string,unavailable?:string,hasShadow=true,nativeArtist=false):void {
    this.profile=profile;this.unavailable=unavailable;this.nativeProfileEnabled=profile==='native';
    this.hasShadow=hasShadow;
    this.root.dataset.qualityProfile=profile;this.summary.textContent=summary;
    this.legacyGeometry.hidden=profile!=='legacy';
    const normalTarget=profile==='geometry'?this.advanced:this.imageSection;
    normalTarget.append(this.normalPolicy.parentElement!);
    this.normalPolicy.parentElement!.querySelector('span')!.textContent=profile==='geometry'?'Normal policy for the fallback normal (the primary micro-normal is fixed)':'Surface normals (appearance, not geometry)';
    const guideNames:Partial<Record<NumericKey,string>>={hit_precision:'Helper pass: hit limit',hit_pixels:'Helper pass: hit limit (px)',max_steps:'Helper pass: max steps (effectively at most 640)',normal_epsilon:'Normal step: secondary / fallback',normal_pixels:'Normal step: secondary / fallback (px)'};
    for(const field of FIELDS)this.inputs.get(field.key)!.parentElement!.querySelector('span')!.textContent=field.key==='step_factor'?'Step Multiplier':profile==='geometry'?guideNames[field.key]??field.label:field.label;
    this.precision.parentElement!.querySelector('span')!.textContent=profile==='geometry'?'Threshold model: helper pass / secondary':'Threshold model';
    this.hitPolicy.parentElement!.querySelector('span')!.textContent=profile==='geometry'?'Fine hit: helper pass':'Hit accuracy';
    this.authorityNote.textContent=profile==='geometry'?'GEO5 keeps a guiding Float32 pass. Hit limits and min(640, Max steps) can affect its nearest point, the step limit of the DS search and older surface light. Normal steps are also used by secondary rays, cuts and the fallback normal. The final DS hit band/budget is owned by Geometry quality.':profile==='native'?'The original profile owns the camera, hit policy, S5 normal, material, light and limited shadow visibility. These older values are saved but not used in the native cut-out. The Artist look in the locked profile also uses a limited light path.':'Older scene behaviour is kept. Quality presets change several fields at once, including picture samples and shadows. Fixed means a fixed threshold, not a faster number format.';
    if(profile==='native'&&nativeArtist)this.authorityNote.textContent='Locked native geometry and S5 normal. NOEMA Artist uses the scene\'s palette, material and direct light, but the limited profile path switches off shadows, AO/cavity, fog and reflection rays. Older hit/normal/step quality does not affect the native search.';
    this.imageNote.textContent=(profile==='native'?'The S5 normal and shadow visibility are owned by the original profile. ':profile==='geometry'?'Primary normal: DS micro-normal with a separate pixel offset. ':'Normal step and Fine detail change the surface direction, not the hit geometry. ')+(profile!=='native'&&!hasShadow?'Shadow steps are unavailable: no active light casts shadows. Enable shadows under Light to use the value.':'Samples per pixel control anti-aliasing and sampling independently of geometry.');
    this.setBusy(this.busyFlag);
  }
  setBusy(busy:boolean):void {
    this.busyFlag=busy;
    const reason='The locked MB3D profile uses its own values; this saved older field does not affect the native cut-out.';
    const lock=(el:HTMLInputElement|HTMLSelectElement|HTMLButtonElement,why?:string)=>{
      el.disabled=busy||!!why;el.dataset.unavailableReason=why??'';
      if(why){el.dataset.originalTitle??=el.title;el.title=why;el.setAttribute('aria-description',why);}
      else if(el.dataset.originalTitle!==undefined){el.title=el.dataset.originalTitle;el.removeAttribute('aria-description');}
    };
    for(const c of [this.output,this.preset,this.debug,this.precision,this.normalPolicy,this.hitPolicy,this.crop,this.cropSize,this.previewScale,this.previewSamples,this.finalSampleQuick,this.layers,this.previewDetail,...this.cropInputs,...this.inputs.values(),this.autoButton,this.cropButton,this.renderButton])lock(c);
    if(this.nativeProfileEnabled){
      for(const el of [this.preset,this.debug,this.precision,this.normalPolicy,this.hitPolicy,this.output,this.layers,this.autoButton])lock(el,reason);
      for(const [key,input]of this.inputs)if(key!=='samples_per_pixel'&&key!=='seed')lock(input,reason);
      lock(this.renderButton,'A whole native film is not verified. Use the detail inspection and Save cut-out.');
    }else if(this.profile==='geometry'){
      lock(this.inputs.get('step_factor')!,'Step Multiplier in Geometry quality owns all steps; the older step_factor is not used.');
      lock(this.preset,'Older presets mix geometry, picture samples and shadows. Change these independently in their own section.');
      lock(this.debug,'The older heat map describes the helper pass. Use the Geometry Detail status for the direct search.');
      if(this.unavailable){lock(this.renderButton,this.unavailable);lock(this.cropButton,this.unavailable);}
    }
    if(!this.nativeProfileEnabled&&!this.hasShadow)lock(this.inputs.get('shadow_steps')!,'No active light casts shadows. Enable shadows under Light. The saved value is kept.');
    if(!this.nativeProfileEnabled&&this.exrOutput())lock(this.layers,'Beauty EXR contains colour. Choose PNG/tiles for separate layers.');
    this.cancelButton.hidden=!busy;this.bar.hidden=!busy;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  /** 0 to 1. */
  setProgress(fraction: number): void {
    this.bar.value = Math.round(Math.min(1, Math.max(0, fraction)) * 1000);
  }
}
