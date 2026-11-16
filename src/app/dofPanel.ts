import { readNumber, setInputValue } from "./numericRange";
import {
  RELATIVE_DOF_MAX,
  RELATIVE_DOF_PRESETS,
  backgroundBlurPixels,
  dofGeometry,
  effectiveCameraSamples,
  relativeAperture,
  relativeFromSlider,
  sharpRange,
  sliderFromRelative,
} from "../engine/focusScale";
import type { Film } from "../engine/focusScale";
import type { Scene } from "../engine/scene";

export interface DofPanelHandlers {
  /** Start "Fokusera här": the next click on a surface sets the focus. */
  onFocusHere(): void;
  onCancelFocus(): void;
  /** Explicit on/off, one Undo step. */
  onEnabled(enabled: boolean): void;
  /** The relative aperture (blur of the far background as a fraction of the image height). `begin` opens the Undo step of one gesture. */
  onRelative(relative: number, begin: boolean): void;
  onUndo(): void;
  onRedo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** The film the final picture is rendered on. */
  film(): Film;
  /** Height in pixels of the picture the LookDev preview is drawn on, if known. */
  previewHeight(): number | null;
}

/** LookDev's depth-based blur never exceeds this radius (previewDof.ts `maxRadius`). */
const LOOKDEV_MAX_BLUR_PX = 20;

/** Focus and depth of field for artists. Plain DOM, text only. The scene is never changed by building or updating the panel. */
export class DofPanel {
  private focusButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private enabled!: HTMLInputElement;
  private slider!: HTMLInputElement;
  private presetButtons: HTMLButtonElement[] = [];
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private focusInfo!: HTMLElement;
  private blurInfo!: HTMLElement;
  private rangeInfo!: HTMLElement;
  private absoluteInfo!: HTMLElement;
  private samplesInfo!: HTMLElement;
  private previewNote!: HTMLElement;
  private status!: HTMLElement;
  private body!: HTMLElement;
  /** One slider drag is one Undo step: the first input opens it, the change event closes it. */
  private gestureOpen = false;
  private focusMessage = "";

  constructor(
    private root: HTMLElement,
    private handlers: DofPanelHandlers,
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
    details.id = "dof-artist";
    details.append(this.el("summary", "Focus and depth of field"));
    this.body = this.el("div");
    details.append(this.body);
    this.root.append(details);

    this.focusButton = this.el("button", "Focus here");
    this.focusButton.title = "Then click a surface in the picture. The focus is set on the surface without the camera being moved or turned.";
    this.focusButton.dataset.dofFocus = "";
    this.focusButton.onclick = () => this.handlers.onFocusHere();
    this.cancelButton = this.el("button", "Cancel focus pick");
    this.cancelButton.dataset.dofCancel = "";
    this.cancelButton.hidden = true;
    this.cancelButton.onclick = () => this.handlers.onCancelFocus();
    this.focusInfo = this.el("div", "", "ainfo");
    this.focusInfo.dataset.dofFocusInfo = "";
    this.status = this.el("div", "");
    this.status.dataset.dofStatus = "";
    this.status.setAttribute("role", "status");
    this.body.append(this.focusButton, this.cancelButton, this.focusInfo, this.status);

    const enabledRow = this.el("label", "Blur (DOF) on");
    this.enabled = this.el("input");
    this.enabled.type = "checkbox";
    this.enabled.setAttribute("aria-label", "Blur (DOF) on");
    this.enabled.dataset.dofEnabled = "";
    this.enabled.onchange = () => this.handlers.onEnabled(this.enabled.checked);
    enabledRow.append(this.enabled);
    this.body.append(enabledRow);

    const sliderRow = this.el("label", "Depth of field: deep ↔ shallow");
    this.slider = this.el("input");
    this.slider.type = "range";
    this.slider.min = "0";
    this.slider.max = "1";
    this.slider.step = "0.001";
    this.slider.dataset.dofSlider = "";
    this.slider.dataset.numericCompanion = "external"; // the position has no meaning in itself; the readouts below do
    this.slider.setAttribute("aria-label", "Depth of field: deep to shallow");
    this.slider.title = "To the right only a narrower zone becomes sharp. The value is relative to the focus distance and the picture height.";
    setInputValue(this.slider, 0);
    this.slider.addEventListener("input", () => {
      const begin = !this.gestureOpen;
      this.gestureOpen = true;
      this.handlers.onRelative(relativeFromSlider(readNumber(this.slider)), begin);
    });
    this.slider.addEventListener("change", () => (this.gestureOpen = false));
    sliderRow.append(this.slider);
    this.body.append(sliderRow);

    const presets = this.el("div");
    for (const preset of RELATIVE_DOF_PRESETS) {
      const b = this.el("button", preset.label);
      b.dataset.dofPreset = preset.id;
      b.title = `Background blur ${(preset.value * 100).toFixed(1)} % of the picture height`;
      b.onclick = () => this.handlers.onRelative(preset.value, true);
      this.presetButtons.push(b);
      presets.append(b);
    }
    this.body.append(presets);

    this.blurInfo = this.el("div", "", "ainfo");
    this.blurInfo.dataset.dofBlur = "";
    this.rangeInfo = this.el("div", "", "ainfo");
    this.absoluteInfo = this.el("div", "", "ainfo");
    this.samplesInfo = this.el("div", "", "ainfo");
    this.previewNote = this.el("div", "", "ainfo");
    this.body.append(this.blurInfo, this.rangeInfo, this.absoluteInfo, this.samplesInfo, this.previewNote);

    this.undoButton = this.el("button", "Undo focus/DOF");
    this.undoButton.dataset.dofUndo = "";
    this.undoButton.onclick = () => this.handlers.onUndo();
    this.redoButton = this.el("button", "Redo focus/DOF");
    this.redoButton.dataset.dofRedo = "";
    this.redoButton.onclick = () => this.handlers.onRedo();
    this.body.append(this.undoButton, this.redoButton);
    this.body.append(
      this.el(
        "small",
        "The slider states how blurry an infinitely distant background becomes, as a share of the picture height. It is not an f-number: two lenses with the same value get the same background blur in the picture, not necessarily the same bokeh as real lenses. The absolute values (focus distance, aperture radius in scene units) remain under Camera / composition.",
      ),
    );
  }

  /** Sets the message shown under the buttons (pick progress and results). */
  setStatus(text: string): void {
    this.focusMessage = text;
    this.status.textContent = text;
  }

  /** Shows whether a pick is armed or running. */
  setPicking(armed: boolean, busy: boolean): void {
    this.cancelButton.hidden = !armed && !busy;
    this.focusButton.disabled = armed || busy;
  }

  /** Redraws from the scene. Reading never writes anything. `savedSamples` is the saved samples per pixel of the final image. */
  update(scene: Scene, savedSamples: number): void {
    const camera = scene.camera;
    const film = this.handlers.film();
    const dof = camera.dof;
    const orthographic = camera.projection === "orthographic";
    this.enabled.checked = !!dof?.enabled;
    this.enabled.disabled = orthographic;
    this.focusButton.title = orthographic
      ? "Focus only applies to perspective cameras."
      : "Then click a surface in the picture. The focus is set on the surface without the camera being moved or turned.";
    this.undoButton.disabled = !this.handlers.canUndo();
    this.redoButton.disabled = !this.handlers.canRedo();
    this.status.textContent = this.focusMessage;

    let geometry: ReturnType<typeof dofGeometry> | null = null;
    let relative: number | null = null;
    let problem = "";
    try {
      geometry = dofGeometry(camera, scene.render.fov_axis, film);
      relative = relativeAperture(camera, scene.render.fov_axis, film);
    } catch (e) {
      problem = e instanceof RangeError ? e.message : String(e);
    }
    const usable = geometry !== null && relative !== null;
    this.slider.disabled = !usable;
    for (const b of this.presetButtons) b.disabled = !usable;
    if (orthographic) problem = "DOF is not supported with an orthographic camera.";

    const mode = dof?.focus_mode === "manual" ? "set on a surface or a value" : "follows the navigation target (pivot)";
    this.focusInfo.textContent = geometry
      ? `Focus distance ${geometry.focus.toPrecision(5)} scene units along the optical axis (${mode}).`
      : problem
        ? "Focus: " + problem
        : "";

    if (!usable || geometry === null || relative === null) {
      this.blurInfo.textContent = problem ? "Depth of field cannot be calculated: " + problem : "";
      this.rangeInfo.textContent = "";
      this.absoluteInfo.textContent = "";
    } else {
      // The slider shows the saved value; while the artist drags it, leave the thumb where the hand put it.
      if (!this.gestureOpen) setInputValue(this.slider, sliderFromRelative(relative));
      const px = backgroundBlurPixels(relative, film.height);
      const outside = relative > RELATIVE_DOF_MAX;
      this.blurInfo.textContent =
        `Background blur: ${(relative * 100).toPrecision(3)} % of the picture height, about ${px.toPrecision(3)} px on a ${film.height} px high picture.` +
        (outside ? " The value is above the range of the slider and is not changed until you move the slider." : "");
      const range = sharpRange(relative, geometry.focus, film.height, 1);
      this.rangeInfo.textContent =
        relative === 0
          ? "No blur: everything is sharp."
          : `Sharp (at most 1 px blur): ${range.near.toPrecision(4)} to ${Number.isFinite(range.far) ? range.far.toPrecision(4) : "infinity"} scene units from the camera.`;
      this.absoluteInfo.textContent = `Absolute aperture radius: ${(dof?.aperture_radius ?? 0).toPrecision(4)} scene units (unchanged until you change the slider).`;
    }

    const effective = effectiveCameraSamples(savedSamples, camera);
    this.samplesInfo.textContent =
      dof?.enabled && !orthographic
        ? effective > savedSamples
          ? `DOF uses at least 16 camera samples per pixel in the LookDev still picture and the final picture: ${effective} (saved ${savedSamples}).`
          : `DOF uses ${effective} camera samples per pixel.`
        : "DOF is off. With DOF on, at least 16 camera samples per pixel are calculated.";
    const previewHeight = this.handlers.previewHeight();
    const previewPx = relative !== null && previewHeight ? backgroundBlurPixels(relative, previewHeight) : 0;
    this.previewNote.textContent =
      previewPx > LOOKDEV_MAX_BLUR_PX && dof?.enabled
        ? `The LookDev preview limits the blur to ${LOOKDEV_MAX_BLUR_PX} px (here it would be ${previewPx.toFixed(0)} px). The still picture is not limited.`
        : "";
  }
}
