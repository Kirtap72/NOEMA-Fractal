import {
  checkOutputSize,
  MAX_LONG_SIDE,
  outputCost,
  outputSize,
  readRenderSetup,
} from "../engine";
import type { RenderSetup } from "../engine";

export interface FormatPanelHandlers {
  /** The image format, size or field of view direction was changed (always a valid setup). */
  onSetup(setup: RenderSetup): void;
}

const FORMATS: [string, string][] = [
  ["free", "Free (follows the window)"],
  ["16:9", "16:9 (wide film)"],
  ["3:2", "3:2 (photo)"],
  ["2:3", "2:3 (portrait photo)"],
  ["1:1", "1:1 (square)"],
  ["4:3", "4:3"],
  ["3:4", "3:4 (portrait)"],
  ["9:16", "9:16 (portrait video)"],
  ["21:9", "21:9 (wide cinema)"],
  ["4:5", "4:5 (portrait)"],
  ["5:4", "5:4 (landscape)"],
  ["A4 portrait", "A4 portrait"],
  ["A4 landscape", "A4 landscape"],
  ["custom", "Custom proportions …"],
];

const LONG_SIDES: [string, string][] = [
  ["1280", "1280 (HD)"],
  ["1920", "1920 (Full HD)"],
  ["2560", "2560"],
  ["3840", "3840 (4K)"],
  ["5120", "5120 (5K)"],
  ["7680", "7680 (8K)"],
  ["12288", "12288 (12K)"],
  ["16384", "16384 (16K)"],
  ["custom", "Custom length …"],
];

/** Image format, size and field of view direction: one setting for the preview, still pictures and image sequences. */
export class FormatPanel {
  private format!: HTMLSelectElement;
  private ratioRow!: HTMLDivElement;
  private ratioW!: HTMLInputElement;
  private ratioH!: HTMLInputElement;
  private longSide!: HTMLSelectElement;
  private longRow!: HTMLDivElement;
  private longInput!: HTMLInputElement;
  private fovAxis!: HTMLSelectElement;
  private sizeLabel!: HTMLDivElement;
  private windowAspect = 16 / 9;
  private mode!: HTMLSelectElement;
  private manualRow!: HTMLElement;
  private width!: HTMLInputElement;
  private height!: HTMLInputElement;

  constructor(
    private root: HTMLElement,
    private handlers: FormatPanelHandlers,
  ) {
    this.build();
  }

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
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

  private build(): void {
    this.root.append(this.el("div", "ctitle", "Picture format and size"));
    this.mode = this.el("select");
    this.mode.setAttribute("aria-label", "Resolution mode");
    this.mode.add(new Option("Format + longest side", "format"));
    this.mode.add(new Option("Manual / Custom resolution", "manual"));
    this.root.append(this.row("Resolution mode", this.mode));
    this.width = this.el("input");
    this.height = this.el("input");
    for (const [input, label, value] of [
      [this.width, "Output width", "1920"],
      [this.height, "Output height", "1080"],
    ] as const) {
      input.type = "number";
      input.min = "1";
      input.max = String(MAX_LONG_SIDE);
      input.step = "1";
      input.value = value;
      input.setAttribute("aria-label", label);
    }
    this.manualRow = this.row("Width × height (px)", this.width, this.height);
    this.manualRow.hidden = true;
    this.root.append(this.manualRow);
    this.format = this.el("select");
    this.format.setAttribute("aria-label", "Picture format");
    for (const [value, label] of FORMATS)
      this.format.add(new Option(label, value));
    this.root.append(this.row("Picture format", this.format));

    this.ratioRow = this.el("div", "arow");
    this.ratioRow.hidden = true;
    this.ratioW = this.el("input");
    this.ratioH = this.el("input");
    for (const [input, v] of [
      [this.ratioW, "5"],
      [this.ratioH, "4"],
    ] as const) {
      input.type = "number";
      input.min = "0.1";
      input.step = "any";
      input.value = v;
    }
    this.ratioW.setAttribute("aria-label", "Picture proportion width");
    this.ratioH.setAttribute("aria-label", "Picture proportion height");
    this.ratioRow.append(
      this.el("span", undefined, "Width : height"),
      this.ratioW,
      this.ratioH,
    );
    this.root.append(this.ratioRow);

    this.longSide = this.el("select");
    for (const [value, label] of LONG_SIDES)
      this.longSide.add(new Option(label, value));
    this.longSide.value = "1920";
    this.longSide.title =
      "The number of pixels on the longest side of the picture. The other side follows the picture format.";
    this.root.append(this.row("Longest side", this.longSide));
    this.longRow = this.el("div", "arow");
    this.longRow.hidden = true;
    this.longInput = this.el("input");
    this.longInput.type = "number";
    this.longInput.min = "16";
    this.longInput.max = String(MAX_LONG_SIDE);
    this.longInput.value = "1920";
    this.longRow.append(
      this.el("span", undefined, "Pixels"),
      this.longInput,
    );
    this.root.append(this.longRow);

    this.fovAxis = this.el("select");
    this.fovAxis.add(new Option("Vertical (as before)", "vertical"));
    this.fovAxis.add(new Option("Horizontal", "horizontal"));
    this.fovAxis.title =
      "Which direction the field of view of the camera (the angle in the camera row) is measured";
    this.root.append(this.row("Field of view is measured", this.fovAxis));
    this.sizeLabel = this.el("div", "rstatus");
    this.root.append(this.sizeLabel);

    const changed = (): void => {
      this.ratioRow.hidden = this.format.value !== "custom";
      this.longRow.hidden = this.longSide.value !== "custom";
      this.manualRow.hidden = this.mode.value !== "manual";
      this.format.disabled =
        this.longSide.disabled =
        this.ratioW.disabled =
        this.ratioH.disabled =
        this.longInput.disabled =
          this.mode.value === "manual";
      const parsed = this.readSetup();
      this.showSize(parsed);
      if (parsed.ok) this.handlers.onSetup(parsed.value);
    };
    for (const c of [
      this.mode,
      this.width,
      this.height,
      this.format,
      this.longSide,
      this.fovAxis,
      this.ratioW,
      this.ratioH,
      this.longInput,
    ])
      c.addEventListener("change", changed);
    for (const c of [this.width, this.height])
      c.addEventListener("input", changed);
  }

  /** Checks exact/manual dimensions with scene rules; stored final quality is carried along unchanged. */
  readSetup(
    quality?: RenderSetup["quality"],
  ): { ok: true; value: RenderSetup } | { ok: false; error: string } {
    const long =
      this.longSide.value === "custom"
        ? Number(this.longInput.value)
        : Number(this.longSide.value);
    const errors: string[] = [];
    const format =
      this.format.value === "custom"
        ? {
            preset: "custom",
            ratio: [Number(this.ratioW.value), Number(this.ratioH.value)],
          }
        : { preset: this.format.value };
    const value = readRenderSetup(
      {
        format,
        fov_axis: this.fovAxis.value,
        long_side: long,
        ...(this.mode.value === "manual"
          ? {
              resolution: {
                width: Number(this.width.value),
                height: Number(this.height.value),
              },
            }
          : {}),
        ...(quality ? { quality } : {}),
      },
      "picture format",
      errors,
    );
    if (!value) return { ok: false, error: errors.join("; ") };
    const { width, height } = outputSize(value, this.windowAspect);
    const problem = checkOutputSize(width, height);
    return problem
      ? { ok: false, error: `The picture ${width} × ${height}: ${problem}` }
      : { ok: true, value };
  }

  private showSize(
    parsed: { ok: true; value: RenderSetup } | { ok: false; error: string },
  ): void {
    if (!parsed.ok) {
      this.sizeLabel.textContent = parsed.error;
      this.sizeLabel.style.color = "#fc8";
      return;
    }
    const { width, height } = outputSize(parsed.value, this.windowAspect);
    this.sizeLabel.style.color = "";
    const cost = outputCost(width, height),
      mib = (n: number) => (n / 2 ** 20).toFixed(0) + " MiB";
    this.sizeLabel.textContent = `${width} × ${height} · ${(width / height).toFixed(5)}:1 · ${cost.megapixels.toFixed(2)} MP. RGBA ${mib(cost.rgbaBytes)}, colour+layers ${mib(cost.layerBytes)}, RGB ${mib(cost.rgbBytes)} before PNG compression. PNG can be written row by row to a file. ${cost.warning ?? ""}`;
  }

  /** Shows the scene's own format, size and field of view direction. Leaves a field alone while it is being typed in. */
  showSetup(setup: RenderSetup, windowAspect: number): void {
    this.windowAspect = windowAspect;
    const active = document.activeElement;
    if (active !== this.mode)
      this.mode.value = setup.resolution ? "manual" : "format";
    const size = outputSize(setup, windowAspect);
    if (active !== this.width) this.width.value = String(size.width);
    if (active !== this.height) this.height.value = String(size.height);
    this.manualRow.hidden = this.mode.value !== "manual";
    if (active !== this.format) this.format.value = setup.format.preset;
    this.ratioRow.hidden = setup.format.preset !== "custom";
    if (
      setup.format.preset === "custom" &&
      setup.format.ratio &&
      active !== this.ratioW &&
      active !== this.ratioH
    ) {
      this.ratioW.value = String(setup.format.ratio[0]);
      this.ratioH.value = String(setup.format.ratio[1]);
    }
    if (setup.format.preset !== "custom" && setup.format.preset !== "free") {
      const ratio =
        setup.format.preset === "A4 portrait"
          ? [210, 297]
          : setup.format.preset === "A4 landscape"
            ? [297, 210]
            : setup.format.preset.split(":").map(Number);
      this.ratioW.value = String(ratio[0]);
      this.ratioH.value = String(ratio[1]);
    }
    const known = LONG_SIDES.some(([v]) => v === String(setup.long_side));
    if (active !== this.longSide && active !== this.longInput) {
      this.longSide.value = known ? String(setup.long_side) : "custom";
      this.longInput.value = String(setup.long_side);
    }
    this.longRow.hidden = this.longSide.value !== "custom";
    if (active !== this.fovAxis) this.fovAxis.value = setup.fov_axis;
    for (const c of [
      this.format,
      this.longSide,
      this.ratioW,
      this.ratioH,
      this.longInput,
    ])
      c.disabled = this.mode.value === "manual";
    this.showSize(this.readSetup(setup.quality));
  }

  setBusy(busy: boolean): void {
    for (const c of [
      this.mode,
      this.width,
      this.height,
      this.format,
      this.ratioW,
      this.ratioH,
      this.longSide,
      this.longInput,
      this.fovAxis,
    ])
      c.disabled =
        busy ||
        (this.mode.value === "manual" &&
          [
            this.format,
            this.ratioW,
            this.ratioH,
            this.longSide,
            this.longInput,
          ].includes(c as HTMLInputElement & HTMLSelectElement));
  }
}
