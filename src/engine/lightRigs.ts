import { cameraBasis } from "./camera";
import type { CameraBasis, Vec3 } from "./camera";
import { MAX_LIGHTS, defaultLight } from "./lights";
import type { LightSettings } from "./lights";
import type { Scene } from "./scene";

/**
 * Camera-relative lighting rigs (ARTIST-LOOKS-02).
 *
 * A rig is a small arrangement of directional lights described from the camera's point of view: "from the upper right,
 * 40 degrees", not "from (0.6, 0.8, 0.4)". Applying a rig turns that description into ordinary world-space lights once,
 * using the camera as it is at that moment, and stores plain `scene.lights` entries. Nothing follows the camera
 * afterwards; moving the camera never changes the lighting. Applying again after a camera move computes a new world-space rig.
 *
 * Conventions (checked against lights.ts / shader.ts):
 * - `LightSettings.direction` is the way the light TRAVELS. The shader lights a surface with `toLight = -direction`.
 *   So a light that comes from a source direction `s` (from the subject towards the light) is stored as `-s`.
 * - The camera axes are `cameraBasis`: right, up (after roll, from `camera.up`), forward. The same axes are used for
 *   perspective and orthographic cameras, because only the projection differs.
 * - Angles: azimuth 0 = from the camera, +90 = from the camera's right, 180 = from behind the subject.
 *   Elevation +90 = from straight above (the camera's up).
 */

export interface RigLightTemplate {
  /** Short id part. The light's id becomes `rig-<rig id>-<role>` so that applying a rig again replaces the same lights. */
  role: string;
  name: string;
  azimuth: number;
  elevation: number;
  color: string;
  intensity: number;
  /** The one light that gets soft shadows if the artist asks for them. */
  shadowCaster?: boolean;
}

export interface LightRig {
  id: string;
  name: string;
  description: string;
  lights: readonly RigLightTemplate[];
}

/**
 * Starting points, not certified lighting. Two lights each. Intensities are for directional lights, where the old fixed
 * sun was 0.88. Shadows are off unless the artist chooses them (they cost render time and are not validated here).
 */
export const LIGHT_RIGS: readonly LightRig[] = [
  {
    id: "soft-studio",
    name: "Soft studio",
    description: "A clear main light obliquely from above right and a weaker, cooler fill light from the left. Calm and readable.",
    lights: [
      { role: "key", name: "Rig · Main light", azimuth: 40, elevation: 35, color: "#fff1de", intensity: 1.0, shadowCaster: true },
      { role: "fill", name: "Rig · Fill", azimuth: -60, elevation: 10, color: "#dfe7ff", intensity: 0.3 },
    ],
  },
  {
    id: "side-drama",
    name: "Dramatic side light",
    description: "A strong light almost from the side that makes the shapes cast clear shadows, with a weak fill light so that the shadows do not become completely black.",
    lights: [
      { role: "key", name: "Rig · Side light", azimuth: 85, elevation: 20, color: "#fff0d8", intensity: 1.3, shadowCaster: true },
      { role: "fill", name: "Rig · Weak fill", azimuth: -70, elevation: 5, color: "#9fb4d6", intensity: 0.1 },
    ],
  },
  {
    id: "rim-back",
    name: "Backlight / rim light",
    description: "A light behind the subject that can give bright edges, and a moderate main light from the front so that the subject is still visible. The outline depends on the shape of the subject and is not guaranteed.",
    lights: [
      { role: "back", name: "Rig · Backlight", azimuth: 160, elevation: 25, color: "#ffffff", intensity: 1.0, shadowCaster: true },
      { role: "key", name: "Rig · Main light", azimuth: -35, elevation: 30, color: "#ffeedd", intensity: 0.45 },
    ],
  },
];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/** The unit vector from the subject towards a light that sits at (azimuth, elevation) as seen from the camera. */
export function rigSourceDirection(basis: Pick<CameraBasis, "right" | "up" | "forward">, azimuthDegrees: number, elevationDegrees: number): Vec3 {
  const a = rad(azimuthDegrees);
  const e = rad(elevationDegrees);
  const x = Math.sin(a) * Math.cos(e); // to the camera's right
  const y = Math.sin(e); // up
  const z = Math.cos(a) * Math.cos(e); // towards the camera (against forward)
  return norm([
    basis.right[0] * x + basis.up[0] * y - basis.forward[0] * z,
    basis.right[1] * x + basis.up[1] * y - basis.forward[1] * z,
    basis.right[2] * x + basis.up[2] * y - basis.forward[2] * z,
  ]);
}

/** The stored light direction: the way the light travels, the opposite of where it comes from. */
export function rigLightDirection(basis: Pick<CameraBasis, "right" | "up" | "forward">, azimuthDegrees: number, elevationDegrees: number): Vec3 {
  const s = rigSourceDirection(basis, azimuthDegrees, elevationDegrees);
  return [-s[0], -s[1], -s[2]];
}

export type RigMode = "replace-directional" | "add";

export interface RigOptions {
  /** Soft shadows on the rig's main light. Off by default: shadows cost time and are an explicit choice. */
  shadows?: boolean;
}

export interface RigPlan {
  ok: true;
  rig: LightRig;
  mode: RigMode;
  /** How many existing lights go away: all directional ones, or only an earlier copy of this rig. */
  removed: number;
  /** Lights that stay exactly as they are (spots and points, and with "add" also the directional ones). */
  kept: number;
  added: number;
  total: number;
  summary: string;
}
export interface RigRefusal {
  ok: false;
  message: string;
}
export interface RigApplied extends Omit<RigPlan, "ok"> {
  ok: true;
  scene: Scene;
  /** The effective world-space lights written, for the record and for the tests. */
  lights: LightSettings[];
}

const rigLightId = (rig: LightRig, template: RigLightTemplate): string => `rig-${rig.id}-${template.role}`;

/** Light ids that an animation track drives. Removing such a light would silently break the animation. */
function animatedLightIds(scene: Scene): Set<string> {
  const ids = new Set<string>();
  for (const track of scene.cameraFlight?.tracks.slice(1) ?? []) if (track.target.kind === "light") ids.add(track.target.objectId);
  return ids;
}

/** What applying would do, or why it cannot. Reads only; never changes anything. */
export function planRig(scene: Scene, rigId: string, mode: RigMode): RigPlan | RigRefusal {
  const rig = LIGHT_RIGS.find((r) => r.id === rigId);
  if (!rig) return { ok: false, message: `Unknown light rig "${rigId}". No change.` };
  const rigIds = new Set(rig.lights.map((t) => rigLightId(rig, t)));
  const goes = (l: LightSettings): boolean => (l.id !== undefined && rigIds.has(l.id)) || (mode === "replace-directional" && l.type === "directional");
  const removedLights = scene.lights.filter(goes);
  const kept = scene.lights.length - removedLights.length;
  const added = rig.lights.length;
  const total = kept + added;
  if (total > MAX_LIGHTS) {
    const over = total - MAX_LIGHTS;
    return {
      ok: false,
      message: `The rig gives ${total} lights but at most ${MAX_LIGHTS} may exist. Remove ${over} lights` + (mode === "add" ? ' or choose "Replace directional lights"' : "") + ". No lights have been changed.",
    };
  }
  // Rig lights keep their ids when applied again, so an animation bound to one of them survives. Any other light that goes
  // away and is driven by an animation would leave a track without a target.
  const animated = animatedLightIds(scene);
  const blocked = removedLights.find((l) => l.id !== undefined && animated.has(l.id) && !rigIds.has(l.id));
  if (blocked) return { ok: false, message: `The light "${blocked.name ?? blocked.id}" is controlled by an animation and would be removed. Remove the animation track first or choose "Add the rig". No lights have been changed.` };
  if (!(Number.isFinite(scene.camera.position[0]) && Number.isFinite(scene.camera.target[0]))) return { ok: false, message: "The camera is invalid. No change." };
  const otherKept = scene.lights.filter((l) => !goes(l));
  const keptSpots = otherKept.filter((l) => l.type !== "directional").length;
  const summary =
    `${removedLights.length ? `Removes ${removedLights.length} lights` : "Removes no light"}` +
    `${keptSpots ? `, keeps ${keptSpots} spot/point lights unchanged` : ""}` +
    `${mode === "add" && otherKept.length - keptSpots ? `, keeps ${otherKept.length - keptSpots} directional lights` : ""}` +
    ` and adds ${added}. In total ${total} of ${MAX_LIGHTS} lights.`;
  return { ok: true, rig, mode, removed: removedLights.length, kept, added, total, summary };
}

/**
 * Applies a rig to a scene copy. Only `lights` changes: ambient, environment, fog, camera, DOF, material, gradient,
 * formula and everything else stay the very same objects. Lights that stay keep their position in the list and their
 * ids; the rig's lights come last, with stable ids (`rig-<rig>-<role>`).
 */
export function applyRig(scene: Scene, rigId: string, mode: RigMode, options: RigOptions = {}): RigApplied | RigRefusal {
  const plan = planRig(scene, rigId, mode);
  if (!plan.ok) return plan;
  const { rig } = plan;
  const basis = cameraBasis(scene.camera);
  const rigIds = new Set(rig.lights.map((t) => rigLightId(rig, t)));
  const stays = (l: LightSettings): boolean => !((l.id !== undefined && rigIds.has(l.id)) || (mode === "replace-directional" && l.type === "directional"));
  const made: LightSettings[] = rig.lights.map((t) => ({
    ...defaultLight(),
    id: rigLightId(rig, t),
    name: t.name,
    enabled: true,
    type: "directional",
    color: t.color,
    intensity: t.intensity,
    direction: rigLightDirection(basis, t.azimuth, t.elevation),
    shadows: options.shadows && t.shadowCaster ? "soft" : "none",
    shadow_softness: options.shadows && t.shadowCaster ? 0.4 : defaultLight().shadow_softness,
  }));
  if (!made.every((l) => l.direction.every(Number.isFinite))) return { ok: false, message: "The direction of the camera could not be calculated. No change." };
  const lights = [...scene.lights.filter(stays), ...made];
  const { ok: _ok, ...rest } = plan;
  return { ok: true, ...rest, scene: { ...scene, lights }, lights: made };
}

/** Where a light really comes from, seen from the camera, for the tests and for the readout: the opposite of its direction. */
export function sourceSeenFromCamera(basis: Pick<CameraBasis, "right" | "up" | "forward">, light: Pick<LightSettings, "direction">): { right: number; up: number; towardCamera: number } {
  const s = norm([-light.direction[0], -light.direction[1], -light.direction[2]]);
  return { right: dot(s, basis.right), up: dot(s, basis.up), towardCamera: -dot(s, basis.forward) };
}
