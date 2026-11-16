import { cameraBasis } from "./camera";
import { cameraFov } from './cameraOptics';
import type { Vec3 } from "./camera";
import { evaluateAnimation, frameTimes } from "./animationPlayback";
import type { Timing } from "./animationPlayback";
import { outputSize, verticalFovDegrees } from "./renderSetup";
import type { Scene } from "./scene";

/**
 * The camera of an animation, sampled at every frame, in the form other programs use.
 * Coordinates are the engine's own: right-handed, Y up. The camera looks along its own -Z axis with +Y up
 * (this is how glTF defines cameras, and Blender's importer expects it).
 */
export interface CameraTrack {
  fps: number;
  /** Seconds from the start, one per frame. */
  times: number[];
  /** x, y, z per frame. */
  positions: Float32Array;
  /** Rotation as a quaternion (x, y, z, w) per frame. */
  rotations: Float32Array;
  /** Vertical field of view in radians (glTF always measures it vertically). */
  yfov: number;
  /** Width divided by height of the picture. */
  aspect: number;
  /** True if the field of view changes during the animation (glTF cannot animate it, so the first value is used). */
  fovChanges: boolean;
}

/** A quaternion (x, y, z, w) from a rotation whose axes are the columns right, up and back (back = -forward). */
export function quaternionFromAxes(right: Vec3, up: Vec3, back: Vec3): [number, number, number, number] {
  const m00 = right[0], m10 = right[1], m20 = right[2];
  const m01 = up[0], m11 = up[1], m21 = up[2];
  const m02 = back[0], m12 = back[1], m22 = back[2];
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

/** Turns a vector by a quaternion (x, y, z, w). */
export function rotateByQuaternion(q: readonly number[], v: Vec3): Vec3 {
  const [x, y, z, w] = q as [number, number, number, number];
  // v' = v + 2w (q x v) + 2 q x (q x v)
  const cx = y * v[2] - z * v[1];
  const cy = z * v[0] - x * v[2];
  const cz = x * v[1] - y * v[0];
  return [
    v[0] + 2 * (w * cx + y * cz - z * cy),
    v[1] + 2 * (w * cy + z * cx - x * cz),
    v[2] + 2 * (w * cz + x * cy - y * cx),
  ];
}

/**
 * Samples the camera of the scene's animation at every frame (or every `step`-th frame), using the same
 * timing as the preview and the rendering, so the exported path matches the pictures.
 * `windowAspect` is the proportions to use when the scene's format is "free" (it follows the window).
 */
export function sampleCameraTrack(scene: Scene, timing: Timing | null, step = 1, windowAspect = 16 / 9): CameraTrack {
  const size=outputSize(scene.render,windowAspect),aspect=size.width/size.height;
  const times = frameTimes(scene.animation, step);
  const positions = new Float32Array(times.length * 3);
  const rotations = new Float32Array(times.length * 4);
  let previous: number[] | null = null;
  const firstCamera=evaluateAnimation(scene, times[0]!, timing).camera;
  if(firstCamera.projection==='orthographic')throw Error('Orthographic camera path export is not supported by the perspective glTF exporter.');
  const firstFov = cameraFov(firstCamera,scene.render.fov_axis,aspect,1);
  let fovChanges = false;
  times.forEach((t, i) => {
    const camera = evaluateAnimation(scene, t, timing).camera;
    if(camera.projection==='orthographic')throw Error('Orthographic camera path export is not supported by the perspective glTF exporter.');
    if (Math.abs(cameraFov(camera,scene.render.fov_axis,aspect,1) - firstFov) > 1e-6) fovChanges = true;
    const basis = cameraBasis(camera);
    positions.set(basis.position, i * 3);
    const back: Vec3 = [-basis.forward[0], -basis.forward[1], -basis.forward[2]];
    let q: number[] = quaternionFromAxes(basis.right, basis.up, back);
    // q and -q are the same rotation. Keep neighbours on the same side so players do not spin the long way round.
    if (previous && q[0]! * previous[0]! + q[1]! * previous[1]! + q[2]! * previous[2]! + q[3]! * previous[3]! < 0) q = q.map((v) => -v);
    rotations.set(q, i * 4);
    previous = q;
  });
  // The shader and glTF both want the vertical angle; a horizontal angle is converted with the picture's proportions.
  const yfovDegrees = verticalFovDegrees(firstFov, scene.render.fov_axis, aspect, 1);
  return { fps: scene.animation.fps / Math.max(1, Math.round(step)), times, positions, rotations, yfov: (yfovDegrees * Math.PI) / 180, aspect, fovChanges };
}
