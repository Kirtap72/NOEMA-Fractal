import { focusAtPoint } from "../engine/focusScale";
import type { Scene } from "../engine/scene";
import type { Vec3 } from "../engine/camera";
import { aimPixel } from "./lightAim";
import type { AimPixel, AimRect } from "./lightAim";

export interface FocusPickHooks {
  scene(): Scene;
  /** The displayed picture's rectangle and film, or a zero rectangle when the picture is older than the scene. */
  rect(): AimRect;
  available(): boolean;
  /** The engine's real surface query for one film pixel. Null means the ray hit nothing. */
  pick(pixel: AimPixel): Promise<{ position: Vec3 } | null>;
  /** Called once with the next scene; the caller makes it one Undo step. */
  commit(next: Scene): void;
  changed(): void;
}

/**
 * "Fokusera här": one cancellable intent that sets the depth-of-field focus from a picked fractal surface.
 * It reuses the LIGHT-02A pixel mapping (`aimPixel`) and the same stale-result rules as `SurfaceAim`, and it changes
 * only `camera.dof` (see `focusAtPoint`). The orbit/pivot target, the camera and the framing are never touched, unlike the
 * double-click focus which moves `camera.target`.
 */
export class FocusPick {
  armed = false;
  busy = false;
  message = "";
  /** The most recent successful focus, for the readout. */
  last?: { distance: number; rayLength: number; offAxisDegrees: number; pixel: AimPixel };
  private ticket = 0;

  constructor(private hooks: FocusPickHooks) {}

  start(): boolean {
    if (this.busy || !this.hooks.available()) return false;
    if (this.hooks.scene().camera.projection === "orthographic") {
      this.message = "Focus only applies to perspective cameras. DOF is not supported with an orthographic camera. No change.";
      this.hooks.changed();
      return false;
    }
    this.ticket++;
    this.armed = true;
    this.message = "Click a visible surface to focus on it. The camera is not moved. Esc cancels.";
    this.hooks.changed();
    return true;
  }

  cancel(): void {
    this.ticket++;
    this.armed = false;
    this.message = "The focus pick was cancelled. The scene is unchanged.";
    this.hooks.changed();
  }

  async at(clientX: number, clientY: number): Promise<void> {
    if (!this.armed || this.busy || !this.hooks.available()) return;
    const rect = { ...this.hooks.rect() };
    const pixel = aimPixel(rect, clientX, clientY);
    if (!pixel) {
      this.message = "Outside the picture area. No change.";
      this.hooks.changed();
      return;
    }
    const scene = this.hooks.scene();
    const ticket = ++this.ticket;
    this.busy = true;
    this.message = "Searching for the actual surface…";
    this.hooks.changed();
    try {
      const hit = await this.hooks.pick(pixel);
      if (ticket !== this.ticket) return; // cancelled while the GPU was working
      if (scene !== this.hooks.scene() || JSON.stringify(rect) !== JSON.stringify(this.hooks.rect())) {
        this.armed = false;
        this.message = "The view or scene changed during the search. No change.";
        return;
      }
      if (!hit) {
        this.message = "No surface was hit. Choose a surface or cancel with Esc.";
        return;
      }
      const result = focusAtPoint(scene, hit.position);
      if (!result.ok) {
        this.message = result.message;
        return;
      }
      this.hooks.commit(result.scene);
      this.armed = false;
      this.last = { distance: result.distance, rayLength: result.rayLength, offAxisDegrees: result.offAxisDegrees, pixel };
      this.message =
        `Focus set at ${result.distance.toPrecision(5)} scene units along the optical axis` +
        (result.offAxisDegrees >= 0.5 ? ` (the surface is ${result.offAxisDegrees.toFixed(1)}° from the centre, ray length ${result.rayLength.toPrecision(5)})` : "") +
        ". The camera is unchanged." +
        (scene.camera.dof?.enabled ? "" : " DOF is turned off: turn it on to see the effect.");
    } catch (error) {
      if (ticket === this.ticket) {
        this.armed = false;
        this.message = "The surface search failed. No change. " + (error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.busy = false;
      this.hooks.changed();
    }
  }
}
