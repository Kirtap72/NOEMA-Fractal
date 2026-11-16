import type { SceneCamera, Vec3 } from "../engine";
import { cameraBasis } from "../engine/camera";

const MAX_PITCH = (89 * Math.PI) / 180;

/** Mouse control: circles around a target point. Drag to rotate, wheel to zoom. */
export class OrbitCamera {
  yaw = 0.6;
  pitch = 0.35;
  distance = 4;
  target: Vec3 = [0, 0, 0];

  private up: Vec3 = [0, 1, 0];
  private pole: Vec3 = [0, 1, 0];
  private x: Vec3 = [1, 0, 0];
  private z: Vec3 = [0, 0, 1];

  constructor(
    public minDistance = 0,
    public maxDistance = Infinity,
  ) {}

  /** dx, dy are in radians. */
  rotate(dx: number, dy: number): void {
    this.yaw += dx;
    this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, this.pitch + dy));
  }

  /** factor > 1 moves away, factor < 1 moves closer. */
  zoom(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance * factor));
    // Double-precision pose must remain distinguishable from its target. No scene-unit floor.
    this.distance = Math.max(this.distance, Number.EPSILON * Math.max(...this.target.map(Math.abs), Number.MIN_VALUE) * 8, Number.MIN_VALUE);
  }

  /** Moves the point the camera looks at, sideways and up/down as seen from the camera. dx, dy in pixels. */
  pan(dx: number, dy: number, unitsPerPixel = this.distance * 0.0016): void {
    const { right: r, up } = cameraBasis(this.toSceneCamera(50));
    const k = unitsPerPixel;
    this.target = [
      this.target[0] - r[0] * dx * k + up[0] * dy * k,
      this.target[1] - r[1] * dx * k + up[1] * dy * k,
      this.target[2] - r[2] * dx * k + up[2] * dy * k,
    ];
  }

  position(): Vec3 {
    const cp = Math.cos(this.pitch);
    return this.target.map((v, i) => v + this.distance * (cp * Math.sin(this.yaw) * this.x[i]! + Math.sin(this.pitch) * this.pole[i]! + cp * Math.cos(this.yaw) * this.z[i]!)) as Vec3;
  }

  /** The camera as written in a scene file. */
  toSceneCamera(fovDegrees: number): SceneCamera {
    return { position: this.position(), target: [...this.target], up: [...this.up], fov_degrees: fovDegrees };
  }

  /** Continues from a camera loaded from a scene file. */
  setFromSceneCamera(camera: SceneCamera): void {
    const [dx, dy, dz] = [
      camera.position[0] - camera.target[0],
      camera.position[1] - camera.target[1],
      camera.position[2] - camera.target[2],
    ];
    const d = Math.hypot(dx, dy, dz);
    this.target = [...camera.target];
    this.distance = d;
    this.up = [...camera.up];
    const basis = cameraBasis(camera);
    const length = Math.hypot(...camera.up);
    this.pole = camera.up.map(v => v / length) as Vec3;
    const delta: Vec3 = [dx / d, dy / d, dz / d];
    const vertical = delta.reduce((s, v, i) => s + v * this.pole[i]!, 0);
    const horizontal = delta.map((v, i) => v - vertical * this.pole[i]!) as Vec3;
    const h = Math.hypot(...horizontal);
    this.z = h > 1e-12 ? horizontal.map(v => v / h) as Vec3 : basis.up;
    this.x = [this.pole[1]*this.z[2]-this.pole[2]*this.z[1], this.pole[2]*this.z[0]-this.pole[0]*this.z[2], this.pole[0]*this.z[1]-this.pole[1]*this.z[0]];
    this.pitch = Math.asin(Math.max(-1, Math.min(1, vertical)));
    this.yaw = 0;
  }
}
