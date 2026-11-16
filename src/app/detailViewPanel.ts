/**
 * Detaljvy (DETAIL-LOOKDEV-03B): examine any rectangle of the final picture at true 1:1 pixels, drawn progressively up to Maximal/Ultra.
 *
 * Only the chosen rectangle is ever drawn (engine `region` + `referenceFilm`), so the pixels are exactly those of the full render and an
 * 8K picture is never drawn to look at one corner. A change of lighting or material restarts the rectangle from a fast level; a change of
 * camera or picture size cancels it, because the rectangle would no longer show the same part. Geometry Detail can be drawn for the
 * rectangle on request (and compared with the Float32 picture) when the formulas support it.
 */
import { renderProgressive } from "../engine/progressiveRender";
import type { ProgressFrame } from "../engine/progressiveRender";
import { classifyDetailChange, clampDetailRect, detailCostNote, detailRectAround, detailStages, filmRectToView, levelFloor, nudgeDetailRect, rectFromDrag, DETAIL_MAX_PIXELS } from "../engine/detailView";
import type { PixelRect } from "../engine/detailView";
import { GEOMETRY_LEVELS } from "../engine/qualityLevels";
import type { GeometryLevel } from "../engine/qualityLevels";
import { floorAdviceText, probeFloorRegion } from "../engine/precisionFloor";
import { withQuality } from "../engine/renderSetup";
import type { Engine, ImageBuffer, Scene } from "../engine";
import { progressTargetOf } from "./progressiveStill";
import { encodePng, openFileStream } from "./output";
import "./detailView.css";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e;
};
const stageName = (g: GeometryLevel): string => GEOMETRY_LEVELS.find((x) => x.id === g)!.label;
const duration = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

export interface DetailHost {
  /** Freezes the scene and the final picture size; throws (Swedish message) when the renderer is busy. */
  capture(): { scene: Scene; film: { width: number; height: number } };
  /** Runs `body` with a ready engine whose scene is `scene`, holding the GPU and restoring the viewport afterwards. */
  withEngine<T>(scene: Scene, signal: AbortSignal, body: (engine: Engine) => Promise<T>): Promise<T>;
  /** The scene now shown (a new object whenever anything, including the camera, changed). */
  current(): Scene;
  /** The final picture size of the scene now shown. */
  filmOf(scene: Scene): { width: number; height: number };
  /** Null when Geometry Detail can be drawn for this scene, else a sentence saying why not. */
  gdUnavailable(scene: Scene): string | null;
  /** Draws `rect` with Geometry Detail on its own engine and returns the 1:1 picture. */
  drawGd(scene: Scene, rect: PixelRect, film: { width: number; height: number }, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<ImageBuffer>;
  /** True while something else holds the renderer. */
  busy(): boolean;
}

export type DetailState = "idle" | "selecting" | "preparing" | "running" | "done" | "stopped" | "cancelled" | "error";

const FINAL_LEVELS: readonly GeometryLevel[] = ["extra", "max", "ultra"];
const SIZES = [512, 1024, 1536, 2048];

export class DetailViewPanel {
  readonly root = el("section", "detail-view");
  readonly frame = el("div"); // the rectangle drawn over the viewport
  readonly viewer = el("div", "dv-viewer"); // the 1:1 picture, scrollable
  readonly canvas = el("canvas");
  state: DetailState = "idle";
  rect?: PixelRect;
  film?: { width: number; height: number };
  /** The finished (or latest) pictures: ordinary Float32 and Geometry Detail. */
  float?: ImageBuffer; gd?: ImageBuffer;
  floatLabel = ""; gdLabel = "";
  private shown: "float" | "gd" = "float";
  private abort?: AbortController;
  private run?: Promise<void>;
  private captured?: { scene: Scene; camera: unknown; film: { width: number; height: number } };
  private restartTimer?: number;
  private stale = false;
  private select = el("div", "dv-select");
  private readonly startButton = el("button", "", "Draw the area");
  private readonly pickButton = el("button", "", "Choose area (drag in the picture)");
  private readonly centerButton = el("button", "", "Centre");
  private readonly sizeSelect = el("select");
  private readonly levelSelect = el("select");
  private readonly followBox = el("input");
  private readonly stopButton = el("button", "", "Stop");
  private readonly gdButton = el("button", "", "Geometry Detail in the area");
  private readonly saveButton = el("button", "", "Save the area");
  private readonly closeButton = el("button", "", "Close");
  private readonly showSelect = el("select");
  private readonly progress = el("progress");
  private readonly line = el("p", "dv-line");
  private readonly limit = el("p", "dv-limit");
  private readonly info = el("p", "dv-info");

  constructor(private readonly host: DetailHost, private readonly view: HTMLElement) {
    this.root.id = "detail-view";
    this.frame.id = "detail-frame"; this.frame.hidden = true; this.frame.setAttribute("aria-hidden", "true");
    this.select.id = "detail-select"; this.select.hidden = true;
    this.viewer.id = "detail-viewer"; this.viewer.hidden = true; this.canvas.id = "detail-image";
    const head = el("div", "dv-head"); head.append(el("span", "dv-title", "Detail view 1:1"), this.closeButton);
    const hint = el("p", "dv-note", "Inspect an area of the finished picture at real resolution without drawing the whole picture. The area is drawn step by step up to Maximum or Ultra, and if light or material changes it is redrawn quickly. If the camera changes the area closes, because it no longer shows the same part.");
    const row1 = el("div", "dv-row"); row1.append(this.pickButton, this.centerButton, this.sizeSelect);
    const row2 = el("div", "dv-row"); row2.append(el("span", "", "Final level"), this.levelSelect);
    const follow = el("label", "dv-check"); this.followBox.type = "checkbox"; this.followBox.checked = true; this.followBox.id = "detail-follow"; follow.append(this.followBox, document.createTextNode(" Redraw when light or material changes"));
    const nudge = el("div", "dv-row dv-nudge"); nudge.setAttribute("role", "group"); nudge.setAttribute("aria-label", "Move the area");
    for (const [label, dx, dy] of [["←", -0.5, 0], ["↑", 0, -0.5], ["↓", 0, 0.5], ["→", 0.5, 0]] as const) {
      const b = el("button", "", label); b.type = "button"; b.title = "Move the area half a side"; b.dataset.dir = label;
      b.onclick = () => { if (this.rect && this.film) { this.setRect(nudgeDetailRect(this.rect, dx * this.rect.width, dy * this.rect.height, this.film)); this.autoStart(); } };
      nudge.append(b);
    }
    const row3 = el("div", "dv-row"); row3.append(this.startButton, this.stopButton, this.gdButton);
    const row4 = el("div", "dv-row"); row4.append(el("span", "", "Show"), this.showSelect, this.saveButton);
    this.progress.max = 1; this.progress.hidden = true;
    this.line.setAttribute("role", "status"); this.line.setAttribute("aria-live", "polite");
    this.root.append(head, hint, row1, nudge, row2, follow, row3, this.progress, this.line, this.info, this.limit, row4);
    for (const n of SIZES) this.sizeSelect.add(new Option(`${n} × ${Math.round(n * 0.75)} pixels`, String(n)));
    this.sizeSelect.value = "1024"; this.sizeSelect.setAttribute("aria-label", "Size of the area"); this.sizeSelect.id = "detail-size";
    for (const g of GEOMETRY_LEVELS.filter((x) => FINAL_LEVELS.includes(x.id))) this.levelSelect.add(new Option(g.label, g.id));
    this.levelSelect.value = "max"; this.levelSelect.id = "detail-level";
    this.showSelect.add(new Option("Float32 (ordinary)", "float")); this.showSelect.add(new Option("Geometry Detail", "gd")); this.showSelect.id = "detail-show";
    this.startButton.id = "detail-start"; this.pickButton.id = "detail-pick"; this.centerButton.id = "detail-center"; this.stopButton.id = "detail-stop"; this.gdButton.id = "detail-gd"; this.saveButton.id = "detail-save"; this.closeButton.id = "detail-close";
    for (const b of [this.startButton, this.pickButton, this.centerButton, this.stopButton, this.gdButton, this.saveButton, this.closeButton]) b.type = "button";
    this.startButton.title = "Draws the chosen area at real resolution, step by step.";
    this.gdButton.title = "Draws the same area with Geometry Detail (double-single maths) when the formulas support it. Takes considerably longer, but shows fine structure that Float32 cannot resolve.";
    this.pickButton.onclick = () => this.beginSelect();
    this.centerButton.onclick = () => { try { const { scene } = this.host.capture(); const film = this.host.filmOf(scene); this.film = film; this.setRect(detailRectAround({ x: film.width / 2, y: film.height / 2 }, this.size(), film)); void this.start(); } catch (e) { this.say(String(e instanceof Error ? e.message : e)); } };
    this.startButton.onclick = () => void this.start();
    this.stopButton.onclick = () => this.stop();
    this.gdButton.onclick = () => void this.startGd();
    this.saveButton.onclick = async () => { try { this.say(await this.save()); } catch (e) { this.say(`Saving was interrupted: ${String(e instanceof Error ? e.message : e)}`); } };
    this.closeButton.onclick = () => this.close();
    this.showSelect.onchange = () => { this.shown = this.showSelect.value as "float" | "gd"; this.paint(); };
    this.levelSelect.onchange = () => { if (this.rect) this.autoStart(); };
    this.viewer.append(this.canvas);
    document.body.append(this.frame, this.select, this.viewer);
    this.wireSelect();
    this.update();
  }

  private size(): { width: number; height: number } { const n = Number(this.sizeSelect.value); return { width: n, height: Math.round(n * 0.75) }; }
  private level(): GeometryLevel { return this.levelSelect.value as GeometryLevel; }
  get active(): boolean { return this.state === "preparing" || this.state === "running"; }
  private say(text: string): void { this.line.textContent = text; }

  /** Brings buttons in line with the state. Cheap; called on every change. */
  update(): void {
    const busyElsewhere = this.host.busy() && !this.active;
    this.startButton.disabled = this.active || busyElsewhere || !this.rect;
    this.pickButton.disabled = this.active || busyElsewhere;
    this.centerButton.disabled = this.active || busyElsewhere;
    this.stopButton.hidden = !this.active;
    this.gdButton.disabled = this.active || busyElsewhere || !this.rect;
    this.saveButton.disabled = !this.current();
    this.progress.hidden = !this.active;
    this.root.dataset.state = this.state;
    this.showSelect.disabled = !this.gd;
  }

  private current(): ImageBuffer | undefined { return this.shown === "gd" ? this.gd ?? this.float : this.float ?? this.gd; }

  private setRect(rect: PixelRect): void { this.rect = rect; this.layout(); }

  /** Keeps the frame over the viewport and the picture pane where they belong (called from the application's frame clock). */
  observe(): void {
    this.layout();
    if (!this.captured || !(this.state === "running" || this.state === "preparing" || this.state === "done" || this.state === "stopped")) return;
    const now = this.host.current();
    if (now === this.captured.scene) return;
    let film: { width: number; height: number };
    try { film = this.host.filmOf(now); } catch { return; }
    const change = classifyDetailChange({ camera: this.captured.camera, film: this.captured.film }, { camera: now.camera, film, identical: false });
    if (change === "cancel") { this.cancel(JSON.stringify(now.camera) !== JSON.stringify(this.captured.camera) ? "The camera changed, so the area no longer shows the same part." : "The picture size changed, so the area no longer fits."); return; }
    // Lighting, material or anything else that is not the camera: remember the newest scene and redraw after a short pause.
    this.captured = { ...this.captured, scene: now }; this.stale = true;
    if (!this.followBox.checked) { this.line.textContent = "The scene changed. The area no longer shows the latest look; press Draw the area."; this.markStale(); return; }
    window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => void this.restart(), 400);
    this.markStale();
  }

  private markStale(): void { this.viewer.dataset.stale = String(this.stale); }

  private layout(): void {
    const r = this.view.getBoundingClientRect();
    const showFrame = !!this.rect && !!this.film && this.state !== "idle" && this.state !== "cancelled";
    if (showFrame) {
      const b = filmRectToView(this.rect!, { width: r.width, height: r.height }, this.film!);
      Object.assign(this.frame.style, { left: `${r.left + b.left}px`, top: `${r.top + b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    }
    this.frame.hidden = !showFrame;
    if (!this.select.hidden) Object.assign(this.select.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  // ---- choosing the area
  /** Starts the drag-a-rectangle choice over the viewport (also used by the button in the viewport bar). */
  pickArea(): void { if (!this.active) this.beginSelect(); }
  private beginSelect(): void {
    try { const { scene } = this.host.capture(); this.film = this.host.filmOf(scene); } catch (e) { this.say(String(e instanceof Error ? e.message : e)); return; }
    this.state = "selecting"; this.select.hidden = false; this.layout();
    this.say("Drag a rectangle over the picture to choose the area. Esc cancels."); this.update();
  }

  private wireSelect(): void {
    let start: { x: number; y: number } | null = null;
    const box = el("div", "dv-drag"); box.hidden = true; this.select.append(box);
    const local = (e: PointerEvent) => { const r = this.select.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    this.select.addEventListener("pointerdown", (e) => { start = local(e); this.select.setPointerCapture(e.pointerId); box.hidden = false; });
    this.select.addEventListener("pointermove", (e) => {
      if (!start) return; const p = local(e);
      Object.assign(box.style, { left: `${Math.min(start.x, p.x)}px`, top: `${Math.min(start.y, p.y)}px`, width: `${Math.abs(p.x - start.x)}px`, height: `${Math.abs(p.y - start.y)}px` });
    });
    this.select.addEventListener("pointerup", (e) => {
      if (!start || !this.film) return;
      const a = start, b = local(e), r = this.select.getBoundingClientRect(); start = null; box.hidden = true; this.select.hidden = true;
      const tiny = Math.abs(a.x - b.x) < 6 && Math.abs(a.y - b.y) < 6;
      const view = { width: r.width, height: r.height };
      const rect = tiny ? (() => { const p = rectFromDrag(a, a, view, this.film!); return p ? detailRectAround({ x: p.x, y: p.y }, this.size(), this.film!) : null; })() : rectFromDrag(a, b, view, this.film);
      if (!rect) { this.state = "idle"; this.say("The area was outside the picture."); this.update(); return; }
      this.state = "idle"; this.setRect(rect); void this.start().then(() => this.followWithGd());
    });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.state === "selecting") { this.select.hidden = true; box.hidden = true; start = null; this.state = "idle"; this.say("The choice was cancelled."); this.update(); } });
  }

  /** A rectangle drawn on purpose gets the scene's real final detail: when Geometry Detail is switched on in the scene it follows the Float32 picture automatically. */
  private async followWithGd(): Promise<void> {
    if (this.state !== "done" || !this.rect) return;
    try { const { scene } = this.host.capture(); if (!scene.geometryDetail?.enabled || this.host.gdUnavailable(scene)) return; } catch { return; }
    await this.startGd();
  }

  private autoStart(): void { if (!this.active) void this.start(); }

  // ---- drawing
  stop(): void {
    window.clearTimeout(this.restartTimer);
    if (!this.active) return;
    this.abort?.abort(); this.state = "stopped";
    this.say(this.float ? `Stopped. The best finished picture (${this.floatLabel}) is kept.` : "Stopped before any picture was finished."); this.update();
  }

  /** The camera or picture size changed: the rectangle no longer matches. The last picture stays visible but is marked, and nothing is redrawn. */
  cancel(reason: string): void {
    window.clearTimeout(this.restartTimer);
    this.abort?.abort(); this.state = "cancelled"; this.captured = undefined; this.stale = true; this.markStale();
    this.frame.hidden = true; this.say(`The area was closed: ${reason} Choose a new area.`); this.update();
  }

  close(): void {
    window.clearTimeout(this.restartTimer); this.abort?.abort();
    this.state = "idle"; this.captured = undefined; this.float = this.gd = undefined; this.viewer.hidden = true; this.frame.hidden = true; this.select.hidden = true; this.rect = undefined; this.say(""); this.limit.textContent = ""; this.info.textContent = ""; this.update();
  }

  private async restart(): Promise<void> {
    if (!this.rect) return;
    if (this.active) { this.abort?.abort(); await this.run?.catch(() => undefined); }
    await this.start(true);
  }

  /** Draws the rectangle. `quick` (after a lighting or material change) starts at a fast geometry level and stops at a few samples. */
  async start(quick = false): Promise<void> {
    if (this.active || !this.rect) return;
    let frozen: { scene: Scene; film: { width: number; height: number } };
    try { frozen = this.host.capture(); } catch (e) { this.state = "error"; this.say(String(e instanceof Error ? e.message : e)); this.update(); return; }
    const { scene, film } = frozen;
    if (scene.camera.dof?.enabled && scene.camera.projection !== "orthographic") { this.state = "error"; this.say("The detail view does not draw depth of field. Switch depth of field off or use Render still picture."); this.update(); return; }
    // The area must still lie in the picture (the picture size can differ from when it was chosen).
    this.film = film; this.rect = clampDetailRect(this.rect, film);
    const rect = this.rect, level = this.level();
    const floor = levelFloor(level);
    // The lowered Float32 floor must be part of the scene for the shader to read it (see precisionFloor.ts).
    const prepared: Scene = floor < 1 ? { ...scene, render: withQuality(scene.render, { precision_floor: floor }) } : scene;
    const base = progressTargetOf(prepared.render.quality);
    const target = { geometry: level, antialias: quick ? Math.min(base.antialias, 4) : base.antialias, shadows: base.shadows };
    const stages = detailStages(rect, target, quick ? { startAt: "fine" } : {});
    const abort = new AbortController(); this.abort = abort;
    this.captured = { scene: this.host.current(), camera: scene.camera, film }; this.stale = false; this.markStale();
    this.state = "preparing"; this.gd = quick ? this.gd : undefined; if (!quick) { this.shown = "float"; this.showSelect.value = "float"; }
    this.limit.textContent = ""; this.say("Preparing …"); this.update();
    const started = performance.now(); let finalMs = 0;
    this.run = (async () => {
      try {
        await this.host.withEngine(prepared, abort.signal, async (engine) => {
          await renderProgressive(engine, rect, target, {
            signal: abort.signal, dofMode: "off", denoise: false, detail: { film, region: rect }, plan: stages,
            onStageStart: (stage, index, count) => { if (abort.signal.aborted) return; this.state = "running"; this.progress.value = index / count; this.say(`Step ${index + 1}/${count}: ${stage.label} …`); this.update(); },
            onFrame: (frame: ProgressFrame) => {
              if (abort.signal.aborted) return;
              if (frame.stage.geometry === level) finalMs += frame.stageMs;
              this.float = frame.image; this.floatLabel = `${stageName(frame.stage.geometry)}, ${frame.samples} samples`; this.progress.value = (frame.index + 1) / frame.count;
              this.say(`${frame.index + 1}/${frame.count}: ${frame.stage.label} · ${frame.image.width}×${frame.image.height} · ${frame.samples} samples · ${duration(frame.elapsedMs)}`);
              this.paint();
            },
          });
          if (!abort.signal.aborted) await this.measureLimit(engine, prepared, rect, film, level, abort.signal);
        });
        if (!abort.signal.aborted) {
          this.state = "done"; this.progress.value = 1;
          this.say(`Done: ${rect.width}×${rect.height} at real resolution (${this.floatLabel}), ${duration(performance.now() - started)}. ${detailCostNote(rect, film, finalMs, performance.now() - started)}`);
        }
      } catch (e) {
        if (abort.signal.aborted || (e instanceof Error && e.name === "AbortError")) { if (this.state === "running" || this.state === "preparing") this.state = "stopped"; }
        else { this.state = "error"; this.say(`The detail view failed: ${String(e instanceof Error ? e.message : e)}${this.float ? " The best finished picture is kept." : ""}`); }
      }
      this.update();
    })();
    await this.run;
  }

  /** Says what limits the detail of THIS rectangle: the Float32 floor and the number of 32-bit values per pixel. */
  private async measureLimit(engine: Engine, scene: Scene, rect: PixelRect, film: { width: number; height: number }, level: GeometryLevel, signal: AbortSignal): Promise<void> {
    try {
      const values = GEOMETRY_LEVELS.find((g) => g.id === level)!.values;
      const report = await probeFloorRegion(engine, scene, rect, film, values.hit_pixels, values.precision_floor, { signal });
      if (!report) { this.limit.textContent = "Precision: orthographic camera, no Float32 limit measured."; return; }
      const steps = report.coordinateStepsPerPixel.toFixed(1);
      this.limit.textContent = `Precision in the area: ${steps} 32-bit values per pixel, floor ≈ ${report.floorPixels.toFixed(2)} pixel.${floorAdviceText(report, values.precision_floor) || " Float32 is enough here."}`;
      this.limit.dataset.steps = String(report.coordinateStepsPerPixel);
    } catch { this.limit.textContent = ""; }
  }

  // ---- Geometry Detail on the rectangle
  async startGd(): Promise<void> {
    if (this.active || !this.rect) return;
    let frozen: { scene: Scene; film: { width: number; height: number } };
    try { frozen = this.host.capture(); } catch (e) { this.say(String(e instanceof Error ? e.message : e)); return; }
    const why = this.host.gdUnavailable(frozen.scene);
    if (why) { this.say(`Geometry Detail cannot be used in this area: ${why}`); return; }
    const { scene, film } = frozen, rect = clampDetailRect(this.rect, film); this.rect = rect; this.film = film;
    const abort = new AbortController(); this.abort = abort;
    this.captured = { scene: this.host.current(), camera: scene.camera, film }; this.state = "running"; this.stale = false; this.markStale();
    this.progress.value = 0; this.say("Geometry Detail in the area … 0 %"); this.update();
    const started = performance.now();
    this.run = (async () => {
      try {
        const image = await this.host.drawGd(scene, rect, film, abort.signal, (f) => { this.progress.value = f; this.say(`Geometry Detail in the area … ${Math.round(f * 100)} %`); });
        if (abort.signal.aborted) return;
        this.gd = image; this.gdLabel = `Geometry Detail, ${duration(performance.now() - started)}`; this.shown = "gd"; this.showSelect.value = "gd"; this.paint();
        this.state = "done"; this.progress.value = 1;
        this.say(`Geometry Detail done: ${rect.width}×${rect.height} in ${duration(performance.now() - started)}. ${detailCostNote(rect, film, performance.now() - started)} Switch under Show to compare with Float32.`);
      } catch (e) {
        if (abort.signal.aborted || (e instanceof Error && e.name === "AbortError")) this.state = "stopped";
        else { this.state = "error"; this.say(`Geometry Detail failed: ${String(e instanceof Error ? e.message : e)}`); }
      }
      this.update();
    })();
    await this.run;
  }

  // ---- showing and saving
  private paint(): void {
    const image = this.current(); if (!image) return;
    this.canvas.width = image.width; this.canvas.height = image.height;
    // 1:1 means one picture pixel per physical screen pixel.
    this.canvas.style.width = `${image.width / window.devicePixelRatio}px`; this.canvas.style.height = `${image.height / window.devicePixelRatio}px`;
    this.canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    this.viewer.hidden = false; this.layout();
    this.viewer.dataset.shown = this.shown; this.canvas.dataset.presented = String(Number(this.canvas.dataset.presented ?? 0) + 1);
    if (this.rect && this.film) this.info.textContent = `Area ${this.rect.x},${this.rect.y} (${this.rect.width}×${this.rect.height}) of the picture ${this.film.width}×${this.film.height} · showing ${this.shown === "gd" ? this.gdLabel : this.floatLabel}`;
    this.update();
  }

  async save(): Promise<string> {
    const image = this.current(); if (!image) throw Error("No finished picture to save yet.");
    const stream = await openFileStream("detaljvy.png", "image/png", ".png");
    try { const png = await encodePng(image); await stream.write(new Uint8Array(await png.arrayBuffer())); await stream.close(); }
    catch (e) { await stream.abort().catch(() => undefined); throw e; }
    return `Saved ${image.width}×${image.height} (${this.shown === "gd" ? this.gdLabel : this.floatLabel}) as ${stream.describe()}.`;
  }
}

export { DETAIL_MAX_PIXELS };
