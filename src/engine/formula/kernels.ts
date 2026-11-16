import {isImportedHelperId,stepImportedHelper} from './importedHelper';
import {ROOM_CLR_ID,ROOM_CLR_INFO,stepRoomClr} from './roomClr';
import {UNLOCK09_KERNEL_IDS,UNLOCK09_DEFINITIONS} from './unlock09Metadata';
import {stepUnlock09} from './unlock09Kernels';
import {RECREATION_NINE_KERNEL_IDS,RECREATION_NINE_DEFINITIONS} from './recreationNineMetadata';
import {stepRecreationNine} from './recreationNineKernels';
import {GATEWAY_KERNEL_IDS,GATEWAY_DEFINITIONS} from './gatewayMetadata';
import {RECREATION_SIX_KERNEL_IDS,RECREATION_SIX_DEFINITIONS} from './recreationSixMetadata';
import {stepRecreationSix} from './recreationSixKernels';
import {C_VECTOR_KERNEL_IDS,C_VECTOR_DEFINITIONS,stepCVectorKernel} from './cVector';
import {FOLLOWUP_KERNEL_IDS,FOLLOWUP_DEFINITIONS,stepFollowupKernel} from './followupKernels';
import type {FollowupKernelId} from './followupKernels';
import {BATCH05_KERNEL_IDS,BATCH05_DEFINITIONS,stepBatch05Kernel} from './batch05Kernels';
import type {Batch05KernelId} from './batch05Kernels';
import {BATCH06_KERNEL_IDS,BATCH06_DEFINITIONS,stepBatch06Kernel} from './batch06Kernels';
import type {Batch06KernelId} from './batch06Kernels';
import {BATCH07_KERNEL_IDS,BATCH07_DEFINITIONS,stepBatch07Kernel} from './batch07Kernels';
import type {Batch07KernelId} from './batch07Kernels';
import {BATCH08_KERNEL_IDS,BATCH08_DEFINITIONS,stepBatch08Kernel} from './batch08Kernels';
import type {Batch08KernelId} from './batch08Kernels';
import type {CVectorKernelId} from './cVector';
import {AXIS_MAP_KERNEL_IDS,AXIS_MAP_DEFINITIONS,stepAxisMapKernel} from './axisMaps';
import type {AxisMapKernelId} from './axisMaps';
import {stepGatewayKernel} from './gatewayKernels';
import type {FieldSampler} from '../fieldMaps';
import { PLATINUM_INFO, stepPlatinum, stepPlatinumB } from "./platinum";
import type { Parameter } from "./types";
import {
  applyMatrix,
  goldenReflections,
  maskedPasses,
  pairReflections,
  quadrayLift,
  quadraySquare,
  rotation3,
  rotation4,
  stereographicChart,
  inverseStereographicChart,
} from "./primitives";
import type { Matrix, V4 } from "./primitives";
import { stepBatch02Kernel } from "./batch02Kernels";
import { stepBatch03Kernel } from "./batch03Kernels";
import {
  ESSENTIALS_KERNEL_IDS,
  ESSENTIALS_DEFINITIONS,
} from "./essentialsMetadata";
import {
  stepEssentialsKernel,
  prepareEssentialsMatrices,
} from "./essentialsKernels";

export const BATCH_01_KERNEL_IDS = [
  "cubic-quat",
  "hopf-4d",
  "quadray-brot",
  "aexion-1",
  "menger-ifs",
  "icosahedron-ifs",
  "sierpinski-4",
  "tglad-tetra-2",
  "manowar-bulb",
  "fuzzy",
] as const;
export const BATCH_02_KERNEL_IDS = [
  "beth-2422",
  "ides-formula",
  "aex-octo",
  "lambda-4dc",
  "barnsley-4dnc",
  "kalisets-1",
  "menger-hyper",
  "octahedron-4",
  "tglad-dihed",
  "scherk-fs",
] as const;
export const BATCH_03_KERNEL_IDS = [
  "faehrten",
  "mandel-4d-bic",
  "hyperd-1",
  "makin-4d-p2a",
  "sin-4d-plus",
  "riemann-2",
  "torus-ellip-ifs",
  "klein-bagel-ifs",
  "helix-ifs",
  "hopalong",
] as const;
export const KERNEL_IDS = [
  ROOM_CLR_ID,
  ...UNLOCK09_KERNEL_IDS,
  ...RECREATION_NINE_KERNEL_IDS,
  ...RECREATION_SIX_KERNEL_IDS,
  ...C_VECTOR_KERNEL_IDS,
  ...FOLLOWUP_KERNEL_IDS,
  ...BATCH05_KERNEL_IDS,
  ...BATCH06_KERNEL_IDS,
  ...BATCH07_KERNEL_IDS,
  ...BATCH08_KERNEL_IDS,
  ...AXIS_MAP_KERNEL_IDS,
  "mb3d-celticmode",
  "mb3d-absx",
  "mb3d-absy",
  "mb3d-absz",
  "mb3d-reciprocalz3b",
  "mb3d-reciprocalx3b",
  "mb3d-aboxplatinum",
  "mb3d-aboxplatinumb",
  "mb3d-internal-amazingbox",
  ...BATCH_01_KERNEL_IDS,
  ...BATCH_02_KERNEL_IDS,
  ...BATCH_03_KERNEL_IDS,
  ...ESSENTIALS_KERNEL_IDS,
  ...GATEWAY_KERNEL_IDS,
] as const;
export type KernelId = (typeof KERNEL_IDS)[number];
export type DistanceMethod = "numeric" | "ifs" | "difs" | "analytic";
export interface KernelInfo {
  fieldMapParameter?: string;
  /** Helpers preserve extra coordinates and never own count, radius, trap or DE. */
  role?: "helper" | "difs-transform";
  wMode?: "derivative" | "coordinate" | "preserve";
  /** Allowed estimator families for uncounted transforms. Omitted retains numeric-only legacy behavior. */
  helperMethods?: readonly DistanceMethod[];
  /** Recovered uncounted mapping helper: xyz changes, native analytic w and host state survive. */
  mappingHelper?: boolean;
  dimension: 3 | 4;
  method: DistanceMethod;
  parameters: Parameter[];
  hints: {
    deoption: number;
    descale: number;
    adescale: number;
    rstop: number;
    sipow: number;
  };
}
const parameter = (
  name: string,
  label: string,
  def: number,
  min = -8,
  max = 8,
): Parameter => ({ name, label, default: def, min, max });
const rotations = (prefix: string, labels = ["X", "Y", "Z"]): Parameter[] =>
  labels.map((axis) =>
    parameter(
      `${prefix}_${axis.toLowerCase()}`,
      `${prefix} ${axis} (degrees)`,
      0,
      -180,
      180,
    ),
  );
const scaleParams = (s: number, xyz: number[]) => [
  parameter("scale", "Scale", s, -8, 8),
  ...xyz.map((v, i) =>
    parameter(`cscale_${"xyzw"[i]}`, `CScale ${"XYZW"[i]}`, v),
  ),
];

function info(
  dimension: 3 | 4,
  method: DistanceMethod,
  parameters: Parameter[],
  deoption: number,
  rstop = 16,
  sipow = 2,
  adescale = 1,
  role?: "helper",
): KernelInfo {
  return {
    dimension,
    method,
    ...(role ? { role } : {}),
    parameters: [
      ...parameters,
      ...(role === "helper"
        ? []
        : [
            parameter("slice_w", "4D slice / extra w", 0, -4, 4),
            parameter("constant_w", "Julia constant w", 0, -4, 4),
          ]),
      ...(role === "helper"
        ? []
        : method === "difs"
          ? [
              parameter("de_stop", "dIFS distance threshold", 0.0001, 0, 0.1),
              parameter(
                "inside_render",
                "dIFS inside rendering (0/1)",
                0,
                0,
                1,
              ),
            ]
          : [
              parameter(
                "bailout_squared",
                "Escape limit (radius²)",
                rstop,
                1,
                65536,
              ),
            ]),
    ],
    hints: {
      deoption,
      descale: method === "ifs" ? 0.2 : 1,
      adescale,
      rstop,
      sipow,
    },
  };
}

/** Fixed, versioned kernel names: YAML selects mathematics, never executable source. */
export const KERNELS: Record<KernelId, KernelInfo> = {
  ...(Object.fromEntries(Object.entries(AXIS_MAP_DEFINITIONS).map(([id,d])=>[id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as Record<AxisMapKernelId,KernelInfo>),
  ...(Object.fromEntries(Object.entries(C_VECTOR_DEFINITIONS).map(([id,d])=>[id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as Record<CVectorKernelId,KernelInfo>),
  ...(Object.fromEntries(Object.entries(BATCH08_DEFINITIONS).map(([id,d])=>[id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as Record<Batch08KernelId,KernelInfo>),
  ...(Object.fromEntries(Object.entries(BATCH07_DEFINITIONS).map(([id,d])=>[id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as Record<Batch07KernelId,KernelInfo>),
  ...(Object.fromEntries(Object.entries(BATCH06_DEFINITIONS).map(([id,d])=>[id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as Record<Batch06KernelId,KernelInfo>),
  ...(Object.fromEntries(Object.entries(BATCH05_DEFINITIONS).map(([id,d])=>[id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as Record<Batch05KernelId,KernelInfo>),
  ...(Object.fromEntries(Object.entries(FOLLOWUP_DEFINITIONS).map(([id,d])=>[id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as Record<FollowupKernelId,KernelInfo>),
  "mb3d-absy": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve",
    helperMethods: ["numeric", "analytic"], mappingHelper: true,
    parameters: [parameter("fix_y", "fixY", 0)],
    hints: {deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0},
  },
  "mb3d-absz": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve",
    helperMethods: ["numeric", "analytic"], mappingHelper: true,
    parameters: [parameter("fix_z", "fixZ", 0)],
    hints: {deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0},
  },
  "mb3d-absx": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve",
    helperMethods: ["numeric", "analytic"], mappingHelper: true,
    parameters: [parameter("fix_x", "fixX", 0)],
    hints: {deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0},
  },
  [ROOM_CLR_ID]:ROOM_CLR_INFO,
  ...(Object.fromEntries(UNLOCK09_DEFINITIONS.map(d=>[d.id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as unknown as Record<import('./unlock09Metadata').Unlock09KernelId,KernelInfo>),
  ...(Object.fromEntries(RECREATION_NINE_DEFINITIONS.map(d=>[d.id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as unknown as Record<import('./recreationNineMetadata').RecreationNineKernelId,KernelInfo>),
  ...(Object.fromEntries(RECREATION_SIX_DEFINITIONS.map(d=>[d.id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as unknown as Record<import('./recreationSixMetadata').RecreationSixKernelId,KernelInfo>),
  "mb3d-celticmode": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve",
    helperMethods: ["numeric", "analytic"], mappingHelper: true,
    parameters: [parameter("good", "Good rune", -1), parameter("evil", "Evil rune", 0),
      parameter("mystic", "Mystic rune", 0), parameter("heretic", "Heretic rune", 0)],
    hints: {deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0},
  },
  "mb3d-reciprocalz3b": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve",
    helperMethods: ["numeric", "analytic"], mappingHelper: true,
    parameters: [parameter("limiter1", "Limiter1", .67, 1e-6, 8), parameter("limiter2", "Limiter2", .67, 1e-6, 8),
      parameter("mul1", "mul1", 1), parameter("mul2", "mul2", 1)],
    hints: {deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0},
  },
  // x-axis sibling of mb3d-reciprocalz3b; same parameters, role and derivative handling (the carried w is preserved).
  "mb3d-reciprocalx3b": {
    dimension: 3, method: "numeric", role: "helper", wMode: "preserve",
    helperMethods: ["numeric", "analytic"], mappingHelper: true,
    parameters: [parameter("limiter1", "Limiter1", .67, 1e-6, 8), parameter("limiter2", "Limiter2", .67, 1e-6, 8),
      parameter("mul1", "mul1", 1), parameter("mul2", "mul2", 1)],
    hints: {deoption: -1, descale: 1, adescale: 1, rstop: 16, sipow: 0},
  },
  "mb3d-aboxplatinum": PLATINUM_INFO,
  "mb3d-aboxplatinumb": PLATINUM_INFO,
  "mb3d-internal-amazingbox": {
    ...PLATINUM_INFO,hints:{...PLATINUM_INFO.hints,deoption:11},
    parameters:[PLATINUM_INFO.parameters[0]!,{name:'min_r',label:'Min R',default:.5,min:-8,max:8},PLATINUM_INFO.parameters[2]!,
      ...PLATINUM_INFO.parameters.slice(-2)],
  },
  ...(Object.fromEntries(GATEWAY_DEFINITIONS.map(d=>[d.id,{...d,parameters:d.parameters.map(p=>({...p}))}])) as unknown as Record<import('./gatewayMetadata').GatewayKernelId,KernelInfo>),
  ...(Object.fromEntries(
    ESSENTIALS_DEFINITIONS.map((d) => [
      d.id,
      {
        dimension: d.dimension,
        method: d.method,
        parameters: d.parameters.map((p) => ({ ...p })),
        hints: d.hints,
        wMode: d.wMode,
        ...("role" in d
          ? {
              role: d.role,
              helperMethods:
                d.role === "difs-transform"
                  ? ["difs"]
                  : ["numeric", "analytic", "ifs"],
            }
          : {}),
      },
    ]),
  ) as unknown as Record<
    import("./essentialsMetadata").EssentialsId,
    KernelInfo
  >),
  faehrten: info(
    3,
    "numeric",
    [
      parameter("y_multiplier", "Y multiplier", 1),
      parameter("z_multiplier", "Z multiplier", 0.5),
      parameter("squares_multiplier", "Squares multiplier", -1 / 3),
      parameter("twist", "Twist", 0),
    ],
    0,
    16,
    0,
  ),
  "mandel-4d-bic": info(4, "numeric", [parameter("w_add", "w add", 0)], 4),
  "hyperd-1": info(
    4,
    "numeric",
    [
      parameter("w_add", "w add", 0),
      parameter("int_power", "IntPower (2 to 16)", 8, 1, 16),
      parameter("zw_mul", "ZW mul", 0),
      parameter("yw_mul", "YW mul", 1),
      parameter("yz_mul", "YZ mul", 1),
    ],
    4,
  ),
  "makin-4d-p2a": info(4, "numeric", [parameter("w_add", "w add", 0)], 4),
  "sin-4d-plus": info(
    4,
    "numeric",
    [
      parameter("px", "Px", 0),
      parameter("py", "Py", 0),
      parameter("pz", "Pz", 0),
      parameter("pw", "Pw", 0),
      parameter("a", "a", 1.5),
    ],
    4,
    16,
    4,
  ),
  "riemann-2": info(
    3,
    "numeric",
    [
      ...rotations("rotation"),
      parameter("scale", "Scale", 1),
      parameter("rpow", "RPow", 2),
      parameter("r_shift", "r-Shift", -0.25),
      parameter("s_shift", "s-Shift", 0),
      parameter("t_shift", "t-Shift", 0),
      parameter("x_shift", "x-Shift", 1),
      parameter("sin_add_fold", "Sin-AddFold", 0),
      parameter("smallest_value", "Smallest value", 1e-5, 0, 1),
    ],
    0,
    16,
    0,
  ),
  "torus-ellip-ifs": info(
    3,
    "difs",
    [
      parameter("radius_1", "Radius 1", 0.5),
      parameter("scale", "Scale", 1),
      parameter("z_add", "Z add", 0),
      parameter("y_add", "Y add", 0),
      parameter("x_add", "X add", 0),
      parameter("radius_2", "Radius 2", 0.1),
      parameter("apply_scale_add", "Apply scale+add", 1, 0, 1),
      parameter("boxy_xy", "Boxy XY", 0, 0, 1),
      parameter("boxy_z", "Boxy Z", 0, 0, 1),
      parameter("elliptic", "Elliptic", 0.2),
    ],
    20,
    16,
    0,
  ),
  "klein-bagel-ifs": info(
    3,
    "difs",
    [
      parameter("radius_1", "Radius 1", 1.5),
      parameter("scale", "Scale", 2),
      parameter("z_add", "Z add", 0),
      parameter("y_add", "Y add", 0),
      parameter("x_add", "X add", 2),
      parameter("radius_2", "Radius 2", 0.1),
      parameter("apply_scale_add", "Apply scale+add", 1, 0, 1),
      parameter("boxy_xy", "Boxy XY", 0, 0, 1),
      parameter("mobius", "Mobius", 1, -8, 8),
      parameter("aspect_ratio", "Aspect Ratio", 1),
    ],
    20,
    16,
    0,
  ),
  "helix-ifs": info(
    3,
    "difs",
    [
      parameter("helix_stretch", "Helix stretch", 1),
      parameter("diameter_1", "Diameter 1", 1),
      parameter("diameter_2", "Diameter 2", 1),
      parameter("scale", "Scale", 1.6),
      parameter("z_add", "Z add", 0),
      parameter("y_add", "Y add", 0),
      parameter("x_add", "X add", 0),
      parameter("string_radius", "String radius", 0.1),
      parameter("apply_scale_add", "apply scale+add", 1, 0, 1),
      parameter("coord", "Coord (0..2)", 0, 0, 2),
      parameter("helix_count", "Helix count (1..16)", 2, 1, 16),
    ],
    20,
    16,
    0,
  ),
  hopalong: info(
    3,
    "numeric",
    [
      parameter("strength", "Strength", 1),
      parameter("alpha", "Alpha", -0.4),
      parameter("beta", "Beta", 1),
      parameter("gamma", "Gamma", 0.1),
      parameter("delta", "Delta", 0.1),
      parameter("epsilon", "Epsilon", 0.2),
    ],
    -1,
    16,
    0,
    1,
    "helper",
  ),
  "beth-2422": info(4, "numeric", [parameter("w_add", "W add", 0)], 4, 16, 4),
  "ides-formula": info(
    3,
    "numeric",
    [
      parameter("x_mul", "X mul", 1),
      parameter("y_mul", "Y mul", 2),
      parameter("z_mul", "Z mul", 1),
      parameter("xsub_mul", "Xsub mul", 0.5),
      parameter("zsub_mul", "Zsub mul", 0.5),
    ],
    0,
    16,
    0,
  ),
  "aex-octo": info(
    3,
    "numeric",
    [parameter("xz_mul", "XZ mul", 1.25), parameter("sq_mul", "Sq mul", 1)],
    0,
  ),
  "lambda-4dc": info(
    4,
    "numeric",
    [
      parameter("dx", "dx", 1),
      parameter("dy", "dy", 0),
      parameter("dz", "dz", 0),
      parameter("dw", "dw", 0),
    ],
    4,
  ),
  "barnsley-4dnc": info(
    4,
    "numeric",
    [
      parameter("dx", "dx", 1),
      parameter("dy", "dy", 0),
      parameter("dz", "dz", 0),
      parameter("dw", "dw", 0),
      parameter("w_add", "w add", 0),
      parameter("thresold", "Thresold", 0),
      parameter("conj_mode", "ConjMode", 0, 0, 1),
      parameter("flip_mode", "FlipMode", 0, 0, 1),
      parameter("tent_mode", "TentMode", 0, 0, 1),
    ],
    4,
  ),
  "kalisets-1": info(
    3,
    "numeric",
    [parameter("scale", "Scale", 1), parameter("fix", "Fix", 1e-60, 0, 1)],
    0,
    2,
    0,
  ),
  "menger-hyper": info(
    3,
    "ifs",
    [
      ...scaleParams(3, [1, 1, 0.5]),
      parameter("x_inv", "X inv", -0.75),
      parameter("y_inv", "Y inv", 0),
      parameter("z_inv", "Z inv", 0),
      parameter("max_radius", "MaxRadius", 0.318, 0, 4),
      parameter("min_radius", "MinRadius", 0.048, 0, 4),
      parameter("cent_rad_mul", "CentRadMul", 0.9, 0, 4),
      parameter("fold_again", "Fold again", 1, 0, 1),
    ],
    2,
    1024,
    0,
    0.4,
  ),
  "octahedron-4": info(
    4,
    "ifs",
    [
      ...scaleParams(2, [0, 1, 0, 0]),
      ...rotations("rotation", ["YZ", "XZ", "XY", "XW", "YW", "ZW"]).map(
        (p) => ({
          ...p,
          label: p
            .label!.replace("rotation", "Rotation")
            .replace(" (degrees)", ""),
        }),
      ),
    ],
    6,
    1024,
    2,
  ),
  "tglad-dihed": info(
    3,
    "numeric",
    [
      parameter("log2_power", "Log2Power (0 to 7)", 0, 0, 7),
      parameter("log2_map_power", "Log2MapPower (0 to 7)", 0, 0, 7),
    ],
    0,
  ),
  "scherk-fs": info(
    3,
    "difs",
    [
      parameter("log_base", "LogBase", 0.6),
      parameter("scale", "Scale", 2),
      parameter("z_add", "Z add", 0),
      parameter("y_add", "Y add", 0),
      parameter("x_add", "X add", 0),
      parameter("saddle_strength", "Saddle strength", 0.6),
      parameter("apply_scale_add", "Apply scale+add", 0, 0, 1),
      ...rotations("scherkrot").map((p) => ({
        ...p,
        label: p
          .label!.replace("scherkrot", "ScherkRot")
          .replace(" (degrees)", ""),
      })),
    ],
    20,
    16,
    0,
  ),
  "cubic-quat": info(
    4,
    "numeric",
    [
      parameter("x_mul", "X mul", 1),
      parameter("y_mul", "Y mul", 1),
      parameter("z_mul", "Z mul", 1),
      parameter("w_mul", "W mul", 1),
      parameter("w_add", "W add", 0),
      parameter("x_twist", "X twist", 0),
      parameter("y_twist", "Y twist", 0),
    ],
    4,
  ),
  "hopf-4d": info(
    4,
    "numeric",
    [parameter("w_add", "w add", 0), parameter("z_mul", "z mul", -1)],
    4,
  ),
  "quadray-brot": info(4, "numeric", [], 4),
  "aexion-1": info(4, "numeric", [parameter("c_add", "C add", -1.35)], 4),
  "menger-ifs": info(
    3,
    "ifs",
    [...scaleParams(3, [1, 1, 0.5]), ...rotations("rotation")],
    2,
    1024,
    0,
  ),
  "icosahedron-ifs": info(
    3,
    "ifs",
    [
      ...scaleParams(2, [0.809016994374947, 0.5, 0]),
      ...rotations("rotation1"),
      ...rotations("rotation2"),
    ],
    2,
    1024,
    0,
  ),
  "sierpinski-4": info(
    4,
    "ifs",
    [
      ...scaleParams(2, [1, 1, 1, 1]),
      ...rotations("rotation", ["YZ", "XZ", "XY", "XW", "YW", "ZW"]),
    ],
    6,
    1024,
    2,
    1.1,
  ),
  "tglad-tetra-2": info(
    3,
    "numeric",
    [
      parameter("log2_power", "Log2Power (0 to 7)", 0, 0, 7),
      parameter("log2_map_power", "Log2MapPower (0 to 7)", 0, 0, 7),
    ],
    0,
  ),
  "manowar-bulb": info(
    3,
    "numeric",
    [
      parameter("power", "Power", 8, 1, 16),
      parameter("z_mul", "z-Mul", -1),
      parameter("manowar_strength", "Manowar strength", -0.5),
      parameter("phoenix_strength", "Phoenix strength", 0.5),
      ...rotations("manowar_rot"),
    ],
    0,
  ),
  fuzzy: info(
    3,
    "numeric",
    [
      parameter("power", "Power", 8, 1, 16),
      parameter("y_multiplier", "Y multiplier", -1),
    ],
    0,
    16,
    0,
  ),
};

export function isKernelId(value: unknown): value is KernelId {
  return typeof value === "string" && Object.hasOwn(KERNELS, value);
}
export interface KernelState {
  v: V4;
  c: V4;
  first: boolean;
  history: V4;
  derivative: number;
  count: number;
  radiusSquared: number;
  /** Cached squared orbit-trap norm (OTrap); formula calls leave host bookkeeping intact. */
  trap: number;
  invalid: boolean;
  /** dIFS field and accumulated scale are never radius or the analytic derivative. */
  fieldValue: number;
  varyScale: number;
  bestDistance: number;
  bestIteration: number;
  originalPoint: number[];
  firstIteration: number;
  temporary: number;
  free: [number, number];
  extraDerivatives: [number, number];
  queryThreshold: number;
  mapPadding: number;
}
export type KernelParameters = Record<string, number>;
export interface PreparedKernel {
  id: KernelId;
  p: KernelParameters;
  matrices: Matrix[];
  sampleField?:FieldSampler;
}
export function prepareKernel(
  id: KernelId,
  p: KernelParameters,
  sampleField?:FieldSampler,
): PreparedKernel {
  const angles = (prefix: string, axes = ["x", "y", "z"]) =>
    axes.map((a) => p[`${prefix}_${a}`]!);
  const gateway=GATEWAY_DEFINITIONS.find(d=>d.id===id);
  const recreation=[...RECREATION_SIX_DEFINITIONS,...RECREATION_NINE_DEFINITIONS].find(d=>d.id===id);
  const matrices = id === "mb3d-kochcube" || id === "mb3d-helispiral" ? [rotation3(angles("rotation"))] : (FOLLOWUP_KERNEL_IDS as readonly string[]).includes(id) ? [] : id === "mb3d-rotatec" ? [rotation3(angles("rotation_c"))] : recreation ? recreation.rotations.map(prefix=>rotation3(angles(prefix))) : gateway ? gateway.rotation?[rotation3(angles('rotation'))]:[] : id === "mb3d-aboxplatinum" || id === "mb3d-aboxplatinumb" ? [rotation3(angles("rotate"))] : (ESSENTIALS_KERNEL_IDS as readonly string[]).includes(id)
    ? prepareEssentialsMatrices(id, p)
    : id === "menger-ifs" || id === "riemann-2"
      ? [rotation3(angles("rotation"))]
      : id === "icosahedron-ifs"
        ? [rotation3(angles("rotation1")), rotation3(angles("rotation2"))]
        : id === "manowar-bulb"
          ? [rotation3(angles("manowar_rot"))]
          : id === "scherk-fs"
            ? [rotation3(angles("scherkrot"))]
            : id === "sierpinski-4" || id === "octahedron-4"
              ? [
                  rotation4(
                    angles("rotation", ["yz", "xz", "xy", "xw", "yw", "zw"]),
                  ),
                ]
              : [];
  return { id, p, matrices, ...(sampleField?{sampleField}:{}) };
}

export function freshKernelState(v: V4, c: V4, dimension: 3 | 4): KernelState {
  return {
    v: [...v],
    c: [...c],
    first: false,
    history: [0, 0, 0, 0],
    derivative: 1,
    count: 0,
    radiusSquared: v.slice(0, dimension).reduce((s, x) => s + x * x, 0),
    trap: v.slice(0, dimension).reduce((s, x) => s + x * x, 0),
    invalid: false,
    fieldValue: 0,
    varyScale: 1,
    bestDistance: 65535,
    bestIteration: 0,
    originalPoint: v.slice(0, 3),
    firstIteration: 0,
    temporary: 0,
    free: [0, 0],
    extraDerivatives: [0, 0],
    queryThreshold: 0,
    mapPadding: 0,
  };
}

/** One formula call only. Counting, radius and trap belong to the host. See each numbered handoff. */
export function stepKernel(
  { id, p, matrices, sampleField }: PreparedKernel,
  state: KernelState,
): void {
  if (isImportedHelperId(id)) { stepImportedHelper(id, p, state); return; }
  if (id === "mb3d-absx") {
    state.v[0] = Math.abs(state.v[0] + p.fix_x!) - p.fix_x!;
    if (!state.v.every(Number.isFinite)) state.invalid = true;
    return;
  }
  if (id === "mb3d-absy") {
    state.v[1] = Math.abs(state.v[1] + p.fix_y!) - p.fix_y!;
    if (!state.v.every(Number.isFinite)) state.invalid = true;
    return;
  }
  if (id === "mb3d-absz") {
    state.v[2] = Math.abs(state.v[2] + p.fix_z!) - p.fix_z!;
    if (!state.v.every(Number.isFinite)) state.invalid = true;
    return;
  }
  if (id === "mb3d-celticmode") {
    const [x,y,z,w] = state.v;
    const shift = state.c[0] * p.good!;
    state.v = [Math.abs(x + shift) - shift + x * p.evil!, y,
      p.mystic! !== 0 ? Math.abs(z + state.c[2] * p.mystic!) - state.c[2] * p.heretic! : z, w];
    if (!state.v.every(Number.isFinite)) state.invalid = true;
    return;
  }
  if (id === "mb3d-reciprocalz3b") {
    const z = state.v[2], l1 = p.limiter1!, l2 = p.limiter2!;
    const a = 1 / Math.max(1e-40,l1) - 1 / (Math.abs(z * p.mul1!) + l1);
    const b = 1 / Math.max(1e-40,l2) - 1 / (Math.abs(z * z * p.mul2!) + l2);
    state.v[2] = (z < 0 || Object.is(z,-0) ? -1 : 1) * (a + b);
    if (!state.v.every(Number.isFinite)) state.invalid = true;
    return;
  }
  if (id === "mb3d-reciprocalx3b") {
    const x = state.v[0], l1 = p.limiter1!, l2 = p.limiter2!;
    const a = 1 / Math.max(1e-40,l1) - 1 / (Math.abs(x * p.mul1!) + l1);
    const b = 1 / Math.max(1e-40,l2) - 1 / (Math.abs(x * x * p.mul2!) + l2);
    state.v[0] = (x < 0 || Object.is(x,-0) ? -1 : 1) * (a + b);
    if (!state.v.every(Number.isFinite)) state.invalid = true;
    return;
  }
  if((AXIS_MAP_KERNEL_IDS as readonly string[]).includes(id)){stepAxisMapKernel(id as AxisMapKernelId,p,state);return;}
  if((C_VECTOR_KERNEL_IDS as readonly string[]).includes(id)){stepCVectorKernel(id as CVectorKernelId,p,matrices,state);return;}
  if((FOLLOWUP_KERNEL_IDS as readonly string[]).includes(id)){stepFollowupKernel({id,p,matrices},state);return;}
  if((BATCH05_KERNEL_IDS as readonly string[]).includes(id)){stepBatch05Kernel(id as Batch05KernelId,p,matrices,state);return;}
  if((BATCH06_KERNEL_IDS as readonly string[]).includes(id)){stepBatch06Kernel(id as Batch06KernelId,p,state);return;}
  if((BATCH07_KERNEL_IDS as readonly string[]).includes(id)){stepBatch07Kernel(id as Batch07KernelId,p,state);return;}
  if((BATCH08_KERNEL_IDS as readonly string[]).includes(id)){stepBatch08Kernel(id as Batch08KernelId,p,state);return;}
  if((GATEWAY_KERNEL_IDS as readonly string[]).includes(id)){stepGatewayKernel({id,p,matrices,sampleField},state);return;}
  if(id===ROOM_CLR_ID){stepRoomClr({id,p,matrices,sampleField},state);return;}
  if((UNLOCK09_KERNEL_IDS as readonly string[]).includes(id)){stepUnlock09({id,p,matrices,sampleField},state);return;}
  if((RECREATION_NINE_KERNEL_IDS as readonly string[]).includes(id)){stepRecreationNine({id,p,matrices,sampleField},state);return;}
  if((RECREATION_SIX_KERNEL_IDS as readonly string[]).includes(id)){stepRecreationSix({id,p,matrices,sampleField},state);return;}
  if ((ESSENTIALS_KERNEL_IDS as readonly string[]).includes(id)) {
    stepEssentialsKernel({ id, p, matrices }, state);
    return;
  }
  if (id === "mb3d-aboxplatinum") { stepPlatinum({id,p,matrices},state); return; }
  if (id === "mb3d-aboxplatinumb") { stepPlatinumB({id,p,matrices},state); return; }
  if(id==='mb3d-internal-amazingbox'){
    const q=state.v.slice(0,3).map(t=>Math.abs(t+p.fold!)-Math.abs(t-p.fold!)-t);
    const rr=q.reduce((n,t)=>n+t*t,0),low=Math.max(1e-40,p.min_r!)**2;
    const m=rr<low?p.scale!/low:rr<=1?p.scale!/rr:p.scale!;
    state.v=[m*q[0]!+state.c[0],m*q[1]!+state.c[1],m*q[2]!+state.c[2],m*state.v[3]];
    if(!state.v.every(Number.isFinite))state.invalid=true;return;
  }
  let [x, y, z, w] = state.v;
  const [cx, cy, cz, cw] = state.c;
  let next: V4 = [...state.v];
  switch (id) {
    case "faehrten":
    case "mandel-4d-bic":
    case "hyperd-1":
    case "makin-4d-p2a":
    case "sin-4d-plus":
    case "riemann-2":
    case "torus-ellip-ifs":
    case "klein-bagel-ifs":
    case "helix-ifs":
    case "hopalong":
      stepBatch03Kernel({ id, p, matrices }, state);
      return;
    case "beth-2422":
    case "ides-formula":
    case "aex-octo":
    case "lambda-4dc":
    case "barnsley-4dnc":
    case "kalisets-1":
    case "menger-hyper":
    case "octahedron-4":
    case "tglad-dihed":
    case "scherk-fs":
      stepBatch02Kernel({ id, p, matrices }, state);
      return;
    case "cubic-quat":
      next = [
        p.x_mul! * x * x -
          p.y_mul! * y * y -
          p.z_mul! * z * z -
          p.w_mul! * w * w +
          cx +
          p.x_twist! * cy,
        2 * p.y_mul! * x * y + cy + p.y_twist! * cx,
        2 * p.z_mul! * x * z + cz,
        2 * p.w_mul! * x * w + cw + p.w_add!,
      ];
      break;
    case "hopf-4d": {
      const a = x * x + y * y,
        b = z * z + w * w;
      if (!(a > 0 && b > 0)) {
        state.invalid = true;
        return;
      }
      const h = 1 - b / a,
        t = 2 * Math.sqrt(a / b);
      next = [
        (x * x - y * y) * h + cx,
        2 * x * y * h + cy,
        p.z_mul! * (z * z - w * w) * t + cz,
        z * w * t + cw + p.w_add!,
      ];
      break;
    }
    case "quadray-brot":
      next = quadraySquare(state.v).map(
        (a, i) => a + quadrayLift(state.c)[i]!,
      ) as V4;
      break;
    case "aexion-1": {
      if (!state.first) {
        state.first = true;
        state.firstIteration = 1;
        state.c = quadrayLift(state.c).map((a) => a + p.c_add!) as V4;
        state.v = quadrayLift(state.v).map((a) => a + p.c_add!) as V4;
      }
      next = quadraySquare(state.v).map((a, i) => a + state.c[i]!) as V4;
      break;
    }
    case "menger-ifs": {
      const s = p.scale!;
      if (s === 0) {
        state.invalid = true;
        return;
      }
      const u = applyMatrix(
        matrices[0]!,
        [Math.abs(x), Math.abs(y), Math.abs(z)].sort((a, b) => b - a),
      );
      const offset = (p.cscale_z! * (s - 1)) / s;
      next = [
        s * u[0]! - p.cscale_x! * (s - 1),
        s * u[1]! - p.cscale_y! * (s - 1),
        s * (offset - Math.abs(u[2]! - offset)),
        w,
      ];
      state.derivative *= s;
      break;
    }
    case "icosahedron-ifs": {
      const u = applyMatrix(
        matrices[1]!,
        goldenReflections(applyMatrix(matrices[0]!, [x, y, z]).map(Math.abs)),
      );
      next = [
        ...u.map(
          (a, i) => p.scale! * a - (p.scale! - 1) * p[`cscale_${"xyz"[i]}`]!,
        ),
        w,
      ] as V4;
      state.derivative *= p.scale!;
      break;
    }
    case "sierpinski-4":
      next = applyMatrix(matrices[0]!, pairReflections(state.v)).map(
        (a, i) => p.scale! * a - (p.scale! - 1) * p[`cscale_${"xyzw"[i]}`]!,
      ) as V4;
      state.derivative *= p.scale!;
      break;
    case "manowar-bulb": {
      if (!state.first) {
        state.first = true;
        state.history = [0, 0, 0, 0];
        return;
      }
      const r = Math.hypot(x, y, z);
      if (!(r > 0)) {
        state.invalid = true;
        return;
      }
      const old = state.history;
      state.history = [...state.v];
      const phi = p.power! * Math.atan2(y, x),
        theta = p.power! * Math.atan2(z, Math.hypot(x, y)),
        amplitude = r ** p.power!;
      const memory = applyMatrix(
        matrices[0]!,
        [old[0], old[1], old[3]].map((a) => a * p.manowar_strength!),
      );
      next = [
        amplitude * Math.cos(phi) * Math.cos(theta) +
          memory[0]! +
          p.phoenix_strength! * x +
          cx,
        amplitude * Math.sin(phi) * Math.cos(theta) +
          memory[1]! +
          p.phoenix_strength! * y +
          cy,
        amplitude * p.z_mul! * Math.sin(theta) +
          memory[2]! +
          p.phoenix_strength! * z +
          cz,
        w,
      ];
      break;
    }
    case "fuzzy": {
      const rho = state.radiusSquared,
        ratio = z / Math.sqrt(rho);
      if (!(rho > 0 && Math.abs(ratio) <= 1)) {
        state.invalid = true;
        return;
      }
      const k = (state.count + 1) * p.power!,
        theta = k * Math.asin(ratio),
        phi = k * Math.atan2(y, x),
        m = rho ** (p.power! - 1);
      next = [
        m * Math.cos(theta) * Math.cos(phi) + cx,
        m * Math.cos(theta) * Math.sin(phi) * p.y_multiplier! + cy,
        cz - m * Math.sin(theta),
        w,
      ];
      break;
    }
    case "tglad-tetra-2": {
      let sentinel = false;
      for (let outer = 0; outer < maskedPasses(p.log2_power!); outer++) {
        const rr = x * x + y * y + z * z;
        if (rr >= 1e10) {
          sentinel = true;
          break;
        }
        let radius = Math.sqrt(rr);
        const chart = stereographicChart(x, y, z, false);
        if (!chart) {
          state.invalid = true;
          return;
        }
        let [u, t] = chart;
        for (let inner = 0; inner < maskedPasses(p.log2_map_power!); inner++) {
          const s = u * u * u - 3 * u * t * t;
          if (s >= 1e10) {
            sentinel = true;
            break;
          }
          const bigT = t * t * t - 3 * t * u * u,
            den = bigT * bigT + (s + 0.3535533905932738) ** 2;
          if (den === 0) {
            state.invalid = true;
            return;
          }
          const aa =
              (s + 0.3535533905932738) * (2.8284271247461903 - s) - bigT * bigT,
            bb = 3.181980515339464 * bigT,
            cc = -0.3535533905932738 / den;
          [u, t] = [(aa * u - bb * t) * cc, (aa * t + bb * u) * cc];
          radius *= radius;
        }
        if (sentinel) break;
        [u, t] = [t, u];
        const inverse = inverseStereographicChart(u, t, radius, -1);
        if (!inverse) {
          state.invalid = true;
          return;
        }
        [x, y, z] = inverse as [number, number, number];
      }
      next = sentinel ? [1e10, 1e10, 1e10, w] : [x + cx, y + cy, z + cz, w];
      break;
    }
  }
  state.v = next;
  if (![...next, ...state.c, state.derivative].every(Number.isFinite))
    state.invalid = true;
}
