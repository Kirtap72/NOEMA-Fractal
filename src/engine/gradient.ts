import { parse as parseYaml } from "yaml";
import { MAX_MATERIAL_STOPS, MAX_TEXTURED_MATERIALS, materialStopCount, rampActive, rampColorAt, rampTintAt, readRampFields, texturedEntries } from "./materialRamp";
// A cycle with materialTextures.ts (which reads images with readTexture below) that is safe: both only call each other inside functions.
import { readMaterialTextures } from "./materialTextures";
import type { RampFields } from "./materialRamp";

/** What a surface point is measured by, to pick its colour from the gradient. */
export const MEASURES = ["iterations", "orbit_trap", "slope", "cavity", "radius"] as const;
export type Measure = (typeof MEASURES)[number];

export const WRAP_MODES = ["repeat", "mirror"] as const;
export type WrapMode = (typeof WRAP_MODES)[number];

export interface GradientStop extends RampFields {
  /** Persistent scene-local color animation identity. */
  id?:string;
  /** 0 to 1 along the gradient. */
  position: number;
  /** "#rrggbb", as seen on screen (sRGB). */
  color: string;
}

export interface Gradient {
  id?: string;
  name?: string;
  stops: GradientStop[];
}

export const TEXTURE_MAPPINGS = ["triplanar", "spherical"] as const;
export type TextureMapping = (typeof TEXTURE_MAPPINGS)[number];

/** A picture laid over the surface colour. The picture itself is stored inside the scene as a data address (data:image/png;base64,...). */
export interface TextureSettings {
  /** A name to show, for example the file name. */
  name?: string;
  /** The picture as a PNG or JPEG data address. */
  data: string;
  /**
   * triplanar: the picture is projected along the three axes and blended by which way the surface faces;
   * spherical: the picture is wrapped around the centre like a map around a globe.
   */
  mapping: TextureMapping;
  /** How many times the picture repeats per unit of length (triplanar) or around the shape (spherical). */
  scale: number;
  /** 0 = only the gradient colour, 1 = only the picture. */
  strength: number;
}

/** The longest data address accepted: about 6 MB of picture. */
export const MAX_TEXTURE_DATA_LENGTH = 8_000_000;

export interface ColorSettings {
  gradient: Gradient;
  measure: Measure;
  /** How many times the gradient is repeated over the measure's range. */
  cycles: number;
  offset: number;
  wrap: WrapMode;
  /** A picture on the surface. Added in version 5. */
  texture?: TextureSettings;
}

export const MAX_GRADIENT_STOPS = 256;
export const LUT_SIZE = 256;
/** The colour data for the shader: 4 numbers of settings, 4 numbers about the texture, then LUT_SIZE colours of 4 numbers each. */
export const LUT_OFFSET = 8;
export const COLOR_FLOATS = LUT_OFFSET + LUT_SIZE * 4;

export const DEFAULT_GRADIENT: Gradient = {
  id: "default",
  name: "Standard",
  stops: [
    { position: 0, color: "#2a1b14" },
    { position: 0.5, color: "#b98a62" },
    { position: 1, color: "#f3e3c8" },
  ],
};

export const DEFAULT_COLOR: ColorSettings = {
  gradient: DEFAULT_GRADIENT,
  measure: "orbit_trap",
  cycles: 1,
  offset: 0,
  wrap: "mirror",
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z][a-z0-9-]*$/;

/** Checks gradient data. Reports every problem; returns undefined if there is any. */
export function readGradient(raw: unknown, where: string, errors: string[]): Gradient | undefined {
  const before = errors.length;
  if (!isObj(raw)) {
    errors.push(`${where} is required`);
    return undefined;
  }
  if (raw.id !== undefined && !(typeof raw.id === "string" && ID.test(raw.id))) {
    errors.push(`${where}.id must be lowercase letters, digits and hyphens`);
  }
  if (raw.name !== undefined && (typeof raw.name !== "string" || raw.name.trim() === "")) {
    errors.push(`${where}.name must be a text`);
  }
  const stops: GradientStop[] = [];
  if (!Array.isArray(raw.stops) || raw.stops.length < 2 || raw.stops.length > MAX_GRADIENT_STOPS) {
    errors.push(`${where}.stops must be a list of 2 to ${MAX_GRADIENT_STOPS} colour stops`);
  } else {
    let last = 0;
    raw.stops.forEach((s: unknown, i: number) => {
      const w = `${where}.stops[${i}]`;
      if (!isObj(s)) return void errors.push(`${w} must be a mapping`);
      if (!isNum(s.position) || s.position < 0 || s.position > 1) {
        return void errors.push(`${w}.position must be a number from 0 to 1`);
      }
      if (typeof s.color !== "string" || !HEX.test(s.color)) {
        return void errors.push(`${w}.color must look like #rrggbb`);
      }
      if (s.position < last) errors.push(`${w}.position must not be smaller than the one before`);
      last = s.position;
      if(s.id!==undefined&&(typeof s.id!=='string'||!/^[-\w]{1,64}$/.test(s.id)))errors.push(w+'.id is invalid');
      // MATERIAL-GRADIENT-01: optional material snapshot and transition width; absent for every older gradient.
      const ramp = readRampFields(s, w, errors, readMaterialTextures);
      stops.push({ ...(typeof s.id==='string'?{id:s.id}:{}),position: s.position, color: s.color.toLowerCase(), ...ramp });
    });
  }
  const ids=stops.flatMap(s=>s.id?[s.id]:[]);if(new Set(ids).size!==ids.length)errors.push(where+': duplicate stop identities');
  if (materialStopCount(stops) > MAX_MATERIAL_STOPS) errors.push(`${where}: at most ${MAX_MATERIAL_STOPS} stops may carry a material`);
  if (errors.length === before && texturedEntries(stops).length > MAX_TEXTURED_MATERIALS) errors.push(`${where}: at most ${MAX_TEXTURED_MATERIALS} different textured materials may be used in one gradient (this one has ${texturedEntries(stops).length})`);
  if (errors.length > before) return undefined;
  return {
    ...(typeof raw.id === "string" ? { id: raw.id } : {}),
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    stops,
  };
}

/** Checks colour settings from a scene. Missing optional values get defaults. */
export function readColorSettings(raw: unknown, where: string, errors: string[]): ColorSettings | undefined {
  const before = errors.length;
  if (!isObj(raw)) {
    errors.push(`${where} is required`);
    return undefined;
  }
  const gradient = readGradient(raw.gradient, `${where}.gradient`, errors);
  const measure = raw.measure;
  if (!MEASURES.includes(measure as Measure)) errors.push(`${where}.measure must be one of: ${MEASURES.join(", ")}`);
  const cycles = raw.cycles === undefined ? 1 : raw.cycles;
  if (!isNum(cycles) || cycles < 0.05 || cycles > 20) errors.push(`${where}.cycles must be a number from 0.05 to 20`);
  const offset = raw.offset === undefined ? 0 : raw.offset;
  if (!isNum(offset) || offset < -100 || offset > 100) errors.push(`${where}.offset must be a number from -100 to 100`);
  const wrap = raw.wrap === undefined ? "mirror" : raw.wrap;
  if (!WRAP_MODES.includes(wrap as WrapMode)) errors.push(`${where}.wrap must be "repeat" or "mirror"`);
  const texture = raw.texture === undefined ? undefined : readTexture(raw.texture, `${where}.texture`, errors);
  if (errors.length > before || !gradient) return undefined;
  return {
    gradient,
    measure: measure as Measure,
    cycles: cycles as number,
    offset: offset as number,
    wrap: wrap as WrapMode,
    ...(texture ? { texture } : {}),
  };
}

const DATA_ADDRESS = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Checks the texture of a colour setting. The picture must be a PNG or JPEG data address, and nothing else. */
export function readTexture(raw: unknown, where: string, errors: string[]): TextureSettings | undefined {
  const before = errors.length;
  if (!isObj(raw)) {
    errors.push(`${where} must be a mapping`);
    return undefined;
  }
  if (typeof raw.data !== "string" || raw.data.length > MAX_TEXTURE_DATA_LENGTH || !DATA_ADDRESS.test(raw.data)) {
    errors.push(`${where}.data must be a PNG or JPEG picture as a data address (data:image/png;base64,...), at most ${MAX_TEXTURE_DATA_LENGTH} characters`);
  }
  if (!TEXTURE_MAPPINGS.includes(raw.mapping as TextureMapping)) errors.push(`${where}.mapping must be "triplanar" or "spherical"`);
  if (!isNum(raw.scale) || raw.scale < 0.05 || raw.scale > 2 ** 24) errors.push(`${where}.scale must be a number from 0.05 to 16777216`);
  if (!isNum(raw.strength) || raw.strength < 0 || raw.strength > 1) errors.push(`${where}.strength must be a number from 0 to 1`);
  if (raw.name !== undefined && (typeof raw.name !== "string" || raw.name.length > 100)) errors.push(`${where}.name must be a text of at most 100 characters`);
  if (errors.length > before) return undefined;
  return {
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    data: raw.data as string,
    mapping: raw.mapping as TextureMapping,
    scale: raw.scale as number,
    strength: raw.strength as number,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** The colour of a gradient at position x (0 to 1), in sRGB, 0 to 1 per channel. */
export function gradientAt(stops: readonly GradientStop[], x: number): [number, number, number] {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (x <= first.position) return hexToRgb(first.color);
  if (x >= last.position) return hexToRgb(last.color);
  for (let k = 0; k < stops.length - 1; k++) {
    const a = stops[k]!;
    const b = stops[k + 1]!;
    if (x >= a.position && x <= b.position) {
      const span = b.position - a.position;
      const t = span === 0 ? 1 : (x - a.position) / span; // equal positions make a hard edge
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return hexToRgb(last.color);
}

/**
 * Packs colour settings for the shader: 4 numbers of settings, then a
 * table of LUT_SIZE colours. The colours are converted from sRGB to linear
 * light, because the shader does its lighting in linear light.
 */
export function packColor(settings: ColorSettings, out = new Float32Array(COLOR_FLOATS)): Float32Array {
  out[0] = MEASURES.indexOf(settings.measure);
  out[1] = settings.cycles;
  out[2] = settings.offset;
  out[3] = settings.wrap === "mirror" ? 1 : 0;
  // The texture: strength (0 when there is none), scale, mapping (0 = triplanar, 1 = spherical).
  const t = settings.texture;
  out[4] = t ? t.strength : 0;
  out[5] = t ? t.scale : 1;
  out[6] = t && t.mapping === "spherical" ? 1 : 0;
  out[7] = 0;
  // MATERIAL-GRADIENT-01: with material stops or a transition width the ramp decides the colour and its linear tint;
  // otherwise the old code path below runs unchanged, so every older gradient packs bit-identically.
  const ramp = rampActive(settings.gradient.stops);
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = i / (LUT_SIZE - 1);
    const rgb = ramp ? rampColorAt(settings.gradient.stops, x) : gradientAt(settings.gradient.stops, x);
    const tint = ramp ? rampTintAt(settings.gradient.stops, x) : null;
    out[LUT_OFFSET + i * 4] = rgb[0] ** 2.2 * (tint ? tint[0] : 1);
    out[LUT_OFFSET + 1 + i * 4] = rgb[1] ** 2.2 * (tint ? tint[1] : 1);
    out[LUT_OFFSET + 2 + i * 4] = rgb[2] ** 2.2 * (tint ? tint[2] : 1);
    out[LUT_OFFSET + 3 + i * 4] = 1;
  }
  return out;
}

// ---- gradient files (gradients/*.yaml)

export interface GradientFile extends Gradient {
  id: string;
  name: string;
  author: string;
  description?: string;
}

export type GradientFileResult = { ok: true; gradient: GradientFile } | { ok: false; errors: string[] };

/** Reads one gradient file (YAML). Needs id, name, author and the colour stops. */
export function parseGradientFile(text: string): GradientFileResult {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    return { ok: false, errors: [`not valid YAML: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!isObj(doc)) return { ok: false, errors: ["the file must contain a YAML mapping (key: value)"] };
  const errors: string[] = [];
  if (doc.format !== 1) errors.push("format must be 1");
  if (typeof doc.id !== "string" || !ID.test(doc.id)) errors.push("id is required: lowercase letters, digits and hyphens");
  if (typeof doc.name !== "string" || doc.name.trim() === "") errors.push("name is required");
  if (typeof doc.author !== "string" || doc.author.trim() === "") errors.push("author is required");
  const g = readGradient(doc, "gradient", errors);
  if (errors.length > 0 || !g) return { ok: false, errors };
  return {
    ok: true,
    gradient: {
      id: doc.id as string,
      name: doc.name as string,
      author: doc.author as string,
      ...(typeof doc.description === "string" ? { description: doc.description.trim() } : {}),
      stops: g.stops,
    },
  };
}

export interface GradientLibrary {
  gradients: GradientFile[];
  problems: { file: string; errors: string[] }[];
}

/** Turns raw file texts into a gradient library. A broken file never blocks the others. */
export function buildGradientLibrary(files: Record<string, string>): GradientLibrary {
  const gradients: GradientFile[] = [];
  const problems: GradientLibrary["problems"] = [];
  for (const file of Object.keys(files).sort()) {
    const r = parseGradientFile(files[file]!);
    if (!r.ok) problems.push({ file, errors: r.errors });
    else if (gradients.some((g) => g.id === r.gradient.id)) {
      problems.push({ file, errors: [`id "${r.gradient.id}" is already used by another gradient file`] });
    } else gradients.push(r.gradient);
  }
  return { gradients, problems };
}
