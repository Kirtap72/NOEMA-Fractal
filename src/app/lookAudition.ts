import { applyLook } from "../engine/looks";
import type { LookParts, LookRecord } from "../engine/looks";
import type { Scene } from "../engine/scene";
import type { SubjectReference } from "../engine/subjectScale";
import type { AuditionBinding, AuditionEnd } from "./sceneSync";

/** What the Look trial needs from the application. */
export interface LookHost {
  /** The authored scene (never the trial view). */
  scene(): Scene;
  /** The distance to the subject, the same one the fog controls use. Null when it cannot be told. */
  subject(): SubjectReference | null;
  /** Shows `apply(scene)` render-only, tied to the given scene parts. See SceneSync.setAudition. */
  begin(apply: (evaluated: Scene) => Scene, onEnd: (reason: AuditionEnd) => void, bind: readonly AuditionBinding[]): void;
  end(): void;
  /** The one undoable action: pause, editWithUndo, redraw. */
  commit(next: Scene): void;
  busy(): boolean;
  undo(): boolean;
  canUndo(): boolean;
}

export interface LookTrial {
  id: string;
  title: string;
  parts: LookParts;
}

const BIND_ALL: readonly AuditionBinding[] = ["material", "color", "lights", "fog"];

/**
 * "Try / Apply / Restore" for whole Looks. Same rules as the material trial (MaterialAudition): a trial is a render-only
 * layer on top of the authored scene, never in the scene, in Undo, in a saved file or in an export; each new trial starts
 * again from the authored scene; stale answers are ignored; only `apply()` writes, as one undoable edit.
 *
 * A Look trial is tied to the scene's material, colour, lights and fog: an edit of any of them, Undo/Redo or another scene
 * ends it. A camera change alone does not end it at this level (the rig and the fog then follow the camera and the subject in
 * the view only). In the application, however, orbit, pan and zoom start with `pause()`, and `pause()` ends every trial: in
 * practice rotating or zooming the view ends a trial, with the message "du gjorde något annat".
 */
export class LookAudition {
  trial?: LookTrial;
  message = "";
  private ticket = 0;
  private record?: LookRecord;
  private base?: Scene;
  private applied?: Scene;

  constructor(
    private host: LookHost,
    private changed: () => void = () => {},
  ) {}

  get active(): boolean {
    return this.trial !== undefined;
  }

  async tryLook(id: string, load: () => Promise<LookRecord | undefined>, parts: LookParts): Promise<boolean> {
    if (this.host.busy()) {
      this.message = "Wait until the ongoing work is finished and try again.";
      this.changed();
      return false;
    }
    const ticket = ++this.ticket;
    const scene = this.host.scene();
    let record: LookRecord | undefined;
    try {
      record = await load();
    } catch (error) {
      if (ticket !== this.ticket) return false;
      this.message = "The Look could not be read. No change. " + (error instanceof Error ? error.message : String(error));
      this.changed();
      return false;
    }
    if (ticket !== this.ticket) return false;
    if (!record) {
      this.message = "The Look no longer exists. No change.";
      this.changed();
      return false;
    }
    if (!this.same(scene, this.host.scene())) {
      this.message = "The scene changed while the Look was being read. Try again.";
      this.changed();
      return false;
    }
    return this.show(record, scene, parts);
  }

  /** Which parts of the Look are part of the trial changed: show it again. */
  setParts(parts: LookParts): void {
    if (!this.trial || !this.record || !this.base) return;
    if (!this.show(this.record, this.base, parts)) {
      // The new choice cannot be shown here: do not leave the old trial standing under a message that says otherwise.
      const why = this.message;
      this.host.end();
      this.ticket++;
      this.clear(why + " The trial was cancelled.");
    }
  }

  restore(): void {
    if (!this.trial) return;
    this.ticket++;
    this.host.end();
    this.clear("The original is back. Nothing you tried was saved.");
  }

  close(): void {
    this.ticket++;
    this.applied = undefined;
    if (this.trial) {
      this.host.end();
      this.clear("");
    } else this.message = "";
  }

  apply(): boolean {
    const trial = this.trial;
    const record = this.record;
    if (!trial || !record || !this.base) return false;
    const scene = this.host.scene();
    if (!this.same(this.base, scene)) {
      this.host.end();
      this.clear("The scene changed. The trial was cancelled and nothing was applied.");
      return false;
    }
    const result = applyLook(scene, record.payload, trial.parts, this.host.subject());
    if (!result.ok) {
      this.message = result.message;
      this.changed();
      return false;
    }
    this.ticket++;
    this.host.end();
    this.clear("");
    this.host.commit(result.scene);
    this.applied = this.host.scene();
    this.message = `Applied ${trial.title}. ${result.summary} It is one Undo step.`;
    this.changed();
    return true;
  }

  get canUndoApply(): boolean {
    return this.applied !== undefined && this.applied === this.host.scene() && this.host.canUndo();
  }

  undoApply(): boolean {
    if (!this.canUndoApply || this.host.busy()) {
      this.message = "It is no longer possible to undo that application from here: the scene has changed since.";
      this.applied = undefined;
      this.changed();
      return false;
    }
    this.applied = undefined;
    const ok = this.host.undo();
    this.message = ok ? "The application is undone. The scene is as before Apply." : "Nothing to undo.";
    this.changed();
    return ok;
  }

  private same(a: Scene, b: Scene): boolean {
    return BIND_ALL.every((k) => a[k] === b[k]);
  }

  private show(record: LookRecord, base: Scene, parts: LookParts): boolean {
    // Check first, so a Look that cannot apply here never leaves a half-shown trial.
    const check = applyLook(base, record.payload, parts, this.host.subject(), "plan");
    if (!check.ok) {
      this.message = check.message;
      this.changed();
      return false;
    }
    this.host.begin(
      (evaluated) => {
        const r = applyLook(evaluated, record.payload, parts, this.host.subject(), "view");
        return r.ok ? r.scene : evaluated;
      },
      (reason) => this.endedByHost(reason),
      BIND_ALL,
    );
    this.record = record;
    this.base = base;
    this.trial = { id: record.id, title: record.title, parts: { ...parts } };
    this.message = `Trial: ${record.title} (${check.applied.join(", ")}). Not saved. The original is untouched.`;
    this.changed();
    return true;
  }

  private endedByHost(reason: AuditionEnd): void {
    if (!this.trial) return;
    this.ticket++;
    this.clear(
      reason === "rejected"
        ? "The graphics engine could not show the Look. The trial was cancelled and the original is shown."
        : reason === "replaced"
          ? "A material trial took over the picture. The Look trial ended; nothing was saved."
          : reason === "scene-changed"
          ? "The material, colour, light or fog of the scene changed. The trial was cancelled; nothing of what was tried was saved."
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
