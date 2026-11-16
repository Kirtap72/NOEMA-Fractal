import { readNumber, setInputValue, isNumericEditing } from './numericRange';
import { DEPTH_FOG_LIMITS, DEPTH_FOG_PRESETS, FOG_LIMITS, RELATIVE_FOG_LIMITS, RELATIVE_FOG_PRESETS, depthFogFromFog, fogAcrossDepth, fogAmount, fogFromDepth, fogFromRelative, fogOnSubject, relativeFromFog } from "../engine";
import type { DepthFog, DepthFogPreset, DepthRange, FogMode, FogSettings, RelativeFog, SubjectReference } from "../engine";

/** The controls written relative to the subject. Optional so the panel still works without a camera. */
export interface FogRelativeHandlers {
  /** The current subject distance, or null when none is usable (the relative controls are then disabled). */
  reference(): SubjectReference | null;
  /** Already converted to absolute fog values. `begin` is true for the first change of one gesture: that one is the Undo step. */
  onChange(changes: Partial<FogSettings>, begin: boolean): void;
  /** Measure the subject distance from the surface in the middle of the picture. */
  onMeasure(): void;
  onUndo(): void;
  onRedo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

/** The picture-depth controls (fogDepth.ts). They change the fog through `relative.onChange`, so each gesture is one Undo step. */
export interface FogDepthHandlers {
  /** The measured depth range of the picture as it is now, or null when it was not measured or the view has changed since. */
  range(): DepthRange | null;
  /** Measures the picture's depth with a small depth grid (a few thousand rays). Resolves with the range, or null when too little is visible. */
  measure(): Promise<DepthRange | null>;
}

export interface FogPanelHandlers {
  /** One or more fog values were changed (already checked). */
  onChange(changes: Partial<FogSettings>): void;
  relative?: FogRelativeHandlers;
  depth?: FogDepthHandlers;
  /**
   * Who owns the fog right now: any value that changes when another scene replaces this one (the host passes the scene object).
   * A value typed into "Börjar vid" is committed only to the scene it was typed in; if the scene was replaced while the field
   * still had focus, the typed text is dropped and the field shows the new scene's value instead.
   */
  sceneToken?(): unknown;
}

/** Fog: colour mixed in with distance. Builds plain DOM; text only. */
export class FogPanel {
  private enabled!: HTMLInputElement;
  private color!: HTMLInputElement;
  private density!: HTMLInputElement;
  private densityValue!: HTMLSpanElement;
  private start!: HTMLInputElement;
  private mode!: HTMLSelectElement;
  private sky!: HTMLInputElement;
  private body!: HTMLDivElement;
  private relStart!: HTMLInputElement;
  private relStrength!: HTMLInputElement;
  private relStartValue!: HTMLSpanElement;
  private relStrengthValue!: HTMLSpanElement;
  private relInfo!: HTMLElement;
  private relOnSubject!: HTMLElement;
  private relNote!: HTMLElement;
  private relUndo!: HTMLButtonElement;
  private relRedo!: HTMLButtonElement;
  private relControls: (HTMLInputElement | HTMLButtonElement)[] = [];
  private depthStart!: HTMLInputElement;
  private depthBack!: HTMLInputElement;
  private depthStartValue!: HTMLSpanElement;
  private depthBackValue!: HTMLSpanElement;
  private depthInfo!: HTMLElement;
  private depthAcross!: HTMLElement;
  private depthStrip!: HTMLElement;
  private depthNote!: HTMLElement;
  private depthControls: (HTMLInputElement | HTMLButtonElement)[] = [];
  private measuring = false;
  /** One slider drag is one Undo step: the first input of a gesture opens it, the change event closes it. */
  private gestureOpen = false;
  private last: FogSettings | null = null;
  /** The scene that owned the start field when it got focus (see FogPanelHandlers.sceneToken). */
  private startOwner: unknown;

  constructor(
    private root: HTMLElement,
    private handlers: FogPanelHandlers,
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

  private build(): void {
    this.root.append(this.el("div", "ctitle", "Fog"));
    this.enabled = this.el("input");
    this.enabled.type = "checkbox";
    this.enabled.title = "Blends in a colour the further away the surface is. Saved in the scene and follows the keyframes.";
    this.enabled.addEventListener("change", () => this.handlers.onChange({ enabled: this.enabled.checked }));
    this.root.append(this.row("Fog on", this.enabled));

    this.body = this.el("div");
    this.body.style.display = "flex";
    this.body.style.flexDirection = "column";
    this.body.style.gap = "5px";
    this.root.append(this.body);

    this.buildDepth();
    this.buildRelative();
    if (this.handlers.relative) this.body.append(this.el("div", "ctitle", "Absolute values (scene units)"));

    this.color = this.el("input");
    this.color.type = "color";
    this.color.title = "Colour of the fog (as it appears on the screen)";
    this.color.addEventListener("input", () => this.handlers.onChange({ color: this.color.value }));
    this.body.append(this.row("Colour", this.color));

    this.density = this.el("input");
    this.density.type = "range";
    this.density.min = "0";
    this.density.max = "2";
    this.density.step = "0.005";
    this.density.title = "How thick the fog is, per distance unit. Larger = thicker.";
    this.densityValue = this.el("span", "value");
    this.density.addEventListener("input", () => this.handlers.onChange({ density: readNumber(this.density) }));
    const densityRow = this.row("Density", this.density, this.densityValue);
    densityRow.className = "arow dense";
    this.body.append(densityRow);

    this.start = this.el("input");
    this.start.type = "number";
    this.start.min = String(FOG_LIMITS.start[0]);
    this.start.max = String(FOG_LIMITS.start[1]);
    this.start.step = "any";
    this.start.title = "The distance from the camera where the fog begins. Before that the surface is seen as it is.";
    this.start.addEventListener("focus", () => (this.startOwner = this.handlers.sceneToken?.()));
    this.start.addEventListener("change", () => {
      // A typed value belongs to the scene it was typed in. If another scene replaced it meanwhile (File > Open while the
      // field had focus), the browser still fires `change` on blur: drop the text instead of writing it to the new scene.
      if (this.startIsStale()) {
        this.startOwner = this.handlers.sceneToken?.();
        setInputValue(this.start, this.last?.start ?? 0);
        return;
      }
      const v = readNumber(this.start);
      if (Number.isFinite(v) && v >= FOG_LIMITS.start[0] && v <= FOG_LIMITS.start[1]) {
        this.handlers.onChange({ start: v });
        this.startOwner = this.handlers.sceneToken?.(); // our own edit replaces the scene object; the field stays valid
      } else setInputValue(this.start, this.last?.start ?? 0);
    });
    this.body.append(this.row("Starts at", this.start));

    this.mode = this.el("select");
    this.mode.add(new Option("Even (exponential)", "exponential"));
    this.mode.add(new Option("Clear near, dense far away (squared)", "exponential_squared"));
    this.mode.addEventListener("change", () => this.handlers.onChange({ mode: this.mode.value as FogMode }));
    this.body.append(this.row("Typ", this.mode));

    this.sky = this.el("input");
    this.sky.type = "checkbox";
    this.sky.title = "Also makes the sky (what does not hit anything) the colour of the fog";
    this.sky.addEventListener("change", () => this.handlers.onChange({ affects_sky: this.sky.checked }));
    this.body.append(this.row("Fog over the sky", this.sky));
  }

  /** Picture-depth controls: the part that answers "how much fog is on the nearest and on the farthest thing I see". */
  private buildDepth(): void {
    const rel = this.handlers.relative;
    const depth = this.handlers.depth;
    if (!rel || !depth) return;
    const box = this.el("div");
    box.dataset.fogDepth = "";
    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.gap = "5px";
    box.append(this.el("div", "ctitle", "By the depth of the picture"));
    this.depthInfo = this.el("span", "value");
    const measure = this.button("Measure the depth of the picture", "Measures how far away the nearest and the farthest visible surface are, with a small depth grid. Does not change the scene.", () => void this.measureDepth());
    measure.dataset.fogDepthMeasure = "";
    box.append(this.row("Visible depth", this.depthInfo), measure);

    const presets = this.el("div");
    presets.style.display = "flex";
    presets.style.flexWrap = "wrap";
    presets.style.gap = "4px";
    for (const p of DEPTH_FOG_PRESETS) {
      const b = this.button(p.label, p.hint + " Turns on the fog.", () => void this.applyDepthPreset(p));
      b.dataset.fogDepthPreset = p.id;
      presets.append(b);
    }
    box.append(presets);

    const range = (min: number, max: number): HTMLInputElement => {
      const r = this.el("input");
      r.type = "range";
      r.min = String(min);
      r.max = String(max);
      r.step = "1";
      return r;
    };
    this.depthStart = range(DEPTH_FOG_LIMITS.start[0] * 100, DEPTH_FOG_LIMITS.start[1] * 100);
    this.depthStart.title = "Where the fog begins, as a part of the depth of the picture: 0 % = at the nearest surface, 100 % = at the farthest.";
    this.depthStart.dataset.fogDepthStart = "";
    this.depthBack = range(0, DEPTH_FOG_LIMITS.back[1] * 100);
    this.depthBack.title = "How much of the colour of the farthest visible surface is replaced by fog. The same value gives the same feel in small and large fractals, even or squared.";
    this.depthBack.dataset.fogDepthBack = "";
    this.depthStartValue = this.el("span", "value");
    this.depthBackValue = this.el("span", "value");
    const startRow = this.row("Starts", this.depthStart, this.depthStartValue);
    const backRow = this.row("Strength behind", this.depthBack, this.depthBackValue);
    startRow.className = backRow.className = "arow dense";
    this.depthStart.addEventListener("input", () => void this.fromDepthSliders());
    this.depthBack.addEventListener("input", () => void this.fromDepthSliders());
    for (const r of [this.depthStart, this.depthBack]) r.addEventListener("change", () => (this.gestureOpen = false));
    box.append(startRow, backRow);

    // The same numbers as a picture: fog share from the nearest (left) to the farthest (right) visible surface, in the fog colour.
    this.depthStrip = this.el("div");
    this.depthStrip.dataset.fogDepthStrip = "";
    this.depthStrip.style.height = "10px";
    this.depthStrip.style.borderRadius = "3px";
    this.depthStrip.style.border = "1px solid #ffffff22";
    this.depthStrip.style.background = "#1a212d";
    this.depthStrip.title = "Strength of the fog from the nearest (left) to the farthest visible surface (right).";
    this.depthAcross = this.el("small");
    this.depthAcross.dataset.fogDepthAcross = "";
    this.depthNote = this.el("small");
    this.depthNote.dataset.fogDepthNote = "";
    box.append(this.depthStrip, this.depthAcross, this.depthNote);
    this.depthControls = [this.depthStart, this.depthBack, ...Array.from(presets.querySelectorAll("button"))];
    this.body.append(box);
  }

  /** The measured range, measuring first if there is none (one small depth grid; the panel says so while it works). */
  private async depthRange(): Promise<DepthRange | null> {
    const known = this.handlers.depth?.range();
    return known ?? this.measureDepth();
  }

  private async measureDepth(): Promise<DepthRange | null> {
    const depth = this.handlers.depth;
    if (!depth || this.measuring) return null;
    this.measuring = true;
    this.depthNote.textContent = "Measuring the depth of the picture…";
    try {
      const r = await depth.measure();
      this.depthNote.textContent = r ? "" : "Hardly any surface is visible in the picture, so the depth cannot be measured. Use the older controls below.";
      return r;
    } catch (err) {
      this.depthNote.textContent = "Measurement: " + (err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      this.measuring = false;
      if (this.last) this.update(this.last);
    }
  }

  private async fromDepthSliders(): Promise<void> {
    const fog = this.last;
    if (!fog) return;
    const range = await this.depthRange();
    if (!range) return;
    const wanted: DepthFog = { start: readNumber(this.depthStart) / 100, back: readNumber(this.depthBack) / 100 };
    // Both values are sent: moving the start changes the distance over which the fog builds up, so the density follows it.
    const out = fogFromDepth(wanted, range, fog.mode);
    this.send({ start: out.start, density: out.density }, out.limited);
  }

  private async applyDepthPreset(p: DepthFogPreset): Promise<void> {
    if (!this.last) return;
    const range = await this.depthRange();
    if (!range) return;
    const out = fogFromDepth(p.value, range, p.mode);
    this.send({ enabled: true, start: out.start, density: out.density, mode: p.mode, affects_sky: p.sky }, out.limited);
  }

  /** Shows the scene's fog as the picture-depth numbers, a strip and the share on the nearest and farthest surface. */
  private updateDepth(fog: FogSettings): void {
    const depth = this.handlers.depth;
    if (!depth || !this.depthStart) return;
    const range = depth.range();
    // The measure button and the presets stay usable without a range (they measure first); only the readouts wait for one.
    for (const c of this.depthControls) c.disabled = this.measuring;
    if (!range) {
      this.depthInfo.textContent = this.measuring ? "measuring…" : "not measured";
      this.depthStartValue.textContent = this.depthBackValue.textContent = "–";
      this.depthAcross.textContent = "Measure the depth of the picture (or choose a preset) and it shows how much fog lies on the nearest and the farthest.";
      this.depthStrip.style.background = "#1a212d";
      return;
    }
    this.depthInfo.textContent = `nearest ${Number(range.near.toPrecision(3))} · farthest ${Number(range.far.toPrecision(3))}`;
    const d = depthFogFromFog(fog, range);
    if (!isNumericEditing(this.depthStart) && !isNumericEditing(this.depthBack)) {
      setInputValue(this.depthStart, d.start * 100);
      setInputValue(this.depthBack, d.back * 100);
    }
    this.depthStartValue.textContent = `${Math.round(d.start * 100)} %`;
    this.depthBackValue.textContent = `${Math.round(d.back * 100)} %`;
    const a = fogAcrossDepth(fog, range);
    this.depthAcross.textContent = fog.enabled
      ? `Fog on the nearest surface ${Math.round(a.near * 100)} %, on the farthest ${Math.round(a.far * 100)} %.`
      : "The fog is off. The values show what it would give.";
    const rgb = [1, 3, 5].map((i) => parseInt(fog.color.slice(i, i + 2), 16));
    const span = Math.max(range.far - range.near, 0.1 * range.far);
    const stops: string[] = [];
    for (let i = 0; i <= 8; i++) stops.push(`rgba(${rgb.join(",")},${fogAmount({ ...fog, enabled: true }, range.near + (span * i) / 8).toFixed(3)}) ${(i / 8) * 100}%`);
    this.depthStrip.style.background = `linear-gradient(to right, ${stops.join(", ")}), #1a212d`;
    this.depthStrip.style.opacity = fog.enabled ? "1" : "0.5";
  }

  private button(text: string, title: string, click: () => void): HTMLButtonElement {
    const b = this.el("button", undefined, text);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", click);
    return b;
  }

  /** Relative controls: start in subject distances, strength as a share of fog one subject distance past the start. */
  private buildRelative(): void {
    const rel = this.handlers.relative;
    if (!rel) return;
    const box = this.el("div");
    box.dataset.fogRelative = "";
    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.gap = "5px";
    box.append(this.el("div", "ctitle", "Relative to the subject"));

    this.relInfo = this.el("span", "value");
    const measure = this.button("Measure from the centre of the picture", "Measures the distance to the surface in the centre of the picture and uses it as the subject distance. Does not change the scene.", () => rel.onMeasure());
    measure.dataset.fogMeasure = "";
    box.append(this.row("Subject distance", this.relInfo), measure);

    const range = (min: number, max: number, step: number): HTMLInputElement => {
      const r = this.el("input");
      r.type = "range";
      r.min = String(min);
      r.max = String(max);
      r.step = String(step);
      return r;
    };
    this.relStart = range(RELATIVE_FOG_LIMITS.start_multiple[0], 5, 0.05);
    this.relStart.title = "Where the fog begins, counted in subject distances. 1 = at the subject, 2 = twice as far away.";
    this.relStartValue = this.el("span", "value");
    this.relStrength = range(0, RELATIVE_FOG_LIMITS.strength[1] * 100, 1);
    this.relStrength.title = "How much of the colour of the surface is replaced by fog one subject distance beyond the start. The same value gives the same feel in small and large scenes.";
    this.relStrengthValue = this.el("span", "value");
    this.relStart.dataset.fogRelStart = "";
    this.relStrength.dataset.fogRelStrength = "";
    const startRow = this.row("Starts at", this.relStart, this.relStartValue);
    const strengthRow = this.row("Strength", this.relStrength, this.relStrengthValue);
    startRow.className = strengthRow.className = "arow dense";
    this.relStart.addEventListener("input", () => this.fromSliders("start"));
    this.relStrength.addEventListener("input", () => this.fromSliders("strength"));
    for (const r of [this.relStart, this.relStrength]) r.addEventListener("change", () => (this.gestureOpen = false));
    box.append(startRow, strengthRow);

    this.relOnSubject = this.el("span", "value");
    box.append(this.row("Fog on the subject", this.relOnSubject));

    const presets = this.el("div");
    presets.style.display = "flex";
    presets.style.gap = "4px";
    for (const p of RELATIVE_FOG_PRESETS) {
      const b = this.button(p.label, `Starts at ${p.value.start_multiple}× the subject, strength ${Math.round(p.value.strength * 100)} %. Turns on the fog.`, () => this.applyRelative(p.value));
      b.dataset.fogPreset = p.id;
      presets.append(b);
    }
    box.append(presets);

    this.relUndo = this.button("Undo", "Undoes the latest relative change (the whole scene before it).", () => rel.onUndo());
    this.relRedo = this.button("Redo", "Redoes what was undone.", () => rel.onRedo());
    this.relUndo.dataset.fogUndo = "";
    this.relRedo.dataset.fogRedo = "";
    const history = this.el("div");
    history.style.display = "flex";
    history.style.gap = "4px";
    history.append(this.relUndo, this.relRedo);
    this.relNote = this.el("small");
    box.append(history, this.relNote);
    this.relControls = [this.relStart, this.relStrength, ...Array.from(presets.querySelectorAll("button"))];
    this.body.append(box);
  }

  /** The user moved one relative slider: send only the absolute value that slider owns, so the other stays untouched. */
  private fromSliders(which: "start" | "strength"): void {
    const ref = this.handlers.relative?.reference();
    const fog = this.last;
    if (!ref || !fog) return;
    const wanted: RelativeFog = { start_multiple: readNumber(this.relStart), strength: readNumber(this.relStrength) / 100 };
    const out = fogFromRelative(wanted, ref.distance, fog.mode);
    this.send(which === "start" ? { start: out.start } : { density: out.density }, out.limited);
  }

  private applyRelative(value: RelativeFog): void {
    const ref = this.handlers.relative?.reference();
    const fog = this.last;
    if (!ref || !fog) return;
    const out = fogFromRelative(value, ref.distance, fog.mode);
    this.send({ start: out.start, density: out.density, enabled: true }, out.limited);
  }

  private send(changes: Partial<FogSettings>, limited: boolean): void {
    const begin = !this.gestureOpen;
    this.gestureOpen = true;
    this.relNote.textContent = limited ? "Limited by the fog limits of the scene (density at most 100 million). The value is the nearest possible." : "";
    this.handlers.relative?.onChange(changes, begin);
    // A preset or a keyboard step has no drag after it, so it is its own gesture.
    if (!this.sliderActive()) this.gestureOpen = false;
  }

  private startIsStale(): boolean {
    return this.handlers.sceneToken !== undefined && this.startOwner !== this.handlers.sceneToken();
  }

  private sliderActive(): boolean {
    return isNumericEditing(this.relStart) || isNumericEditing(this.relStrength) || (!!this.depthStart && (isNumericEditing(this.depthStart) || isNumericEditing(this.depthBack)));
  }

  /** Shows the scene's fog. Leaves a field alone while it is being used. */
  update(fog: FogSettings): void {
    this.last = fog;
    this.enabled.checked = fog.enabled;
    this.body.style.opacity = fog.enabled ? "1" : "0.5";
    if (!isNumericEditing(this.color)) this.color.value = fog.color;
    // The slider's own range must not hide a value the scene already has (a scene may sit outside the usual range).
    this.density.max = String(Math.max(2, Math.ceil(fog.density * 10) / 10));
    if (!isNumericEditing(this.density)) setInputValue(this.density, fog.density);
    this.densityValue.textContent = fog.density.toFixed(3);
    if (!isNumericEditing(this.start) || this.startIsStale()) setInputValue(this.start, fog.start);
    this.mode.value = fog.mode;
    this.sky.checked = fog.affects_sky;
    this.updateDepth(fog);
    this.updateRelative(fog);
  }

  /** Shows the scene's absolute fog as relative values. Derived every time and never stored. */
  private updateRelative(fog: FogSettings): void {
    const rel = this.handlers.relative;
    if (!rel) return;
    const ref = rel.reference();
    for (const c of this.relControls) c.disabled = !ref;
    this.relUndo.disabled = !rel.canUndo();
    this.relRedo.disabled = !rel.canRedo();
    if (!ref) {
      this.relInfo.textContent = "unknown";
      this.relStartValue.textContent = this.relStrengthValue.textContent = this.relOnSubject.textContent = "–";
      this.relNote.textContent = "No usable subject distance. Use the absolute values or measure from the centre of the picture.";
      return;
    }
    this.relInfo.textContent = `${Number(ref.distance.toPrecision(4))} (${ref.source === "surface" ? "measured surface" : "camera–target"})`;
    const r = relativeFromFog(fog, ref.distance);
    this.relStart.max = String(Math.max(5, Math.ceil(r.start_multiple)));
    if (!this.sliderActive()) {
      setInputValue(this.relStart, r.start_multiple);
      setInputValue(this.relStrength, r.strength * 100);
    }
    this.relStartValue.textContent = `${r.start_multiple.toFixed(2)}×`;
    this.relStrengthValue.textContent = `${Math.round(r.strength * 100)} %`;
    this.relOnSubject.textContent = `${(fogOnSubject(fog, ref.distance) * 100).toFixed(1)} %`;
  }

  /** A short message from the host (for example why a measurement failed). */
  setStatus(text: string): void {
    if (this.relNote) this.relNote.textContent = text;
  }
}
