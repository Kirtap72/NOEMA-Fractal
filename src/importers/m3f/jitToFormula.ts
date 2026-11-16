/**
 * FORMULA-IMPORTER-01: translates a parsed JIT formula into NOEMA's own safe formula document (format 1, the restricted expression
 * language). The result is data: it is checked by the same formula parser as every built-in formula and can contain nothing the
 * language does not allow. Nothing from the imported file is executed at any point.
 *
 * What the translation does:
 *  - the coordinates x, y, z become the vector `z` that chained formulas hand to each other; PIteration3D.J1..J3 become `pos`
 *  - every `if` is evaluated as a selection between the results of both branches (all operations are free of side effects)
 *  - Delphi's rounding (halves to even), Trunc, div, mod, Power and IntPower get explicit, tested expressions
 *  - the host's bailout test (radius squared above a limit stops the orbit) becomes the formula's break_if
 * What it deliberately does not do: invent a distance estimate (a JIT formula has none of its own, so the result is a transform
 * that is chained in front of a formula that has one) or translate the fourth coordinate w (its meaning depends on the distance mode).
 */
import { stringify } from 'yaml';
import type { Expr, JitProgram, Stmt } from './pascalJit';
import type { M3fOption } from './m3fFile';
import { RESERVED_NAMES } from '../../engine/formula/expression';

export interface ParameterMap { option: string; param: string; label: string; default: number }
export interface Translation { ok: true; text: string; id: string; parameters: ParameterMap[]; steps: number }
export type TranslateResult = Translation | { ok: false; errors: string[] };

const HOST_NAMES = new Set(['z', 'q', 'dr', 'bailout_squared', 'start_w', 'jc1', 'jc2', 'jc3', 'jg', 'jv', 'ja', 'jb', 'jcc', 'jd', 'je', 'jf', 'jscale']);
const lit = (v: number): string => {
  if (!Number.isFinite(v)) return '0.0';
  let s = Math.abs(v).toString();
  if (/e/i.test(s)) s = Math.abs(v).toFixed(20).replace(/0+$/, '');
  if (!s.includes('.')) s += '.0';
  if (s.endsWith('.')) s += '0';
  return v < 0 ? `(-${s})` : s;
};
export const normName = (s: string): string => {
  let n = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(n)) n = 'p_' + n;
  return n || 'p';
};

export interface TranslateSettings { /** The numerical-Jacobian stretch correction of the derivative (default on). Off exists only to measure its cost. */ stretchCorrection?: boolean }
export function translateJit(program: JitProgram, options: readonly M3fOption[], meta: { fileName: string; sha256: string; displayName: string }, settings: TranslateSettings = {}): TranslateResult {
  const errors: string[] = [];
  // JIT-W-01: w is translated only as what the formula's own mathematics shows it to be. The category that is verified is the genuine fourth
  // coordinate: w is computed together with x, y and z (hypercomplex products, 4D folds) and the xyz result depends on it. A formula where
  // w would instead be a distance-estimator derivative (updated from the radius, never feeding x, y or z) is a different meaning and is refused.
  const fourD = program.usesW;
  if (fourD && !program.wIsCoordinate) errors.push('The fourth coordinate w is used, but x, y and z never depend on it: that looks like a distance-estimator derivative, whose meaning depends on a distance mode the file does not state. It is not translated.');
  for (const o of options) if (o.type !== 'Double') errors.push(`The option "${o.name}" has the type ${o.type}. Only Double options are supported in this first generation.`);
  if (errors.length) return { ok: false, errors };

  // parameters
  const used = new Set<string>(fourD ? ['start_w'] : []); const parameters: ParameterMap[] = []; const pname = new Map<string, string>();
  for (const o of options) {
    let n = normName(o.name);
    while (RESERVED_NAMES.has(n) || HOST_NAMES.has(n) || used.has(n)) n += '_p';
    used.add(n); pname.set(o.name.toLowerCase(), n); parameters.push({ option: o.name, param: n, label: o.name, default: o.value });
  }
  const steps: (string | { break_if: string })[] = []; const variables = new Map<string, string>(); // name -> init
  let tmp = 0;
  const newTemp = (): string => { const n = `s${++tmp}`; variables.set(n, '0'); return n; };
  const emitStep = (name: string, expr: string): string => { steps.push(`${name} = ${expr}`); return name; };
  const local = (n: string): string => { const v = `v_${n}`; variables.set(v, '0'); return v; };
  const [cx, cy, cz, cw] = program.coords.map((c) => c.toLowerCase());
  const coordVar = new Map<string, string>([[cx!, 'vx'], [cy!, 'vy'], [cz!, 'vz'], ...(fourD ? [[cw!, 'vw'] as [string, string]] : [])]);
  for (const v of fourD ? ['vx', 'vy', 'vz', 'vw'] : ['vx', 'vy', 'vz']) variables.set(v, '0');
  const state = fourD ? 'q' : 'z';
  for (const n of program.locals.keys()) local(n);
  // Copies of the body for the numerical Jacobian use their own variable names (a suffix) and their own temporaries.
  let sfx = '';
  const varName = (n: string): string => { const v = (coordVar.get(n) ?? `v_${n}`) + sfx; variables.set(v, '0'); return v; };
  const vectors = new Map<string, 'vec3' | 'vec4'>();

  // The expression checker refuses text longer than 400 characters. A long result is stored in a temporary step first: the pieces are pure, the
  // steps run in order, and the temporary is read right where the long text would have stood, so the evaluation order and the numbers are the same.
  const LIMIT = 240;
  const bounded = (s: string): string => (s.length > LIMIT ? emitStep(newTemp(), s) : s);
  const num = (e: Expr): string => bounded(num0(e));
  const num0 = (e: Expr): string => {
    switch (e.k) {
      case 'num': return lit(e.v);
      case 'id': return pname.get(e.name) ?? varName(e.name);
      case 'field': return e.name === 'J1' ? 'pos.x' : e.name === 'J2' ? 'pos.y' : 'pos.z';
      case 'un': return e.op === 'not' ? `(1.0 - ${bool(e.e)})` : e.op === '-' ? `(-${num(e.e)})` : num(e.e);
      case 'bin': {
        if (e.t === 'bool') return bool(e);
        const a = num(e.l), b = num(e.r);
        if (e.op === 'div') { const q = emitStep(newTemp(), `(${a} / ${b})`); return `(sign(${q}) * floor(abs(${q})))`; }
        if (e.op === 'mod') { const q = emitStep(newTemp(), `(${a} / ${b})`); return `(${a} - ${b} * (sign(${q}) * floor(abs(${q}))))`; }
        return `(${a} ${e.op} ${b})`;
      }
      case 'call': return call(e);
    }
  };
  const bool = (e: Expr): string => bounded(bool0(e));
  const bool0 = (e: Expr): string => {
    if (e.k === 'un' && e.op === 'not') return `(1.0 - ${bool(e.e)})`;
    if (e.k !== 'bin') return '0.0';
    if (e.op === 'and') return `min(${bool(e.l)}, ${bool(e.r)})`;
    if (e.op === 'or') return `max(${bool(e.l)}, ${bool(e.r)})`;
    if (e.op === 'xor') return `abs(${bool(e.l)} - ${bool(e.r)})`;
    const op = e.op === '=' ? '==' : e.op === '<>' ? '!=' : e.op;
    return `select(0.0, 1.0, ${num(e.l)} ${op} ${num(e.r)})`;
  };
  const hold = (expr: string): string => emitStep(newTemp(), expr);
  const call = (e: Extract<Expr, { k: 'call' }>): string => {
    const a = e.args.map(num);
    switch (e.name) {
      case 'abs': return `abs(${a[0]})`; case 'sqrt': return `sqrt(${a[0]})`;
      case 'sqr': { const t = hold(a[0]!); return `(${t} * ${t})`; }
      case 'sin': case 'cos': case 'tan': case 'exp': return `${e.name}(${a[0]})`;
      case 'lnxp1': {
        // ln(1 + x) without losing the small digits of x (Kahan's form): ln(u) * x / (u - 1) with u = 1 + x, and x itself when u rounds to 1.
        const x = hold(a[0]!), u = hold(`(1.0 + ${x})`);
        return `select(${x}, log(${u}) * ${x} / (${u} - 1.0), ${u} != 1.0)`;
      }
      case 'sinh': { const t = hold(a[0]!); return `((exp(${t}) - exp(-${t})) * 0.5)`; }
      case 'cosh': { const t = hold(a[0]!); return `((exp(${t}) + exp(-${t})) * 0.5)`; }
      case 'tanh': { const t = hold(a[0]!); const e = hold(`exp(${t} * 2.0)`); return `((${e} - 1.0) / (${e} + 1.0))`; }
      case 'arctan': return `atan(${a[0]})`; case 'arctan2': return `atan2(${a[0]}, ${a[1]})`;
      case 'arcsin': return `asin(${a[0]})`; case 'arccos': return `acos(${a[0]})`; case 'ln': return `log(${a[0]})`;
      case 'degtorad': return `(${a[0]} * 0.017453292519943295)`; case 'radtodeg': return `(${a[0]} * 57.29577951308232)`;
      case 'trunc': { const t = hold(a[0]!); return `(sign(${t}) * floor(abs(${t})))`; }
      case 'round': {
        // Delphi's Round: halves go to the even integer. f = floor(a); the fraction d decides.
        const t = hold(a[0]!), f = hold(`floor(${t})`), d = hold(`(${t} - ${f})`), odd = hold(`(${f} - 2.0 * floor(${f} * 0.5))`);
        return `(${f} + select(0.0, 1.0, ${d} > 0.5) + select(0.0, ${odd}, ${d} == 0.5))`;
      }
      case 'power': case 'intpower': {
        // Delphi's Power: a negative base keeps its sign for whole exponents and is invalid for fractions; 0^0 = 1; 0^(negative) is invalid.
        const x = hold(a[0]!), y = hold(a[1]!);
        const odd = hold(`(${y} - 2.0 * floor(${y} * 0.5))`), whole = hold(`select(0.0, 1.0, ${y} == floor(${y}))`);
        const sgn = hold(`select(1.0, select(1.0, -1.0, ${odd} > 0.5), ${x} < 0.0)`);
        const bad = hold(`min(select(0.0, 1.0, ${x} < 0.0), 1.0 - ${whole})`);
        const nan = hold(`log(0.0 - abs(${x}) - 1.0)`); // evaluated at run time: not a number, like Delphi's invalid result
        const r = hold(`select(pow(abs(${x}), ${y}) * ${sgn}, ${nan}, ${bad} > 0.5)`);
        return `select(select(${r}, 1.0, ${y} == 0.0), ${nan}, min(select(0.0, 1.0, ${x} == 0.0), select(0.0, 1.0, ${y} < 0.0)) > 0.5)`;
      }
    }
    return '0.0';
  };

  const assigned = (s: Stmt, into: Set<string>): void => {
    if (s.k === 'assign') into.add(s.name); else if (s.k === 'sincos') { into.add(s.sin); into.add(s.cos); }
    else if (s.k === 'block') s.body.forEach((t) => assigned(t, into));
    else { assigned(s.then, into); if (s.else) assigned(s.else, into); }
  };
  const exec = (s: Stmt): void => {
    if (s.k === 'block') { s.body.forEach(exec); return; }
    if (s.k === 'assign') { const v = varName(s.name); const e = num(s.e); steps.push(`${v} = ${e}`); return; }
    if (s.k === 'sincos') { const a = hold(num(s.angle)); steps.push(`${varName(s.sin)} = sin(${a})`); steps.push(`${varName(s.cos)} = cos(${a})`); return; }
    // if: run both branches on the same variables, keep the results, select
    const c = hold(bool(s.cond)); const names = new Set<string>(); assigned(s, names);
    const list = [...names].map(varName); const before = list.map((v) => hold(v));
    exec(s.then); const thenVals = list.map((v) => hold(v));
    list.forEach((v, i) => steps.push(`${v} = ${before[i]}`));
    if (s.else) exec(s.else);
    list.forEach((v, i) => steps.push(`${v} = select(${v}, ${thenVals[i]}, ${c} > 0.5)`));
  };

  steps.push(`vx = ${state}.x`, `vy = ${state}.y`, `vz = ${state}.z`, ...(fourD ? [`vw = ${state}.w`] : []));
  program.body.forEach(exec);
  // Numerical Jacobian (VISUAL-RELIABILITY-01). The distance estimate of the formula that follows is measured in the transformed space, so a transform
  // that stretches space makes it too large and sphere tracing steps through the surface. The body is run three more times on points moved by H along x, y
  // and z; the largest stretch (the spectral norm of the 3-column Jacobian, by power iteration) multiplies the carried derivative dr. A stretch below
  // 1.0001 changes nothing, so isometries (folds, rotations, translations) keep their exact earlier distances. The point itself is never changed by this.
  const H = 0.002; const out = fourD ? ['vx', 'vy', 'vz', 'vw'] : ['vx', 'vy', 'vz'];
  const correct = settings.stretchCorrection !== false;
  for (let k = 1; correct && k <= 3; k++) {
    sfx = `_j${k}`;
    steps.push(`vx${sfx} = ${state}.x${k === 1 ? ` + ${lit(H)}` : ''}`, `vy${sfx} = ${state}.y${k === 2 ? ` + ${lit(H)}` : ''}`, `vz${sfx} = ${state}.z${k === 3 ? ` + ${lit(H)}` : ''}`, ...(fourD ? [`vw${sfx} = ${state}.w`] : []));
    for (const v of out) variables.set(v + sfx, '0');
    program.body.forEach(exec);
    sfx = '';
    vectors.set(`jc${k}`, fourD ? 'vec4' : 'vec3');
    steps.push(`jc${k} = ${fourD ? 'vec4' : 'vec3'}(${out.map((v) => `(${v}_j${k} - ${v}) / ${lit(H)}`).join(', ')})`);
  }
  if (correct) {
  vectors.set('jg', 'vec3'); vectors.set('jv', 'vec3'); variables.set('jscale', '0');
  steps.push('ja = dot(jc1, jc1)', 'jb = dot(jc1, jc2)', 'jcc = dot(jc1, jc3)', 'jd = dot(jc2, jc2)', 'je = dot(jc2, jc3)', 'jf = dot(jc3, jc3)');
  for (const n of ['ja', 'jb', 'jcc', 'jd', 'je', 'jf']) variables.set(n, '0');
  steps.push('jg = vec3(0.5773502691896258, 0.5773502691896258, 0.5773502691896258)');
  for (let i = 0; i < 4; i++) {
    steps.push('jv = vec3(ja * jg.x + jb * jg.y + jcc * jg.z, jb * jg.x + jd * jg.y + je * jg.z, jcc * jg.x + je * jg.y + jf * jg.z)');
    steps.push('jg = select(jg, jv / max(length(jv), 1.0e-30), length(jv) > 1.0e-30)');
  }
  steps.push('jv = vec3(ja * jg.x + jb * jg.y + jcc * jg.z, jb * jg.x + jd * jg.y + je * jg.z, jcc * jg.x + je * jg.y + jf * jg.z)');
  steps.push('jscale = sqrt(max(dot(jg, jv), 0.0))');
  steps.push('jscale = select(1.0, jscale, jscale > 1.0001)');
  steps.push('dr = dr * jscale');
  }
  steps.push(fourD ? 'q = vec4(vx, vy, vz, vw)' : 'z = vec3(vx, vy, vz)');
  // No break_if on purpose. A transform has no distance estimate, so an escape test inside it would stop the whole chain with the distance 0
  // and every far-away point would look like a surface hit. The host's bailout belongs to the formula that owns the distance estimate.


  const id = 'my-' + normName(meta.displayName).replace(/_/g, '-');
  const range = (d: number): { min: number; max: number } => { const m = Math.max(10, Math.abs(d) * 10); return { min: -m, max: m }; };
  const doc = {
    format: 1, id, name: `${meta.displayName} (importerad)`,
    description: `Private, locally imported formula from ${meta.fileName}. Machine-translated from the readable JIT source of the formula to the own formula language of NOEMA. It changes the point (a transform) and has no distance measure of its own: use it before a formula that has one. Options: ${options.map((o) => o.name).join(', ') || 'none'}.`,
    credits: [{ name: 'okänd', role: `author of ${meta.fileName} was not read from the file; check the source before the formula is shared`, status: 'unverified' }],
    sources: [{ reference: `Local file ${meta.fileName}, SHA-256 ${meta.sha256}`, status: 'unverified' }],
    added_by: 'NOEMA m3f importer (local, private)',
    math_status: 'Machine-translated from a readable source on the computer of the user for private use. Not reviewed, not compared with Mandelbulb 3D pictures. Must not be distributed with NOEMA.',
    reviewed: false,
    catalog: { category: 'transforms', tags: ['importerad', 'privat', 'jit', ...(fourD ? ['4d'] : [])], dimension: fourD ? 4 : 3, family: 'My imported formulas' },
    parameters: [...parameters.map((p) => ({ name: p.param, label: p.label, default: p.default, ...range(p.default) })), ...(fourD ? [{ name: 'start_w', label: 'Start value for w (4D slice)', default: 0, min: -10, max: 10 }] : [])],
    iteration: {
      iterations: 1, carry: [state, 'dr'],
      variables: [fourD ? { name: 'q', type: 'vec4', init: 'vec4(pos.x, pos.y, pos.z, start_w)' } : { name: 'z', type: 'vec3', init: 'pos' }, { name: 'dr', type: 'float', init: 1 }, ...[...variables.keys()].map((n) => ({ name: n, type: 'float', init: 0 })), ...[...vectors.entries()].map(([n, type]) => ({ name: n, type, init: type === 'vec4' ? 'vec4(0.0, 0.0, 0.0, 0.0)' : 'vec3(0.0, 0.0, 0.0)' }))],
      steps,
    },
    view: { camera_distance: 4 },
  };
  return { ok: true, text: stringify(doc, { lineWidth: 0 }), id, parameters, steps: steps.length };
}
