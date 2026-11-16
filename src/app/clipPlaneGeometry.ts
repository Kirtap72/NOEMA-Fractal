import { cameraBasis, type SceneCamera, type Vec3 } from "../engine/camera";
import type { ClipPlane } from "../engine/renderDetails";

export const dot = (a: Vec3, b: Vec3): number => a.reduce((s, v, i) => s + v * b[i]!, 0);
export const add = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v + b[i]!) as Vec3;
export const mul = (a: Vec3, k: number): Vec3 => a.map(v => v * k) as Vec3;
export const unit = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(...a));
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

/** Pivot closest to the view target, rather than a distant world-origin intercept. */
export function planePivot(plane: ClipPlane, target: Vec3): Vec3 {
  const n = unit(plane.normal);
  return add(target, mul(n, plane.offset - dot(n, target)));
}
export type ClipAlignment = "view" | "left" | "right" | "top" | "front";
export function alignClipPlane(plane: ClipPlane, camera: SceneCamera, alignment: ClipAlignment): ClipPlane {
  const basis = cameraBasis(camera);
  const normal = alignment === "view" ? basis.forward : alignment === "left" ? mul(basis.right, -1) : alignment === "right" ? basis.right : alignment === "top" ? basis.up : [0, 0, 1] as Vec3;
  // Remove the side facing the chosen direction. Presets always pass through the current view target.
  return { ...plane, enabled: true, normal, offset: dot(normal, camera.target), invert: alignment === "view" };
}
export function rotateClipPlane(plane: ClipPlane, pivot: Vec3, axis: Vec3, angle: number): ClipPlane {
  const n = unit(plane.normal), a = unit(axis), c = Math.cos(angle), s = Math.sin(angle);
  const normal = add(add(mul(n, c), mul(cross(a, n), s)), mul(a, dot(a, n) * (1 - c)));
  return { ...plane, normal, offset: dot(normal, pivot) };
}
/** CSS-pixel projection: independent of adaptive GPU resolution, DPR and image framing. */
export function projectPoint(point: Vec3, camera: SceneCamera, width: number, height: number): [number, number] | null {
  const b = cameraBasis(camera), v = add(point, mul(b.position, -1)), z = dot(v, b.forward);
  if (z <= 1e-6) return null;
  const k = camera.projection==='orthographic'?height/(camera.ortho_height??4):height / (2 * Math.tan(camera.fov_degrees * Math.PI / 360) * z);
  return [width / 2 + dot(v, b.right) * k, height / 2 - dot(v, b.up) * k];
}
export function worldUnitsPerPixel(pivot: Vec3, camera: SceneCamera, height: number): number {
  const depth = Math.max(1e-4, dot(add(pivot, mul(camera.position, -1)), cameraBasis(camera).forward));
  return (camera.projection==='orthographic'?camera.ortho_height??4:2 * depth * Math.tan(camera.fov_degrees * Math.PI / 360)) / Math.max(1, height);
}
