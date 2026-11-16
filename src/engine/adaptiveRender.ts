/**
 * Adaptive rendering (INTELLIGENT-RENDERING-01): spend extra computation where the picture is uncertain, not everywhere.
 *
 *  1. A cheap base picture is drawn (with depth). 2. A half-size "probe" draws only the march and reports rays that ran out of steps or
 *  used most of their budget. 3. Each tile of the picture gets an uncertainty score from colour edges, depth jumps (silhouettes, thin
 *  structures) and the probe. 4. Only the flagged tiles are drawn again, with finer ray-marching accuracy and more samples; every other
 *  pixel leaves the shader at once (see adaptiveMask.ts), so the extra cost follows the flagged share. 5. Tiles that stay unresolved after
 *  that are reported: they are the only places where a specialist tool such as Geometry Detail could still add something.
 *
 * Nothing here changes how a pixel is computed: refined tiles are exactly what an ordinary render with the refined settings gives
 * (checked in the real application), and the base picture is exactly the ordinary base render.
 */
import type { Engine, ImageBuffer, RenderOptions } from "./engine";
import type { QualitySettings } from "./renderSetup";
import { displayRgba } from "./display";
import type { DisplaySettings } from "./display";
import { MAX_MASK_TILES } from "./adaptiveMask";
import type { TileMask } from "./adaptiveMask";

export interface AdaptiveSettings {
  /** Quality of the base picture (all tiles). */
  base: Partial<QualitySettings>;
  /** Ray-marching accuracy for flagged tiles (merged over the base values). */
  refine: Partial<QualitySettings>;
  /** Samples per pixel inside flagged tiles. */
  refineSamples: number;
  /** Tile size in pixels (16 or 32). */
  tile: number;
  /** A tile is flagged when its uncertainty score reaches this (0..1). */
  minScore: number;
  /** At most this share of the tiles is refined (the most uncertain first). */
  maxShare: number;
  /** Contrast between neighbouring pixels (display light 0..1) that counts as an edge. */
  edgeContrast: number;
  /** Relative depth jump between neighbours that counts as a silhouette or a thin structure. */
  depthJump: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveSettings = {
  base: { precision_mode: "pixel", hit_pixels: 0.5, normal_pixels: 1, max_steps: 260, step_factor: 0.75, shadow_steps: 64, samples_per_pixel: 1 },
  refine: { precision_mode: "pixel", hit_pixels: 0.2, normal_pixels: 0.5, max_steps: 900, step_factor: 0.5, shadow_steps: 96 },
  refineSamples: 8, tile: 16, minScore: 0.12, maxShare: 0.85, edgeContrast: 0.06, depthJump: 0.03,
};

export interface TileScores {
  cols: number;
  rows: number;
  /** Uncertainty 0..1 per tile. */
  score: Float32Array;
  /** Which signal was strongest per tile: 1 colour edges, 2 depth jumps, 3 probe (ran out of steps or used most of them). */
  reason: Uint8Array;
}

export interface ProbeImage {
  width: number;
  height: number;
  /** The "raw" debug view as 8-bit RGBA: red = share of the step budget used, green = 0 missed, 128 hit, 255 ran out of steps. */
  data: Uint8Array;
}

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Scores every tile. Pure: takes finished pixels and returns numbers, so it can be tested without a graphics card. */
export function scoreTiles(
  width: number, height: number, tile: number,
  color: Uint8Array, depth: Float32Array | undefined, probe: ProbeImage | undefined,
  s: Pick<AdaptiveSettings, "edgeContrast" | "depthJump">,
): TileScores {
  const cols = Math.ceil(width / tile), rows = Math.ceil(height / tile);
  const edge = new Uint32Array(cols * rows), jump = new Uint32Array(cols * rows), count = new Uint32Array(cols * rows);
  const y8 = new Float32Array(width * height);
  for (let i = 0; i < y8.length; i++) y8[i] = luma(color[i * 4]!, color[i * 4 + 1]!, color[i * 4 + 2]!) / 255;
  const edgeContrast = s.edgeContrast, depthJump = s.depthJump;
  for (let y = 0; y < height; y++) {
    const rowT = Math.floor(y / tile) * cols, hasDown = y + 1 < height;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, t = rowT + Math.floor(x / tile), hasRight = x + 1 < width;
      count[t]!++;
      const here = y8[i]!;
      let e = 0, j = 0;
      if (hasRight) { if (Math.abs(here - y8[i + 1]!) > edgeContrast) e++; }
      if (hasDown) { if (Math.abs(here - y8[i + width]!) > edgeContrast) e++; }
      if (e) edge[t] = edge[t]! + e;
      if (depth) {
        const a = depth[i]!, hitA = a >= 0;
        if (hasRight) { const b = depth[i + 1]!, hitB = b >= 0; if (hitA !== hitB || (hitA && Math.abs(a - b) / Math.max(1e-6, Math.min(a, b)) > depthJump)) j++; }
        if (hasDown) { const b = depth[i + width]!, hitB = b >= 0; if (hitA !== hitB || (hitA && Math.abs(a - b) / Math.max(1e-6, Math.min(a, b)) > depthJump)) j++; }
        if (j) jump[t] = jump[t]! + j;
      }
    }
  }
  const score = new Float32Array(cols * rows), reason = new Uint8Array(cols * rows);
  const hard = new Float32Array(cols * rows);
  if (probe) {
    const n = new Uint32Array(cols * rows), bad = new Uint32Array(cols * rows);
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x++) {
        const o = (y * probe.width + x) * 4, t = Math.floor((y * height) / probe.height / tile) * cols + Math.floor((x * width) / probe.width / tile);
        n[t]!++;
        const used = probe.data[o]! / 255, status = probe.data[o + 1]! / 255;
        if (status > 0.75 || (status > 0.25 && used > 0.6)) bad[t]!++;
      }
    }
    for (let t = 0; t < hard.length; t++) hard[t] = n[t] ? Math.min(1, (8 * bad[t]!) / n[t]!) : 0;
  }
  for (let t = 0; t < score.length; t++) {
    const c = Math.min(1, (6 * edge[t]!) / (2 * count[t]!)), d = Math.min(1, (10 * jump[t]!) / (2 * count[t]!)), p = hard[t]!;
    score[t] = Math.max(c, d, p);
    reason[t] = p >= c && p >= d && p > 0 ? 3 : d >= c && d > 0 ? 2 : c > 0 ? 1 : 0;
  }
  return { cols, rows, score, reason };
}

/** Flags the most uncertain tiles: at least `minScore`, at most `maxShare` of all tiles. */
export function flagTiles(scores: TileScores, minScore: number, maxShare: number): Uint8Array {
  const n = scores.score.length, flags = new Uint8Array(n);
  const order = Array.from({ length: n }, (_, i) => i).filter((i) => scores.score[i]! >= minScore).sort((a, b) => scores.score[b]! - scores.score[a]!);
  for (const i of order.slice(0, Math.floor(n * maxShare))) flags[i] = 1;
  return flags;
}

export interface AdaptiveReport {
  /** Tile size, tiles per row and one byte per tile (1 = refined), for drawing a map of what was refined. */
  tile: number;
  cols: number;
  flags: Uint8Array;
  tiles: number;
  flagged: number;
  flaggedShare: number;
  reasons: { edges: number; depth: number; probe: number };
  /** Flagged tiles whose probe still ran out of steps with the refined accuracy: only these could still gain from a specialist tool. */
  unresolved: number;
  unresolvedShare: number;
  baseGpuMs: number;
  probeGpuMs: number;
  refineGpuMs: number;
  totalGpuMs: number;
  /** What the refinement would have cost on every pixel instead of the flagged share only. */
  uniformRefineEstimateGpuMs: number;
  /** Wall-clock milliseconds of each phase (base picture, probe, scoring, refinement, putting together, unresolved check). */
  wallMs: { base: number; probe: number; score: number; refine: number; merge: number; check: number };
}

export type AdaptiveOptions = Omit<RenderOptions, "quality" | "refine" | "region"> & { adaptive?: Partial<AdaptiveSettings>; /** Called when a phase starts, with a short name and how far the whole job has come (0..1). */ onPhase?: (phase: "base" | "probe" | "refine" | "merge", fraction: number) => void };

/** The probe picture: the raw debug view at half size, same film, so pixel-based accuracy matches the real picture. */
async function drawProbe(engine: Engine, width: number, height: number, quality: Partial<QualitySettings>, common: Omit<AdaptiveOptions, "adaptive">, onMs: (ms: number) => void): Promise<ProbeImage> {
  const w = Math.max(1, Math.ceil(width / 2)), h = Math.max(1, Math.ceil(height / 2));
  const image = await engine.renderToBuffer(w, h, { ...common, quality, debugView: "raw", referenceFilm: { width, height }, dofMode: "off", denoise: false, onTiming: (t) => onMs(t.gpuMs) } as RenderOptions);
  return { width: w, height: h, data: image.data };
}

/** Renders a picture adaptively. The whole picture (colour, depth, linear light) is held in memory, so very large pictures should use the ordinary streamed path. */
export async function renderAdaptive(engine: Engine, width: number, height: number, options: AdaptiveOptions): Promise<{ image: ImageBuffer; report: AdaptiveReport }> {
  const { adaptive, onPhase, ...common } = options;
  const s: AdaptiveSettings = { ...DEFAULT_ADAPTIVE, ...(adaptive ?? {}) };
  const cols = Math.ceil(width / s.tile), rows = Math.ceil(height / s.tile);
  if (cols * rows > MAX_MASK_TILES) throw Error("The picture has too many tiles for adaptive rendering; use a larger tile size.");
  let baseMs = 0, probeMs = 0, refineMs = 0;
  const wall = { base: 0, probe: 0, score: 0, refine: 0, merge: 0, check: 0 };
  let mark = performance.now();
  const lap = (k: keyof typeof wall): void => { const now = performance.now(); wall[k] += now - mark; mark = now; };
  const film = { width, height };
  onPhase?.("base", 0);
  const base = await engine.renderLayersToBuffer(width, height, { ...common, quality: s.base, referenceFilm: film, dofMode: "off", denoise: false, onTiming: (t) => { baseMs += t.gpuMs; } } as RenderOptions);
  lap('base');
  onPhase?.("probe", 0.3);
  const probe = await drawProbe(engine, width, height, { ...s.base, samples_per_pixel: 1 }, common, (ms) => { probeMs += ms; });
  lap('probe');
  const scores = scoreTiles(width, height, s.tile, base.color, base.depth, probe, s);
  const flags = flagTiles(scores, s.minScore, s.maxShare);
  lap('score');
  const flagged = flags.reduce((a, b) => a + b, 0);
  const linear = new Float32Array(base.linear!);
  let unresolved = 0, data = base.color;
  if (flagged > 0) {
    onPhase?.("refine", 0.4);
    const mask: TileMask = { tile: s.tile, cols, flags };
    const refined = await engine.renderToBuffer(width, height, {
      ...common, quality: s.base, referenceFilm: film, dofMode: "off", denoise: false,
      refine: { mask, quality: { ...s.refine, samples_per_pixel: s.refineSamples }, samples: s.refineSamples, only: true },
      onTiming: (t) => { refineMs += t.gpuMs; },
    } as RenderOptions);
    lap('refine');
    onPhase?.("merge", 0.95);
    const src = refined.linear!;
    // The picture is the base picture with the flagged tiles replaced; only those tiles are converted to 8-bit again.
    data = new Uint8Array(base.color);
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        if (flags[ty * cols + tx] !== 1) continue;
        const x0 = tx * s.tile, x1 = Math.min(width, x0 + s.tile), y1 = Math.min(height, ty * s.tile + s.tile);
        for (let y = ty * s.tile; y < y1; y++) {
          const from = (y * width + x0) * 4, to = (y * width + x1) * 4, span = src.subarray(from, to);
          linear.set(span, from); data.set(displayRgba(span, base.display), from);
        }
      }
    }
    lap('merge');
    // Which flagged tiles does the finer accuracy still not resolve? (half-size march at the refined accuracy)
    const after = await drawProbe(engine, width, height, { ...s.base, ...s.refine, samples_per_pixel: 1 }, common, (ms) => { probeMs += ms; });
    const again = scoreTiles(width, height, s.tile, new Uint8Array(width * height * 4), undefined, after, s);
    for (let i = 0; i < flags.length; i++) if (flags[i] && again.score[i]! >= 0.5) unresolved++;
    lap('check');
  }
  const display: DisplaySettings | undefined = base.display;
  const reasons = { edges: 0, depth: 0, probe: 0 };
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const r = scores.reason[i];
    if (r === 1) reasons.edges++; else if (r === 2) reasons.depth++; else if (r === 3) reasons.probe++;
  }
  const share = flagged / flags.length;
  const report: AdaptiveReport = {
    tile: s.tile, cols, flags, tiles: flags.length, flagged, flaggedShare: share, reasons, unresolved, unresolvedShare: flagged ? unresolved / flagged : 0,
    baseGpuMs: baseMs, probeGpuMs: probeMs, refineGpuMs: refineMs, totalGpuMs: baseMs + probeMs + refineMs,
    uniformRefineEstimateGpuMs: share > 0 ? refineMs / share : 0, wallMs: wall,
  };
  return { image: { width, height, data, linear, ...(display ? { display } : {}) }, report };
}

export interface UncertaintyReport {
  /** Share of all rays that ran out of steps (their colour is a guess). */
  exhaustedShare: number;
  /** Share of the rays that hit the surface but used more than 60 % of the step budget (thin or grazing structures). */
  strainedShare: number;
  /** Share of the tiles that contain at least one such ray in at least 12 % of their probe pixels. */
  tileShare: number;
}

/**
 * How certain is the geometry of a finished setup? A half-size march-only picture (a few percent of the cost of the picture) counts rays that
 * ran out of steps. Anything left over after the finest Float32 setup is where a specialist tool such as Geometry Detail could still help.
 */
export async function probeUncertainty(engine: Engine, width: number, height: number, quality: Partial<QualitySettings>, common: Omit<AdaptiveOptions, "adaptive" | "onPhase"> = {}, tile = 16): Promise<UncertaintyReport> {
  const probe = await drawProbe(engine, width, height, { ...quality, samples_per_pixel: 1 }, common, () => undefined);
  let exhausted = 0, strained = 0;
  for (let i = 0; i < probe.width * probe.height; i++) {
    const used = probe.data[i * 4]! / 255, status = probe.data[i * 4 + 1]! / 255;
    if (status > 0.75) exhausted++; else if (status > 0.25 && used > 0.6) strained++;
  }
  const scores = scoreTiles(width, height, tile, new Uint8Array(width * height * 4), undefined, probe, { edgeContrast: 1, depthJump: 1 });
  const flagged = scores.score.reduce((a, v) => a + (v >= 0.12 ? 1 : 0), 0);
  const n = probe.width * probe.height;
  return { exhaustedShare: exhausted / n, strainedShare: strained / n, tileShare: flagged / scores.score.length };
}
