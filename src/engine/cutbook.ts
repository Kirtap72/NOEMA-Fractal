/**
 * ARTIST-WORKFLOW 06: the geological cutbook ("Undersök insidan"). One OPEN clipping plane is moved through the fractal while camera and light stay
 * where they are, and interesting positions are kept as small named discoveries.
 *
 * What a clipping plane is here (renderDetails.ts, ClipPlane): it keeps the points with dot(normal, p) <= offset, or the opposite side when `invert`
 * is set. Nothing else happens: the surface is simply not drawn on the removed side, and the camera looks through the opening at the surface behind it.
 * It is an OPEN cut, not a solid cross-section: no cap, no filled slice and no inside colour is invented (that would need geometry the renderer does not
 * have). The panel says so in plain words, and no function here makes a cap.
 *
 * This file is pure arithmetic: the presets and their normals, the extent of the visible fractal along a normal (from points the renderer already
 * measured), the plane at a given depth of cut, and adding the plane to a scene. A plane is a uniform in the renderer, so moving it never recompiles a shader.
 */
import type { Vec3 } from "./camera";
import { MAX_CLIP_PLANES } from "./renderDetails";
import type { ClipPlane } from "./renderDetails";
import type { Scene } from "./scene";

export type CutPresetId = "horizontal" | "side" | "depth" | "camera";

export interface CutPreset {
  id: CutPresetId;
  label: string;
  /** The side that is kept when the cut begins: normal-side (false) or the opposite (true). */
  invert: boolean;
}

export const CUT_PRESETS: readonly CutPreset[] = [
  { id: "horizontal", label: "Horizontal cut (from above and down)", invert: false },
  { id: "side", label: "Vertical cut, left–right", invert: false },
  { id: "depth", label: "Vertical cut, forward–backward", invert: false },
  { id: "camera", label: "Across the camera (scale off the front)", invert: true },
];

export const OPEN_CUT_NOTE =
  "This is an open clip plane: the surface is cut away on one side and you see into the hollow shape. It is not a filled cross-section, and no cap or inner colour is drawn. Camera and light are locked while you explore. The artwork is not changed until you press Use.";

const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 1, 0];
};
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The unit normal of a preset in this scene (the camera preset follows the camera's view direction). */
export function presetNormal(id: CutPresetId, scene: Pick<Scene, "camera">): Vec3 {
  if (id === "horizontal") return [0, 1, 0];
  if (id === "side") return [1, 0, 0];
  if (id === "depth") return [0, 0, 1];
  const c = scene.camera;
  return unit([c.target[0] - c.position[0], c.target[1] - c.position[1], c.target[2] - c.position[2]]);
}

/** How far the visible fractal reaches along a normal: min and max of dot(normal, point), ignoring the outermost 0.5 % of points each way. */
export interface Extent {
  lo: number;
  hi: number;
}

/** From points (x, y, z per point) of the visible surface, as the renderer measured them. Null when there are too few points to say anything. */
export function extentAlong(points: ArrayLike<number>, normal: Vec3): Extent | null {
  const n = unit(normal);
  const values: number[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    const v = n[0] * points[i]! + n[1] * points[i + 1]! + n[2] * points[i + 2]!;
    if (Number.isFinite(v)) values.push(v);
  }
  if (values.length < 12) return null;
  values.sort((a, b) => a - b);
  const cut = Math.floor(values.length * 0.005);
  const lo = values[cut]!, hi = values[values.length - 1 - cut]!;
  if (!(hi - lo > 1e-9)) return null;
  return { lo, hi };
}

/** The extent when no measurement exists: a sphere around the camera's target as wide as half the viewing distance. */
export function fallbackExtent(scene: Pick<Scene, "camera">, normal: Vec3): Extent {
  const c = scene.camera, n = unit(normal);
  const radius = Math.max(1e-6, Math.hypot(c.target[0] - c.position[0], c.target[1] - c.position[1], c.target[2] - c.position[2]) * 0.5);
  const centre = dot(n, c.target as Vec3);
  return { lo: centre - radius, hi: centre + radius };
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * The plane at a depth of cut from 0 (nothing cut away: the plane is just outside the fractal) to 1 (everything cut away). The kept side is
 * dot <= offset normally and dot >= offset when inverted, so the offset runs from one end of the extent to the other accordingly.
 */
export function planeAtDepth(normal: Vec3, invert: boolean, extent: Extent, depth: number): ClipPlane {
  const f = clamp01(depth);
  const offset = invert ? extent.lo + f * (extent.hi - extent.lo) : extent.hi - f * (extent.hi - extent.lo);
  return { enabled: true, normal: unit(normal), offset: Number(offset.toPrecision(9)), invert };
}

/** The depth of cut (0 to 1) of a plane, the inverse of planeAtDepth; planes outside the extent sit at its ends. */
export function depthOfPlane(plane: Pick<ClipPlane, "offset" | "invert">, extent: Extent): number {
  const span = extent.hi - extent.lo;
  if (!(span > 0)) return 0;
  return clamp01(plane.invert ? (plane.offset - extent.lo) / span : (extent.hi - plane.offset) / span);
}

/** Why a plane cannot be added to this scene (Swedish), or undefined when it can. */
export function cutPlaneProblem(scene: Scene): string | undefined {
  if (!scene.content[0]) return "The scene has no fractal to inspect.";
  if (scene.cutout.planes.length >= MAX_CLIP_PLANES) return `The scene already has ${MAX_CLIP_PLANES} clip planes, the highest possible. Remove one in Clipping first.`;
  return undefined;
}

/** The scene with the plane added after the existing ones (they stay as they are). Same scene object when it cannot be added. */
export function withCutPlane(scene: Scene, plane: ClipPlane): Scene {
  if (cutPlaneProblem(scene)) return scene;
  return { ...scene, cutout: { ...scene.cutout, planes: [...scene.cutout.planes, { ...plane, normal: [...plane.normal] as Vec3 }] } };
}

/** A discovery: a position of the plane worth keeping, with the artist's own name and a small picture. */
export interface CutDiscovery {
  id: string;
  name: string;
  normal: Vec3;
  offset: number;
  invert: boolean;
  /** Which fractal it belongs to (the formula chain), so it is not offered in another. */
  world: string;
  /** "data:image/webp;base64,..." of the cut, small. Optional. */
  thumb?: string;
}

export const MAX_DISCOVERIES_PER_WORLD = 12;
