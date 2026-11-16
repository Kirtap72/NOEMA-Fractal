import {bridgeExecutionSteps} from './importedHelper';
import {difsExecutionErrors} from './difsExecution';
import {independentFieldErrors} from './independentField';
import {createFieldSampler,FIELD_MAP_WGSL} from '../fieldMaps';
import type {FieldMap} from '../fieldMaps';
/** Bounded groups with an initial prefix and a repeat suffix. Independent of any file format. */
import type { ChainMode, ChainStep, ChainResult } from "./chain";
import {
  KERNELS,
  freshKernelState,
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

export interface ChainGroup {
  start: number;
  end: number;
  repeat: number;
  maxIterations: number;
}
export interface MappedFieldExecution {
  kind: "mapped-field";
  /** First group maps the point and analytic w; second evaluates a signed dIFS field on that result. */
  groups: [ChainGroup, ChainGroup];
  /** dIFS stops on a new minimum below the caller's distance-query threshold. */
  fieldStop: "query";
  /** Opt-in winning shape's OTrap output. Omitted retains legacy distance coloring. */
  coloring?: "field-otrap";
}
export interface BoundedSequenceExecution {
  kind: 'bounded-sequence';
  groups: ChainGroup[];
  /** Explicit common estimator for 3D analytic/IFS w chains; never infer from display names. */
  distance: 'radius-over-w'|'difs-minimum';
  /** Interior queries require the complete shape minimum, without outside early exit. */
  fieldStop?: 'all';
}
/**
 * How the two independently evaluated distances A (first group) and B (second group's dIFS field) are combined.
 * Constructive-solid-geometry reading: min = union, max = intersection, max-inverted-second = A minus the second shape,
 * smooth-min* = union with a rounded seam of width `smooth` (world units).
 */
export const INDEPENDENT_OPERATIONS = ['max-inverted-second', 'min', 'max', 'smooth-min', 'smooth-min-cubic'] as const;
export type IndependentOperation = (typeof INDEPENDENT_OPERATIONS)[number];
export const isSmoothOperation = (o: string) => o === 'smooth-min' || o === 'smooth-min-cubic';
export interface IndependentFieldExecution {
  kind:'independent-field';
  operation:IndependentOperation;
  /** Seam width for the smooth operations only (greater than 0, at most 10). */
  smooth?:number;
  groups:[ChainGroup,ChainGroup];
}
/**
 * Combines the two distances. The result never drops below a quarter of the hit threshold (the same floor the first
 * group has always had), so a negative dIFS value cannot give the ray marcher a negative step.
 * Smooth minima are the standard polynomial blends (quadratic: min - h^2/(4k); cubic: min - h^3 k/6, with h from the
 * gap |A-B| inside the seam). Both stay at or below min(A,B), so the estimate stays safe for marching.
 */
export function combineIndependentDistances(e: Pick<IndependentFieldExecution, 'operation' | 'smooth'>, a: number, b: number, threshold: number, r: (n: number) => number = (n) => n): { distance: number; second: boolean } {
  const floor = r(threshold * 0.25), k = e.smooth ?? 0.1, gap = Math.abs(a - b), seam = Math.max(k - gap, 0);
  switch (e.operation) {
    case 'min': return { distance: r(Math.max(floor, Math.min(a, b))), second: b < a };
    case 'max': return { distance: r(Math.max(a, b)), second: b > a };
    case 'smooth-min': return { distance: r(Math.max(floor, Math.min(a, b) - (seam * seam) / (4 * k))), second: b < a };
    case 'smooth-min-cubic': { const h = seam / k; return { distance: r(Math.max(floor, Math.min(a, b) - (h * h * h * k) / 6)), second: b < a }; }
    default: { const inverted = r(2 * threshold - b); return { distance: r(Math.max(a, inverted)), second: inverted > a }; }
  }
}
/** WGSL twin of combineIndependentDistances: defines `distance` and `secondWins` from `primaryDistance`, `s.bestDistance` and `threshold`. */
export function independentCombineWgsl(e: Pick<IndependentFieldExecution, 'operation' | 'smooth'>): string {
  const k = (e.smooth ?? 0.1).toFixed(6), floor = 'threshold*0.25', a = 'primaryDistance', b = 's.bestDistance';
  switch (e.operation) {
    case 'min': return `let distance=max(${floor},min(${a},${b}));let secondWins=${b}<${a};`;
    case 'max': return `let distance=max(${a},${b});let secondWins=${b}>${a};`;
    case 'smooth-min': return `let seam=max(${k}-abs(${a}-${b}),0.0);let distance=max(${floor},min(${a},${b})-seam*seam/(4.0*${k}));let secondWins=${b}<${a};`;
    case 'smooth-min-cubic': return `let seam=max(${k}-abs(${a}-${b}),0.0)/${k};let distance=max(${floor},min(${a},${b})-seam*seam*seam*${k}/6.0);let secondWins=${b}<${a};`;
    default: return `let inverted=2.0*threshold-${b};let distance=max(${a},inverted);let secondWins=inverted>${a};`;
  }
}
export type ChainExecution=MappedFieldExecution|BoundedSequenceExecution|IndependentFieldExecution;
export function groupExecutionErrors(
  execution: unknown,
  stepCount: number,
): string[] {
  if (!execution || typeof execution !== "object")
    return ["execution must be an object"];
  const e = execution as ChainExecution,
    errors: string[] = [];
  if (Object.keys(e).some((k) => !(e.kind==='bounded-sequence' ? ['kind','groups','distance','fieldStop'] : e.kind==='independent-field'?['kind','groups','operation','smooth']:["kind", "groups", "fieldStop", "coloring"]).includes(k)))
    errors.push("unknown execution field");
  if(e.kind==='mapped-field'&&e.coloring!==undefined&&e.coloring!=='field-otrap')errors.push('unknown mapped field coloring');
  if(e.kind==='independent-field'&&(e.smooth!==undefined?!isSmoothOperation(e.operation)||typeof e.smooth!=='number'||!(e.smooth>0)||e.smooth>10:isSmoothOperation(e.operation)))
    errors.push('smooth seam width (greater than 0, at most 10) is required for, and only allowed with, the smooth operations');
  if(e.kind==='bounded-sequence'&&e.fieldStop!==undefined&&(e.fieldStop!=='all'||e.distance!=='difs-minimum'))errors.push('all stopping requires a dIFS minimum');
  if (
    !['mapped-field','bounded-sequence','independent-field'].includes(e.kind) ||
    (e.kind==='mapped-field' ? e.fieldStop !== "query" : e.kind==='independent-field'?!(INDEPENDENT_OPERATIONS as readonly string[]).includes(e.operation):!['radius-over-w','difs-minimum'].includes(e.distance)) ||
    !Array.isArray(e.groups) ||
    e.groups.length !== (e.kind==='bounded-sequence'?1:2)
  )
    return ["execution requires mapped-field, query stopping and two groups"];
  for (const g of e.groups) {
    if (
      !g ||
      ![g.start, g.end, g.repeat, g.maxIterations].every(Number.isInteger) ||
      g.start < 0 ||
      g.end < g.start ||
      g.end >= stepCount ||
      g.repeat < g.start ||
      g.repeat > g.end ||
      g.maxIterations < 1 ||
      g.maxIterations > 256
    )
      errors.push("invalid group range, repeat suffix or iteration limit");
    else if (
      Object.keys(g).some(
        (k) => !["start", "end", "repeat", "maxIterations"].includes(k),
      )
    )
      errors.push("unknown group field");
  }
  if (
    !errors.length &&
    (e.groups[0]!.start !== 0 ||
      (e.kind!=='bounded-sequence' && e.groups[0].end + 1 !== e.groups[1].start) ||
      e.groups.at(-1)!.end !== stepCount - 1)
  )
    errors.push("groups must cover the chain in order without gaps or overlap");
  if (!errors.length && e.groups.reduce((n, g) => n + g.maxIterations, 0) > 256)
    errors.push("group iteration budget exceeds 256");
  return errors;
}
export function boundedSequenceErrors(steps:readonly ChainStep[],rounds:number,mode:ChainMode,e:BoundedSequenceExecution):string[]{
  if(e.distance==='difs-minimum')return difsExecutionErrors(steps,rounds,mode,e);
  const errors=groupExecutionErrors(e,steps.length);
  if(rounds!==1||mode!=='sequence'||steps.some(s=>(s.every??1)!==1||(s.start??0)!==0))errors.push('bounded execution cannot combine with rounds/schedules');
  if(steps.some(s=>!s.formula.kernel||KERNELS[s.formula.kernel].dimension!==3||
    (KERNELS[s.formula.kernel].wMode!=='derivative'&&!(KERNELS[s.formula.kernel].method==='ifs'&&KERNELS[s.formula.kernel].wMode===undefined))||!['analytic','ifs'].includes(KERNELS[s.formula.kernel].method)||
    ![2,11].includes(KERNELS[s.formula.kernel].hints.deoption)||KERNELS[s.formula.kernel].role))
    errors.push('radius-over-w execution requires counted 3D analytic/IFS derivative kernels');
  return errors;
}
export function chainExecutionErrors(stepsIn:readonly ChainStep[],rounds:number,mode:ChainMode,e:ChainExecution):string[]{
  const steps=bridgeExecutionSteps(stepsIn,e);
  if(e.kind==='independent-field')return independentFieldErrors(steps,rounds,mode,e);
  return e.kind==='mapped-field'?mappedFieldErrors(steps,rounds,mode,e):boundedSequenceErrors(steps,rounds,mode,e);
}
export function mappedFieldErrors(
  steps: readonly ChainStep[],
  rounds: number,
  mode: ChainMode,
  e: MappedFieldExecution,
): string[] {
  const errors = groupExecutionErrors(e, steps.length);
  if (errors.length) return errors;
  if (
    rounds !== 1 ||
    mode !== "sequence" ||
    steps.some((s) => (s.every ?? 1) !== 1 || (s.start ?? 0) !== 0)
  )
    errors.push(
      "group execution cannot be combined with rounds or a round schedule",
    );
  for (const [index, g] of e.groups.entries()) {
    const active = steps.slice(g.start, g.end + 1),
      repeat = steps.slice(g.repeat, g.end + 1);
    if (active.some((s) => !s.formula.kernel)) {
      errors.push("groups require registered kernels");
      continue;
    }
    const info = active.map((s) => KERNELS[s.formula.kernel!]);
    if (
      index === 0 &&
      info.some((i) => i.role === 'helper'
        ? !(i.mappingHelper === true && i.dimension === 3 && i.wMode === 'preserve' && i.hints.deoption === -1)
        : i.dimension !== 3 || i.method !== "analytic" || i.wMode !== "derivative" ||
          ![2, 11].includes(i.hints.deoption) || i.role !== undefined)
    )
      errors.push("mapping group requires counted 3D analytic w kernels or recovered uncounted mapping helpers");
    if (
      index === 1 &&
      info.some(
        (i) =>
          i.dimension !== 3 ||
          i.method !== "difs" ||
          i.hints.deoption !== 20 ||
          i.role,
      )
    )
      errors.push("field group requires counted 3D dIFS shapes");
    if (repeat.some((s) => s.iterations < 1) || !repeat.some(s => !KERNELS[s.formula.kernel!].role))
      errors.push("repeat suffix must contain counted calls");
    if (active.some(s => !Number.isInteger(s.iterations) || s.iterations < 1 || s.iterations > 64))
      errors.push("invalid group quota");
  }
  if (!errors.length && e.groups.reduce((total,g) => total + groupCallOrder(steps,g,steps.map(s => !KERNELS[s.formula.kernel!].role)).length,0) > 256)
    errors.push("actual formula-call budget exceeds 256 including helpers");
  return errors;
}
/** Quotas are per slot, not rounds. The limit may end in the middle of a quota. */
export function groupCallOrder(
  steps: readonly Pick<ChainStep, "iterations">[],
  g: ChainGroup,
  counted: readonly boolean[] = steps.map(() => true),
): number[] {
  // This utility also accepts one independent group; validate its bounds directly.
  if (
    ![g.start, g.end, g.repeat, g.maxIterations].every(Number.isInteger) ||
    g.start < 0 ||
    g.end >= steps.length ||
    g.end < g.start ||
    g.repeat < g.start ||
    g.repeat > g.end ||
    g.maxIterations < 1 ||
    g.maxIterations > 256 ||
    counted.length !== steps.length || !counted.slice(g.repeat,g.end + 1).some(Boolean) || steps
      .slice(g.start, g.end + 1)
      .some(
        (s) =>
          !Number.isInteger(s.iterations) ||
          s.iterations < 1 ||
          s.iterations > 64,
      )
  )
    throw Error("invalid counted group");
  const calls: number[] = [];
  let slot = g.start,
    remaining = steps[slot]!.iterations;
  let count = 0;
  while (count < g.maxIterations) {
    calls.push(slot);
    if (counted[slot]) count++;
    if (--remaining === 0) {
      slot = slot === g.end ? g.repeat : slot + 1;
      remaining = steps[slot]!.iterations;
    }
  }
  return calls;
}
export interface MappedFieldOrbit {
  primary: KernelState;
  field: KernelState;
  distance: number;
  invalid: boolean;
  calls: number[][];
}
export function compileMappedFieldOrbit(
  steps: readonly ChainStep[],
  e: MappedFieldExecution,
  round32 = false,
  maps: readonly FieldMap[] = [],
) {
  const errors = mappedFieldErrors(steps, 1, "sequence", e);
  if (errors.length) throw Error(errors.join("; "));
  const counted = steps.map(s => !KERNELS[s.formula.kernel!].role), primaryIndex = counted.findIndex(Boolean);
  const orders = e.groups.map((g) => groupCallOrder(steps, g, counted));
  const sampler = createFieldSampler(maps);
  let previous: number[] = [],
    prepared: ReturnType<typeof prepareKernel>[] = [];
  return (
    point: readonly number[],
    params: readonly number[],
    julia: readonly number[] | null = null,
    threshold = 0,
    options: {independentSecond?:boolean; allFieldIterations?:boolean} = {},
  ): MappedFieldOrbit => {
    const r = round32 ? Math.fround : (t: number) => t;
    if (
      !prepared.length ||
      previous.length !== params.length ||
      params.some((p, i) => p !== previous[i])
    ) {
      let offset = 0;
      prepared = steps.map((step) => {
        const p: KernelParameters = {};
        for (const def of step.formula.parameters)
          p[def.name] = r(params[offset++]!);
        return prepareKernel(step.formula.kernel!, p, sampler);
      });
      previous = [...params];
    }
    const pos = point.map(r),
      primary = freshKernelState(
        [...pos.slice(0, 3), 1] as V4,
        [
          ...(julia ?? pos).slice(0, 3).map(r),
          r(prepared[primaryIndex]!.p.constant_w ?? 0),
        ] as V4,
        3,
      );
    const calls: number[][] = [[], []];
    const finite = (s: KernelState) =>
      [
        ...s.v,
        ...s.c,
        s.varyScale,
        s.fieldValue,
        ...s.free,
        s.derivative,
      ].every(Number.isFinite);
    const advance = (s: KernelState, slot: number) => {
      stepKernel(prepared[slot]!, s);
      if (round32) {
        s.v = s.v.map(r) as V4;
        s.c = s.c.map(r) as V4;
        s.varyScale = r(s.varyScale);
        s.fieldValue = r(s.fieldValue);
        s.free = s.free.map(r) as [number, number];
      }
      s.invalid ||= !finite(s);
      if (counted[slot]) s.count++;
    };
    for (const slot of orders[0]!) {
      calls[0]!.push(slot);
      advance(primary, slot);
      if (primary.invalid) break;
      if (!counted[slot]) continue;
      primary.radiusSquared = r(
        primary.v.slice(0, 3).reduce((n, t) => r(n + r(t * t)), 0),
      );
      primary.trap = Math.min(primary.trap, primary.radiusSquared);
      if (!Number.isFinite(primary.radiusSquared)) {
        primary.invalid = true;
        break;
      }
      if (primary.radiusSquared > prepared[slot]!.p.bailout_squared!) break;
    }
    const denominator = Math.abs(primary.v[3]);
    const field: KernelState = {
      ...primary,
      v: options.independentSecond ? [...pos.slice(0,3),1] as V4 : [...primary.v],
      c: [...primary.c],
      history: [...primary.history],
      free: [0, primary.free[1]],
      extraDerivatives: [...primary.extraDerivatives],
      count: 0,
      first: false,
      firstIteration: 0,
      temporary: 0,
      varyScale: 1,
      bestDistance: 65535,
      bestIteration: 0,
      fieldValue: 0,
      ...(options.independentSecond?{queryThreshold:r(threshold*1.03),mapPadding:r(threshold*1.03)}:{}),
    };
    if (!primary.invalid && denominator > 0 && Number.isFinite(denominator))
      for (const slot of orders[1]!) {
        calls[1]!.push(slot);
        advance(field, slot);
        if (field.invalid || field.varyScale === 0) {
          field.invalid = true;
          break;
        }
        const d = r(field.fieldValue / field.varyScale);
        if (!Number.isFinite(d)) {
          field.invalid = true;
          break;
        }
        if (d < field.bestDistance) {
          field.bestDistance = d;
          field.bestIteration = field.count;
          field.temporary = field.count;
          field.free[1] = field.free[0];
          if (!options.allFieldIterations && d < r(options.independentSecond?threshold*1.03:threshold)) break;
        }
      }
    const distance = r(options.independentSecond ? field.bestDistance : field.bestDistance / denominator),
      invalid =
        primary.invalid ||
        field.invalid ||
        !(denominator > 0) ||
        !Number.isFinite(distance);
    return {
      primary,
      field,
      distance: invalid ? Infinity : distance,
      invalid,
      calls,
    };
  };
}
export function compileMappedFieldCpu(
  steps: readonly ChainStep[],
  e: MappedFieldExecution,
  round32 = false,
  maps: readonly FieldMap[] = [],
) {
  const orbit = compileMappedFieldOrbit(steps, e, round32, maps);
  return (
    point: readonly number[],
    params: readonly number[],
    _weights: readonly number[] = [],
    julia: readonly number[] | null = null,
    threshold = 0,
  ) => {
    const result = orbit(point, params, julia, threshold);
    return {
      dist: result.distance,
      iterations: result.primary.count + result.field.bestIteration,
      trap: e.coloring==='field-otrap' ? result.field.free[1] : Math.abs(result.field.bestDistance),
      invalid: result.invalid,
    };
  };
}
export function generateMappedFieldChain(
  stepsIn: readonly ChainStep[],
  rounds: number,
  mode: ChainMode,
  e: MappedFieldExecution,
  options: {independentSecond?:boolean; allFieldIterations?:boolean; combine?:Pick<IndependentFieldExecution,'operation'|'smooth'>} = {},
): ChainResult {
  const steps = bridgeExecutionSteps(stepsIn, e);
  const errors = mappedFieldErrors(steps, rounds, mode, e);
  if (errors.length) return { ok: false, errors };
  let offset = 0;
  const declarations: string[] = [];
  const blocks = steps.map((step, slot) => {
    const indices = new Map(
      step.formula.parameters.map((p, k) => [p.name, offset + k]),
    );
    offset += step.formula.parameters.length;
    const p = (name: string) => {
      const i = indices.get(name)!;
      return `u.params[${Math.floor(i / 4)}].${"xyzw"[i % 4]}`;
    };
    const matrices = kernelMatrices(step.formula.kernel!, p, `gm${slot}`);
    declarations.push(...matrices.declarations);
    return {
      p,
      body: kernelBody(
        step.formula.kernel!,
        p,
        matrices.args.map((m) => m.name),
      ),
    };
  });
  const group = (index: number) => {
    const g = e.groups[index]!;
    const cases = steps
      .slice(g.start, g.end + 1)
      .map((step, local) => {
        const slot = g.start + local,
          b = blocks[slot]!;
        const counted = !KERNELS[step.formula.kernel!].role;
        return `case ${slot}: {${b.body}\ncounted=${counted};${index === 0 && counted ? `bailout=${b.p("bailout_squared")};` : ""} }`;
      })
      .join("\n");
    return `var slot${index}=${g.start};var remaining${index}=${steps[g.start]!.iterations};
    for(var call${index}=0;call${index}<${groupCallOrder(steps,g,steps.map(s => !KERNELS[s.formula.kernel!].role)).length};call${index}++){
      var bailout=0.0;var counted=false;
      switch slot${index} {${cases}\ndefault:{s.invalid=true;}}
      if(s.invalid||!kernelFinite(s.v.x)||!kernelFinite(s.v.y)||!kernelFinite(s.v.z)||!kernelFinite(s.v.w)||!kernelFinite(s.field)||!kernelFinite(s.varyScale)||!kernelFinite(s.free.x)){s.invalid=true;break;}
      if(counted){s.count+=1.0;
      ${
        index === 0
          ? `s.rho=dot(s.v.xyz,s.v.xyz);s.trap=min(s.trap,s.rho);if(!kernelFinite(s.rho)){s.invalid=true;break;}if(s.rho>bailout){break;}`
          : `if(s.varyScale==0.0){s.invalid=true;break;}let d=s.field/s.varyScale;if(!kernelFinite(d)){s.invalid=true;break;}if(d<s.bestDistance){s.bestDistance=d;s.bestIteration=s.count;s.temporary=s.count;s.free.y=s.free.x;${options.allFieldIterations?'':`if(d<${options.independentSecond?'threshold*1.03':'threshold'}){break;}`}}`
      }
      }
      remaining${index}--;if(remaining${index}==0){slot${index}++;if(slot${index}>${g.end}){slot${index}=${g.repeat};}
        switch slot${index}{${steps
          .slice(g.start, g.end + 1)
          .map(
            (step, local) =>
              `case ${g.start + local}:{remaining${index}=${step.iterations};}`,
          )
          .join("\n")}default:{s.invalid=true;}}
      }
    }`;
  };
  const total = e.groups.reduce((n, g) => n + g.maxIterations, 0);
  return {
    ok: true,
    totalIterations: total,
    wgsl: `${KERNEL_PRIMITIVES_WGSL}
${steps.some(s=>KERNELS[s.formula.kernel!].fieldMapParameter)?FIELD_MAP_WGSL:''}
const FORMULA_ITERATIONS:f32=${total}.0;
fn formulaCoreAtThreshold(pos:vec3f,threshold:f32)->vec3f {
 ${declarations.join("\n")}
 var s:KernelOrbit;s.v=vec4f(pos,1.0);s.c=select(vec4f(pos,${blocks[steps.findIndex(s => !KERNELS[s.formula.kernel!].role)]!.p("constant_w")}),vec4f(u.julia.xyz,${blocks[steps.findIndex(s => !KERNELS[s.formula.kernel!].role)]!.p("constant_w")}),u.julia.w>0.5);
 s.derivative=1.0;s.rho=dot(pos,pos);s.trap=s.rho;s.original=pos;s.varyScale=1.0;s.bestDistance=65535.0;
 ${group(0)}
 let denominator=abs(s.v.w);let primaryCount=s.count;
 ${options.independentSecond?'let primaryDistance=max(threshold*0.25,length(s.v.xyz)/denominator);let primaryTrap=s.trap;':''}
 if(s.invalid||!(denominator>0.0)||!kernelFinite(denominator)){return vec3f(1e20,primaryCount,sqrt(max(0.0,s.trap)));}
 s.count=0.0;s.first=false;s.firstIteration=0.0;s.temporary=0.0;s.varyScale=1.0;s.bestDistance=65535.0;s.bestIteration=0.0;s.free.x=0.0;s.field=0.0;
 ${options.independentSecond?'s.v=vec4f(pos,1.0);s.queryThreshold=threshold*1.03;s.mapPadding=s.queryThreshold;':''}
 ${group(1)}
 if(s.invalid){return vec3f(1e20,primaryCount+s.count,abs(s.bestDistance));}
 ${options.independentSecond?independentCombineWgsl(options.combine??{operation:'max-inverted-second'}):'let distance=s.bestDistance/denominator;'}
 if(!kernelFinite(distance)){return vec3f(1e20,primaryCount+s.count,abs(s.bestDistance));}
 ${options.independentSecond?'if(secondWins){return vec3f(distance,s.bestIteration,s.free.y);}return vec3f(distance,primaryCount,primaryTrap);':`return vec3f(distance,primaryCount+s.bestIteration,${e.coloring==='field-otrap'?'s.free.y':'abs(s.bestDistance)'});`}
}
fn formulaCore(pos:vec3f)->vec3f{return formulaCoreAtThreshold(pos,0.0);}
fn formulaDistance(pos:vec3f)->f32{return formulaCore(pos).x;}
`,
  };
}
