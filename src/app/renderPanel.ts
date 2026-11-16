export interface RenderSettings {
  /** A series of PNG images (with optional layers), or one video file. */
  output: "images" | "video";
  quality: "low" | "medium" | "high";
  /** 1 = every frame, 3 = every third frame. */
  step: number;
  /** Extra picture files saved next to each colour image. */
  layers: "none" | "depth" | "depth+normal";
  target: "folder" | "zip";
}

export interface RenderPanelHandlers {
  onTest(): void;
  onRender(): void;
  onCancel(): void;
}

/** Settings and progress for rendering an image sequence or a video. Image size and detail are set in the panels above. */
export class RenderPanel {
  private step!: HTMLInputElement;
  private layers!: HTMLSelectElement;
  private target!: HTMLSelectElement;
  private output!: HTMLSelectElement;
  private quality!: HTMLSelectElement;
  private testButton!: HTMLButtonElement;
  private renderButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private status!: HTMLDivElement;
  private bar!: HTMLProgressElement;
  private detail!: HTMLDivElement;

  constructor(
    private root: HTMLElement,
    private handlers: RenderPanelHandlers,
    folderSupported: boolean,
  ) {
    this.build(folderSupported);
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private row(label: string, control: HTMLElement): HTMLElement {
    const r = this.el("label", "arow");
    r.append(this.el("span", undefined, label), control);
    return r;
  }

  private build(folderSupported: boolean): void {
    this.root.append(this.el("div", "ctitle", "Render film (picture sequence or video)"));
    this.detail = this.el("div", "rstatus");
    this.root.append(this.detail);

    this.step = this.el("input");
    this.step.type = "number";
    this.step.min = "1";
    this.step.value = "1";
    this.root.append(this.row("Render every Nth frame", this.step));

    this.output = this.el("select");
    this.output.add(new Option("Picture sequence (PNG pictures)", "images"));
    this.output.add(new Option("Video file (WebM, VP9)", "video"));
    this.root.append(this.row("Output", this.output));
    this.quality = this.el("select");
    this.quality.add(new Option("Low quality (small file)", "low"));
    this.quality.add(new Option("Medium", "medium"));
    this.quality.add(new Option("High quality (large file)", "high"));
    this.quality.value = "medium";
    const qualityRow = this.row("Video quality", this.quality);
    qualityRow.hidden = true;
    this.output.addEventListener("change", () => {
      const video = this.output.value === "video";
      qualityRow.hidden = !video;
      this.layers.disabled = video; // depth and normals are separate image files
      this.target.disabled = video; // a video is one file that is downloaded
      if (video) this.layers.value = "none";
    });
    this.root.append(qualityRow);

    this.layers = this.el("select");
    this.layers.add(new Option("Colour picture only", "none"));
    this.layers.add(new Option("Colour + depth (OpenEXR)", "depth"));
    this.layers.add(new Option("Colour + depth + normals (OpenEXR)", "depth+normal"));
    this.root.append(this.row("Layers", this.layers));

    this.target = this.el("select");
    if (folderSupported) this.target.add(new Option("Save in a folder (recommended)", "folder"));
    this.target.add(new Option("Download as a ZIP file", "zip"));
    this.root.append(this.row("Save", this.target));

    const buttons = this.el("div", "rbuttons");
    this.testButton = this.el("button", undefined, "Test render (small)");
    this.testButton.title = "Low resolution, few frames: to check the camera path quickly";
    this.testButton.addEventListener("click", () => this.handlers.onTest());
    this.renderButton = this.el("button", undefined, "Render");
    this.renderButton.addEventListener("click", () => this.handlers.onRender());
    this.cancelButton = this.el("button", undefined, "Cancel");
    this.cancelButton.hidden = true;
    this.cancelButton.addEventListener("click", () => this.handlers.onCancel());
    buttons.append(this.testButton, this.renderButton, this.cancelButton);
    this.root.append(buttons);

    this.bar = this.el("progress");
    this.bar.hidden = true;
    this.status = this.el("div", "rstatus");
    this.root.append(this.bar, this.status);
  }

  /** The settings as the user entered them, or an error text if something is wrong. */
  settings(): { ok: true; value: RenderSettings } | { ok: false; error: string } {
    const step = Number(this.step.value);
    if (!Number.isInteger(step) || step < 1) return { ok: false, error: "Every Nth frame must be an integer, 1 or more." };
    return {
      ok: true,
      value: {
        output: this.output.value === "video" ? "video" : "images",
        quality: this.quality.value === "low" || this.quality.value === "high" ? this.quality.value : "medium",
        step,
        layers: this.layers.value === "depth" || this.layers.value === "depth+normal" ? this.layers.value : "none",
        target: this.target.value === "zip" ? "zip" : "folder",
      },
    };
  }

  /** A line saying which detail settings the film uses (they are set in the still picture panel). */
  showDetail(text: string): void {
    this.detail.textContent = text;
  }

  setBusy(busy: boolean): void {
    this.testButton.disabled = busy;
    this.renderButton.disabled = busy;
    this.cancelButton.hidden = !busy;
    this.bar.hidden = !busy;
    for (const c of [this.step, this.layers, this.target, this.output, this.quality]) c.disabled = busy;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setProgress(done: number, total: number): void {
    this.bar.max = total;
    this.bar.value = done;
  }
}
