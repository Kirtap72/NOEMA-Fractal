import { generateChain, MAX_TOTAL_PARAMETERS } from "./formula/chain";
import type { ChainMode, ChainStep } from "./formula/chain";
import { compileChainCpu } from "./formula/cpu";
import type { Formula } from "./formula/types";
import { createDefaultScene, defaultStep, MAX_TOTAL_ITERATIONS, resolveScene } from "./scene";
import type { ChainStepData, Scene } from "./scene";
import { KERNEL_IDS } from "./formula/kernels";

/**
 * Makes random chains of building blocks (part 5 of the formula library work). Everything is a pure function of a
 * seed, so the same seed gives the same chain. Candidates are checked on the processor (a few rays with the
 * independent evaluator) and thrown away if they draw nothing or everything, so most results show something.
 *
 * The blocks are sorted into roles by id below. A test fails when a formula in the library has no role, so a new
 * block is never forgotten silently.
 */

/** Steps that fold or mirror space without changing its scale much. */
export const FOLDS: readonly string[] = [
  "abs-fold",
  "axis-swap",
  "ball-fold",
  "box-fold",
  "box-fold-axes",
  "icosa-fold",
  "octa-fold",
  "tetra-fold",
  "plane-fold",
  "polygon-fold",
  "rotate",
  "shape-fold",
  "sphere-inversion",
];
/** Steps that stretch space and add an offset: these make a repeated fold into a fractal. */
export const SCALERS: readonly string[] = ["scale-offset", "menger-fold", "sierpinski-step", "kaliset-step"];
/** Steps that bend or repeat space; used in front of a shape or a fractal. */
export const WARPS: readonly string[] = [
  "twist",
  "stellahedron",
  "wave",
  "tiling",
  "em-fisheye",
  "henon-step",
  "lorenz-step",
  "rossler-step",
  "stereographic",
  "toroidal-coordinates",
  "cylindrical-coordinates",
  "spherical-coordinates",
  "koch-fold",
];
/** Shapes with a distance of their own and one iteration: the end of a repeated fold chain. */
export const SHAPES: readonly string[] = [
  "gyroid",
  "lidinoid",
  "schwarz",
  "loxodrome",
  "shape-box",
  "shape-capsule",
  "shape-cylinder",
  "shape-helix",
  "shape-octahedron",
  "shape-plane",
  "shape-sphere",
  "shape-torus",
];
/** Fractals with their own distance, used as the end of a short chain. */
export const ENDING_FRACTALS: readonly string[] = [
  "cantor-dust",
  "dodecahedron-fractal",
  "icosahedron-fractal",
  "jerusalem-cube",
  "menger-sponge",
  "octahedron-fractal",
  "sierpinski-pyramid",
  "sierpinski-tetrahedron",
];
/** Fractals with a flight (escape) condition, used as the parts of a hybrid. */
export const HYBRID_FRACTALS: readonly string[] = ["mandelbulb", "mandelbox", "iq-bulb"];
/** 4D formulas do not connect to 3D steps yet (ARCHITECTURE.md 8.17), so the generator leaves them out. */
export const LEFT_OUT: readonly string[] = ["bicomplex-mandelbrot", "em-hypercomplex-tricorn", "quaternion-julia", "quaternion-mandelbrot",
  // Registered kernels have explicit dimensionality and DE roles; the current random grammar uses legacy 3D blocks.
  ...KERNEL_IDS,
  // Coverage batch 02 transforms (step formulas recovered from descriptions).
  "mb3d-gnarl3d", "mb3d-invtorical", "mb3d-fold45single", "mb3d-hopalm1", "mb3d-hopalm2",
  // Transforms recovered from Mandelbulb 3D descriptions as step formulas (coverage batch 01). They are for imports and hand-built chains, not the random grammar.
  "mb3d-lincombinexyz", "mb3d-planefold", "mb3d-sqr3d", "mb3d-foldingvar", "mb3d-totorical", "mb3d-tospherical", "mb3d-benesit1", "mb3d-bt1transform1"];

export const CHAIN_STYLES = ["fold", "warp", "hybrid"] as const;
export type ChainStyle = (typeof CHAIN_STYLES)[number];

/** Every role list together, for the test that checks that no formula is forgotten. */
export function classifiedFormulaIds(): Set<string> {
  return new Set([...FOLDS, ...SCALERS, ...WARPS, ...SHAPES, ...ENDING_FRACTALS, ...HYBRID_FRACTALS, ...LEFT_OUT]);
}

/** A small deterministic random number generator (mulberry32). */
export class Random {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)]!;
  }
}

/** One round of an integer hash (the finaliser of murmur3): small changes in the input change every bit. */
function mix(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Mixes the seed and the attempt number into one number, so every attempt of a seed is its own stream. */
export function attemptSeed(seed: number, attempt: number): number {
  return mix((mix(seed) + Math.imul(attempt + 1, 0x9e3779b1)) >>> 0);
}

/** Parameters that only make sense as whole numbers or switches. */
const DISCRETE = new Set(["order", "flip_x", "flip_y", "flip_z", "direction", "surface", "add_point", "n", "power"]);

/** Ranges used instead of the full range for parameters where most values give nothing (decided by the assistant). */
const RANGES: Record<string, Record<string, [number, number]>> = {
  "scale-offset": { scale: [1.5, 3.2], ox: [0.3, 2], oy: [0.3, 2], oz: [0.3, 2] },
  "menger-fold": { scale: [2, 3.5] },
  "sierpinski-step": { scale: [1.5, 2.6] },
  "kaliset-step": { scale: [0.8, 1.8] },
  mandelbox: { scale: [1.5, 3] },
  mandelbulb: { power: [3, 10] },
  "iq-bulb": { power: [3, 10] },
  "polygon-fold": { n: [3, 10] },
  twist: { k: [-1.5, 1.5] },
  wave: { amplitude: [0.02, 0.3], frequency: [1, 10] },
  "lorenz-step": { h: [0.001, 0.012] },
  "rossler-step": { h: [0.005, 0.05] },
  tiling: { cx: [1.5, 6], cy: [1.5, 6], cz: [1.5, 6] },
};

/** One parameter value: the default, or a value near it, or one from the special range. */
function randomValue(formula: Formula, name: string, rng: Random): number {
  const p = formula.parameters.find((x) => x.name === name)!;
  const special = RANGES[formula.id]?.[name];
  let v: number;
  if (special) v = rng.range(special[0], special[1]);
  else if (rng.chance(0.4)) v = p.default;
  else v = p.default + (rng.next() - 0.5) * (p.max - p.min) * 0.6;
  v = Math.min(p.max, Math.max(p.min, v));
  if (DISCRETE.has(name)) v = Math.min(p.max, Math.max(p.min, Math.round(v)));
  // Round to a few decimals so that the values read well in the panels.
  return DISCRETE.has(name) ? v : Math.round(v * 1000) / 1000;
}

function randomStep(formula: Formula, rng: Random): ChainStepData {
  const step = defaultStep(formula);
  for (const p of formula.parameters) step.parameters[p.name] = randomValue(formula, p.name, rng);
  return step;
}

export interface RandomChainOptions {
  style?: ChainStyle;
}

export interface Candidate {
  scene: Scene;
  style: ChainStyle;
}

/**
 * Builds one candidate chain from a random stream, without checking that it draws. Returns null when the library
 * misses a block the style needs (for example in a test with a small library).
 */
export function buildCandidate(formulas: readonly Formula[], rng: Random, style: ChainStyle): Candidate | null {
  const have = (id: string): Formula | undefined => formulas.find((f) => f.id === id);
  const choose = (ids: readonly string[]): Formula | undefined => {
    const list = ids.map(have).filter((f): f is Formula => f !== undefined);
    return list.length === 0 ? undefined : rng.pick(list);
  };
  const steps: ChainStepData[] = [];
  const add = (f: Formula | undefined): boolean => {
    if (!f) return false;
    steps.push(randomStep(f, rng));
    return true;
  };
  let rounds = 1;
  let mode: ChainMode = "sequence";
  let julia = false;

  if (style === "fold") {
    // Repeated folding with stretching, ended by a shape: the classic recipe behind Menger sponges and Mandelboxes.
    rounds = rng.int(5, 14);
    if (rng.chance(0.3) && !add(choose(WARPS))) return null;
    const folds = rng.int(1, 2);
    for (let i = 0; i < folds; i++) if (!add(choose(FOLDS))) return null;
    if (!add(choose(SCALERS)) || !add(choose(SHAPES))) return null;
    if (rng.chance(0.2) && steps.length >= 3) {
      mode = "alternate";
      const at = rng.int(0, steps.length - 2);
      steps[at] = { ...steps[at]!, every: 2, ...(rng.chance(0.5) ? { start: 1 } : {}) };
    }
    julia = rng.chance(0.15);
  } else if (style === "warp") {
    // One or two bends of space in front of a shape or a fractal.
    const warps = rng.int(1, 2);
    for (let i = 0; i < warps; i++) if (!add(choose(WARPS))) return null;
    if (!add(choose(rng.chance(0.5) ? SHAPES : ENDING_FRACTALS))) return null;
  } else {
    // A hybrid: two fractals with a fold between them, repeated a few times.
    rounds = rng.int(2, 4);
    if (!add(choose(HYBRID_FRACTALS))) return null;
    steps[0]!.iterations = rng.int(1, 3);
    if (!add(choose(rng.chance(0.5) ? FOLDS : SCALERS))) return null;
    if (!add(choose(HYBRID_FRACTALS))) return null;
    steps[2]!.iterations = rng.int(1, 3);
    julia = rng.chance(0.15);
  }

  const end = have(steps[steps.length - 1]!.formula);
  const first = have(steps[0]!.formula);
  if (!end || !first) return null;
  const base = createDefaultScene({ ...first, cameraDistance: 4 });
  const scene: Scene = {
    ...base,
    content: [
      {
        type: "fractal",
        chain: steps,
        rounds,
        ...(mode !== "sequence" ? { mode } : {}),
        ...(julia ? { julia: { enabled: true, c: [Math.round(rng.range(-0.6, 0.6) * 100) / 100, Math.round(rng.range(-0.6, 0.6) * 100) / 100, Math.round(rng.range(-0.6, 0.6) * 100) / 100] as [number, number, number] } } : {}),
      },
    ],
  };
  return { scene, style };
}

export interface Look {
  /** False when the distance became a non-number anywhere. */
  finite: boolean;
  /** The share of rays that hit a surface, from 0 to 1. */
  hitFraction: number;
}

/** The camera distances tried, in order, when looking for a good framing. */
export const LOOK_DISTANCES = [3.5, 6, 10] as const;

/**
 * Sends a small grid of rays at the chain from a camera `distance` away (the same direction as the default camera),
 * on the processor. A cheap test of "does this draw something".
 */
export function lookAtChain(formulas: readonly Formula[], scene: Scene, distance: number, size: [number, number] = [14, 9]): Look {
  const fractal = scene.content[0]!;
  const steps: ChainStep[] = fractal.chain.map((s) => {
    const formula = formulas.find((f) => f.id === s.formula)!;
    return { formula, iterations: s.iterations ?? formula.iterations, ...(s.every ? { every: s.every } : {}), ...(s.start ? { start: s.start } : {}) };
  });
  const mode = fractal.mode ?? "sequence";
  const params = fractal.chain.flatMap((s, i) => steps[i]!.formula.parameters.map((p) => s.parameters[p.name] ?? p.default));
  const weights = fractal.chain.map((s) => s.weight ?? 1);
  const j = fractal.julia?.enabled ? [fractal.julia.c[0], fractal.julia.c[1], fractal.julia.c[2]] : null;
  const run = compileChainCpu(steps, fractal.rounds, { mode, execution: fractal.execution });
  const de = (p: readonly number[]): number => run(p, params, weights, j).dist;

  const yaw = 0.6;
  const pitch = 0.35;
  const cam = [distance * Math.cos(pitch) * Math.sin(yaw), distance * Math.sin(pitch), distance * Math.cos(pitch) * Math.cos(yaw)];
  const forward = cam.map((v) => -v / distance);
  const right = [forward[2]!, 0, -forward[0]!];
  const rl = Math.hypot(...right);
  const r = right.map((v) => v / rl);
  const u = [r[1]! * forward[2]! - r[2]! * forward[1]!, r[2]! * forward[0]! - r[0]! * forward[2]!, r[0]! * forward[1]! - r[1]! * forward[0]!];
  const tanHalf = Math.tan((50 * Math.PI) / 360);
  const [w, h] = size;
  let hits = 0;
  let finite = true;
  for (let y = 0; y < h && finite; y++) {
    for (let x = 0; x < w; x++) {
      const nx = ((2 * (x + 0.5) - w) / h) * tanHalf;
      const ny = ((h - 2 * (y + 0.5)) / h) * tanHalf;
      const d = forward.map((f, k) => f + r[k]! * nx + u[k]! * ny);
      const dl = Math.hypot(...d);
      let t = 0;
      for (let i = 0; i < 90; i++) {
        const v = de(cam.map((c, k) => c + (d[k]! / dl) * t));
        if (!Number.isFinite(v)) {
          finite = false;
          break;
        }
        if (v < 0.0004 * (1 + t) * 4) {
          hits++;
          break;
        }
        t += v * 0.75;
        if (t > 30) break;
      }
      if (!finite) break;
    }
  }
  return { finite, hitFraction: hits / (w * h) };
}

/** What counts as "draws something": not almost empty and not almost filled. */
export const HIT_RANGE = [0.05, 0.8] as const;

export interface RandomChain {
  scene: Scene;
  style: ChainStyle;
  /** The seed and attempt that make this chain again. */
  seed: number;
  attempt: number;
  /** The camera distance chosen so that the chain fills a reasonable part of the picture. */
  distance: number;
}

/**
 * One attempt: builds a candidate from the seed and the attempt number and checks it. Returns null when it was
 * rejected (does not compile, draws nothing or everything, or contains a number that is not a number).
 */
export function tryRandomChain(formulas: readonly Formula[], seed: number, attempt: number, options: RandomChainOptions = {}): RandomChain | null {
  const rng = new Random(attemptSeed(seed, attempt));
  // The style is always drawn, also when it is given, so that a chain can be made again from its style, seed and attempt.
  const drawn = rng.pick(CHAIN_STYLES);
  const style = options.style ?? drawn;
  const candidate = buildCandidate(formulas, rng, style);
  if (!candidate) return null;
  const { scene } = candidate;
  const resolved = resolveScene(scene, formulas);
  if (!resolved.ok || resolved.warnings.length > 0) return null;
  const fractal = scene.content[0]!;
  if (fractal.rounds * fractal.chain.reduce((n, s) => n + (s.iterations ?? 1), 0) > MAX_TOTAL_ITERATIONS) return null;
  if (resolved.parameterValues.length > MAX_TOTAL_PARAMETERS) return null;
  const generated = generateChain(
    fractal.chain.map((s) => ({ formula: formulas.find((f) => f.id === s.formula)!, iterations: s.iterations ?? 1, ...(s.every ? { every: s.every } : {}), ...(s.start ? { start: s.start } : {}) })),
    fractal.rounds,
    { mode: fractal.mode ?? "sequence" },
  );
  if (!generated.ok) return null;

  for (const distance of LOOK_DISTANCES) {
    const look = lookAtChain(formulas, scene, distance);
    if (!look.finite) return null;
    if (look.hitFraction >= HIT_RANGE[0] && look.hitFraction <= HIT_RANGE[1]) {
      const framed = createDefaultScene({ ...formulas.find((f) => f.id === fractal.chain[0]!.formula)!, cameraDistance: distance });
      return { scene: { ...scene, camera: framed.camera }, style, seed, attempt, distance };
    }
  }
  return null;
}

/** Tries attempt after attempt (from `firstAttempt`) until one is accepted, at most `maxAttempts` times. */
export function generateRandomChain(
  formulas: readonly Formula[],
  seed: number,
  options: RandomChainOptions & { firstAttempt?: number; maxAttempts?: number } = {},
): RandomChain | null {
  const first = options.firstAttempt ?? 0;
  const max = options.maxAttempts ?? 60;
  for (let a = first; a < first + max; a++) {
    const found = tryRandomChain(formulas, seed, a, options);
    if (found) return found;
  }
  return null;
}
