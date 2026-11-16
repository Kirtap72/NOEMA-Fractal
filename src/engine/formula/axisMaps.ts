/**
 * Axis-map families: one scalar equation per family, expanded over the axes (and axis pairs) that the Mandelbulb 3D formula files describe separately.
 * FORMULA-FAMILY-05. One shared place for the CPU step, the WGSL body and the metadata, so every member gets identical rules:
 *   - the map changes only its own coordinate (or swaps two), never w, C, the derivative, radius, count or orbit trap (uncounted helper, DEoption -1);
 *   - a non-finite result (division by zero, ln of a non-positive number) marks the point invalid; nothing is invented where the description is silent;
 *   - all members are 3D, w-preserving mapping helpers, so they can sit in the mapping group of a mapped-field execution like _AbsX.
 * Equations come from the formula files' own descriptions (see NewFormulas/family-05/FAMILIES.md); no [CODE] section was used.
 */
import type { KernelInfo, KernelParameters, KernelState } from "./kernels";

const AXES = ["x", "y", "z"] as const;
type Axis = 0 | 1 | 2;

export const AXIS_MAP_KERNEL_IDS = [
  "mb3d-hopsqrtx", "mb3d-hopsqrty", "mb3d-hopsqrtz",
  "mb3d-neosqrx", "mb3d-neosqry", "mb3d-neosqrz",
  "mb3d-logx", "mb3d-logy", "mb3d-logz",
  "mb3d-sinhx", "mb3d-sinhy", "mb3d-sinhz",
  "mb3d-reciprocalx", "mb3d-reciprocalx2", "mb3d-reciprocaly2", "mb3d-reciprocalz2",
  "mb3d-flipxy", "mb3d-flipxz", "mb3d-flipyz",
] as const;
export type AxisMapKernelId = (typeof AXIS_MAP_KERNEL_IDS)[number];

const real = (name: string, label: string, def: number, min = -1000, max = 1000) => ({ name, label, default: def, min, max });
const HELPER_HINTS = { deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0 };

/** One scalar family: the member's parameters (fix* is axis-specific) and the equation on the coordinate `c`, as a JS function and as a WGSL expression builder. */
interface ScalarFamily {
  key: string;
  fileName: (axis: string) => string;
  parameters: (axis: string) => ReturnType<typeof real>[];
  axes: readonly Axis[];
  /** The new coordinate; may return a non-finite number, which the caller turns into an invalid point. */
  apply: (c: number, p: KernelParameters, axis: string) => number;
  /** WGSL statements computing `am_r` from `am_c`; `p(name)` yields the parameter reference. */
  wgsl: (p: (name: string) => string, axis: string) => string;
}

const SQRT_SIGN = (t: number) => (t > 0 ? 1 : -1); // description: `if t>0 ... else ...`

const FAMILIES: ScalarFamily[] = [
  { // _HopSqrtX/Y/Z (Luca GN 2011): t = Mul c + fix; c' = fixSq +- sqrt|t| / Div, plus for t > 0, minus otherwise
    key: "hopsqrt", axes: [0, 1, 2], fileName: (a) => `_HopSqrt${a.toUpperCase()}.m3f`,
    parameters: (a) => [real(`fix_${a}`, `fix${a.toUpperCase()}`, 0), real("fix_sq", "fixSq", 0), real("mul", "Mul", 1), real("div", "Div", 1)],
    apply: (c, p, a) => { const t = p.mul! * c + p[`fix_${a}`]!; return p.fix_sq! + (SQRT_SIGN(t) * Math.sqrt(Math.abs(t))) / p.div!; },
    wgsl: (p, a) => `let am_t=${p("mul")}*am_c+${p(`fix_${a}`)};let am_r=${p("fix_sq")}+select(-1.0,1.0,am_t>0.0)*sqrt(abs(am_t))/${p("div")};`,
  },
  { // _NeoSqrX/Y/Z (Luca GN 2011): NeoSqr(A,B) = A(B-A) for A>0 else A(A-B); c' = NeoSqr(Mul c + fix, fixSq)/Div - fix
    key: "neosqr", axes: [0, 1, 2], fileName: (a) => `_NeoSqr${a.toUpperCase()}.m3f`,
    parameters: (a) => [real(`fix_${a}`, `fix${a.toUpperCase()}`, 0), real("fix_sq", "fixSq", 1), real("mul", "Mul", 1), real("div", "Div", 1)],
    apply: (c, p, a) => { const aa = p.mul! * c + p[`fix_${a}`]!, b = p.fix_sq!; return (aa > 0 ? aa * (b - aa) : aa * (aa - b)) / p.div! - p[`fix_${a}`]!; },
    wgsl: (p, a) => `let am_a=${p("mul")}*am_c+${p(`fix_${a}`)};let am_b=${p("fix_sq")};let am_r=select(am_a*(am_a-am_b),am_a*(am_b-am_a),am_a>0.0)/${p("div")}-${p(`fix_${a}`)};`,
  },
  { // _LogX/Y/Z (Luca GN 2013): u = Mul c + fix; c' = ln(u + fixLg)/ln(Base) sign(u). ln of a non-positive number is undefined: invalid point.
    key: "log", axes: [0, 1, 2], fileName: (a) => `_Log${a.toUpperCase()}.m3f`,
    parameters: (a) => [real(`fix_${a}`, `fix${a.toUpperCase()}`, 0), real("fix_lg", "fixLg", 0.01), real("mul", "Mul", 1), real("base", "Base", 0.367879441)],
    apply: (c, p, a) => { const u = p.mul! * c + p[`fix_${a}`]!; return (Math.log(u + p.fix_lg!) / Math.log(p.base!)) * Math.sign(u); },
    wgsl: (p, a) => `let am_u=${p("mul")}*am_c+${p(`fix_${a}`)};let am_g=am_u+${p("fix_lg")};if(!(am_g>0.0)){s.invalid=true;break;}let am_r=log(am_g)/log(${p("base")})*sign(am_u);`,
  },
  { // _SinhX/Y/Z (Luca GN 2013): u = Mul c + fix; c' = ln(u + sqrt(u^2+1))/ln(Base) + fixLg
    key: "sinh", axes: [0, 1, 2], fileName: (a) => `_Sinh${a.toUpperCase()}.m3f`,
    parameters: (a) => [real(`fix_${a}`, `fix${a.toUpperCase()}`, 0), real("fix_lg", "fixLg", 0), real("mul", "Mul", -2), real("base", "Base", 0.367879441)],
    apply: (c, p, a) => { const u = p.mul! * c + p[`fix_${a}`]!; return Math.log(u + Math.sqrt(u * u + 1)) / Math.log(p.base!) + p.fix_lg!; },
    wgsl: (p, a) => `let am_u=${p("mul")}*am_c+${p(`fix_${a}`)};let am_r=log(am_u+sqrt(am_u*am_u+1.0))/log(${p("base")})+${p("fix_lg")};`,
  },
  { // _reciprocalX2/Y2/Z2: c' = sign(c) / (|c| + Limiter)
    key: "reciprocal2", axes: [0, 1, 2], fileName: (a) => `_reciprocal${a.toUpperCase()}2.m3f`,
    parameters: () => [real("limiter", "Limiter", 0.5)],
    apply: (c, p) => Math.sign(c) / (Math.abs(c) + p.limiter!),
    wgsl: (p) => `let am_r=sign(am_c)/(abs(am_c)+${p("limiter")});`,
  },
  { // _reciprocalX: x' = 1/x (only the x file exists)
    key: "reciprocal", axes: [0], fileName: (a) => `_reciprocal${a.toUpperCase()}.m3f`,
    parameters: () => [],
    apply: (c) => 1 / c,
    wgsl: () => `let am_r=1.0/am_c;`,
  },
];

const FLIPS: { id: AxisMapKernelId; pair: string; i: Axis; j: Axis }[] = [
  { id: "mb3d-flipxy", pair: "XY", i: 0, j: 1 }, { id: "mb3d-flipxz", pair: "XZ", i: 0, j: 2 }, { id: "mb3d-flipyz", pair: "YZ", i: 1, j: 2 },
];

export interface AxisMapMember { id: AxisMapKernelId; file: string; axis: Axis | null; family: string; flip?: { i: Axis; j: Axis } }

/** Every member with its engine id and formula file; the single list the registry, the tests and the documentation are generated from. */
export const AXIS_MAP_MEMBERS: AxisMapMember[] = [
  ...FAMILIES.flatMap((f) => f.axes.map((axis) => ({ id: `mb3d-${f.fileName(AXES[axis]).slice(1, -4).toLowerCase()}` as AxisMapKernelId, file: f.fileName(AXES[axis]), axis, family: f.key }))),
  ...FLIPS.map((x) => ({ id: x.id, file: `_Flip${x.pair}.m3f`, axis: null, family: "flip", flip: { i: x.i, j: x.j } })),
];

const familyOf = (id: AxisMapKernelId) => FAMILIES.find((f) => f.key === AXIS_MAP_MEMBERS.find((m) => m.id === id)!.family);
const memberOf = (id: AxisMapKernelId) => AXIS_MAP_MEMBERS.find((m) => m.id === id)!;

export const AXIS_MAP_DEFINITIONS = Object.fromEntries(AXIS_MAP_MEMBERS.map((m) => {
  const fam = familyOf(m.id);
  const parameters = fam ? fam.parameters(AXES[m.axis!]!) : [];
  const info: KernelInfo = { dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric", "analytic"], mappingHelper: true, parameters, hints: HELPER_HINTS };
  return [m.id, info];
})) as Record<AxisMapKernelId, KernelInfo>;

export function stepAxisMapKernel(id: AxisMapKernelId, p: KernelParameters, state: KernelState): void {
  const m = memberOf(id);
  if (m.flip) {
    const { i, j } = m.flip, t = state.v[i]!;
    state.v[i] = state.v[j]!; state.v[j] = t;
    return;
  }
  const axis = AXES[m.axis!]!;
  const r = familyOf(id)!.apply(state.v[m.axis!]!, p, axis);
  if (!Number.isFinite(r)) { state.invalid = true; return; }
  state.v[m.axis!] = r;
}

export function axisMapBody(id: AxisMapKernelId, p: (name: string) => string): string {
  const m = memberOf(id);
  if (m.flip) { const c = ["x", "y", "z"]; return `{let am_t=s.v.${c[m.flip.i]!};s.v.${c[m.flip.i]!}=s.v.${c[m.flip.j]!};s.v.${c[m.flip.j]!}=am_t;}`; }
  const comp = AXES[m.axis!]!;
  return `{let am_c=s.v.${comp};${familyOf(id)!.wgsl(p, comp)}if(!kernelFinite(am_r)){s.invalid=true;break;}s.v.${comp}=am_r;}`;
}
