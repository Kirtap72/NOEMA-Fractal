import type { Formula } from "./formula/types";
import { defaultStep, MAX_CHAIN_STEPS, MAX_STEP_ITERATIONS, STEP_FACTOR_LIMITS } from "./scene";
import type { ChainStepData, FractalContent, JuliaSettings, Scene } from "./scene";
import { WEIGHT_LIMITS } from "./scene";
import type { ChainMode } from "./formula/chain";
import { MAX_ROUNDS } from "./formula/chain";
import { executionAfterInsert, executionAfterMove, executionAfterRemove, executionWithGroupField } from "./formula/groupEdit";
import type { GroupField } from "./formula/groupEdit";

/**
 * Small pure functions that change the chain of a scene. Each returns a new
 * scene and leaves the old one untouched. They work on the first fractal.
 * A change that cannot be done (out of range, last step removed) returns the same scene.
 */

function change(scene: Scene, edit: (fractal: FractalContent) => FractalContent | null): Scene {
  const [first, ...rest] = scene.content;
  if (!first) return scene;
  const next = edit(first);
  return next === null ? scene : { ...scene, content: [next, ...rest] };
}

/** Keeps the steps of every keyframe in line with the chain after steps were added, removed or moved. */
function withKeyframeSteps(scene: Scene, change: (steps: { parameters: Record<string, number> }[]) => { parameters: Record<string, number> }[]): Scene {
  if (scene.animation.keyframes.length === 0) return scene;
  const keyframes = scene.animation.keyframes.map((k) => ({ ...k, steps: change(k.steps) }));
  return { ...scene, animation: { ...scene.animation, keyframes } };
}

function editStep(scene: Scene, index: number, edit: (step: ChainStepData) => ChainStepData): Scene {
  return change(scene, (f) => {
    const step = f.chain[index];
    if (!step) return null;
    return { ...f, chain: f.chain.map((s, i) => (i === index ? edit(s) : s)) };
  });
}

/** Sets one parameter of one step. */
export function withStepParameter(scene: Scene, index: number, name: string, value: number): Scene {
  return editStep(scene, index, (s) => ({ ...s, parameters: { ...s.parameters, [name]: value } }));
}

/** Sets how many iterations a step runs. */
export function withStepIterations(scene: Scene, index: number, iterations: number): Scene {
  const n = Math.round(iterations);
  if (n < 1 || n > MAX_STEP_ITERATIONS) return scene;
  return editStep(scene, index, (s) => ({ ...s, iterations: n }));
}

/** Sets the safety margin (step factor) of one step; 1 removes it. */
export function withStepFactor(scene: Scene, index: number, factor: number): Scene {
  if (!(factor >= STEP_FACTOR_LIMITS[0] && factor <= STEP_FACTOR_LIMITS[1])) return scene;
  return editStep(scene, index, (s) => {
    const { step_factor: _old, ...rest } = s;
    return factor === 1 ? rest : { ...rest, step_factor: factor };
  });
}

/** Sets how the chain combines its steps; "sequence" removes the field. */
export function withChainMode(scene: Scene, mode: ChainMode): Scene {
  return change(scene, (f) => {
    const { mode: _old, execution: _execution, ...rest } = f;
    return mode === "sequence" ? rest : { ...rest, mode };
  });
}

/** Sets when a step runs in "alternate" mode. every = 1 and start = 0 remove the fields. */
export function withStepSchedule(scene: Scene, index: number, every: number, start: number): Scene {
  const e = Math.round(every);
  const s = Math.round(start);
  if (e < 1 || e > MAX_ROUNDS || s < 0 || s >= MAX_ROUNDS) return scene;
  return editStep(scene, index, (step) => {
    const { every: _e, start: _s, ...rest } = step;
    return { ...rest, ...(e !== 1 ? { every: e } : {}), ...(s !== 0 ? { start: s } : {}) };
  });
}

/** Sets the weight of a step in "interpolate" mode; 1 removes the field. */
export function withStepWeight(scene: Scene, index: number, weight: number): Scene {
  if (!(weight >= WEIGHT_LIMITS[0] && weight <= WEIGHT_LIMITS[1])) return scene;
  return editStep(scene, index, (step) => {
    const { weight: _w, ...rest } = step;
    return weight === 1 ? rest : { ...rest, weight };
  });
}

/** Turns Julia mode on or off, or sets its constant. */
export function withJulia(scene: Scene, changes: Partial<JuliaSettings>): Scene {
  return change(scene, (f) => ({ ...f, julia: { enabled: false, c: [0, 0, 0], ...(f.julia ?? {}), ...changes } }));
}

/** Sets how many times the whole chain is repeated. */
export function withRounds(scene: Scene, rounds: number): Scene {
  const n = Math.round(rounds);
  if (n < 1 || n > MAX_ROUNDS) return scene;
  return change(scene, (f) => ({ ...f, rounds: n }));
}

/** Adds a step with the formula's default values, at the end or at `index`. */
export function addStep(scene: Scene, formula: Formula, index?: number, group?: number): Scene {
  const first = scene.content[0];
  const at = first ? (index === undefined ? first.chain.length : Math.max(0, Math.min(index, first.chain.length))) : 0;
  const changed = change(scene, (f) => {
    if (f.chain.length >= MAX_CHAIN_STEPS) return null;
    const at = index === undefined ? f.chain.length : Math.max(0, Math.min(index, f.chain.length));
    const chain = [...f.chain];
    chain.splice(at, 0, {...defaultStep(formula),...(f.id?{id:'step-'+crypto.randomUUID()}:{})});
    // A grouped execution points at chain positions: its borders move with the step, or it would silently run other formulas.
    if (f.execution) { const e = executionAfterInsert(f.execution, at, group); if (!e.ok) return null; return { ...f, chain, execution: e.execution }; }
    return { ...f, chain };
  });
  if (changed === scene) return scene;
  const defaults = defaultStep(formula).parameters;
  return withKeyframeSteps(changed, (steps) => {
    const out = [...steps];
    out.splice(at, 0, { parameters: { ...defaults } });
    return out;
  });
}

/** Removes a step. The last remaining step cannot be removed. */
export function removeStep(scene: Scene, index: number): Scene {
  const changed = change(scene, (f) => {
    if (f.chain.length <= 1 || !f.chain[index]) return null;
    const chain = f.chain.filter((_, i) => i !== index);
    if (f.execution) { const e = executionAfterRemove(f.execution, index); if (!e.ok) return null; return { ...f, chain, execution: e.execution }; }
    return { ...f, chain };
  });
  if (changed === scene) return scene;
  return withKeyframeSteps(changed, (steps) => steps.filter((_, i) => i !== index));
}

/** Moves a step from one place in the chain to another. */
export function moveStep(scene: Scene, from: number, to: number): Scene {
  const changed = change(scene, (f) => {
    if (!f.chain[from] || to < 0 || to >= f.chain.length || from === to) return null;
    if (f.execution && !executionAfterMove(f.execution, from, to).ok) return null;
    const chain = [...f.chain];
    const [step] = chain.splice(from, 1);
    chain.splice(to, 0, step!);
    return { ...f, chain };
  });
  if (changed === scene) return scene;
  return withKeyframeSteps(changed, (steps) => {
    const out = [...steps];
    const [moved] = out.splice(from, 1);
    if (moved) out.splice(to, 0, moved);
    return out;
  });
}

/** Swaps the formula of a step; the step then starts with the new formula's defaults. */
export function setStepFormula(scene: Scene, index: number, formula: Formula): Scene {
  const changed = editStep(scene, index, (step) => ({...defaultStep(formula),...(step.id?{id:'step-'+crypto.randomUUID()}:{})}));
  if (changed === scene) return scene;
  const defaults = defaultStep(formula).parameters;
  return withKeyframeSteps(changed, (steps) => steps.map((s, i) => (i === index ? { parameters: { ...defaults } } : s)));
}

/** Why a chain edit on a grouped scene is refused (null when it is allowed). The edit functions above return the unchanged scene without saying why. */
export function stepEditRefusal(scene: Scene, edit: { op: "insert"; index?: number; group?: number } | { op: "remove"; index: number } | { op: "move"; from: number; to: number }): string | null {
  const f = scene.content[0];
  if (!f || f.type !== "fractal" || !f.execution) return null;
  const len = f.chain.length;
  const r = edit.op === "insert" ? executionAfterInsert(f.execution, edit.index === undefined ? len : Math.max(0, Math.min(edit.index, len)), edit.group)
    : edit.op === "remove" ? executionAfterRemove(f.execution, edit.index) : executionAfterMove(f.execution, edit.from, edit.to);
  return r.ok ? null : r.reason;
}

/** Sets a supported setting (repeat point or call limit) of one execution group of the first fractal; the caller validates the result with the engine rules. */
export function withExecutionGroup(scene: Scene, group: number, field: GroupField, value: number): Scene {
  return change(scene, (f) => {
    if (!f.execution) return null;
    const e = executionWithGroupField(f.execution, group, field, value);
    return e.ok ? { ...f, execution: e.execution } : null;
  });
}

/**
 * Splits the chain after step `afterIndex` into two independently evaluated groups and combines their distances
 * (`independent-field`: union, intersection, difference or smooth union), or runs the first group as a mapping that the
 * second group's dIFS field then continues from (`mapped-field`). The caller checks the result with the engine rules
 * (resolveScene) and shows the reason when the pair is not allowed; the scene is never changed here beyond the field.
 * Budgets start at 32 counted calls for the first group and 8 for the second; both can be edited afterwards.
 */
export function withGroupedExecution(
  scene: Scene,
  afterIndex: number,
  kind: "independent-field" | "mapped-field",
  operation: "max-inverted-second" | "min" | "max" | "smooth-min" | "smooth-min-cubic" = "min",
  smooth = 0.1,
): Scene {
  return change(scene, (f) => {
    const last = f.chain.length - 1;
    if (!Number.isInteger(afterIndex) || afterIndex < 0 || afterIndex >= last) return null;
    const groups: [{ start: number; end: number; repeat: number; maxIterations: number }, { start: number; end: number; repeat: number; maxIterations: number }] = [
      { start: 0, end: afterIndex, repeat: 0, maxIterations: 32 },
      { start: afterIndex + 1, end: last, repeat: afterIndex + 1, maxIterations: 8 },
    ];
    const { mode: _mode, ...rest } = f;
    const execution =
      kind === "mapped-field"
        ? ({ kind, fieldStop: "query", groups } as const)
        : ({ kind, operation, ...(operation.startsWith("smooth") ? { smooth } : {}), groups } as const);
    return { ...rest, rounds: 1, chain: f.chain.map((s) => { const { every: _e, start: _s, weight: _w, ...step } = s; return step; }), execution } as FractalContent;
  });
}

/** Removes grouped execution, so the chain runs as an ordinary chain again. */
export function withoutGroupedExecution(scene: Scene): Scene {
  return change(scene, (f) => {
    if (!f.execution) return null;
    const { execution: _execution, ...rest } = f;
    return rest as FractalContent;
  });
}

/**
 * Adds a second formula (normally a dIFS shape) as group B behind the whole current chain (group A) and sets the grouped
 * execution in one edit. A plain chain cannot hold a dIFS shape next to an ordinary fractal, so the shape and the groups
 * must arrive together. The caller checks the result with the engine rules and shows the reason when it is refused.
 */
export function withSecondGroup(
  scene: Scene,
  formula: Formula,
  kind: "independent-field" | "mapped-field",
  operation: "max-inverted-second" | "min" | "max" | "smooth-min" | "smooth-min-cubic" = "min",
  smooth = 0.1,
): Scene {
  const first = scene.content[0];
  if (!first || first.execution || first.chain.length < 1) return scene;
  const added = addStep(scene, formula);
  return added === scene ? scene : withGroupedExecution(added, first.chain.length - 1, kind, operation, smooth);
}
