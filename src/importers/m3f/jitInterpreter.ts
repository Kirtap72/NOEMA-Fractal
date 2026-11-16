/**
 * FORMULA-IMPORTER-01: the independent CPU reference for a parsed JIT formula. It walks the syntax tree directly (no code is generated,
 * nothing is evaluated as text), so it shares no code with the translator to NOEMA's formula language. Agreement between the two is the
 * mathematical validation of an import.
 *
 * Delphi rules that matter and are reproduced: Round is banker's rounding (halves go to the even integer), Trunc cuts toward zero,
 * integer div/mod cut toward zero, power(negative, whole number) keeps the sign while power(negative, fraction) is invalid, and a real
 * division by zero follows IEEE (infinity or NaN), which is later reported as an invalid point.
 */
import type { Expr, JitProgram, Stmt } from './pascalJit';

export interface JitState { x: number; y: number; z: number; w: number }
export interface JitInputs { options: ReadonlyMap<string, number>; c: readonly [number, number, number] }

export const roundHalfEven = (a: number): number => {
  if (!Number.isFinite(a)) return NaN;
  const f = Math.floor(a), d = a - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f + (f % 2 === 0 ? 0 : 1);
};
const trunc = (a: number): number => (Number.isFinite(a) ? Math.trunc(a) : NaN);
const isWhole = (a: number): boolean => Number.isFinite(a) && a === Math.floor(a);
export const delphiPower = (a: number, b: number): number => {
  if (b === 0) return 1;
  if (a === 0) return b > 0 ? 0 : NaN;
  if (a < 0) { if (!isWhole(b)) return NaN; return (b % 2 === 0 ? 1 : -1) * Math.pow(-a, b); }
  return Math.pow(a, b);
};

class InvalidPoint extends Error {}

export function runJit(program: JitProgram, start: JitState, input: JitInputs): JitState & { invalid: boolean } {
  const env = new Map<string, number>();
  const [cx, cy, cz, cw] = program.coords.map((n) => n.toLowerCase()) as [string, string, string, string];
  env.set(cx, start.x); env.set(cy, start.y); env.set(cz, start.z); env.set(cw, start.w);
  for (const name of program.locals.keys()) env.set(name, 0);
  const num = (e: Expr): number => {
    switch (e.k) {
      case 'num': return e.v;
      case 'id': { const v = env.get(e.name) ?? input.options.get(e.name); if (v === undefined) throw new InvalidPoint(`unset ${e.name}`); return v; }
      case 'field': return e.name === 'J1' ? input.c[0] : e.name === 'J2' ? input.c[1] : input.c[2];
      case 'un': { if (e.op === 'not') return cond(e) ? 1 : 0; const v = num(e.e); return e.op === '-' ? -v : v; }
      case 'bin': return binary(e);
      case 'call': return call(e);
    }
  };
  const cond = (e: Expr): boolean => {
    if (e.k === 'un' && e.op === 'not') return !cond(e.e);
    if (e.k !== 'bin') throw new InvalidPoint('not a condition');
    if (e.op === 'and') return cond(e.l) && cond(e.r);
    if (e.op === 'or') return cond(e.l) || cond(e.r);
    if (e.op === 'xor') return cond(e.l) !== cond(e.r);
    const a = num(e.l), b = num(e.r);
    switch (e.op) { case '=': return a === b; case '<>': return a !== b; case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; }
    throw new InvalidPoint(`operator ${e.op}`);
  };
  const binary = (e: Extract<Expr, { k: 'bin' }>): number => {
    const a = num(e.l), b = num(e.r);
    switch (e.op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
      case 'div': if (b === 0) throw new InvalidPoint('division by zero'); return trunc(a / b);
      case 'mod': if (b === 0) throw new InvalidPoint('division by zero'); return a - b * trunc(a / b);
    }
    throw new InvalidPoint(`operator ${e.op}`);
  };
  const call = (e: Extract<Expr, { k: 'call' }>): number => {
    const a = e.args.map(num);
    switch (e.name) {
      case 'abs': return Math.abs(a[0]!); case 'sqrt': return Math.sqrt(a[0]!); case 'sqr': return a[0]! * a[0]!;
      case 'sin': return Math.sin(a[0]!); case 'cos': return Math.cos(a[0]!); case 'tan': return Math.tan(a[0]!);
      case 'arctan': return Math.atan(a[0]!); case 'arctan2': return Math.atan2(a[0]!, a[1]!);
      case 'arcsin': return Math.asin(a[0]!); case 'arccos': return Math.acos(a[0]!);
      case 'exp': return Math.exp(a[0]!); case 'ln': return Math.log(a[0]!);
      case 'lnxp1': return Math.log1p(a[0]!);
      case 'sinh': return Math.sinh(a[0]!); case 'cosh': return Math.cosh(a[0]!); case 'tanh': return Math.tanh(a[0]!);
      case 'power': return delphiPower(a[0]!, a[1]!); case 'intpower': return delphiPower(a[0]!, a[1]!);
      case 'round': return roundHalfEven(a[0]!); case 'trunc': return trunc(a[0]!);
      case 'degtorad': return a[0]! * Math.PI / 180; case 'radtodeg': return a[0]! * 180 / Math.PI;
    }
    throw new InvalidPoint(`function ${e.name}`);
  };
  const exec = (s: Stmt): void => {
    if (s.k === 'block') { for (const t of s.body) exec(t); return; }
    if (s.k === 'assign') { env.set(s.name, num(s.e)); return; }
    if (s.k === 'sincos') { const a = num(s.angle); env.set(s.sin, Math.sin(a)); env.set(s.cos, Math.cos(a)); return; }
    if (cond(s.cond)) exec(s.then); else if (s.else) exec(s.else);
  };
  try { for (const s of program.body) exec(s); } catch (e) { if (e instanceof InvalidPoint) return { x: NaN, y: NaN, z: NaN, w: NaN, invalid: true }; throw e; }
  const out = { x: env.get(cx)!, y: env.get(cy)!, z: env.get(cz)!, w: env.get(cw)! };
  return { ...out, invalid: ![out.x, out.y, out.z].every(Number.isFinite) };
}
