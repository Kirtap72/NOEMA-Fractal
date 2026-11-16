/**
 * GROUP-EXECUTION-BRIDGE-01: lets a data-defined transform (for example one converted from a Mandelbulb 3D JIT file) take part in the
 * grouped execution modes as an uncounted mapping helper, the same role the built-in helper kernels (abs-x, celtic mode, ...) have.
 *
 * A transform is eligible only when its whole effect is "move the point": it has no distance estimate of its own, it carries just the
 * point z (starting at pos) and the unused derivative dr, and nothing writes dr. For such a formula one helper call means: start from the
 * orbit point (state.v.xyz), take the iteration constant from state.c.xyz, run the steps once, write the point back and leave w,
 * the counters and the bailout to the host. Break conditions of the standalone chain are ignored, because a helper never owns bailout.
 *
 * The formula text is still only data: the same restricted expression checker that builds ordinary chains builds the shader here, and
 * the CPU reference uses the shared restricted evaluator. Nothing is ever executed as source.
 *
 * Eligibility is explicit. A formula that does not qualify is refused with a reason; it is never approximated and never replaced.
 */
import { compileCpuExpression } from './cpu';
import type { CpuEnv, CpuFn, CpuValue } from './cpu';
import { translateExpression } from './expression';
import { KERNELS } from './kernels';
import type { KernelId, KernelState } from './kernels';
import type { Formula } from './types';
import type { ChainStep } from './chain';
import type { ChainExecution } from './groupExecution';

export const IMPORTED_HELPER_PREFIX = 'imp:';
export const isImportedHelperId = (id: string): boolean => id.startsWith(IMPORTED_HELPER_PREFIX);
const isDifsHelper = (id: string): boolean => id.startsWith(IMPORTED_HELPER_PREFIX + 'difs:');

type HelperSource = Pick<Formula, 'id' | 'name' | 'parameters' | 'variables' | 'steps' | 'distance' | 'carry' | 'kernel'>;

/** Why a transform cannot be a helper, or null when it can. Reasons are shown to the artist and the AI. */
export function importedHelperRefusal(f: HelperSource): string | null {
  if (f.kernel) return null; // already a registered kernel: not our concern
  if (f.distance !== undefined) return 'the formula has its own distance estimate, so it is not a pure transform';
  if (f.carry.includes('q') && f.variables.some((v) => v.name === 'q' && v.type === 'vec4')) return 'the formula uses w as a genuine fourth coordinate; a helper must preserve w (it carries the derivative in grouped executions), so it can only be used in an ordinary chain in front of a 4D formula';
  const carry = [...f.carry].sort().join(',');
  if (carry !== 'dr,z' && carry !== 'z') return 'only transforms that carry just the point z (and an unused dr) can act as a helper';
  const z = f.variables.find((v) => v.name === 'z');
  if (!z || z.type !== 'vec3' || z.init.trim() !== 'pos') return 'the point z must be a vec3 that starts at pos';
  if (f.variables.some((v) => v.type === 'vec4')) return 'four-dimensional variables are not supported in a helper';
  // The importer's own stretch correction is the one allowed write: `dr = dr * jscale`, the numerical Jacobian norm of the point map. It scales the host's
  // derivative (w in a mapping group, the accumulated scale in a dIFS sequence); every other write to dr means the formula is not a pure point transform.
  for (const s of f.steps) if (s.kind !== 'break_if' && s.target === 'dr' && !(s.op === '=' && s.expr.replace(/[()\s]/g, '') === 'dr*jscale')) return 'the derivative dr is written, so the formula is not a pure point transform';
  if (f.variables.some((v) => v.name === 'pos' || v.name === 'c')) return 'a variable shadows the iteration constant';
  return null;
}
export const isImportedHelperCapable = (f: HelperSource): boolean => !f.kernel && importedHelperRefusal(f) === null;

interface Compiled { formula: HelperSource; locals: { name: string; init: CpuFn }[]; body: { target: string; op: string; expr: CpuFn }[] }
const registry = new Map<string, Compiled>();
/** The same transform is registered once per family: as a mapping helper, or as the uncounted transform of a bounded dIFS sequence. */
type Family = 'mapping' | 'difs';
const kernelIdOf = (f: HelperSource, family: Family): KernelId => `${IMPORTED_HELPER_PREFIX}${family === 'difs' ? 'difs:' : ''}${f.id}` as KernelId;
const signature = (f: HelperSource): string => JSON.stringify([f.parameters, f.variables, f.steps, f.carry]);
const signatures = new Map<string, string>();

function register(f: HelperSource, family: Family): KernelId {
  const id = kernelIdOf(f, family), sig = signature(f);
  if (registry.has(id) && signatures.get(id) === sig) return id;
  const paramIndex = new Map(f.parameters.map((p, i) => [p.name, i]));
  const resolve = (name: string): CpuFn => {
    if (name === 'pos') return (env: CpuEnv) => env.jpos;
    const pi = paramIndex.get(name);
    if (pi !== undefined) return (env: CpuEnv) => env.params[pi]!;
    return (env: CpuEnv) => { const v = env.vars.get(name); if (v === undefined) throw new Error(`unknown name "${name}"`); return v; };
  };
  const locals = f.variables.filter((v) => !f.carry.includes(v.name)).map((v) => ({ name: v.name, init: compileCpuExpression(v.init, resolve, false) }));
  const body = f.steps.filter((s) => s.kind !== 'break_if').map((s) => { const a = s as { target: string; op: string; expr: string }; return { target: a.target, op: a.op, expr: compileCpuExpression(a.expr, resolve, false) }; });
  registry.set(id, { formula: f, locals, body }); signatures.set(id, sig);
  // Same shape as the built-in mapping helpers, so every existing group rule treats it identically.
  (KERNELS as Record<string, unknown>)[id] = family === 'difs'
    ? { dimension: 3, method: 'difs', role: 'difs-transform', wMode: 'preserve', parameters: f.parameters.map((p) => ({ ...p })), hints: { deoption: 21, descale: 1, adescale: 1, rstop: 16, sipow: 0 } }
    : { dimension: 3, method: 'numeric', role: 'helper', wMode: 'preserve', helperMethods: ['numeric', 'analytic'], mappingHelper: true, parameters: f.parameters.map((p) => ({ ...p })), hints: { deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0 } };
  return id;
}

/** Gives eligible transforms a helper kernel for the grouped execution paths. Ordinary chains keep the original formula untouched. Idempotent. */
export function bridgeExecutionSteps<T extends Pick<ChainStep, 'formula'>>(steps: readonly T[], execution?: ChainExecution): T[] {
  const family: Family = execution?.kind === 'bounded-sequence' && execution.distance === 'difs-minimum' ? 'difs' : 'mapping';
  return steps.map((s) => {
    const f = s.formula;
    if (f.kernel || importedHelperRefusal(f) !== null) return s;
    return { ...s, formula: { ...f, kernel: register(f, family) } };
  });
}

const OPS: Record<string, (a: CpuValue, b: CpuValue) => CpuValue> = {
  '=': (_a, b) => b,
  '+=': (a, b) => bin(a, b, (x, y) => x + y), '-=': (a, b) => bin(a, b, (x, y) => x - y),
  '*=': (a, b) => bin(a, b, (x, y) => x * y), '/=': (a, b) => bin(a, b, (x, y) => x / y),
};
function bin(a: CpuValue, b: CpuValue, f: (x: number, y: number) => number): CpuValue {
  if (typeof a === 'boolean' || typeof b === 'boolean') throw new Error('a number was expected');
  if (Array.isArray(a)) return a.map((x, i) => f(x, Array.isArray(b) ? b[i]! : b));
  return Array.isArray(b) ? b.map((y) => f(a, y)) : f(a, b);
}

/** One helper call on the CPU reference. Parameters arrive in the formula's own order. */
export function stepImportedHelper(id: string, p: Record<string, number>, state: KernelState): void {
  const c = registry.get(id);
  if (!c) { state.invalid = true; return; }
  const f = c.formula;
  const params = f.parameters.map((d) => p[d.name]!);
  const env: CpuEnv = { vars: new Map<string, CpuValue>(), params, point: [state.v[0], state.v[1], state.v[2]], jpos: [state.c[0], state.c[1], state.c[2]] };
  try {
    for (const v of f.variables) if (f.carry.includes(v.name)) env.vars.set(v.name, v.name === 'z' ? [state.v[0], state.v[1], state.v[2]] : 1);
    for (const l of c.locals) env.vars.set(l.name, l.init(env));
    for (const b of c.body) env.vars.set(b.target, OPS[b.op]!(env.vars.get(b.target)!, b.expr(env)));
    const z = env.vars.get('z');
    if (!Array.isArray(z) || z.length !== 3) { state.invalid = true; return; }
    // The stretch of the point map (>= 1, exactly 1 for isometries) scales the host's derivative so the distance estimate stays conservative.
    const stretch = env.vars.get('dr'); const k = typeof stretch === 'number' && Number.isFinite(stretch) && stretch > 0 ? stretch : 1;
    if (isDifsHelper(id)) { state.v = [z[0]!, z[1]!, z[2]!, state.v[3]]; state.varyScale *= k; } else state.v = [z[0]!, z[1]!, z[2]!, state.v[3] * k];
  } catch { state.invalid = true; }
}

const wgslType = (t: string): string => (t === 'vec3' ? 'vec3f' : 'f32');
/** Shader text of one helper call, acting on the shared orbit `s` exactly like the built-in helper kernels. Throws a readable error on a bad expression. */
export function importedHelperBody(id: string, p: (name: string) => string): string {
  const c = registry.get(id);
  if (!c) throw Error(`imported helper ${id} is not registered`);
  const f = c.formula;
  const names = new Map<string, string>([['pos', 's.c.xyz']]);
  for (const d of f.parameters) names.set(d.name, p(d.name));
  for (const v of f.variables) names.set(v.name, `v_${v.name}`);
  const tr = (expr: string, what: string): string => { const r = translateExpression(expr, names); if (!r.ok) throw Error(`${f.id}, ${what}: ${r.error}`); return r.wgsl; };
  const lines: string[] = [];
  for (const v of f.variables) {
    if (f.carry.includes(v.name)) lines.push(`var v_${v.name} : ${wgslType(v.type)} = ${v.name === 'z' ? 's.v.xyz' : '1.0'};`);
    else lines.push(`var v_${v.name} : ${wgslType(v.type)} = ${tr(v.init, `variable "${v.name}"`)};`);
  }
  for (const s of f.steps) if (s.kind !== 'break_if') lines.push(`v_${s.target} ${s.op} ${tr(s.expr, `step on "${s.target}"`)};`);
  // The stretch of the point map (v_dr, >= 1; exactly 1 for isometries) scales the host's derivative: w in a mapping group, the accumulated scale in a dIFS sequence.
  const hasDr = f.carry.includes('dr');
  lines.push(isDifsHelper(id) ? `s.v = vec4f(v_z, s.v.w);${hasDr ? ' s.varyScale = s.varyScale * v_dr;' : ''}` : `s.v = vec4f(v_z, s.v.w${hasDr ? ' * v_dr' : ''});`);
  return `{${lines.join('\n')}}`;
}
