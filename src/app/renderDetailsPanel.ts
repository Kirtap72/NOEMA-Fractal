import { BoxCutPanel, type BoxCutControls } from "./boxCutPanel";
import { readNumber, setInputValue, isNumericEditing } from './numericRange';
import { defaultClipPlane, defaultEdgeSoftening, MAX_CLIP_PLANES, readCutout, readDetails } from "../engine/renderDetails";
import type { Scene } from "../engine/scene";
import { alignClipPlane, type ClipAlignment } from "./clipPlaneGeometry";

/** Artist controls for persisted renderer tools; temporary viewport policy is independent. */
export class RenderDetailsPanel {
  private scene!: Scene;
  private boxPanel?: BoxCutPanel;
  private rows: HTMLInputElement[][] = [];
  private probes: Record<string, HTMLInputElement[]> = {};
  private planes = document.createElement("div");
  private note = document.createElement("div");
  private add = document.createElement("button");
  private create = document.createElement("button");
  private selected = 0;
  private visual = document.createElement("input");
  private edgeFields: HTMLInputElement[] = [];
  private qualityNote=document.createElement('p');
  constructor(cutout: HTMLElement, private detail: HTMLElement, private edit: (change: (s: Scene) => Scene) => void, private gizmo?: (index: number, visible: boolean) => void, boxControls?: BoxCutControls) {
    if(boxControls)this.boxPanel=new BoxCutPanel(cutout,boxControls);
    const title = (root: HTMLElement, text: string) => { const t = document.createElement("div"); t.className = "ctitle"; t.textContent = text; root.append(t); };
    title(cutout, "Cutout / open cut");
    const create = this.create; create.textContent = "Create a cut in the view";
    create.onclick = () => {
      if (this.scene.cutout.planes.length >= MAX_CLIP_PLANES) return;
      this.selected = this.scene.cutout.planes.length; this.visual.checked = true;
      this.edit(s => ({ ...s, cutout: { ...s.cutout, planes: [...s.cutout.planes, alignClipPlane(defaultClipPlane(), s.camera, "view")] } })); this.update(this.scene);
    };
    this.visual.type = "checkbox"; this.visual.setAttribute("aria-label", "Show clip tools in the view");
    const visualLabel = document.createElement("label"); visualLabel.textContent = "Show clip tools in the view"; visualLabel.append(this.visual);
    this.visual.onchange = () => this.update(this.scene);
    cutout.append(create, visualLabel);
    cutout.append(this.planes);
    const add = this.add; add.textContent = "Add a clip plane";
    add.onclick = () => { if (this.scene.cutout.planes.length < MAX_CLIP_PLANES) this.edit(s => ({ ...s, cutout: { ...s.cutout, planes: [...s.cutout.planes, defaultClipPlane()] } })); this.update(this.scene); };
    cutout.append(add, this.note);
    const hint = document.createElement("small"); hint.textContent = "Yellow handle: drag up/down for depth. Blue/green: rotate the plane. Shift gives fine control, Esc cancels. The arrow keys also work. Invert switches the kept side; the cut is open without a cap."; cutout.append(hint);
    title(detail, "Detail enhancement");
    for (const [key, name] of [["ao", "AO / contact shadows"], ["cavity", "Cavity / small recesses"]] as const) {
      const fields = [this.input(detail, `${name} on`, "checkbox"), this.input(detail, `${name} strength`, "range", 0, 1, 0.01), this.input(detail, `${name} radius`, "number", 0.000001, 1000, 0.001), this.input(detail, `${name} samples`, "number", 1, 32, 1)];
      if (key === 'cavity') fields.push(this.input(detail, `${name} detail contrast`, 'range', 0, 4, 0.05));
      this.probes[key] = fields;
      for (const field of fields) field.oninput = () => {
        const value = { enabled: fields[0]!.checked, strength: readNumber(fields[1]!), radius: readNumber(fields[2]!), samples: readNumber(fields[3]!), ...(key === 'cavity' ? { contrast: readNumber(fields[4]!) } : {}) };
        const errors: string[] = []; const parsed = readDetails({ ...this.scene.details, [key]: value }, errors);
        if (parsed) this.edit(s => ({ ...s, details: parsed }));
        field.setCustomValidity(errors.join("; "));
      };
      const preset = document.createElement("button"); preset.textContent = key === "ao" ? "Shape separation from this view" : "Detail lift from this view";
      preset.onclick = () => this.edit(s => { const distance = Math.hypot(...s.camera.position.map((v,i)=>v-s.camera.target[i]!)); return { ...s, details: { ...s.details, [key]: { ...s.details[key], enabled: true, strength: key === "ao" ? 0.8 : 0.65, radius: Math.max(1e-6,Math.min(1000,distance*(key === "ao" ? 0.3 : 0.035))), samples: key === "ao" ? 16 : 8 } } }; }); detail.append(preset);
      fields[1]!.title = key === "ao" ? "Wide contact shading; 0 = neutral, 1 = strong shape separation" : "Local contrast: darker recesses and brighter edges; 0 = neutral";
    }
    const hint2 = document.createElement("small"); hint2.textContent = "AO separates larger shapes and also affects part of the direct light. Cavity increases local contrast in small details. Radii in scene units; choose a considerably smaller radius for cavity. Explore pauses both temporarily."; detail.append(hint2);
    title(detail, 'Edge softening / shading bevel');
    const edge = this.edgeFields = [this.input(detail, 'Edge softening on', 'checkbox'), this.input(detail, 'Edge softening radius', 'number', 1e-6, 1000, 0.001), this.input(detail, 'Edge softening strength', 'range', 0, 1, 0.01), this.input(detail, 'Preserve fine details', 'checkbox')];
    for (const field of edge) field.oninput = () => {
      const value = { enabled: edge[0]!.checked, radius: readNumber(edge[1]!), strength: readNumber(edge[2]!), preserve_fine_detail: edge[3]!.checked };
      const errors: string[] = [], parsed = readDetails({ ...this.scene.details, edge_softening: value }, errors);
      field.setCustomValidity(errors.join('; ')); if (parsed) this.edit(s=>({ ...s, details: parsed }));
    };
    const hint3 = document.createElement('small'); hint3.textContent = 'Only softens the light normals around edges. Geometry and depth are not changed. Start with a small radius and strength; fine details limit the blending. Explore turns the effect off temporarily.'; detail.append(hint3);
    this.qualityNote.id='quality-appearance-note';detail.prepend(this.qualityNote);
  }
  setQualityProfile(profile:'legacy'|'geometry'|'native'){
    this.qualityNote.textContent=profile==='native'?'The native profile uses its own S5, AO start value and limited native visibility. The AO, cavity and shading bevel of NOEMA do not affect this cut-out.':profile==='geometry'?'AO and cavity are surface light. DS micro-normal and hard edges replace shading bevel in Geometry Detail; its saved values are preserved for the older render mode.':'AO, cavity and edge softening change the surface light, not the geometric hit.';
    for(const control of this.detail.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button')){
      const inactive=profile==='native'||(profile==='geometry'&&this.edgeFields.includes(control as HTMLInputElement));
      control.disabled=inactive;control.dataset.unavailableReason=inactive?this.qualityNote.textContent:'';
      if(inactive){control.dataset.originalQualityTitle??=control.title;control.title=this.qualityNote.textContent;}
      else if(control.dataset.originalQualityTitle!==undefined)control.title=control.dataset.originalQualityTitle;
    }
  }
  private input(root: HTMLElement, name: string, type: string, min?: number, max?: number, step?: number): HTMLInputElement {
    const label = document.createElement("label"); label.textContent = name;
    const input = document.createElement("input"); input.type = type; input.setAttribute("aria-label", name);
    if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max); if (step !== undefined) input.step = String(step);
    if (type === "number") input.style.width = "6rem";
    label.append(input); root.append(label); return input;
  }
  update(scene: Scene): void {
    this.scene = scene;
    this.boxPanel?.update(scene);
    this.note.textContent = "";
    this.add.disabled = scene.cutout.planes.length >= MAX_CLIP_PLANES;
    this.create.disabled = this.add.disabled;
    this.selected = Math.max(0, Math.min(this.selected, scene.cutout.planes.length - 1));
    if (this.rows.length !== scene.cutout.planes.length) {
      this.planes.replaceChildren(); this.rows = [];
      scene.cutout.planes.forEach((_, i) => {
        const row = document.createElement("fieldset"); const legend = document.createElement("legend"); legend.textContent = `Clip plane ${i + 1}`; row.append(legend);
        const enabled = this.input(row, `Plane ${i + 1} on`, "checkbox"), invert = this.input(row, `Plane ${i + 1} invert`, "checkbox");
        const numbers = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "Numeric values"; numbers.append(summary); row.append(numbers);
        const fields = [enabled, ...["X", "Y", "Z"].map(axis => this.input(numbers, `Plan ${i + 1} normal ${axis}`, "number", -1e6, 1e6, 0.01)), this.input(numbers, `Plan ${i + 1} offset`, "number", -1e6, 1e6, 0.01), invert];
        this.rows.push(fields);
        for (const field of fields) field.oninput = () => {
          const plane = { enabled: fields[0]!.checked, normal: fields.slice(1, 4).map(f => readNumber(f)), offset: readNumber(fields[4]!), invert: fields[5]!.checked };
          const errors: string[] = []; const parsed = readCutout({ ...this.scene.cutout, planes: this.scene.cutout.planes.map((p, j) => i === j ? plane : p) }, errors);
          this.note.textContent = errors.length ? "Enter a normal that is not zero and valid numbers." : "";
          if (parsed) this.edit(s => ({ ...s, cutout: parsed }));
        };
        const actions = document.createElement("div"); actions.className = "clip-actions"; row.append(actions);
        for (const [text, action] of [
          ["Reset", () => this.edit(s => ({ ...s, cutout: { ...s.cutout, planes: s.cutout.planes.map((p, j) => i === j ? defaultClipPlane() : p) } }))],
          ["Edit in the view", () => { this.selected = i; this.visual.checked = true; this.update(this.scene); }],
          ...([["Aim from the camera", "view"], ["From the left", "left"], ["From the right", "right"], ["From above", "top"], ["From the front", "front"]] as const).map(([name, alignment]) => [name, () => { this.selected = i; this.visual.checked = true; this.edit(s => ({ ...s, cutout: { ...s.cutout, planes: s.cutout.planes.map((p,j)=>i===j?alignClipPlane(p,s.camera,alignment as ClipAlignment):p) } })); }] as const),
          ["Remove", () => this.edit(s => ({ ...s, cutout: { ...s.cutout, planes: s.cutout.planes.filter((_, j) => j !== i) } }))],
        ] as const) { const b = document.createElement("button"); b.textContent = text; b.onclick = action; actions.append(b); }
        this.planes.append(row);
      });
    }
    const set = (f: HTMLInputElement, value: number | boolean) => { if (typeof value === "boolean") f.checked = value; else if (!isNumericEditing(f)) { setInputValue(f, value); f.setCustomValidity(""); } };
    scene.cutout.planes.forEach((p, i) => [p.enabled, ...p.normal, p.offset, p.invert].forEach((v, j) => set(this.rows[i]![j]!, v)));
    for (const [i, row] of [...this.planes.children].entries()) (row as HTMLElement).dataset.selected = String(i === this.selected && this.visual.checked);
    for (const key of ["ao", "cavity"] as const) { const p = scene.details[key]; [p.enabled, p.strength, p.radius, p.samples, ...(key === 'cavity' ? [scene.details.cavity.contrast ?? 1] : [])].forEach((v, j) => set(this.probes[key]![j]!, v)); }
    const edge = scene.details.edge_softening ?? defaultEdgeSoftening();
    [edge.enabled, edge.radius, edge.strength, edge.preserve_fine_detail].forEach((v,i)=>set(this.edgeFields[i]!,v));
    this.gizmo?.(this.selected, this.visual.checked);
  }
}
