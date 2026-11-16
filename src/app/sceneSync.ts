import type { Scene, SceneResult } from "../engine";

/** Why a render-only audition ended without the owner asking for it. */
export type AuditionEnd = "cleared" | "scene-changed" | "rejected" | "replaced";

/** Scene parts an audition can be tied to. Camera edits never end an audition; edits of a tied part do. */
export type AuditionBinding = "material" | "color" | "lights" | "fog" | "cutout";

interface SceneAudition {
  apply:(evaluated:Scene)=>Scene;
  /** The audition belongs to these exact objects; a scene whose tied parts are other objects is another look. */
  keys:readonly AuditionBinding[];
  bound:Partial<Record<AuditionBinding,unknown>>;
  onEnd:(reason:AuditionEnd)=>void;
  /** Who started it. A different owner taking over is told ("replaced"); the same owner trying another thing is not. */
  owner?:string;
  input?:Scene;
  output?:Scene;
}

export interface SceneSyncHooks {
  /** The engine refused the scene; the last working scene was put back. */
  onRevert(errors: string[]): void;
  onWarnings(warnings: string[]): void;
}

/**
 * Keeps the user's scene and the engine in step.
 *
 * `scene` is always what the user wants right now, and edits are applied to it
 * at once, even while the engine is still compiling something. The engine is
 * told afterwards. So an edit can never be lost because a compile finished
 * later; the only time the scene goes back is when the engine rejects it.
 */
/** How many undoable edits are remembered. A scene can carry large embedded pictures, so the history is kept short. */
export const MAX_UNDO_STEPS = 20;

export class SceneSync {
  scene: Scene;
  /** The newest scene the engine has accepted. */
  lastGood: Scene;
  private dirty = false;
  /** The scenes before each undoable edit, oldest first (at most MAX_UNDO_STEPS), and the scenes Undo stepped back over. */
  private undoStack: Scene[] = [];
  private redoStack: Scene[] = [];
  private evaluation:((base:Scene)=>Scene)|undefined;
  private evaluatedBase:Scene|undefined;
  private evaluatedView:Scene|undefined;
  private audition:SceneAudition|undefined;

  constructor(
    private engine: { setScene(scene: Scene): Promise<SceneResult> },
    initial: Scene,
    private hooks: SceneSyncHooks,
    private prepare:(scene:Scene)=>Scene=(s)=>s,
  ) {
    this.scene = prepare(initial);
    this.lastGood = this.scene;
    this.dirty = true;
  }

  /** Changes the scene. Works on the newest scene, whatever the engine is doing. */
  edit(change: (scene: Scene) => Scene): void {
    this.scene = this.prepare(change(this.scene));
    this.redoStack = [];
    this.dirty = true;
    this.checkAudition();
  }

  /**
   * Puts a different scene in place (File > Open). Unlike `edit`, Undo and Redo are cleared: they belong to the previous
   * scene, and an Undo must never bring another artwork back over the one that was just opened.
   */
  replace(next: Scene): void {
    this.scene = this.prepare(next);
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = true;
    this.checkAudition();
  }

  /** A reversible import transaction; a failed adapter must not replace the previous checkpoint. */
  editWithUndo(change: (scene: Scene) => Scene): void {
    const before = structuredClone(this.scene);
    const next = change(this.scene);
    this.undoStack.push(before); if (this.undoStack.length > MAX_UNDO_STEPS) this.undoStack.shift();
    this.redoStack = [];
    this.scene = this.prepare(next);
    this.dirty = true;
    this.checkAudition();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }

  /** Restores the whole scene before the latest checkpoint, including edits made after it. */
  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(structuredClone(this.scene));
    this.scene = previous;
    this.dirty = true;
    this.checkAudition();
    return true;
  }

  get canRedo(): boolean { return this.redoStack.length > 0; }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(structuredClone(this.scene));
    this.scene = next;
    this.dirty = true;
    this.checkAudition();
    return true;
  }

  get hasChanges(): boolean {
    return this.dirty;
  }

  /** Render-only evaluation. Authored scene, serialization and Undo never receive sampled mathematical values. */
  get view():Scene {
    let evaluated=this.scene;
    if(this.evaluation){
      if(this.evaluatedBase!==this.scene){this.evaluatedBase=this.scene;this.evaluatedView=this.evaluation(this.scene);}
      evaluated=this.evaluatedView!;
    }
    const a=this.audition;
    if(!a||!this.holds(a))return evaluated;
    // One stable object per evaluated scene: callers compare views by identity.
    if(a.input!==evaluated){a.input=evaluated;a.output=a.apply(evaluated);}
    return a.output!;
  }

  /**
   * What may be kept: the authored scene with its transient evaluation (camera-flight mathematics) but never a material or
   * Look trial. Anything that stores a scene (the fractal library's "Spara bildpreset") reads this, not `view`.
   */
  get committedView():Scene {
    if(!this.evaluation)return this.scene;
    if(this.evaluatedBase!==this.scene){this.evaluatedBase=this.scene;this.evaluatedView=this.evaluation(this.scene);}
    return this.evaluatedView!;
  }

  /** True while a render-only audition is shown on top of the scene. */
  get auditioning():boolean { return this.audition!==undefined; }
  /** Who started the current audition (see setAudition), if anyone said so. */
  get auditionOwner():string|undefined { return this.audition?.owner; }

  /**
   * Shows `apply(evaluated scene)` in the viewport and in every consumer of `view`, without touching `scene`: the authored
   * scene, its Undo history and serialization never see it. It ends by itself (and calls `onEnd`) when the scene's
   * material or colour become other objects (an edit of them, Undo/Redo, opening another scene) or when the engine
   * rejects the shown scene. A second call replaces the first; the first is not reported as ended.
   */
  setAudition(apply:(evaluated:Scene)=>Scene,onEnd:(reason:AuditionEnd)=>void,bind:readonly AuditionBinding[]=["material","color"],owner?:string):void {
    const previous=this.audition;
    this.audition={apply,onEnd,keys:bind,bound:Object.fromEntries(bind.map(k=>[k,this.scene[k]])),...(owner!==undefined?{owner}:{})};
    if(previous&&previous.owner!==owner)previous.onEnd("replaced");
    this.dirty=true;
  }

  /** Removes the audition. Quiet unless a reason is given. */
  clearAudition(notify=false):void {
    const a=this.audition;if(!a)return;
    this.audition=undefined;this.dirty=true;
    if(notify)a.onEnd("cleared");
  }

  private holds(a:SceneAudition):boolean { return a.keys.every(k=>a.bound[k]===this.scene[k]); }

  private checkAudition():void {
    const a=this.audition;
    if(a&&!this.holds(a)){this.audition=undefined;this.dirty=true;a.onEnd("scene-changed");}
  }
  setEvaluation(evaluate?:((base:Scene)=>Scene)):void {
    this.evaluation=evaluate;this.evaluatedBase=undefined;this.evaluatedView=undefined;this.dirty=true;
  }

  /** Sends the newest scene to the engine if it changed. Call once per frame. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const sent = this.scene;
    const result = await this.engine.setScene(this.view);
    if (result.superseded) return;
    if (result.errors.length > 0) {
      // A refused audition must not make the scene go back or loop: drop it and show the authored scene again.
      if (this.audition) {
        const a = this.audition;
        this.audition = undefined;
        this.dirty = true;
        a.onEnd("rejected");
        this.hooks.onRevert(result.errors);
        return;
      }
      this.scene = this.lastGood;
      this.setEvaluation();
      this.dirty = true; // also restore authored uniforms after a rejected transient view
      this.hooks.onRevert(result.errors);
      return;
    }
    this.lastGood = sent;
    this.hooks.onWarnings(result.warnings);
  }
}
