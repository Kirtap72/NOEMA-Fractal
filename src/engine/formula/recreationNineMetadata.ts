import type {KernelInfo} from './kernels';
export const RECREATION_NINE_KERNEL_IDS=["mb3d-asurfsmoothfold", "mb3d-boardifs", "mb3d-sphcageifs", "mb3d-transformifs"] as const;
export type RecreationNineKernelId=(typeof RECREATION_NINE_KERNEL_IDS)[number];
export const RECREATION_NINE_DEFINITIONS=[
  {
    "id": "mb3d-asurfsmoothfold",
    "parameters": [
      {
        "name": "scale",
        "label": "Scale",
        "default": 2,
        "min": 1e-06,
        "max": 10000
      },
      {
        "name": "min_r",
        "label": "Min R",
        "default": 0.5,
        "min": 1e-06,
        "max": 10000
      },
      {
        "name": "fold",
        "label": "Fold",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "scale_vary",
        "label": "Scale vary",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "sharpness",
        "label": "Sharpness (Integer 2+)",
        "default": 6,
        "min": 2,
        "max": 32
      },
      {
        "name": "fix_box",
        "label": "Fix (BoxFold)",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "ball_sharpness",
        "label": "Sh. of BallFold (Int 3+)",
        "default": 4,
        "min": 2,
        "max": 32
      },
      {
        "name": "fix_ball",
        "label": "Fix (BallFold)",
        "default": 0.3,
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
      "deoption": 11,
      "descale": 0.2,
      "adescale": 1,
      "rstop": 1024,
      "sipow": 2
    },
    "rotations": [
      "rotation1"
    ]
  },
  {
    "id": "mb3d-boardifs",
    "parameters": [
      {
        "name": "bump",
        "label": "Bump",
        "default": 0.1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "scale",
        "label": "Scale",
        "default": 1,
        "min": 1e-06,
        "max": 10000
      },
      {
        "name": "z_add",
        "label": "Z add",
        "default": -0.1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "y_add",
        "label": "Y add",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "x_add",
        "label": "X add",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "checker_scale",
        "label": "Checker scale",
        "default": 2,
        "min": 1e-06,
        "max": 10000
      },
      {
        "name": "apply_scale_add",
        "label": "Apply scale+add",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotate_x",
        "label": "Rotate X",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotate_y",
        "label": "Rotate Y",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotate_z",
        "label": "Rotate Z",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "variation",
        "label": "Variation",
        "default": 0,
        "min": 0,
        "max": 4
      },
      {
        "name": "otrapclr_1",
        "label": "OTrapClr 1",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "otrapclr_2",
        "label": "OTrapClr 2",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "otraponits",
        "label": "OTrapOnIts",
        "default": 0.1,
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
      "rotate"
    ]
  },
  {
    "id": "mb3d-sphcageifs",
    "parameters": [
      {
        "name": "sph_radius",
        "label": "SphRadius",
        "default": 0.5,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "scale",
        "label": "Scale",
        "default": 1,
        "min": 1e-06,
        "max": 10000
      },
      {
        "name": "z_add",
        "label": "Z add",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "y_add",
        "label": "Y add",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "x_add",
        "label": "X add",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "cage_radius",
        "label": "CageRadius",
        "default": 0.01,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "apply_scale_add",
        "label": "Apply scale+add",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "parals",
        "label": "Parals (2 to 1000)",
        "default": 8,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "merids",
        "label": "Merids",
        "default": 20,
        "min": 1,
        "max": 1000
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
    "rotations": []
  },
  {
    "id": "mb3d-transformifs",
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
        "name": "abs_x",
        "label": "Abs X",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "abs_y",
        "label": "Abs Y",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "abs_z",
        "label": "Abs Z",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "scale",
        "label": "Scale",
        "default": 1,
        "min": 1e-06,
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
  }
] satisfies readonly (KernelInfo & {id:RecreationNineKernelId;rotations:readonly string[]})[];
