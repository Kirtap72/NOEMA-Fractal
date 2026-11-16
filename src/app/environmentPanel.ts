import { readNumber, setInputValue, isNumericEditing } from './numericRange';
import { ENV_INTENSITY_LIMITS, MAX_ENV_TEXT } from "../engine";
import type { EnvironmentSettings, HdriEnvironment } from "../engine";

export interface EnvironmentPanelHandlers {
  /** The user picked a .hdr file. */
  onPickFile(file: File): void;
  /** The user changed a field of the picture (already checked). */
  onChange(changes: Partial<HdriEnvironment>): void;
  /** The user went back to the gradient sky. */
  onClear(): void;
}

/** Environment: the gradient sky, or an HDRI picture that is seen behind the shape and lights it. Builds plain DOM; text only. */
export class EnvironmentPanel {
  private file!: HTMLInputElement;
  private nameLabel!: HTMLSpanElement;
  private clear!: HTMLButtonElement;
  private body!: HTMLDivElement;
  private author!: HTMLInputElement;
  private source!: HTMLInputElement;
  private license!: HTMLInputElement;
  private rotation!: HTMLInputElement;
  private rotationValue!: HTMLSpanElement;
  private intensity!: HTMLInputElement;
  private intensityValue!: HTMLSpanElement;
  private background!: HTMLInputElement;
  private note!: HTMLDivElement;

  constructor(
    private root: HTMLElement,
    private handlers: EnvironmentPanelHandlers,
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

  private text(placeholder: string, title: string, key: "author" | "source" | "license"): HTMLInputElement {
    const input = this.el("input");
    input.type = "text";
    input.maxLength = MAX_ENV_TEXT;
    input.placeholder = placeholder;
    input.title = title;
    input.addEventListener("change", () => {
      const v = input.value.trim();
      if (key !== "author" && v.length === 0) {
        input.value = this.last?.kind === "hdri" ? this.last[key] : "";
        return;
      }
      this.handlers.onChange({ [key]: v });
    });
    return input;
  }

  private build(): void {
    this.root.append(this.el("div", "ctitle", "Environment (HDRI)"));
    this.file = this.el("input");
    this.file.type = "file";
    this.file.accept = ".hdr";
    this.file.title = "A Radiance .hdr picture, twice as wide as it is high (for example 2048 × 1024). It is shrunk to at most 1024 × 512 and saved in the scene.";
    this.file.addEventListener("change", () => {
      const f = this.file.files?.[0];
      this.file.value = "";
      if (f) this.handlers.onPickFile(f);
    });
    this.root.append(this.row("Picture", this.file));

    this.body = this.el("div");
    this.body.style.display = "flex";
    this.body.style.flexDirection = "column";
    this.body.style.gap = "5px";
    this.root.append(this.body);

    this.nameLabel = this.el("span", "tname");
    this.clear = this.el("button", undefined, "Remove");
    this.clear.type = "button";
    this.clear.addEventListener("click", () => this.handlers.onClear());
    const nameRow = this.el("div", "arow");
    nameRow.append(this.el("span", undefined, "Chosen picture"), this.nameLabel);
    this.body.append(nameRow, this.clear);

    this.source = this.text("Link or reference", "Where the picture comes from (required, see LICENSING.md section 9)", "source");
    this.license = this.text("for example CC0 1.0", "The license of the picture (required)", "license");
    this.author = this.text("Author (if known)", "Who made the picture, as far as you know", "author");
    this.body.append(this.row("Source", this.source), this.row("License", this.license), this.row("Author", this.author));
    this.note = this.el("div", "ainfo", "Source and license follow the scene and exported files and are shown as unverified.");
    this.body.append(this.note);

    this.rotation = this.el("input");
    this.rotation.type = "range";
    this.rotation.min = "-180";
    this.rotation.max = "180";
    this.rotation.step = "1";
    this.rotation.title = "Rotates the picture around the vertical axis";
    this.rotationValue = this.el("span", "value");
    this.rotation.addEventListener("input", () => this.handlers.onChange({ rotation_degrees: readNumber(this.rotation) }));
    const rotationRow = this.row("Rotation", this.rotation, this.rotationValue);
    rotationRow.className = "arow dense";
    this.body.append(rotationRow);

    this.intensity = this.el("input");
    this.intensity.type = "range";
    this.intensity.min = String(ENV_INTENSITY_LIMITS[0]);
    this.intensity.max = "8";
    this.intensity.step = "0.01";
    this.intensity.title = "How strongly the picture shines (exposure). Applies to both background and light.";
    this.intensityValue = this.el("span", "value");
    this.intensity.addEventListener("input", () => this.handlers.onChange({ intensity: readNumber(this.intensity) }));
    const intensityRow = this.row("Strength", this.intensity, this.intensityValue);
    intensityRow.className = "arow dense";
    this.body.append(intensityRow);

    this.background = this.el("input");
    this.background.type = "checkbox";
    this.background.title = "Show the picture behind the shape. Otherwise the sky gradient is seen, but the light still comes from the picture.";
    this.background.addEventListener("change", () => this.handlers.onChange({ background_visible: this.background.checked }));
    this.body.append(this.row("Show as background", this.background));
  }

  private last: EnvironmentSettings | null = null;

  /** Shows the scene's environment. Leaves a field alone while it is being used. */
  update(env: EnvironmentSettings): void {
    this.last = env;
    const hdri = env.kind === "hdri";
    this.body.style.display = hdri ? "flex" : "none";
    if (!hdri) return;
    this.nameLabel.textContent = env.name ?? "(picture)";
    if (!isNumericEditing(this.source)) this.source.value = env.source;
    if (!isNumericEditing(this.license)) this.license.value = env.license;
    if (!isNumericEditing(this.author)) this.author.value = env.author ?? "";
    setInputValue(this.rotation, env.rotation_degrees);
    this.rotationValue.textContent = `${Math.round(env.rotation_degrees)}°`;
    setInputValue(this.intensity, env.intensity);
    this.intensityValue.textContent = env.intensity.toFixed(2);
    this.background.checked = env.background_visible;
  }
}
