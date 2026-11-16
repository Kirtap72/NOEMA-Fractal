import { NAME_MAX, POSTCARD_SLOTS, THUMB_WIDTH, captureWithRetry, cleanName, postcardKey, readPostcard, renamed, withThumb, worldOf, writePostcard } from "./cameraPostcards";
import type { Scene } from "../engine/scene";
import type { FrameProposal } from "../engine/framing/frame";

/** "Frame Fractal": the panel only shows and approves a proposal; the application computes it and applies it as one undoable step. */
export interface FramingHandlers {
  frame(): Promise<FrameProposal>;
  apply(proposal: FrameProposal): void;
  undo(): void;
}
import { readSceneCamera } from "../engine/camera";
import { defaultComposition } from "../engine/composition";
import {
  cameraFov,
  defaultDof,
  focusDistance,
  lensFromFov,
  sensorDimension,
} from "../engine/cameraOptics";
import {
  FORMAT_PRESETS,
  outputSize,
  readRenderSetup,
} from "../engine/renderSetup";

/** The small picture of the current view for a postcard (null if it cannot be made right now). Optional: without it postcards simply have no picture. */
export interface PostcardHandlers {
  thumbnail(): Promise<string | null>;
}

export class CameraPanel {
  private updateFields: (() => void)[] = [];
  private scene!: Scene;
  private aspect = 16 / 9;
  private note = document.createElement("small");
  constructor(
    root: HTMLElement,
    private edit: (change: (s: Scene) => Scene) => void,
    private reset: () => void,
    private framing?: FramingHandlers,
    private postcards?: PostcardHandlers,
  ) {
    const section = document.createElement("details"),
      title = document.createElement("summary");
    title.textContent = "Camera / composition";
    section.append(title);
    root.append(section);
    root = document.createElement("div");
    section.append(root);
    const field = (
      name: string,
      type: string,
      send: (i: HTMLInputElement) => void,
      read: () => string | boolean,
      min?: number,
      max?: number,
    ) => {
      const row = document.createElement("label"),
        i = document.createElement("input");
      row.textContent = name;
      i.type = type;
      i.setAttribute("aria-label", name);
      if (min !== undefined) i.min = String(min);
      if (max !== undefined) i.max = String(max);
      i.step = "any";
      row.append(i);
      root.append(row);
      i.onchange = () => {
        try {
          if (type === "number" && (!i.value.trim() || !i.checkValidity()))
            throw Error(name + ": the value is outside the allowed range.");
          send(i);
          this.note.textContent = "";
        } catch (e) {
          this.note.textContent = String(e);
        }
      };
      if (type === "number") i.oninput = i.onchange;
      this.updateFields.push(() => {
        if (document.activeElement === i) return;
        const value = read();
        if (typeof value === "boolean") i.checked = value;
        else i.value = value;
      });
      return i;
    };
    const select = (
      name: string,
      options: string[],
      send: (value: string) => void,
      read: () => string,
    ) => {
      const row = document.createElement("label"),
        i = document.createElement("select");
      row.textContent = name;
      i.setAttribute("aria-label", name);
      for (const v of options) i.add(new Option(v, v));
      i.onchange = () => send(i.value);
      row.append(i);
      root.append(row);
      this.updateFields.push(() => (i.value = read()));
      return i;
    };
    const changeCamera = (values: Partial<Scene["camera"]>) => {
      const errors: string[] = [],
        camera = readSceneCamera(
          { ...this.scene.camera, ...values },
          "camera",
          errors,
        );
      if (errors.length || !camera) throw Error(errors.join(";"));
      this.edit((s) => ({ ...s, camera }));
    };
    select(
      "Quick format",
      [...FORMAT_PRESETS],
      (preset) => {
        this.edit((s) => ({
          ...s,
          render: {
            ...s.render,
            resolution: undefined,
            format: {
              preset: preset as typeof s.render.format.preset,
              ...(preset === "custom"
                ? {
                    ratio:
                      s.render.format.ratio ??
                      ([this.outputAspect(), 1] as [number, number]),
                  }
                : {}),
            },
          },
        }));
      },
      () => this.scene.render.format.preset,
    );
    select(
      "Projection",
      ["perspective", "orthographic"],
      (value) =>
        changeCamera({ projection: value as "perspective" | "orthographic" }),
      () => this.scene.camera.projection ?? "perspective",
    );
    const dimension = () =>
      sensorDimension(
        this.scene.camera.lens?.sensor_width_mm ?? 36,
        this.scene.render.fov_axis,
        this.outputAspect(),
      );
    const focal = () =>
      this.scene.camera.lens?.focal_length_mm ??
      lensFromFov(this.scene.camera.fov_degrees, dimension());
    const setLens = (mm: number) =>
      changeCamera({
        lens: {
          focal_length_mm: mm,
          sensor_width_mm: this.scene.camera.lens?.sensor_width_mm ?? 36,
        },
      });
    field(
      "Focal length (mm)",
      "number",
      (i) => setLens(Number(i.value)),
      () => String(focal()),
      1,
      2000,
    );
    const lenses = document.createElement("div");
    lenses.className = "camera-lenses";
    for (const mm of [18, 24, 35, 50, 85, 100]) {
      const b = document.createElement("button");
      b.textContent = mm + " mm";
      b.onclick = () => setLens(mm);
      lenses.append(b);
    }
    root.append(lenses);
    field(
      "Sensor width (mm)",
      "number",
      (i) =>
        changeCamera({
          lens: { focal_length_mm: focal(), sensor_width_mm: Number(i.value) },
        }),
      () => String(this.scene.camera.lens?.sensor_width_mm ?? 36),
      1,
      200,
    );
    select(
      "Sensor preset",
      ["Full frame 36", "APS-C 23.6", "MFT 17.3", "Custom"],
      (value) => {
        if (value !== "Custom")
          changeCamera({
            lens: {
              focal_length_mm: focal(),
              sensor_width_mm: Number(value.split(" ").at(-1)),
            },
          });
      },
      () => {
        const w = this.scene.camera.lens?.sensor_width_mm ?? 36;
        return w === 23.6
          ? "APS-C 23.6"
          : w === 17.3
            ? "MFT 17.3"
            : w === 36
              ? "Full frame 36"
              : "Custom";
      },
    );
    const fovField = field(
      "Field of view (degrees)",
      "number",
      (i) => {
        const f = Number(i.value);
        if (this.scene.camera.lens)
          changeCamera({
            lens: {
              ...this.scene.camera.lens,
              focal_length_mm: lensFromFov(f, dimension()),
            },
          });
        else {
          if (f < 10 || f > 120) throw Error("Older field of view: 10–120°.");
          changeCamera({ fov_degrees: f });
        }
      },
      () =>
        String(
          cameraFov(
            this.scene.camera,
            this.scene.render.fov_axis,
            this.outputAspect(),
            1,
          ),
        ),
      0.001,
      179.9,
    );
    this.updateFields.push(() => {
      fovField.min = this.scene.camera.lens ? ".001" : "10";
      fovField.max = this.scene.camera.lens ? "179.9" : "120";
    });
    field(
      "Ortho height",
      "number",
      (i) => changeCamera({ ortho_height: Number(i.value) }),
      () => String(this.scene.camera.ortho_height ?? 4),
      1e-9,
      1e6,
    );
    const dof = () => this.scene.camera.dof ?? defaultDof();
    const dofEnable = field(
      "DOF on",
      "checkbox",
      (i) => changeCamera({ dof: { ...dof(), enabled: i.checked } }),
      () => dof().enabled,
    );
    this.updateFields.push(() => {
      dofEnable.disabled = this.scene.camera.projection === "orthographic";
      dofEnable.title = dofEnable.disabled
        ? "DOF is only supported for perspective."
        : "";
    });
    select(
      "DOF focus",
      ["target", "manual"],
      (value) =>
        changeCamera({
          dof: {
            ...dof(),
            focus_mode: value as "target" | "manual",
            ...(value === "manual"
              ? { focus_distance: focusDistance(this.scene.camera) }
              : {}),
          },
        }),
      () => dof().focus_mode,
    );
    field(
      "Focus distance",
      "number",
      (i) =>
        changeCamera({
          dof: {
            ...dof(),
            focus_mode: "manual",
            focus_distance: Number(i.value),
          },
        }),
      () => String(focusDistance(this.scene.camera)),
      1e-9,
      1e6,
    );
    field(
      "Aperture radius (scene units)",
      "number",
      (i) =>
        changeCamera({ dof: { ...dof(), aperture_radius: Number(i.value) } }),
      () => String(dof().aperture_radius),
      0,
      1000,
    );
    const button = (text: string, action: () => void) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.onclick = () => {
        try {
          action();
          this.note.textContent = "";
        } catch (e) {
          this.note.textContent = String(e);
        }
      };
      root.append(b);
    };
    button("DOF from navigation focus", () =>
      changeCamera({ dof: { ...dof(), focus_mode: "target" } }),
    );
    button("Reset camera", () => this.reset());
    if (this.framing) this.addFraming(root);
    for (const [key, label] of [
      ["locked", "Lock the camera"],
      ["thirds", "Rule-of-thirds grid"],
      ["center", "Centre cross"],
      ["safe", "Safe margin 90%"],
      ["diagonals", "Diagonals"],
    ] as const)
      field(
        label,
        "checkbox",
        (i) =>
          this.edit((s) => ({
            ...s,
            composition: {
              ...(s.composition ?? defaultComposition()),
              [key]: i.checked,
            },
          })),
        () => this.scene.composition?.[key] ?? false,
      );
    this.addPostcards(root);
    const help = document.createElement("small");
    help.textContent =
      "The viewport is the camera. The sensor width of the lens is held fixed, the picture format determines the height. DOF: the target follows the double-click focus; radius in scene units. Explore pauses DOF, Inspect uses fast depth-based blur. Final Preview first shows a fast whole picture and then refines with physical lens samples. The final render uses at least 16 samples and full saved quality. DOF is supported for perspective. Camera views are stored locally.";
    root.append(help, this.note);
  }
  /**
   * Camera postcards: the camera bookmarks with an optional name and a small picture. Eight slots; the buttons keep their old labels and the
   * storage keys keep their old names, so every bookmark ever saved still works. The camera is stored at once; the picture follows when it is ready.
   */
  private addPostcards(root: HTMLElement): void {
    const grid = document.createElement("div");
    grid.className = "postcards";
    grid.dataset.postcards = "";
    for (let slot = 1; slot <= POSTCARD_SLOTS; slot++) {
      const key = postcardKey(slot);
      const card = document.createElement("div");
      card.className = "postcard";
      card.dataset.postcardSlot = String(slot);
      const picture = document.createElement("div");
      picture.className = "postcard-picture";
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = NAME_MAX;
      name.placeholder = "Camera card " + slot;
      name.setAttribute("aria-label", "Name of camera card " + slot);
      name.dataset.postcardName = "";
      const store = (text: string | null) => { if (text !== null) localStorage.setItem(key, text); };
      let making = false; // the picture of this card is being asked for (it may have to wait for the graphics card)
      const again = document.createElement("button");
      again.type = "button"; again.textContent = "Take picture"; again.className = "postcard-again"; again.hidden = true;
      again.title = "Takes the picture of the camera card again. The camera must be at the view of the camera card: choose Fetch camera view first.";
      /** Asks for the picture of the view that is on screen, for the postcard `saved`, a few times if the graphics card is busy. Never silent. */
      const makePicture = async (saved: string) => {
        if (making || !this.postcards) return;
        making = true; show();
        const cameraNow = () => JSON.stringify(this.scene.camera);
        const cameraThen = cameraNow();
        const result = await captureWithRetry(() => this.postcards!.thumbnail(), { attempts: 15, delayMs: 700, stillWanted: () => localStorage.getItem(key) === saved && cameraNow() === cameraThen });
        making = false;
        if (result.thumb && localStorage.getItem(key) === saved) { store(withThumb(saved, result.thumb)); this.note.textContent = ""; }
        else if (result.stopped) this.note.textContent = `Camera card ${slot}: the camera was moved before the picture could be taken, so no picture was set. Press Take picture when the camera is at the view.`;
        else this.note.textContent = `Camera card ${slot} was saved, but the picture could not be taken right now (the graphics card is busy). Press Take picture in a moment.`;
        show();
      };
      again.onclick = () => {
        const saved = localStorage.getItem(key); const p = readPostcard(saved);
        if (!saved || !p) return;
        if (JSON.stringify(p.camera) !== JSON.stringify(this.scene.camera)) { this.note.textContent = `The camera is not at camera card ${slot}. Press Fetch camera view ${slot} first, then Take picture.`; return; }
        void makePicture(saved);
      };
      const show = () => {
        const p = readPostcard(localStorage.getItem(key));
        picture.replaceChildren();
        card.classList.toggle("postcard-empty", !p);
        card.classList.toggle("postcard-other", !!p?.world && p.world !== worldOf(this.scene));
        card.title = p?.world && p.world !== worldOf(this.scene) ? "Saved in another fractal" : "";
        if (p?.thumb) {
          const img = document.createElement("img");
          img.src = p.thumb;
          img.alt = p.name ?? "Camera card " + slot;
          img.width = THUMB_WIDTH / 2;
          picture.append(img);
        } else picture.textContent = p ? (making ? "picture is being made…" : "no picture") : "empty";
        again.hidden = !p || !!p.thumb || making;
        // An empty slot keeps what the artist typed: the name is saved together with the camera when the slot is saved.
        if (p && document.activeElement !== name) name.value = p.name ?? "";
      };
      name.addEventListener("change", () => {
        const text = renamed(localStorage.getItem(key), name.value);
        if (text === null) return; // nothing saved here yet
        store(text);
        show();
      });
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "Save camera view " + slot;
      save.onclick = () => {
        try {
          const text = writePostcard({
            camera: this.scene.camera,
            render: { resolution: this.scene.render.resolution, format: this.scene.render.format, fov_axis: this.scene.render.fov_axis },
            ...(cleanName(name.value) ? { name: cleanName(name.value) } : {}),
            world: worldOf(this.scene),
          });
          localStorage.setItem(key, text);
          this.note.textContent = "";
          show();
          // The picture comes a moment later (a tiny render, which waits for the graphics card if it is busy); a slot saved over meanwhile gets no old picture.
          void makePicture(text);
        } catch (e) { this.note.textContent = String(e); }
      };
      const load = document.createElement("button");
      load.type = "button";
      load.textContent = "Fetch camera view " + slot;
      load.onclick = () => {
        try {
          const p = readPostcard(localStorage.getItem(key));
          if (!p) throw Error("Empty camera view " + slot);
          const raw = p as { camera: unknown; render?: unknown },
            errors: string[] = [],
            camera = readSceneCamera(raw.camera, "bookmark", errors),
            render = readRenderSetup({ ...this.scene.render, resolution: undefined, ...(raw.render as object) }, "bookmark", errors);
          if (!camera || !render || errors.length) throw Error(errors.join(";"));
          this.edit((s) => ({ ...s, camera, render }));
          this.note.textContent = "";
        } catch (e) { this.note.textContent = String(e); }
      };
      const row = document.createElement("div");
      row.className = "postcard-buttons";
      row.append(save, load);
      card.append(picture, again, name, row);
      grid.append(card);
      show();
      this.updateFields.push(show);
    }
    root.append(grid);
  }

  /** Frame Fractal: compute a proposal in slices (the interface stays responsive), show it, and only change the camera when the artist approves. */
  private addFraming(root: HTMLElement): void {
    const box = document.createElement("div"), status = document.createElement("small"), row = document.createElement("div");
    const frame = document.createElement("button"), use = document.createElement("button"), cancel = document.createElement("button"), back = document.createElement("button");
    frame.textContent = "Frame the fractal"; use.textContent = "Use the proposal"; cancel.textContent = "Cancel"; back.textContent = "Undo the framing";
    frame.title = "Looks for visible geometry and proposes the target and distance of the camera. The camera is not changed until you approve the proposal.";
    for (const b of [frame, use, cancel, back]) b.type = "button";
    use.hidden = cancel.hidden = back.hidden = true; status.setAttribute("role", "status");
    let proposal: FrameProposal | null = null;
    const idle = () => { use.hidden = cancel.hidden = true; frame.disabled = false; proposal = null; };
    frame.onclick = async () => {
      frame.disabled = true; back.hidden = true; status.textContent = "Searching for geometry…";
      try {
        const p = await this.framing!.frame(); proposal = p; status.textContent = p.message;
        const usable = !!p.camera && (p.status === "ok" || p.status === "low-confidence");
        use.hidden = cancel.hidden = !usable; frame.disabled = usable;
        if (!usable) frame.disabled = false;
      } catch (e) { status.textContent = "The framing failed: " + String(e); idle(); }
    };
    use.onclick = () => { if (!proposal) return; try { this.framing!.apply(proposal); status.textContent = "The camera is framed. Undo the framing restores your previous camera."; back.hidden = false; } catch (e) { status.textContent = String(e); } idle(); };
    cancel.onclick = () => { status.textContent = "Nothing was changed."; idle(); };
    back.onclick = () => { this.framing!.undo(); status.textContent = "Your previous camera is restored."; back.hidden = true; };
    row.append(frame, use, cancel, back); box.append(row, status); root.append(box);
  }

  private outputAspect(): number {
    const size = outputSize(this.scene.render, this.aspect);
    return size.width / size.height;
  }
  update(scene: Scene, aspect: number): void {
    this.scene = scene;
    this.aspect = aspect;
    this.updateFields.forEach((f) => f());
  }
}
