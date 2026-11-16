/**
 * MATERIAL-GRADIENT-01: from a gradient with material stops to the inputs the renderer already has.
 *
 * `effectiveMaterial` is called where the scene's material is packed for the shader (engine.ts). It never changes the stored
 * scene: the gradient's material stops become internal `DrivenProperty` curves with measure "color" and the SAME cycles,
 * offset and wrap as the colour, so the shader samples them with exactly the colour's `t` (shader.ts `matValue` and
 * `gradientColor` both use measure * cycles + offset, wrapped the same way). No shader, uniform or binding changes.
 *
 * The albedo tint of a stop is applied to the colour table instead (gradient.ts `packColor`, via materialRamp.ts).
 */
import { CURVE_TABLE_SIZE, curveTable } from "./material";
import type { DrivenProperty, MaterialProperty, MaterialSettings } from "./material";
import { materialTraits } from "./materialBrowse";
import { BLENDABLE_MAP_CHANNELS, MAX_TEXTURE_SCALE, MIN_TEXTURE_SCALE, hasMaterialStops, rampScalarAt } from "./materialRamp";
import type { RampScalar, StopMaterial } from "./materialRamp";
import type { MaterialTextures, PbrChannel } from "./materialTextures";
import type { ColorSettings } from "./gradient";

const SCALARS: readonly RampScalar[] = ["metallic", "roughness", "reflectivity"];

/** The scene's own value of a property: its number, or the mean of its curve when it follows the surface. */
function baselineOf(p: MaterialProperty): number {
  if (typeof p === "number") return p;
  const table = curveTable(p.curve);
  return table.reduce((a, b) => a + b, 0) / table.length;
}

/** The scene's own surface values, as the ramp sees them at Colour stops (a property that follows the surface counts as its mean). */
export const materialBaseline = (m: MaterialSettings): { metallic: number; roughness: number; reflectivity: number } => ({ metallic: baselineOf(m.metallic), roughness: baselineOf(m.roughness), reflectivity: baselineOf(m.reflectivity) });

/** A property curve sampled exactly at the shader table's own nodes (the table is linear between them). */
function rampCurve(color: ColorSettings, key: RampScalar, baseline: number): DrivenProperty {
  const stops = color.gradient.stops;
  const curve = Array.from({ length: CURVE_TABLE_SIZE }, (_, i) => {
    const x = i / (CURVE_TABLE_SIZE - 1);
    return { position: x, value: Math.min(1, Math.max(0, rampScalarAt(stops, x, key, baseline))) };
  });
  return { measure: "color", curve, cycles: color.cycles, offset: color.offset, wrap: color.wrap };
}

/**
 * The material the shader should use. Returns the SAME object when no stop is a Material stop (nothing changes), otherwise a
 * copy whose metallic, roughness and reflectivity follow the gradient. Colour stops contribute the scene's own values.
 */
export function effectiveMaterial(color: ColorSettings, material: MaterialSettings): MaterialSettings {
  if (!hasMaterialStops(color.gradient.stops)) return material;
  const next: MaterialSettings = { ...material };
  for (const key of SCALARS) next[key] = rampCurve(color, key, baselineOf(material[key]));
  return next;
}

const MAP_SV: Record<string, string> = { baseColor: "colour", roughness: "roughness", metallic: "metal", ao: "ocklusion", emission: "emission" };
const isBlendable = (c: string): boolean => (BLENDABLE_MAP_CHANNELS as readonly string[]).includes(c);

/** The part of a material's maps that a gradient can blend: enabled image maps of base colour, roughness, metallic and ambient occlusion. */
function blendableTextures(material: MaterialSettings): MaterialTextures | undefined {
  const maps: MaterialTextures["maps"] = {};
  for (const [channel, map] of Object.entries(material.textures?.maps ?? {})) {
    if (!isBlendable(channel) || !map?.enabled || map.strength <= 0 || !map.texture) continue;
    maps[channel as PbrChannel] = { enabled: true, strength: map.strength, mode: map.mode, texture: { data: map.texture.data, ...(map.texture.name ? { name: map.texture.name } : {}) } };
  }
  return Object.keys(maps).length ? { maps } : undefined;
}

/**
 * What a material has that a gradient does NOT blend. Swedish, as shown to the artist and returned to the AI; never dropped silently.
 * MG-02: image maps of base colour, roughness, metallic and ambient occlusion ARE blended now (with their own scale); the rest is listed here.
 */
export function notBlendedFeatures(material: MaterialSettings): string[] {
  const t = materialTraits(material);
  const out: string[] = [];
  const skipped = Object.entries(material.textures?.maps ?? {}).filter(([c, m]) => m?.enabled && m.texture && !isBlendable(c)).map(([c]) => MAP_SV[c] ?? c);
  if (skipped.length) out.push(`picture maps that are not blended (${skipped.join(", ")})`);
  if (t.mapsWithoutImage.length) out.push("maps without a picture");
  if (t.displacement) out.push("displacement");
  const d = material.surfaceDetail;
  if (d?.normal.enabled && d.normal.texture) out.push("normal map (not blended)");
  if (d?.bump.enabled && d.bump.texture) out.push("bump map (not blended)");
  if (d?.procedural?.enabled) out.push("procedural surface detail (not blended)");
  if (t.transmission) out.push("transmission");
  if (t.emission) out.push("emission");
  if (t.followsSurface) out.push("properties that follow the surface (the mean value is used)");
  return out;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * A self-contained snapshot of the blendable part of a material, for one gradient stop. A property that follows the surface is
 * reduced to its mean and reported in `notBlended`, never presented as preserved.
 */
export function snapshotStopMaterial(material: MaterialSettings, name?: string, source?: { id: string; fingerprint?: string }): StopMaterial {
  const base = material.baseColor;
  const notBlended = notBlendedFeatures(material);
  const textures = blendableTextures(material);
  const scale = material.surfaceDetail?.scale;
  return {
    active: true,
    ...(name ? { name: name.slice(0, 100) } : {}),
    ...(source ? { source } : {}),
    metallic: clamp01(baselineOf(material.metallic)),
    roughness: clamp01(baselineOf(material.roughness)),
    reflectivity: clamp01(baselineOf(material.reflectivity)),
    ...(base && !(base[0] === 1 && base[1] === 1 && base[2] === 1) ? { baseColor: [base[0], base[1], base[2]] as [number, number, number] } : {}),
    ...(notBlended.length ? { notBlended } : {}),
    ...(textures ? { textures } : {}),
    ...(textures && scale !== undefined && scale !== 1 && scale >= MIN_TEXTURE_SCALE && scale <= MAX_TEXTURE_SCALE ? { textureScale: scale } : {}),
  };
}
