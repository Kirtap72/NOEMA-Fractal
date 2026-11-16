/**
 * Decides which compiled shader belongs to the scene the user wants now.
 *
 * Compiling a new shader takes time, and the user keeps working meanwhile
 * (sliders, camera, adding steps). Rules:
 * - the newest request always wins; older ones are told they were superseded;
 * - a compile that is already running for the same shader is shared, never restarted
 *   (otherwise a call every frame would restart it forever);
 * - a compiled shader is only taken into use for the newest request, so the picture
 *   never mixes a new shader with the old scene's numbers;
 * - a compile that has not started yet when a newer shader has been asked for is skipped (SHADER-UNIFORMS-08): dragging a control that needs a new
 *   shader at every step used to line up one full compile per step (15 to 25 s each), all but the last of them for nothing.
 */
export type CompileResult<C> = { errors: string[]; result?: C };

export type SwitchOutcome<C> =
  | { kind: "applied"; compiled: C }
  | { kind: "superseded" }
  | { kind: "failed"; errors: string[] };

/**
 * True when the shader in use (`current`) was compiled for the scene whose resolved key is `wanted`. The engine appends option suffixes
 * ("|secondary-radiance-gain:1", "|diffuse-orbit:null" ...) to the key it compiles with, so the plain key of the scene is a prefix of the
 * key in use. The boundary "|" keeps one scene's key from matching another scene's key that merely starts with the same characters.
 * (Before DETAIL-LOOKDEV-03B distanceAt, colorsAt and distanceGrid compared for equality and always refused.)
 */
export function sceneKeyInUse(current: string | null, wanted: string): boolean {
  return current !== null && (current === wanted || current.startsWith(wanted + "|"));
}

export class SceneSwitcher<S, C> {
  private token = 0;
  private compiledKey: string | null = null;
  /** The shader of the newest `apply`. A queued compile for any other key that nobody asked to prepare is stale. */
  private wantedKey: string | null = null;
  private compiled: C | null = null;
  private inflight: { key: string; promise: Promise<CompileResult<C>> } | null = null;

  /** LOOKDEV-05: finished shaders kept for a quick return (the plain and the look variant of one scene). Newest last. */
  private readonly kept = new Map<string, C>();

  /**
   * `keep` is how many finished shaders are remembered besides the one in use (0 = none, the old behaviour); `keepable` says which results may be
   * remembered at all (a shader that owns resources tied to one scene must not be reused for another).
   */
  constructor(
    /** `stale()` is true when, by the time the compile would start, the newest request wants another shader (and this is not a `prepare`). */
    private compile: (key: string, scene: S, stale: () => boolean) => Promise<CompileResult<C>>,
    private readonly options: { keep?: number; keepable?: (compiled: C) => boolean } = {},
  ) {}

  private remember(key: string, compiled: C): void {
    const limit = this.options.keep ?? 0;
    if (limit <= 0 || (this.options.keepable && !this.options.keepable(compiled))) return;
    this.kept.delete(key);
    this.kept.set(key, compiled);
    while (this.kept.size > limit) this.kept.delete(this.kept.keys().next().value as string);
  }

  /** True when a shader for `key` is in use or remembered, so `apply` would not have to compile. */
  has(key: string): boolean { return this.compiledKey === key || this.kept.has(key); }

  /** Forgets every remembered shader (the formulas changed under the same ids). The one in use is untouched. */
  forgetKept(): void { this.kept.clear(); }

  /**
   * Builds the shader for `key` in the background without switching to it, so a later `apply` with the same key is instant. Shares a running
   * compile of the same key. Resolves false when it failed or nothing was kept. Never changes the shader in use.
   */
  async prepare(key: string, scene: S): Promise<boolean> {
    if (this.compiledKey === key || this.kept.has(key)) return true;
    let promise = this.inflight?.key === key ? this.inflight.promise : null;
    if (!promise) {
      const started = this.compile(key, scene, () => false);
      this.inflight = { key, promise: started };
      const forget = (): void => { if (this.inflight?.promise === started) this.inflight = null; };
      started.then(forget, forget);
      promise = started;
    }
    const outcome = await promise;
    if (!outcome.result) return false;
    if (this.compiledKey !== key) this.remember(key, outcome.result);
    return this.kept.has(key);
  }

  /** The key of the shader in use right now, if any. */
  get currentKey(): string | null {
    return this.compiledKey;
  }

  /** The shader in use right now, if any. */
  get current(): C | null {
    return this.compiled;
  }

  /** Cancel pending selection while asynchronous scene resources are prepared. */
  invalidatePending():void {this.token++;}

  /** `key` identifies the shader the scene needs. Same key means the same compiled shader. */
  async apply(key: string, scene: S): Promise<SwitchOutcome<C>> {
    const mine = ++this.token;
    this.wantedKey = key;
    if (this.compiledKey !== key && this.kept.has(key)) {
      // Built earlier (prepare, or used before): switch at once. The one we leave is remembered in its place.
      // Take the one we want out first: remembering the old one could otherwise push it out of a small cache.
      const next = this.kept.get(key) as C;
      this.kept.delete(key);
      if (this.compiledKey !== null && this.compiled !== null) this.remember(this.compiledKey, this.compiled);
      this.compiled = next; this.compiledKey = key;
      return { kind: "applied", compiled: next };
    }
    if (this.compiledKey !== key) {
      let promise = this.inflight?.key === key ? this.inflight.promise : null;
      if (!promise) {
        const started = this.compile(key, scene, () => this.wantedKey !== key);
        this.inflight = { key, promise: started };
        const forget = (): void => {
          if (this.inflight?.promise === started) this.inflight = null;
        };
        started.then(forget, forget);
        promise = started;
      }
      const outcome = await promise;
      if (mine !== this.token) return { kind: "superseded" };
      if (!outcome.result) return { kind: "failed", errors: outcome.errors };
      if (this.compiledKey !== null && this.compiled !== null) this.remember(this.compiledKey, this.compiled);
      this.compiled = outcome.result;
      this.compiledKey = key;
      this.kept.delete(key);
    }
    return { kind: "applied", compiled: this.compiled as C };
  }
}
