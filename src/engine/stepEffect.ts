/**
 * ARTIST-WORKFLOW 04: "Visa stegets verkan". What does one formula step contribute to the artwork? The artist is shown the picture as it is next to
 * the same picture with that step changed in a small, understandable way:
 *   - "Utan steget":        the step is taken out of the chain;
 *   - "Halva varven":       the step runs half as many iterations (at least one);
 *   - "Standardvärden":     the step's parameters go back to the formula's own defaults.
 * (Choosing another formula for the step is what "Change formula" already does, with its own compatibility filter.)
 *
 * Every variant is a pure scene -> scene function, built from the same edit functions the editor uses, and checked with the renderer's own chain rules
 * (chainProblem) BEFORE anything is shown. A variant that would not run (the only step, the only counted formula of a chain, a transform whose
 * partner is removed, a grouped execution that refuses the edit) is listed as unavailable with the reason in Swedish. Nothing here renders or stores.
 */
import { chainProblem } from "./formulaFit";
import type { Formula } from "./formula/types";
import { defaultStep, resolveScene } from "./scene";
import type { Scene } from "./scene";
import { removeStep, stepEditRefusal, withStepIterations, withStepParameter } from "./sceneEdit";

export type StepVariantId = "without" | "half" | "defaults";

export interface StepVariant {
  id: StepVariantId;
  label: string;
  /** What changes, in one or two Swedish sentences, written for an artist. */
  description: string;
  available: boolean;
  /** Why it is unavailable (Swedish). Only when `available` is false. */
  problem?: string;
  /** The change itself. Only when `available` is true. Works on any scene with the same chain (the authored scene or an evaluated view). */
  change?: (scene: Scene) => Scene;
  /** True when the variant gives the renderer another shader (the chain's structure or iterations changed): it compiles once, which can take a few seconds. */
  newShader?: boolean;
}

/** A short name of a step for sentences: "steg 2 (Benesi Pine 1, 16 varv)". */
export function stepName(scene: Scene, library: readonly Formula[], index: number): string {
  const step = scene.content[0]?.chain[index];
  const formula = step && library.find((f) => f.id === step.formula);
  if (!step || !formula) return `step ${index + 1}`;
  return `step ${index + 1} (${formula.name}, ${step.iterations ?? formula.iterations} rounds)`;
}

const shaderKey = (scene: Scene, library: readonly Formula[]): string | undefined => {
  const r = resolveScene(scene, library);
  return r.ok ? r.key : undefined;
};

/** The variants of step `index` of the first fractal, each available or explained. Never throws. */
export function stepVariants(scene: Scene, library: readonly Formula[], index: number): StepVariant[] {
  const fractal = scene.content[0];
  const step = fractal?.chain[index];
  const formula = step && library.find((f) => f.id === step.formula);
  if (!fractal || !step || !formula) {
    return (["without", "half", "defaults"] as const).map((id) => ({ id, label: LABELS[id], description: "", available: false, problem: "The step does not exist in the chain." }));
  }
  const name = stepName(scene, library, index);
  const here = shaderKey(scene, library);
  /** Checks a candidate scene with the renderer's rules and wraps it as a variant. */
  const make = (id: StepVariantId, description: string, change: (s: Scene) => Scene, unavailable?: string): StepVariant => {
    const base = { id, label: LABELS[id], description };
    if (unavailable) return { ...base, available: false, problem: unavailable };
    const after = change(scene);
    if (after === scene) return { ...base, available: false, problem: "The change cannot be made here." };
    const problem = chainProblem(after, library);
    if (problem) return { ...base, available: false, problem: id === "without" ? `Without ${name} the chain cannot be drawn. ${problem}` : problem };
    return { ...base, available: true, change, newShader: shaderKey(after, library) !== here };
  };

  // 1. without the step
  const without = (s: Scene): Scene => removeStep(s, index);
  const total = fractal.chain.length;
  const refusal = total <= 1 ? "It is the only step of the chain: a chain must have at least one." : stepEditRefusal(scene, { op: "remove", index });
  const variants: StepVariant[] = [
    make("without", `${capital(name)} is removed. The chain runs with ${total - 1} ${total - 1 === 1 ? "step" : "steps"}.`, without, refusal ?? undefined),
  ];

  // 2. half as many iterations
  const iterations = step.iterations ?? formula.iterations;
  const halved = Math.max(1, Math.floor(iterations / 2));
  variants.push(make("half", `${capital(name)} runs ${halved} rounds instead of ${iterations}.`, (s) => withStepIterations(s, index, halved), iterations <= 1 ? "The step already has only one round." : undefined));

  // 3. the formula's own parameter values
  const defaults = defaultStep(formula).parameters;
  const changed = formula.parameters.filter((p) => Math.abs((step.parameters[p.name] ?? p.default) - (defaults[p.name] ?? p.default)) > 1e-12);
  variants.push(make("defaults", changed.length ? `${capital(name)} gets the default values of the formula (${changed.map((p) => p.label ?? p.name).join(", ")}).` : "", (s) => changed.reduce((acc, p) => withStepParameter(acc, index, p.name, defaults[p.name] ?? p.default), s), changed.length ? undefined : "The step already has the default values of the formula."));
  return variants;
}

const LABELS: Record<StepVariantId, string> = { without: "Without the step", half: "Half the rounds", defaults: "Default values" };
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
