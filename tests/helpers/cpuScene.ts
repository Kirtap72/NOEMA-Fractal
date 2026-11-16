import { readFileSync, readdirSync } from "node:fs";
import { compileChainCpu } from "../../src/engine/formula/cpu";
import type { ChainMode, ChainStep } from "../../src/engine/formula/chain";
import { buildLibrary } from "../../src/engine/formula/library";
import type { Formula } from "../../src/engine/formula/types";

/** Every formula file in the project, plus small test shapes that are only used here. */
export function loadLibrary(extra: Record<string, string> = {}): Formula[] {
  const files: Record<string, string> = {};
  for (const name of readdirSync("formulas")) if (name.endsWith(".yaml")) files[name] = readFileSync(`formulas/${name}`, "utf8");
  const lib = buildLibrary({ ...files, ...TEST_SHAPES, ...extra });
  if (lib.problems.length > 0) throw new Error(lib.problems.map((e) => `${e.file}: ${e.errors.join("; ")}`).join("\n"));
  return lib.formulas;
}

const shape = (id: string, distance: string, locals = "", steps = "") => `format: 1
id: ${id}
name: ${id}
credits:
  - { name: test, status: unverified }
sources:
  - { reference: "test shape, only used by the tests", status: unverified }
added_by: test
math_status: test
reviewed: false
iteration:
  iterations: 1
  carry: [z, dr]
  variables:
    - { name: z, type: vec3, init: pos }
    - { name: dr, type: float, init: 1 }
${locals}  steps:
${steps || '    - "dr = dr"'}
  distance: "${distance}"
`;

/** Test-only end steps: a box, a probe that returns the length of z, and probes for single values. */
export const TEST_SHAPES: Record<string, string> = {
  "test-box.yaml": shape(
    "test-box",
    "(length(max(q, vec3(0.0, 0.0, 0.0))) + min(max(q.x, max(q.y, q.z)), 0.0)) / abs(dr)",
    "    - { name: q, type: vec3, init: \"vec3(0.0, 0.0, 0.0)\" }\n",
    '    - "q = abs(z) - vec3(1.0, 1.0, 1.0)"',
  ),
  "test-ball.yaml": shape("test-ball", "(length(z) - 1.0) / abs(dr)"),
  "probe-length.yaml": shape("probe-length", "length(z)"),
  "probe-x.yaml": shape("probe-x", "z.x"),
  "probe-y.yaml": shape("probe-y", "z.y"),
  "probe-z.yaml": shape("probe-z", "z.z"),
  "probe-dr.yaml": shape("probe-dr", "dr"),
};

export interface StepSpec {
  id: string;
  iterations?: number;
  params?: Record<string, number>;
  every?: number;
  start?: number;
}

/** A distance function for a chain, run on the processor. */
export function cpuChain(
  formulas: readonly Formula[],
  specs: readonly StepSpec[],
  rounds = 1,
  options: { mode?: ChainMode; weights?: number[]; julia?: number[] | null; round32?: boolean } = {},
): (p: readonly number[]) => number {
  const steps: ChainStep[] = specs.map((s) => {
    const formula = formulas.find((f) => f.id === s.id);
    if (!formula) throw new Error(`no formula "${s.id}"`);
    return { formula, iterations: s.iterations ?? formula.iterations, ...(s.every ? { every: s.every } : {}), ...(s.start ? { start: s.start } : {}) };
  });
  const params = specs.flatMap((s, i) => steps[i]!.formula.parameters.map((p) => s.params?.[p.name] ?? p.default));
  const run = compileChainCpu(steps, rounds, { ...(options.mode ? { mode: options.mode } : {}), round32: options.round32 ?? false });
  return (p) => run(p, params, options.weights ?? [], options.julia ?? null).dist;
}

/**
 * Sends a small grid of rays from a camera at distance `distance` on the line (1, 0.6, 1.4) towards the origin, marching
 * with the distance function like the shader does, and tells how many hit something.
 */
export function marchGrid(de: (p: readonly number[]) => number, distance = 4, size: [number, number] = [24, 16]): { hits: number; rays: number; finite: boolean } {
  const [w, h] = size;
  const dirTo = [1, 0.6, 1.4];
  const len = Math.hypot(...dirTo);
  const cam = dirTo.map((v) => (v / len) * distance);
  const forward = cam.map((v) => -v / distance);
  const up0 = [0, 1, 0];
  const right = [forward[1]! * up0[2]! - forward[2]! * up0[1]!, forward[2]! * up0[0]! - forward[0]! * up0[2]!, forward[0]! * up0[1]! - forward[1]! * up0[0]!];
  const rl = Math.hypot(...right);
  const r = right.map((v) => v / rl);
  const u = [r[1]! * forward[2]! - r[2]! * forward[1]!, r[2]! * forward[0]! - r[0]! * forward[2]!, r[0]! * forward[1]! - r[1]! * forward[0]!];
  const tanHalf = Math.tan((50 * Math.PI) / 360);
  let hits = 0;
  let finite = true;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = ((2 * (x + 0.5) - w) / h) * tanHalf;
      const ny = ((h - 2 * (y + 0.5)) / h) * tanHalf;
      let d = forward.map((f, k) => f + r[k]! * nx + u[k]! * ny);
      const dl = Math.hypot(...d);
      d = d.map((v) => v / dl);
      let t = 0;
      for (let i = 0; i < 300; i++) {
        const v = de(cam.map((c, k) => c + d[k]! * t));
        if (!Number.isFinite(v)) {
          finite = false;
          break;
        }
        if (v < 0.0004 * (1 + t) * 4) {
          hits++;
          break;
        }
        t += v * 0.75;
        if (t > 20) break;
      }
    }
  }
  return { hits, rays: w * h, finite };
}

/** A repeatable stream of random numbers from -1 to 1. */
export function randomPoints(n: number, scale = 1.5, seed = 7): number[][] {
  let s = seed;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
  return Array.from({ length: n }, () => [rnd() * scale, rnd() * scale, rnd() * scale]);
}
