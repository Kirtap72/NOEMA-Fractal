import { CUT_PRESETS, OPEN_CUT_NOTE, cutPlaneProblem, depthOfPlane, extentAlong, fallbackExtent, planeAtDepth, presetNormal, withCutPlane } from "../engine/cutbook";
import type { CutDiscovery, CutPresetId, Extent } from "../engine/cutbook";
import type { Vec3 } from "../engine/camera";
import type { ClipPlane } from "../engine/renderDetails";
import type { Scene } from "../engine/scene";
import { worldOf } from "./cameraPostcards";
import { CutbookStore } from "./cutbookStore";
import type { AuditionEnd } from "./sceneSync";
import "./cutbookPanel.css";

/** What the cutbook needs from the application. Exploring is a render-only audition; only Apply writes. */
export interface CutbookHandlers {
  /** The authored scene (never the audition view). */
  scene(): Scene;
  /** Points of the visible surface in world coordinates (x, y, z per point) from a small depth grid, or null when it cannot be read now. */
  samplePoints(): Promise<Float32Array | null>;
  /** Shows `apply(scene)` render-only, tied to the cutout. See SceneSync.setAudition. */
  begin(apply: (evaluated: Scene) => Scene, onEnd: (reason: AuditionEnd) => void): void;
  end(): void;
  touch(): void;
  /** Keeps the camera (and with it the light's relation to the view) still while exploring. */
  lock(on: boolean): void;
  /** The one undoable write. */
  commit(change: (scene: Scene) => Scene): void;
  /** A tiny WebP of what the viewport shows now (the trial included), or null when the engine is busy. */
  thumbnail(): Promise<string | null>;
  /** A small PNG of the same, for saving in "My fractals". */
  thumbnailPng(): Promise<string | null>;
  busy(): boolean;
  undo(): boolean;
  canUndo(): boolean;
  save?(scene: Scene, title: string, notes: string): Promise<string>;
  /** Where discoveries are kept; defaults to the browser's local storage. */
  store?: CutbookStore;
}

const pct = (v: number): string => `${Math.round(v * 100)} %`;
const same = (a: ClipPlane, b: ClipPlane): boolean => a.invert === b.invert && Math.abs(a.offset - b.offset) < 1e-9 && a.normal.every((v, i) => Math.abs(v - b.normal[i]!) < 1e-9);
let counter = 0;
const newId = (): string => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * ARTIST-WORKFLOW 06: "Undersök insidan". One open clipping plane is moved through the fractal with a slider while camera and light stay fixed; the
 * viewport follows at once (the existing preview, as a render-only audition) and refines when the slider is let go. Interesting depths are kept as small
 * named discoveries in a visual strip that can be revisited, compared with the original and applied. The artwork is changed only by Använd (one undo step).
 * It is an open cut, not a solid cross-section: nothing is capped, and the panel says so.
 */
export class CutbookPanel {
  private details = document.createElement("details");
  private presetSelect = document.createElement("select");
  private invertBox = document.createElement("input");
  private slider = document.createElement("input");
  private readout = document.createElement("div");
  private strip = document.createElement("div");
  private compare = document.createElement("button");
  private previousButton = document.createElement("button");
  private saveButton = document.createElement("button");
  private applyButton = document.createElement("button");
  private cancelButton = document.createElement("button");
  private undoButton = document.createElement("button");
  private sceneButton = document.createElement("button");
  private status = document.createElement("small");
  private store: CutbookStore;
  private exploring = false;
  private starting: Promise<boolean> | null = null;
  private live = false;
  private showOriginal = false;
  private plane: ClipPlane = { enabled: true, normal: [0, 1, 0], offset: 0, invert: false };
  private trail: ClipPlane[] = [];
  private points: Float32Array | null = null;
  private extents = new Map<string, Extent>();
  private originalThumb?: string;
  private world = "";
  private pendingDepth: number | null = null;
  private frame = 0;
  private token = 0;
  private busyThumb = false;

  constructor(root: HTMLElement, private h: CutbookHandlers) {
    this.store = h.store ?? new CutbookStore();
    this.details.className = "cutbook";
    this.details.dataset.cutbook = "";
    const summary = document.createElement("summary");
    summary.textContent = "Inspect the inside";
    const note = document.createElement("p");
    note.className = "cutbook-note";
    note.dataset.cutbookNote = "";
    note.textContent = OPEN_CUT_NOTE;

    const direction = document.createElement("label");
    direction.className = "cutbook-row";
    const dl = document.createElement("span");
    dl.textContent = "Direction";
    for (const p of CUT_PRESETS) this.presetSelect.add(new Option(p.label, p.id));
    this.presetSelect.add(new Option("Custom (from a find)", "custom"));
    this.presetSelect.dataset.cutbookPreset = "";
    this.presetSelect.setAttribute("aria-label", "Direction of the clip plane");
    this.presetSelect.addEventListener("change", () => this.presetChanged());
    direction.append(dl, this.presetSelect);

    const side = document.createElement("label");
    side.className = "cutbook-row";
    const sl = document.createElement("span");
    sl.textContent = "Switch side";
    this.invertBox.type = "checkbox";
    this.invertBox.dataset.cutbookInvert = "";
    this.invertBox.title = "Keep the other side of the plane.";
    this.invertBox.addEventListener("change", () => this.presetChanged(true));
    side.append(sl, this.invertBox);

    const depth = document.createElement("label");
    depth.className = "cutbook-row";
    const dpl = document.createElement("span");
    dpl.textContent = "Cut depth";
    this.slider.type = "range";
    this.slider.min = "0";
    this.slider.max = "100";
    this.slider.step = "0.5";
    this.slider.value = "0";
    this.slider.dataset.cutbookDepth = "";
    this.slider.setAttribute("aria-label", "Cut depth: how far the clip plane has gone through the fractal");
    this.slider.title = "0 % = nothing cut away, 100 % = everything cut away.";
    this.slider.addEventListener("input", () => this.depthInput());
    this.slider.addEventListener("change", () => this.gestureEnd());
    depth.append(dpl, this.slider);

    this.readout.className = "cutbook-readout";
    this.readout.dataset.cutbookReadout = "";
    this.readout.setAttribute("role", "status");
    this.strip.className = "cutbook-strip";
    this.strip.dataset.cutbookStrip = "";

    const make = (b: HTMLButtonElement, text: string, title: string, key: string, run: () => void): void => {
      b.type = "button";
      b.textContent = text;
      b.title = title;
      b.dataset[key] = "";
      b.addEventListener("click", run);
    };
    make(this.saveButton, "Save find", "Save this position as a find with a name of its own and a small picture.", "cutbookSave", () => void this.saveDiscovery());
    make(this.compare, "Show original", "Switch in the view between the original and the cut.", "cutbookCompare", () => this.toggleOriginal());
    this.compare.setAttribute("aria-pressed", "false");
    make(this.previousButton, "Previous position", "Go back to the previous position (and forward again).", "cutbookPrevious", () => this.goPrevious());
    make(this.applyButton, "Use", "Put the clip plane into the artwork as a single step. Undo removes it again.", "cutbookApply", () => void this.apply());
    make(this.cancelButton, "Cancel", "Stop inspecting. The artwork is as it was and the camera is free again.", "cutbookCancel", () => this.cancel("Cancelled. The artwork is unchanged and the camera is free again."));
    make(this.undoButton, "Undo", "Remove the clip plane that was added with Use.", "cutbookUndo", () => void this.undo());
    make(this.sceneButton, "Save scene", "Save this position as a scene of its own in My fractals without changing the artwork.", "cutbookSaveScene", () => void this.saveScene());
    this.undoButton.hidden = true;
    if (!h.save) this.sceneButton.hidden = true;
    const row1 = document.createElement("div");
    row1.className = "cutbook-buttons";
    row1.append(this.saveButton, this.compare, this.previousButton);
    const row2 = document.createElement("div");
    row2.className = "cutbook-buttons";
    row2.append(this.applyButton, this.cancelButton, this.undoButton, this.sceneButton);
    this.status.dataset.cutbookStatus = "";
    this.status.setAttribute("role", "status");
    this.details.append(summary, note, direction, side, depth, this.readout, row1, this.strip, row2, this.status);
    root.append(this.details);
    this.details.addEventListener("toggle", () => { if (!this.details.open && this.exploring) this.cancel("Closed. The artwork is unchanged and the camera is free again."); });
    this.world = worldOf(h.scene());
    this.draw();
  }

  // ---------- the fractal this cutbook shows ----------
  /** Called by the application when the scene may have changed (a file opened, Undo, ...). Does nothing while exploring. */
  update(): void {
    if (this.exploring) return;
    const world = worldOf(this.h.scene());
    if (world !== this.world) { this.world = world; this.originalThumb = undefined; this.trail = []; this.points = null; this.extents.clear(); }
    this.draw();
  }

  // ---------- starting and moving ----------
  private normalOf(id: string): Vec3 { return id === "custom" ? this.plane.normal : presetNormal(id as CutPresetId, this.h.scene()); }

  private extentFor(normal: Vec3): Extent {
    const key = normal.map((v) => v.toFixed(6)).join(",");
    let e = this.extents.get(key);
    if (!e) {
      e = (this.points ? extentAlong(this.points, normal) : null) ?? fallbackExtent(this.h.scene(), normal);
      this.extents.set(key, e);
    }
    return e;
  }

  /** Reads the visible fractal once, locks the camera, takes the picture of the original and shows the first position. */
  private start(): Promise<boolean> {
    if (this.exploring && this.live) return Promise.resolve(true);
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (this.h.busy()) { this.status.textContent = "Wait until the ongoing work is finished."; return false; }
      const scene = this.h.scene();
      const problem = cutPlaneProblem(scene);
      if (problem) { this.status.textContent = problem; return false; }
      this.h.end();
      this.points = await this.h.samplePoints().catch(() => null);
      this.extents.clear();
      if (!this.points) this.status.textContent = "The extent of the fractal could not be measured right now; an estimate is used.";
      const t = ++this.token;
      // The viewport still shows the original here: one small picture of it for the strip, then the first position (never longer than 1.5 s).
      if (!this.originalThumb) {
        const timeout = new Promise<null>((r) => setTimeout(() => r(null), 1500));
        const thumb = await Promise.race([this.h.thumbnail().catch(() => null), timeout]);
        if (t === this.token && thumb) this.originalThumb = thumb;
      }
      if (t !== this.token) return false;
      this.exploring = true;
      this.live = true;
      this.showOriginal = false;
      this.compare.setAttribute("aria-pressed", "false");
      this.undoButton.hidden = true;
      this.h.lock(true);
      this.details.classList.add("cutbook-exploring");
      this.status.textContent = "The camera and the light are locked. The artwork is unchanged until you press Use.";
      this.push();
      this.draw();
      return true;
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  private setPlaneFromSlider(depth: number): void {
    const normal = this.plane.normal;
    this.plane = planeAtDepth(normal, this.plane.invert, this.extentFor(normal), depth);
  }

  private presetChanged(sideOnly = false): void {
    const id = this.presetSelect.value;
    const preset = CUT_PRESETS.find((p) => p.id === id);
    const invert = sideOnly ? this.invertBox.checked : preset?.invert ?? this.invertBox.checked;
    if (!sideOnly && preset) this.invertBox.checked = invert;
    const normal = this.normalOf(id);
    this.plane = { enabled: true, normal, offset: this.plane.offset, invert };
    // The same depth of cut, in the new direction.
    this.setPlaneFromSlider(Number(this.slider.value) / 100);
    if (this.exploring) { this.push(); this.draw(); }
    else this.draw();
  }

  private depthInput(): void {
    this.pendingDepth = Number(this.slider.value) / 100;
    void this.start().then((ok) => { if (ok) this.schedule(); else { this.slider.value = "0"; this.pendingDepth = null; } });
  }

  /** One update per animation frame; the newest position wins and older ones are dropped. */
  private schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.flushPending(); });
  }

  private flushPending(): void {
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    const d = this.pendingDepth;
    this.pendingDepth = null;
    if (d === null || !this.exploring) return;
    this.showOriginal = false;
    this.compare.setAttribute("aria-pressed", "false");
    this.setPlaneFromSlider(d);
    this.push();
    this.draw();
  }

  private gestureEnd(): void {
    this.flushPending();
    if (!this.exploring) return;
    this.remember();
    this.h.touch(); // the artist let go: the viewport refines
    this.status.textContent = "Refining the picture…";
  }

  private remember(): void {
    const last = this.trail[this.trail.length - 1];
    if (!last || !same(last, this.plane)) { this.trail.push({ ...this.plane, normal: [...this.plane.normal] as Vec3 }); if (this.trail.length > 8) this.trail.shift(); }
  }

  /** Shows the plane (or the original) in the viewport. A fresh function each time: the audition caches its result per input scene. */
  private push(): void {
    if (!this.exploring || !this.live) return;
    if (this.showOriginal) { this.h.end(); this.h.touch(); return; }
    const plane = { ...this.plane, normal: [...this.plane.normal] as Vec3 };
    this.h.begin((ev) => withCutPlane(ev, plane), (reason) => this.ended(reason));
    this.h.touch();
  }

  private ended(reason: AuditionEnd): void {
    if (!this.exploring) return;
    this.exploring = false;
    this.live = false;
    this.h.lock(false);
    this.details.classList.remove("cutbook-exploring");
    this.status.textContent = reason === "replaced" ? "The inspection ended: another test was started. The artwork is unchanged." : reason === "scene-changed" ? "The clipping was changed elsewhere, so the inspection ended. The artwork is as you left it." : "The inspection ended. The artwork is unchanged.";
    this.draw();
  }

  private toggleOriginal(): void {
    if (!this.exploring) return;
    this.showOriginal = !this.showOriginal;
    this.compare.setAttribute("aria-pressed", String(this.showOriginal));
    this.push();
    this.status.textContent = this.showOriginal ? "The view shows the original (no cut)." : "The view shows the cut.";
  }

  private goPrevious(): void {
    if (!this.exploring || this.trail.length < 2) { this.status.textContent = "There is no previous position yet."; return; }
    // Swap: the present position becomes the "previous" one, so the button toggles between the last two.
    const present = this.trail.pop()!;
    const target = this.trail.pop()!;
    this.trail.push(present, target);
    this.go(target);
  }

  private go(plane: ClipPlane): void {
    this.plane = { enabled: true, normal: [...plane.normal] as Vec3, offset: plane.offset, invert: plane.invert };
    const match = CUT_PRESETS.find((p) => presetNormal(p.id, this.h.scene()).every((v, i) => Math.abs(v - this.plane.normal[i]!) < 1e-6) && p.invert === this.plane.invert);
    this.presetSelect.value = match ? match.id : "custom";
    this.invertBox.checked = this.plane.invert;
    this.showOriginal = false;
    this.compare.setAttribute("aria-pressed", "false");
    this.push();
    this.draw();
  }

  // ---------- discoveries ----------
  private async saveDiscovery(): Promise<void> {
    if (!this.exploring) { this.status.textContent = "Move the cut first, then you can save a find."; return; }
    if (this.busyThumb) return;
    this.busyThumb = true;
    this.flushPending();
    try {
      const thumb = await this.waitForThumb();
      const count = this.store.list(this.world).length;
      const d: CutDiscovery = { id: newId(), name: `Fynd ${count + 1}`, normal: [...this.plane.normal] as Vec3, offset: this.plane.offset, invert: this.plane.invert, world: this.world, ...(thumb ? { thumb } : {}) };
      if (!this.store.add(d)) { this.status.textContent = "The find could not be saved in this browser."; return; }
      this.remember();
      this.status.textContent = `${d.name} saved. Give it a name of its own in the list.`;
      this.draw();
    } finally { this.busyThumb = false; }
  }

  private async waitForThumb(): Promise<string | null> {
    for (let i = 0; i < 6; i++) {
      if (!this.h.busy()) { const t = await this.h.thumbnail().catch(() => null); if (t) return t; }
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  }

  private visit(d: CutDiscovery): void {
    void this.start().then((ok) => { if (!ok) return; this.go({ enabled: true, normal: d.normal, offset: d.offset, invert: d.invert }); this.remember(); this.status.textContent = `${d.name}.`; });
  }

  // ---------- apply, cancel, undo, save ----------
  private async apply(): Promise<void> {
    if (!this.exploring) { this.status.textContent = "Inspect first: move the cut depth."; return; }
    this.flushPending();
    for (let i = 0; i < 20 && this.h.busy(); i++) { this.status.textContent = "Waiting for the ongoing work to finish…"; await new Promise((r) => setTimeout(r, 250)); }
    if (this.h.busy()) { this.status.textContent = "The engine is still busy. Try again in a moment."; return; }
    const plane = { ...this.plane, normal: [...this.plane.normal] as Vec3 };
    const problem = cutPlaneProblem(this.h.scene());
    if (problem) { this.cancel(problem); return; }
    this.exploring = false;
    this.live = false;
    this.token++;
    this.h.end();
    this.h.lock(false);
    this.h.commit((s) => withCutPlane(s, plane));
    this.details.classList.remove("cutbook-exploring");
    this.undoButton.hidden = false;
    this.originalThumb = undefined;
    this.slider.value = "0";
    this.status.textContent = "The clip plane is now in the artwork as a step (an open cut). Undo removes it again.";
    this.draw();
  }

  private cancel(message: string): void {
    this.token++;
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    this.pendingDepth = null;
    if (this.exploring || this.live) { this.exploring = false; this.live = false; this.h.end(); this.h.touch(); }
    this.h.lock(false);
    this.details.classList.remove("cutbook-exploring");
    this.slider.value = "0";
    this.status.textContent = message;
    this.draw();
  }

  private async undo(): Promise<void> {
    for (let i = 0; i < 20 && this.h.busy(); i++) await new Promise((r) => setTimeout(r, 250));
    if (this.h.canUndo() && this.h.undo()) { this.undoButton.hidden = true; this.originalThumb = undefined; this.status.textContent = "The original is back."; this.draw(); }
    else this.status.textContent = "Nothing to undo.";
  }

  private async saveScene(): Promise<void> {
    if (!this.exploring || !this.h.save) { this.status.textContent = "Inspect first: move the cut depth."; return; }
    this.flushPending();
    const scene = withCutPlane(this.h.scene(), this.plane);
    this.sceneButton.disabled = true;
    try {
      const png = await this.h.thumbnailPng();
      if (!png) { this.status.textContent = "The engine is busy. Try again in a moment."; return; }
      const id = await this.h.save(scene, `Cut · ${pct(depthOfPlane(this.plane, this.extentFor(this.plane.normal)))}`, JSON.stringify({ cutbook: { normal: this.plane.normal, offset: this.plane.offset, invert: this.plane.invert, note: "open clip plane, not a filled cross-section" } }));
      this.status.textContent = `Saved as a scene of its own in My fractals (${id.slice(0, 8)}). The artwork is unchanged.`;
    } catch (e) { this.status.textContent = "Could not save: " + (e instanceof Error ? e.message : String(e)); } finally { this.sceneButton.disabled = false; }
  }

  // ---------- drawing ----------
  private draw(): void {
    const on = this.exploring;
    for (const b of [this.saveButton, this.compare, this.applyButton, this.cancelButton, this.sceneButton]) b.disabled = !on;
    this.previousButton.disabled = !on || this.trail.length < 2;
    const extent = this.extentFor(this.plane.normal);
    const depth = depthOfPlane(this.plane, extent);
    if (document.activeElement !== this.slider || !on) this.slider.value = String(Math.round(depth * 200) / 2);
    this.readout.textContent = on
      ? `Open cut ${pct(depth)}${this.showOriginal ? " · showing the original" : ""} · plane ${this.plane.normal.map((v) => Number(v.toFixed(2))).join(", ")} at ${Number(this.plane.offset.toFixed(3))}${this.plane.invert ? " (other side kept)" : ""}`
      : "Move the cut depth to begin. The clip plane is an open cut.";
    this.strip.replaceChildren();
    const items = this.store.list(this.world);
    this.strip.hidden = !items.length && !this.originalThumb;
    const card = (img: string | undefined, label: string, click: () => void, key: string): HTMLElement => {
      const wrap = document.createElement("div");
      wrap.className = "cutbook-card";
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.cutbookCard = key;
      b.title = key === "original" ? "The original (no cut)." : "Go to this find.";
      if (img) { const i = document.createElement("img"); i.src = img; i.alt = ""; b.append(i); } else b.append(Object.assign(document.createElement("span"), { textContent: "…" }));
      b.addEventListener("click", click);
      wrap.append(b);
      return wrap;
    };
    if (this.originalThumb) {
      const w = card(this.originalThumb, "Original", () => { void this.start().then((ok) => { if (ok && !this.showOriginal) this.toggleOriginal(); }); }, "original");
      w.append(Object.assign(document.createElement("small"), { textContent: "Original" }));
      this.strip.append(w);
    }
    for (const d of items) {
      const w = card(d.thumb, d.name, () => this.visit(d), d.id);
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 40;
      name.value = d.name;
      name.setAttribute("aria-label", "Name of the find");
      name.dataset.cutbookName = d.id;
      name.addEventListener("change", () => { this.store.rename(d.id, name.value); this.draw(); });
      const x = document.createElement("button");
      x.type = "button";
      x.className = "cutbook-remove";
      x.textContent = "×";
      x.setAttribute("aria-label", "Delete " + d.name);
      x.addEventListener("click", () => { this.store.remove(d.id); this.draw(); });
      w.append(name, x);
      this.strip.append(w);
    }
  }
}
