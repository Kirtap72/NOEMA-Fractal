import { SURFACE_LOOKS } from "../engine/surfaceLooks";
import { defaultSculpt } from "../engine/renderDetails";
import type { SculptSettings } from "../engine/renderDetails";
import type { Scene } from "../engine/scene";

export interface SurfaceLookHandlers {
  /** The artist pressed a look. The only way a look reaches the scene (one Undo step). */
  onApply(lookId: string): void;
  /** A fine-tuning control changed the sculpt settings (one Undo step per change). */
  onSculpt(next: SculptSettings): void;
  /** Measure a small picture and set the exposure so the surface's median brightness is a pleasant midtone (one Undo step). */
  onFitExposure(): void;
  onUndo(): void;
  canUndo(): boolean;
}

/**
 * Skulpturlägen (SURFACE-LIGHTING-01): finished lighting set-ups in the light tab, plus fine-tuning controls for the wide occlusion,
 * the bent environment light and the contact-shadow length. Plain DOM; only the buttons and controls write, through the owner's undoable edit.
 */
export class SurfaceLookPanel {
  readonly root = document.createElement("details");
  private readonly status = document.createElement("p");
  private readonly info = document.createElement("p");
  private readonly undo = document.createElement("button");
  private readonly fit = document.createElement("button");
  private readonly far = document.createElement("input");
  private readonly contact = document.createElement("input");
  private readonly bent = document.createElement("input");
  private readonly spec = document.createElement("input");
  private readonly specPx = document.createElement("input");
  private readonly indirect = document.createElement("input");
  private readonly sky = document.createElement("input");
  private readonly tune = document.createElement("div");
  private scene?: Scene;
  private lastLook = "";

  constructor(parent: HTMLElement, private readonly handlers: SurfaceLookHandlers) {
    this.root.id = "surface-looks"; this.root.open = true;
    const summary = document.createElement("summary"); summary.textContent = "Sculpt looks (ready-made lighting)"; this.root.append(summary);
    const note = document.createElement("p"); note.className = "ainfo";
    note.textContent = "One click sets light, shadows, occlusion and tone curve for a sculpted picture. Geometry, camera, formulas and colours are not changed. Distances are computed from the distance to the subject and the height of the picture, so the look works the same in a deep zoom as in a wide view. One Undo step.";
    const row = document.createElement("div"); row.className = "arow"; row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
    for (const look of SURFACE_LOOKS) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = look.name; b.dataset.surfaceLook = look.id; b.title = look.description;
      b.onclick = () => { this.lastLook = look.id; this.info.textContent = look.description; handlers.onApply(look.id); };
      row.append(b);
    }
    this.undo.type = "button"; this.undo.id = "surface-look-undo"; this.undo.textContent = "Undo the look"; this.undo.onclick = () => handlers.onUndo(); this.undo.disabled = true;
    this.fit.type = "button"; this.fit.id = "surface-look-fit"; this.fit.textContent = "Fit the exposure"; this.fit.onclick = () => handlers.onFitExposure();
    this.fit.title = "Measures a small picture of the subject and sets the exposure so that the mid-tones of the surface end up at a suitable brightness. Good when a look becomes too dark or too light for this particular subject.";
    row.append(this.fit, this.undo);
    this.info.className = "ainfo"; this.status.className = "ainfo"; this.status.id = "surface-look-status"; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.tune.className = "ainfo"; this.tune.hidden = true; this.tune.style.cssText = "display:grid;gap:6px;margin-top:6px";
    const slider = (input: HTMLInputElement, label: string, min: number, max: number, step: number, title: string) => {
      input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step); input.title = title;
      const wrap = document.createElement("label"); wrap.style.cssText = "display:grid;grid-template-columns:11em 1fr;gap:8px;align-items:center";
      wrap.append(document.createTextNode(label), input); this.tune.append(wrap);
    };
    slider(this.far, "Broad occlusion", 0, 1, 0.01, "How much the large shapes shadow each other (darker in large recesses).");
    slider(this.contact, "Length of the contact shadow", 0.005, 0.2, 0.005, "How far a contact shadow searches towards the light, as a fraction of the picture height at the surface.");
    slider(this.spec, "Calmer reflections", 0, 4, 0.1, "Softens small, hard glitter where the surface is densely detailed. Smooth surfaces keep their sharp reflections. 0 = off.");
    slider(this.specPx, "…smoothed over (pixels)", 0.5, 32, 0.5, "How large an area (in pixels) decides whether the surface is too busy for a sharp reflection.");
    slider(this.indirect, "Occlusion of indirect light", 0, 2, 0.05, "Ambient light, sky light and environment reflections are let into recesses less than direct light. Deeper cavities, clearer light hierarchy. 0 = off.");
    this.far.id = "surface-far"; this.contact.id = "surface-contact"; this.spec.id = "surface-spec"; this.specPx.id = "surface-spec-px"; this.indirect.id = "surface-indirect";
    const bentWrap = document.createElement("label"); this.bent.type = "checkbox"; this.bent.id = "surface-bent";
    bentWrap.append(this.bent, document.createTextNode(" Bent environment lighting (cavities get less sky light)")); this.tune.append(bentWrap);
    const change = () => {
      const cur = this.scene?.details.sculpt ?? defaultSculpt();
      handlers.onSculpt({ ...cur, enabled: true, far_strength: Number(this.far.value), contact_length: Number(this.contact.value), bent_environment: this.bent.checked, spec_filter: Number(this.spec.value), spec_pixels: Number(this.specPx.value), indirect_occlusion: Number(this.indirect.value) });
    };
    for (const i of [this.far, this.contact, this.spec, this.specPx, this.indirect]) i.addEventListener("change", change);
    this.bent.addEventListener("change", change);
    this.root.append(note, row, this.info, this.status, this.tune);
    parent.prepend(this.root);
  }

  setStatus(text: string): void { this.status.textContent = text; }

  /** Brings the controls in line with the scene. */
  update(scene: Scene): void {
    this.scene = scene;
    const s = scene.details.sculpt;
    this.tune.hidden = !s?.enabled;
    const sliders: [HTMLInputElement, number][] = s ? [[this.far, s.far_strength], [this.contact, s.contact_length], [this.spec, s.spec_filter ?? 0], [this.specPx, s.spec_pixels ?? 3], [this.indirect, s.indirect_occlusion ?? 0]] : [];
    if (s?.enabled && !sliders.some(([i]) => document.activeElement === i)) { for (const [i, v] of sliders) { i.value = String(v); i.dispatchEvent(new Event('input')); } this.bent.checked = s.bent_environment; }
    this.undo.disabled = !this.handlers.canUndo() || !this.lastLook;
  }
}
