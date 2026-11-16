import { generateChain } from "./formula/chain";
import { compileChainCpu } from "./formula/cpu";
import type { Formula } from "./formula/types";
import { Random } from "./randomChain";
import type { ThumbnailMeasures } from "./thumbnailMeasures";

/**
 * "Random formula", step 2 (ARCHITECTURE.md 8.21 sections 2 and 3): the automatic filters that run on the processor,
 * before any shader is compiled. Every measure is a plain number, written to the formula's measurement record, so
 * that the thresholds can be checked and changed later. The thresholds are calibrated on formulas whose answer is
 * known (tests/formulaFilter.test.ts), not guessed.
 */

export const MEASURES_VERSION = 1;

export type RejectReason = "invalid" | "not-a-number" | "empty" | "solid" | "no-view" | "unreliable";

export interface FilterMeasures {
  /** Half the side of the cube the points are sampled in. */
  sampleRadius: number;
  /** a: the file is a formula whose shader code can be generated. */
  valid: boolean;
  /** b: the share of sample points where the distance is a number. */
  finiteShare: number;
  /** c: the share of sample points inside or near the surface (distance below 5 % of the sample radius). */
  nearShare: number;
  /** d: the share of sample points inside (distance 0 or below). */
  insideShare: number;
  /** The camera distance at which between 5 and 90 % of the rays hit; 0 when none was found. */
  viewDistance: number;
  /** The share of the test rays that hit at that distance. */
  hitShare: number;
  /** e: the gradient test: the share of point pairs where the distance changes faster than the position. */
  gradientViolationShare: number;
  /** e: the 95th percentile of |A(p) - A(q)| / |p - q| near the surface. 1 or below is safe. */
  gradientL95: number;
  /** e: the overshoot test: the largest ratio of the distance to the way left to the surface along a ray. 1 or below is safe. */
  overshoot: number;
  /** The step factor the formula needs: min(1, 0.9 / max(L95, overshoot)). */
  stepFactor: number;
  /** How long the filters took, in milliseconds (0 when not measured). */
  milliseconds: number;
}

export interface FilterResult {
  passed: boolean;
  /** Why the formula was thrown away (the first failed test). */
  reason?: RejectReason;
  measures: FilterMeasures;
}

/** The thresholds. Calibrated in tests/formulaFilter.test.ts; the values measured there are in ARCHITECTURE.md 8.21. */
export const FILTER_LIMITS = {
  /** c: below this share of points near the surface, there is nothing to draw ("everything escapes"). */
  minNearShare: 0.002,
  /** d: above this share of points inside, the sample cube is filled ("nothing escapes"). */
  maxInsideShare: 0.9,
  /** Hit shares accepted when looking for a camera distance. */
  hitRange: [0.05, 0.9] as const,
  /** e: below this step factor the formula is too slow or too unreliable to draw. */
  minStepFactor: 0.3,
};

export interface FilterOptions {
  seed?: number;
  /** Parameter values (left out: the formula's defaults). */
  params?: readonly number[];
  /** Points per axis of the sample grid (the number of points is the cube of this). */
  gridSide?: number;
  /** Rays across and down. */
  rays?: [number, number];
  /** How many hitting rays are used for the reliability tests. */
  reliabilityRays?: number;
  /** A clock for the time measurement (the engine never reads the time itself; left out: 0 ms). */
  now?: () => number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** The camera direction of createDefaultScene, so that measures and pictures agree. */
const YAW = 0.6;
const PITCH = 0.35;

/** Runs the filters a to e on a formula. Deterministic for the same formula, parameters and seed. */
export function inspectFormula(formula: Formula, options: FilterOptions = {}): FilterResult {
  const started = options.now?.() ?? 0;
  const R = (formula.cameraDistance ?? 4) / 2;
  const measures: FilterMeasures = {
    sampleRadius: R,
    valid: false,
    finiteShare: 0,
    nearShare: 0,
    insideShare: 0,
    viewDistance: 0,
    hitShare: 0,
    gradientViolationShare: 0,
    gradientL95: 0,
    overshoot: 0,
    stepFactor: 0,
    milliseconds: 0,
  };
  const done = (reason?: RejectReason): FilterResult => {
    measures.milliseconds = options.now ? Math.round(options.now() - started) : 0;
    return reason ? { passed: false, reason, measures } : { passed: true, measures };
  };

  // a. a valid formula whose shader code can be generated
  const chain = generateChain([{ formula, iterations: formula.iterations }], 1);
  if (!chain.ok) return done("invalid");
  measures.valid = true;

  const run = compileChainCpu([{ formula, iterations: formula.iterations }], 1);
  const params = options.params ?? formula.parameters.map((p) => p.default);
  const de = (p: readonly number[]): number => run(p, params).dist;
  const rng = new Random(options.seed ?? 1);

  // b, c, d: a grid of points with a random offset inside each cell, in the cube [-R, R]^3
  const n = options.gridSide ?? 13;
  let finite = 0;
  let near = 0;
  let inside = 0;
  const cell = (2 * R) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const p = [-R + (i + rng.next()) * cell, -R + (j + rng.next()) * cell, -R + (k + rng.next()) * cell];
        const d = de(p);
        if (!Number.isFinite(d)) continue;
        finite++;
        if (d < 0.05 * R) near++;
        if (d <= 0) inside++;
      }
    }
  }
  const total = n * n * n;
  measures.finiteShare = finite / total;
  measures.nearShare = near / total;
  measures.insideShare = inside / total;
  if (finite < total) return done("not-a-number");
  if (measures.nearShare < FILTER_LIMITS.minNearShare) return done("empty");
  if (measures.insideShare > FILTER_LIMITS.maxInsideShare) return done("solid");

  // A camera distance where the formula fills a sensible part of the picture (the same direction as the default camera).
  const [w, h] = options.rays ?? [12, 9];
  const tanHalf = Math.tan((50 * Math.PI) / 360);
  const hitThreshold = (t: number) => 1e-4 * R * (1 + t / R);
  const camAt = (D: number) => [D * Math.cos(PITCH) * Math.sin(YAW), D * Math.sin(PITCH), D * Math.cos(PITCH) * Math.cos(YAW)];
  const rayDirs = (cam: number[]) => {
    const D = Math.hypot(...cam);
    const f = cam.map((v) => -v / D);
    const right = [f[2]!, 0, -f[0]!];
    const rl = Math.hypot(...right);
    const r = right.map((v) => v / rl);
    const u = [r[1]! * f[2]! - r[2]! * f[1]!, r[2]! * f[0]! - r[0]! * f[2]!, r[0]! * f[1]! - r[1]! * f[0]!];
    const dirs: number[][] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = ((2 * (x + 0.5) - w) / h) * tanHalf;
        const ny = ((h - 2 * (y + 0.5)) / h) * tanHalf;
        const d = f.map((v, i) => v + r[i]! * nx + u[i]! * ny);
        const l = Math.hypot(...d);
        dirs.push(d.map((v) => v / l));
      }
    }
    return dirs;
  };
  /** Marches a ray; returns the distance to the hit or -1. `factor` below 1 makes it careful. */
  const march = (cam: number[], dir: number[], factor: number, maxSteps: number, tMax: number): number => {
    let t = 0;
    for (let s = 0; s < maxSteps; s++) {
      const d = de(cam.map((c, i) => c + dir[i]! * t));
      if (!Number.isFinite(d)) return -1;
      if (d < hitThreshold(t)) return t;
      t += Math.max(d, hitThreshold(t) * 0.5) * factor;
      if (t > tMax) return -1;
    }
    return -1;
  };

  const base = formula.cameraDistance ?? 4;
  let cam: number[] = [];
  let hits: { dir: number[]; t: number }[] = [];
  // First with ordinary steps; if no distance works, again with careful steps (a quarter), because a distance
  // estimate that is far too large makes ordinary rays jump over the surface, and that must show up as "unreliable"
  // below, not as "nothing to see".
  // The careful search is limited (one distance, every third ray, 1500 steps) so that a formula with nothing to see
  // cannot take long.
  const searches = [
    { factor: 0.9, maxSteps: 300, distances: [base, base * 0.6, base * 1.6], every: 1 },
    { factor: 0.25, maxSteps: 1500, distances: [base], every: 3 },
  ];
  search: for (const { factor, maxSteps, distances, every } of searches) {
    for (const D of distances) {
      const c = camAt(D);
      const tMax = D + 2 * R;
      const found: { dir: number[]; t: number }[] = [];
      const dirs = rayDirs(c).filter((_, i) => i % every === 0);
      for (const dir of dirs) {
        const t = march(c, dir, factor, maxSteps, tMax);
        if (t >= 0) found.push({ dir, t });
      }
      const share = found.length / dirs.length;
      if (share >= FILTER_LIMITS.hitRange[0] && share <= FILTER_LIMITS.hitRange[1]) {
        cam = c;
        hits = found;
        measures.viewDistance = D;
        measures.hitShare = share;
        break search;
      }
    }
  }
  if (hits.length === 0) return done("no-view");

  // e. reliability, on a few of the hitting rays chosen evenly
  const want = Math.min(hits.length, options.reliabilityRays ?? 20);
  const chosen = Array.from({ length: want }, (_, i) => hits[Math.floor((i * hits.length) / want)]!);
  const ratios: number[] = [];
  let overshoot = 0;
  const eps = 1e-3 * R;
  for (const { dir } of chosen) {
    // The reference hit: a careful march (a quarter of every step), which still finds the surface when the
    // estimate is up to four times too large.
    const tRef = march(cam, dir, 0.25, 3000, measures.viewDistance + 2 * R);
    if (tRef <= 0) continue;
    for (let j = 0; j < 8; j++) {
      const t = (tRef * j) / 8;
      const left = tRef - t;
      const d = de(cam.map((c, i) => c + dir[i]! * t));
      overshoot = Math.max(overshoot, d / left);
    }
    // Pairs of points just in front of the surface, in random directions.
    for (const back of [0.002, 0.01, 0.05]) {
      const p = cam.map((c, i) => c + dir[i]! * (tRef - back * R));
      for (let k = 0; k < 10; k++) {
        const v = [rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5];
        const l = Math.hypot(...v) || 1;
        const q = p.map((x, i) => x + (v[i]! / l) * eps);
        const a = de(p);
        const b = de(q);
        if (Number.isFinite(a) && Number.isFinite(b)) ratios.push(Math.abs(a - b) / eps);
      }
    }
  }
  measures.gradientL95 = percentile(ratios, 0.95);
  measures.gradientViolationShare = ratios.length === 0 ? 0 : ratios.filter((r) => r > 1).length / ratios.length;
  measures.overshoot = overshoot;
  measures.stepFactor = Math.min(1, 0.9 / Math.max(measures.gradientL95, measures.overshoot, 1e-9));
  if (measures.stepFactor < FILTER_LIMITS.minStepFactor) return done("unreliable");
  return done();
}

// ---- the measurement record of a formula (8.21 section 8.1 b)

export const RECORD_VERSION = 1;

export interface FormulaRecord {
  record_version: number;
  formula_id: string;
  /** A check value of the formula file's text (FNV-1a, 32 bits, hexadecimal): the measures belong to exactly this text. */
  formula_hash: string;
  origin?: { grammar: string; seed: number; family: string; operations: string[]; parent?: { id: string; variant: number } };
  measures_version: number;
  measures: FilterMeasures;
  passed: boolean;
  reason?: RejectReason;
  /** The measures of the formula's thumbnail (tests f and g), when one was drawn. */
  thumbnail?: ThumbnailMeasures & { verdict: string };
  created: string;
  /** The owner's rating: 1 to 5, or null when not rated. Never written by a scoring system. */
  rating: { value: number | null; rated_at?: string };
}

export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function createFormulaRecord(formulaId: string, formulaText: string, result: FilterResult, now: Date, origin?: FormulaRecord["origin"]): FormulaRecord {
  return {
    record_version: RECORD_VERSION,
    formula_id: formulaId,
    formula_hash: textHash(formulaText),
    ...(origin ? { origin } : {}),
    measures_version: MEASURES_VERSION,
    measures: { ...result.measures },
    passed: result.passed,
    ...(result.reason ? { reason: result.reason } : {}),
    created: now.toISOString(),
    rating: { value: null },
  };
}

/** Adds the measures of the thumbnail and the verdict of tests f and g. */
export function withThumbnailMeasures(record: FormulaRecord, measures: ThumbnailMeasures, verdict: string): FormulaRecord {
  return { ...record, thumbnail: { ...measures, verdict } };
}

/** Sets the owner's rating (1 to 5, or null to remove it). */
export function withRecordRating(record: FormulaRecord, value: number | null, now: Date): FormulaRecord {
  if (value === null) return { ...record, rating: { value: null } };
  const v = Math.min(5, Math.max(1, Math.round(value)));
  return { ...record, rating: { value: v, rated_at: now.toISOString() } };
}

/** True when the record belongs to exactly this formula text. */
export function recordMatches(record: FormulaRecord, formulaText: string): boolean {
  return record.formula_hash === textHash(formulaText);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const MEASURE_KEYS: (keyof FilterMeasures)[] = [
  "sampleRadius",
  "valid",
  "finiteShare",
  "nearShare",
  "insideShare",
  "viewDistance",
  "hitShare",
  "gradientViolationShare",
  "gradientL95",
  "overshoot",
  "stepFactor",
  "milliseconds",
];
const REASONS: RejectReason[] = ["invalid", "not-a-number", "empty", "solid", "no-view", "unreliable"];

/** Reads a measurement record from a file (untrusted): checks every field, drops unknown ones. */
export function parseFormulaRecord(text: string): { ok: true; record: FormulaRecord } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  if (!isObj(raw)) return { ok: false, error: "a record must be a JSON object" };
  if (raw.record_version !== RECORD_VERSION) return { ok: false, error: `unknown record version ${String(raw.record_version)}` };
  if (typeof raw.formula_id !== "string" || !/^[a-z][a-z0-9-]*$/.test(raw.formula_id) || raw.formula_id.length > 100) return { ok: false, error: "formula_id is missing or wrong" };
  if (typeof raw.formula_hash !== "string" || !/^[0-9a-f]{8}$/.test(raw.formula_hash)) return { ok: false, error: "formula_hash is missing or wrong" };
  if (typeof raw.measures_version !== "number") return { ok: false, error: "measures_version is missing" };
  if (typeof raw.created !== "string" || Number.isNaN(Date.parse(raw.created))) return { ok: false, error: "created is missing" };
  if (typeof raw.passed !== "boolean") return { ok: false, error: "passed is missing" };
  if (!isObj(raw.measures)) return { ok: false, error: "measures is missing" };
  const measures = {} as Record<string, number | boolean>;
  for (const key of MEASURE_KEYS) {
    const v = raw.measures[key];
    if (key === "valid" ? typeof v !== "boolean" : typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `measures.${key} is missing or wrong` };
    measures[key] = v as number | boolean;
  }
  const r = isObj(raw.rating) ? raw.rating : {};
  const value = r.value === null || r.value === undefined ? null : typeof r.value === "number" && Number.isInteger(r.value) && r.value >= 1 && r.value <= 5 ? r.value : undefined;
  if (value === undefined) return { ok: false, error: "rating.value must be 1 to 5 or null" };
  const o = raw.origin;
  let origin: FormulaRecord["origin"];
  if (isObj(o) && typeof o.grammar === "string" && typeof o.seed === "number" && typeof o.family === "string" && Array.isArray(o.operations) && o.operations.every((x) => typeof x === "string")) {
    const parent = isObj(o.parent) && typeof o.parent.id === "string" && typeof o.parent.variant === "number" ? { id: o.parent.id.slice(0, 100), variant: o.parent.variant } : undefined;
    origin = { grammar: o.grammar.slice(0, 20), seed: o.seed, family: o.family.slice(0, 40), operations: (o.operations as string[]).slice(0, 10).map((x) => x.slice(0, 60)), ...(parent ? { parent } : {}) };
  }
  let thumbnail: FormulaRecord["thumbnail"];
  const t = raw.thumbnail;
  if (t !== undefined) {
    const nums = ["hitShare", "outlineDimension", "surfaceDetail", "normalSpread"] as const;
    if (!isObj(t) || !nums.every((k) => typeof t[k] === "number" && Number.isFinite(t[k])) || typeof t.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(t.fingerprint) || typeof t.verdict !== "string") {
      return { ok: false, error: "thumbnail measures are wrong" };
    }
    thumbnail = { hitShare: t.hitShare as number, outlineDimension: t.outlineDimension as number, surfaceDetail: t.surfaceDetail as number, normalSpread: t.normalSpread as number, fingerprint: t.fingerprint, verdict: t.verdict.slice(0, 40) };
  }
  return {
    ok: true,
    record: {
      record_version: RECORD_VERSION,
      formula_id: raw.formula_id,
      formula_hash: raw.formula_hash,
      ...(origin ? { origin } : {}),
      measures_version: raw.measures_version,
      measures: measures as unknown as FilterMeasures,
      passed: raw.passed,
      ...(typeof raw.reason === "string" && (REASONS as string[]).includes(raw.reason) ? { reason: raw.reason as RejectReason } : {}),
      ...(thumbnail ? { thumbnail } : {}),
      created: raw.created,
      rating: value === null ? { value: null } : { value, ...(typeof r.rated_at === "string" && !Number.isNaN(Date.parse(r.rated_at)) ? { rated_at: r.rated_at } : {}) },
    },
  };
}
