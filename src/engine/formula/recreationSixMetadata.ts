import type {KernelInfo} from './kernels';
export const RECREATION_SIX_KERNEL_IDS=["mb3d-reciprocaly3b", "mb3d-sierphilbert", "mb3d-trans-kochifs", "mb3d-heightmaplimifs"] as const;
export type RecreationSixKernelId=(typeof RECREATION_SIX_KERNEL_IDS)[number];
export const RECREATION_SIX_DEFINITIONS=[
  {
    "id": "mb3d-reciprocaly3b",
    "parameters": [
      {
        "name": "limiter1",
        "label": "Limiter1",
        "default": 0.67,
        "min": 1e-06,
        "max": 8
      },
      {
        "name": "limiter2",
        "label": "Limiter2",
        "default": 0.67,
        "min": 1e-06,
        "max": 8
      },
      {
        "name": "mul1",
        "label": "mul1",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "mul2",
        "label": "mul2",
        "default": 1,
        "min": -10000,
        "max": 10000
      }
    ],
    "dimension": 3,
    "method": "numeric",
    "wMode": "preserve",
    "hints": {
      "deoption": -1,
      "descale": 1,
      "adescale": 1,
      "rstop": 16,
      "sipow": 0
    },
    "rotations": [],
    "role": "helper",
    "mappingHelper": true,
    "helperMethods": [
      "numeric",
      "analytic"
    ]
  },
  {
    "id": "mb3d-sierphilbert",
    "parameters": [
      {
        "name": "scale",
        "label": "Scale",
        "default": 3,
        "min": 0.01,
        "max": 8
      },
      {
        "name": "cscale_x",
        "label": "CScale X",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "cscale_y",
        "label": "CScale Y",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "cscale_z",
        "label": "CScale Z",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation1_x",
        "label": "Rotation1 X",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation1_y",
        "label": "Rotation1 Y",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation1_z",
        "label": "Rotation1 Z",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation2_x",
        "label": "Rotation2 X",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation2_y",
        "label": "Rotation2 Y",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation2_z",
        "label": "Rotation2 Z",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "edge1",
        "label": "Edge1",
        "default": 2,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "edge2",
        "label": "Edge2",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "slice_w",
        "label": "slice_w",
        "default": 0,
        "min": -4,
        "max": 4
      },
      {
        "name": "constant_w",
        "label": "constant_w",
        "default": 0,
        "min": -4,
        "max": 4
      },
      {
        "name": "bailout_squared",
        "label": "bailout_squared",
        "default": 1024,
        "min": 1,
        "max": 65536
      }
    ],
    "dimension": 3,
    "method": "analytic",
    "wMode": "derivative",
    "hints": {
      "deoption": 2,
      "descale": 0.2,
      "adescale": 1,
      "rstop": 1024,
      "sipow": 2
    },
    "rotations": [
      "rotation1",
      "rotation2"
    ]
  },
  {
    "id": "mb3d-trans-kochifs",
    "parameters": [
      {
        "name": "add_x",
        "label": "Add X",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "add_y",
        "label": "Add Y",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "add_z",
        "label": "Add Z",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation_x",
        "label": "Rotation X",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation_y",
        "label": "Rotation Y",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation_z",
        "label": "Rotation Z",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "polyfold_order",
        "label": "PolyFold Order",
        "default": 5,
        "min": 1,
        "max": 128
      },
      {
        "name": "koch_angle",
        "label": "KochAngle",
        "default": -30,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "koch_sub",
        "label": "KochSub",
        "default": 0.333333333333,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "koch_scale",
        "label": "KochScale",
        "default": 3,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "koch_fix_x",
        "label": "KochFixX",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "koch_fix_z",
        "label": "KochFixZ",
        "default": 0,
        "min": -10000,
        "max": 10000
      }
    ],
    "dimension": 3,
    "method": "difs",
    "wMode": "preserve",
    "hints": {
      "deoption": 21,
      "descale": 1,
      "adescale": 1,
      "rstop": 16,
      "sipow": 0
    },
    "rotations": [
      "rotation"
    ],
    "role": "difs-transform"
  },
  {
    "id": "mb3d-heightmaplimifs",
    "parameters": [
      {
        "name": "map_nr",
        "label": "Map nr",
        "default": 10,
        "min": 1,
        "max": 16777216
      },
      {
        "name": "x_size",
        "label": "X size",
        "default": 0.5,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "y_size",
        "label": "Y size",
        "default": 0.5,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "thickness",
        "label": "Thickness",
        "default": -0.5,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "x_scale",
        "label": "X scale",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "y_scale",
        "label": "Y scale",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "h_scale",
        "label": "H scale",
        "default": -0.1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation_x",
        "label": "Rotation X",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation_y",
        "label": "Rotation Y",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation_z",
        "label": "Rotation Z",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "map_channel_0_2",
        "label": "Map channel (0..2)",
        "default": 0,
        "min": 0,
        "max": 2
      },
      {
        "name": "otrap_channel_0_2",
        "label": "OTrap channel (0..2)",
        "default": 1,
        "min": 0,
        "max": 2
      },
      {
        "name": "otrap_offset",
        "label": "OTrap offset",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "otrap_multiplier",
        "label": "OTrap multiplier",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "inside_render",
        "label": "inside_render",
        "default": 0,
        "min": 0,
        "max": 1
      },
      {
        "name": "de_stop",
        "label": "de_stop",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "source_variant",
        "label": "Original version: 0 = collected, 1 = newHeightmaps (centred UV)",
        "default": 1,
        "min": 0,
        "max": 1
      }
    ],
    "dimension": 3,
    "method": "difs",
    "wMode": "preserve",
    "hints": {
      "deoption": 20,
      "descale": 1,
      "adescale": 1,
      "rstop": 16,
      "sipow": 0
    },
    "rotations": [
      "rotation"
    ],
    "fieldMapParameter": "map_nr"
  }
] satisfies readonly (KernelInfo & {id:RecreationSixKernelId;rotations:readonly string[]})[];
