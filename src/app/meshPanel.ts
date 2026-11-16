import type {ExportMode,FractalRepresentation} from '../engine/sceneExport';
import {estimateAdaptiveGaussians} from '../engine/adaptiveGaussians';
import type {GaussianQuality} from '../engine/adaptiveGaussians';
import {MAX_GAUSSIAN_COUNT} from '../engine/gaussianExport';
export type MeshFormat = "glb" | "obj" | "ply";

export interface MeshSettings {
  mode:ExportMode|'legacy';representation:FractalRepresentation;count:number;seed:number;
  gaussianQuality:GaussianQuality|'legacy';detailTolerance?:number;memoryBudgetMiB:number;fileBudgetMiB:number;
  withNormals:boolean;scaleMultiplier:number;opacity:number;opacityMode:'constant'|'coverage';colorMode:'surface-color'|'constant';volumeMode:'raw-field'|'surface-density';
  adaptive: boolean;
  resolution: number;
  center: [number, number, number];
  /** Half the width of the cube that is measured. */
  halfSize: number;
  /** Where the surface is drawn, in grid steps (0 = on the surface, positive = a little fatter). */
  level: number;
  format: MeshFormat;
  /** Add the animated camera to the file (glb only). */
  includeCamera: boolean;
  /** Colour every vertex like the picture (the colours of the scene). */
  withColors: boolean;
}

export interface MeshPanelHandlers {
  onExport(): void;
  /** Fill in the area from the camera: its target point and distance. */
  onFit(): void;
  onCancel?():void;
}

const RESOLUTIONS = [64, 96, 128, 192, 256];

/** Settings for exporting the shape as a triangle mesh. Builds plain DOM; text only. */
export class MeshPanel {
  private resolution!: HTMLSelectElement;
  private center: HTMLInputElement[] = [];
  private half!: HTMLInputElement;
  private level!: HTMLInputElement;
  private format!: HTMLSelectElement;
  private camera!: HTMLInputElement;
  private colors!: HTMLInputElement;
  private adaptive!: HTMLInputElement;
  private exportButton!: HTMLButtonElement;
  private status!: HTMLDivElement;
  private mode!:HTMLSelectElement;private representation!:HTMLSelectElement;private count!:HTMLInputElement;private seed!:HTMLInputElement;
  private normals!:HTMLInputElement;private scale!:HTMLInputElement;private opacity!:HTMLInputElement;private opacityMode!:HTMLSelectElement;private colorMode!:HTMLSelectElement;private volumeMode!:HTMLSelectElement;
  private estimate!:HTMLDivElement;private cancel!:HTMLButtonElement;
  private gaussianQuality!:HTMLSelectElement;private tolerance!:HTMLInputElement;private memory!:HTMLInputElement;private fileBudget!:HTMLInputElement;
  private pointCount!:HTMLInputElement;
  private conditional:{element:HTMLElement;show:()=>boolean}[]=[];

  constructor(
    private root: HTMLElement,
    private handlers: MeshPanelHandlers,
  ) {
    this.build();
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

  private number(value: string, step = "0.1"): HTMLInputElement {
    const i = this.el("input");
    i.type = "number";
    i.step = step;
    i.value = value;
    return i;
  }

  private build(): void {
    this.root.append(this.el("div", "ctitle", "Export 3D content"));
    const select=(items:[string,string][])=>{const e=this.el('select');for(const [value,label]of items)e.add(new Option(label,value));return e;};
    this.mode=select([['geometry','Geometry'],['volume','Volume / field'],['points','Point cloud'],['gaussians','Gaussian Splats'],['scene','Complete scene'],['legacy','Earlier mesh / camera path']]);this.mode.dataset.exportControl='mode';
    this.root.append(this.row('Export mode',this.mode));
    this.representation=select([['mesh','Mesh'],['volume','Volume'],['points','Point cloud'],['gaussians','Gaussian Splats']]);this.representation.dataset.exportControl='representation';
    const conditional=(label:string,control:HTMLElement,show:()=>boolean)=>{const element=this.row(label,control);this.root.append(element);this.conditional.push({element,show});};
    conditional('Representation of the fractal',this.representation,()=>this.mode.value==='scene');
    const kind=()=>this.mode.value==='scene'?this.representation.value:this.mode.value;
    this.gaussianQuality=select([['draft','Draft – quick shape check'],['balanced','Balanced – automatic'],['high','High – fine details'],['ultra','Ultra – within the resource budget'],['legacy','Earlier mesh-based / manual count']]);this.gaussianQuality.value='balanced';this.gaussianQuality.dataset.exportControl='gaussian-quality';
    conditional('Gaussian quality',this.gaussianQuality,()=>kind()==='gaussians');
    this.adaptive = this.el('input');this.adaptive.type='checkbox';this.adaptive.checked=true;
    conditional('Sample blocks + detail-protected simplification',this.adaptive,()=>this.mode.value==='legacy');

    this.resolution = this.el("select");
    for (const r of RESOLUTIONS) this.resolution.add(new Option(`${r} × ${r} × ${r}`, String(r)));
    this.resolution.value = "128";
    conditional('Resolution',this.resolution,()=>kind()!=='gaussians'||this.gaussianQuality.value==='legacy');

    this.center = [this.number("0"), this.number("0"), this.number("0")];
    const centreRow = this.row("Centre x, y, z", ...this.center);
    centreRow.className = "arow three";
    this.root.append(centreRow);

    this.half = this.number("1.6");
    this.half.min = "0.01";
    this.root.append(this.row("Half size", this.half));

    this.level = this.number("0", "0.1");
    this.level.min = "-3";
    this.level.max = "3";
    this.root.append(this.row("Thickness (cells)", this.level));

    this.format = this.el("select");
    this.format.add(new Option("glTF binary (.glb), recommended", "glb"));
    this.format.add(new Option("Wavefront OBJ (.obj)", "obj"));
    this.format.add(new Option("Stanford PLY (.ply)", "ply"));
    conditional('Mesh-format',this.format,()=>['geometry','legacy','mesh'].includes(kind()));
    this.volumeMode=select([['raw-field','Raw DE / field (no solid SDF guarantee)'],['surface-density','Density around the isosurface']]);
    conditional('Field content',this.volumeMode,()=>kind()==='volume');
    this.count=this.number('1000000','1000');this.count.min='1';this.count.max=String(MAX_GAUSSIAN_COUNT);this.count.dataset.exportControl='count';
    this.pointCount=this.number('20000','1000');this.pointCount.min='1';this.pointCount.max='1000000';
    conditional('Number of points',this.pointCount,()=>kind()==='points');

    this.colors = this.el("input");
    this.colors.type = "checkbox";
    this.colors.checked = true;
    this.colors.title = "Gives each vertex the colour of the surface from the gradient and the picture. Glb, ply and obj can all have colours.";
    this.root.append(this.row("With colours", this.colors));

    this.camera = this.el("input");
    this.camera.type = "checkbox";
    this.camera.title = "Puts the movement of the camera from the animation in the same glb file. Requires at least two keyframes.";
    conditional('With camera path (glb)',this.camera,()=>this.mode.value==='legacy');
    const advanced=this.el('details');advanced.append(this.el('summary',undefined,'Expert / Manual'));
    const maxRow=this.row('Max Gaussians (manual mode: exact count)',this.count);advanced.append(maxRow);this.conditional.push({element:maxRow,show:()=>kind()==='gaussians'});
    this.tolerance=this.number('','0.0001');this.tolerance.placeholder='Automatic';this.tolerance.min='0';this.tolerance.dataset.exportControl='tolerance';advanced.append(this.row('Geometric tolerance (world units)',this.tolerance));
    this.memory=this.number('512','64');this.memory.min='16';this.memory.max='32768';advanced.append(this.row('Working memory (MiB)',this.memory));
    this.fileBudget=this.number('1536','128');this.fileBudget.min='1';this.fileBudget.max='32768';advanced.append(this.row('File budget (MiB)',this.fileBudget));
    this.seed=this.number('42','1');this.seed.min='0';this.seed.max='4294967295';advanced.append(this.row('Sampling-seed',this.seed));
    this.normals=this.el('input');this.normals.type='checkbox';this.normals.checked=true;advanced.append(this.row('Point normals',this.normals));
    this.scale=this.number('1');this.scale.min='.25';this.scale.max='4';advanced.append(this.row('Global scale multiplier',this.scale));
    this.opacity=this.number('.98','.01');this.opacity.min='.01';this.opacity.max='.999';advanced.append(this.row('Gaussian opacity',this.opacity));
    this.opacityMode=select([['constant','Constant'],['coverage','Compensate for scale']]);advanced.append(this.row('Opacity behaviour',this.opacityMode));
    this.colorMode=select([['surface-color','Surface colour'],['constant','Constant white']]);advanced.append(this.row('Gaussian colour',this.colorMode));this.root.append(advanced);
    this.estimate=this.el('div','rstatus');this.estimate.dataset.exportEstimate='true';this.root.append(this.estimate);

    const buttons = this.el("div", "rbuttons");
    const fit = this.el("button", undefined, "Fetch area from the camera");
    fit.title = "Sets the centre and the size from what the camera is looking at";
    fit.addEventListener("click", () => this.handlers.onFit());
    this.exportButton = this.el("button", undefined, "Export");this.exportButton.dataset.exportAction='run';
    this.exportButton.addEventListener("click", () => this.handlers.onExport());
    this.cancel=this.el('button',undefined,'Cancel');this.cancel.disabled=true;this.cancel.addEventListener('click',()=>this.handlers.onCancel?.());
    buttons.append(fit, this.exportButton,this.cancel);
    this.root.append(buttons);

    this.status = this.el("div", "rstatus");
    this.root.append(this.status);
    this.root.addEventListener('input',()=>this.update());this.root.addEventListener('change',()=>this.update());this.update();
  }

  private update():void{
    for(const item of this.conditional){const visible=item.show();item.element.hidden=!visible;item.element.style.display=visible?'':'none';}
    const n=Number(this.resolution.value),points=n**3,kind=this.mode.value==='scene'?this.representation.value:this.mode.value;
    this.count.max=this.gaussianQuality.value==='legacy'?'1000000':String(MAX_GAUSSIAN_COUNT);
    if(kind==='gaussians'&&this.gaussianQuality.value!=='legacy'){
      try{const half=Number(this.half.value),center=this.center.map(c=>Number(c.value)),e=estimateAdaptiveGaussians({bounds:{min:center.map(v=>v-half) as [number,number,number],max:center.map(v=>v+half) as [number,number,number]},quality:this.gaussianQuality.value as GaussianQuality,maxCount:Number(this.count.value),detailTolerance:this.tolerance.value?Number(this.tolerance.value):undefined,memoryBudgetMiB:Number(this.memory.value),fileBudgetMiB:Number(this.fileBudget.value)});
       this.estimate.textContent=`Automatic density, at most ${e.maxCount.toLocaleString('en-US')} Gaussians. Base ${e.resolution}³, then local refinement; tolerance ${e.tolerance.toPrecision(3)}. File at most ${(e.maximumFileBytes/2**20).toFixed(0)} MiB, working buffers at most ${(e.workingBytes/2**20).toFixed(0)} MiB (process memory is added). The count depends on the geometry. `+(this.mode.value==='scene'?'The scene ZIP has a 256 MiB package budget.':'PLY is written directly to disk if possible; a buffered download is limited to 512 MiB.');
       this.estimate.textContent+=' Native Gaussian-import: Blender 5.3.';
      }catch{this.estimate.textContent='Check the area and the Gaussian budgets.';}return;
    }
    const file=kind==='volume'?points*5:kind==='gaussians'?Number(this.count.value)*248:kind==='points'?Number(this.count.value)*35:0;
    this.estimate.textContent=(file?`Data about ${(file/1048576).toFixed(1)} MiB. `:'Mesh size depends on the surface. ')+
      (kind==='volume'?`Buffers up to ${(file*2/1048576).toFixed(1)} MiB. `:`The final mesh arrays have an upper budget of about ${(Math.min(2000000,(n-1)**3)*108/1048576).toFixed(0)} MiB; sample blocks, JavaScript indices and encoding copies are added. `)+
      'At most 2 million mesh vertices, package 256 MiB. Pictures and materials are added.'+
      (kind==='gaussians'?' Native Blender import requires Gaussian support (5.3).':'')+
      (this.mode.value==='scene'?' Clipping/fog is saved as metadata; material and light are approximated.':'')+
      (this.mode.value==='legacy'?' One mesh file is downloaded.':' A ZIP package with relative paths is downloaded.');
  }

  /** Fills in the measured area. */
  setArea(center: [number, number, number], halfSize: number): void {
    center.forEach((v, i) => (this.center[i]!.value = String(Math.round(v * 1000) / 1000)));
    this.half.value = String(Math.round(halfSize * 1000) / 1000);
    this.update();
  }

  /** The settings as entered, or a text saying what is wrong. */
  settings(): { ok: true; value: MeshSettings } | { ok: false; error: string } {
    const center = this.center.map((c) => Number(c.value)) as [number, number, number];
    const halfSize = Number(this.half.value);
    const level = Number(this.level.value);
    if (!center.every(Number.isFinite)) return { ok: false, error: "The centre must be three numbers." };
    if (!(halfSize > 0) || !Number.isFinite(halfSize)) return { ok: false, error: "The half size must be a number above 0." };
    if (!Number.isFinite(level) || level < -3 || level > 3) return { ok: false, error: "The thickness must be a number between -3 and 3." };
    const format = this.format.value === "obj" || this.format.value === "ply" ? this.format.value : "glb";
    const kind=this.mode.value==='scene'?this.representation.value:this.mode.value;
    const count=Number(kind==='points'?this.pointCount.value:this.count.value),seed=Number(this.seed.value),scaleMultiplier=Number(this.scale.value),opacity=Number(this.opacity.value);
    if(!Number.isInteger(count)||count<1||count>(kind==='points'?1000000:MAX_GAUSSIAN_COUNT))return {ok:false,error:'Invalid count: at most 1000000 ordinary points; Gaussians are limited by the resource budget and Uint32 indices.'};
    if(kind==='gaussians'&&this.gaussianQuality.value==='legacy'&&count>1000000)return {ok:false,error:'Mesh-based sampling supports at most 1000000 points. Choose automatic Gaussian quality for a larger export.'};
    const detailTolerance=this.tolerance.value?Number(this.tolerance.value):undefined,memoryBudgetMiB=Number(this.memory.value),fileBudgetMiB=Number(this.fileBudget.value);
    if(detailTolerance!==undefined&&(!Number.isFinite(detailTolerance)||detailTolerance<=0)||!Number.isFinite(memoryBudgetMiB)||memoryBudgetMiB<16||memoryBudgetMiB>32768||!Number.isFinite(fileBudgetMiB)||fileBudgetMiB<1||fileBudgetMiB>32768)return {ok:false,error:'Invalid geometric tolerance or resource budget.'};
    if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)return {ok:false,error:'The seed must be an integer 0–4294967295.'};
    if(!Number.isFinite(scaleMultiplier)||scaleMultiplier<.25||scaleMultiplier>4||!(opacity>0&&opacity<.9999999))return {ok:false,error:'Gaussian scale must be 0.25–4 and opacity above 0 and below 0.9999999.'};
    return { ok: true, value: {mode:this.mode.value as MeshSettings['mode'],representation:this.representation.value as FractalRepresentation,gaussianQuality:this.gaussianQuality.value as GaussianQuality|'legacy',detailTolerance,memoryBudgetMiB,fileBudgetMiB,count,seed,withNormals:this.normals.checked,scaleMultiplier,opacity,opacityMode:this.opacityMode.value as 'constant'|'coverage',colorMode:this.colorMode.value as 'surface-color'|'constant',volumeMode:this.volumeMode.value as 'raw-field'|'surface-density', adaptive:this.adaptive.checked,resolution: Number(this.resolution.value), center, halfSize, level, format, includeCamera: this.camera.checked && format === "glb", withColors: this.colors.checked } };
  }

  setBusy(busy: boolean): void {
    this.exportButton.disabled = busy;
    this.cancel.disabled=!busy;
    for (const c of this.root.querySelectorAll('input,select'))(c as HTMLInputElement).disabled=busy;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }
}
