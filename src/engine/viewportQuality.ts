import type {ReflectionBudget} from "./reflections";
import type { QualitySettings } from "./renderSetup";

export const VIEWPORT_MODES = [
  "automatic",
  "navigate",
  "lookdev",
  "final",
] as const;
export type ViewportMode = (typeof VIEWPORT_MODES)[number];
export type ViewportState = "navigate" | "lookdev" | "final";
/** Costs belong to the renderer, not a formula or the persisted scene. Future effects can extend this contract. */
export interface ViewportFeatures {
  /** NAV/LookDev retain their cheaper original normal sampling. Final paths omit this override. */
  filmNormals?:boolean;
  filmHits?:boolean;
  shadows: boolean;
  occlusion: boolean;
  material: boolean;
  simpleLight: boolean;
  tetraNormal: boolean;
  /** Optional costs: omitted means enabled, preserving all existing callers. */
  reflections?: boolean;
  secondaryReflections?: boolean;
  reflectionBudget?: ReflectionBudget;
  maxTransportBounces?:number;
  fog?: boolean;
}
export const FULL_VIEWPORT_FEATURES: ViewportFeatures = {
  shadows: true,
  occlusion: true,
  material: true,
  simpleLight: false,
  tetraNormal: false,
};
export const NAVIGATE_FEATURES: ViewportFeatures = {
  shadows: false,
  occlusion: false,
  material: false,
  simpleLight: true,
  tetraNormal: true,
  secondaryReflections:false,
  filmNormals:false,
  filmHits:false,
};
/** Zero preserves the original shader path, including all exported pictures/layers. */
export function viewportFeatureMask(f: ViewportFeatures): number {
  return (
    (f.shadows ? 0 : 1) |
    (f.occlusion ? 0 : 2) |
    (f.material ? 0 : 4) |
    (f.simpleLight ? 8 : 0) |
    (f.tetraNormal ? 16 : 0) |
    (f.reflections === false ? 32 : 0) |
    (f.fog === false ? 64 : 0) | (f.secondaryReflections === false ? 128 : 0)
  );
}
export interface ViewportPlan {
  state: ViewportState;
  scale: number;
  quality: QualitySettings;
  features: ViewportFeatures;
  generation: number;
  costGeneration: number;
}

/** Pure policy: time and completed GPU milliseconds are provided by the host. Never edits a scene. */
export class ViewportQualityController {
  mode: ViewportMode = "automatic";
  private lastTouch = -Infinity;
  private held = false;
  private generation = 0;
  private costGeneration = 0;
  private previous: ViewportState | null = null;
  private navScale = 0.5;
  private navSteps = 80;
  private lookScale = 0.5;
  private lookStage = 0;
  private lookSettled = false;
  private fastFrames = 0;

  constructor(
    public idleMs = 400,
    readonly targetMs = 1000 / 30,
  ) {}
  setMode(mode: ViewportMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.invalidate();
    this.previous = null;
  }
  isInteracting(now: number): boolean { return this.held || now - this.lastTouch < 80; }
  private invalidate(): void {
    this.generation++;
    this.lookStage = 0;
    this.lookSettled = false;
  }
  touch(now: number): void {
    this.lastTouch = now;
    this.invalidate();
  }
  hold(held: boolean, now: number): void {
    this.held = held;
    this.touch(now);
  }
  /** A different formula/effect workload must not inherit a permanently degraded resolution. */
  resetCost(): void {
    this.costGeneration++;
    this.navScale = 0.5;
    this.navSteps = 80;
    this.fastFrames = 0;
    this.invalidate();
  }

  plan(now: number, stored: QualitySettings): ViewportPlan {
    // Final preview is an idle target, never a reason to trace secondary rays during camera input.
    const navigating = this.held || now - this.lastTouch < this.idleMs;
    const state: ViewportState =
      this.mode === "automatic" || this.mode === "final"
        ? navigating ? "navigate" : this.mode === "final" ? "final" : "lookdev"
        : this.mode;
    if (state !== this.previous) {
      this.generation++;
      if (state === "lookdev") {
        this.lookScale = this.navScale;
        this.lookStage = 0;
        this.lookSettled = false;
      }
      this.previous = state;
    }
    if (state === "final")
      return {
        state,
        scale: 1,
        quality: { ...stored },
        features: { ...FULL_VIEWPORT_FEATURES },
        generation: this.generation,
        costGeneration: this.costGeneration,
      };
    const nav = state === "navigate";
    const quality: QualitySettings = {
      ...stored,
      samples_per_pixel: 1,
      max_steps: Math.min(
        stored.max_steps,
        nav ? this.navSteps : 120 + this.lookStage * 80,
      ),
      precision_mode: nav ? "pixel" : stored.precision_mode,
      hit_pixels: nav
        ? 1.5
        : Math.max(stored.hit_pixels, 1 - this.lookStage * 0.15),
      normal_pixels: nav
        ? 2
        : Math.max(stored.normal_pixels, 1.5 - this.lookStage * 0.125),
      hit_precision: nav
        ? Math.max(stored.hit_precision, 0.001)
        : Math.max(stored.hit_precision, 0.0008 / (1 + this.lookStage)),
      normal_epsilon: nav
        ? Math.max(stored.normal_epsilon, 0.002)
        : Math.max(stored.normal_epsilon, 0.0016 / (1 + this.lookStage)),
      shadow_steps: Math.min(
        stored.shadow_steps,
        nav ? 4 : 16 + this.lookStage * 8,
      ),
    };
    return {
      state,
      scale: nav ? this.navScale : this.lookScale,
      quality,
      features: { ...(nav ? NAVIGATE_FEATURES : FULL_VIEWPORT_FEATURES),secondaryReflections:false,filmNormals:false,filmHits:false },
      generation: this.generation,
      costGeneration: this.costGeneration,
    };
  }
  /** Ignore obsolete work after new input. Downshift fast; increase only after sustained headroom. */
  complete(plan: ViewportPlan, milliseconds: number): void {
    if (
      !(milliseconds > 0) ||
      !Number.isFinite(milliseconds) ||
      plan.state === "final"
    )
      return;
    // NAV still learns while pointer events update the camera during an in-flight frame.
    // A different chain invalidates this cost; an obsolete still refinement must always be ignored.
    if (
      plan.state === "navigate"
        ? plan.costGeneration !== this.costGeneration ||
          this.previous !== "navigate"
        : plan.generation !== this.generation
    )
      return;
    if (plan.state === "navigate") {
      if (milliseconds > this.targetMs * 1.15) {
        this.navScale = Math.max(
          0.0625,
          this.navScale *
            Math.max(0.35, Math.sqrt((this.targetMs * 0.8) / milliseconds)),
        );
        if (this.navScale < 0.18)
          this.navSteps = Math.max(24, Math.floor(this.navSteps * 0.8));
        this.fastFrames = 0;
      } else if (milliseconds < this.targetMs * 0.65) {
        if (++this.fastFrames >= 3) {
          this.navScale = Math.min(1, this.navScale * 1.18);
          this.navSteps = Math.min(96, this.navSteps + 8);
          this.fastFrames = 0;
        }
      } else this.fastFrames = 0;
    } else if (!this.lookSettled) {
      // Refinement is resolution/precision, not biased 8-bit accumulation. Bound the next job's predicted cost.
      if (milliseconds > 100) {
        this.lookScale = Math.max(
          0.0625,
          this.lookScale * Math.sqrt(75 / milliseconds),
        );
        this.lookSettled = true;
      } else if (this.lookStage < 4) {
        this.lookStage++;
        this.lookScale = Math.min(
          1,
          this.lookScale * Math.min(1.3, Math.sqrt(65 / milliseconds)),
        );
      } else this.lookSettled = true;
    }
  }
}
