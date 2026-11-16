import {createFieldSampler,FIELD_MAP_WGSL} from '../fieldMaps';
import type {FieldMap} from '../fieldMaps';
import type { ChainMode, ChainResult, ChainStep } from "./chain";
import {
  freshKernelState,
  KERNELS,
  prepareKernel,
  stepKernel,
} from "./kernels";
import type { KernelState, KernelParameters } from "./kernels";
import type { V4 } from "./primitives";
import {
  kernelBody,
  kernelMatrices,
  KERNEL_PRIMITIVES_WGSL,
} from "./kernelWgsl";
import { nearestEven } from "./primitives";
import {boundedSequenceErrors,groupCallOrder} from './groupExecution';
import type {BoundedSequenceExecution} from './groupExecution';
import {blendKernelStates,stateIsFinite,interpolationWgsl} from './kernelInterpolation';

/**
 * MATH-AUDIT 08: the potential estimate log(r)/|grad log r| is the Hubbard-Douady estimate without its factor 1/2 (the lower bound of
 * the Koebe quarter theorem). With only ONE iteration behind it the potential has not converged, and measured against inside points
 * found by search the estimate then exceeds the true distance by up to 2.1 times (BristorBrot at x = 5 on the axis: 1.96). From two
 * iterations on the measured ratio is about 1.1, so the estimate is kept unchanged there and the existing images are not touched.
 * For one iteration the factor 1/2 is applied. Mixed fold and numeric chains stay a heuristic (see docs/formulas/MATH_AUDIT_08.md).
 */
export const NUMERIC_FAR_FIELD = "0.5";
export const NUMERIC_FAR_FIELD_FACTOR = (count: number): number => (count <= 1 ? 0.5 : 1);

function mainIndex(steps: readonly ChainStep[]): number {
  return steps.findIndex(
    (s) => s.formula.kernel && !KERNELS[s.formula.kernel].role,
  );
}

function scheduledMain(
  steps: readonly ChainStep[],
  rounds: number,
  mode: ChainMode,
): boolean {
  // A dIFS transform has no field: the final active transform must be followed
  // by a scheduled shape, including across rounds. Never manufacture a DE.
  let lastDifsTransform = -1,
    lastShape = -1,
    call = 0;
  for (let round = 0; round < rounds; round++)
    for (const step of steps) {
      if (!scheduled(step, round, mode)) continue;
      const kernel = KERNELS[step.formula.kernel!];
      if (kernel.role === "difs-transform") lastDifsTransform = call;
      else if (!kernel.role && kernel.method === "difs") lastShape = call;
      call++;
    }
  if (lastDifsTransform >= 0 && lastShape < lastDifsTransform) return false;
  return steps.some(
    (s) =>
      !KERNELS[s.formula.kernel!].role &&
      Array.from({ length: rounds }, (_, round) =>
        scheduled(s, round, mode),
      ).some(Boolean),
  );
}

/**
 * The distance model of a chain. Counted formulas of one family keep that family's estimator unchanged. Counted formulas
 * of different families (for example an analytic box fold and a numeric bulb) fall back to the numeric estimator, the
 * gradient of the escape potential, as Mandelbulb 3D does when its analytic estimators cannot be combined. dIFS shapes
 * have no radius and are never mixed with the others.
 */
export function effectiveMethod(steps: readonly ChainStep[]): "analytic" | "ifs" | "numeric" | "difs" {
  const methods = new Set(steps.filter((s) => s.formula.kernel && !KERNELS[s.formula.kernel].role).map((s) => KERNELS[s.formula.kernel!].method));
  return methods.size === 1 ? ([...methods][0] as "analytic" | "ifs" | "numeric" | "difs") : "numeric";
}
/** Info of the main formula with the chain's effective distance model. */
function chainInfo(steps: readonly ChainStep[], main: number, execution?: unknown) {
  // Grouped executions keep the main formula's own estimator exactly as before.
  const info = KERNELS[steps[main]!.formula.kernel!];
  return execution ? { ...info } : { ...info, method: effectiveMethod(steps) };
}

/** Rejects only what has no defined estimator: other dimensions, or dIFS shapes mixed with ordinary fractals. */
export function kernelChainErrors(
  steps: readonly ChainStep[],
  mode: ChainMode,
): string[] {
  if (steps.some((s) => !s.formula.kernel))
    return [
      "Registered formula kernels can so far only be chained with other registered kernels.",
    ];
  const main = mainIndex(steps);
  if (main < 0)
    return [
      "A chain with helper calls needs at least one compatible counted main formula.",
    ];
  const first = chainInfo(steps, main);
  const difsCount = steps.filter((s) => !KERNELS[s.formula.kernel!].role && KERNELS[s.formula.kernel!].method === "difs").length;
  const counted = steps.filter((s) => !KERNELS[s.formula.kernel!].role).length;
  // Each refusal names its real cause, so an artist can see whether to change the formula, the order or the estimator.
  if (difsCount > 0 && difsCount < counted)
    return ["dIFS shapes have no radius and cannot be mixed with ordinary fractals in an ordinary chain. Use a group execution (analytic group + dIFS group)."];
  const others = steps.filter((s) => !KERNELS[s.formula.kernel!].role && KERNELS[s.formula.kernel!].dimension !== first.dimension);
  if (others.length)
    return ["The chain mixes 3D and 4D formulas. The fourth component w means different things in them (derivative and coordinate respectively), so there is no common distance model."];
  // MATH-AUDIT 08: the numeric fallback (gradient of log of the escape radius) is the estimator for orbits that grow faster than any
  // fixed factor per step. An IFS formula (folds and one fixed scale) grows only linearly, so the logarithm of its radius is the wrong
  // potential: the estimate exceeds the true distance by 3 to 12 times (measured against inside points found by search) and a ray steps
  // through the object. No safe estimator exists for such a mixture, so it is refused instead of approximated. A grouped execution
  // keeps the main formula's own estimator and is the way to combine them.
  const counted4method = new Set(steps.filter((s) => !KERNELS[s.formula.kernel!].role).map((s) => KERNELS[s.formula.kernel!].method));
  if (counted4method.size > 1 && counted4method.has("ifs"))
    return ["The chain mixes IFS formulas (folding and a fixed scale, linear growth) with formulas of another distance model. Then there is no safe distance estimate: the numeric estimate overestimates the distance several times and the ray passes through the surface. Use a group execution where the main formula states the distance model, or keep the chain to one distance model."];
  for (const s of steps) {
    const info = KERNELS[s.formula.kernel!];
    if (!info.role) continue;
    if (info.dimension > first.dimension)
      return [`The transform ${s.formula.name} gives a 4D point and can only stand before 4D formulas.`];
    if (!(info.helperMethods ?? ["numeric"]).includes(first.method))
      return [`The transform ${s.formula.name} bends space and only suits numeric main formulas: for ${first.method === "analytic" ? "an analytic" : "a " + first.method} distance model the distance becomes wrong. Change the main formula or remove the transform.`];
  }
  if (mode === "interpolate") {
    // Blending needs a radius, so fields of dIFS shapes (which have none) cannot be interpolated.
    if (steps.length > 8) return ["Interpolation takes at most 8 steps."];
    if (steps.some((s) => KERNELS[s.formula.kernel!].method === "difs" || KERNELS[s.formula.kernel!].role === "difs-transform"))
      return ["Interpolation of dIFS shapes is not supported. Use a group execution or a sequence."];
    // MATH-AUDIT 08: blending IFS formulas mixes affine maps that contract toward different fixed points. Even with the renormalisation
    // accounted for in the derivative the estimate stayed up to 13 times above the true distance (measured), and no bound can be proven for
    // such a blend, so it is refused. Analytic (ABox-type) formulas can be interpolated: there the same accounting removes the overestimate.
    if (steps.filter((s) => !KERNELS[s.formula.kernel!].role && KERNELS[s.formula.kernel!].method === "ifs").length >= 1 && steps.filter((s) => !KERNELS[s.formula.kernel!].role).length >= 2)
      return ["Interpolation of IFS formulas is not supported: weighted foldings with different fixed points give no safe distance estimate. Use a sequence, alternation or a group execution."];
  }
  return [];
}

function scheduled(step: ChainStep, round: number, mode: ChainMode): boolean {
  return (
    mode !== "alternate" ||
    (round >= (step.start ?? 0) &&
      (round - (step.start ?? 0)) % (step.every ?? 1) === 0)
  );
}

export interface KernelOrbitResult {
  state: KernelState;
  trap: number;
  escaped: boolean;
}
/** Exposed for mathematical tests and integrations that need diagnostics, without a renderer. */
export function compileKernelOrbit(
  steps: readonly ChainStep[],
  rounds: number,
  mode: ChainMode = "sequence",
  round32 = false,
  execution?:BoundedSequenceExecution,
  fieldMaps:readonly FieldMap[]=[],
) {
  const errors = execution ? boundedSequenceErrors(steps,rounds,mode,execution) : kernelChainErrors(steps, mode);
  if (errors.length) throw new Error(errors.join("; "));
  if (!scheduledMain(steps, rounds, mode))
    throw new Error(
      "The schedule lacks a counted main formula call or a shape after the last dIFS transform.",
    );
  const main = mainIndex(steps),
    info = chainInfo(steps, main, execution);
  const planned=execution?groupCallOrder(steps,execution.groups[0]!):null;
  // Rotation coefficients depend only on parameters, never on a point or its
  // perturbations. Keep them per compiled evaluator and rebuild on value changes.
  const sampler=createFieldSampler(fieldMaps);
  let previousParameters: number[] = [];
  let prepared: ReturnType<typeof prepareKernel>[] = [];
  return (
    point: readonly number[],
    params: readonly number[],
    julia: readonly number[] | null = null,
    limit = Infinity,
    weights: readonly number[] = [],
  ): KernelOrbitResult => {
    if (
      prepared.length === 0 ||
      params.length !== previousParameters.length ||
      params.some((v, i) => v !== previousParameters[i])
    ) {
      let offset = 0;
      prepared = steps.map((step) => {
        const p: KernelParameters = {};
        for (const parameter of step.formula.parameters)
          p[parameter.name] = round32
            ? Math.fround(params[offset++]!)
            : params[offset++]!;
        return prepareKernel(step.formula.kernel!, p,sampler);
      });
      previousParameters = [...params];
    }
    const r = round32 ? Math.fround : (v: number) => v;
    const p = point.map(r);
    const state = freshKernelState(
      [
        p[0]!,
        p[1]!,
        p[2]!,
        execution || info.wMode === "derivative" ? 1 : r(prepared[main]!.p.slice_w ?? 0),
      ],
      [
        ...(julia ?? p).slice(0, 3),
        r(
          julia
            ? (prepared[main]!.p.constant_w??0)
            : (prepared[main]!.p.slice_w ?? 0),
        ),
      ] as V4,
      info.dimension,
    );
    if (mode === "interpolate" && !execution) {
      // Every round: all steps start from the same state, run their own iterations, and the results are blended.
      let blendedEscape = false;
      for (let round = 0; round < rounds; round++) {
        if (state.count >= limit) break;
        const outs: KernelState[] = [],
          w: number[] = [];
        for (let si = 0; si < steps.length; si++) {
          const weight = Math.max(0, weights[si] ?? 1);
          if (weight <= 0) continue;
          const trial = structuredClone(state) as KernelState;
          for (let it = 0; it < steps[si]!.iterations && !trial.invalid; it++) {
            stepKernel(prepared[si]!, trial);
            if (round32) {
              trial.v = trial.v.map(r) as V4;
              trial.c = trial.c.map(r) as V4;
              trial.derivative = r(trial.derivative);
              trial.varyScale = r(trial.varyScale);
            }
            if (!stateIsFinite(trial)) trial.invalid = true;
          }
          if (trial.invalid) {
            state.invalid = true;
            return { state, trap: Math.sqrt(state.trap), escaped: false };
          }
          outs.push(trial);
          w.push(weight);
        }
        blendKernelStates(state, outs, w, r, { dimension: info.dimension, derivativeW: info.wMode === "derivative" });
        if (!stateIsFinite(state)) {
          state.invalid = true;
          break;
        }
        state.count++;
        state.radiusSquared = r(state.v.slice(0, info.dimension).reduce((sum, a) => r(sum + r(a * a)), 0));
        state.trap = Math.min(state.trap, state.radiusSquared);
        if (!Number.isFinite(limit) && state.radiusSquared > prepared[main]!.p.bailout_squared!) {
          blendedEscape = true;
          break;
        }
      }
      return { state, trap: Math.sqrt(state.trap), escaped: blendedEscape };
    }
    let escaped = false;
    orbit: for (let round = 0; round < rounds; round++)
      for (let call = 0; call < (planned?.length??steps.length); call++) {
        const si=planned?.[call]??call;
        const step = steps[si]!;
        if (!scheduled(step, round, mode)) continue;
        for (let it = 0; it < (planned?1:step.iterations); it++) {
          if (state.count >= limit) break orbit;
          // Some existing IFS kernels keep their analytic accumulator separately.
          // Bridge only for this explicit shared-w execution; ordinary chains are unchanged.
          const separateW=!!execution&&KERNELS[step.formula.kernel!].wMode===undefined;
          if(separateW)state.derivative=state.v[3];
          stepKernel(prepared[si]!, state);
          if(separateW)state.v[3]=state.derivative;
          if (state.invalid) break orbit;
          if (round32) {
            state.v = state.v.map(r) as V4;
            state.c = state.c.map(r) as V4;
            state.history = state.history.map(r) as V4;
            state.derivative = r(state.derivative);
            state.fieldValue = r(state.fieldValue);
            state.varyScale = r(state.varyScale);
            state.free = state.free.map(r) as [number, number];
            state.extraDerivatives = state.extraDerivatives.map(r) as [
              number,
              number,
            ];
          }
          if (
            ![
              ...state.v,
              ...state.c,
              ...state.history,
              state.derivative,
              state.fieldValue,
              state.varyScale,
              ...state.free,
              ...state.extraDerivatives,
            ].every(Number.isFinite)
          ) {
            state.invalid = true;
            break orbit;
          }
          if (KERNELS[step.formula.kernel!].role) continue;
          state.count++;
          if (info.method === "difs") {
            if (state.varyScale === 0) {
              state.invalid = true;
              break orbit;
            }
            const d = r(state.fieldValue / state.varyScale);
            if (!Number.isFinite(d)) {
              state.invalid = true;
              break orbit;
            }
            if (d < state.bestDistance) {
              state.bestDistance = d;
              state.bestIteration = state.count;
              if (
                nearestEven(prepared[si]!.p.inside_render!) === 0 &&
                d < prepared[si]!.p.de_stop!
              )
                break orbit;
            }
            continue;
          }
          state.radiusSquared = r(
            state.v
              .slice(0, info.dimension)
              .reduce((sum, a) => r(sum + r(a * a)), 0),
          );
          if (!Number.isFinite(state.radiusSquared)) {
            state.invalid = true;
            break orbit;
          }
          state.trap = Math.min(state.trap, state.radiusSquared);
          if (
            !Number.isFinite(limit) &&
            (execution ? state.radiusSquared >= prepared[si]!.p.bailout_squared! : state.radiusSquared > prepared[si]!.p.bailout_squared!)
          ) {
            escaped = true;
            break orbit;
          }
        }
      }
    return {
      state,
      trap:
        info.method === "difs"
          ? Math.abs(state.bestDistance)
          : Math.sqrt(state.trap),
      escaped,
    };
  };
}

export function compileKernelCpu(
  steps: readonly ChainStep[],
  rounds: number,
  mode: ChainMode,
  round32: boolean,
  execution?:BoundedSequenceExecution,
  fieldMaps:readonly FieldMap[]=[],
) {
  const orbit = compileKernelOrbit(steps, rounds, mode, round32,execution,fieldMaps);
  const method = execution ? KERNELS[steps[mainIndex(steps)]!.formula.kernel!].method : effectiveMethod(steps);
  return (
    point: readonly number[],
    params: readonly number[],
    weights: readonly number[] = [],
    julia: readonly number[] | null = null,
  ) => {
    const base = orbit(point, params, julia, Infinity, weights);
    const result = (dist: number, invalid = false) => ({
      dist,
      iterations: base.state.count,
      trap: base.trap,
      invalid,
    });
    if (base.state.invalid) return result(Infinity, true);
    if (method === "analytic") {
      const info = KERNELS[steps[mainIndex(steps)]!.formula.kernel!];
      const derivative =
        execution || info.wMode === "derivative" ? base.state.v[3] : base.state.derivative;
      // A zero derivative is an undefined estimator even for an unescaped orbit.
      if (derivative === 0) return result(Infinity, true);
    }
    if (method === "difs")
      return {
        ...result(base.state.bestDistance),
        iterations: base.state.bestIteration,
      };
    if (!base.escaped&&!execution) return result(0);
    if (method === "ifs" || method === "analytic") {
      const info = KERNELS[steps[mainIndex(steps)]!.formula.kernel!];
      const d = Math.abs(
        execution || info.wMode === "derivative" ? base.state.v[3] : base.state.derivative,
      );
      return d > 0
        ? result(Math.sqrt(base.state.radiusSquared) / d)
        : result(Infinity, true);
    }
    // Gradient of the escape potential on the rendered 3D slice. Every perturbation
    // starts fresh and runs exactly the primary orbit's call count and schedule.
    const epsilon = 1e-4 * Math.max(1, Math.hypot(...point));
    const gradient: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      const plus = [...point],
        minus = [...point];
      plus[axis]! += epsilon;
      minus[axis]! -= epsilon;
      const a = orbit(plus, params, julia, base.state.count, weights),
        b = orbit(minus, params, julia, base.state.count, weights);
      if (
        a.state.invalid ||
        b.state.invalid ||
        !(a.state.radiusSquared > 0 && b.state.radiusSquared > 0)
      )
        return result(Infinity, true);
      gradient.push(
        (Math.log(a.state.radiusSquared) - Math.log(b.state.radiusSquared)) /
          (4 * epsilon),
      );
    }
    const norm = Math.hypot(...gradient);
    return norm > 0 && Number.isFinite(norm)
      ? result((NUMERIC_FAR_FIELD_FACTOR(base.state.count) * 0.5 * Math.log(base.state.radiusSquared)) / norm)
      : result(Infinity, true);
  };
}

/**
 * The "iterations" scale of a kernel chain: how many counted iterations a point can get. Helper (transform) steps do not count; interpolation counts rounds.
 * Also what a chain compiled with dynamic loops is sent at run time, so the colour measure is the same as with compiled-in counts.
 */
export function kernelChainTotalIterations(steps: readonly ChainStep[], rounds: number, mode: ChainMode): number {
  if (mode === "interpolate") return Math.max(1, rounds);
  let total = 0;
  for (const step of steps) {
    if (KERNELS[step.formula.kernel!].role) continue;
    for (let round = 0; round < rounds; round++) if (scheduled(step, round, mode)) total += step.iterations;
  }
  return Math.max(1, total);
}

export function generateKernelChain(
  steps: readonly ChainStep[],
  rounds: number,
  mode: ChainMode,
  execution?:BoundedSequenceExecution,
  /** SHADER-UNIFORMS-08: read rounds and iteration counts from the uniform buffer instead of compiling them in (never with a grouped execution). */
  dynamicLoops = false,
): ChainResult {
  const dynamic = dynamicLoops && !execution && steps.length <= 8;
  const countOf = (i: number, n: number): string => (dynamic ? `sc${i}` : `${n}`);
  const errors = execution ? boundedSequenceErrors(steps,rounds,mode,execution) : kernelChainErrors(steps, mode);
  if (errors.length) return { ok: false, errors };
  if (!scheduledMain(steps, rounds, mode))
    return {
      ok: false,
      errors: [
        "The schedule lacks a counted main formula call or a shape after the last dIFS transform.",
      ],
    };
  const main = mainIndex(steps),
    info = chainInfo(steps, main, execution);
  let offset = 0,
    totalIterations = 0;
  const matrices: { name: string; type: string }[] = [];
  const matrixDeclarations: string[] = [];
  const IW = interpolationWgsl(info.dimension, info.wMode === "derivative");
  const interpolateBlocks: string[] = [];
  const bailoutOf: ((name: string) => string)[] = [];
  const blocks = steps.map((step, i) => {
    const indices = new Map(
      step.formula.parameters.map((p, k) => [p.name, offset + k]),
    );
    offset += step.formula.parameters.length;
    const p = (name: string) => {
      const index = indices.get(name)!;
      return `u.params[${Math.floor(index / 4)}].${"xyzw"[index % 4]}`;
    };
    bailoutOf.push(p);
    const matrix = kernelMatrices(step.formula.kernel!, p, `km${i}`);
    const helper = !!KERNELS[step.formula.kernel!].role;
    matrices.push(...matrix.args);
    matrixDeclarations.push(...matrix.declarations);
    const when =
      mode === "alternate"
        ? `orbitRound>=${step.start ?? 0} && (orbitRound-${step.start ?? 0})%${step.every ?? 1}==0`
        : "true";
    for (let round = 0; round < rounds; round++)
      if (!helper && scheduled(step, round, mode))
        totalIterations += step.iterations;
    if (mode === "interpolate") {
      interpolateBlocks.push(`{s=start;for(var it=0;it<${countOf(i, step.iterations)};it++) {
      {${kernelBody(step.formula.kernel!, p, matrix.args.map((a) => a.name))}}
      if(s.invalid || !kernelFinite(s.v.x) || !kernelFinite(s.v.y) || !kernelFinite(s.v.z) || !kernelFinite(s.v.w) || !kernelFinite(s.c.x) || !kernelFinite(s.c.y) || !kernelFinite(s.c.z) || !kernelFinite(s.c.w) || !kernelFinite(s.derivative) || !kernelFinite(s.varyScale) || !kernelFinite(s.free.x) || !kernelFinite(s.free.y)) {s.invalid=true;break;}
      }if(s.invalid) {return s;}
      ${IW.accumulate(`u.chainw[${Math.floor(i / 4)}].${"xyzw"[i % 4]}`)}}`);
    }
    return `if(${when}) {for(var it=0;it<${execution?1:countOf(i, step.iterations)};it++) {
      if(limit>=0 && i32(s.count)>=limit) {return s;}
      ${execution&&KERNELS[step.formula.kernel!].wMode===undefined?"s.derivative=s.v.w;":""}
      {${kernelBody(
        step.formula.kernel!,
        p,
        matrix.args.map((a) => a.name),
      )}}
      ${execution&&KERNELS[step.formula.kernel!].wMode===undefined?"s.v.w=s.derivative;":""}
      if(s.invalid || !kernelFinite(s.v.x) || !kernelFinite(s.v.y) || !kernelFinite(s.v.z) || !kernelFinite(s.v.w) || !kernelFinite(s.c.x) || !kernelFinite(s.c.y) || !kernelFinite(s.c.z) || !kernelFinite(s.c.w) || !kernelFinite(s.derivative) || !kernelFinite(s.field) || !kernelFinite(s.varyScale) || !kernelFinite(s.free.x) || !kernelFinite(s.free.y)) {s.invalid=true;break;}
      ${
        helper
          ? ""
          : info.method === "difs"
            ? `s.count+=1.0;
      if(!kernelFinite(s.v.x) || !kernelFinite(s.v.y) || !kernelFinite(s.v.z) || !kernelFinite(s.v.w) || !kernelFinite(s.field) || !kernelFinite(s.varyScale) || s.varyScale==0.0) {s.invalid=true;break;}
      let d=s.field/s.varyScale;if(!kernelFinite(d)) {s.invalid=true;break;}
      if(d<s.bestDistance) {s.bestDistance=d;s.bestIteration=s.count;if(round(${p("inside_render")})==0.0 && d<${p("de_stop")}) {return s;}}
      `
            : `s.count+=1.0;s.rho=kernelRadius(s.v,${info.dimension});
      if(!kernelFinite(s.v.x) || !kernelFinite(s.v.y) || !kernelFinite(s.v.z) || !kernelFinite(s.v.w) || !kernelFinite(s.derivative) || !kernelFinite(s.rho)) {s.invalid=true;break;}
      s.trap=min(s.trap,s.rho);
      if(limit<0 && s.rho${execution?">=":">"}${p("bailout_squared")}) {s.escaped=true;break;}
      `
      }
    }}if(s.invalid || s.escaped) {return s;}`;
  });
  totalIterations = Math.max(1, totalIterations);
  if (mode === "interpolate") totalIterations = Math.max(1, rounds);
  const planned=execution?groupCallOrder(steps,execution.groups[0]!):null;
  if(planned)totalIterations=planned.length;
  const plannedBody=planned ? `let calls=array<i32,${planned.length}>(${planned.join(',')});
    for(var call=0;call<${planned.length};call++){switch calls[call]{${blocks.map((b,i)=>`case ${i}:{${b}}`).join('\n')}default:{s.invalid=true;return s;}}}` : mode === "interpolate" ? `if(limit>=0 && i32(s.count)>=limit) {return s;}
    let start=s;${IW.declarations}
    ${interpolateBlocks.join('\n')}
    ${IW.finish}
    s.count+=1.0;s.rho=kernelRadius(s.v,${info.dimension});
    if(!kernelFinite(s.v.x) || !kernelFinite(s.v.y) || !kernelFinite(s.v.z) || !kernelFinite(s.v.w) || !kernelFinite(s.derivative) || !kernelFinite(s.rho)) {s.invalid=true;return s;}
    s.trap=min(s.trap,s.rho);
    if(limit<0 && s.rho>${bailoutOf[main]!("bailout_squared")}) {s.escaped=true;return s;}` : blocks.join('\n');
  const firstParameters = steps[main]!.formula.parameters;
  const initialOffset = steps
    .slice(0, main)
    .reduce((sum, s) => sum + s.formula.parameters.length, 0);
  const initial = (name: string) => {
    if (!firstParameters.some((p) => p.name === name)) return "0.0";
    const index =
      initialOffset + firstParameters.findIndex((p) => p.name === name);
    return `u.params[${Math.floor(index / 4)}].${"xyzw"[index % 4]}`;
  };
  const signature = matrices.map((m) => `, ${m.name}: ${m.type}`).join("");
  const args = matrices.map((m) => `, ${m.name}`).join("");
  const distance =
    info.method === "difs"
      ? `return vec3f(base.bestDistance,base.bestIteration,abs(base.bestDistance));`
      : info.method === "ifs" || info.method === "analytic"
        ? `let denominator=abs(${execution || info.wMode === "derivative" ? "base.v.w" : "base.derivative"});if(!(denominator>0.0)) {return vec3f(1e20,base.count,sqrt(base.trap));}return vec3f(sqrt(base.rho)/denominator,base.count,sqrt(base.trap));`
        : `
    let epsilon=1e-4*max(1.0,length(pos));var gradient=vec3f(0.0);
    for(var axis=0;axis<3;axis++) {
      var delta=vec3f(0.0);delta[axis]=epsilon;
      let a=kernelOrbit(pos+delta,i32(base.count)${args});let b=kernelOrbit(pos-delta,i32(base.count)${args});
      if(a.invalid || b.invalid || !(a.rho>0.0) || !(b.rho>0.0)) {return vec3f(1e20,base.count,sqrt(base.trap));}
      gradient[axis]=(log(a.rho)-log(b.rho))/(4.0*epsilon);
    }
    let norm=length(gradient);if(!(norm>0.0) || !kernelFinite(norm)) {return vec3f(1e20,base.count,sqrt(base.trap));}
    return vec3f(select(1.0,${NUMERIC_FAR_FIELD},base.count<=1.0)*0.5*log(base.rho)/norm,base.count,sqrt(base.trap));`;
  return {
    ok: true,
    totalIterations,
    wgsl: `${KERNEL_PRIMITIVES_WGSL}
${steps.some(s=>KERNELS[s.formula.kernel!].fieldMapParameter)?FIELD_MAP_WGSL:""}
const FORMULA_ITERATIONS : f32 = ${totalIterations}.0;
fn kernelOrbit(pos: vec3f, limit: i32${signature}) -> KernelOrbit {
  var s: KernelOrbit;
  s.v=vec4f(pos,${execution || info.wMode === "derivative" ? "1.0" : initial("slice_w")});s.c=select(vec4f(pos,${initial("slice_w")}),vec4f(u.julia.xyz,${initial("constant_w")}),u.julia.w>0.5);
  s.history=vec4f(0.0);s.derivative=1.0;s.count=0.0;s.rho=kernelRadius(s.v,${info.dimension});s.trap=s.rho;s.first=false;s.invalid=false;s.escaped=false;
  s.field=0.0;s.varyScale=1.0;s.bestDistance=65535.0;s.bestIteration=0.0;
  s.original=pos;s.firstIteration=0.0;s.temporary=0.0;s.free=vec2f(0.0);s.extraDerivatives=vec2f(0.0);
  ${dynamic ? `let loopRounds=select(${rounds},i32(u.loops[0].x),u.loops[0].x>0.5);${steps.map((st, i) => `let sc${i}=select(${st.iterations},i32(u.loops[${1 + Math.floor(i / 4)}].${"xyzw"[i % 4]}),u.loops[${1 + Math.floor(i / 4)}].${"xyzw"[i % 4]}>0.5);`).join("")}` : ""}
  for(var orbitRound=0;orbitRound<${dynamic ? "loopRounds" : rounds};orbitRound++) {${plannedBody}}
  return s;
}
fn formulaCore(pos : vec3f) -> vec3f {
  ${matrixDeclarations.join("\n")}
  let base=kernelOrbit(pos,-1${args});
  if(base.invalid) {return vec3f(1e20,base.count,sqrt(max(0.0,base.trap)));}
  ${info.method === "analytic" ? `if(${execution || info.wMode === "derivative" ? "base.v.w" : "base.derivative"}==0.0) {return vec3f(1e20,base.count,sqrt(max(0.0,base.trap)));}` : ""}
  ${info.method === "difs" || execution ? "" : "if(!base.escaped) {return vec3f(0.0,base.count,sqrt(base.trap));}"}
  ${distance}
}
fn formulaDistance(pos : vec3f) -> f32 { return formulaCore(pos).x; }
`,
  };
}
