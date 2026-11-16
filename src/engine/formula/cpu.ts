import { bridgeExecutionSteps } from './importedHelper';
import {compileDifsOrbit,difsExecutionErrors} from './difsExecution';
import {compileIndependentFieldCpu,independentFieldErrors} from './independentField';
import type {FieldMap} from '../fieldMaps';
import { compileMappedFieldCpu, mappedFieldErrors } from "./groupExecution";
import type { ChainExecution } from "./groupExecution";
/**
 * A second, independent way to run formula files: on the processor, in JavaScript.
 *
 * It reads the same expressions as the shader generator (expression.ts), but parses and evaluates them itself, and it
 * follows the same rules for chains (sequence, alternate, interpolate, Julia mode). It is used by the tests, to check
 * that a formula really draws something without a graphics card, and to compare the graphics card's results with
 * something that does not share its code. With `round32` expression results are rounded to 32 bits.
 * Registered kernels round committed state and radius instead; this is a precision approximation,
 * not instruction-by-instruction GPU emulation. Browser tests verify actual GPU calculations.
 *
 * It is slower than the shader and is not used for drawing.
 */
import type { ChainMode, ChainStep } from "./chain";
import { compileKernelCpu } from './kernelChain';

type Value = number | number[] | boolean;
type Fn = (env: Env) => Value;

interface Env {
  vars: Map<string, Value>;
  params: readonly number[];
  /** The point (used for the starting values of carried variables). */
  point: number[];
  /** The point, or the Julia constant in Julia mode. */
  jpos: number[];
}

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|[-+*/(),.<>]))/y;

function tokenize(source: string): { kind: "num" | "id" | "op"; text: string }[] {
  const tokens: { kind: "num" | "id" | "op"; text: string }[] = [];
  let pos = 0;
  while (pos < source.length) {
    if (/^\s*$/.test(source.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(source);
    if (!m) throw new Error(`character "${source.slice(pos).trim()[0]}" is not allowed`);
    if (m[1] !== undefined) tokens.push({ kind: "num", text: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: "id", text: m[2] });
    else tokens.push({ kind: "op", text: m[3]! });
    pos = TOKEN.lastIndex;
  }
  return tokens;
}

// ---- value helpers: scalars and vectors, with a scalar spread over a vector like in the shader

const isVec = (v: Value): v is number[] => Array.isArray(v);
const num = (v: Value): number => {
  if (typeof v === "number") return v;
  throw new Error("a number was expected");
};
function map2(a: Value, b: Value, f: (x: number, y: number) => number): Value {
  if (isVec(a) && isVec(b)) {
    if (a.length !== b.length) throw new Error("vectors of different length");
    return a.map((x, i) => f(x, b[i]!));
  }
  if (isVec(a)) return a.map((x) => f(x, num(b)));
  if (isVec(b)) return b.map((y) => f(num(a), y));
  return f(num(a), num(b));
}
const map1 = (a: Value, f: (x: number) => number): Value => (isVec(a) ? a.map(f) : f(num(a)));
const vec = (v: Value): number[] => {
  if (isVec(v)) return v;
  throw new Error("a vector was expected");
};

const FUNCS: Record<string, (args: Value[]) => Value> = {
  length: ([a]) => (isVec(a!) ? Math.hypot(...(a as number[])) : Math.abs(num(a!))),
  sin: ([a]) => map1(a!, Math.sin),
  cos: ([a]) => map1(a!, Math.cos),
  tan: ([a]) => map1(a!, Math.tan),
  asin: ([a]) => map1(a!, Math.asin),
  acos: ([a]) => map1(a!, Math.acos),
  atan: ([a]) => map1(a!, Math.atan),
  atan2: ([y, x]) => map2(y!, x!, Math.atan2),
  sqrt: ([a]) => map1(a!, Math.sqrt),
  pow: ([a, b]) => map2(a!, b!, Math.pow),
  log: ([a]) => map1(a!, Math.log),
  exp: ([a]) => map1(a!, Math.exp),
  abs: ([a]) => map1(a!, Math.abs),
  min: ([a, b]) => map2(a!, b!, Math.min),
  max: ([a, b]) => map2(a!, b!, Math.max),
  floor: ([a]) => map1(a!, Math.floor),
  fract: ([a]) => map1(a!, (x) => x - Math.floor(x)),
  sign: ([a]) => map1(a!, Math.sign),
  step: ([edge, x]) => map2(edge!, x!, (e, v) => (v >= e ? 1 : 0)),
  clamp: ([x, lo, hi]) => map2(map2(x!, lo!, Math.max), hi!, Math.min),
  mix: ([a, b, t]) => {
    const d = map2(b!, a!, (p, q) => p - q);
    return map2(a!, map2(d, t!, (p, q) => p * q), (p, q) => p + q);
  },
  dot: ([a, b]) => vec(a!).reduce((s, x, i) => s + x * vec(b!)[i]!, 0),
  cross: ([a, b]) => {
    const [x, y, z] = vec(a!) as [number, number, number];
    const [u, v, w] = vec(b!) as [number, number, number];
    return [y * w - z * v, z * u - x * w, x * v - y * u];
  },
  normalize: ([a]) => {
    const l = Math.hypot(...vec(a!));
    return vec(a!).map((x) => x / l);
  },
  // select(if false, if true, condition), as in the shader
  select: ([f, t, c]) => {
    if (typeof c === "boolean") return c ? t! : f!;
    throw new Error("select needs a true/false condition");
  },
  vec3: (args) => construct(args, 3),
  vec4: (args) => construct(args, 4),
};

function construct(args: Value[], n: number): number[] {
  const flat = args.flatMap((a) => (isVec(a) ? a : [num(a)]));
  if (flat.length === 1) return new Array(n).fill(flat[0]!);
  if (flat.length !== n) throw new Error(`vec${n} needs ${n} numbers`);
  return flat;
}

/** Turns one expression into a function, once. `resolve` says what a name means. */
function compile(source: string, resolve: (name: string) => Fn, round32: boolean): Fn {
  const tokens = tokenize(source);
  let i = 0;
  const peek = () => tokens[i];
  const take = (text?: string) => {
    const t = tokens[i++];
    if (!t || (text !== undefined && t.text !== text)) throw new Error(`expected "${text}"`);
    return t;
  };
  const r = round32 ? (v: Value): Value => (typeof v === "boolean" ? v : map1(v, Math.fround)) : (v: Value) => v;

  const primary = (): Fn => {
    const t = take();
    if (t.kind === "num") {
      const v = Number(t.text);
      return () => v;
    }
    if (t.kind === "id") {
      if (peek()?.text === "(") {
        const f = FUNCS[t.text];
        if (!f || !Object.hasOwn(FUNCS, t.text)) throw new Error(`unknown function "${t.text}"`);
        take("(");
        const args: Fn[] = [];
        if (peek()?.text !== ")") {
          args.push(comparison());
          while (peek()?.text === ",") {
            take(",");
            args.push(comparison());
          }
        }
        take(")");
        return (env) => r(f(args.map((a) => a(env))));
      }
      if (t.text === "pi") return () => 3.14159265358979;
      return resolve(t.text);
    }
    if (t.text === "(") {
      const e = comparison();
      take(")");
      return e;
    }
    throw new Error(`unexpected "${t.text}"`);
  };
  const postfix = (): Fn => {
    let e = primary();
    while (peek()?.text === ".") {
      take(".");
      const sw = take().text;
      const idx = [...sw].map((c) => "xyzw".indexOf(c));
      const inner = e;
      e = (env) => {
        const v = vec(inner(env));
        return idx.length === 1 ? v[idx[0]!]! : idx.map((k) => v[k]!);
      };
    }
    return e;
  };
  const unary = (): Fn => {
    if (peek()?.text === "-") {
      take("-");
      const e = unary();
      return (env) => map1(e(env), (x) => -x);
    }
    if (peek()?.text === "+") {
      take("+");
      return unary();
    }
    return postfix();
  };
  const product = (): Fn => {
    let e = unary();
    while (peek()?.text === "*" || peek()?.text === "/") {
      const op = take().text;
      const a = e;
      const b = unary();
      e = op === "*" ? (env) => r(map2(a(env), b(env), (x, y) => x * y)) : (env) => r(map2(a(env), b(env), (x, y) => x / y));
    }
    return e;
  };
  const sum = (): Fn => {
    let e = product();
    while (peek()?.text === "+" || peek()?.text === "-") {
      const op = take().text;
      const a = e;
      const b = product();
      e = op === "+" ? (env) => r(map2(a(env), b(env), (x, y) => x + y)) : (env) => r(map2(a(env), b(env), (x, y) => x - y));
    }
    return e;
  };
  const comparison = (): Fn => {
    const a = sum();
    const op = peek()?.text;
    if (op && ["<", ">", "<=", ">=", "==", "!="].includes(op)) {
      take();
      const b = sum();
      const cmp: Record<string, (x: number, y: number) => boolean> = {
        "<": (x, y) => x < y,
        ">": (x, y) => x > y,
        "<=": (x, y) => x <= y,
        ">=": (x, y) => x >= y,
        "==": (x, y) => x === y,
        "!=": (x, y) => x !== y,
      };
      const f = cmp[op]!;
      return (env) => f(num(a(env)), num(b(env)));
    }
    return a;
  };
  const e = comparison();
  if (i !== tokens.length) throw new Error(`unexpected "${tokens[i]!.text}"`);
  return e;
}

/** The restricted expression evaluator, shared with imported helper kernels (GROUP-EXECUTION-BRIDGE-01); it never evaluates source text as code. */
export { compile as compileCpuExpression };
export type { Fn as CpuFn, Env as CpuEnv, Value as CpuValue };
const zero = (type: "float" | "vec3" | "vec4"): Value => (type === "float" ? 0 : new Array(type === "vec3" ? 3 : 4).fill(0));

export interface CpuResult {
  dist: number;
  iterations: number;
  trap: number;
  /** Registered kernels flag undefined domains; legacy evaluators may omit this field. */
  invalid?: boolean;
}

export interface CpuChainOptions {
  fieldMaps?: readonly FieldMap[];
  execution?: ChainExecution;
  mode?: ChainMode;
  /** Round every result to 32 bits, like the graphics card. */
  round32?: boolean;
}

/**
 * Prepares a chain for running on the processor. The returned function takes the point, the parameter values of all
 * steps in order (as in the shader), the interpolation weights and the Julia constant (or null).
 */
export function compileChainCpu(
  stepsIn: readonly ChainStep[],
  rounds: number,
  options: CpuChainOptions = {},
): (point: readonly number[], params: readonly number[], weights?: readonly number[], julia?: readonly number[] | null, threshold?: number) => CpuResult {
  const steps = options.execution ? bridgeExecutionSteps(stepsIn, options.execution) : stepsIn;
  const mode: ChainMode = options.mode ?? "sequence";
  const round32 = options.round32 ?? false;
  if(options.execution?.kind==='independent-field'){
    const errors=independentFieldErrors(steps,rounds,mode,options.execution);if(errors.length)throw Error(errors.join('; '));
    return compileIndependentFieldCpu(steps,options.execution,round32,options.fieldMaps);
  }
  if(options.execution?.kind==='bounded-sequence'&&options.execution.distance==='difs-minimum'){
    const errors=difsExecutionErrors(steps,rounds,mode,options.execution);if(errors.length)throw Error(errors.join('; '));
    const orbit=compileDifsOrbit(steps,options.execution,round32,options.fieldMaps);return (point,params,_weights=[],julia=null,threshold=0)=>orbit(point,params,julia,threshold);
  }
  if (options.execution?.kind==='bounded-sequence') return compileKernelCpu(steps,rounds,mode,round32,options.execution);
  if (options.execution) {
    const errors=mappedFieldErrors(steps,rounds,mode,options.execution);
    if(errors.length)throw Error(errors.join('; '));
    return compileMappedFieldCpu(steps,options.execution,round32,options.fieldMaps);
  }
  if (steps.some(step => step.formula.kernel)) return compileKernelCpu(steps, rounds, mode, round32,undefined,options.fieldMaps);
  const carried = new Map<string, "float" | "vec3" | "vec4">();
  const carriedInits: { name: string; init: Fn }[] = [];
  let base = 0;

  const prepared = steps.map((step) => {
    const f = step.formula;
    const paramIndex = new Map(f.parameters.map((p, k) => [p.name, base + k]));
    base += f.parameters.length;
    const resolver =
      (start: boolean) =>
      (name: string): Fn => {
        if (name === "pos") return start ? (env) => env.point : (env) => env.jpos;
        const pi = paramIndex.get(name);
        if (pi !== undefined) return (env) => env.params[pi]!;
        return (env) => {
          const v = env.vars.get(name);
          if (v === undefined) throw new Error(`unknown name "${name}"`);
          return v;
        };
      };
    const locals: { name: string; init: Fn }[] = [];
    for (const v of f.variables) {
      if (f.carry.includes(v.name)) {
        if (!carried.has(v.name)) {
          carried.set(v.name, v.type);
          carriedInits.push({ name: v.name, init: compile(v.init, resolver(true), round32) });
        }
      } else locals.push({ name: v.name, init: compile(v.init, resolver(false), round32) });
    }
    const body = f.steps.map((s) =>
      s.kind === "break_if"
        ? { kind: "break" as const, expr: compile(s.expr, resolver(false), round32) }
        : { kind: "assign" as const, target: s.target, op: s.op, expr: compile(s.expr, resolver(false), round32) },
    );
    const distance = f.distance === undefined ? null : compile(f.distance, resolver(false), round32);
    const orbit = f.orbitPoint !== undefined && f.variables.some((v) => v.name === f.orbitPoint) ? f.orbitPoint : null;
    return { step, locals, body, distance, orbit };
  });

  const r = round32 ? (v: Value): Value => (typeof v === "boolean" ? v : map1(v, Math.fround)) : (v: Value) => v;
  const ops: Record<string, (a: Value, b: Value) => Value> = {
    "=": (_a, b) => b,
    "+=": (a, b) => r(map2(a, b, (x, y) => x + y)),
    "-=": (a, b) => r(map2(a, b, (x, y) => x - y)),
    "*=": (a, b) => r(map2(a, b, (x, y) => x * y)),
    "/=": (a, b) => r(map2(a, b, (x, y) => x / y)),
  };

  return (point, params, weights = [], julia = null) => {
    const p = round32 ? point.map(Math.fround) : [...point];
    const env: Env = { vars: new Map(), params: round32 ? params.map(Math.fround) : params, point: p, jpos: julia ? [...julia] : p };
    for (const c of carriedInits) env.vars.set(c.name, c.init(env));
    let iterations = 0;
    let trap = 1e9;
    let dist = 0;
    let done = false;

    /** Runs one step on env.vars; returns true if its escape condition was met. */
    const run = (st: (typeof prepared)[number]): { broke: boolean; dist: number | null } => {
      for (const l of st.locals) env.vars.set(l.name, l.init(env));
      let broke = false;
      for (let it = 0; it < st.step.iterations; it++) {
        if (st.orbit) trap = Math.min(trap, Math.hypot(...((v) => (isVec(v) ? v : [num(v)]))(env.vars.get(st.orbit)!)));
        let stop = false;
        for (const b of st.body) {
          if (b.kind === "break") {
            if (b.expr(env) === true) {
              stop = true;
              break;
            }
          } else env.vars.set(b.target, ops[b.op]!(env.vars.get(b.target)!, b.expr(env)));
        }
        if (stop) {
          broke = true;
          break;
        }
        iterations += 1;
      }
      return { broke, dist: st.distance ? num(st.distance(env)) : null };
    };

    for (let round = 0; round < rounds; round++) {
      if (mode === "interpolate") {
        if (done) break;
        const input = new Map([...carried.keys()].map((n) => [n, env.vars.get(n)!]));
        const sums = new Map([...carried.entries()].map(([n, t]) => [n, zero(t)]));
        let wsum = 0;
        let dsum = 0;
        let dw = 0;
        let roundDone = false;
        prepared.forEach((st, si) => {
          for (const [n, v] of input) env.vars.set(n, v);
          const out = run(st);
          const w = weights[si] ?? 1;
          for (const n of carried.keys()) sums.set(n, map2(sums.get(n)!, map1(env.vars.get(n)!, (x) => x * w), (a, b) => a + b));
          wsum += w;
          if (out.dist !== null) {
            dsum += w * out.dist;
            dw += w;
          }
          roundDone = roundDone || out.broke;
        });
        for (const n of carried.keys()) env.vars.set(n, wsum > 0 ? map1(sums.get(n)!, (x) => x / Math.max(wsum, 1e-6)) : input.get(n)!);
        if (dw > 0) dist = dsum / dw;
        done = roundDone;
      } else {
        for (const st of prepared) {
          const every = st.step.every ?? 1;
          const start = st.step.start ?? 0;
          const scheduled = mode === "alternate" && (every !== 1 || start !== 0);
          if (done || (scheduled && !(round >= start && (round - start) % every === 0))) continue;
          const out = run(st);
          if (out.broke) done = true;
          if (out.dist !== null) dist = out.dist;
        }
        if (done) break;
      }
    }
    return { dist, iterations, trap: trap < 1e8 ? trap : 0 };
  };
}
