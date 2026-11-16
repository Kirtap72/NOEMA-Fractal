import { readNumber, setInputValue, isNumericEditing } from './numericRange';
import { anglesFromDirection, directionFromAngles, LIGHT_LIMITS, LIGHTING_PRESETS, MAX_LIGHTS, PREVIEW_LIGHT_LIMIT } from "../engine";
import type { AmbientSettings, LightSettings, LightType, ShadowMode } from "../engine";

export interface LightsPanelHandlers {
  onLight(index: number, changes: Partial<LightSettings>): void;
  onAmbient(changes: Partial<AmbientSettings>): void;
  onAdd(type: LightType): void;
  onRemove(index: number): void;
  /** Points a spotlight at the actual surface on the viewport centre ray. */
  onAim(index: number): void;
  onAimSurface?(index: number): void;
  /** Points a spotlight at a picked surface AND sets its strength for the distance (one Undo step). */
  onAimFit?(index: number): void;
  /** Applies a named lighting preset non-destructively (reversible via Undo). */
  onPreset?(presetId: string): void;
}

const TYPE_NAMES: Record<LightType, string> = { directional: "Directional (like the sun)", point: "Point", spot: "Spot" };

/** Light sources and the ambient light. Builds plain DOM; text only. */
export class LightsPanel {
  private ambientColor!: HTMLInputElement;
  private ambientIntensity!: HTMLInputElement;
  private ambientValue!: HTMLSpanElement;
  private list!: HTMLDivElement;
  private note!: HTMLDivElement;
  private addButtons: HTMLButtonElement[] = [];
  private signature = "";
  private cards: { update(light: LightSettings): void }[] = [];

  constructor(
    private root: HTMLElement,
    private handlers: LightsPanelHandlers,
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

  private slider(min: number, max: number, step: number, onInput: (v: number) => void): HTMLInputElement {
    const s = this.el("input");
    s.type = "range";
    s.min = String(min);
    s.max = String(max);
    s.step = String(step);
    s.addEventListener("input", () => onInput(readNumber(s)));
    return s;
  }

  private number(onChange: (v: number) => void, min?: number, max?: number): HTMLInputElement {
    const i = this.el("input");
    i.type = "number";
    i.step = "any";
    if (min !== undefined) i.min = String(min);
    if (max !== undefined) i.max = String(max);
    i.addEventListener("change", () => {
      const v = readNumber(i);
      if (Number.isFinite(v)) onChange(v);
    });
    return i;
  }

  private build(): void {
    this.root.append(this.el("div", "ctitle", "Light"));

    if (this.handlers.onPreset) {
      const presetSelect = this.el("select");
      presetSelect.setAttribute("aria-label", "Lighting preset");
      for (const preset of LIGHTING_PRESETS) {
        presetSelect.append(new Option(preset.name, preset.id));
      }
      const presetButton = this.el("button", "ghost", "Use preset");
      presetButton.type = "button";
      presetButton.setAttribute("aria-label", "Apply lighting preset");
      presetButton.addEventListener("click", () => this.handlers.onPreset?.(presetSelect.value));
      const presetHint = this.el("div", "ainfo", LIGHTING_PRESETS[0]?.description ?? "");
      presetSelect.addEventListener("change", () => {
        const found = LIGHTING_PRESETS.find((p) => p.id === presetSelect.value);
        presetHint.textContent = found?.description ?? "";
      });
      this.root.append(this.row("Light preset", presetSelect, presetButton), presetHint);
    }

    this.ambientColor = this.el("input");
    this.ambientColor.type = "color";
    this.ambientColor.addEventListener("input", () => this.handlers.onAmbient({ color: this.ambientColor.value }));
    this.ambientIntensity = this.slider(0, 1, 0.005, (v) => this.handlers.onAmbient({ intensity: v }));
    this.ambientValue = this.el("span", "value");
    const amb = this.row("Surrounding light", this.ambientColor);
    this.root.append(amb);
    const ambRow = this.row("Strength", this.ambientIntensity, this.ambientValue);
    ambRow.className = "arow dense";
    this.root.append(ambRow);

    this.list = this.el("div");
    this.list.style.display = "flex";
    this.list.style.flexDirection = "column";
    this.list.style.gap = "6px";
    this.root.append(this.list);

    const adds = this.el("div", "rbuttons");
    for (const type of ["directional", "point", "spot"] as const) {
      const b = this.el("button", undefined, `+ ${TYPE_NAMES[type].split(" ")[0]}`);
      b.title = `Add a ${TYPE_NAMES[type].toLowerCase()} light`;
      b.addEventListener("click", () => this.handlers.onAdd(type));
      this.addButtons.push(b);
      adds.append(b);
    }
    this.root.append(adds);
    this.note = this.el("div", "rstatus");
    this.root.append(this.note);
  }

  /** Builds the controls of one light. */
  private card(index: number, light: LightSettings): HTMLElement {
    const h = this.handlers;
    const card = this.el("div", "lightcard");
    const head = this.el("div", "lighthead");
    const enabled = this.el("input");
    enabled.type = "checkbox";
    enabled.title = "Switch the light on or off";
    enabled.addEventListener("change", () => h.onLight(index, { enabled: enabled.checked }));
    const title = this.el("span", "lighttitle", `${index + 1}. ${TYPE_NAMES[light.type]}`);
    const remove = this.el("button", undefined, "✕");
    remove.title = "Remove the light";
    remove.addEventListener("click", () => h.onRemove(index));
    head.append(enabled, title, remove);
    card.append(head);

    const color = this.el("input");
    color.type = "color";
    color.addEventListener("input", () => h.onLight(index, { color: color.value }));
    card.append(this.row("Colour", color));

    const intensity = this.number((v) => h.onLight(index, { intensity: v }), LIGHT_LIMITS.intensity[0], LIGHT_LIMITS.intensity[1]);
    intensity.title = light.type === "directional" ? "Light strength" : "The strength of the light at distance 1. It falls off with the square of the distance, so a light far away needs a large strength.";
    card.append(this.row("Strength", intensity));

    let azimuth: HTMLInputElement | null = null;
    let elevation: HTMLInputElement | null = null;
    let azValue: HTMLSpanElement | null = null;
    let elValue: HTMLSpanElement | null = null;
    let aim: HTMLButtonElement | null = null;
    if (light.type !== "point") {
      const angles = (): { az: number; el: number } => ({ az: readNumber(azimuth!), el: readNumber(elevation!) });
      const send = (): void => {
        const a = angles();
        h.onLight(index, { direction: directionFromAngles(a.az, a.el) });
      };
      azimuth = this.slider(-180, 180, 1, send);
      elevation = this.slider(-90, 90, 1, send);
      azValue = this.el("span", "value");
      elValue = this.el("span", "value");
      const azRow = this.row(light.type === "spot" ? "Comes from (angle)" : "Angle around", azimuth, azValue);
      const elRow = this.row("Height above the horizon", elevation, elValue);
      azRow.className = elRow.className = "arow dense";
      card.append(azRow, elRow);
    }

    const pos: HTMLInputElement[] = [];
    if (light.type !== "directional") {
      for (let k = 0; k < 3; k++) pos.push(this.number((v) => {
        const next = [...this.lastPosition(index)] as [number, number, number];
        next[k] = v;
        h.onLight(index, { position: next });
      }, LIGHT_LIMITS.position[0], LIGHT_LIMITS.position[1]));
      const r = this.row("Position x, y, z", ...pos);
      r.className = "arow three";
      card.append(r);
    }
    if (light.type === "spot") {
      aim = this.el("button", undefined, "Aim at the middle");
      aim.title = "Looks for a real surface in the middle of the picture; no change if the ray misses";
      aim.addEventListener("click", () => h.onAim(index));
      if(h.onAimSurface){const surface=this.el("button",undefined,"Aim at a surface");surface.type="button";surface.title="Choose a real 3D light target in the picture";surface.addEventListener("click",()=>h.onAimSurface?.(index));card.append(surface);}
      if(h.onAimFit){const fit=this.el("button",undefined,"Aim and fit light");fit.type="button";fit.dataset.aimFit="";fit.title="Choose a surface: the light is aimed there and gets a strength that suits the distance (you set the level under Illumination at the target)";fit.addEventListener("click",()=>h.onAimFit?.(index));card.append(fit);}
      card.append(aim);
    }

    let cone: HTMLInputElement | null = null;
    let coneSoft: HTMLInputElement | null = null;
    if (light.type === "spot") {
      cone = this.slider(LIGHT_LIMITS.cone_degrees[0], LIGHT_LIMITS.cone_degrees[1], 1, (v) => h.onLight(index, { cone_degrees: v }));
      coneSoft = this.slider(0, 1, 0.01, (v) => h.onLight(index, { cone_softness: v }));
      card.append(this.row("Cone angle", cone), this.row("Soft edge", coneSoft));
    }

    const shadows = this.el("select");
    shadows.add(new Option("No shadows", "none"));
    shadows.add(new Option("Hard shadows", "hard"));
    shadows.add(new Option("Soft shadows", "soft"));
    shadows.add(new Option("Contact shadows (fast)", "contact"));
    shadows.title = "Shadows cost time: every shadowing light adds an extra ray per pixel";
    shadows.addEventListener("change", () => h.onLight(index, { shadows: shadows.value as ShadowMode }));
    card.append(this.row("Shadows", shadows));
    const softness = this.slider(0, 1, 0.01, (v) => h.onLight(index, { shadow_softness: v }));
    softness.title = "0 = sharp shadow edge, 1 = very soft";
    const softRow = this.row("Softness of the shadow", softness);
    card.append(softRow);

    this.cards[index] = {
      update: (l) => {
        enabled.checked = l.enabled;
        card.style.opacity = l.enabled ? "1" : "0.55";
        if (!isNumericEditing(color)) color.value = l.color;
        if (!isNumericEditing(intensity)) setInputValue(intensity, l.intensity);
        if (azimuth && elevation && azValue && elValue) {
          const a = anglesFromDirection(l.direction);
          if (!isNumericEditing(azimuth)) setInputValue(azimuth, a.azimuth);
          if (!isNumericEditing(elevation)) setInputValue(elevation, a.elevation);
          azValue.textContent = `${Math.round(a.azimuth)}°`;
          elValue.textContent = `${Math.round(a.elevation)}°`;
        }
        pos.forEach((p, k) => {
          if (!isNumericEditing(p)) setInputValue(p, l.position[k]!);
        });
        if (cone && coneSoft) {
          if (!isNumericEditing(cone)) setInputValue(cone, l.cone_degrees);
          if (!isNumericEditing(coneSoft)) setInputValue(coneSoft, l.cone_softness);
        }
        shadows.value = l.shadows;
        if (!isNumericEditing(softness)) setInputValue(softness, l.shadow_softness);
        softRow.hidden = l.shadows !== "soft";
      },
    };
    return card;
  }

  private positions: [number, number, number][] = [];
  private lastPosition(index: number): [number, number, number] {
    return this.positions[index] ?? [0, 0, 0];
  }

  /** Shows the scene's lights. Rebuilds the list only when lights are added, removed or change kind. */
  update(lights: readonly LightSettings[], ambient: AmbientSettings, previewShowsAll: boolean): void {
    if (!isNumericEditing(this.ambientColor)) this.ambientColor.value = ambient.color;
    if (!isNumericEditing(this.ambientIntensity)) setInputValue(this.ambientIntensity, ambient.intensity);
    this.ambientValue.textContent = ambient.intensity.toFixed(2);

    const signature = lights.map((l) => l.type).join(",");
    if (signature !== this.signature) {
      this.signature = signature;
      this.cards = [];
      this.list.replaceChildren(...lights.map((l, i) => this.card(i, l)));
    }
    this.positions = lights.map((l) => [...l.position] as [number, number, number]);
    lights.forEach((l, i) => this.cards[i]?.update(l));
    for (const b of this.addButtons) b.disabled = lights.length >= MAX_LIGHTS;
    const shown = lights.filter((l) => l.enabled).length;
    const shadowed = lights.filter((l) => l.enabled && l.shadows !== "none").length;
    this.note.textContent =
      !previewShowsAll && shown > PREVIEW_LIGHT_LIMIT
        ? `The preview only draws the ${PREVIEW_LIGHT_LIMIT} strongest lights. Still picture and film use all ${shown}. Tick "Details in the preview" in the Still picture panel to see them all.`
        : shadowed > 0
          ? `${shadowed} lights have shadows. Every shadowing light makes drawing slower.`
          : "";
  }
}
