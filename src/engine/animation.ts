import { readSceneCamera } from "./camera";
import type { SceneCamera, Vec3 } from "./camera";
import { readFog } from "./fog";
import { readAmbient, readLights } from "./lights";
import type { AmbientSettings, LightSettings } from "./lights";
import type { FogSettings } from "./fog";
import { readColorSettings } from "./gradient";
import type { ColorSettings } from "./gradient";

/**
 * Animation data stored in a scene: keyframes along a timeline. Each keyframe
 * holds the camera, the parameter values of every step of the formula chain,
 * and the colouring. The chain itself (which formulas, how many iterations)
 * is the same for the whole animation, because changing it needs a new shader.
 */
export type SpeedMode = "adaptive" | "uniform";
export const SPEED_MODES: readonly SpeedMode[] = ["adaptive", "uniform"];

export interface AnimationKeyframe {
  time_seconds: number;
  camera: SceneCamera;
  /** One entry per step of the chain, in the same order. */
  steps: { parameters: Record<string, number>; weight?: number }[];
  /** The Julia constant at this keyframe (version 11). Left out: the scene's own. */
  julia_c?: Vec3;
  color: ColorSettings;
  /** Fog at this keyframe (added in version 8). Left out: the scene's own fog. */
  fog?: FogSettings;
  /** Lights and ambient light at this keyframe (added in version 9). Left out: the scene's own. */
  lights?: LightSettings[];
  ambient?: AmbientSettings;
}

export interface Animation {
  duration_seconds: number;
  fps: number;
  /**
   * How the camera moves between two keyframes. Both keep the keyframe times.
   * "adaptive": slow near the surface, fast in open space.
   * "uniform": the same speed along the whole stretch.
   */
  speed_mode: SpeedMode;
  keyframes: AnimationKeyframe[];
}

export const MAX_KEYFRAMES = 64;
export const MAX_DURATION_SECONDS = 3600;
export const MAX_FPS = 120;

export function defaultAnimation(): Animation {
  return { duration_seconds: 10, fps: 30, speed_mode: "adaptive", keyframes: [] };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Reads and checks the animation of a scene. Reports every problem found. */
export function readAnimation(raw: unknown, where: string, errors: string[]): Animation | undefined {
  const before = errors.length;
  if (!isObj(raw)) {
    errors.push(`${where} is required`);
    return undefined;
  }
  const duration = raw.duration_seconds;
  if (!isNum(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) {
    errors.push(`${where}.duration_seconds must be a number above 0, at most ${MAX_DURATION_SECONDS}`);
  }
  if (!Number.isInteger(raw.fps) || (raw.fps as number) < 1 || (raw.fps as number) > MAX_FPS) {
    errors.push(`${where}.fps must be a whole number from 1 to ${MAX_FPS}`);
  }
  if (!SPEED_MODES.includes(raw.speed_mode as SpeedMode)) {
    errors.push(`${where}.speed_mode must be "adaptive" or "uniform"`);
  }
  const keyframes: AnimationKeyframe[] = [];
  if (!Array.isArray(raw.keyframes) || raw.keyframes.length > MAX_KEYFRAMES) {
    errors.push(`${where}.keyframes must be a list of at most ${MAX_KEYFRAMES} keyframes`);
  } else {
    let last = -Infinity;
    raw.keyframes.forEach((k: unknown, i: number) => {
      const w = `${where}.keyframes[${i}]`;
      if (!isObj(k) || !isNum(k.time_seconds) || k.time_seconds < 0) {
        return void errors.push(`${w}.time_seconds must be a number, 0 or more`);
      }
      if (isNum(duration) && k.time_seconds > duration + 1e-9) errors.push(`${w}.time_seconds is after the end of the animation`);
      if (k.time_seconds <= last) errors.push(`${w}.time_seconds must be later than the keyframe before`);
      last = k.time_seconds;
      const camera = readSceneCamera(k.camera, `${w}.camera`, errors);
      const color = readColorSettings(k.color, `${w}.color`, errors);
      const fog = k.fog === undefined ? undefined : readFog(k.fog, `${w}.fog`, errors);
      const lights = k.lights === undefined ? undefined : readLights(k.lights, `${w}.lights`, errors);
      const ambient = k.ambient === undefined ? undefined : readAmbient(k.ambient, `${w}.ambient`, errors);
      const steps: AnimationKeyframe["steps"] = [];
      if (!Array.isArray(k.steps)) errors.push(`${w}.steps must be a list`);
      else {
        k.steps.forEach((s: unknown, j: number) => {
          const sw = `${w}.steps[${j}]`;
          if (!isObj(s) || !isObj(s.parameters)) return void errors.push(`${sw}.parameters must be a mapping`);
          const parameters: Record<string, number> = {};
          for (const [name, value] of Object.entries(s.parameters)) {
            if (isNum(value)) parameters[name] = value;
            else errors.push(`${sw}.parameters.${name} must be a number`);
          }
          if (s.weight !== undefined && !(isNum(s.weight) && s.weight >= 0 && s.weight <= 10)) errors.push(`${sw}.weight must be a number from 0 to 10`);
          steps.push({ parameters, ...(isNum(s.weight) ? { weight: s.weight } : {}) });
        });
      }
      const jc = k.julia_c;
      const juliaOk = jc === undefined || (Array.isArray(jc) && jc.length === 3 && jc.every((n) => isNum(n) && Math.abs(n) <= 1000));
      if (!juliaOk) errors.push(`${w}.julia_c must be three numbers (from -1000 to 1000)`);
      const optionalOk = (k.fog === undefined || fog) && (k.lights === undefined || lights) && (k.ambient === undefined || ambient) && juliaOk;
      if (camera && color && optionalOk) {
        keyframes.push({ time_seconds: k.time_seconds, camera, steps, color, ...(fog ? { fog } : {}), ...(lights ? { lights } : {}), ...(ambient ? { ambient } : {}), ...(jc !== undefined && juliaOk ? { julia_c: [jc[0], jc[1], jc[2]] as Vec3 } : {}) });
      }
    });
  }
  if (errors.length > before) return undefined;
  return {
    duration_seconds: duration as number,
    fps: raw.fps as number,
    speed_mode: raw.speed_mode as SpeedMode,
    keyframes,
  };
}

export type { Vec3 };
