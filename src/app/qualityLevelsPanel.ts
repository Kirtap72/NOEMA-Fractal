import { ANTIALIAS_LEVELS, GEOMETRY_LEVELS, QUALITY_PRESETS, SHADOW_LEVELS, describeQuality, qualityValues } from "../engine/qualityLevels";
import type { AntialiasLevel, GeometryLevel, ShadowLevel } from "../engine/qualityLevels";
import type { QualitySettings } from "../engine";
import "./qualityLevels.css";

/** What the panel needs from the application. Every change goes through `apply`: the same scene edit as the manual quality controls. */
export interface QualityLevelsHost {
  quality(): QualitySettings;
  apply(values: Partial<QualitySettings>): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e;
};

/**
 * "Quality level": ready-made levels plus three independent choices (geometry, antialiasing, shadows). It writes only existing quality fields; the manual controls below it stay as they were.
 */
export class QualityLevelsPanel {
  readonly root = el("section", "quality-levels");
  private readonly geometry = el("select"); private readonly antialias = el("select"); private readonly shadows = el("select");
  private readonly hint = el("p", "ql-hint");

  constructor(private readonly host: QualityLevelsHost) {
    this.root.id = "quality-levels";
    this.root.append(el("strong", "ql-title", "Quality level"));
    this.root.append(el("p", "ql-note", "The ready-made levels (Draft, Good, Fine, Extra fine) are at the top of the tab. Here you set the three parts separately. Finer surfaces (geometry) make the most visible difference; anti-aliasing only smooths edges and noise."));
    this.root.append(this.hint);
    const axis = (label: string, select: HTMLSelectElement, hint: string): HTMLElement => { const l = el("label", "ql-row"); const t = el("span", "", label); l.title = hint; l.append(t, select); return l; };
    for (const g of GEOMETRY_LEVELS) this.geometry.add(new Option(g.label, g.id));
    for (const a of ANTIALIAS_LEVELS) this.antialias.add(new Option(a.label, String(a.value)));
    for (const s of SHADOW_LEVELS) this.shadows.add(new Option(s.label, String(s.value)));
    for (const select of [this.geometry, this.antialias, this.shadows]) select.add(new Option("Custom values", "custom"), 0);
    this.geometry.onchange = () => { if (this.geometry.value !== "custom") { this.host.apply(qualityValues({ geometry: this.geometry.value as GeometryLevel })); this.update(); } };
    this.antialias.onchange = () => { if (this.antialias.value !== "custom") { this.host.apply(qualityValues({ antialias: Number(this.antialias.value) as AntialiasLevel })); this.update(); } };
    this.shadows.onchange = () => { if (this.shadows.value !== "custom") { this.host.apply(qualityValues({ shadows: Number(this.shadows.value) as ShadowLevel })); this.update(); } };
    this.root.append(
      axis("Geometry (surface accuracy)", this.geometry, "How exactly the surface is found and shaded: hit limit, normal step, number of steps and step size, counted in pixels."),
      axis("Anti-aliasing", this.antialias, "Samples per pixel. Smooths edges and noise. Costs as much per sample as a whole picture."),
      axis("Shadows", this.shadows, "How far a shadow ray may go. 64–128 steps cost almost nothing extra but give cleaner shadows."),
    );
    this.root.append(el("p", "ql-note", "Reflections, fog and materials are set in their own parts and are not affected. Geometry Detail is a special tool further down."));
    this.update();
  }

  /** The same as pressing the preset button. */
  applyPreset(id: string): void {
    const p = QUALITY_PRESETS.find((x) => x.id === id); if (!p) return;
    this.host.apply(qualityValues({ geometry: p.geometry, antialias: p.antialias, shadows: p.shadows })); this.update();
  }

  /** Brings the controls in line with the scene (called when the scene changes). */
  update(): void {
    const q = this.host.quality(), d = describeQuality(q);
    this.geometry.value = d.geometry ?? "custom"; this.antialias.value = d.antialias === null ? "custom" : String(d.antialias); this.shadows.value = d.shadows === null ? "custom" : String(d.shadows);
    const g = GEOMETRY_LEVELS.find((x) => x.id === d.geometry);
    this.hint.textContent = g ? `Geometry ${g.label}: ${g.hint}` : "Custom geometry values: they are set under Advanced below.";
  }
}
