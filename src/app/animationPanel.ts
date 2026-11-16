import {timeDraftInput,updateTimeDraft} from './timeDraft';
import { readNumber, setInputValue, isNumericEditing } from './numericRange';
import { MAX_KEYFRAMES } from "../engine";
import type { Scene, SpeedMode } from "../engine";

export interface AnimationPanelHandlers {
  onSeek(timeSeconds: number): void;
  onTogglePlay(): void;
  onRewind(): void;
  onAddKeyframe(): void;
  onGoto(index: number): void;
  onUpdate(index: number): void;
  onDelete(index: number): void;
  onSettings(changes: { duration_seconds?: number; fps?: number; speed_mode?: SpeedMode }): void;
  onFixedSpeed(unitsPerSecond: number): void;
  /** Save the camera path for Blender, Unreal or a script. */
  onExportCamera(kind: "glb" | "json"): void;
}

/** The timeline: play, scrub, keyframes and settings. Builds plain DOM; text only. */
export class AnimationPanel {
  private slider!: HTMLInputElement;
  private markers!: HTMLDivElement;
  private timeLabel!: HTMLSpanElement;
  private playButton!: HTMLButtonElement;
  private list!: HTMLDivElement;
  private addButton!: HTMLButtonElement;
  private duration!: HTMLInputElement;
  private fps!: HTMLInputElement;
  private mode!: HTMLSelectElement;
  private speed!: HTMLInputElement;
  private info!: HTMLDivElement;
  private exportStatus!: HTMLDivElement;
  private listSignature = "";

  constructor(
    private root: HTMLElement,
    private handlers: AnimationPanelHandlers,
  ) {
    this.build();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private button(text: string, hint: string, onClick: () => void): HTMLButtonElement {
    const b = this.el("button", undefined, text);
    b.title = hint;
    b.addEventListener("click", onClick);
    return b;
  }

  private numberField(label: string, min: number, max: number, step: number, onChange: (v: number) => void): { row: HTMLElement; input: HTMLInputElement } {
    const row = this.el("label", "arow");
    row.append(this.el("span", undefined, label));
    const input = this.el("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener("change", () => {
      const v = readNumber(input);
      if (Number.isFinite(v)) onChange(v);
    });
    row.append(input);
    return { row, input };
  }

  private build(): void {
    this.root.append(this.el("div", "ctitle", "Animation"));

    const transport = this.el("div", "transport");
    this.playButton = this.button("▶", "Play / pause", () => this.handlers.onTogglePlay());
    transport.append(this.playButton, this.button("⏮", "To the start", () => this.handlers.onRewind()));
    this.timeLabel = this.el("span", "timelabel");
    transport.append(this.timeLabel);
    this.root.append(transport);

    const track = this.el("div", "track");
    this.slider = this.el("input");
    this.slider.type = "range";
    this.slider.setAttribute("aria-label", "Timeline (seconds)");
    this.slider.min = "0";
    this.slider.step = "0.01";
    this.slider.addEventListener("input", () => this.handlers.onSeek(readNumber(this.slider)));
    this.markers = this.el("div", "markers");
    track.append(this.slider, this.markers);
    this.root.append(track);

    this.addButton = this.button("＋ Keyframe here", "Saves the camera, sliders and colour as they look now, at the time above", () => this.handlers.onAddKeyframe());
    this.root.append(this.addButton);
    this.list = this.el("div", "kflist");
    this.root.append(this.list);

    const durationRow=this.el("label","arow");durationRow.append(this.el("span",undefined,"Length (s) · legacy"));const durationInput=timeDraftInput("Legacy length (s)",.1,v=>this.handlers.onSettings({duration_seconds:v}),3600);durationRow.append(durationInput);const d={row:durationRow,input:durationInput};
    this.duration = d.input;
    const f = this.numberField("Frames/s", 1, 120, 1, (v) => this.handlers.onSettings({ fps: v }));
    this.fps = f.input;
    const modeRow = this.el("label", "arow");
    modeRow.append(this.el("span", undefined, "Camera speed"));
    this.mode = this.el("select");
    this.mode.add(new Option("Adapted to the distance from the surface", "adaptive"));
    this.mode.add(new Option("Even (constant speed along the path)", "uniform"));
    this.mode.addEventListener("change", () => this.handlers.onSettings({ speed_mode: this.mode.value as SpeedMode }));
    modeRow.append(this.mode);
    const s = this.numberField("Constant speed", 0.01, 100, 0.05, () => {});
    this.speed = s.input;
    this.speed.value = "0.5";
    const setSpeed = this.button("Set times by this speed (units/s)", "Recalculates the times of the keyframes so that the camera moves at a constant speed", () => {
      const v = readNumber(this.speed);
      if (v > 0) this.handlers.onFixedSpeed(v);
    });
    this.info = this.el("div", "ainfo");
    this.root.append(d.row, f.row, modeRow, s.row, setSpeed, this.info);

    this.root.append(this.el("div", "ctitle", "Export camera path"));
    const exportRow = this.el("div", "rbuttons");
    exportRow.append(
      this.button("glTF (.glb)", "The camera and its movement as a glTF file. Blender: File > Import > glTF", () => this.handlers.onExportCamera("glb")),
      this.button("JSON", "One frame per row with position and rotation, for your own scripts", () => this.handlers.onExportCamera("json")),
    );
    this.exportStatus = this.el("div", "rstatus");
    this.root.append(exportRow, this.exportStatus);
  }

  setExportStatus(text: string): void {
    this.exportStatus.textContent = text;
  }

  /** Shows the scene's animation and the playhead. Cheap enough to call every frame. */
  update(scene: Scene, time: number, playing: boolean, note: string): void {
    const a = scene.animation;
    this.playButton.textContent = playing ? "⏸" : "▶";
    this.slider.max = String(a.duration_seconds);
    if (!isNumericEditing(this.slider)) setInputValue(this.slider, time);
    this.timeLabel.textContent = `${time.toFixed(2)} / ${a.duration_seconds.toFixed(2)} s`;
    updateTimeDraft(this.duration,a.duration_seconds);
    if (!isNumericEditing(this.fps)) setInputValue(this.fps, a.fps);
    this.mode.value = a.speed_mode;
    this.addButton.disabled = a.keyframes.length >= MAX_KEYFRAMES;
    this.info.textContent = note;

    const signature = JSON.stringify([a.keyframes.map((k) => k.time_seconds), a.duration_seconds]);
    if (signature !== this.listSignature) {
      this.listSignature = signature;
      this.markers.replaceChildren();
      this.list.replaceChildren();
      a.keyframes.forEach((k, i) => {
        const m = this.el("div", "marker");
        m.style.left = `${(k.time_seconds / a.duration_seconds) * 100}%`;
        m.title = `Keyframe ${i + 1} at ${k.time_seconds.toFixed(2)} s`;
        this.markers.append(m);

        const row = this.el("div", "kfrow");
        row.append(
          this.el("span", "kfnum", String(i + 1)),
          this.button(`${k.time_seconds.toFixed(2)} s`, "Go to the keyframe", () => this.handlers.onGoto(i)),
          this.button("Update", "Replace the keyframe with what you see now", () => this.handlers.onUpdate(i)),
          this.button("✕", "Delete the keyframe", () => this.handlers.onDelete(i)),
        );
        this.list.append(row);
      });
    }
  }
}
