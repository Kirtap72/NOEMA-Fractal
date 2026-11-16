import { editRegion, gradientHit, measureLabel, sharedSurfaces } from "../engine/gradientPick";
import type { GradientHit, MeasureMap, RawMeasure, RegionEdit, SharedSurfaces } from "../engine/gradientPick";
import { withColor } from "../engine/scene";
import type { Scene } from "../engine/scene";
import type { AuditionEnd } from "./sceneSync";
import "./materialPickPanel.css";

export type SampleResult =
  | { ok: true; raw: RawMeasure; map: MeasureMap; at: { u: number; v: number } }
  | { ok: false; reason: string };

/** What the panel needs from the application. Nothing is written until Apply: everything shown goes through the scene's render-only audition. */
export interface MaterialPickHandlers {
  /** The authored scene (never the audition view). */
  scene(): Scene;
  /** The next click on the picture is delivered to `onClick` (client coordinates). Refuses, with a reason, when picking is not possible now. */
  arm(onClick: (clientX: number, clientY: number) => void): { ok: true } | { ok: false; reason: string };
  disarm(): void;
  /** The renderer's own gradient numbers at the clicked picture position, and a small map of the whole picture. */
  sample(clientX: number, clientY: number): Promise<SampleResult>;
  /** Shows `apply(scene)` render-only, tied to the colour (an edit of the colour elsewhere ends it). See SceneSync.setAudition. */
  begin(apply: (evaluated: Scene) => Scene, onEnd: (reason: AuditionEnd) => void): void;
  end(): void;
  touch(): void;
  /** The one undoable write. */
  commit(change: (scene: Scene) => Scene): void;
  /** Marks the stops and the position in the existing gradient editor (null removes the marks). */
  highlight(hit: { stops: { index: number; weight: number }[]; position: number } | null): void;
  busy(): boolean;
  undo(): boolean;
  canUndo(): boolean;
}

const pct = (v: number): string => `${Math.round(v * 100)} %`;
const num = (v: number): string => String(Number(v.toFixed(3)));

/**
 * ARTIST-WORKFLOW 05: "Material från bilden". The artist clicks a visible surface; the panel says which part of the GLOBAL material gradient that
 * surface uses (from the renderer's own numbers, never from the colour on screen), marks the contributing stops in the gradient editor, lets the
 * artist change those stops with an immediate preview, and shows how much of the visible surface shares that part of the gradient.
 * This edits the gradient that colours the whole fractal, not a local painted texture. Nothing is written before Apply (one undoable step).
 */
export class MaterialPickPanel {
  private details = document.createElement("details");
  private pickButton = document.createElement("button");
  private result = document.createElement("div");
  private info = document.createElement("p");
  private stopsText = document.createElement("p");
  private colorA = document.createElement("input");
  private colorB = document.createElement("input");
  private labelA = document.createElement("span");
  private labelB = document.createElement("span");
  private rowB = document.createElement("label");
  private transition = document.createElement("input");
  private transitionOut = document.createElement("output");
  private transitionRow = document.createElement("label");
  private map = document.createElement("canvas");
  private shared = document.createElement("p");
  private notes = document.createElement("p");
  private apply = document.createElement("button");
  private cancelButton = document.createElement("button");
  private undoButton = document.createElement("button");
  private status = document.createElement("small");
  private hit: GradientHit | null = null;
  private original: { a: string; b: string; transition: number } = { a: "#000000", b: "#000000", transition: 1 };
  private stopCount = 0;
  private armed = false;
  private writing = false;
  private onKey = (e: KeyboardEvent): void => { if (e.key === "Escape" && this.armed) { e.preventDefault(); this.stopArming("The surface pick was cancelled. The artwork is unchanged."); } };

  constructor(root: HTMLElement, private h: MaterialPickHandlers) {
    this.details.className = "material-pick";
    this.details.dataset.materialPick = "";
    this.details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "Material from the picture";
    const note = document.createElement("p");
    note.className = "material-pick-note";
    note.dataset.materialPickNote = "";
    note.textContent = "Click a surface in the picture to see which part of the global material gradient the surface uses. This changes the gradient that colours the whole fractal, not a locally painted texture: all surfaces that land on the same part of the gradient change together. The artwork is not changed until you press Use.";
    this.pickButton.type = "button";
    this.pickButton.textContent = "Pick a surface in the picture";
    this.pickButton.dataset.materialPickArm = "";
    this.pickButton.title = "Click here and then on a visible surface in the picture. Esc cancels.";
    this.pickButton.addEventListener("click", () => this.toggleArming());
    this.result.className = "material-pick-result";
    this.result.hidden = true;
    this.info.dataset.materialPickInfo = "";
    this.stopsText.dataset.materialPickStops = "";
    const colorRow = (label: HTMLSpanElement, input: HTMLInputElement, row: HTMLLabelElement, key: string): void => {
      input.type = "color";
      input.dataset[key] = "";
      row.className = "material-pick-row";
      row.append(label, input);
      input.addEventListener("input", () => this.trial());
    };
    colorRow(this.labelA, this.colorA, document.createElement("label"), "materialPickColorA");
    const rowA = this.colorA.parentElement as HTMLLabelElement;
    colorRow(this.labelB, this.colorB, this.rowB, "materialPickColorB");
    this.transitionRow.className = "material-pick-row";
    const tl = document.createElement("span");
    tl.textContent = "Transition width";
    this.transition.type = "range";
    this.transition.min = "0";
    this.transition.max = "100";
    this.transition.step = "1";
    this.transition.dataset.materialPickTransition = "";
    this.transition.title = "How wide the transition between the two stops is (100 % = the whole interval, lower = harder edge).";
    this.transitionRow.append(tl, this.transition, this.transitionOut);
    this.transition.addEventListener("input", () => { this.transitionOut.textContent = `${this.transition.value} %`; this.trial(); });
    this.map.className = "material-pick-map";
    this.map.dataset.materialPickMap = "";
    this.map.setAttribute("aria-label", "Which surfaces share the chosen part of the gradient");
    this.shared.dataset.materialPickShared = "";
    this.notes.dataset.materialPickNotes = "";
    const make = (b: HTMLButtonElement, text: string, title: string, key: string, run: () => void): void => {
      b.type = "button";
      b.textContent = text;
      b.title = title;
      b.dataset[key] = "";
      b.addEventListener("click", run);
    };
    make(this.apply, "Use", "Write the change to the material gradient as a single step. Undo brings back the original.", "materialPickApply", () => void this.applyEdit());
    make(this.cancelButton, "Cancel", "Discard the change and release the pick. The artwork is as it was.", "materialPickCancel", () => this.clear("Cancelled. The artwork is unchanged."));
    make(this.undoButton, "Undo", "Bring back the material gradient as it was before Use.", "materialPickUndo", () => void this.undo());
    this.undoButton.hidden = true;
    const buttons = document.createElement("div");
    buttons.className = "material-pick-buttons";
    buttons.append(this.apply, this.cancelButton);
    const undoRow = document.createElement("div");
    undoRow.className = "material-pick-buttons";
    undoRow.append(this.undoButton);
    this.result.append(this.info, this.stopsText, rowA, this.rowB, this.transitionRow, this.map, this.shared, this.notes, buttons);
    this.status.dataset.materialPickStatus = "";
    this.status.setAttribute("role", "status");
    this.details.append(summary, note, this.pickButton, this.result, undoRow, this.status);
    root.append(this.details);
  }

  // ---------- picking ----------
  private toggleArming(): void {
    if (this.armed) { this.stopArming("The surface pick was cancelled. The artwork is unchanged."); return; }
    if (this.h.busy()) { this.status.textContent = "Wait until the ongoing work is finished."; return; }
    // The pick looks at the authored artwork, so a running trial ends first (the original is back).
    this.h.end();
    this.h.touch();
    const armed = this.h.arm((x, y) => void this.pick(x, y));
    if (!armed.ok) { this.status.textContent = armed.reason; return; }
    this.armed = true;
    this.pickButton.setAttribute("aria-pressed", "true");
    this.pickButton.textContent = "Cancel surface pick";
    this.status.textContent = "Click a visible surface in the picture. Esc cancels.";
    document.addEventListener("keydown", this.onKey);
  }

  private stopArming(message: string): void {
    this.armed = false;
    this.h.disarm();
    document.removeEventListener("keydown", this.onKey);
    this.pickButton.setAttribute("aria-pressed", "false");
    this.pickButton.textContent = "Pick a surface in the picture";
    this.status.textContent = message;
  }

  private async pick(clientX: number, clientY: number): Promise<void> {
    this.armed = false;
    document.removeEventListener("keydown", this.onKey);
    this.pickButton.setAttribute("aria-pressed", "false");
    this.pickButton.textContent = "Pick a surface in the picture";
    this.status.textContent = "Reading the real surface…";
    let sample: SampleResult;
    try { sample = await this.h.sample(clientX, clientY); } catch (e) { this.status.textContent = "The surface pick failed: " + (e instanceof Error ? e.message : String(e)); return; }
    if (!sample.ok) { this.status.textContent = sample.reason + " Choose another surface or try again."; return; }
    const scene = this.h.scene();
    const res = gradientHit(scene.color, sample.raw);
    if (!res.ok) { this.status.textContent = res.reason; return; }
    this.show(scene, res.hit, sample);
  }

  private show(scene: Scene, hit: GradientHit, sample: Extract<SampleResult, { ok: true }>): void {
    this.hit = hit;
    const gradient = scene.color.gradient;
    this.stopCount = gradient.stops.length;
    const a = gradient.stops[hit.a]!, b = gradient.stops[hit.b]!;
    this.original = { a: a.color, b: b.color, transition: a.transition ?? 1 };
    this.info.textContent = `Measure: ${measureLabel(hit.measure)} · coordinate ${num(hit.coordinate)} · position ${pct(hit.position)} along the gradient${scene.color.wrap === "mirror" ? " (mirrored)" : ""}.`;
    const share = (i: number) => pct(hit.stops.find((s) => s.index === i)?.weight ?? 0);
    this.stopsText.textContent = hit.a === hit.b
      ? `The colour comes from colour stop ${hit.a + 1} (100 %). It is the end of the gradient: everything beyond it gets the same colour. The stop is marked in the gradient editor.`
      : `The colour is blended from colour stop ${hit.a + 1} (${share(hit.a)}) and colour stop ${hit.b + 1} (${share(hit.b)}). They are marked in the gradient editor.`;
    this.labelA.textContent = `Stop ${hit.a + 1} · ${share(hit.a)}`;
    this.labelB.textContent = `Stop ${hit.b + 1} · ${share(hit.b)}`;
    this.colorA.value = a.color;
    this.colorB.value = b.color;
    this.rowB.hidden = hit.a === hit.b;
    this.transitionRow.hidden = hit.a === hit.b || hit.a >= gradient.stops.length - 1;
    this.transition.value = String(Math.round((a.transition ?? 1) * 100));
    this.transitionOut.textContent = `${this.transition.value} %`;
    const shared = sharedSurfaces(scene.color, hit, sample.map);
    this.drawMap(shared, sample.map, sample.at);
    this.shared.textContent = shared.visible
      ? `${pct(shared.share)} of the visible surface shares this part of the gradient (yellow fields in the map) and changes together with the surface you chose.${shared.neighbours > 0 ? ` A further ${pct(shared.neighbours)} lies next to it and shares one of the stops (brown fields): it is partly affected.` : ""} The rest (grey) is not affected.`
      : "No visible surface to compare with.";
    const notes: string[] = [];
    if (hit.measure === "cavity") notes.push("The cavities measure depends on how many steps the ray needed, that is on the render quality: the position is exact for this preview but may differ slightly in the final picture.");
    const strength = scene.color.texture?.strength ?? 0;
    if (strength > 0) notes.push(`A picture is blended into the surface colour (${pct(strength)}): the gradient is only part of what you see.`);
    if (scene.color.gradient.stops.some((s) => s.material?.active)) notes.push("The gradient has material stops: metal, roughness and reflectivity follow the same gradient.");
    this.notes.textContent = notes.join(" ");
    this.notes.hidden = notes.length === 0;
    this.result.hidden = false;
    this.undoButton.hidden = true;
    this.h.highlight({ stops: hit.stops, position: hit.position });
    this.status.textContent = "Change the colours below: the picture shows the change directly. The artwork is only changed when you press Use.";
  }

  private drawMap(shared: SharedSurfaces, map: MeasureMap, at: { u: number; v: number }): void {
    this.map.width = map.width;
    this.map.height = map.height;
    const g = this.map.getContext("2d");
    if (!g) return;
    const image = g.createImageData(map.width, map.height);
    const palette: Record<number, [number, number, number]> = { 0: [16, 23, 34], 1: [89, 101, 122], 2: [255, 210, 94], 3: [170, 140, 70] };
    for (let i = 0; i < shared.mask.length; i++) {
      const c = palette[shared.mask[i]!]!;
      image.data.set([c[0], c[1], c[2], 255], i * 4);
    }
    g.putImageData(image, 0, 0);
    // the picked pixel
    const x = Math.round(at.u * map.width), y = Math.round(at.v * map.height);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.moveTo(x, y - 4); g.lineTo(x, y + 4);
    g.stroke();
  }

  // ---------- editing (a trial until Apply) ----------
  private edit(): RegionEdit {
    return { colorA: this.colorA.value, colorB: this.colorB.value, transition: Number(this.transition.value) / 100 };
  }

  private changed(): boolean {
    return this.colorA.value.toLowerCase() !== this.original.a.toLowerCase()
      || (!this.rowB.hidden && this.colorB.value.toLowerCase() !== this.original.b.toLowerCase())
      || (!this.transitionRow.hidden && Math.abs(Number(this.transition.value) / 100 - this.original.transition) > 1e-9);
  }

  /** Shows the edited gradient render-only; with nothing changed the original is simply shown. */
  private trial(): void {
    const hit = this.hit;
    if (!hit) return;
    if (!this.changed()) { this.h.end(); this.h.touch(); this.status.textContent = "No change yet."; return; }
    const edit = this.edit();
    const gradient = editRegion(this.h.scene().color.gradient, hit, edit);
    // A fresh function each time: the audition caches its result per input scene.
    this.h.begin((ev) => withColor(ev, { gradient }), (reason) => this.ended(reason));
    this.h.touch();
    this.status.textContent = "Preview: the artwork is unchanged until you press Use.";
  }

  private ended(reason: AuditionEnd): void {
    if (this.writing || !this.hit) return;
    if (reason === "scene-changed" || reason === "cleared") this.clear("The colour was changed elsewhere, so the surface pick was released. The artwork is as you left it.", false);
    else this.status.textContent = reason === "replaced" ? "The preview ended: another test was started. The artwork is unchanged." : "The preview ended. The artwork is unchanged.";
  }

  private clear(message: string, endTrial = true): void {
    if (endTrial) { this.h.end(); this.h.touch(); }
    this.hit = null;
    this.h.highlight(null);
    this.result.hidden = true;
    this.status.textContent = message;
  }

  private async applyEdit(): Promise<void> {
    const hit = this.hit;
    if (!hit) return;
    if (!this.changed()) { this.status.textContent = "Change something first, then you can use it."; return; }
    for (let i = 0; i < 20 && this.h.busy(); i++) { this.status.textContent = "Waiting for the ongoing work to finish…"; await new Promise((r) => setTimeout(r, 250)); }
    if (this.h.busy()) { this.status.textContent = "The engine is still busy. Try again in a moment."; return; }
    const scene = this.h.scene();
    if (scene.color.gradient.stops.length !== this.stopCount) { this.clear("The gradient was changed, so the change cannot be applied. Pick the surface again."); return; }
    const edit = this.edit();
    this.writing = true;
    try {
      this.h.end();
      this.h.commit((s) => withColor(s, { gradient: editRegion(s.color.gradient, hit, edit) }));
    } finally { this.writing = false; }
    this.hit = null;
    this.h.highlight(null);
    this.result.hidden = true;
    this.undoButton.hidden = false;
    this.status.textContent = "Applied to the global material gradient as one step. Undo brings back the original.";
  }

  private async undo(): Promise<void> {
    for (let i = 0; i < 20 && this.h.busy(); i++) await new Promise((r) => setTimeout(r, 250));
    if (this.h.canUndo() && this.h.undo()) { this.undoButton.hidden = true; this.status.textContent = "The original is back."; }
    else this.status.textContent = "Nothing to undo.";
  }
}
