import type { ColorSettings } from "./gradient";
import type { DrivenProperty, MaterialProperty, MaterialSettings } from "./material";
import { resolveMaterial } from "./material";

/**
 * Pure helpers for browsing the material library (ARTIST-LOOKS-01): search, order, plain-language traits and an
 * approximate colour swatch. Nothing here reads or writes the library, the scene or the screen.
 *
 * The library format has no thumbnails: `thumbnail` must be "" (materialPresets.ts), so there are no genuine
 * pictures of materials to show. The swatch is therefore always an *approximation drawn from the numbers*, never a render.
 */

export interface SearchableMaterial {
  title: string;
  tags: string;
  notes: string;
}

/** Lower case, no accents or diacritics (so "grön" is found by "gron" too), single spaces. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query must occur in the name, tags or notes. Returns the same objects, in the same order. */
export function searchMaterials<T extends SearchableMaterial>(entries: readonly T[], query: string): T[] {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => {
    const haystack = normalizeSearch(`${entry.title} ${entry.tags} ${entry.notes}`);
    return words.every((word) => haystack.includes(word));
  });
}

export type MaterialOrder = "name" | "newest";

/** A new array. Ties keep their order; names compare the Swedish way. */
export function sortMaterials<T extends { title: string; createdAt: string }>(entries: readonly T[], order: MaterialOrder): T[] {
  const copy = [...entries];
  if (order === "newest") return copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.title.localeCompare(b.title, "en"));
  return copy.sort((a, b) => a.title.localeCompare(b.title, "en"));
}

export interface MaterialTraits {
  metallic: number;
  roughness: number;
  reflectivity: number;
  /** A value that follows the surface (a curve) is shown as its average. */
  followsSurface: boolean;
  /** Enabled texture maps that really carry an image. */
  maps: string[];
  /** Maps that are switched on but have no image in the preset. */
  mapsWithoutImage: string[];
  displacement: boolean;
  surfaceDetail: boolean;
  transmission: boolean;
  emission: boolean;
  includesColor: boolean;
}

const MAP_NAMES: Record<string, string> = { baseColor: "colour", roughness: "roughness", metallic: "metal", ao: "ocklusion", emission: "emission" };

function averageOf(property: MaterialProperty): { value: number; driven: boolean } {
  if (typeof property === "number") return { value: property, driven: false };
  const driven = property as DrivenProperty;
  const values = driven.curve.map((p) => p.value);
  return { value: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length), driven: true };
}

export function materialTraits(material: MaterialSettings, color?: ColorSettings): MaterialTraits {
  const resolved = resolveMaterial(material);
  const metallic = averageOf(material.metallic);
  const roughness = averageOf(material.roughness);
  const reflectivity = averageOf(material.reflectivity);
  const maps: string[] = [];
  const mapsWithoutImage: string[] = [];
  for (const [channel, map] of Object.entries(material.textures?.maps ?? {})) {
    if (!map?.enabled) continue;
    (map.texture?.data ? maps : mapsWithoutImage).push(MAP_NAMES[channel] ?? channel);
  }
  const detail = material.surfaceDetail;
  return {
    metallic: metallic.value,
    roughness: roughness.value,
    reflectivity: reflectivity.value,
    followsSurface: metallic.driven || roughness.driven || reflectivity.driven,
    maps,
    mapsWithoutImage,
    displacement: !!material.displacement?.enabled,
    surfaceDetail: !!(detail && (detail.bump.enabled || detail.normal.enabled || detail.procedural?.enabled)),
    transmission: resolved.transmission > 0,
    emission: resolved.emissionStrength > 0,
    includesColor: color !== undefined,
  };
}

const two = (v: number): string => v.toFixed(2);

/** A short line for a card: only what sets the material apart, so most cards stay quiet. */
export function traitsSummary(t: MaterialTraits): string {
  const parts = [`Metal ${two(t.metallic)}`, `Roughness ${two(t.roughness)}`];
  if (t.reflectivity > 0) parts.push(`Reflection ${two(t.reflectivity)}`);
  if (t.followsSurface) parts.push("controlled by the surface");
  if (t.maps.length) parts.push("textures: " + t.maps.join(", "));
  if (t.transmission) parts.push("glas");
  if (t.emission) parts.push("lyser");
  return parts.join(" · ");
}

/** What applying changes beyond the plain numbers, for the detail view. Each line is something the artist should know. */
export function traitsNotes(t: MaterialTraits): string[] {
  const notes: string[] = [];
  if (t.displacement) notes.push("Displacement changes the shape of the surface and costs render time.");
  if (t.surfaceDetail) notes.push("Surface detail (bump/normal/procedure) is included.");
  if (t.maps.length) notes.push("Texture pictures are embedded in the preset: " + t.maps.join(", ") + ".");
  if (t.mapsWithoutImage.length) notes.push("These textures are turned on but lack a picture in the preset: " + t.mapsWithoutImage.join(", ") + ".");
  if (t.transmission) notes.push("Glass is only visible in Final Preview or the final render.");
  t.includesColor
    ? notes.push("The preset has a saved gradient/colour. It only follows along if the box 'Include … gradient and colour' is ticked.")
    : notes.push("The preset has no saved gradient: your gradient is preserved.");
  return notes;
}

export interface MaterialSwatch {
  /** Always "approximate": there are no genuine thumbnails in the library format. */
  kind: "approximate" | "unknown";
  /** A CSS background. Never an image from the library, never a data URL. */
  background: string;
  description: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const toSrgbByte = (linear: number): number => Math.round(255 * clamp01(linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055));
const rgb = (c: readonly number[]): string => `rgb(${c.map((v) => Math.round(v)).join(",")})`;
const mix = (a: readonly number[], b: readonly number[], t: number): number[] => a.map((v, i) => v + (b[i]! - v) * t);
const hexToBytes = (hex: string): number[] => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));

/**
 * A small sphere drawn with CSS from the numbers of the material: the colour, how metallic it is (darker body, brighter
 * highlight) and how rough it is (a wider, softer highlight). It is a hint for scanning a long list, not a picture of how
 * the material looks on a fractal.
 */
export function approximateSwatch(material: MaterialSettings, color?: ColorSettings): MaterialSwatch {
  const resolved = resolveMaterial(material);
  const traits = materialTraits(material, color);
  const linear = resolved.diffuseColor.map((d, i) => d * resolved.baseColor[i]!);
  let body = linear.map(toSrgbByte);
  // A preset that carries its own gradient is shown by that gradient's middle stop: the colour it would bring along.
  const stops = color?.gradient.stops ?? [];
  if (stops.length) body = hexToBytes(stops[Math.floor((stops.length - 1) / 2)]!.color);
  const metal = clamp01(traits.metallic);
  const rough = clamp01(traits.roughness);
  const shade = mix(body, [0, 0, 0], 0.55 + 0.25 * metal);
  const highlight = mix(mix(body, [255, 255, 255], 0.55), [255, 255, 255], metal * 0.35);
  const spread = 14 + 38 * rough; // % of the radius the highlight covers
  const sphere = `radial-gradient(circle at 34% 30%, ${rgb(highlight)} 0%, ${rgb(body)} ${spread + 30}%, ${rgb(shade)} 100%)`;
  return {
    kind: "approximate",
    background: sphere,
    description: `Approximate colour dot, calculated from the values of the material (metal ${two(traits.metallic)}, roughness ${two(traits.roughness)}${traits.transmission ? ", glass" : ""}${traits.emission ? ", glowing" : ""}). It is not a rendering.`,
  };
}

/** Shown while a preset's values are not loaded yet or could not be read. */
export function unknownSwatch(): MaterialSwatch {
  return {
    kind: "unknown",
    background: "repeating-linear-gradient(45deg, #3b4b5a 0 6px, #2f3d4a 6px 12px)",
    description: "No preview: the values of the material have not been read.",
  };
}
