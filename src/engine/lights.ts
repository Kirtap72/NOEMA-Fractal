import type { Vec3 } from "./camera";

/**
 * Light sources (scene version 9): up to 8 lights and an ambient light.
 * Directional lights (like the sun), point lights and spot lights. Each can cast shadows.
 *
 * Maths (all textbook, "Allmän matematik (lärobok)"):
 * - Diffuse light follows the cosine law: the more a surface faces the light, the brighter, max(dot(normal, toLight), 0).
 * - A point or spot light weakens with the square of the distance (inverse-square law). `intensity` is its brightness
 *   at the distance 1.
 * - A spot light has a cone: full light inside the inner angle, none outside the outer angle, a smooth step between.
 * - Soft shadows: the technique of Inigo Quilez for distance fields, https://iquilezles.org/articles/rmshadows/
 *   (read 2026-10-06): along the shadow ray the smallest value of k * distance / travelled is kept as the amount of light.
 */

export const LIGHT_TYPES = ["directional", "point", "spot"] as const;
export type LightType = (typeof LIGHT_TYPES)[number];

export const SHADOW_MODES = ["none", "hard", "soft", "contact"] as const;
export type ShadowMode = (typeof SHADOW_MODES)[number];

export const MAX_LIGHTS = 8;

export interface LightSettings {
  /** Persistent Animation 2.0 target identity; legacy files acquire one neutrally. */
  id?:string;
  /** A name to show (optional). */
  name?: string;
  enabled: boolean;
  type: LightType;
  /** "#rrggbb", as seen on screen (sRGB). */
  color: string;
  /** Directional: brightness (the old fixed light was 0.88). Point and spot: brightness at the distance 1. */
  intensity: number;
  /** The direction the light shines in (directional and spot). Any length except 0; the engine normalises it. */
  direction: Vec3;
  /** Where the light is (point and spot). */
  position: Vec3;
  /** Spot: the half angle of the cone, in degrees. */
  cone_degrees: number;
  /** Spot: how much of the cone is a soft edge, 0 (hard edge) to 1 (soft all the way in). */
  cone_softness: number;
  shadows: ShadowMode;
  /** 0 = a sharp shadow edge, 1 = very soft (only for soft shadows). */
  shadow_softness: number;
}

export interface AmbientSettings {
  color: string;
  /** The old fixed ambient light was 0.12. */
  intensity: number;
}

export const LIGHT_LIMITS = { intensity: [0, 10000], cone_degrees: [1, 89], cone_softness: [0, 1], shadow_softness: [0, 1], position: [-10000, 10000] } as const;
export const AMBIENT_LIMITS = { intensity: [0, 10] } as const;

/** The one light and the ambient light that scenes had before version 9 (built into the shader), so old scenes look the same. */
export const DEFAULT_LIGHT: LightSettings = {
  enabled: true,
  type: "directional",
  color: "#ffffff",
  intensity: 0.88,
  direction: [-0.6, -0.8, -0.4], // shines from the direction (0.6, 0.8, 0.4) towards the origin
  position: [0, 0, 0],
  cone_degrees: 40,
  cone_softness: 0.2,
  shadows: "none",
  shadow_softness: 0.5,
};
export const DEFAULT_AMBIENT: AmbientSettings = { color: "#ffffff", intensity: 0.12 };

export function defaultLight(): LightSettings {
  return { ...DEFAULT_LIGHT, direction: [...DEFAULT_LIGHT.direction], position: [...DEFAULT_LIGHT.position] };
}
export function defaultLights(): LightSettings[] {
  return [defaultLight()];
}
export function defaultAmbient(): AmbientSettings {
  return { ...DEFAULT_AMBIENT };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const vec = (x: unknown, limit: number): Vec3 | null =>
  Array.isArray(x) && x.length === 3 && x.every((n) => isNum(n) && Math.abs(n) <= limit) ? ([x[0], x[1], x[2]] as Vec3) : null;

/** Reads and checks one light. Missing fields get the defaults. */
export function readLight(raw: unknown, where: string, errors: string[]): LightSettings | undefined {
  if (!isObj(raw)) return void errors.push(`${where} must be an object`);
  const before = errors.length;
  const out = defaultLight();
  if(raw.id!==undefined){if(typeof raw.id==='string'&&/^[-\w]{1,64}$/.test(raw.id))out.id=raw.id;else errors.push(where+'.id is invalid');}
  if (raw.name !== undefined) {
    if (typeof raw.name === "string" && raw.name.length <= 80) out.name = raw.name;
    else errors.push(`${where}.name must be a text of at most 80 characters`);
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
    else errors.push(`${where}.enabled must be true or false`);
  }
  if (raw.type !== undefined) {
    if (typeof raw.type === "string" && (LIGHT_TYPES as readonly string[]).includes(raw.type)) out.type = raw.type as LightType;
    else errors.push(`${where}.type must be one of: ${LIGHT_TYPES.join(", ")}`);
  }
  if (raw.color !== undefined) {
    if (typeof raw.color === "string" && HEX.test(raw.color)) out.color = raw.color.toLowerCase();
    else errors.push(`${where}.color must be a colour like "#ffeedd"`);
  }
  for (const key of ["intensity", "cone_degrees", "cone_softness", "shadow_softness"] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    const [lo, hi] = LIGHT_LIMITS[key];
    if (!isNum(v) || v < lo || v > hi) errors.push(`${where}.${key} must be a number from ${lo} to ${hi}`);
    else out[key] = v;
  }
  if (raw.direction !== undefined) {
    const d = vec(raw.direction, 1e6);
    if (!d || Math.hypot(...d) < 1e-9) errors.push(`${where}.direction must be three numbers that are not all 0`);
    else out.direction = d;
  }
  if (raw.position !== undefined) {
    const p = vec(raw.position, LIGHT_LIMITS.position[1]);
    if (!p) errors.push(`${where}.position must be three numbers`);
    else out.position = p;
  }
  if (raw.shadows !== undefined) {
    if (typeof raw.shadows === "string" && (SHADOW_MODES as readonly string[]).includes(raw.shadows)) out.shadows = raw.shadows as ShadowMode;
    else errors.push(`${where}.shadows must be one of: ${SHADOW_MODES.join(", ")}`);
  }
  return errors.length > before ? undefined : out;
}

/** Reads and checks the list of lights (0 to 8). Left out means the one old light. */
export function readLights(raw: unknown, where: string, errors: string[]): LightSettings[] | undefined {
  if (raw === undefined) return defaultLights();
  if (!Array.isArray(raw) || raw.length > MAX_LIGHTS) return void errors.push(`${where} must be a list of at most ${MAX_LIGHTS} lights`);
  const before = errors.length;
  const lights = raw.map((l, i) => readLight(l, `${where}[${i}]`, errors));
  const ids=lights.flatMap(l=>l?.id?[l.id]:[]);if(new Set(ids).size!==ids.length)errors.push(where+': duplicate light identities');
  return errors.length > before ? undefined : (lights as LightSettings[]);
}

export function readAmbient(raw: unknown, where: string, errors: string[]): AmbientSettings | undefined {
  if (raw === undefined) return defaultAmbient();
  if (!isObj(raw)) return void errors.push(`${where} must be an object`);
  const before = errors.length;
  const out = defaultAmbient();
  if (raw.color !== undefined) {
    if (typeof raw.color === "string" && HEX.test(raw.color)) out.color = raw.color.toLowerCase();
    else errors.push(`${where}.color must be a colour like "#ffffff"`);
  }
  if (raw.intensity !== undefined) {
    const [lo, hi] = AMBIENT_LIMITS.intensity;
    if (!isNum(raw.intensity) || raw.intensity < lo || raw.intensity > hi) errors.push(`${where}.intensity must be a number from ${lo} to ${hi}`);
    else out.intensity = raw.intensity;
  }
  return errors.length > before ? undefined : out;
}

// ---- directions as angles (for the sliders)

/** The direction a light shines in, from the angle round the vertical axis and the angle above the horizon (degrees). */
export function directionFromAngles(azimuthDegrees: number, elevationDegrees: number): Vec3 {
  const a = (azimuthDegrees * Math.PI) / 180;
  const e = (elevationDegrees * Math.PI) / 180;
  // The light comes FROM the given angles, so it shines the opposite way: from above-and-side down towards the origin.
  return [-Math.cos(e) * Math.sin(a), -Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

/** The angles (degrees) a direction corresponds to: where the light comes from, as seen from the origin. */
export function anglesFromDirection(direction: Vec3): { azimuth: number; elevation: number } {
  const [x, y, z] = direction;
  const len = Math.hypot(x, y, z) || 1;
  const elevation = (Math.asin(Math.min(1, Math.max(-1, -y / len))) * 180) / Math.PI;
  const azimuth = (Math.atan2(-x, -z) * 180) / Math.PI;
  return { azimuth: Object.is(azimuth, -0) ? 0 : azimuth, elevation };
}

// ---- for the shader

/** Floats for the ambient light (one vec4) and 8 lights (4 vec4 each). */
export const LIGHT_FLOATS = 4 + MAX_LIGHTS * 16;

/** Temporary render input in scene-linear RGB. Does not alter the versioned scene format. */
export interface LinearLighting {
  ambient: Vec3;
  lights: (Omit<LightSettings, 'color' | 'intensity'> & { radiance: Vec3 })[];
}

export function packLinearLighting(input: LinearLighting): Float32Array {
  const validRgb = (v: Vec3) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && n >= 0 && n <= 65504);
  if (!input || !validRgb(input.ambient) || !Array.isArray(input.lights) || input.lights.length > MAX_LIGHTS) throw Error('Invalid linear lighting budget / ambient');
  const lights = input.lights.map((l, i) => {
    if (!l || !validRgb(l.radiance)) throw Error('Invalid linear light radiance');
    const errors: string[] = [];
    const checked = readLight({...l, color:'#ffffff', intensity:1}, `linearLight[${i}]`, errors);
    if (!checked) throw Error(errors.join('; '));
    return checked;
  });
  const packed = packLights(lights, {color:'#ffffff', intensity:0});
  packed.set(input.ambient, 0);
  let index = 0;
  input.lights.forEach((l,i) => { if (lights[i]!.enabled) { packed.set(l.radiance, 4 + index * 16 + 8); index++; } });
  return packed;
}

/** Shadow softness 0..1 to the factor k of the soft shadow technique: 64 (sharp) at 0 down to 2 (very soft) at 1. */
export function shadowK(softness: number): number {
  return 64 * Math.pow(1 / 32, softness);
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
const luma = (l: LightSettings): number => {
  const [r, g, b] = rgb(l.color);
  return l.intensity * (0.2126 * r + 0.7152 * g + 0.0722 * b);
};

/**
 * The lights that are drawn: the ones that are switched on and, if `limit` is given and there are more, the `limit`
 * strongest (by intensity times brightness of the colour), in their original order. The preview uses a limit.
 */
export function activeLights(lights: readonly LightSettings[], limit: number | null): LightSettings[] {
  const on = lights.filter((l) => l.enabled);
  if (limit === null || on.length <= limit) return on;
  const chosen = new Set([...on].sort((a, b) => luma(b) - luma(a)).slice(0, Math.max(0, limit)));
  return on.filter((l) => chosen.has(l));
}

/**
 * Packs the lights for the shader. Ambient: colour times intensity in linear light, and the number of lights in w.
 * Per light, four vec4:
 *  1. position (point, spot) and the type (0 directional, 1 point, 2 spot)
 *  2. direction (normalised here in double precision, so the shader needs no square root) and the shadow mode (0 none, 1 hard, 2 soft)
 *  3. colour times intensity in linear light, and the factor k of the soft shadows
 *  4. cosine of the outer and the inner cone angle (spot)
 */
export function packLights(lights: readonly LightSettings[], ambient: AmbientSettings, limit: number | null = null, out = new Float32Array(LIGHT_FLOATS)): Float32Array {
  out.fill(0);
  const used = activeLights(lights, limit).slice(0, MAX_LIGHTS);
  const [ar, ag, ab] = rgb(ambient.color);
  out.set([ar ** 2.2 * ambient.intensity, ag ** 2.2 * ambient.intensity, ab ** 2.2 * ambient.intensity, used.length], 0);
  used.forEach((l, i) => {
    const o = 4 + i * 16;
    const [r, g, b] = rgb(l.color);
    const outer = Math.cos((l.cone_degrees * Math.PI) / 180);
    const inner = Math.cos(((l.cone_degrees * (1 - l.cone_softness)) * Math.PI) / 180);
    out.set([l.position[0], l.position[1], l.position[2], l.type === "point" ? 1 : l.type === "spot" ? 2 : 0], o);
    const len = Math.hypot(...l.direction) || 1;
    out.set([l.direction[0] / len, l.direction[1] / len, l.direction[2] / len, l.shadows === "contact" ? 3 : l.shadows === "soft" ? 2 : l.shadows === "hard" ? 1 : 0], o + 4);
    out.set([r ** 2.2 * l.intensity, g ** 2.2 * l.intensity, b ** 2.2 * l.intensity, shadowK(l.shadow_softness)], o + 8);
    out.set([outer, Math.max(inner, outer + 1e-4), 0, 0], o + 12); // smoothstep needs the inner edge above the outer one
  });
  return out;
}

// ---- animation

const hex = (c: [number, number, number]): string =>
  "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
const mix = (a: number, b: number, f: number): number => a + (b - a) * f;
const mixVec = (a: Vec3, b: Vec3, f: number): Vec3 => [mix(a[0], b[0], f), mix(a[1], b[1], f), mix(a[2], b[2], f)];

/** One light between two keyframes. Colour, brightness, direction, position and cone blend; the kind and shadow choices switch halfway. */
export function blendLight(a: LightSettings, b: LightSettings, f: number): LightSettings {
  const to = f >= 0.5 ? b : a;
  const ca = rgb(a.color);
  const cb = rgb(b.color);
  let direction = mixVec(a.direction, b.direction, f);
  if (Math.hypot(...direction) < 1e-6) direction = to.direction; // opposite directions: no sensible middle
  return {
    ...(to.id?{id:to.id}:{}),
    ...(to.name !== undefined ? { name: to.name } : {}),
    enabled: to.enabled,
    type: to.type,
    color: hex([mix(ca[0], cb[0], f), mix(ca[1], cb[1], f), mix(ca[2], cb[2], f)]),
    intensity: mix(a.intensity, b.intensity, f),
    direction,
    position: mixVec(a.position, b.position, f),
    cone_degrees: mix(a.cone_degrees, b.cone_degrees, f),
    cone_softness: mix(a.cone_softness, b.cone_softness, f),
    shadows: to.shadows,
    shadow_softness: mix(a.shadow_softness, b.shadow_softness, f),
  };
}

/**
 * The lights between two keyframes. Lights are matched by their place in the list; with the same number of lights
 * each pair blends. If the numbers differ, the list switches halfway (there is no sensible way to blend a light that
 * appears from nothing).
 */
export function blendLights(a: readonly LightSettings[], b: readonly LightSettings[], f: number): LightSettings[] {
  if (a.length !== b.length) return (f >= 0.5 ? b : a).map((l) => ({ ...l, direction: [...l.direction] as Vec3, position: [...l.position] as Vec3 }));
  return a.map((l, i) => blendLight(l, b[i]!, f));
}

export function blendAmbient(a: AmbientSettings, b: AmbientSettings, f: number): AmbientSettings {
  const ca = rgb(a.color);
  const cb = rgb(b.color);
  return { color: hex([mix(ca[0], cb[0], f), mix(ca[1], cb[1], f), mix(ca[2], cb[2], f)]), intensity: mix(a.intensity, b.intensity, f) };
}

/** A copy of the lights that can be changed without touching the original. */
export function cloneLights(lights: readonly LightSettings[]): LightSettings[] {
  return lights.map((l) => ({ ...l, direction: [...l.direction] as Vec3, position: [...l.position] as Vec3 }));
}

export interface LightingPreset {
  id: string;
  name: string;
  description: string;
  lights: LightSettings[];
  ambient: AmbientSettings;
  hdriEnvironment?: { intensity: number; rotation_degrees: number };
}

export const CANDIDATE_B_LIGHTING_PRESET: LightingPreset = {
  id: "orbit100-candidate-b",
  name: "Orbit 100 · Candidate B (Warm copper/gold & cool contrast)",
  description: "Warm copper/gold light from the side with a cooler sky-blue contrast light from above (GI2C Candidate B).",
  lights: [
    {
      id: "light-1",
      name: "Warm Copper-Gold Key",
      enabled: true,
      type: "directional",
      color: "#f29b4b",
      intensity: 2.35,
      direction: [0.9991, 0.0005, -0.0415],
      position: [0, 0, 0],
      cone_degrees: 40,
      cone_softness: 0.2,
      shadows: "soft",
      shadow_softness: 0.28,
    },
    {
      id: "light-2",
      name: "Cool Cerulean Contrast Fill",
      enabled: true,
      type: "directional",
      color: "#649be0",
      intensity: 0.52,
      direction: [-0.0652, 0.8087, 0.5846],
      position: [0, 0, 0],
      cone_degrees: 40,
      cone_softness: 0.2,
      shadows: "soft",
      shadow_softness: 0.55,
    },
  ],
  ambient: { color: "#6b86a6", intensity: 0.045 },
  hdriEnvironment: { intensity: 0.18, rotation_degrees: 110 },
};

export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  CANDIDATE_B_LIGHTING_PRESET,
  {
    id: "orbit100-candidate-a",
    name: "Orbit 100 · Candidate A (Dramatic side light)",
    description: "Strong raking side light from the upper right with deep readable shadows and a weak cool rim light (GI2C Candidate A).",
    lights: [
      {
        id: "light-1",
        name: "Dramatic Grazing Key",
        enabled: true,
        type: "directional",
        color: "#fff0d8",
        intensity: 2.25,
        direction: [0.9880, 0.0928, -0.1232],
        position: [0, 0, 0],
        cone_degrees: 40,
        cone_softness: 0.2,
        shadows: "soft",
        shadow_softness: 0.20,
      },
      {
        id: "light-2",
        name: "Subtle Rim Counter-Light",
        enabled: true,
        type: "directional",
        color: "#8aa8cc",
        intensity: 0.22,
        direction: [-0.5210, 0.7825, 0.3407],
        position: [0, 0, 0],
        cone_degrees: 40,
        cone_softness: 0.2,
        shadows: "soft",
        shadow_softness: 0.45,
      },
    ],
    ambient: { color: "#7c8794", intensity: 0.025 },
    hdriEnvironment: { intensity: 0.12, rotation_degrees: 35 },
  },
  {
    id: "orbit100-candidate-c",
    name: "Orbit 100 · Candidate C (Soft filmic studio lighting)",
    description: "Soft three-quarter main lighting with a wide penumbra and warm bounce light reflected from below (GI2C Candidate C).",
    lights: [
      {
        id: "light-1",
        name: "Soft Studio Three-Quarter Key",
        enabled: true,
        type: "directional",
        color: "#ffeed9",
        intensity: 1.55,
        direction: [0.9896, 0.0853, 0.1167],
        position: [0, 0, 0],
        cone_degrees: 40,
        cone_softness: 0.2,
        shadows: "soft",
        shadow_softness: 0.65,
      },
      {
        id: "light-2",
        name: "Warm Studio Bounce Fill",
        enabled: true,
        type: "directional",
        color: "#dca36e",
        intensity: 0.72,
        direction: [-0.3738, 0.9032, 0.2108],
        position: [0, 0, 0],
        cone_degrees: 40,
        cone_softness: 0.2,
        shadows: "soft",
        shadow_softness: 0.78,
      },
    ],
    ambient: { color: "#a8b4c0", intensity: 0.055 },
    hdriEnvironment: { intensity: 0.25, rotation_degrees: 0 },
  },
];

/** Applies a named lighting preset non-destructively to a scene copy without altering geometry, camera, materials or export settings. */
export function applyLightingPreset<T extends { lights: LightSettings[]; ambient: AmbientSettings; environment?: { kind: string; intensity?: number; rotation_degrees?: number } }>(
  scene: T,
  presetId: string,
): T {
  const preset = LIGHTING_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`Unknown lighting preset "${presetId}"`);
  const usedIds = new Set<string>();
  const lights = cloneLights(preset.lights).map((light, i) => {
    const existingId = scene.lights[i]?.id;
    const candidateId = existingId && !usedIds.has(existingId) ? existingId : light.id && !usedIds.has(light.id) ? light.id : `light-${i + 1}`;
    usedIds.add(candidateId);
    return { ...light, id: candidateId };
  });
  const ambient: AmbientSettings = { ...preset.ambient };
  const nextEnv =
    scene.environment && scene.environment.kind === "hdri" && preset.hdriEnvironment
      ? { ...scene.environment, intensity: preset.hdriEnvironment.intensity, rotation_degrees: preset.hdriEnvironment.rotation_degrees }
      : scene.environment;
  return {
    ...scene,
    lights,
    ambient,
    ...(nextEnv !== undefined ? { environment: nextEnv } : {}),
  };
}
