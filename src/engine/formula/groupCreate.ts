/**
 * JIT-COMPLETE-01 phase B: builds a grouped-execution fractal from a plain description (kind, groups, formula steps), for the AI tools and
 * for guided starting points. It contains no mathematics of its own: the execution object is the engine's own `ChainExecution`, and every
 * rule is asked of the engine (`resolveScene` -> `chainExecutionErrors`, the imported-helper refusal reasons). An invalid proposal returns the
 * engine's sentence plus a short hint about what to change. Nothing is ever replaced or approximated.
 */
import type { Formula } from './types';
import type { ChainExecution, ChainGroup } from './groupExecution';
import { createDefaultScene, defaultStep, MAX_CHAIN_STEPS, parseScene, resolveScene } from '../scene';
import type { ChainStepData, FractalContent, Scene } from '../scene';
import { importedHelperRefusal } from './importedHelper';
import TEMPLATES from './groupTemplates.json';

export const GROUP_KINDS = ['mapped-field', 'independent-field', 'difs-sequence'] as const;
export type GroupKindName = (typeof GROUP_KINDS)[number];

export interface GroupSpecStep { formula: string; iterations?: number; parameters?: Record<string, number> }
export interface GroupSpecGroup { steps: GroupSpecStep[]; /** Position inside the group (0 = its first step) where the repeated part starts. */ repeat?: number; max_iterations?: number }
export interface GroupSpec { kind: GroupKindName; groups: GroupSpecGroup[]; julia?: { enabled: boolean; c: [number, number, number] } }
/** Where a camera that shows the starting point's geometry stands (taken from the example preset, then checked by the CPU marcher). */
export interface CameraHint { position: [number, number, number]; target: [number, number, number]; fov_degrees: number; source: string; visibleShare?: number }
export interface GroupTemplate { id: string; name: string; description: string; fixture: string; spec: GroupSpec; camera_hint?: CameraHint }

export const GROUP_TEMPLATES = TEMPLATES as unknown as GroupTemplate[];
const GROUP_COUNT: Record<GroupKindName, number> = { 'mapped-field': 2, 'independent-field': 2, 'difs-sequence': 1 };
/** Used only when the description leaves the call limit out; the engine's total budget (256) still applies. */
const DEFAULT_LIMIT: Record<GroupKindName, number[]> = { 'mapped-field': [10, 5], 'independent-field': [10, 6], 'difs-sequence': [8] };

export type BuildResult = { ok: true; content: FractalContent; warnings: string[] } | { ok: false; errors: string[] };

/** What to do about the engine's own refusal texts, in plain Swedish. The engine text always comes first. */
const HINTS: [RegExp, string][] = [
  [/field group requires counted 3D dIFS shapes/, 'Group 2 must consist of counted 3D dIFS shapes. Move transforms and analytic formulas to group 1.'],
  [/mapping group requires counted 3D analytic w kernels or recovered uncounted mapping helpers/, 'Group 1 takes counted analytic 3D formulas with w (for example an Amazing Box) and transforms as helper steps. Replace the formula or move it.'],
  [/radius-over-w execution requires counted 3D analytic\/IFS derivative kernels/, 'A counted sequence only takes counted analytic/IFS formulas. Helper steps and dIFS shapes do not belong there.'],
  [/dIFS execution requires exact 3D shapes and uncounted transforms/, 'A dIFS sequence only takes exact 3D dIFS shapes and uncounted transforms.'],
  [/repeat suffix must contain counted calls|repeat suffix needs a counted shape/, 'The repeat part must contain at least one counted call: move the repeat point so that it reaches a counted formula.'],
  [/budget exceeds 256/, 'Lower the call ceilings or the iterations: the sum of all calls, helper steps included, may be at most 256.'],
  [/invalid group quota/, 'The iterations of each step must be an integer from 1 to 64.'],
];
const hint = (message: string): string => HINTS.find(([re]) => re.test(message))?.[1] ?? '';

/** The scene the engine would run, validated through its own parser and resolver. Returns the engine's sentences. */
export function groupedSceneErrors(scene: Scene, library: readonly Formula[]): string[] {
  const parsed = parseScene(structuredClone(scene) as unknown);
  if (!parsed.ok) return parsed.errors.slice(0, 4);
  const r = resolveScene(scene, library as Formula[]);
  return r.ok ? [] : r.errors.slice(0, 4);
}

export function buildGroupedContent(spec: GroupSpec, library: readonly Formula[], base?: Scene, newId: () => string = () => 'step-' + Math.random().toString(36).slice(2, 10)): BuildResult {
  const errors: string[] = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['The description is missing.'] };
  if (!(GROUP_KINDS as readonly string[]).includes(spec.kind)) return { ok: false, errors: [`Unknown type "${String(spec.kind).slice(0, 40)}". Valid: ${GROUP_KINDS.join(', ')}.`] };
  const need = GROUP_COUNT[spec.kind];
  if (!Array.isArray(spec.groups) || spec.groups.length !== need) return { ok: false, errors: [`${spec.kind} has exactly ${need} group${need > 1 ? 's' : ''} (given: ${Array.isArray(spec.groups) ? spec.groups.length : 0}).`] };
  const chain: ChainStepData[] = []; const groups: ChainGroup[] = []; const warnings: string[] = [];
  spec.groups.forEach((g, k) => {
    const label = `group ${k + 1}`;
    if (!g || !Array.isArray(g.steps) || g.steps.length < 1) { errors.push(`${label}: at least one step is required.`); return; }
    const start = chain.length;
    g.steps.forEach((s, i) => {
      const f = library.find((x) => x.id === s?.formula);
      if (!f) { errors.push(`${label}, step ${i + 1}: the formula "${String(s?.formula).slice(0, 60)}" does not exist. See noema_list_formulas.`); return; }
      const step = defaultStep(f);
      if (s.iterations !== undefined) { if (!Number.isInteger(s.iterations) || s.iterations < 1 || s.iterations > 64) errors.push(`${label}, step ${i + 1} (${f.id}): iterations must be an integer 1–64.`); else step.iterations = s.iterations; }
      for (const [name, v] of Object.entries(s.parameters ?? {})) {
        const def = f.parameters.find((p) => p.name === name);
        if (!def) errors.push(`${label}, step ${i + 1} (${f.id}): no parameter ${name}. Valid: ${f.parameters.map((p) => p.name).join(', ')}.`);
        else if (typeof v !== 'number' || !Number.isFinite(v) || v < def.min || v > def.max) errors.push(`${label}, step ${i + 1} (${f.id}): ${name} must be a number between ${def.min} and ${def.max}.`);
        else step.parameters = { ...step.parameters, [name]: v };
      }
      chain.push({ ...step, id: newId() } as ChainStepData);
    });
    const length = g.steps.length;
    const repeat = g.repeat ?? 0;
    if (!Number.isInteger(repeat) || repeat < 0 || repeat >= length) errors.push(`${label}: repeat must be a position 0–${length - 1} within the group (given: ${String(repeat)}).`);
    const limit = g.max_iterations ?? DEFAULT_LIMIT[spec.kind][k]!;
    if (!Number.isInteger(limit) || limit < 1 || limit > 256) errors.push(`${label}: max_iterations must be an integer 1–256.`);
    groups.push({ start, end: start + length - 1, repeat: start + (Number.isInteger(repeat) ? repeat : 0), maxIterations: limit });
  });
  if (chain.length > MAX_CHAIN_STEPS) errors.push(`The chain has ${chain.length} steps; at most ${MAX_CHAIN_STEPS} fit.`);
  if (errors.length) return { ok: false, errors };
  const execution: ChainExecution = spec.kind === 'mapped-field' ? { kind: 'mapped-field', groups: groups as [ChainGroup, ChainGroup], fieldStop: 'query' }
    : spec.kind === 'independent-field' ? { kind: 'independent-field', operation: 'max-inverted-second', groups: groups as [ChainGroup, ChainGroup] }
      : { kind: 'bounded-sequence', groups, distance: 'difs-minimum' };
  const content: FractalContent = { type: 'fractal', chain, rounds: 1, mode: 'sequence', execution, julia: spec.julia ?? { enabled: false, c: [0, 0, 0] } } as FractalContent;
  // The engine decides. Its own sentences are returned, with the reason an imported transform was refused where that is the cause.
  const first = base?.content[0];
  const scene: Scene | null = base && first ? { ...base, content: [content, ...base.content.slice(1)] } as Scene : null;
  if (scene) {
    const engine = groupedSceneErrors(scene, library);
    if (engine.length) {
      const refusals = chain.flatMap((s) => { const f = library.find((x) => x.id === s.formula); const why = f && !f.kernel ? importedHelperRefusal(f) : null; return why ? [`${s.formula}: ${why}.`] : []; });
      return { ok: false, errors: [...engine.map((e) => { const h = hint(e); return h ? `${e} — ${h}` : e; }), ...[...new Set(refusals)]] };
    }
  }
  return { ok: true, content, warnings };
}

export const groupTemplate = (id: string): GroupTemplate | undefined => GROUP_TEMPLATES.find((t) => t.id === id);

const roleCache = new Map<string, string[]>();
/**
 * Where a formula may stand in a grouped execution, found by asking the engine: the formula is put into each position of each starting point
 * and the whole scene is checked with the engine's own rules. Nothing here knows what a "helper" or "field shape" is.
 */
export function groupRolesOf(formula: Formula, library: readonly Formula[]): string[] {
  const key = `${formula.id}|${library.length}|${formula.kernel ?? ''}`;
  const cached = roleCache.get(key); if (cached) return cached;
  const bulb = library.find((f) => f.id === 'mandelbulb') ?? library[0]!;
  const scene = createDefaultScene(bulb);
  const roles = new Set<string>();
  const withIt = [...library.filter((f) => f.id !== formula.id), formula];
  const test = (spec: GroupSpec, label: string): void => { if (buildGroupedContent(spec, withIt, scene).ok) roles.add(label); };
  for (const t of GROUP_TEMPLATES) t.spec.groups.forEach((g, k) => {
    const label = `${t.spec.kind}: group ${k + 1}`;
    // as an extra step at the front or the end of the group (how helpers and transforms are used)...
    for (const at of [0, g.steps.length]) { const spec = structuredClone(t.spec); spec.groups[k]!.steps.splice(at, 0, { formula: formula.id }); if (spec.groups[k]!.repeat !== undefined && at <= spec.groups[k]!.repeat!) spec.groups[k]!.repeat! += 1; test(spec, label); }
    // ...or in place of one of the group's steps (how counted shapes are used)
    g.steps.forEach((_, i) => { const spec = structuredClone(t.spec); const target = spec.groups[k]!.steps[i]!; target.formula = formula.id; delete target.parameters; test(spec, label); });
  });
  const out = [...roles]; roleCache.set(key, out); return out;
}
