import { QUALITY_PRESETS, describeQuality } from "../engine/qualityLevels";
import type { QualitySettings } from "../engine";
import type { ProgressiveStill } from "./progressiveStill";
import "./qualityLevels.css";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e;
};

export interface RenderBarHost {
  quality(): QualitySettings;
  applyPreset(id: string): void;
  progressive: ProgressiveStill;
  /** The existing buttons, bar and status of the still panel, moved here so they are always at the top of the Render tab. */
  actions: { render: HTMLButtonElement; cancel: HTMLButtonElement; bar: HTMLProgressElement; status: HTMLElement };
  /** True while an ordinary render (or anything else that holds the renderer) runs. */
  busy(): boolean;
}

/**
 * The top of the Render tab: quality level, Rendera stillbild, Progressiv rendering, Stoppa and Spara, with progress and status.
 * It owns no settings: the buttons call the same code as before, and the presets write the same quality fields as the panel below.
 */
export class RenderBar {
  readonly root = el("section", "panel render-bar");
  private readonly presets = new Map<string, HTMLButtonElement>();
  private readonly progressiveButton = el("button", "rb-progressive", "Progressive render");
  private readonly stopButton = el("button", "rb-stop", "Stop");
  private readonly saveButton = el("button", "rb-save", "Save best picture");
  private readonly clearButton = el("button", "rb-clear", "Hide picture");
  private readonly line = el("p", "rb-line");
  private readonly progress = el("progress", "rb-progress");

  constructor(private readonly host: RenderBarHost) {
    this.root.id = "render-bar";
    const levels = el("div", "ql-presets"); levels.setAttribute("role", "group"); levels.setAttribute("aria-label", "Quality level");
    for (const p of QUALITY_PRESETS) {
      const b = el("button", "", p.label); b.type = "button"; b.dataset.preset = p.id; b.title = p.hint;
      b.onclick = () => { host.applyPreset(p.id); this.update(); };
      this.presets.set(p.id, b); levels.append(b);
    }
    const { render, cancel, bar, status } = host.actions;
    render.classList.add("rb-render");
    this.progressiveButton.type = "button"; this.stopButton.type = this.saveButton.type = this.clearButton.type = "button";
    this.progressiveButton.title = "Draws the picture in several steps that get better and better: first a quick picture, then a finer surface, then more samples. You can stop whenever you like and save the best finished picture.";
    this.stopButton.title = "Stops the progressive render. The best finished picture is kept.";
    this.saveButton.title = "Saves the best finished picture as PNG.";
    this.clearButton.title = "Removes the progressive picture from the view.";
    this.progressiveButton.onclick = () => void host.progressive.start();
    this.stopButton.onclick = () => host.progressive.stop();
    this.saveButton.onclick = async () => { try { this.line.textContent = await host.progressive.save(); } catch (e) { this.line.textContent = `Saving was interrupted: ${String(e instanceof Error ? e.message : e)}`; } };
    this.clearButton.onclick = () => host.progressive.clear();
    const row = el("div", "rb-actions"); row.append(render, this.progressiveButton, this.stopButton, cancel);
    const after = el("div", "rb-actions"); after.append(this.saveButton, this.clearButton);
    this.line.setAttribute("role", "status"); this.line.setAttribute("aria-live", "polite");
    this.progress.max = 1; this.progress.hidden = true;
    this.root.append(el("span", "rb-title", "Render"), levels, row, this.progress, this.line, bar, status, after);
    host.progressive.onChange(() => this.update());
    this.update();
  }

  /** Brings the buttons in line with the scene and the state of the progressive render (called often; cheap). */
  update(): void {
    const p = this.host.progressive, q = this.host.quality(), d = describeQuality(q);
    for (const preset of QUALITY_PRESETS) this.presets.get(preset.id)!.setAttribute("aria-pressed", String(d.geometry === preset.geometry && d.antialias === preset.antialias && d.shadows === preset.shadows));
    const busyElsewhere = this.host.busy() && !p.active;
    this.progressiveButton.disabled = p.active || busyElsewhere;
    this.stopButton.hidden = !p.active;
    this.saveButton.hidden = !p.canSave; this.clearButton.hidden = !p.canSave && p.overlay.hidden;
    this.progress.hidden = !p.active; this.progress.value = p.fraction;
    if (p.line) this.line.textContent = p.line; else if (!this.line.textContent) this.line.textContent = "";
    this.root.dataset.progressive = p.state;
  }
}
