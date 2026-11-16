import {generateDifsChain} from './difsExecution';
import {generateIndependentFieldChain} from './independentField';
import { generateMappedFieldChain } from "./groupExecution";
import type { ChainExecution } from "./groupExecution";
import { translateExpression } from "./expression";
import type { Formula } from "./types";
import { generateKernelChain } from './kernelChain';
import { bridgeExecutionSteps } from './importedHelper';

/** Room for formula parameters in the shader's uniform buffer. */
export const MAX_TOTAL_PARAMETERS = 128;
// Legacy single-step presets can use 60 rounds; the scene's total budget remains 256 calls.
export const MAX_ROUNDS = 64;

/** The parts of a formula the chain generator needs. */
export type StepFormula = Pick<
  Formula,
  "id" | "name" | "parameters" | "variables" | "steps" | "distance" | "orbitPoint" | "carry" | "kernel"
>;

/**
 * How the steps of a chain are combined (scene version 11).
 * - "sequence": every round runs every step in order (what chains always did).
 * - "alternate": every round runs the steps in order, but a step only runs on the rounds its schedule allows:
 *   from round `start` on, every `every`-th round.
 * - "interpolate": every round, all steps start from the same point and their results are blended with a weight per
 *   step (weighted average of the carried variables and of the distance estimates).
 */
export const CHAIN_MODES = ["sequence", "alternate", "interpolate"] as const;
export type ChainMode = (typeof CHAIN_MODES)[number];

/** Most steps whose weights fit in the shader (two vec4). */
export const MAX_WEIGHTED_STEPS = 8;

export interface ChainStep {
  formula: StepFormula;
  iterations: number;
  /** "alternate": run on every n-th round (1 = every round). */
  every?: number;
  /** "alternate": the first round (counted from 0) the step runs on. */
  start?: number;
}

export type ChainResult = { ok: true; wgsl: string; totalIterations: number } | { ok: false; errors: string[] };

/** Floats of the run-time loop block in the uniform buffer (three vec4): rounds and total, then the iterations of up to MAX_CHAIN_LOOP_STEPS steps. */
export const LOOP_FLOATS = 12;
export const MAX_CHAIN_LOOP_STEPS = 8;

/** The most iterations a point can get (for scaling the "iterations" colour measure): every step on every round it runs. */
export function chainTotalIterations(steps: readonly Pick<ChainStep, "iterations" | "every" | "start">[], rounds: number, mode: ChainMode = "sequence"): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    for (const s of steps) {
      const every = s.every ?? 1;
      const start = s.start ?? 0;
      if (mode !== "alternate" || (round >= start && (round - start) % every === 0)) total += s.iterations;
    }
  }
  return Math.max(1, total);
}

/**
 * The numbers a chain compiled with `dynamicLoops` reads at run time: [rounds, total iterations, 0, 0, iterations of step 0 ... step 7].
 * Changing any of them does not change the shader, so it is not rebuilt (SHADER-UNIFORMS-08).
 */
export function chainLoopUniforms(steps: readonly Pick<ChainStep, "iterations" | "every" | "start">[], rounds: number, mode: ChainMode = "sequence"): number[] {
  const out = new Array<number>(LOOP_FLOATS).fill(0);
  out[0] = rounds;
  out[1] = chainTotalIterations(steps, rounds, mode);
  steps.slice(0, MAX_CHAIN_LOOP_STEPS).forEach((s, i) => { out[4 + i] = s.iterations; });
  return out;
}

const wgslType = (t: "float" | "vec3" | "vec4"): string => (t === "vec3" ? "vec3f" : t === "vec4" ? "vec4f" : "f32");

/** Where the interpolation weight of step `index` lives in the uniform buffer, as shader code. */
function weightAccess(index: number): string {
  return `u.chainw[${Math.floor(index / 4)}].${"xyzw"[index % 4]}`;
}

/** Where parameter number `index` of the whole chain lives in the uniform buffer, as shader code. */
function parameterAccess(index: number): string {
  return `u.params[${Math.floor(index / 4)}].${"xyzw"[index % 4]}`;
}

/**
 * Builds the shader code for a chain of formula steps.
 *
 * One round runs every step in order, each for its own number of iterations;
 * the whole chain is then repeated `rounds` times. Variables a formula lists in
 * `carry` (normally the point z and its derivative dr) live through the whole
 * chain; all other variables start fresh in each step. The distance comes from the last step
 * that has a distance estimate (transforms have none). If any step reaches its
 * escape condition (break_if) the whole calculation stops, and the distance is
 * the one from the step that was running.
 *
 * Generated functions:
 * - `formulaCore(pos)` returns (distance estimate, completed iterations, orbit trap)
 * - `formulaDistance(pos)` returns only the distance (used while marching)
 * - `FORMULA_ITERATIONS` is the largest possible number of iterations, for scaling.
 *
 * Names from files get prefixes (v_ for variables), and everything that ends up
 * in the code has passed the expression checker or is a validated whole number,
 * so a file can never add code of its own.
 */
export function generateChain(
  stepsIn: readonly ChainStep[],
  rounds: number,
  options: { allowNoDistance?: boolean; mode?: ChainMode; execution?: ChainExecution; dynamicLoops?: boolean } = {},
): ChainResult {
  // Eligible data transforms act as uncounted mapping helpers inside grouped executions only; ordinary chains are untouched.
  const steps = options.execution ? bridgeExecutionSteps(stepsIn, options.execution) : stepsIn;
  const mode: ChainMode = options.mode ?? "sequence";
  const errors: string[] = [];
  if (steps.length === 0) return { ok: false, errors: ["the chain has no steps"] };
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    return { ok: false, errors: [`rounds must be a whole number from 1 to ${MAX_ROUNDS}`] };
  }
  for (const [i, s] of steps.entries()) {
    if (!Number.isInteger(s.iterations) || s.iterations < 1 || s.iterations > 64) {
      errors.push(`step ${i + 1}: iterations must be a whole number from 1 to 64`);
    }
    const every = s.every ?? 1;
    const start = s.start ?? 0;
    if (!Number.isInteger(every) || every < 1 || every > MAX_ROUNDS) errors.push(`step ${i + 1}: every must be a whole number from 1 to ${MAX_ROUNDS}`);
    if (!Number.isInteger(start) || start < 0 || start >= MAX_ROUNDS) errors.push(`step ${i + 1}: start must be a whole number from 0 to ${MAX_ROUNDS - 1}`);
  }
  if (!(CHAIN_MODES as readonly string[]).includes(mode)) errors.push(`unknown chain mode "${String(mode)}"`);
  if (mode === "interpolate" && steps.length > MAX_WEIGHTED_STEPS) errors.push(`interpolation takes at most ${MAX_WEIGHTED_STEPS} steps`);
  const parameterCount = steps.reduce((n, s) => n + s.formula.parameters.length, 0);
  if (parameterCount > MAX_TOTAL_PARAMETERS) {
    errors.push(`the chain has ${parameterCount} parameters; at most ${MAX_TOTAL_PARAMETERS} fit`);
  }
  if (errors.length > 0) return { ok: false, errors };

  if(options.execution?.kind==='independent-field')return generateIndependentFieldChain(steps,rounds,mode,options.execution);
  if(options.execution?.kind==='bounded-sequence'&&options.execution.distance==='difs-minimum')return generateDifsChain(steps,rounds,mode,options.execution);
  if (options.execution) return options.execution.kind==='mapped-field' ? generateMappedFieldChain(steps,rounds,mode,options.execution) : generateKernelChain(steps,rounds,mode,options.execution);
  if (steps.some(step => step.formula.kernel)) return generateKernelChain(steps, rounds, mode, undefined, options.dynamicLoops === true);

  const dynamic = options.dynamicLoops === true && steps.length <= MAX_CHAIN_LOOP_STEPS;
  const carried = new Map<string, "float" | "vec3" | "vec4">();
  const carriedLines: string[] = [];
  const blocks: string[] = [];
  // Interpolation blocks need every carried variable, also those that later steps introduce: built after all steps are read.
  const pending: ((all: readonly string[]) => string)[] = [];
  let parameterBase = 0;
  let hasDistance = false;

  steps.forEach((step, si) => {
    const f = step.formula;
    const fail = (what: string, why: string): void => void errors.push(`step ${si + 1} (${f.name}), ${what}: ${why}`);
    const names = new Map<string, string>([["pos", "jpos"]]);
    f.parameters.forEach((p, i) => names.set(p.name, parameterAccess(parameterBase + i)));
    parameterBase += f.parameters.length;
    for (const name of carried.keys()) if (!names.has(name)) names.set(name, `v_${name}`);

    const translate = (what: string, expr: string, start = false): string => {
      // The starting value of a carried variable is the point itself, also in Julia mode (the point is where the
      // orbit starts); everywhere else "pos" is the constant that is added, which Julia mode replaces.
      const map = start ? new Map(names).set("pos", "pos") : names;
      const r = translateExpression(expr, map);
      if (!r.ok) {
        fail(what, r.error);
        return "0.0";
      }
      return r.wgsl;
    };

    const localLines: string[] = [];
    for (const v of f.variables) {
      if (f.carry.includes(v.name)) {
        const known = carried.get(v.name);
        if (known === undefined) {
          // First step to mention it sets the starting value, once, before everything.
          carriedLines.push(`  var v_${v.name} : ${wgslType(v.type)} = ${translate(`variable "${v.name}"`, v.init, true)};`);
          carried.set(v.name, v.type);
        } else if (known !== v.type) {
          fail(`variable "${v.name}"`, `is ${v.type} here but ${known} in an earlier step`);
        }
      } else {
        localLines.push(`      var v_${v.name} : ${wgslType(v.type)} = ${translate(`variable "${v.name}"`, v.init)};`);
      }
      names.set(v.name, `v_${v.name}`);
    }

    const body: string[] = [];
    f.steps.forEach((s, i) => {
      const what = `rule ${i + 1}`;
      if (s.kind === "break_if") {
        body.push(`        if (${translate(what, s.expr)}) { ${mode === "interpolate" ? `stepDone${si}` : "done"} = true; break; }`);
      } else if (!f.variables.some((v) => v.name === s.target)) {
        fail(what, `"${s.target}" is not a declared variable`);
      } else {
        body.push(`        v_${s.target} ${s.op} ${translate(what, s.expr)};`);
      }
    });
    const distance = f.distance === undefined ? undefined : translate("distance", f.distance);
    if (distance !== undefined) hasDistance = true;
    const trap =
      f.orbitPoint !== undefined && f.variables.some((v) => v.name === f.orbitPoint)
        ? [`        trap = min(trap, length(v_${f.orbitPoint}));`]
        : [];

    const label = `    // step ${si + 1}: ${f.id.replace(/[^a-z0-9-]/g, "_")}`; // ids are checked when files are read; this keeps the comment harmless regardless
    // dynamicLoops: the count comes from the uniform buffer (a zero there falls back to the number compiled in, so a caller that never fills it still works).
    const count = dynamic ? `stepCount${si}` : `${step.iterations}`;
    const loop = [`      for (var iter = 0; iter < ${count}; iter++) {`, ...trap, ...body, "        iterCount += 1.0;", "      }"];
    if (mode === "interpolate") {
      // Start from the round's input, run, and add the result to the weighted sums.
      pending.push((all) =>
        [
          label,
          "    {",
          ...all.map((n) => `      v_${n} = in_${n};`),
          `      var stepDone${si} = false;`,
          ...localLines,
          ...loop,
          `      let w${si} = ${weightAccess(si)};`,
          ...all.map((n) => `      sum_${n} += w${si} * v_${n};`),
          `      wsum += w${si};`,
          ...(distance !== undefined ? [`      dsum += w${si} * (${distance});`, `      dw += w${si};`] : []),
          `      roundDone = roundDone || stepDone${si};`,
          "    }",
        ].join("\n"),
      );
    } else {
      const every = step.every ?? 1;
      const start = step.start ?? 0;
      // The schedule is only written into the code when it does something, so plain chains stay exactly as they were.
      const scheduled = mode === "alternate" && (every !== 1 || start !== 0);
      const when = scheduled ? ` && round >= ${start} && (round - ${start}) % ${every} == 0` : "";
      blocks.push([label, `    if (!done${when}) {`, ...localLines, ...loop, ...(distance !== undefined ? [`      dist = ${distance};`] : []), "    }"].join("\n"));
    }
  });

  for (const build of pending) blocks.push(build([...carried.keys()]));

  if (!hasDistance && !options.allowNoDistance) {
    errors.push("the chain has no step with a distance estimate: a transform alone cannot be drawn, add a formula that has one");
  }
  if (errors.length > 0) return { ok: false, errors };

  // The most iterations a point can get, for scaling the "iterations" colour measure.
  const totalIterations = chainTotalIterations(steps, rounds, mode);
  const carriedList = [...carried.entries()];
  const roundBody =
    mode === "interpolate"
      ? [
          "    if (done) { break; }",
          ...carriedList.map(([n, t]) => `    let in_${n} = v_${n};`),
          ...carriedList.map(([n, t]) => `    var sum_${n} = ${wgslType(t)}(0.0);`),
          "    var wsum = 0.0;",
          "    var dsum = 0.0;",
          "    var dw = 0.0;",
          "    var roundDone = false;",
          ...blocks,
          "    // The weighted average; with all weights 0 the point is left as it was.",
          "    let wdiv = max(wsum, 1.0e-6);",
          ...carriedList.map(([n]) => `    v_${n} = select(in_${n}, sum_${n} / wdiv, wsum > 0.0);`),
          "    if (dw > 0.0) { dist = dsum / dw; }",
          "    done = roundDone;",
        ]
      : [...blocks, "    if (done) { break; }"];
  const wgsl = [
    `const FORMULA_ITERATIONS : f32 = ${totalIterations}.0;`,
    "",
    "// Returns (distance estimate, completed iterations, orbit trap).",
    "fn formulaCore(pos : vec3f) -> vec3f {",
    ...(dynamic
      ? [
          "  let loopRounds = select(" + rounds + ", i32(u.loops[0].x), u.loops[0].x > 0.5);",
          ...steps.map((s, i) => `  let stepCount${i} = select(${s.iterations}, i32(u.loops[${1 + Math.floor(i / 4)}].${"xyzw"[i % 4]}), u.loops[${1 + Math.floor(i / 4)}].${"xyzw"[i % 4]} > 0.5);`),
        ]
      : []),
    "  // The constant added in every iteration: the point itself, or the Julia constant when Julia mode is on.",
    "  let jpos = select(pos, u.julia.xyz, u.julia.w > 0.5);",
    ...carriedLines,
    "  var iterCount = 0.0;",
    "  var trap = 1.0e9;",
    "  var dist = 0.0;",
    "  var done = false;",
    `  for (var round = 0; round < ${dynamic ? "loopRounds" : rounds}; round++) {`,
    ...roundBody,
    "  }",
    "  return vec3f(dist, iterCount, select(0.0, trap, trap < 1.0e8));",
    "}",
    "",
    "fn formulaDistance(pos : vec3f) -> f32 {",
    "  return formulaCore(pos).x;",
    "}",
  ].join("\n");
  return { ok: true, wgsl, totalIterations };
}
