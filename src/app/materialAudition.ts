import type { ColorSettings } from "../engine/gradient";
import type { MaterialSettings } from "../engine/material";
import type { MaterialRecord } from "../engine/materialPresets";
import { replacementGradientColor } from "../engine/animationIdentity";
import type { Scene } from "../engine/scene";
import type { AuditionEnd } from "./sceneSync";

/** What the audition needs from the application. */
export interface AuditionHost {
  /** The authored scene (never the audition view). */
  scene(): Scene;
  /** Shows `apply(scene)` render-only. See SceneSync.setAudition. */
  begin(apply: (evaluated: Scene) => Scene, onEnd: (reason: AuditionEnd) => void): void;
  /** Removes the render-only layer. */
  end(): void;
  /** The one existing undoable "apply material" action. */
  commit(material: MaterialSettings, color?: ColorSettings): void;
  /** True while a render or a surface query owns the engine. */
  busy(): boolean;
  /** The scene's single-level Undo. There is no general Undo button in the app, so the library offers one for its own apply. */
  undo(): boolean;
  canUndo(): boolean;
}

export interface Trial {
  id: string;
  title: string;
  withColor: boolean;
}

const sameLook = (a: Scene, b: Scene): boolean => a.material === b.material && a.color === b.color;

/**
 * "Try / Apply / Restore" for the material library.
 *
 * A trial is only a render-only layer on top of the authored scene (SceneSync.setAudition). It is never in the scene, in
 * Undo, in a saved file or in an export. Every new trial starts again from the authored scene, so trials never add up.
 * Only `apply()` writes, through the same single undoable action the library always used.
 */
export class MaterialAudition {
  trial?: Trial;
  message = "";
  private ticket = 0;
  private record?: MaterialRecord;
  private base?: Scene;
  /** The authored scene right after our own Apply; Undo is offered only while nothing has changed since. */
  private applied?: Scene;

  constructor(
    private host: AuditionHost,
    private changed: () => void = () => {},
  ) {}

  get active(): boolean {
    return this.trial !== undefined;
  }

  /**
   * Loads the preset and shows it. A load that answers after the trial was closed, after another preset was chosen or
   * after the scene's material or colour changed is ignored.
   */
  async tryMaterial(id: string, load: () => Promise<MaterialRecord | undefined>, withColor: boolean): Promise<boolean> {
    if (this.host.busy()) {
      this.message = "Wait until the ongoing work is finished and try again.";
      this.changed();
      return false;
    }
    const ticket = ++this.ticket;
    const scene = this.host.scene();
    let record: MaterialRecord | undefined;
    try {
      record = await load();
    } catch (error) {
      if (ticket !== this.ticket) return false;
      this.message = "The material could not be read. No change. " + (error instanceof Error ? error.message : String(error));
      this.changed();
      return false;
    }
    if (ticket !== this.ticket) return false; // closed or another preset chosen meanwhile
    if (!record) {
      this.message = "The material no longer exists. No change.";
      this.changed();
      return false;
    }
    if (!sameLook(scene, this.host.scene())) {
      this.message = "The material or colour of the scene changed while the material was being read. Try again.";
      this.changed();
      return false;
    }
    this.show(record, scene, withColor);
    return true;
  }

  /** Changes whether the preset's saved gradient/colour is part of the trial, and shows the result. */
  setWithColor(withColor: boolean): void {
    if (!this.trial || !this.record || !this.base || this.trial.withColor === withColor) return;
    this.show(this.record, this.base, withColor);
  }

  /** Back to the authored scene. Nothing was changed, so nothing needs to be undone. */
  restore(): void {
    if (!this.trial) return;
    this.ticket++;
    this.host.end();
    this.clear("The original is back. Nothing you tried was saved.");
  }

  /** Closing the browser or leaving the scene: same as restore, and any answer still on its way is ignored. */
  close(): void {
    this.ticket++;
    this.applied = undefined;
    if (this.trial) {
      this.host.end();
      this.clear("");
    } else this.message = "";
  }

  /** Makes the current trial real: one undoable action. Returns false if there is nothing valid to apply. */
  apply(): boolean {
    const trial = this.trial;
    const record = this.record;
    if (!trial || !record || !this.base) return false;
    if (!sameLook(this.base, this.host.scene())) {
      this.clear("The scene changed. The trial was cancelled and nothing was applied.");
      this.host.end();
      return false;
    }
    const { material, color } = record.payload;
    this.ticket++;
    this.host.end(); // the trial layer goes first, so the commit starts from the authored scene
    this.clear("");
    this.host.commit(structuredClone(material), trial.withColor && color ? structuredClone(color) : undefined);
    this.applied = this.host.scene();
    this.message = `Applied ${trial.title}. It is one Undo step.`;
    this.changed();
    return true;
  }

  /** True right after Apply, until anything else changes the scene. */
  get canUndoApply(): boolean {
    return this.applied !== undefined && this.applied === this.host.scene() && this.host.canUndo();
  }

  /** Takes back our own Apply with the scene's one Undo step. Refuses if anything happened since. */
  undoApply(): boolean {
    if (!this.canUndoApply || this.host.busy()) {
      this.message = "It is no longer possible to undo that application from here: the scene has changed since.";
      this.applied = undefined;
      this.changed();
      return false;
    }
    this.applied = undefined;
    const ok = this.host.undo();
    this.message = ok ? "The application is undone. The material is as before Apply." : "Nothing to undo.";
    this.changed();
    return ok;
  }

  private show(record: MaterialRecord, base: Scene, withColor: boolean): void {
    const { material, color } = record.payload;
    const useColor = withColor && color !== undefined;
    // The same replacement the real apply uses, so stop identities stay unique in what is shown.
    this.host.begin(
      (evaluated) => ({ ...evaluated, material, ...(useColor ? { color: replacementGradientColor(evaluated, color) } : {}) }),
      (reason) => this.endedByHost(reason),
    );
    this.record = record;
    this.base = base;
    this.trial = { id: record.id, title: record.title, withColor: useColor };
    this.message = `Trial: ${record.title}${useColor ? " (with gradient/colour)" : ""}. Not saved. The original is untouched.`;
    this.changed();
  }

  private endedByHost(reason: AuditionEnd): void {
    if (!this.trial) return;
    this.ticket++;
    this.clear(
      reason === "rejected"
        ? "The graphics engine could not show the material. The trial was cancelled and the original is shown."
        : reason === "replaced"
          ? "A trial of a whole Look took over the picture. The material trial ended; nothing was saved."
          : reason === "scene-changed"
          ? "The material or colour of the scene changed. The trial was cancelled; nothing of what was tried was saved."
          : "The trial ended because you did something else. Nothing of what was tried was saved.",
    );
  }

  private clear(message: string): void {
    this.trial = undefined;
    this.record = undefined;
    this.base = undefined;
    this.message = message;
    this.changed();
  }
}
