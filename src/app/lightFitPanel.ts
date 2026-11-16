import { readNumber, setInputValue } from "./numericRange";
import {
  DEFAULT_TARGET_ILLUMINATION,
  ILLUMINATION_PRESETS,
  MIN_LIGHT_DISTANCE,
  formatLightValue,
  illuminationFromSlider,
  sliderFromIllumination,
} from "../engine/lightScale";
import { LIGHT_LIMITS } from "../engine/lights";

export interface LightFitPanelHandlers {
  /** The artist moved the slider or pressed a preset. `begin` opens the Undo step of one gesture. */
  onLevel(level: number, begin: boolean): void;
}

/** What the panel shows about the light that was last aimed and fitted. Null when there is none (or it was moved). */
export interface LightFitReading {
  /** 1-based number of the light in the list, as the light card shows it. */
  number: number;
  distance: number;
  intensity: number;
  illumination: number;
}

/** Illumination at the aimed target, in artist terms. Plain DOM, text only. Building or updating never changes the scene. */
export class LightFitPanel {
  private slider!: HTMLInputElement;
  private presetButtons: HTMLButtonElement[] = [];
  private mode!: HTMLElement;
  private levelInfo!: HTMLElement;
  private intensityInfo!: HTMLElement;
  private warning!: HTMLElement;
  private gestureOpen = false;
  /** The level used by the next "Aim and fit light". Lives in the app only, not in the scene. */
  private wanted = DEFAULT_TARGET_ILLUMINATION;

  constructor(
    private root: HTMLElement,
    private handlers: LightFitPanelHandlers,
  ) {
    this.build();
  }

  /** The level the next "Aim and fit light" will give the target. */
  get level(): number {
    return this.wanted;
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  }

  private build(): void {
    const box = this.el("div");
    box.id = "light-fit";
    box.append(this.el("div", "Illumination at the target", "ctitle"));
    this.mode = this.el("div", "", "ainfo");
    this.mode.dataset.lightfitMode = "";
    box.append(this.mode);

    const row = this.el("label", "Illumination: dim ↔ strong");
    this.slider = this.el("input");
    this.slider.type = "range";
    this.slider.min = "0";
    this.slider.max = "1";
    this.slider.step = "0.001";
    this.slider.dataset.lightfitSlider = "";
    this.slider.dataset.numericCompanion = "external"; // the position is logarithmic; the readouts below carry the numbers
    this.slider.setAttribute("aria-label", "Illumination at the target");
    this.slider.title = "How much light hits the surface you aimed the light at. Changes the light's Strength when a light is aimed; otherwise the value applies the next time you aim a light.";
    setInputValue(this.slider, sliderFromIllumination(this.wanted));
    this.slider.addEventListener("input", () => {
      const begin = !this.gestureOpen;
      this.gestureOpen = true;
      this.wanted = illuminationFromSlider(readNumber(this.slider));
      this.handlers.onLevel(this.wanted, begin);
    });
    this.slider.addEventListener("change", () => (this.gestureOpen = false));
    row.append(this.slider);
    box.append(row);

    const presets = this.el("div");
    for (const preset of ILLUMINATION_PRESETS) {
      const b = this.el("button", preset.label);
      b.type = "button";
      b.dataset.lightfitPreset = preset.id;
      b.title = `Illumination at the target ${formatLightValue(preset.value)}` + (preset.value === DEFAULT_TARGET_ILLUMINATION ? " (about like the default sun)" : "");
      b.onclick = () => {
        this.wanted = preset.value;
        setInputValue(this.slider, sliderFromIllumination(preset.value));
        this.handlers.onLevel(preset.value, true);
      };
      this.presetButtons.push(b);
      presets.append(b);
    }
    box.append(presets);

    this.levelInfo = this.el("div", "", "ainfo");
    this.levelInfo.dataset.lightfitLevel = "";
    this.intensityInfo = this.el("div", "", "ainfo");
    this.intensityInfo.dataset.lightfitIntensity = "";
    this.warning = this.el("div", "", "ainfo");
    this.warning.dataset.lightfitWarning = "";
    box.append(this.levelInfo, this.intensityInfo, this.warning);
    box.append(
      this.el(
        "small",
        "Illumination at the target is the light that hits the surface head-on, before colour, material, angle, shadows, other lights, fog and exposure. It is not the final brightness of the picture. The light's own Strength (at distance 1) stays on the light card and can be set exactly there.",
      ),
    );
    this.root.append(box);
  }

  /** Redraws from what the scene says. The slider thumb follows the real light while one is aimed, and the wanted level otherwise. */
  update(reading: LightFitReading | null): void {
    if (reading) {
      if (!this.gestureOpen) setInputValue(this.slider, sliderFromIllumination(reading.illumination));
      this.mode.textContent = `Light ${reading.number} is aimed and fitted. The slider changes its Strength (one Undo step per drag).`;
      this.levelInfo.textContent = `Illumination at the target: ${formatLightValue(reading.illumination)} (distance from the light ${formatLightValue(reading.distance)} scene units).`;
      this.intensityInfo.textContent = `The light's Strength at distance 1: ${formatLightValue(reading.intensity)}.`;
      const warnings: string[] = [];
      if (reading.distance < MIN_LIGHT_DISTANCE) warnings.push(`The target is closer than ${MIN_LIGHT_DISTANCE}: the light does not get stronger any closer.`);
      if (reading.intensity >= LIGHT_LIMITS.intensity[1]) warnings.push("The strength is at its upper limit.");
      if (reading.illumination > 8) warnings.push("Very high illumination: surfaces with a light colour can become overexposed.");
      this.warning.textContent = warnings.join(" ");
    } else {
      if (!this.gestureOpen) setInputValue(this.slider, sliderFromIllumination(this.wanted));
      this.mode.textContent = "No aimed light right now. The slider chooses the level for the next time you press Aim and fit light on a spot light.";
      this.levelInfo.textContent = `Wanted illumination at the target: ${formatLightValue(this.wanted)}.`;
      this.intensityInfo.textContent = "";
      this.warning.textContent = "";
    }
  }
}
