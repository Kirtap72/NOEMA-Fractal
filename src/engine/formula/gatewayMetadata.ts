// Authorized gateway normalized registration; no executable legacy input.
export const GATEWAY_KERNEL_IDS=["mb3d-heightmapifs", "mb3d-polyfold-symifs", "mb3d-roundedbox", "mb3d-amazingifs", "mb3d-tetratubeifs"] as const;
export type GatewayKernelId=(typeof GATEWAY_KERNEL_IDS)[number];
export const GATEWAY_DEFINITIONS=[
  {
    "id": "mb3d-heightmapifs",
    "fieldMapParameter": "map_nr",
    "name": "HeightMapIFS",
    "parameters": [
      {
        "name": "map_nr",
        "label": "Map nr",
        "default": 10,
        "min": 0,
        "max": 16777216
      },
      {
        "name": "x_offset",
        "label": "X offset",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "y_offset",
        "label": "Y offset",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "h_offset",
        "label": "H offset",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "x_scale",
        "label": "X scale",
        "default": 0.2,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "y_scale",
        "label": "Y scale",
        "default": 0.2,
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
        "min": -16777216,
        "max": 16777216
      },
      {
        "name": "otrap_channel_0_2",
        "label": "OTrap channel (0..2)",
        "default": 1,
        "min": -16777216,
        "max": 16777216
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
        "label": "Inside rendering",
        "default": 0,
        "min": 0,
        "max": 1
      },
      {
        "name": "de_stop",
        "label": "Query fallback threshold",
        "default": 0,
        "min": -10000,
        "max": 10000
      }
    ],
    "dimension": 3,
    "method": "difs",
    "wMode": "preserve",
    "hints": {
      "version": 6,
      "deoption": 20,
      "descale": 1,
      "adescale": 1,
      "sipow": 0,
      "rstop": 16
    },
    "rotation": true
  },
  {
    "id": "mb3d-polyfold-symifs",
    "name": "PolyFold-symIFS",
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
        "min": -16777216,
        "max": 16777216
      },
      {
        "name": "atan2_fixer",
        "label": "Atan2 fixer",
        "default": 3.141592653589793,
        "min": -10000,
        "max": 10000
      }
    ],
    "dimension": 3,
    "method": "difs",
    "wMode": "preserve",
    "hints": {
      "version": 6,
      "deoption": 21,
      "descale": 1,
      "adescale": 1,
      "sipow": 0,
      "rstop": 16
    },
    "rotation": true,
    "role": "difs-transform",
    "helperMethods": [
      "difs"
    ]
  },
  {
    "id": "mb3d-roundedbox",
    "name": "RoundedBox",
    "parameters": [
      {
        "name": "z_halfwidth",
        "label": "Z halfwidth",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "y_halfwidth",
        "label": "Y halfwidth",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "x_halfwidth",
        "label": "X halfwidth",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "scale",
        "label": "Scale",
        "default": 2,
        "min": -10000,
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
        "default": 2,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "border",
        "label": "Border",
        "default": 0.1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "apply_scale_add",
        "label": "apply scale+add",
        "default": 1,
        "min": -16777216,
        "max": 16777216
      },
      {
        "name": "otrap_option_0_3",
        "label": "OTrap option (0..3)",
        "default": 0,
        "min": -16777216,
        "max": 16777216
      },
      {
        "name": "otrap_offset",
        "label": "OTrap offset",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "otrap_scale",
        "label": "OTrap scale",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "inside_render",
        "label": "Inside rendering",
        "default": 0,
        "min": 0,
        "max": 1
      },
      {
        "name": "de_stop",
        "label": "Query fallback threshold",
        "default": 0,
        "min": -10000,
        "max": 10000
      }
    ],
    "dimension": 3,
    "method": "difs",
    "wMode": "preserve",
    "hints": {
      "version": 6,
      "deoption": 20,
      "descale": 1,
      "adescale": 1,
      "sipow": 0,
      "rstop": 16
    },
    "rotation": false
  },
  {
    "id": "mb3d-amazingifs",
    "name": "amazingIFS",
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
        "default": 5,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation_y",
        "label": "Rotation Y",
        "default": 5,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotation_z",
        "label": "Rotation Z",
        "default": 5,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "fold_x",
        "label": "Fold X",
        "default": 0.5,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "fold_y",
        "label": "Fold Y",
        "default": 0.5,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "fold_z",
        "label": "Fold Z",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "p_1_min_r_gt_or_eq_1",
        "label": "1/Min R (gt or eq 1)",
        "default": 31,
        "min": -10000,
        "max": 10000
      }
    ],
    "dimension": 3,
    "method": "difs",
    "wMode": "preserve",
    "hints": {
      "version": 6,
      "deoption": 21,
      "descale": 1,
      "adescale": 1,
      "sipow": 0,
      "rstop": 16
    },
    "rotation": true,
    "role": "difs-transform",
    "helperMethods": [
      "difs"
    ]
  },
  {
    "id": "mb3d-tetratubeifs",
    "name": "tetratubeIFS",
    "parameters": [
      {
        "name": "radius",
        "label": "Radius",
        "default": 0.1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "sub_y",
        "label": "Sub Y",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "sub_z",
        "label": "Sub Z",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "scale",
        "label": "Scale",
        "default": 2,
        "min": -10000,
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
        "default": 3,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotate_xz",
        "label": "Rotate XZ",
        "default": 45,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "rotate_xy",
        "label": "Rotate XY",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "apply_scale_add",
        "label": "apply scale+add",
        "default": 1,
        "min": -16777216,
        "max": 16777216
      },
      {
        "name": "sphere_pos",
        "label": "Sphere pos",
        "default": 1.414,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "sphere_r",
        "label": "Sphere R",
        "default": 0.2,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "otclr_tube",
        "label": "OTClr Tube",
        "default": 1.0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "otclr_sphere",
        "label": "OTClr Sphere",
        "default": 2.0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "inside_render",
        "label": "Inside rendering",
        "default": 0,
        "min": 0,
        "max": 1
      },
      {
        "name": "de_stop",
        "label": "Query fallback threshold",
        "default": 0,
        "min": -10000,
        "max": 10000
      }
    ],
    "dimension": 3,
    "method": "difs",
    "wMode": "preserve",
    "hints": {
      "version": 6,
      "deoption": 20,
      "descale": 1,
      "adescale": 1,
      "sipow": 0,
      "rstop": 16
    },
    "rotation": false
  }
] as const;
