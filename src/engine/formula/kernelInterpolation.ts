/**
 * Interpolation between registered kernel formulas (the "interpolate" chain mode for kernels).
 *
 * Every round, all steps start from the same orbit state, each runs its own iterations, and the results are blended with
 * one weight per step. The blend of the orbit point follows the way Mandelbulb 3D's interpolated hybrid behaves, seen
 * from its documented result rather than its code: the DIRECTION of the blended point comes from the weighted sum of the
 * points, while its LENGTH is the weighted average of the points' lengths. Blending the points alone would shrink the
 * result whenever the formulas point in different directions, and the orbit would fall inward instead of keeping the
 * radius the formulas gave it. The fourth component (the analytic derivative) and every other persistent number are
 * plain weighted averages. A round counts as one iteration, however many steps it blends.
 *
 * Two cases are handled by what the numbers mean (MATH-AUDIT 08):
 *  - 4D formulas: w is a coordinate of the orbit point, so the direction comes from the weighted sum of all FOUR components and the
 *    length is the weighted average of the 4D lengths (the escape radius of a 4D formula includes w).
 *  - analytic estimators: the fourth component is a derivative whose SIGN carries no meaning (a negative Scale gives a negative
 *    derivative; the distance uses its absolute value). Averaging the signed values could give exactly 0 although both mappings
 *    are valid, so magnitudes are averaged. A blend of maps is Lipschitz-bounded by the weighted sum of their bounds (triangle
 *    inequality), which is what the weighted mean of the magnitudes is. The same holds for the separate IFS derivative.
 *
 * The renormalisation is a mapping of its own and it is accounted for in the derivative (MATH-AUDIT 08). With m the weighted sum of
 * the points, L the weighted average of their lengths and u = m/|m|, the blended point is B = L*u. Its derivative has the part along
 * u, grad(L).v, and the part across u, k*(I - u u^T) Dm v, with k = L/|m| >= 1. Writing D for the weighted mean of the step
 * derivatives (a bound for |Dm| and for |grad L|) and s for how far the step directions spread around u, both parts are bounded and
 * the operator norm of DB is at most D*sqrt(max((1+s)^2, k^2 + s^2 k^2/(k^2-1))) (the second term only where s < k^2-1). For
 * agreeing directions (s = 0, k = 1) the factor is exactly 1, so interpolations that never disagreed keep their distances; where the
 * directions disagree the derivative grows, which keeps the estimate on the safe side instead of inflating the vector unnoticed.
 * The spread s is bounded by sqrt(2 - 2 u.ubar) (Jensen), with ubar the weighted mean of the unit directions.
 *
 * Existing scenes are unaffected: registered kernels could not be interpolated before, and the expression-formula
 * interpolation keeps its own plain weighted average.
 */
import type { KernelState } from "./kernels";

/** Largest squared length that is still treated as the zero vector, so a cancelled blend cannot divide by zero. */
const TINY = 1e-40;

/** Blends the finished states of the steps into `base` (which holds the common start state and receives the result). */
export interface BlendOptions {
  /** 4: w is a coordinate of the orbit point (default 3: w is carried separately). */
  dimension?: 3 | 4;
  /** The fourth component is an analytic derivative whose sign is meaningless (default true; ignored for dimension 4). */
  derivativeW?: boolean;
}
export function blendKernelStates(base: KernelState, outs: readonly KernelState[], weights: readonly number[], r: (n: number) => number = (n) => n, options: BlendOptions = {}): KernelState {
  const four = options.dimension === 4, derivativeW = !four && options.derivativeW !== false;
  let total = 0;
  outs.forEach((_, i) => (total += Math.max(0, weights[i] ?? 0)));
  if (!(total > 0)) return base;
  const avg = (get: (s: KernelState) => number) => r(outs.reduce((sum, s, i) => sum + Math.max(0, weights[i] ?? 0) * get(s), 0) / total);
  const n = four ? 4 : 3;
  const sum = Array.from({ length: n }, (_, k) => avg((s) => s.v[k]!));
  const length = avg((s) => Math.hypot(...s.v.slice(0, n)));
  const scale = length / Math.sqrt(sum.reduce((a, b) => a + b * b, 0) + TINY);
  const factor = derivativeFactor(outs, weights, sum, scale, n);
  base.v = [r(sum[0]! * scale), r(sum[1]! * scale), r(sum[2]! * scale), four ? r(sum[3]! * scale) : r(avg((s) => (derivativeW ? Math.abs(s.v[3]) : s.v[3])) * (derivativeW ? factor : 1))];
  base.c = [0, 1, 2, 3].map((k) => avg((s) => s.c[k]!)) as KernelState["c"];
  base.history = [0, 1, 2, 3].map((k) => avg((s) => s.history[k]!)) as KernelState["history"];
  base.derivative = r(avg((s) => Math.abs(s.derivative)) * factor);
  base.fieldValue = avg((s) => s.fieldValue);
  base.varyScale = avg((s) => s.varyScale);
  base.temporary = avg((s) => s.temporary);
  base.free = [avg((s) => s.free[0]), avg((s) => s.free[1])];
  base.extraDerivatives = [r(avg((s) => s.extraDerivatives[0]) * factor), r(avg((s) => s.extraDerivatives[1]) * factor)];
  base.firstIteration = Math.max(...outs.map((s) => s.firstIteration));
  base.first = outs.some((s) => s.first);
  return base;
}

/** The factor by which the mean step derivative must grow because the blend renormalises the point (see the header). */
export function derivativeFactor(outs: readonly KernelState[], weights: readonly number[], sum: readonly number[], keep: number, n: number): number {
  let total = 0;
  const ubar = new Array<number>(n).fill(0);
  outs.forEach((s, i) => {
    const w = Math.max(0, weights[i] ?? 0), len = Math.hypot(...s.v.slice(0, n));
    total += w;
    if (len > 0) for (let k = 0; k < n; k++) ubar[k]! += (w * s.v[k]!) / len;
  });
  const mlen = Math.sqrt(sum.reduce((a, b) => a + b * b, 0) + TINY);
  let dotUU = 0;
  for (let k = 0; k < n; k++) dotUU += (sum[k]! / mlen) * (ubar[k]! / total);
  // Identical directions leave rounding noise of about 1e-16 in 2 - 2 u.ubar; below 1e-6 it is exactly zero (the WGSL twin does the same).
  const spread2 = 2 - 2 * dotUU, sp = spread2 < 1e-6 ? 0 : Math.sqrt(spread2), k2 = keep * keep;
  let f2 = (1 + sp) * (1 + sp);
  if (keep > 1 && sp < k2 - 1) f2 = Math.max(f2, k2 + (sp * sp * k2) / (k2 - 1));
  return Math.sqrt(f2);
}

export const stateIsFinite = (s: KernelState): boolean =>
  [...s.v, ...s.c, ...s.history, s.derivative, s.fieldValue, s.varyScale, ...s.free, ...s.extraDerivatives].every(Number.isFinite);

/**
 * WGSL twin of blendKernelStates. `acc` names the blended-so-far accumulators, which the generated round code fills.
 * Returns the declarations (before the steps) and the finishing code (after the steps), both acting on the orbit `s`
 * and the saved start state `start`.
 */
export function interpolationWgsl(dimension: 3 | 4, derivativeW: boolean) {
  const four = dimension === 4, vec = four ? "vec4f" : "vec3f", part = four ? "s.v" : "s.v.xyz";
  return {
    declarations: `var uSum=${vec}(0.0);var wTotal=0.0;var vSum=${vec}(0.0);var vLen=0.0;var wSum4=0.0;var cSum=vec4f(0.0);var hSum=vec4f(0.0);var dSum=0.0;var fSum=0.0;var yScale=0.0;var tSum=0.0;var freeSum=vec2f(0.0);var extraSum=vec2f(0.0);var firstMax=0.0;var anyFirst=false;`,
    accumulate: (weight: string) =>
      `{let wi=max(0.0,${weight});if(wi>0.0){wTotal+=wi;vSum+=wi*${part};let ln=length(${part});if(ln>0.0){uSum+=wi*${part}/ln;}vLen+=wi*length(${part});wSum4+=wi*${!four && derivativeW ? "abs(s.v.w)" : "s.v.w"};cSum+=wi*s.c;hSum+=wi*s.history;dSum+=wi*abs(s.derivative);fSum+=wi*s.field;yScale+=wi*s.varyScale;tSum+=wi*s.temporary;freeSum+=wi*s.free;extraSum+=wi*s.extraDerivatives;firstMax=max(firstMax,s.firstIteration);anyFirst=anyFirst||s.first;}}`,
    finish: `if(wTotal>0.0){let inv=1.0/wTotal;let mean=vSum*inv;let mlen=sqrt(dot(mean,mean)+1.0e-40);let keep=vLen*inv/mlen;
    let spread2=2.0-2.0*dot(mean/mlen,uSum*inv);var spread=0.0;if(spread2>=1.0e-6){spread=sqrt(spread2);}let k2=keep*keep;var f2=(1.0+spread)*(1.0+spread);if(keep>1.0&&spread<k2-1.0){f2=max(f2,k2+spread*spread*k2/(k2-1.0));}let dfac=sqrt(f2);
    s=start;s.v=${four ? "mean*keep" : derivativeW ? "vec4f(mean*keep,wSum4*inv*dfac)" : "vec4f(mean*keep,wSum4*inv)"};s.c=cSum*inv;s.history=hSum*inv;s.derivative=dSum*inv*dfac;s.field=fSum*inv;s.varyScale=yScale*inv;s.temporary=tSum*inv;s.free=freeSum*inv;s.extraDerivatives=extraSum*inv*dfac;s.firstIteration=firstMax;s.first=anyFirst;}else{s=start;}`,
  };
}
/** The 3D formulas whose fourth component is not a derivative keep the plain mean of w. */
export const INTERPOLATION_WGSL = interpolationWgsl(3, true);
