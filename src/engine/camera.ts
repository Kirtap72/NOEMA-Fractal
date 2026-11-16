import type { CameraLens, DepthOfField } from './cameraOptics';
export type Vec3 = [number, number, number];

/** A camera as written in a scene file. Right-handed, Y up (same as glTF). */
export interface SceneCamera {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov_degrees: number;
  lens?: CameraLens;
  projection?: "perspective" | "orthographic";
  ortho_height?: number;
  dof?: DepthOfField;
}

/** The camera as the shader wants it: where it is and which way is forward, right and up. */
export interface CameraBasis {
  position: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Returns the camera axes for a "look at" camera. Falls back to another up direction if looking straight along `up`. */
export function cameraBasis(camera: SceneCamera): CameraBasis {
  const toTarget = sub(camera.target, camera.position);
  const forward = scale(toTarget, 1 / length(toTarget));
  let side = cross(forward, camera.up);
  if (length(side) < 1e-6) side = cross(forward, [0, 0, 1]);
  if (length(side) < 1e-6) side = cross(forward, [1, 0, 0]);
  const right = scale(side, 1 / length(side));
  const up = cross(right, forward);
  return { position: [...camera.position], right, up, forward };
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Reads three numbers; adds a message to `errors` and returns undefined if it is not that. */
export function readVec3(raw: unknown, where: string, errors: string[]): Vec3 | undefined {
  if (Array.isArray(raw) && raw.length === 3 && raw.every(isNum)) return [raw[0] as number, raw[1] as number, raw[2] as number];
  errors.push(`${where} must be a list of three numbers`);
  return undefined;
}

/** Reads and checks a camera from a scene file. */
export function readSceneCamera(raw: unknown, where: string, errors: string[]): SceneCamera | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(`${where} is required`);
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const position = readVec3(r.position, `${where}.position`, errors);
  const target = readVec3(r.target, `${where}.target`, errors);
  const up = r.up === undefined ? ([0, 1, 0] as Vec3) : readVec3(r.up, `${where}.up`, errors);
  const fov = r.fov_degrees === undefined ? 50 : r.fov_degrees;
  if (!isNum(fov) || fov < 10 || fov > 120) errors.push(`${where}.fov_degrees must be a number from 10 to 120`);
  if (!position || !target || !up || !isNum(fov)) return undefined;
  if (Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) === 0) {
    errors.push(`${where}: position and target must differ`);
  }
  if (Math.hypot(...up) < 1e-9) errors.push(`${where}.up must not be zero`);
  const optional: Partial<SceneCamera> = {};
  if(r.lens!==undefined){
    const l=r.lens as Record<string,unknown>;
    if(!l || typeof l!=='object' || !isNum(l.focal_length_mm) || l.focal_length_mm<1 || l.focal_length_mm>2000 || !isNum(l.sensor_width_mm) || l.sensor_width_mm<1 || l.sensor_width_mm>200) errors.push(where+'.lens requires focal length 1–2000 mm and sensor width 1–200 mm');
    else optional.lens={focal_length_mm:l.focal_length_mm,sensor_width_mm:l.sensor_width_mm};
  }
  if(r.projection!==undefined){if(r.projection!=='perspective'&&r.projection!=='orthographic')errors.push(where+'.projection is invalid');else optional.projection=r.projection;}
  if(r.ortho_height!==undefined){if(!isNum(r.ortho_height)||r.ortho_height<1e-9||r.ortho_height>1e6)errors.push(where+'.ortho_height must be 1e-9–1e6');else optional.ortho_height=r.ortho_height;}
  if(r.dof!==undefined){const d=r.dof as Record<string,unknown>;
    if(!d || typeof d!=='object'||typeof d.enabled!=='boolean'||(d.focus_mode!=='target'&&d.focus_mode!=='manual')||!isNum(d.focus_distance)||d.focus_distance<1e-9||d.focus_distance>1e6||!isNum(d.aperture_radius)||d.aperture_radius<0||d.aperture_radius>1000)errors.push(where+'.dof is invalid');
    else optional.dof={enabled:d.enabled,focus_mode:d.focus_mode,focus_distance:d.focus_distance,aperture_radius:d.aperture_radius};
  }
  return { position, target, up, fov_degrees: fov, ...optional };
}
