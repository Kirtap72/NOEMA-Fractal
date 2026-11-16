import { cameraBasis } from "./camera";
import type { SceneCamera, Vec3 } from "./camera";
import { verticalFovDegrees } from "./renderSetup";
import type { FovAxis } from "./renderSetup";

export interface CameraLens {
  focal_length_mm: number;
  sensor_width_mm: number;
}
export interface DepthOfField {
  enabled: boolean;
  focus_mode: "target" | "manual";
  focus_distance: number;
  aperture_radius: number;
}
export const defaultDof = (): DepthOfField => ({
  enabled: false,
  focus_mode: "target",
  focus_distance: 4,
  aperture_radius: 0.005,
});
export const fovFromLens = (focal: number, dimension: number): number =>
  (360 / Math.PI) * Math.atan(dimension / (2 * focal));
export const lensFromFov = (fov: number, dimension: number): number =>
  dimension / (2 * Math.tan((fov * Math.PI) / 360));
export const sensorDimension = (
  width: number,
  axis: FovAxis,
  aspect: number,
): number => (axis === "horizontal" ? width : width / aspect);
/** Legacy FOV stays authoritative until a lens is explicitly selected. Film gate keeps sensor width fixed. */
export function cameraFov(
  camera: SceneCamera,
  axis: FovAxis,
  width: number,
  height: number,
): number {
  const lens = camera.lens;
  return lens
    ? fovFromLens(
        lens.focal_length_mm,
        sensorDimension(lens.sensor_width_mm, axis, width / height),
      )
    : camera.fov_degrees;
}
export function focusDistance(camera: SceneCamera): number {
  return camera.dof?.focus_mode === "manual"
    ? camera.dof.focus_distance
    : Math.hypot(...camera.target.map((v, i) => v - camera.position[i]!));
}
/** Independent low-discrepancy aperture samples; centre sample keeps depth/normal layers pinhole-exact. */
export function lensSample(index: number, seed = 0): [number, number] {
  if (index === 0) return [0, 0];
  const frac = (x: number) => x - Math.floor(x);
  // Use separate dimensions from the R2 pixel jitter to avoid correlating aperture and pixel position.
  const inverse = (n: number, base: number) => {
    let value = 0,
      weight = 1 / base;
    while (n > 0) {
      value += (n % base) * weight;
      n = Math.floor(n / base);
      weight /= base;
    }
    return value;
  };
  const radius = Math.sqrt(frac(inverse(index, 5) + seed * 0.569840290998));
  const angle =
    2 * Math.PI * frac(inverse(index, 7) + seed * 0.7548776662466927);
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}
/** Reference ray geometry, shared by focus picking and tests; thin-lens focus plane is perpendicular to view. */
export function cameraRay(
  camera: SceneCamera,
  axis: FovAxis,
  width: number,
  height: number,
  x: number,
  y: number,
  lens: [number, number] = [0, 0],
): { origin: Vec3; direction: Vec3 } {
  const b = cameraBasis(camera),
    px = (2 * (x + 0.5) - width) / height,
    py = (height - 2 * (y + 0.5)) / height;
  const tan = Math.tan(
    (verticalFovDegrees(
      cameraFov(camera, axis, width, height),
      axis,
      width,
      height,
    ) *
      Math.PI) /
      360,
  );
  const orthographic = camera.projection === "orthographic";
  let origin: Vec3 = [...camera.position];
  let direction: Vec3 = b.forward.map((v, i) =>
    orthographic ? v : v + tan * (b.right[i]! * px + b.up[i]! * py),
  ) as Vec3;
  if (orthographic)
    origin = origin.map(
      (v, i) =>
        v +
        ((camera.ortho_height ?? 4) / 2) * (b.right[i]! * px + b.up[i]! * py),
    ) as Vec3;
  const length = Math.hypot(...direction);
  direction = direction.map((v) => v / length) as Vec3;
  if (
    camera.dof?.enabled &&
    !orthographic &&
    (lens[0] !== 0 || lens[1] !== 0)
  ) {
    const distance = focusDistance(camera),
      along = direction.reduce((s, v, i) => s + v * b.forward[i]!, 0);
    const target = origin.map((v, i) => v + (direction[i]! * distance) / along);
    origin = origin.map(
      (v, i) =>
        v +
        camera.dof!.aperture_radius *
          (b.right[i]! * lens[0] + b.up[i]! * lens[1]),
    ) as Vec3;
    direction = target.map((v, i) => v - origin[i]!) as Vec3;
    const len = Math.hypot(...direction);
    direction = direction.map((v) => v / len) as Vec3;
  }
  return { origin, direction };
}
