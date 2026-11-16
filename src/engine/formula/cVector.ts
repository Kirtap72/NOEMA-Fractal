/**
 * Kernels that change the iteration constant C (the sampled point in Mandelbrot mode, the Julia seed otherwise), not only the point z.
 * One shared place for CPU step, WGSL body and metadata, so every formula of this kind gets the same state rules:
 *   - C lives in `KernelState.c` / `KernelOrbit.c` and is written in place; a change persists for the rest of the orbit (the next formula call and
 *     the next iteration see the changed C), exactly like the point itself. It is reset when a new orbit starts.
 *   - A C change never touches the derivative, radius, count or orbit trap; the host keeps those (these are uncounted helpers, DEoption -1).
 *   - Julia mode needs no special case: the seed is simply the starting value of C.
 * Equations come from the formula files' own descriptions (see NewFormulas/coverage-04/C-VECTOR.md).
 */
import type { KernelInfo, KernelParameters, KernelState } from "./kernels";
import { applyMatrix } from "./primitives";
import type { Matrix } from "./primitives";

export const C_VECTOR_KERNEL_IDS = ["mb3d-rotatec", "mb3d-translatec4d"] as const;
export type CVectorKernelId = (typeof C_VECTOR_KERNEL_IDS)[number];

const real = (name: string, label: string, def: number, min: number, max: number) => ({ name, label, default: def, min, max });
const HELPER_HINTS = { deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0 };

export const C_VECTOR_DEFINITIONS: Record<CVectorKernelId, KernelInfo> = {
  // _RotateC: C.xyz = M C.xyz with the matrix of the same three-angle option type as _Rotate (the description says it is meant to be combined with _Rotate).
  "mb3d-rotatec": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve", helperMethods: ["numeric", "analytic"], mappingHelper: true,
    parameters: [real("rotation_c_x", "Rotation C X (degrees)", 0, -180, 180), real("rotation_c_y", "Rotation C Y (degrees)", 0, -180, 180), real("rotation_c_z", "Rotation C Z (degrees)", 0, -180, 180)],
    hints: HELPER_HINTS,
  },
  // _TranslateC4d: adds a constant to the 4D point and to the 4D C.
  "mb3d-translatec4d": {
    dimension: 4, method: "numeric", role: "helper", wMode: "coordinate", helperMethods: ["numeric", "analytic"],
    parameters: [real("x_add", "x add", 0, -1000, 1000), real("y_add", "y add", 0, -1000, 1000), real("z_add", "z add", 0, -1000, 1000), real("w_add", "w add", 0, -1000, 1000),
      real("cx_add", "Cx add", 0, -1000, 1000), real("cy_add", "Cy add", 0, -1000, 1000), real("cz_add", "Cz add", 0, -1000, 1000), real("cw_add", "Cw add", 0, -1000, 1000)],
    hints: HELPER_HINTS,
  },
};

/** Which rotation parameter prefixes a C-vector kernel needs a matrix for (CPU and WGSL build them the same way as for the other kernels). */
export const C_VECTOR_ROTATIONS: Partial<Record<CVectorKernelId, string>> = { "mb3d-rotatec": "rotation_c" };

export function stepCVectorKernel(id: CVectorKernelId, p: KernelParameters, matrices: Matrix[], state: KernelState): void {
  if (id === "mb3d-rotatec") {
    const r = applyMatrix(matrices[0]!, [state.c[0], state.c[1], state.c[2]]);
    state.c = [r[0]!, r[1]!, r[2]!, state.c[3]];
  } else {
    state.v = [state.v[0] + p.x_add!, state.v[1] + p.y_add!, state.v[2] + p.z_add!, state.v[3] + p.w_add!];
    state.c = [state.c[0] + p.cx_add!, state.c[1] + p.cy_add!, state.c[2] + p.cz_add!, state.c[3] + p.cw_add!];
  }
  if (![...state.v, ...state.c].every(Number.isFinite)) state.invalid = true;
}

export function cVectorBody(id: CVectorKernelId, p: (name: string) => string, matrixNames: string[]): string {
  if (id === "mb3d-rotatec") return `s.c=vec4f(${matrixNames[0]!}*s.c.xyz,s.c.w);`;
  return `s.v=s.v+vec4f(${p("x_add")},${p("y_add")},${p("z_add")},${p("w_add")});s.c=s.c+vec4f(${p("cx_add")},${p("cy_add")},${p("cz_add")},${p("cw_add")});`;
}
