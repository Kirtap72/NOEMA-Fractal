/**
 * ARTIST-WORKFLOW 01: "does this formula fit here?" asked BEFORE the formula is put into the chain.
 *
 * The question is answered with the renderer's own rules, never with a second copy of them: the edit (add at a position, or replace a
 * step) is made on a scratch copy of the scene with the same pure functions the editor uses (addStep, setStepFormula), and the resulting
 * chain is checked with chainExecutionErrors (scenes with grouped executions) or generateChain (everything else, which calls
 * kernelChainErrors for registered kernels). generateChain only builds shader TEXT; nothing is compiled and no GPU is touched, so a refusal
 * costs microseconds instead of a shader build. tests/formulaFit.test.ts checks that this agrees with resolveScene + generateChain for every
 * formula of the library.
 *
 * Nothing here is stored in a scene. The engine stays free of the interface; the picker only shows what this returns.
 */
import type { ChainMode } from "./formula/chain";
import { generateChain } from "./formula/chain";
import { chainExecutionErrors } from "./formula/groupExecution";
import { kernelChainErrors } from "./formula/kernelChain";
import type { Formula } from "./formula/types";
import { KERNELS } from "./formula/kernels";
import { MAX_CHAIN_STEPS, MAX_TOTAL_ITERATIONS, resolveScene } from "./scene";
import type { Scene } from "./scene";
import { addStep, setStepFormula, stepEditRefusal } from "./sceneEdit";

/** Where the formula would go: appended or inserted at `index` (and `group` in a grouped scene), or in place of the step `index`. */
export type FitEdit = { op: "add"; index?: number; group?: number } | { op: "replace"; index: number };

export interface Fit {
  ok: boolean;
  /** English, one sentence, only when `ok` is false. */
  reason?: string;
}

const OK: Fit = { ok: true };

/** The renderer's messages for chain rules are written for the artist; low-level checks are wrapped in a sentence of their own. */
function explain(errors: readonly string[]): string {
  const first = errors[0] ?? "The chain cannot be drawn.";
  if (/^(The chain|Interpolation|The transform|A chain|Registered|dIFS)/.test(first)) return first;
  return `The renderer rejects this chain (${first}).`;
}

/** Whether `candidate` can be added or put in place of a step of the first fractal of `scene`, with its current mode and execution. */
export function formulaFit(scene: Scene, library: readonly Formula[], edit: FitEdit, candidate: Formula): Fit {
  const first = scene.content[0];
  if (!first) return { ok: false, reason: "The scene has no fractal to change." };
  if (edit.op === "add" && first.chain.length >= MAX_CHAIN_STEPS) return { ok: false, reason: `The chain already has ${MAX_CHAIN_STEPS} steps, the highest possible.` };

  const after = edit.op === "add" ? addStep(scene, candidate, edit.index, edit.group) : setStepFormula(scene, edit.index, candidate);
  const changed = after.content[0];
  if (after === scene || !changed) {
    const why = edit.op === "add" ? stepEditRefusal(scene, { op: "insert", ...(edit.index === undefined ? {} : { index: edit.index }), ...(edit.group === undefined ? {} : { group: edit.group }) }) : null;
    return { ok: false, reason: why ?? "That change cannot be made here." };
  }

  const problem = chainProblem(after, library, candidate);
  return problem === undefined ? OK : { ok: false, reason: problem };
}

/**
 * The renderer's verdict on the first fractal of `scene`, as one Swedish sentence, or undefined when the chain can be drawn. Shared by the formula
 * picker (does this formula fit here?) and the step explorer (can the chain run without this step?), so both always agree with the renderer.
 * `extra` is a formula that may not be in `library` yet.
 */
export function chainProblem(scene: Scene, library: readonly Formula[], extra?: Formula): string | undefined {
  const changed = scene.content[0];
  if (!changed) return "The scene has no fractal to draw.";
  // The chain as the renderer would receive it: iterations from the step or the formula, the schedule of "alternate".
  const steps: { formula: Formula; iterations: number; every?: number; start?: number }[] = [];
  for (const s of changed.chain) {
    const formula = extra && s.formula === extra.id ? extra : library.find((f) => f.id === s.formula);
    if (!formula) return `The chain contains a formula that is missing from the library (${s.formula}).`;
    steps.push({ formula, iterations: s.iterations ?? formula.iterations, ...(s.every === undefined ? {} : { every: s.every }), ...(s.start === undefined ? {} : { start: s.start }) });
  }
  const mode: ChainMode = changed.mode ?? "sequence";

  if (changed.execution) {
    const errors = chainExecutionErrors(steps as never, changed.rounds, mode, changed.execution);
    return errors.length ? explain(errors) : undefined;
  }
  // A formula that reads a height map needs the map as a resource of the scene; resolveScene is the one that knows (and only these pay for it).
  if (steps.some((s) => s.formula.kernel && KERNELS[s.formula.kernel].fieldMapParameter)) {
    const r = resolveScene(scene, library);
    if (!r.ok) return /field resource/i.test(r.errors.join(" ")) ? "The formula reads a height map (field resource) that this scene does not have. Import an artwork with the map first." : explain(r.errors);
  }
  const total = changed.rounds * steps.reduce((n, s) => n + s.iterations, 0);
  if (total > MAX_TOTAL_ITERATIONS) return `The chain would run ${total} iterations; at most ${MAX_TOTAL_ITERATIONS} are allowed. Lower the number of rounds or iterations first.`;
  // The cheap, exact rule first (registered kernels); the full generator catches the rest (expression chains, schedules, parameter count).
  if (steps.every((s) => s.formula.kernel)) {
    const kernel = kernelChainErrors(steps as never, mode);
    if (kernel.length) return explain(kernel);
  }
  const built = generateChain(steps as never, changed.rounds, { mode });
  return built.ok ? undefined : explain(built.errors);
}

/** Fit of every formula for one place; the result is keyed by formula id. */
export function fitAll(scene: Scene, library: readonly Formula[], edit: FitEdit, candidates: readonly Formula[] = library): Map<string, Fit> {
  const out = new Map<string, Fit>();
  for (const f of candidates) out.set(f.id, formulaFit(scene, library, edit, f));
  return out;
}
