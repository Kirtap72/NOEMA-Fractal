/**
 * Progressive still rendering (INTELLIGENT-RENDERING-02).
 *
 * A progressive render is a series of REAL renders of increasing quality, each shown as soon as it is finished:
 *   1. a small first picture (only when the final picture is large),
 *   2. the picture at full size with the geometry getting finer step by step (Standard, Fin, Extra fin, ...), shadows following,
 *   3. when the geometry is final, extra samples per pixel are added, doubling each time (2, 4, 8 ...).
 * Nothing is upscaled and nothing is faked: stage 2 changes how exactly the surface is found, stage 3 adds samples.
 *
 * What is reused: the samples of stage 3 are only the NEW ones (sampleOffset), merged into the running average, so the final image
 * is the image a one-shot render with the same sample count gives. The first sample of the final geometry stage is sample 0 of that
 * average. A finer geometry level cannot reuse the coarser one (it finds a different surface), and says so.
 */
import type { Engine, ImageBuffer, RenderOptions } from "./engine";
import { displayRgba } from "./display";
import type { DisplaySettings } from "./display";
import { GEOMETRY_LEVELS, qualityValues } from "./qualityLevels";
import type { AntialiasLevel, GeometryLevel, ShadowLevel } from "./qualityLevels";

export interface ProgressTarget { geometry: GeometryLevel; antialias: number; shadows: number }

export interface ProgressStage {
  id: string;
  label: string;
  /** Linear scale of the picture of this stage (1 = full size). */
  scale: number;
  geometry: GeometryLevel;
  shadows: ShadowLevel;
  /** Samples drawn in this stage. */
  samples: number;
  /** First sample number of this stage (so the sample pattern continues). */
  sampleOffset: number;
  /** Samples in the running average after this stage (only meaningful for full-size stages of the final geometry). */
  totalSamples: number;
  /** True when this picture replaces the previous one instead of being added to it. */
  replaces: boolean;
}

const SHADOW_FOR: Record<GeometryLevel, ShadowLevel> = { draft: 32, standard: 32, fine: 64, extra: 128, max: 128, ultra: 128 };
const FIRST_PICTURE_PIXELS = 1_200_000;

/** The sequence of stages for a final picture of `film` size and a target quality. Pure; tested without a graphics card. */
export function progressivePlan(film: { width: number; height: number }, target: ProgressTarget): ProgressStage[] {
  const order = GEOMETRY_LEVELS.map((g) => g.id);
  const finalIndex = Math.max(0, order.indexOf(target.geometry));
  const stages: ProgressStage[] = [];
  const pixels = film.width * film.height;
  if (pixels > 4_000_000 && (target.antialias > 1 || finalIndex > 1)) {
    stages.push({ id: "first", label: "Small preview", scale: Math.max(0.05, Math.sqrt(FIRST_PICTURE_PIXELS / pixels)), geometry: "standard", shadows: 32, samples: 1, sampleOffset: 0, totalSamples: 1, replaces: true });
  }
  // Geometry ladder at full size, from Standard (or Utkast when that is the target) up to the target level.
  const start = finalIndex === 0 ? 0 : 1;
  for (let i = start; i <= finalIndex; i++) {
    const g = order[i]!;
    stages.push({ id: `geometry-${g}`, label: `Geometry ${GEOMETRY_LEVELS[i]!.label}`, scale: 1, geometry: g, shadows: SHADOW_FOR[g] > target.shadows ? (target.shadows as ShadowLevel) : SHADOW_FOR[g], samples: 1, sampleOffset: 0, totalSamples: 1, replaces: true });
  }
  // Samples: 2, 4, 8 ... up to the target, each stage adding only the new ones.
  let have = 1;
  for (let total = 2; total <= target.antialias * 2 && have < target.antialias; total *= 2) {
    const t = Math.min(total, target.antialias);
    stages.push({ id: `samples-${t}`, label: `Anti-aliasing ${t} samples`, scale: 1, geometry: order[finalIndex]!, shadows: target.shadows as ShadowLevel, samples: t - have, sampleOffset: have, totalSamples: t, replaces: false });
    have = t;
  }
  // The last full-size stage uses the target's own shadow steps.
  const last = stages[stages.length - 1];
  if (last && last.scale === 1) last.shadows = target.shadows as ShadowLevel;
  return stages;
}

/** Combines two averages of `nA` and `nB` samples into the average of all `nA + nB`. */
export function mergeAverages(a: Float32Array, nA: number, b: Float32Array, nB: number): Float32Array {
  const out = new Float32Array(a.length), wa = nA / (nA + nB), wb = nB / (nA + nB);
  for (let i = 0; i < out.length; i++) out[i] = a[i]! * wa + b[i]! * wb;
  return out;
}

export interface ProgressFrame {
  stage: ProgressStage;
  index: number;
  count: number;
  image: ImageBuffer;
  /** Samples averaged in this picture. */
  samples: number;
  elapsedMs: number;
  stageMs: number;
}

export interface ProgressiveOptions extends Omit<RenderOptions, "quality" | "sampleOffset" | "onProgress" | "region" | "refine"> {
  /**
   * Detail View: draw only `region` of the final picture `film` (true 1:1 pixels, same camera and pixel footprint as the full render).
   * Then the `film` argument of renderProgressive is the size of the region, and `plan` should come from the region's own plan.
   */
  detail?: { film: { width: number; height: number }; region: { x: number; y: number; width: number; height: number } };
  /** A ready-made plan (a restart after a lighting change uses fewer stages). */
  plan?: ProgressStage[];
  onFrame?: (frame: ProgressFrame) => void;
  onStageStart?: (stage: ProgressStage, index: number, count: number) => void;
}

/**
 * Runs the plan on an engine whose scene is already set. Resolves with the best (last finished) frame; when aborted, the error carries
 * `best` so the caller can keep the best completed picture.
 */
export async function renderProgressive(engine: Engine, film: { width: number; height: number }, target: ProgressTarget, options: ProgressiveOptions = {}): Promise<ProgressFrame> {
  const { onFrame, onStageStart, detail, plan: givenPlan, ...common } = options;
  const plan = givenPlan ?? progressivePlan(film, target), started = performance.now();
  let best: ProgressFrame | undefined, running: { linear: Float32Array; n: number } | undefined, display: DisplaySettings | undefined;
  try {
    for (const [index, stage] of plan.entries()) {
      if (common.signal?.aborted) throw Object.assign(Error("Cancelled"), { name: "AbortError" });
      onStageStart?.(stage, index, plan.length);
      const w = Math.max(16, Math.round(film.width * stage.scale)), h = Math.max(16, Math.round(film.height * stage.scale)), t0 = performance.now();
      const quality = { ...qualityValues({ geometry: stage.geometry, shadows: stage.shadows }), samples_per_pixel: stage.samples };
      const image = detail
        ? await engine.renderToBuffer(detail.film.width, detail.film.height, { ...common, quality, sampleOffset: stage.sampleOffset, referenceFilm: detail.film, region: detail.region } as RenderOptions)
        : await engine.renderToBuffer(w, h, { ...common, quality, sampleOffset: stage.sampleOffset, referenceFilm: { width: w, height: h } } as RenderOptions);
      display = image.display ?? display;
      let linear = image.linear!, n = stage.samples;
      if (!stage.replaces && running) { linear = mergeAverages(running.linear, running.n, image.linear!, stage.samples); n = running.n + stage.samples; }
      running = stage.scale === 1 ? { linear, n } : undefined;
      const shown: ImageBuffer = stage.replaces ? image : { width: w, height: h, data: displayRgba(linear, display), linear, ...(display ? { display } : {}) };
      best = { stage, index, count: plan.length, image: shown, samples: n, elapsedMs: performance.now() - started, stageMs: performance.now() - t0 };
      onFrame?.(best);
    }
  } catch (e) {
    if (best && e instanceof Error) (e as Error & { best?: ProgressFrame }).best = best;
    throw e;
  }
  return best!;
}

export type { AntialiasLevel };
