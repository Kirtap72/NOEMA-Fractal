import { cameraBasis, type SceneCamera, type Vec3 } from './camera';
import { cameraFov } from './cameraOptics';
import { verticalFovDegrees, type FovAxis } from './renderSetup';
import type { ClipPlane } from './renderDetails';

/** Local x/right, y/up, z/away from creation camera. Never follows the live camera. */
export interface BoxCut {
  enabled: boolean;
  outline: boolean;
  position: Vec3;
  axes: [Vec3, Vec3, Vec3];
  min: Vec3;
  max: Vec3;
  /** Creation/explicit-fit bounds, retained for the deliberate Reset Bounds action. */
  resetMin: Vec3;
  resetMax: Vec3;
}
export const BOX_MIN_THICKNESS = 1e-6;
export const BOX_FLOATS = 28;
const dot = (a: Vec3, b: Vec3) => a.reduce((n, v, i) => n + v * b[i]!, 0);
const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6);
export function readBoxCut(raw: unknown, errors: string[]): BoxCut | undefined {
  const start = errors.length;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push('cutout.box must be an object'); return; }
  const b = raw as Record<string, unknown>;
  if (typeof b.enabled !== 'boolean' || typeof b.outline !== 'boolean' || !vector(b.position)) errors.push('cutout.box needs enabled, outline and a finite position');
  if (!Array.isArray(b.axes) || b.axes.length !== 3 || !b.axes.every(vector)
    || b.axes.some((a, i, axes) => Math.abs(dot(a, a) - 1) > 1e-6 || axes.slice(i + 1).some(c => Math.abs(dot(a, c)) > 1e-6))) errors.push('cutout.box.axes must be orthonormal');
  for (const [lo, hi] of [['min', 'max'], ['resetMin', 'resetMax']] as const) {
    if (!vector(b[lo]) || !vector(b[hi]) || (b[lo] as Vec3).some((v, i) => (b[hi] as Vec3)[i]! - v < BOX_MIN_THICKNESS)) errors.push(`cutout.box.${lo}/${hi} require finite bounds at least ${BOX_MIN_THICKNESS} apart`);
  }
  if (errors.length !== start) return;
  return structuredClone({ enabled: b.enabled, outline: b.outline, position: b.position, axes: b.axes, min: b.min, max: b.max, resetMin: b.resetMin, resetMax: b.resetMax }) as BoxCut;
}
export function boxPoint(box: BoxCut, local: Vec3): Vec3 {
  return box.position.map((v, i) => v + box.axes.reduce((sum, axis, j) => sum + axis[i]! * local[j]!, 0)) as Vec3;
}
export function boxPlanes(box?: BoxCut): ClipPlane[] {
  if (!box?.enabled) return [];
  return box.axes.flatMap((axis, i) => [
    { enabled: true, invert: false, normal: axis.map(v => -v) as Vec3, offset: -dot(axis, box.position) - box.min[i]! },
    { enabled: true, invert: false, normal: [...axis] as Vec3, offset: dot(axis, box.position) + box.max[i]! },
  ]);
}
export function packBoxCut(box?: BoxCut): Float32Array {
  const out = new Float32Array(BOX_FLOATS);
  boxPlanes(box).forEach((p, i) => out.set([...p.normal, p.offset], i * 4));
  out[24] = box?.enabled ? 1 : 0;
  return out;
}
/** A finite view-aligned starting volume around the target, not a fit inferred from DE samples. */
export function createBoxFromView(camera: SceneCamera, axis: FovAxis, width: number, height: number): BoxCut {
  const basis = cameraBasis(camera), distance = Math.hypot(...camera.position.map((v, i) => v - camera.target[i]!));
  const halfHeight = camera.projection === 'orthographic' ? (camera.ortho_height ?? 4) / 2 : distance * Math.tan(verticalFovDegrees(cameraFov(camera, axis, width, height), axis, width, height) * Math.PI / 360);
  const half: Vec3 = [halfHeight * width / height, halfHeight, distance * 0.75].map(n => Math.max(1e-4, Math.min(1e5, n))) as Vec3;
  const min = half.map(n => -n) as Vec3;
  return { enabled: true, outline: true, position: [...camera.target], axes: [basis.right, basis.up, basis.forward], min, max: half, resetMin: [...min], resetMax: [...half] };
}
/** Scale around the volume centre, even after asymmetric wall edits. */
export function scaleBox(box: BoxCut, factor: number): BoxCut {
  const min = box.min.map((v, i) => (v + box.max[i]!) / 2 - (box.max[i]! - v) * factor / 2) as Vec3;
  const max = box.max.map((v, i) => (v + box.min[i]!) / 2 + (v - box.min[i]!) * factor / 2) as Vec3;
  return { ...box, min, max };
}
