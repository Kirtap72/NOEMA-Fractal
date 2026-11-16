import { stepVariants } from "../engine/stepEffect";
import type { StepVariant } from "../engine/stepEffect";
import type { Formula } from "../engine/formula/types";
import type { Scene } from "../engine/scene";
import type { AuditionEnd } from "./sceneSync";
import "./stepEffectPanel.css";

/** What the step explorer needs from the application. Everything it shows goes through the scene's render-only audition: the artwork is written only by Apply. */
export interface StepEffectHandlers {
  /** The authored scene (never the audition view). */
  scene(): Scene;
  formulas(): readonly Formula[];
  /** Shows `apply(scene)` render-only. See SceneSync.setAudition. */
  begin(apply: (evaluated: Scene) => Scene, onEnd: (reason: AuditionEnd) => void): void;
  /** Removes the render-only layer: the original is back. */
  end(): void;
  touch(): void;
  /** The one undoable write. */
  commit(change: (scene: Scene) => Scene): void;
  /** A small PNG data URL of what the viewport shows now (same camera, light and material as the viewport), or null when the engine is busy. */
  thumbnail(): Promise<string | null>;
  busy(): boolean;
  undo(): boolean;
  canUndo(): boolean;
  /** The element of step `index` in the chain list, so the comparison can open right under it. Null when it is not on screen. */
  stepElement?(index: number): HTMLElement | null;
  /** A message that is always shown to the artist (used when the comparison cannot be made visible: never a silent failure). */
  notify?(text: string): void;
}

/** Share of pixels that differ visibly between two small pictures (0 to 1). */
export async function pictureDifference(a: string, b: string): Promise<number> {
  const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("bild")); i.src = url; });
  const [x, y] = await Promise.all([load(a), load(b)]);
  const w = Math.min(x.width, y.width), h = Math.min(x.height, y.height);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(x, 0, 0, w, h);
  const A = g.getImageData(0, 0, w, h).data;
  g.clearRect(0, 0, w, h);
  g.drawImage(y, 0, 0, w, h);
  const B = g.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i]! - B[i]!) + Math.abs(A[i + 1]! - B[i + 1]!) + Math.abs(A[i + 2]! - B[i + 2]!) > 9) n++;
  return n / (A.length / 4);
}

/** How to put a difference into words an artist can use. */
export function describeDifference(share: number): string {
  const pct = share < 0.001 ? "less than 0.1" : share < 0.1 ? (share * 100).toFixed(1) : String(Math.round(share * 100));
  if (share < 0.01) return `The picture differs in ${pct} % of the surface: no noticeable difference. The step hardly contributes with the current values.`;
  if (share < 0.1) return `The picture differs in ${pct} % of the surface: a small difference. The step fine-tunes the shape.`;
  if (share < 0.4) return `The picture differs in ${pct} % of the surface: a clear difference. The step shapes part of the picture.`;
  return `The picture differs in ${pct} % of the surface: a large difference. The step shapes much of your fractal.`;
}

const chainSignature = (scene: Scene): string => {
  const f = scene.content[0];
  return JSON.stringify([f?.chain ?? [], f?.mode ?? "sequence", f?.rounds ?? 1, f?.execution ?? null, f?.julia ?? null]);
};

/**
 * ARTIST-WORKFLOW 04: "Visa stegets verkan". For one formula step: the artwork as it is next to the same artwork with that step taken out, run with
 * half the iterations, or reset to the formula's standard values. Same camera, light and material (it is the very same scene with one change),
 * shown through the render-only audition, with two small pictures and a plain sentence about how much changed. Apply writes the change as one undoable
 * step; Cancel and a changed chain end the comparison; the artwork is never written before Apply.
 */
export class StepEffectPanel {
  private box = document.createElement("section");
  private title = document.createElement("h4");
  private choices = document.createElement("div");
  private pictures = document.createElement("div");
  private imgOriginal = document.createElement("img");
  private imgVariant = document.createElement("img");
  private explanation = document.createElement("p");
  private compare = document.createElement("button");
  private apply = document.createElement("button");
  private cancelButton = document.createElement("button");
  private undoButton = document.createElement("button");
  private status = document.createElement("small");
  private index = -1;
  private signature = "";
  private variants: StepVariant[] = [];
  private chosen: StepVariant | null = null;
  private showingOriginal = false;
  private originalPicture: string | null = null;
  private token = 0;
  /** True while this panel itself changes the scene (Apply), so that the change is not mistaken for an edit by the artist. */
  private writing = false;

  constructor(private root: HTMLElement, private h: StepEffectHandlers) {
    this.box.className = "step-effect";
    this.box.dataset.stepEffect = "";
    this.box.hidden = true;
    this.box.setAttribute("aria-label", "Effect of the step");
    this.title.dataset.stepTitle = "";
    this.choices.className = "step-effect-choices";
    this.pictures.className = "step-effect-pictures";
    this.pictures.hidden = true;
    for (const [img, key, label] of [[this.imgOriginal, "original", "Nu"], [this.imgVariant, "variant", "Variant"]] as const) {
      const fig = document.createElement("figure");
      img.dataset.stepImage = key;
      img.alt = label;
      const cap = document.createElement("figcaption");
      cap.textContent = label;
      fig.append(img, cap);
      this.pictures.append(fig);
    }
    this.explanation.dataset.stepExplanation = "";
    this.explanation.setAttribute("role", "status");
    this.status.dataset.stepStatus = "";
    this.status.setAttribute("role", "status");
    const make = (button: HTMLButtonElement, text: string, title: string, key: string, run: () => void) => {
      button.type = "button";
      button.textContent = text;
      button.title = title;
      button.dataset[key] = "";
      button.addEventListener("click", run);
    };
    make(this.compare, "Show original in the view", "Switch in the view between the original and the variant.", "stepCompare", () => this.toggleOriginal());
    this.compare.setAttribute("aria-pressed", "false");
    make(this.apply, "Use", "Write the variant to the artwork as a single step. Undo brings back the original.", "stepApply", () => void this.applyChosen());
    make(this.cancelButton, "Cancel", "Close the comparison. The artwork is as it was.", "stepCancel", () => this.close("Cancelled. The artwork is unchanged."));
    make(this.undoButton, "Undo", "Bring back the artwork as it was before Use.", "stepUndo", () => void this.undo());
    this.undoButton.hidden = true;
    const row = document.createElement("div");
    row.className = "step-effect-buttons";
    row.append(this.compare, this.apply, this.cancelButton, this.undoButton);
    this.box.append(this.title, this.choices, this.pictures, this.explanation, row, this.status);
    root.append(this.box);
    this.render();
  }

  /** Opens the explorer for step `index` (0-based) of the first fractal. */
  open(index: number): void {
    if (this.h.busy()) { this.show(index, "Wait until the ongoing work is finished."); return; }
    this.endTrial();
    this.index = index;
    this.signature = chainSignature(this.h.scene());
    this.variants = stepVariants(this.h.scene(), this.h.formulas(), index);
    this.chosen = null;
    this.showingOriginal = false;
    this.originalPicture = null;
    this.imgOriginal.removeAttribute("src");
    this.imgVariant.removeAttribute("src");
    this.pictures.hidden = true;
    this.explanation.textContent = "Choose what to change in the step. The artwork is not changed until you press Use.";
    this.undoButton.hidden = true;
    this.status.textContent = "";
    this.box.hidden = false;
    this.render();
    this.reveal(true);
    // The picture of the original is taken now, while the viewport still shows it (the variant changes what the viewport shows).
    void this.captureOriginal();
  }

  /** Called when the application shows the chain again: if the artist changed it, the comparison no longer describes the artwork. */
  update(): void {
    if (this.box.hidden || this.writing || this.index < 0) return;
    this.place(); // the chain list is rebuilt now and then: the panel follows its step
    if (chainSignature(this.h.scene()) !== this.signature) this.close("The chain was changed, so the comparison was closed. The artwork is as you left it.");
  }

  private show(index: number, message: string): void { this.index = index; this.box.hidden = false; this.status.textContent = message; this.render(); this.reveal(true); }

  /** Puts the panel directly under the card of the chosen step (the chain list is rebuilt now and then, which would otherwise take it away). */
  private place(): void {
    const card = this.index >= 0 ? this.h.stepElement?.(this.index) ?? null : null;
    if (card && card.parentElement) { if (this.box.previousElementSibling !== card || !this.box.isConnected) card.after(this.box); return; }
    if (!this.box.isConnected) this.root.append(this.box);
  }

  /**
   * Makes the panel visible: in place, scrolled into view, with a short highlight. If it still cannot be seen, say so (never a silent failure).
   * `check` verifies after the browser has laid it out.
   */
  private reveal(check: boolean): void {
    this.place();
    this.box.classList.remove("step-effect-flash"); void this.box.offsetWidth; this.box.classList.add("step-effect-flash");
    this.box.scrollIntoView?.({ block: "center", behavior: "smooth" });
    if (!check) return;
    window.setTimeout(() => {
      if (this.box.hidden) return;
      const r = this.box.getBoundingClientRect();
      if (!this.box.isConnected || r.width < 1 || r.height < 1) {
        this.status.textContent = "The comparison was opened but could not be shown here.";
        this.h.notify?.("The effect of the step could not be shown. Open the Shape tab and try again; the artwork is unchanged.");
      }
    }, 400);
  }

  private async captureOriginal(attempt = 0): Promise<string | null> {
    if (this.originalPicture) return this.originalPicture;
    const t = this.token;
    const retry = async (): Promise<string | null> => {
      if (attempt >= 5 || t !== this.token || this.box.hidden || this.chosen) return null;
      await new Promise((r) => setTimeout(r, 800));
      return this.captureOriginal(attempt + 1);
    };
    if (this.h.busy()) return retry();
    const thumb = await this.h.thumbnail().catch(() => null);
    if (t !== this.token || this.box.hidden) return null;
    if (!thumb) return retry();
    this.originalPicture = thumb;
    return thumb;
  }

  private render(): void {
    this.title.textContent = this.index >= 0 ? `Effect of the step · step ${this.index + 1}` : "Effect of the step";
    this.choices.replaceChildren();
    for (const v of this.variants) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = v.label + (v.available && v.newShader ? " · new shader" : "");
      b.dataset.stepVariant = v.id;
      b.setAttribute("aria-pressed", String(this.chosen?.id === v.id));
      if (!v.available) {
        b.setAttribute("aria-disabled", "true");
        b.classList.add("step-effect-unavailable");
        b.title = v.problem ?? "";
        b.addEventListener("click", () => { this.status.textContent = v.problem ?? ""; });
      } else {
        b.title = v.description + (v.newShader ? " This gives a new shader that is compiled once: a few seconds for a simple fractal, up to half a minute for a large chain." : " No new shader is needed.");
        b.addEventListener("click", () => void this.choose(v));
      }
      this.choices.append(b);
    }
    const reasons = this.variants.filter((v) => !v.available && v.problem);
    this.choices.dataset.unavailable = String(reasons.length);
    const chosen = this.chosen !== null;
    this.compare.disabled = !chosen;
    this.apply.disabled = !chosen;
  }

  private async choose(v: StepVariant): Promise<void> {
    if (!v.available || !v.change) return;
    if (this.h.busy()) { this.status.textContent = "Wait until the ongoing work is finished."; return; }
    const t = ++this.token;
    this.chosen = v;
    this.showingOriginal = false;
    this.compare.setAttribute("aria-pressed", "false");
    this.explanation.textContent = v.description;
    this.status.textContent = v.newShader ? "Preparing the comparison: a new shader is compiled once (can take a while for large chains)…" : "Preparing the comparison…";
    this.render();
    const original = await Promise.race([this.captureOriginal(), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
    if (t !== this.token || this.chosen !== v) return;
    // From here on the viewport shows the variant: the same scene, camera, light and material, with this one change.
    const change = v.change;
    this.h.begin((ev) => change(ev), (reason) => this.ended(reason));
    this.h.touch();
    const variantPicture = await this.variantPicture(t);
    if (t !== this.token || this.chosen !== v) return;
    if (original) this.imgOriginal.src = original; else this.imgOriginal.removeAttribute("src");
    if (variantPicture) this.imgVariant.src = variantPicture; else this.imgVariant.removeAttribute("src");
    this.pictures.hidden = !original && !variantPicture;
    if (original && variantPicture) {
      const share = await pictureDifference(original, variantPicture).catch(() => null);
      if (t !== this.token || this.chosen !== v) return;
      this.explanation.textContent = `${v.description} ${share === null ? "" : describeDifference(share)}`.trim();
    }
    this.status.textContent = "The view shows the variant. The artwork is unchanged until you press Use.";
    this.reveal(false); // the panel grew (pictures, sentence): keep all of it in view
  }

  private async variantPicture(t: number, attempt = 0): Promise<string | null> {
    if (t !== this.token) return null;
    if (this.h.busy()) { if (attempt >= 6) return null; await new Promise((r) => setTimeout(r, 800)); return this.variantPicture(t, attempt + 1); }
    const thumb = await this.h.thumbnail().catch(() => null);
    if (thumb || attempt >= 6) return thumb;
    await new Promise((r) => setTimeout(r, 800));
    return this.variantPicture(t, attempt + 1);
  }

  private toggleOriginal(): void {
    const v = this.chosen;
    if (!v?.change) return;
    this.showingOriginal = !this.showingOriginal;
    this.compare.setAttribute("aria-pressed", String(this.showingOriginal));
    if (this.showingOriginal) this.h.end();
    else { const change = v.change; this.h.begin((ev) => change(ev), (reason) => this.ended(reason)); }
    this.h.touch();
    this.status.textContent = this.showingOriginal ? "The view shows the original." : "The view shows the variant.";
  }

  /** Waits (at most five seconds) until no render or measurement owns the engine; a click on Använd or Ångra should not be refused for a moment's work. */
  private async idle(): Promise<boolean> {
    for (let i = 0; i < 20 && this.h.busy(); i++) {
      this.status.textContent = "Waiting for the ongoing work to finish…";
      await new Promise((r) => setTimeout(r, 250));
    }
    return !this.h.busy();
  }

  private async applyChosen(): Promise<void> {
    const v = this.chosen;
    if (!v?.change) { this.status.textContent = "Choose a variant first."; return; }
    if (!(await this.idle())) { this.status.textContent = "The engine is still busy. Try again in a moment."; return; }
    if (this.chosen !== v) return; // the comparison ended while waiting
    this.writing = true;
    this.token++;
    this.h.end();
    try { this.h.commit(v.change); } finally { this.writing = false; }
    this.chosen = null;
    this.variants = [];
    this.index = -1;
    this.pictures.hidden = true;
    this.explanation.textContent = "The variant is applied as a single step.";
    this.status.textContent = "Undo brings back the artwork as it was.";
    this.undoButton.hidden = false;
    this.render();
  }

  private async undo(): Promise<void> {
    if (!(await this.idle())) { this.status.textContent = "The engine is still busy. Try again in a moment."; return; }
    if (this.h.canUndo() && this.h.undo()) {
      this.undoButton.hidden = true;
      this.box.hidden = true;
    } else this.status.textContent = "Nothing to undo.";
  }

  /** Ends the comparison (the original is back) and closes the panel. */
  close(message: string): void {
    this.token++;
    this.endTrial();
    this.chosen = null;
    this.variants = [];
    this.index = -1;
    this.pictures.hidden = true;
    this.box.hidden = true;
    this.status.textContent = message;
  }

  private endTrial(): void {
    if (this.chosen && !this.showingOriginal) { this.h.end(); this.h.touch(); }
    else if (this.chosen) this.h.touch();
  }

  private ended(reason: AuditionEnd): void {
    if (!this.chosen || this.showingOriginal) return;
    this.token++;
    this.chosen = null;
    this.pictures.hidden = true;
    this.compare.setAttribute("aria-pressed", "false");
    this.explanation.textContent = reason === "replaced" ? "The comparison ended: another test was started. The artwork is unchanged." : "The comparison ended. The artwork is unchanged.";
    if (reason === "cleared" || reason === "scene-changed") this.box.hidden = true;
    this.render();
  }
}
