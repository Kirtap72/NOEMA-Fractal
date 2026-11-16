import type {KernelInfo} from './kernels';
export const UNLOCK09_KERNEL_IDS=['mb3d-roomdoorsifs'] as const;
export type Unlock09KernelId=(typeof UNLOCK09_KERNEL_IDS)[number];
// Selective integration of the already qualified RoomDoorsIFS component only.
export const UNLOCK09_DEFINITIONS=[
  {
    "id": "mb3d-roomdoorsifs",
    "parameters": [
      {
        "name": "wall_width",
        "label": "WofWall (- for roof)",
        "default": 0.1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "wall_height",
        "label": "HofWall",
        "default": 1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "door_height",
        "label": "HofDoor",
        "default": 0.65,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "scale",
        "label": "Scale",
        "default": 2,
        "min": 0.000001,
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
        "name": "door_position",
        "label": "Door pos (Y+)",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "wall_position",
        "label": "Wall pos (X+)",
        "default": -2,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "fold_order",
        "label": "PFOrder, apply if +",
        "default": -4,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "door_width",
        "label": "WofDoor",
        "default": 0.2,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "wall_angle",
        "label": "Wall Rho",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "door_angle",
        "label": "DoorSides Rho",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "door_period",
        "label": "DoorPeriod (0 OFF)",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "arc_radius",
        "label": "ArcR",
        "default": 1e-25,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "orbit_iterations",
        "label": "OTrapOnIts",
        "default": 0.1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "orbit_offset",
        "label": "OTrapOffset",
        "default": 0,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "orbit_roof",
        "label": "OTrapRoof (neg OFF)",
        "default": -1,
        "min": -10000,
        "max": 10000
      },
      {
        "name": "inside_render",
        "label": "Inside render",
        "default": 0,
        "min": 0,
        "max": 1
      },
      {
        "name": "de_stop",
        "label": "DE stop",
        "default": 0,
        "min": 0,
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
    }
  }
] satisfies readonly (KernelInfo & {id:Unlock09KernelId})[];
