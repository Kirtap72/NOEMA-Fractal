import { LIGHT_RIGS, planRig } from "../engine/lightRigs";
import type { RigMode, RigOptions } from "../engine/lightRigs";
import type { Scene } from "../engine/scene";

export interface LightRigPanelHandlers {
  /** The artist pressed "Use rig". The only way a rig ever reaches the scene. */
  onApply(rigId: string, mode: RigMode, options: RigOptions): void;
  onUndo(): void;
  onRedo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

/**
 * Camera-relative lighting rigs. Plain DOM, text only. Building, opening, listing or choosing a rig reads the scene and
 * changes nothing; only the apply button writes, through the owner's single undoable edit.
 */
export class LightRigPanel {
  private select!: HTMLSelectElement;
  private description!: HTMLElement;
  private modes!: Record<RigMode, HTMLInputElement>;
  private shadows!: HTMLInputElement;
  private effect!: HTMLElement;
  private apply!: HTMLButtonElement;
  private undo!: HTMLButtonElement;
  private redo!: HTMLButtonElement;
  private status!: HTMLElement;
  private scene?: Scene;

  constructor(
    private root: HTMLElement,
    private handlers: LightRigPanelHandlers,
  ) {
    this.build();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  }

  private build(): void {
    const details = this.el("details");
    details.id = "light-rigs";
    details.append(this.el("summary", "Light rigs (based on the camera)"));
    const body = this.el("div");
    details.append(body);

    this.select = this.el("select");
    this.select.setAttribute("aria-label", "Light rig");
    this.select.dataset.rigSelect = "";
    for (const rig of LIGHT_RIGS) this.select.add(new Option(rig.name, rig.id));
    this.select.addEventListener("change", () => this.refresh());
    this.description = this.el("div", "", "ainfo");
    this.description.dataset.rigDescription = "";
    body.append(this.select, this.description);

    const modeBox = this.el("div");
    modeBox.setAttribute("role", "radiogroup");
    modeBox.setAttribute("aria-label", "What happens to the lights that exist");
    const entries: [RigMode, string][] = [
      ["replace-directional", "Replace directional lights (spot and point lights are kept)"],
      ["add", "Add the rig (all lights are kept)"],
    ];
    const inputs = {} as Record<RigMode, HTMLInputElement>;
    for (const [mode, label] of entries) {
      const input = this.el("input");
      input.type = "radio";
      input.name = "light-rig-mode";
      input.value = mode;
      input.checked = mode === "replace-directional";
      input.dataset.rigMode = mode;
      input.addEventListener("change", () => this.refresh());
      inputs[mode] = input;
      const row = this.el("label", " " + label);
      row.prepend(input);
      modeBox.append(row);
    }
    this.modes = inputs;
    body.append(modeBox);

    const shadowRow = this.el("label", " Soft shadows on the main light of the rig (makes drawing slower)");
    this.shadows = this.el("input");
    this.shadows.type = "checkbox";
    this.shadows.checked = false;
    this.shadows.dataset.rigShadows = "";
    shadowRow.prepend(this.shadows);
    body.append(shadowRow);

    this.effect = this.el("div", "", "ainfo");
    this.effect.dataset.rigEffect = "";
    this.effect.setAttribute("aria-live", "polite");
    body.append(this.effect);

    this.apply = this.el("button", "Use rig");
    this.apply.type = "button";
    this.apply.dataset.rigApply = "";
    this.apply.title = "Computes the lights from the camera as it stands now and puts them in the scene. One Undo step.";
    this.apply.onclick = () => this.handlers.onApply(this.select.value, this.mode(), { shadows: this.shadows.checked });
    this.undo = this.el("button", "Undo rig");
    this.undo.type = "button";
    this.undo.dataset.rigUndo = "";
    this.undo.onclick = () => this.handlers.onUndo();
    this.redo = this.el("button", "Redo rig");
    this.redo.type = "button";
    this.redo.dataset.rigRedo = "";
    this.redo.onclick = () => this.handlers.onRedo();
    body.append(this.apply, this.undo, this.redo);

    this.status = this.el("div");
    this.status.dataset.rigStatus = "";
    this.status.setAttribute("role", "status");
    body.append(this.status);
    body.append(
      this.el(
        "small",
        "The rig is calculated from the camera when you press Use rig and is saved as ordinary lights in the scene. If you move or turn the camera afterwards nothing changes by itself; press Use rig again to recalculate from the new view. The rigs are starting points, not finished lighting, and a rim only appears if the shape of the subject lets the light through. Ambient light, fog, material, camera and spot/point lights are not touched.",
      ),
    );
    this.root.append(details);
    this.refresh();
  }

  private mode(): RigMode {
    return this.modes.add.checked ? "add" : "replace-directional";
  }

  /** Shows what pressing the button would do. Reads the scene; never writes. */
  private refresh(): void {
    const rig = LIGHT_RIGS.find((r) => r.id === this.select.value);
    this.description.textContent = rig?.description ?? "";
    if (!this.scene || !rig) {
      this.effect.textContent = "";
      this.apply.disabled = true;
    } else {
      const plan = planRig(this.scene, rig.id, this.mode());
      this.effect.textContent = plan.ok ? plan.summary : plan.message;
      this.apply.disabled = !plan.ok;
    }
    this.undo.disabled = !this.handlers.canUndo();
    this.redo.disabled = !this.handlers.canRedo();
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  /** Redraws from the scene (called whenever the lights panel is). */
  update(scene: Scene): void {
    this.scene = scene;
    this.refresh();
  }
}
