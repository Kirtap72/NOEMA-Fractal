/**
 * Relative camera moves for the AI bridge (MCP-02), built on the scene's own camera model (position, target, up, fov_degrees; a
 * right-handed system with Y up, as in glTF). Nothing here invents camera behaviour: it only moves `position`, `target`, `up` and
 * `fov_degrees`, which every renderer path already reads. Lens, depth of field and projection are left exactly as they were.
 *
 * Conventions (documented to the model in the tool description):
 *  - orbit_yaw_degrees:   positive moves the camera towards ITS right, around the target (the scene seems to turn left).
 *  - orbit_pitch_degrees: positive raises the camera (looking more from above); the elevation is limited to +-85 degrees.
 *  - dolly_factor:        2 = twice as close to the target, 0.5 = twice as far.
 *  - roll_degrees:        positive rolls the camera clockwise around the line of sight (the picture turns counter-clockwise).
 */
import type { SceneCamera, Vec3 } from '../../engine/camera';

export interface CameraMove {
  look_at?: Vec3;
  orbit_yaw_degrees?: number;
  orbit_pitch_degrees?: number;
  dolly_factor?: number;
  roll_degrees?: number;
  fov_degrees?: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d: number): number => (d * Math.PI) / 180;

/** Rotates v about the unit axis by `angle` radians (Rodrigues). */
function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)));
}

export const MIN_DISTANCE = 1e-4;
export const MAX_DISTANCE = 1e5;
export const MAX_ELEVATION_DEGREES = 85;
export class CameraMoveError extends Error {}

/** Returns a new camera. Throws CameraMoveError with a readable reason when the move would make the camera degenerate. */
export function moveCamera(camera: SceneCamera, move: CameraMove): SceneCamera {
  const cam: SceneCamera = { ...camera, position: [...camera.position] as Vec3, target: [...camera.target] as Vec3, up: [...camera.up] as Vec3 };
  if (len(cam.up) < 1e-9) throw new CameraMoveError('The up vector of the camera is zero.');
  const up = unit(cam.up);

  if (move.look_at) {
    cam.target = [...move.look_at] as Vec3;
    if (len(sub(cam.position, cam.target)) < MIN_DISTANCE) throw new CameraMoveError('The target point must not be the same as the position of the camera.');
  }
  let v = sub(cam.position, cam.target); // from the target to the camera
  let distance = len(v);
  if (!(distance >= MIN_DISTANCE)) throw new CameraMoveError('The camera and the target point coincide.');

  if (move.orbit_yaw_degrees || move.orbit_pitch_degrees) {
    const forward = mul(unit(v), -1);
    let right = cross(forward, up);
    if (len(right) < 1e-6) right = cross(forward, [0, 0, 1]);
    if (len(right) < 1e-6) right = cross(forward, [1, 0, 0]);
    right = unit(right);
    if (move.orbit_yaw_degrees) v = rotate(v, up, rad(move.orbit_yaw_degrees));
    if (move.orbit_pitch_degrees) {
      const elevation = Math.asin(Math.max(-1, Math.min(1, dot(unit(v), up)))) * 180 / Math.PI; // current elevation above the horizontal plane
      const wanted = Math.max(-MAX_ELEVATION_DEGREES, Math.min(MAX_ELEVATION_DEGREES, elevation + move.orbit_pitch_degrees));
      const delta = wanted - elevation;
      const sideAxis = unit(cross(up, unit(v))); // horizontal axis perpendicular to the current view direction
      // a positive rotation about up x v moves v DOWN, so the raise is the negative angle
      v = len(sideAxis) > 1e-6 ? rotate(v, sideAxis, -rad(delta)) : v;
    }
    cam.position = add(cam.target, mul(unit(v), distance));
  }

  if (move.dolly_factor !== undefined) {
    distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance / move.dolly_factor));
    cam.position = add(cam.target, mul(unit(sub(cam.position, cam.target)), distance));
  }

  if (move.roll_degrees) {
    const forward = unit(sub(cam.target, cam.position));
    cam.up = rotate(up, forward, rad(move.roll_degrees));
  }
  if (move.fov_degrees !== undefined) cam.fov_degrees = move.fov_degrees;

  for (const key of ['position', 'target', 'up'] as const) if (!cam[key].every(Number.isFinite)) throw new CameraMoveError('The movement gave invalid numbers.');
  if (len(sub(cam.position, cam.target)) < MIN_DISTANCE) throw new CameraMoveError('The movement would place the camera at the target point.');
  return cam;
}
