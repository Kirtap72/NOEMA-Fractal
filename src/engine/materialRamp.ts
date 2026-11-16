/**
 * MATERIAL-GRADIENT-01: material stops in the colour gradient (see docs/material-gradient/MATERIAL-GRADIENT-01-DESIGN.md).
 *
 * A gradient stop may carry an optional material snapshot (`material`) and a transition width towards the next stop
 * (`transition`). This file is pure data and blending maths: no imports of the material or colour modules (types only),
 * so that gradient.ts can use it without a cycle. The compilation to the shader's existing inputs is in materialRampApply.ts.
 *
 * Nothing here changes geometry, distance estimation or the measure `t` of the gradient: the same `t` selects the colour.
 *
 * MATERIAL-GRADIENT-02: a stop material may also carry the PBR image maps of the saved material (base colour, roughness, metallic,
 * ambient occlusion) with its own texture scale, and a stop has a `softness` of its transition. Maps are embedded in the scene
 * (the same embedded images that materials already use), so a scene never depends on a library entry.
 */
import type { MaterialTextures } from "./materialTextures";

/** At most this many stops may carry a material snapshot (an explicit, tested cap; the V1 renderer binds no extra textures). */
export const MAX_MATERIAL_STOPS = 16;
/**
 * MG-02: at most this many DISTINCT textured materials per gradient (a texture set + its scale counts once however many stops use it).
 * The shader blends the two neighbouring stops at any point, but every distinct set needs its own image layers on the 8 GB card and
 * a record in the shader; four keeps both reasonable. More is rejected with a clear message, never truncated.
 */
export const MAX_TEXTURED_MATERIALS = 4;
/** The PBR channels a gradient can blend. Emission and the normal/bump/height family are NOT blended (rejected and reported, see snapshotStopMaterial). */
export const BLENDABLE_MAP_CHANNELS = ["baseColor", "roughness", "metallic", "ao"] as const;
export const MIN_TEXTURE_SCALE = 0.001;
export const MAX_TEXTURE_SCALE = 100000;

/** The part of a material that V1 blends along the gradient. Self-contained: a scene never depends on a local library entry. */
export interface StopMaterial {
  /** true: this stop is a Material stop. false: it is a Colour stop, but the snapshot is kept so the choice is reversible. */
  active: boolean;
  /** A name to show (for example the preset's title). */
  name?: string;
  /** Provenance only; nothing reads the library through it. MG-02: `provider`, `license`, `author` and `url` are ready for a future Poly Haven import (no network code exists). */
  source?: { id: string; fingerprint?: string; provider?: string; license?: string; author?: string; url?: string };
  metallic: number;
  roughness: number;
  reflectivity: number;
  /** Linear multiplier on the stop's colour (the material's base colour). Absent means white. */
  baseColor?: [number, number, number];
  /** Features of the source material that are NOT blended (shown to the artist, never silently dropped). */
  notBlended?: string[];
  /** MG-02: the material's own PBR maps (only base colour, roughness, metallic and ambient occlusion; each map keeps its strength and mode). */
  textures?: MaterialTextures;
  /** MG-02: repetitions per object unit for ALL of this material's maps (one scale, so the maps stay aligned). Default 1. */
  textureScale?: number;
}

/** The two optional fields every gradient stop may have. */
export interface RampFields {
  material?: StopMaterial;
  /** Width (0 to 1) of the blend towards the next stop. Default 1 = the whole interval, exactly the old linear blend. */
  transition?: number;
  /**
   * MG-02: how soft the edges of the transition band are, 0 (a crisp, linear ramp) to 1 (a smooth step). Absent keeps the old behaviour
   * exactly (a smooth step when the width is below 1, linear at width 1).
   */
  softness?: number;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const KEYS = ["active", "name", "source", "metallic", "roughness", "reflectivity", "baseColor", "notBlended", "textures", "textureScale"];
const SOURCE_KEYS = ["id", "fingerprint", "provider", "license", "author", "url"];
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length >= 1 && v.length <= max;
/** Reads the optional embedded maps of a stop material (provided by gradient.ts, which can reach the image reader). */
export type TextureReader = (raw: unknown, where: string, errors: string[]) => MaterialTextures | undefined;

/** Checks a stop's material snapshot. Reports every problem; returns undefined if there is any. */
export function readStopMaterial(raw: unknown, where: string, errors: string[], readTextures?: TextureReader): StopMaterial | undefined {
  const before = errors.length;
  if (!isObj(raw)) return void errors.push(`${where} must be a mapping`);
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) errors.push(`${where}.${k} is not a known field`);
  if (typeof raw.active !== "boolean") errors.push(`${where}.active must be true or false`);
  for (const k of ["metallic", "roughness", "reflectivity"] as const) {
    if (!isNum(raw[k]) || raw[k] < 0 || raw[k] > 1) errors.push(`${where}.${k} must be a number from 0 to 1`);
  }
  if (raw.name !== undefined && (typeof raw.name !== "string" || raw.name.length > 100)) errors.push(`${where}.name must be a text of at most 100 characters`);
  let source: StopMaterial["source"];
  if (raw.source !== undefined) {
    const s = raw.source;
    if (!isObj(s) || !text(s.id, 128) || Object.keys(s).some((k) => !SOURCE_KEYS.includes(k)) || (s.fingerprint !== undefined && !text(s.fingerprint, 128))
      || (s.provider !== undefined && !text(s.provider, 40)) || (s.license !== undefined && !text(s.license, 60)) || (s.author !== undefined && !text(s.author, 100)) || (s.url !== undefined && (!text(s.url, 300) || !/^https:\/\//.test(s.url)))) {
      errors.push(`${where}.source must be {id, fingerprint?, provider?, license?, author?, url? (https)}`);
    } else source = { id: s.id, ...Object.fromEntries(SOURCE_KEYS.slice(1).filter((k) => typeof s[k] === "string").map((k) => [k, s[k]])) } as StopMaterial["source"];
  }
  let baseColor: [number, number, number] | undefined;
  if (raw.baseColor !== undefined) {
    const c = raw.baseColor;
    if (!Array.isArray(c) || c.length !== 3 || !c.every((v) => isNum(v) && v >= 0 && v <= 8)) errors.push(`${where}.baseColor must be three numbers from 0 to 8`);
    else baseColor = [c[0], c[1], c[2]] as [number, number, number];
  }
  let notBlended: string[] | undefined;
  if (raw.notBlended !== undefined) {
    const n = raw.notBlended;
    if (!Array.isArray(n) || n.length > 12 || !n.every((v) => typeof v === "string" && v.length >= 1 && v.length <= 60)) errors.push(`${where}.notBlended must be a list of at most 12 short texts`);
    else notBlended = [...n] as string[];
  }
  let textures: MaterialTextures | undefined;
  if (raw.textures !== undefined) {
    if (!readTextures) errors.push(`${where}.textures cannot be read here`);
    else {
      textures = readTextures(raw.textures, `${where}.textures`, errors);
      if (textures) for (const [channel, map] of Object.entries(textures.maps)) {
        if (!(BLENDABLE_MAP_CHANNELS as readonly string[]).includes(channel)) errors.push(`${where}.textures.maps.${channel} cannot be blended along a gradient (supported: ${BLENDABLE_MAP_CHANNELS.join(", ")})`);
        else if (map && map.enabled && !map.texture) errors.push(`${where}.textures.maps.${channel} is enabled but has no image`);
      }
    }
  }
  let textureScale: number | undefined;
  if (raw.textureScale !== undefined) {
    if (!isNum(raw.textureScale) || raw.textureScale < MIN_TEXTURE_SCALE || raw.textureScale > MAX_TEXTURE_SCALE) errors.push(`${where}.textureScale must be a number from ${MIN_TEXTURE_SCALE} to ${MAX_TEXTURE_SCALE}`);
    else textureScale = raw.textureScale;
  }
  if (errors.length > before) return undefined;
  return {
    active: raw.active as boolean,
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    ...(source ? { source } : {}),
    metallic: raw.metallic as number,
    roughness: raw.roughness as number,
    reflectivity: raw.reflectivity as number,
    ...(baseColor ? { baseColor } : {}),
    ...(notBlended ? { notBlended } : {}),
    ...(textures ? { textures } : {}),
    ...(textureScale !== undefined ? { textureScale } : {}),
  };
}

/** Checks the optional ramp fields of one stop and the cap over the whole gradient. Returns the fields to keep. */
export function readRampFields(raw: Obj, where: string, errors: string[], readTextures?: TextureReader): RampFields {
  const out: RampFields = {};
  if (raw.transition !== undefined) {
    if (!isNum(raw.transition) || raw.transition < 0 || raw.transition > 1) errors.push(`${where}.transition must be a number from 0 to 1`);
    else out.transition = raw.transition;
  }
  if (raw.softness !== undefined) {
    if (!isNum(raw.softness) || raw.softness < 0 || raw.softness > 1) errors.push(`${where}.softness must be a number from 0 to 1`);
    else out.softness = raw.softness;
  }
  if (raw.material !== undefined) {
    const m = readStopMaterial(raw.material, `${where}.material`, errors, readTextures);
    if (m) out.material = m;
  }
  return out;
}

/** A stop as the blending maths needs it. */
export interface RampStop extends RampFields {
  position: number;
  color: string;
}

/** true when at least one stop is a Material stop. */
export const hasMaterialStops = (stops: readonly RampStop[]): boolean => stops.some((s) => s.material?.active === true);

/** true when the gradient uses anything beyond the plain linear colour blend. With false the old code path runs unchanged. */
export function rampActive(stops: readonly RampStop[]): boolean {
  return hasMaterialStops(stops) || stops.some((s) => (s.transition !== undefined && s.transition !== 1) || s.softness !== undefined);
}

/** How many stops carry a material snapshot (active or kept for reversibility). */
export const materialStopCount = (stops: readonly RampStop[]): number => stops.filter((s) => s.material !== undefined).length;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * The blend factor inside a segment, u = 0 at the first stop and 1 at the second, for transition width w.
 * w = 1: linear (the old blend). 0 < w < 1: a smooth step concentrated around the midpoint. w = 0: a hard boundary at the midpoint.
 */
export function segmentBlend(u: number, w = 1, softness?: number): number {
  const x = Math.min(1, Math.max(0, u));
  if (softness === undefined) {
    if (w >= 1) return x;
    if (w <= 0) return x < 0.5 ? 0 : 1;
    return smoothstep(Math.min(1, Math.max(0, (x - (0.5 - w / 2)) / w)));
  }
  // MG-02: the band keeps its width, and its edges go from a crisp linear ramp (softness 0) to a smooth step (softness 1).
  if (w <= 0) return x < 0.5 ? 0 : 1;
  const band = w >= 1 ? x : Math.min(1, Math.max(0, (x - (0.5 - w / 2)) / w));
  return band + (smoothstep(band) - band) * Math.min(1, Math.max(0, softness));
}

export interface RampLocation {
  /** Index of the stop on the low side and of the one on the high side (equal at and beyond the ends). */
  a: number;
  b: number;
  /** Blend factor 0 (all `a`) to 1 (all `b`). */
  s: number;
}

/** Which two stops contribute at gradient position x, and how much each. Only the two neighbours ever contribute. */
export function locateRamp(stops: readonly RampStop[], x: number): RampLocation {
  const last = stops.length - 1;
  if (x <= stops[0]!.position) return { a: 0, b: 0, s: 0 };
  if (x >= stops[last]!.position) return { a: last, b: last, s: 0 };
  for (let k = 0; k < last; k++) {
    const a = stops[k]!, b = stops[k + 1]!;
    if (x >= a.position && x <= b.position) {
      const span = b.position - a.position;
      const u = span === 0 ? 1 : (x - a.position) / span; // equal positions make a hard edge, as before
      return { a: k, b: k + 1, s: segmentBlend(u, a.transition ?? 1, a.softness) };
    }
  }
  return { a: last, b: last, s: 0 };
}

const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/** The sRGB colour at x when the ramp is in use (identical to the old `gradientAt` where every transition is 1). */
export function rampColorAt(stops: readonly RampStop[], x: number): [number, number, number] {
  const { a, b, s } = locateRamp(stops, x);
  const ca = hexToRgb(stops[a]!.color), cb = hexToRgb(stops[b]!.color);
  return [ca[0] + (cb[0] - ca[0]) * s, ca[1] + (cb[1] - ca[1]) * s, ca[2] + (cb[2] - ca[2]) * s];
}

const WHITE: [number, number, number] = [1, 1, 1];
/** The linear tint of a stop: its material's base colour when it is a Material stop, otherwise white (the colour is untouched). */
export const stopTint = (s: RampStop): [number, number, number] => (s.material?.active ? s.material.baseColor ?? WHITE : WHITE);

/** The blended linear tint at x. */
export function rampTintAt(stops: readonly RampStop[], x: number): [number, number, number] {
  const { a, b, s } = locateRamp(stops, x);
  const ta = stopTint(stops[a]!), tb = stopTint(stops[b]!);
  return [ta[0] + (tb[0] - ta[0]) * s, ta[1] + (tb[1] - ta[1]) * s, ta[2] + (tb[2] - ta[2]) * s];
}

export type RampScalar = "metallic" | "roughness" | "reflectivity";
/**
 * One surface property at gradient position x. A Colour stop contributes the scene's baseline value; a Material stop its own.
 */
export function rampScalarAt(stops: readonly RampStop[], x: number, key: RampScalar, baseline: number): number {
  const { a, b, s } = locateRamp(stops, x);
  const pick = (st: RampStop): number => (st.material?.active ? st.material[key] : baseline);
  const va = pick(stops[a]!), vb = pick(stops[b]!);
  return va + (vb - va) * s;
}

// ---- MG-02: textured entries --------------------------------------------------------------------------------------------------------

const imageHashes = new WeakMap<object, string>();
/** A short identity of an embedded image (the data address can be megabytes; it is hashed once per object). */
function imageId(data: string): string {
  let h1 = 0xdeadbeef ^ data.length, h2 = 0x41c6ce57 ^ data.length;
  for (let i = 0; i < data.length; i++) { const c = data.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + "." + data.length;
}

/** The enabled image maps of a stop material, in channel order. */
export function stopImageMaps(m: StopMaterial | undefined): { channel: (typeof BLENDABLE_MAP_CHANNELS)[number]; strength: number; mode: "multiply" | "replace"; data: string }[] {
  if (!m?.textures) return [];
  const out: ReturnType<typeof stopImageMaps> = [];
  for (const channel of BLENDABLE_MAP_CHANNELS) {
    const map = m.textures.maps[channel];
    if (map?.enabled && map.strength > 0 && map.texture) out.push({ channel, strength: map.strength, mode: map.mode, data: map.texture.data });
  }
  return out;
}

/** A Material stop that brings image maps into the blend. */
export const isTexturedStop = (s: RampStop): boolean => s.material?.active === true && stopImageMaps(s.material).length > 0;

/** The identity of one textured material: its maps (by image identity, strength and mode) and its scale. Stops with the same key share one record and its images. */
export function texturedKey(m: StopMaterial): string {
  const cached = imageHashes.get(m);
  if (cached) return cached;
  const key = JSON.stringify([stopImageMaps(m).map((x) => [x.channel, x.strength, x.mode, imageId(x.data)]), m.textureScale ?? 1, m.metallic, m.roughness, m.reflectivity]);
  imageHashes.set(m, key);
  return key;
}

export interface TexturedEntry { key: string; material: StopMaterial; stops: number[] }
/** The distinct textured materials of a gradient, in the order of their first stop. */
export function texturedEntries(stops: readonly RampStop[]): TexturedEntry[] {
  const out: TexturedEntry[] = [];
  stops.forEach((s, i) => {
    if (!isTexturedStop(s)) return;
    const key = texturedKey(s.material!);
    const found = out.find((e) => e.key === key);
    if (found) found.stops.push(i); else out.push({ key, material: s.material!, stops: [i] });
  });
  return out;
}

/**
 * How much of each textured entry is present at gradient position x (0 to 1 each; the rest is everything else: colour stops and
 * scalar-only material stops). Only the two neighbouring stops contribute, so at most two entries are non-zero.
 */
export function entryWeightsAt(stops: readonly RampStop[], entries: readonly TexturedEntry[], x: number): number[] {
  const w = new Array<number>(entries.length).fill(0);
  if (!entries.length) return w;
  const { a, b, s } = locateRamp(stops, x);
  const idx = (i: number): number => entries.findIndex((e) => e.stops.includes(i));
  const ia = idx(a), ib = idx(b);
  if (ia >= 0) w[ia]! += 1 - s;
  if (ib >= 0) w[ib]! += s;
  return w;
}
