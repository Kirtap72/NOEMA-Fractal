/**
 * Light direction (LOOKDEV-05): five plain controls for light and shadow that work with ANY lighting, not only with the finished looks.
 *
 * The Chiaroscuro look showed why earlier pictures were evenly lit: their key light only had short contact shadows, so large forms never
 * shadowed each other. These controls make that a choice of its own, for any preset or hand-made lighting:
 *
 *  - reach      Av / Kontakt / Full: how far the key light's shadows reach. Full = the ordinary soft/hard shadow ray of the whole scene.
 *  - dominance  how much of all light comes from the key light (the rest is fill lights and ambient light). 1 = no fill at all.
 *  - ambient    the ambient light on its own.
 *  - depth      how deep the shadows and cavities get: wide occlusion of the large forms and occlusion of the indirect light.
 *  - softness   how soft the edge of a full shadow is.
 *
 * Everything is read from the scene and written back as ordinary scene values (lights, ambient light, details.sculpt). There is no extra data
 * in the scene file, so no migration: a scene made with these controls opens in any version that has the sculpting shader. The functions are
 * pure; the geometry, camera, colours, quality and formulas are never touched (the very same objects come back).
 *
 * Only the KEY light (the strongest enabled light) casts the shadows that "reach" and "softness" choose: fill and rim lights are fill by
 * definition and should not draw competing shadows. Maths: the share of light is a ratio of luminance-weighted intensities; the rest is
 * ordinary scene values (see lights.ts, surfaceLooks.ts, renderDetails.ts).
 */
import { AMBIENT_LIMITS, LIGHT_LIMITS } from "./lights";
import type { LightSettings } from "./lights";
import { defaultSculpt } from "./renderDetails";
import { pixelFootprint } from "./surfaceLooks";
import type { LookContext } from "./surfaceLooks";
import type { Scene } from "./scene";

export const SHADOW_REACHES = ["off", "contact", "full"] as const;
export type ShadowReach = (typeof SHADOW_REACHES)[number];

export interface LightDirection {
  reach: ShadowReach;
  /** Key light's share of all light, 0.05–1. */
  dominance: number;
  /** Ambient light intensity. */
  ambient: number;
  /** 0–1: how deep the shadows and cavities are. */
  depth: number;
  /** 0–1: softness of a full shadow. */
  softness: number;
}

export const DOMINANCE_RANGE = [0.05, 1] as const;
/** The shadow depth control writes these two sculpt values from one number: wide occlusion and occlusion of the indirect light. */
export const DEPTH_FAR_STRENGTH = 0.9;
export const DEPTH_INDIRECT_OCCLUSION = 1.2;
/** Where the wide occlusion looks, in pixels of the final picture, when the control has to switch the sculpting on itself (as the finished looks do). */
const DEPTH_FAR_PIXELS = 200;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round = (x: number, d = 4): number => +x.toFixed(d);

/** Relative luminance of "#rrggbb" (sRGB to linear, Rec. 709 weights). Unreadable colours count as white. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const channel = (i: number): number => { const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
const power = (l: Pick<LightSettings, "intensity" | "color">): number => l.intensity * luminance(l.color);

/** The strongest enabled light, or -1 when none is on. */
export function keyLightIndex(scene: Pick<Scene, "lights">): number {
  let best = -1, bestPower = 0;
  scene.lights.forEach((l, i) => { if (l.enabled && power(l) > bestPower) { best = i; bestPower = power(l); } });
  return best;
}

/** Everything that is not the key light: the other enabled lights and the ambient light. */
function fillPower(scene: Pick<Scene, "lights" | "ambient">, key: number): number {
  return scene.lights.reduce((sum, l, i) => (i !== key && l.enabled ? sum + power(l) : sum), 0) + power(scene.ambient);
}

export function readLightDirection(scene: Scene): LightDirection {
  const key = keyLightIndex(scene);
  const light = key >= 0 ? scene.lights[key]! : undefined;
  const k = light ? power(light) : 0, f = fillPower(scene, key);
  const sculpt = scene.details.sculpt;
  return {
    reach: !light || light.shadows === "none" ? "off" : light.shadows === "contact" ? "contact" : "full",
    dominance: k <= 0 ? DOMINANCE_RANGE[0] : f <= 1e-9 ? 1 : clamp(k / (k + f), DOMINANCE_RANGE[0], 1),
    ambient: scene.ambient.intensity,
    depth: sculpt?.enabled ? clamp(sculpt.far_strength / DEPTH_FAR_STRENGTH, 0, 1) : 0,
    softness: light?.shadow_softness ?? 0.5,
  };
}

/**
 * The scene with the given controls changed (anything not named stays as it is). `context` is the subject distance and the film height, the same
 * as for the finished looks: it only matters when the shadow depth has to switch the sculpting on, to size the wide occlusion in picture pixels.
 */
export function applyLightDirection(scene: Scene, change: Partial<LightDirection>, context: LookContext): Scene {
  const key = keyLightIndex(scene);
  let lights = scene.lights;
  let ambient = scene.ambient;
  let details = scene.details;

  // Dominance first: it scales the fill relative to the key light as it is now. (Shadow settings do not change the light's power.)
  if (change.dominance !== undefined && key >= 0) {
    const d = clamp(change.dominance, DOMINANCE_RANGE[0], DOMINANCE_RANGE[1]);
    const k = power(lights[key]!), f = fillPower(scene, key);
    const wanted = (k * (1 - d)) / d; // fill that gives key / (key + fill) = d
    if (f > 1e-9) {
      const s = wanted / f;
      lights = lights.map((l, i) => (i === key || !l.enabled ? l : { ...l, intensity: round(clamp(l.intensity * s, LIGHT_LIMITS.intensity[0], LIGHT_LIMITS.intensity[1])) }));
      ambient = { ...ambient, intensity: round(clamp(ambient.intensity * s, AMBIENT_LIMITS.intensity[0], AMBIENT_LIMITS.intensity[1])) };
    } else if (wanted > 0) {
      ambient = { ...ambient, intensity: round(clamp(wanted / Math.max(luminance(ambient.color), 1e-6), AMBIENT_LIMITS.intensity[0], AMBIENT_LIMITS.intensity[1])) }; // there was no fill at all: the ambient light is the simplest fill
    }
  }
  if (change.ambient !== undefined) ambient = { ...ambient, intensity: round(clamp(change.ambient, AMBIENT_LIMITS.intensity[0], AMBIENT_LIMITS.intensity[1])) };

  // The key light's shadow: reach and softness.
  if ((change.reach !== undefined || change.softness !== undefined) && key >= 0) {
    const cur = lights[key]!;
    const shadows = change.reach === undefined ? cur.shadows : change.reach === "off" ? "none" : change.reach === "contact" ? "contact" : cur.shadows === "hard" ? "hard" : "soft";
    const shadow_softness = change.softness === undefined ? cur.shadow_softness : round(clamp(change.softness, LIGHT_LIMITS.shadow_softness[0], LIGHT_LIMITS.shadow_softness[1]));
    lights = lights.map((l, i) => (i === key ? { ...l, shadows, shadow_softness } : l));
  }

  // Shadow depth: wide occlusion and occlusion of the indirect light. Switching it on means switching the sculpting on, which is what a look does too.
  if (change.depth !== undefined) {
    const d = clamp(change.depth, 0, 1);
    const sculpt = details.sculpt;
    if (sculpt?.enabled) details = { ...details, sculpt: { ...sculpt, far_strength: round(d * DEPTH_FAR_STRENGTH), indirect_occlusion: round(d * DEPTH_INDIRECT_OCCLUSION) } };
    else if (d > 0) {
      if (!(context.subjectDistance > 0) || !(context.filmHeight > 0)) throw Error("The distance of the subject and the height of the picture must be positive");
      details = { ...details, sculpt: { ...defaultSculpt(), enabled: true, far_strength: round(d * DEPTH_FAR_STRENGTH), far_radius: DEPTH_FAR_PIXELS * pixelFootprint(scene, context.subjectDistance, context.filmHeight), indirect_occlusion: round(d * DEPTH_INDIRECT_OCCLUSION) } };
    }
  }
  return { ...scene, lights, ambient, details };
}

/** A short Swedish sentence for the status line: what the controls mean for this scene right now. */
export function describeLightDirection(scene: Scene): string {
  const key = keyLightIndex(scene);
  if (key < 0) return "No light is on. Turn on a light under Light to control the shadows.";
  const d = readLightDirection(scene);
  const reach = d.reach === "off" ? "The main light casts no shadows." : d.reach === "contact" ? "The main light only gives short contact shadows, so large shapes do not shade each other." : "The main light casts shadows over the whole subject, so large shapes shade each other.";
  const mine = scene.lights[key]!;
  const who = mine.name ? ` (${mine.name})` : "";
  return `${reach}${who} The main light accounts for ${Math.round(d.dominance * 100)} % of the light.`;
}
