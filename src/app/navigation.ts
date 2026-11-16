import { cameraRay } from '../engine/cameraOptics';
import type { SceneCamera, Vec3 } from '../engine/camera';
import type { Engine } from '../engine/engine';
import type { Scene } from '../engine/scene';
import { readNumber, setInputValue, isNumericEditing } from './numericRange';

/** What the mouse wheel does: "fly" moves the camera and the focus point together (steady speed, passes through the surface and the focus); "focus" moves the camera towards the focus point, a fixed share of the remaining distance each time (it slows down and never reaches the point). */
export type WheelMode = 'fly' | 'focus';
export interface NavigationSettings { speed: number; sensitivity: number; wheel: WheelMode }
export const DEFAULT_NAVIGATION: NavigationSettings = { speed: 1, sensitivity: 1, wheel: 'fly' };
/**
 * One wheel step in "fly" mode. `factor` is the dolly factor of the step (below 1 = forward). The focus point is moved along the view direction by the same distance
 * as the camera, so the distance between them does not change and the next step is exactly as long: the speed is steady, whatever is in the way.
 * Returns the new focus point (the camera follows from the orbit state).
 */
export function flyWheelTarget(position: Vec3, target: Vec3, distance: number, factor: number): Vec3 {
  const d = Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]);
  if (!(d > 0) || !Number.isFinite(factor)) return target;
  const step = (1 - factor) * distance / d; // forward when factor < 1, backwards when above
  return [target[0] + (target[0] - position[0]) * step, target[1] + (target[1] - position[1]) * step, target[2] + (target[2] - position[2]) * step];
}
/** Wheel deltas vary between mice/trackpads; bound each event so the focus can never be crossed. */
export function dollyFactor(delta: number, mode: number, settings: NavigationSettings, shift = false, ctrl = false): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? 800 : 1);
  const fine = ctrl ? 0.01 : shift ? 0.1 : 1;
  return Math.exp(Math.max(-0.25, Math.min(0.25, pixels * 0.0005 * settings.speed * settings.sensitivity)) * fine);
}
/** Reconstruct the same pixel-centre ray used by WGSL, including horizontal-FOV scenes and camera roll. */
export function pointFromDepth(camera: SceneCamera, fovAxis: 'horizontal' | 'vertical', width: number, height: number, x: number, y: number, depth: number): Vec3 | null {
  if (!Number.isFinite(depth) || depth <= 0) return null;
  const ray=cameraRay(camera,fovAxis,width,height,x,y);
  return ray.origin.map((v,i)=>v+ray.direction[i]!*depth) as Vec3;
}
/** Read one actual ray hit using the existing layer/region path, without rendering a full depth image. */
export async function pickFocus(engine: Pick<Engine, 'renderLayersToBuffer'>, scene: Scene, width: number, height: number, x: number, y: number): Promise<Vec3 | null> {
  const layers = await engine.renderLayersToBuffer(width, height, { region: { x, y, width: 1, height: 1 }, quality: { samples_per_pixel: 1 }, debugView: 'raw' });
  return pointFromDepth(scene.camera, scene.render.fov_axis, width, height, x, y, layers.depth[0]!);
}
export class NavigationPanel {
  settings: NavigationSettings = { ...DEFAULT_NAVIGATION };
  private coordinates: HTMLInputElement[] = [];
  status = document.createElement('small');
  constructor(root: HTMLElement, private focus: (point: Vec3) => void) {
    try { const raw = JSON.parse(localStorage.getItem('fractal-navigation-v1') ?? '{}'); if (Number.isFinite(raw.speed) && raw.speed >= 0.01 && raw.speed <= 10) this.settings.speed = raw.speed; if (Number.isFinite(raw.sensitivity) && raw.sensitivity >= 0.01 && raw.sensitivity <= 10) this.settings.sensitivity = raw.sensitivity; if (raw.wheel === 'fly' || raw.wheel === 'focus') this.settings.wheel = raw.wheel; } catch { /* Storage may be disabled. */ }
    const title = document.createElement('strong'); title.textContent = 'Navigation / focus'; root.append(title);
    for (const [key, label] of [['speed', 'Navigation speed'], ['sensitivity', 'Zoom sensitivity']] as const) {
      const row = document.createElement('label'); row.textContent = label;
      const input = document.createElement('input'); input.type = 'range'; input.min = '0.01'; input.max = '10'; input.step = '0.05'; input.setAttribute('aria-label', label); setInputValue(input, this.settings[key]);
      input.oninput = () => { this.settings[key] = readNumber(input); try { localStorage.setItem('fractal-navigation-v1', JSON.stringify(this.settings)); this.status.textContent = ''; } catch { this.status.textContent = 'The navigation setting cannot be saved in this browser.'; } };
      row.append(input); root.append(row);
    }
    const wheelRow = document.createElement('label'); wheelRow.textContent = 'Wheel';
    const wheel = document.createElement('select'); wheel.setAttribute('aria-label', 'Wheel');
    for (const [value, text] of [['fly', 'Flies forward (passes the surface and the focus)'], ['focus', 'Approaches the focus (brakes, does not pass)']] as const) { const o = document.createElement('option'); o.value = value; o.textContent = text; wheel.append(o); }
    wheel.value = this.settings.wheel;
    wheel.onchange = () => { this.settings.wheel = wheel.value === 'focus' ? 'focus' : 'fly'; try { localStorage.setItem('fractal-navigation-v1', JSON.stringify(this.settings)); } catch { /* not saved */ } };
    wheelRow.append(wheel); root.append(wheelRow);
    const fields = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Focus point / pivot'; fields.append(summary);
    for (const axis of ['X', 'Y', 'Z']) {
      const row = document.createElement('label'); row.textContent = `Focus ${axis}`;
      const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.setAttribute('aria-label', `Focus ${axis}`); input.style.width = '100%'; this.coordinates.push(input);
      input.onchange = () => { const values = this.coordinates.map(i => i.value === '' ? NaN : Number(i.value)) as Vec3; if (values.every(Number.isFinite)) this.focus(values); }; row.append(input); fields.append(row);
    }
    root.append(fields, this.status);
    const hint = document.createElement('small'); hint.textContent = 'Drag to orbit around the focus. Double-click on a surface for a new focus; the wheel flies the camera forward at an even speed straight through the surface (choice above; Alt + wheel approaches the focus and changes the speed). Shift = fine, Ctrl = very fine.'; root.append(hint);
  }
  update(camera: SceneCamera): void { this.coordinates.forEach((input, i) => { if (!isNumericEditing(input)) setInputValue(input, camera.target[i]!); }); }
}
