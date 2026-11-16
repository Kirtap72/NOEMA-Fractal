import { MAX_PINS, PinList, RANGE_SCALE_LIMITS, clampScale, compatiblePair, landscapeControls, landscapeKeepsShader, positionOf, valueAt, withLandscape } from "../engine/parameterLandscape";
import type { LandscapeAxis, LandscapeControl } from "../engine/parameterLandscape";
import type { Formula } from "../engine/formula/types";
import type { Scene } from "../engine/scene";
import type { AuditionEnd } from "./sceneSync";
import "./parameterLandscape.css";

/** What the landscape needs from the application. Everything it shows goes through the scene's render-only audition: the artwork is never written until Apply. */
export interface LandscapeHandlers {
  /** The authored scene (never the audition view). */
  scene(): Scene;
  formulas(): readonly Formula[];
  /** Shows `apply(scene)` render-only; calling it again with the same owner replaces the view without ending it. See SceneSync.setAudition. */
  begin(apply: (evaluated: Scene) => Scene, onEnd: (reason: AuditionEnd) => void): void;
  /** Removes the render-only layer: the original is back. */
  end(): void;
  /** Tells the viewport that the artist is interacting (the fast preview runs while moving and refines when it stops). */
  touch(): void;
  /** Keeps the fast interactive preview running between mouse events while the point is held, and lets the viewport refine when it is let go. */
  hold?(on: boolean): void;
  /** The one undoable write. */
  commit(change: (scene: Scene) => Scene): void;
  /** A small picture of what the viewport shows now (WebP data URL), or null when the engine is busy. */
  thumbnail(): Promise<string | null>;
  busy(): boolean;
  undo(): boolean;
  canUndo(): boolean;
  /** Saves a scene in "My fractals" with a picture of the current view. Optional. */
  save?(scene: Scene, title: string, notes: string): Promise<string>;
}

interface PinPicture { thumb?: string }

const fmt = (v: number): string => String(Number(v.toPrecision(4)));

/**
 * ARTIST-WORKFLOW 03: the parameter landscape. A flat map whose two axes are two continuous parameters of the current fractal; the centre is the
 * scene as it is. Dragging moves the two parameters, the viewport follows through the existing fast preview and refines when the artist stops.
 *
 * Nothing is written while exploring: the moved scene is a render-only layer (SceneSync audition). Apply writes the two values as ONE undoable step,
 * Cancel and closing the panel put the original back, Reset returns to the centre. Pins keep positions to compare, revisit, apply or save.
 */
export class ParameterLandscapePanel {
  private details = document.createElement("details");
  private xSel = document.createElement("select");
  private ySel = document.createElement("select");
  private xRange = document.createElement("input");
  private yRange = document.createElement("input");
  private pad = document.createElement("div");
  private dot = document.createElement("div");
  private readout = document.createElement("div");
  private status = document.createElement("small");
  private pinBox = document.createElement("div");
  private compare = document.createElement("button");
  private buttons: Record<"pin" | "reset" | "cancel" | "apply" | "undo" | "save", HTMLButtonElement>;
  private controls: LandscapeControl[] = [];
  private controlsKey = "";
  private ax?: LandscapeAxis;
  private ay?: LandscapeAxis;
  private exploring = false;
  private showOriginal = false;
  private vx = 0;
  private vy = 0;
  private pins = new PinList<PinPicture>(MAX_PINS);
  private originalThumb?: string;
  private pending: { px: number; py: number } | null = null;
  private frame = 0;
  private dragging = false;
  /** False until the picture of the original is taken: the first preview waits for it, because the first move would change what the viewport shows. */
  private live = false;
  /** Counts what the artist asked for; a picture that arrives for an older position is not used. */
  private token = 0;

  constructor(root: HTMLElement, private h: LandscapeHandlers) {
    this.details.className = "landscape";
    this.details.dataset.landscape = "";
    const summary = document.createElement("summary");
    summary.textContent = "Parameter landscape";
    summary.title = "Explore two parameters on a surface: drag the point and watch the shape change. Nothing is written until you press Use.";
    const note = document.createElement("small");
    note.textContent = "The centre is the scene as it is. Drag to explore. Nothing changes in the artwork until you press Use.";
    this.details.append(summary, note);

    const selects = document.createElement("div");
    selects.className = "landscape-selects";
    for (const [label, sel, range] of [["Horizontal (X)", this.xSel, this.xRange], ["Vertical (Y)", this.ySel, this.yRange]] as const) {
      const row = document.createElement("label");
      row.className = "landscape-row";
      const name = document.createElement("span");
      name.textContent = label;
      sel.setAttribute("aria-label", "Parameter " + label);
      sel.dataset.landscapeAxis = label.includes("X") ? "x" : "y";
      range.type = "range";
      range.min = String(RANGE_SCALE_LIMITS[0]);
      range.max = String(RANGE_SCALE_LIMITS[1]);
      range.step = "0.05";
      range.value = "1";
      range.title = "How far the surface reaches in this direction (1 = normal).";
      range.setAttribute("aria-label", "Reach " + label);
      range.dataset.landscapeRange = label.includes("X") ? "x" : "y";
      row.append(name, sel, range);
      selects.append(row);
      sel.addEventListener("change", () => this.axesChanged());
      range.addEventListener("input", () => this.rangeChanged());
    }

    this.pad.className = "landscape-pad";
    this.pad.dataset.landscapePad = "";
    this.pad.tabIndex = 0;
    this.pad.setAttribute("role", "application");
    this.pad.setAttribute("aria-label", "Parameter landscape: drag or use the arrow keys. The centre is the original.");
    this.dot.className = "landscape-dot";
    this.dot.dataset.landscapeDot = "";
    this.pad.append(this.dot);
    this.readout.className = "landscape-readout";
    this.readout.dataset.landscapeReadout = "";
    this.readout.setAttribute("role", "status");
    this.status.dataset.landscapeStatus = "";
    this.status.setAttribute("role", "status");

    const make = (text: string, title: string, key: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.title = title;
      b.dataset.landscapeButton = key;
      b.addEventListener("click", run);
      return b;
    };
    this.buttons = {
      pin: make("Pin", "Save this position as a pin to compare with and return to.", "pin", () => this.pin()),
      reset: make("Reset", "Back to the centre (the original). The pins remain.", "reset", () => this.reset()),
      cancel: make("Cancel", "Stop exploring. The artwork is as it was.", "cancel", () => this.cancel("Cancelled. The artwork is unchanged.")),
      apply: make("Use", "Write the two values to the artwork as a single step. Undo brings back the original.", "apply", () => this.apply()),
      undo: make("Undo", "Bring back the artwork as it was before Use.", "undo", () => this.undo()),
      save: make("Save find", "Save this position in My fractals without changing the artwork.", "save", () => void this.save()),
    };
    this.buttons.undo.hidden = true;
    if (!h.save) this.buttons.save.hidden = true;
    this.compare.type = "button";
    this.compare.textContent = "Show original";
    this.compare.title = "Switch between the original and the position you are at.";
    this.compare.dataset.landscapeCompare = "";
    this.compare.setAttribute("aria-pressed", "false");
    this.compare.addEventListener("click", () => this.toggleOriginal());
    const row1 = document.createElement("div");
    row1.className = "landscape-buttons";
    row1.append(this.buttons.pin, this.compare, this.buttons.reset);
    const row2 = document.createElement("div");
    row2.className = "landscape-buttons";
    row2.append(this.buttons.apply, this.buttons.cancel, this.buttons.undo, this.buttons.save);
    this.pinBox.className = "landscape-pins";
    this.pinBox.dataset.landscapePins = "";
    this.details.append(selects, this.pad, this.readout, row1, this.pinBox, row2, this.status);
    root.append(this.details);

    // Pointer: the newest position wins. Moves are coalesced to one per animation frame, and what was not yet shown is dropped.
    this.pad.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.ensureExploring()) return;
      this.dragging = true;
      this.h.hold?.(true);
      this.pad.setPointerCapture(e.pointerId);
      this.fromPointer(e);
      this.flushPending();
      e.preventDefault();
    });
    this.pad.addEventListener("pointermove", (e) => { if (this.dragging) this.fromPointer(e); });
    const stop = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.fromPointer(e);
      this.flushPending(); // the last position is always shown
      this.h.hold?.(false);
      this.h.touch(); // the artist stopped: the viewport refines
      this.setStatus("Refining the picture…");
      if (this.pad.hasPointerCapture(e.pointerId)) this.pad.releasePointerCapture(e.pointerId);
    };
    this.pad.addEventListener("pointerup", stop);
    this.pad.addEventListener("pointercancel", stop);
    this.pad.addEventListener("keydown", (e) => this.key(e));
    this.details.addEventListener("toggle", () => {
      if (this.details.open) { this.refresh(); this.captureOriginal(); }
      else if (this.exploring) this.cancel("Closed. The artwork is unchanged.");
    });
    // Another scene may have been opened since: the list is made again when the artist comes back to the panel.
    this.details.addEventListener("pointerenter", () => this.refresh());
    this.details.addEventListener("focusin", () => this.refresh());
    this.refresh();
    this.drawDot();
    this.drawPins();
  }

  // ---------- the controls ----------
  /** The list of parameters of the scene as it is now; keeps the selection when the same parameters are still there. */
  private refresh(): void {
    if (this.exploring) return;
    this.controls = landscapeControls(this.h.scene(), this.h.formulas());
    const key = this.controls.map((c) => c.key).join("|");
    if (key !== this.controlsKey) {
      const wantX = this.xSel.value, wantY = this.ySel.value;
      this.controlsKey = key;
      for (const sel of [this.xSel, this.ySel]) {
        sel.replaceChildren();
        for (const c of this.controls) sel.add(new Option(c.label + (c.reviewed ? "" : " (ej granskad)"), c.key));
      }
      this.xSel.value = this.controls.some((c) => c.key === wantX) ? wantX : this.controls[0]?.key ?? "";
      this.ySel.value = this.controls.some((c) => c.key === wantY) && wantY !== this.xSel.value ? wantY : this.controls.find((c) => c.key !== this.xSel.value)?.key ?? "";
    }
    const ok = this.controls.length >= 2;
    for (const el of [this.xSel, this.ySel, this.xRange, this.yRange]) el.disabled = !ok;
    this.pad.classList.toggle("landscape-disabled", !ok);
    this.pad.tabIndex = ok ? 0 : -1;
    if (!ok) this.setStatus("This fractal has fewer than two parameters to explore. Turn on Julia mode or add a formula.");
    else if (this.status.textContent?.startsWith("This fractal has fewer")) this.setStatus("");
    this.readout.textContent = ok ? "Drag on the surface to begin." : "";
  }

  /** The picture of the original, taken while nothing is being explored (a drag changes the view at once, so it cannot be taken afterwards). */
  captureOriginal(attempt = 0): void {
    if (this.exploring || this.originalThumb) return;
    const t = ++this.token;
    // The engine may be busy with the viewport's own refinement right now: the picture is asked for again a moment later (a few tries at most).
    const retry = () => { if (attempt < 6 && this.details.open && !this.exploring && !this.originalThumb) setTimeout(() => this.captureOriginal(attempt + 1), 1000); };
    if (this.h.busy()) { retry(); return; }
    void this.h.thumbnail().then((thumb) => {
      if (t !== this.token || this.exploring) return;
      if (thumb) { this.originalThumb = thumb; this.drawPins(); } else retry();
    }).catch(() => undefined);
  }

  /** Called by the application when the scene may have changed (a file was opened, Undo, ...). Does nothing while exploring. */
  update(): void {
    if (this.exploring) return;
    const before = this.controlsKey;
    this.refresh();
    if (this.controlsKey !== before) { this.pins.clear(); this.originalThumb = undefined; this.drawPins(); if (this.details.open) this.captureOriginal(); }
  }

  private control(key: string): LandscapeControl | undefined { return this.controls.find((c) => c.key === key); }

  private axesChanged(): void {
    if (this.exploring) this.cancel("New parameters chosen. The artwork is unchanged.");
    this.pins.clear();
    this.originalThumb = undefined;
    this.drawPins();
    this.drawDot();
  }

  private rangeChanged(): void {
    if (!this.exploring || !this.ax || !this.ay) { this.drawDot(); return; }
    this.ax = { ...this.ax, scale: clampScale(Number(this.xRange.value)) };
    this.ay = { ...this.ay, scale: clampScale(Number(this.yRange.value)) };
    this.drawDot();
  }

  // ---------- exploring ----------
  private ensureExploring(): boolean {
    if (this.exploring) return true;
    if (this.h.busy()) { this.setStatus("Wait until the ongoing work is finished."); return false; }
    this.refresh();
    const x = this.control(this.xSel.value), y = this.control(this.ySel.value);
    if (!x || !y || !compatiblePair(x, y)) { this.setStatus("Choose two different parameters."); return false; }
    const ax: LandscapeAxis = { control: x, scale: clampScale(Number(this.xRange.value)) }, ay: LandscapeAxis = { control: y, scale: clampScale(Number(this.yRange.value)) };
    // Dragging must only change uniform values. If this pair would ever change the shader, it is not offered.
    if (!landscapeKeepsShader(this.h.scene(), this.h.formulas(), ax, ay)) { this.setStatus("This combination would require a new shader during the drag and is not used. Choose other parameters."); return false; }
    this.ax = ax;
    this.ay = ay;
    this.vx = x.origin;
    this.vy = y.origin;
    this.exploring = true;
    this.showOriginal = false;
    this.compare.setAttribute("aria-pressed", "false");
    this.buttons.undo.hidden = true;
    this.details.classList.add("landscape-exploring");
    this.setStatus("Exploring. The artwork is unchanged until you press Use.");
    this.drawDot();
    const go = (): void => { if (!this.exploring) return; this.live = true; this.push(); };
    if (this.originalThumb) go();
    else {
      this.live = false;
      const t = ++this.token;
      // The viewport still shows the original here; one small picture of it, then the first preview (never longer than 1.5 s).
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
      void Promise.race([this.h.thumbnail().catch(() => null), timeout]).then((thumb) => {
        if (t === this.token && thumb && this.exploring && !this.originalThumb) { this.originalThumb = thumb; this.drawPins(); }
        go();
      });
    }
    return true;
  }

  private current(): { x: number; y: number } {
    return this.showOriginal ? { x: this.ax!.control.origin, y: this.ay!.control.origin } : { x: this.vx, y: this.vy };
  }

  /** Shows the current position (or the original) in the viewport. A fresh function each time: the audition caches by input scene. */
  private push(): void {
    if (!this.exploring || !this.live || !this.ax || !this.ay) return;
    const { x, y } = this.current();
    const cx = this.ax.control, cy = this.ay.control;
    this.h.begin((ev) => withLandscape(ev, { control: cx, value: x }, { control: cy, value: y }), (reason) => this.ended(reason));
    this.h.touch();
  }

  private ended(reason: AuditionEnd): void {
    if (!this.exploring) return;
    this.exploring = false;
    this.live = false;
    this.dragging = false;
    this.details.classList.remove("landscape-exploring");
    if (reason === "cleared" || reason === "scene-changed") { this.pins.clear(); this.originalThumb = undefined; }
    this.setStatus(reason === "replaced" ? "Exploring ended: another trial was started. The artwork is unchanged." : reason === "rejected" ? "The engine rejected the position. The artwork is unchanged." : "Exploring ended. The artwork is unchanged.");
    this.refresh();
    this.drawDot();
    this.drawPins();
  }

  private fromPointer(e: PointerEvent): void {
    const r = this.pad.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    const px = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const py = Math.max(-1, Math.min(1, 1 - ((e.clientY - r.top) / r.height) * 2)); // up is positive
    this.pending = { px, py };
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.flushPending(); });
  }

  private flushPending(): void {
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    const p = this.pending;
    this.pending = null;
    if (!p || !this.exploring || !this.ax || !this.ay) return;
    this.moveTo(valueAt(this.ax, p.px), valueAt(this.ay, p.py));
  }

  private moveTo(vx: number, vy: number): void {
    this.vx = vx;
    this.vy = vy;
    this.showOriginal = false;
    this.compare.setAttribute("aria-pressed", "false");
    this.push();
    this.drawDot();
  }

  private key(e: KeyboardEvent): void {
    const step = e.shiftKey ? 0.2 : 0.05;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
    if (e.key === "Home") { e.preventDefault(); if (this.exploring) this.reset(); return; }
    if (e.key === "Enter") { e.preventDefault(); this.pin(); return; }
    if (!dx && !dy) return;
    e.preventDefault();
    if (!this.ensureExploring() || !this.ax || !this.ay) return;
    this.moveTo(valueAt(this.ax, Math.max(-1, Math.min(1, positionOf(this.ax, this.vx) + dx))), valueAt(this.ay, Math.max(-1, Math.min(1, positionOf(this.ay, this.vy) + dy))));
  }

  private toggleOriginal(): void {
    if (!this.exploring) return;
    this.showOriginal = !this.showOriginal;
    this.compare.setAttribute("aria-pressed", String(this.showOriginal));
    this.push();
    this.drawDot();
  }

  private reset(): void {
    if (!this.exploring || !this.ax || !this.ay) return;
    this.moveTo(this.ax.control.origin, this.ay.control.origin);
    this.setStatus("Back in the centre: the original.");
  }

  private cancel(message: string): void {
    if (this.dragging) this.h.hold?.(false);
    this.dragging = false;
    this.pending = null;
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    if (this.exploring) {
      this.exploring = false;
      this.live = false;
      this.h.end();
      this.h.touch();
    }
    this.details.classList.remove("landscape-exploring");
    this.setStatus(message);
    this.refresh();
    this.drawDot();
  }

  // ---------- pins ----------
  private pin(): void {
    if (!this.exploring || !this.ax || !this.ay) { this.setStatus("Move the point first, then you can pin."); return; }
    const { x, y } = this.current();
    const pic: PinPicture = {};
    const pin = this.pins.add(x, y, this.ax, this.ay, pic);
    if (!pin) { this.setStatus(this.pins.size >= MAX_PINS ? `At most ${MAX_PINS} pins. Remove one first.` : "That position is already pinned."); return; }
    this.setStatus(`Pin ${pin.id} set.`);
    this.drawPins();
    this.drawDot();
    const t = this.token;
    void this.h.thumbnail().then((thumb) => { if (t === this.token && thumb && this.pins.get(pin.id)) { pic.thumb = thumb; this.drawPins(); } }).catch(() => undefined);
  }

  private goTo(id: number): void {
    const pin = this.pins.get(id);
    if (!pin) return;
    if (!this.ensureExploring()) return;
    this.moveTo(pin.x, pin.y);
    this.setStatus(`Pin ${id}.`);
  }

  private drawPins(): void {
    this.pinBox.replaceChildren();
    const card = (label: string, thumb: string | undefined, click: () => void, key: string, remove?: () => void): void => {
      const wrap = document.createElement("div");
      wrap.className = "landscape-pin";
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.landscapePin = key;
      b.title = key === "original" ? "The original: back to the centre." : "Go to this pin.";
      if (thumb) { const img = document.createElement("img"); img.src = thumb; img.alt = ""; b.append(img); } else b.append(Object.assign(document.createElement("span"), { textContent: "…" }));
      b.append(Object.assign(document.createElement("small"), { textContent: label }));
      b.addEventListener("click", click);
      wrap.append(b);
      if (remove) {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "landscape-pin-remove";
        x.textContent = "×";
        x.setAttribute("aria-label", "Delete " + label);
        x.addEventListener("click", remove);
        wrap.append(x);
      }
      this.pinBox.append(wrap);
    };
    this.pinBox.hidden = !this.pins.size && !this.originalThumb;
    if (this.originalThumb) card("Original", this.originalThumb, () => { if (this.ensureExploring()) this.reset(); }, "original");
    for (const p of this.pins.list()) card("Pin " + p.id, p.extra?.thumb, () => this.goTo(p.id), String(p.id), () => { this.pins.remove(p.id); this.drawPins(); this.drawDot(); });
  }

  // ---------- apply, undo, save ----------
  private apply(): void {
    if (!this.exploring || !this.ax || !this.ay) { this.setStatus("Explore first: drag on the surface."); return; }
    if (this.h.busy()) { this.setStatus("Wait until the ongoing work is finished."); return; }
    const x = this.vx, y = this.vy, cx = this.ax.control, cy = this.ay.control;
    this.exploring = false;
    this.live = false;
    this.dragging = false;
    this.pending = null;
    this.h.end();
    this.h.commit((s) => withLandscape(s, { control: cx, value: x }, { control: cy, value: y }));
    this.details.classList.remove("landscape-exploring");
    this.buttons.undo.hidden = false;
    this.originalThumb = undefined;
    this.setStatus("Applied as one step. Undo brings back the original.");
    this.refresh();
    this.drawDot();
    this.captureOriginal(); // the applied scene is the new centre
  }

  private undo(): void {
    if (this.h.busy()) { this.setStatus("Wait until the ongoing work is finished."); return; }
    if (this.h.canUndo() && this.h.undo()) {
      this.buttons.undo.hidden = true;
      this.pins.clear();
      this.originalThumb = undefined;
      this.setStatus("The original is back.");
      this.refresh();
      this.drawDot();
      this.drawPins();
    } else this.setStatus("Nothing to undo.");
  }

  private async save(): Promise<void> {
    if (!this.exploring || !this.ax || !this.ay || !this.h.save) { this.setStatus("Explore first: drag on the surface."); return; }
    const cx = this.ax.control, cy = this.ay.control, x = this.vx, y = this.vy;
    const scene = withLandscape(this.h.scene(), { control: cx, value: x }, { control: cy, value: y });
    this.buttons.save.disabled = true;
    try {
      const id = await this.h.save(scene, `Parameter landscape · ${cx.name} ${fmt(x)} · ${cy.name} ${fmt(y)}`, JSON.stringify({ landscape: { x: { key: cx.key, value: x }, y: { key: cy.key, value: y } } }));
      this.setStatus("Saved in My fractals (" + id.slice(0, 8) + "). The artwork is unchanged.");
    } catch (e) { this.setStatus("Could not save: " + (e instanceof Error ? e.message : String(e))); } finally { this.buttons.save.disabled = false; }
  }

  // ---------- drawing ----------
  private drawDot(): void {
    const ax = this.ax, ay = this.ay;
    this.pad.querySelectorAll(".landscape-pinmark").forEach((n) => n.remove());
    const on = this.exploring && ax && ay;
    for (const b of [this.buttons.pin, this.buttons.reset, this.buttons.apply, this.buttons.cancel, this.buttons.save]) b.disabled = !on;
    this.compare.disabled = !on;
    if (!on) {
      this.dot.style.left = this.dot.style.top = "50%";
      this.dot.classList.remove("landscape-dot-original");
      return;
    }
    const px = positionOf(ax, this.vx), py = positionOf(ay, this.vy);
    this.dot.style.left = ((px + 1) / 2) * 100 + "%";
    this.dot.style.top = ((1 - py) / 2) * 100 + "%";
    this.dot.classList.toggle("landscape-dot-original", this.showOriginal);
    for (const p of this.pins.list()) {
      const m = document.createElement("div");
      m.className = "landscape-pinmark";
      m.textContent = String(p.id);
      m.style.left = ((positionOf(ax, p.x) + 1) / 2) * 100 + "%";
      m.style.top = ((1 - positionOf(ay, p.y)) / 2) * 100 + "%";
      this.pad.append(m);
    }
    const cur = this.current();
    this.readout.textContent = `${ax.control.name} ${fmt(cur.x)} (${cur.x >= ax.control.origin ? "+" : "−"}${fmt(Math.abs(cur.x - ax.control.origin))}) · ${ay.control.name} ${fmt(cur.y)} (${cur.y >= ay.control.origin ? "+" : "−"}${fmt(Math.abs(cur.y - ay.control.origin))})${this.showOriginal ? " · visar originalet" : ""}`;
  }

  private setStatus(text: string): void { this.status.textContent = text; }
}
