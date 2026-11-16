import { renderProgressive } from "../engine/progressiveRender";
import type { ProgressFrame, ProgressTarget } from "../engine/progressiveRender";
import { GEOMETRY_LEVELS, SHADOW_LEVELS, describeQuality } from "../engine/qualityLevels";
import type { GeometryLevel } from "../engine/qualityLevels";
import type { Engine, ImageBuffer, QualitySettings, RenderOptions, Scene } from "../engine";
import { encodePng, openFileStream } from "./output";

/** What the progressive render needs from the application. */
export interface ProgressiveHost {
  /** Freezes the current scene and picture size; throws (with a Swedish message) when the renderer is busy. */
  capture(): { scene: Scene; film: { width: number; height: number } };
  /** Runs `body` with a ready engine whose scene is `scene`, holding the GPU for the whole run and restoring the viewport afterwards. */
  withEngine<T>(scene: Scene, signal: AbortSignal, body: (engine: Engine) => Promise<T>): Promise<T>;
  /** The scene now shown in the viewport (a new object whenever anything, including the camera, changed). */
  current(): Scene;
  /** A sentence about what limits the detail of the finished picture (the Float32 floor), or empty. Runs on the engine of the render, after the last stage. */
  advise?(engine: Engine, scene: Scene, film: { width: number; height: number }, signal: AbortSignal): Promise<string>;
}

export type ProgressiveState = "idle" | "preparing" | "running" | "done" | "stopped" | "cancelled" | "error";

const duration = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

/** Picks the geometry level whose hit threshold is closest (on a log scale) to the scene's own. */
export function nearestGeometry(q: Pick<QualitySettings, "precision_mode" | "hit_pixels" | "normal_pixels" | "max_steps" | "step_factor" | "precision_floor">): GeometryLevel {
  const exact = describeQuality({ ...q, samples_per_pixel: 1, shadow_steps: 32 }).geometry;
  if (exact) return exact;
  if (q.precision_mode !== "pixel") return "standard";
  let best = GEOMETRY_LEVELS[1]!; let bestDistance = Infinity;
  for (const g of GEOMETRY_LEVELS) { const d = Math.abs(Math.log(g.values.hit_pixels / q.hit_pixels)) + Math.abs(Math.log(g.values.precision_floor / (q.precision_floor ?? 1))); if (d < bestDistance) { best = g; bestDistance = d; } }
  return best.id;
}

/** The target a progressive render works towards: the geometry, samples and shadows the scene's quality block says. */
export function progressTargetOf(q: QualitySettings): ProgressTarget {
  const shadows = SHADOW_LEVELS.reduce((p, s) => (Math.abs(s.value - q.shadow_steps) < Math.abs(p - q.shadow_steps) ? s.value : p), SHADOW_LEVELS[0]!.value);
  return { geometry: nearestGeometry(q), antialias: Math.max(1, Math.min(32, Math.round(q.samples_per_pixel))), shadows };
}

/**
 * Progressive still rendering: real renders of rising quality shown one after the other over the viewport (as the LookDev picture is),
 * stoppable at any time, the best finished picture kept and saveable. A change of camera or scene cancels it.
 */
export class ProgressiveStill {
  readonly overlay = document.createElement("canvas");
  state: ProgressiveState = "idle";
  best?: ProgressFrame;
  private abort?: AbortController;
  private captured?: Scene;
  private listeners = new Set<() => void>();
  /** Human text for the render bar: stage, quality, progress, elapsed time. */
  line = "";
  /** 0..1 over the stages of the plan. */
  fraction = 0;

  constructor(private readonly host: ProgressiveHost, private readonly view: HTMLElement) {
    this.overlay.id = "progressive-image"; this.overlay.hidden = true;
    this.overlay.setAttribute("aria-hidden", "true");
    this.overlay.style.cssText = "position:fixed;z-index:0;pointer-events:none;object-fit:contain;background:#111";
    document.body.append(this.overlay);
  }

  onChange(fn: () => void): void { this.listeners.add(fn); }
  private notify(): void { for (const fn of this.listeners) fn(); }
  get active(): boolean { return this.state === "preparing" || this.state === "running"; }
  get canSave(): boolean { return !!this.best; }

  /** Called from the application's frame clock: a changed scene or camera cancels the run. */
  observe(): void {
    if (this.overlay.hidden) return;
    const r = this.view.getBoundingClientRect();
    Object.assign(this.overlay.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    if (this.captured && this.host.current() !== this.captured) this.cancel("The camera or the scene changed.");
  }

  stop(): void {
    if (!this.active) return;
    this.abort?.abort(); this.state = "stopped";
    this.line = this.best ? `Stopped after ${this.best.stage.label} (${this.best.samples} samples, ${duration(this.best.elapsedMs)}). The best finished picture is kept and can be saved.` : "Stopped before any picture was finished.";
    this.notify();
  }

  /** The scene or camera changed: stop and hide the picture, which no longer matches. */
  cancel(reason: string): void {
    if (this.state === "idle") return;
    const wasActive = this.active;
    this.abort?.abort(); this.state = "cancelled"; this.best = undefined; this.overlay.hidden = true; this.captured = undefined;
    this.line = wasActive ? `Cancelled: ${reason}` : `The picture was removed: ${reason}`;
    this.notify();
  }

  /** Discards the shown picture (a normal render took over). */
  clear(): void { this.abort?.abort(); this.state = "idle"; this.best = undefined; this.captured = undefined; this.overlay.hidden = true; this.line = ""; this.notify(); }

  async start(): Promise<void> {
    if (this.active) return;
    let frozen: { scene: Scene; film: { width: number; height: number } };
    try { frozen = this.host.capture(); } catch (e) { this.state = "error"; this.line = String(e instanceof Error ? e.message : e); this.notify(); return; }
    const { scene, film } = frozen;
    if (scene.camera.dof?.enabled && scene.camera.projection !== "orthographic") { this.state = "error"; this.line = "Progressive render does not draw depth of field. Use Render still picture for depth of field."; this.notify(); return; }
    const target = progressTargetOf(scene.render.quality);
    const abort = new AbortController(); this.abort = abort; this.captured = this.host.current();
    this.state = "preparing"; this.best = undefined; this.fraction = 0; this.line = "Preparing …"; this.notify();
    const notes: string[] = [];
    if (scene.geometryDetail?.enabled) notes.push("Geometry Detail is not used in progressive render");
    try {
      await this.host.withEngine(scene, abort.signal, async (engine) => {
        const options: Omit<RenderOptions, "quality"> = { signal: abort.signal, dofMode: "off", denoise: false };
        let advice = "";
        await renderProgressive(engine, film, target, {
          ...options,
          onStageStart: (stage, index, count) => { if (abort.signal.aborted) return; this.state = "running"; this.fraction = index / count; this.line = `Step ${index + 1}/${count}: ${stage.label} …${this.best ? ` Latest picture: ${this.best.stage.label}, ${duration(this.best.elapsedMs)}.` : ""}`; this.notify(); },
          onFrame: (frame) => {
            if (abort.signal.aborted) return;
            this.best = frame; this.fraction = (frame.index + 1) / frame.count;
            this.show(frame.image);
            this.line = `${frame.index + 1}/${frame.count}: ${frame.stage.label} · ${frame.image.width}×${frame.image.height} · ${frame.samples} samples · ${duration(frame.elapsedMs)}${notes.length ? ` · ${notes.join("; ")}` : ""}`;
            this.notify();
          },
        });
        if (!abort.signal.aborted && this.host.advise) advice = await this.host.advise(engine, scene, film, abort.signal);
        if (advice) notes.push(advice.trim());
      });
      const finished = this.best as ProgressFrame | undefined;
      if (!abort.signal.aborted) { this.state = "done"; this.fraction = 1; if (finished) this.line = `Done: ${finished.image.width}×${finished.image.height}, ${finished.samples} samples, ${duration(finished.elapsedMs)}. The picture can be saved.${notes.length ? ` (${notes.join("; ")}.)` : ""}`; this.notify(); }
    } catch (e) {
      if (abort.signal.aborted || (e instanceof Error && e.name === "AbortError")) { const now = this.state as ProgressiveState; if (now === "running" || now === "preparing") { this.state = "stopped"; this.notify(); } return; }
      this.state = "error"; this.line = `Progressive render failed: ${String(e instanceof Error ? e.message : e)}${this.best ? " The best finished picture is kept." : ""}`; this.notify();
    }
  }

  private show(image: ImageBuffer): void {
    this.overlay.width = image.width; this.overlay.height = image.height;
    this.overlay.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    this.overlay.hidden = false; this.overlay.dataset.stage = this.best?.stage.id ?? ""; this.overlay.dataset.samples = String(this.best?.samples ?? 0);
    this.overlay.dataset.presented = String(Number(this.overlay.dataset.presented ?? 0) + 1);
  }

  /** Saves the best finished picture as PNG. */
  async save(): Promise<string> {
    if (!this.best) throw Error("No finished picture to save yet.");
    const frame = this.best, stream = await openFileStream("stillbild-progressiv.png", "image/png", ".png");
    try { const png = await encodePng(frame.image); await stream.write(new Uint8Array(await png.arrayBuffer())); await stream.close(); }
    catch (e) { await stream.abort().catch(() => undefined); throw e; }
    return `Saved ${frame.image.width}×${frame.image.height} (${frame.stage.label}, ${frame.samples} samples) as ${stream.describe()}.`;
  }
}
