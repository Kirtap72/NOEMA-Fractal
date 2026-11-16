import {defaultSurfaceDetail,readSurfaceDetail,withProceduralDetail} from './surfaceDetail';
import type {SurfaceDetailSettings} from './surfaceDetail';
import {readMaterialTextures} from './materialTextures';
import type {MaterialTextures} from './materialTextures';
import {readDisplacement} from './displacement';
import type {DisplacementSettings} from './displacement';
import { MEASURES, WRAP_MODES } from "./gradient";
import type { Measure, WrapMode } from "./gradient";

/**
 * The material of the surface (scene version 13; ARCHITECTURE.md 8.16 step 5 and 8.22): metal, roughness and
 * reflectivity, each a number or driven by a measure of the surface through a curve, like the colour's gradient.
 *
 * The model is the metallic-roughness model of glTF 2.0 (Khronos Group), so that materials can later be exported to
 * Blender and Unreal without being reinterpreted. Its parts are written fresh for this project from their public
 * descriptions; no code was read or copied. The formulas below are checked in tests/material.test.ts against
 * properties that can be computed independently (for example that the normal distribution adds up to 1).
 *
 *  - Diffuse part: the base colour times (1 - metallic), as in glTF.
 *  - Specular part: F0 (the reflectance at normal incidence) is 0.04 for a dielectric and the base colour for a metal,
 *    mixed by `metallic`. The specular part is scaled by max(reflectivity, metallic): a surface with reflectivity 0
 *    and no metal has no specular part, so every scene made before version 13 is drawn exactly as before.
 *  - Specular BRDF: D (GGX / Trowbridge-Reitz) x V (height-correlated Smith-GGX visibility) x F (Schlick).
 *    GGX: Walter, Marschner, Li and Torrance, EGSR 2007. Schlick: Christophe Schlick, 1994. alpha = roughness^2.
 *    The formulas were read from the Filament documentation (Google, Apache 2.0) on 2026-10-07 and Wikipedia
 *    (Schlick's approximation); the correlated Smith visibility is credited to Eric Heitz (2014) from memory (unverified).
 *  - Light from the environment (mirror reflection): the picture of the environment (or the gradient sky) in the
 *    direction of the mirror image, blurred by roughness (a mip level of the picture), times a Fresnel term that
 *    follows Lagarde's roughness-aware Schlick variant (from memory, unverified). It never exceeds the light it
 *    receives (energy is not created).
 */

export const MATERIAL_SOURCES = ["color", ...MEASURES] as const;
export type MaterialSource = (typeof MATERIAL_SOURCES)[number];

export interface CurvePoint {
  /** 0 to 1: where on the (wrapped) measure. */
  position: number;
  /** 0 to 1: the value of the property there. */
  value: number;
}

/** A property that follows a measure of the surface instead of being one number. */
export interface DrivenProperty {
  /** "color" means the same measure as the colour uses. */
  measure: MaterialSource;
  /** 2 to 16 points with rising positions; the value is interpolated between them and held beyond the ends. */
  curve: CurvePoint[];
  cycles: number;
  offset: number;
  wrap: WrapMode;
}

export type MaterialProperty = number | DrivenProperty;

export interface MaterialSettings {
  /** Primary fractal diffuse only; absent/one preserves the original shader. */
  orbitColorInfluence?:number;
  /** Independent linear diffuse color before legacy texture blend and tint. */
  diffuseColor?:[number,number,number];
  displacement?:DisplacementSettings;
  textures?:MaterialTextures;
  surfaceDetail?:SurfaceDetailSettings;
  metallic: MaterialProperty;
  roughness: MaterialProperty;
  reflectivity: MaterialProperty;
  /** Linear multiplier of the existing gradient/texture/primitive colour. White preserves it. */
  baseColor?: [number, number, number];
  transmission?: number;
  ior?: number;
  /** Transmittance at one world unit when density is one. */
  absorptionColor?: [number, number, number];
  absorptionDensity?: number;
  emissionColor?: [number, number, number];
  emissionStrength?: number;
}

export type CanonicalMaterial = Required<Omit<MaterialSettings,'textures'|'displacement'>>&Pick<MaterialSettings,'textures'|'displacement'>;
export function resolveMaterial(m: MaterialSettings): CanonicalMaterial {
  return {orbitColorInfluence:1,diffuseColor:[1,1,1],surfaceDetail:defaultSurfaceDetail(),baseColor:[1,1,1],transmission:0,ior:1.5,absorptionColor:[1,1,1],absorptionDensity:0,emissionColor:[0,0,0],emissionStrength:0,...m};
}
/** Normal-incidence dielectric Fresnel, from the two media's refractive indices. */
export function dielectricF0(ior:number,medium=1):number {return ((ior-medium)/(ior+medium))**2;}


export const MATERIAL_PROPERTIES = ["metallic", "roughness", "reflectivity"] as const;
export type MaterialPropertyName = (typeof MATERIAL_PROPERTIES)[number];

/** Not metal, fully rough, no reflection: exactly what every scene looked like before version 13. */
export const DEFAULT_MATERIAL: MaterialSettings = { metallic: 0, roughness: 1, reflectivity: 0 };
export const MAX_CURVE_POINTS = 16;
export const CURVE_CYCLES_LIMITS = [0.1, 10] as const;
/** The values of a curve as the shader reads them: this many, evenly spaced from 0 to 1. */
export const CURVE_TABLE_SIZE = 32;
/** Roughness is never below this in the shader: a perfect mirror has no highlight to draw and divides by 0. */
export const MIN_ROUGHNESS = 0.045;

export function defaultMaterial(): MaterialSettings {
  return { ...DEFAULT_MATERIAL };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function readProperty(raw: unknown, where: string, errors: string[]): MaterialProperty | undefined {
  if (isNum(raw)) {
    if (raw < 0 || raw > 1) return void errors.push(`${where} must be a number from 0 to 1, or an object with a measure and a curve`);
    return raw;
  }
  if (!isObj(raw)) return void errors.push(`${where} must be a number from 0 to 1, or an object with a measure and a curve`);
  const before = errors.length;
  if (!(MATERIAL_SOURCES as readonly unknown[]).includes(raw.measure)) errors.push(`${where}.measure must be "color" or one of: ${MEASURES.join(", ")}`);
  const curve: CurvePoint[] = [];
  if (!Array.isArray(raw.curve) || raw.curve.length < 2 || raw.curve.length > MAX_CURVE_POINTS) errors.push(`${where}.curve must be a list of 2 to ${MAX_CURVE_POINTS} points`);
  else {
    let before = -1;
    raw.curve.forEach((p: unknown, i: number) => {
      if (!isObj(p) || !isNum(p.position) || !isNum(p.value) || p.position < 0 || p.position > 1 || p.value < 0 || p.value > 1) {
        return void errors.push(`${where}.curve[${i}] needs a position and a value, each from 0 to 1`);
      }
      if (p.position <= before) return void errors.push(`${where}.curve[${i}].position must be larger than the one before`);
      before = p.position;
      curve.push({ position: p.position, value: p.value });
    });
  }
  const cycles = raw.cycles === undefined ? 1 : raw.cycles;
  if (!isNum(cycles) || cycles < CURVE_CYCLES_LIMITS[0] || cycles > CURVE_CYCLES_LIMITS[1]) errors.push(`${where}.cycles must be a number from ${CURVE_CYCLES_LIMITS[0]} to ${CURVE_CYCLES_LIMITS[1]}`);
  const offset = raw.offset === undefined ? 0 : raw.offset;
  if (!isNum(offset) || offset < 0 || offset > 1) errors.push(`${where}.offset must be a number from 0 to 1`);
  const wrap = raw.wrap === undefined ? "mirror" : raw.wrap;
  if (!(WRAP_MODES as readonly unknown[]).includes(wrap)) errors.push(`${where}.wrap must be "repeat" or "mirror"`);
  if (errors.length > before) return undefined;
  return { measure: raw.measure as MaterialSource, curve, cycles: cycles as number, offset: offset as number, wrap: wrap as WrapMode };
}

/** Reads and checks a material block. No block means the default material (matt, no metal, no reflection). */
export function readMaterial(raw: unknown, where: string, errors: string[]): MaterialSettings | undefined {
  if (raw === undefined) return defaultMaterial();
  if (!isObj(raw)) return void errors.push(`${where} must be an object`);
  const before = errors.length;
  const out = defaultMaterial();
  const scalarLimits={orbitColorInfluence:[0,1],transmission:[0,1],ior:[1,4],absorptionDensity:[0,1000],emissionStrength:[0,1000]} as const;
  for(const [key,limits] of Object.entries(scalarLimits)){
    const value=raw[key];if(value===undefined)continue;
    if(!isNum(value)||value<limits[0]||value>limits[1])errors.push(`${where}.${key} must be finite within ${limits.join(' to ')}`);
    else Object.assign(out,{[key]:value});
  }
  for(const key of ['diffuseColor','baseColor','absorptionColor','emissionColor'] as const){
    const value=raw[key];if(value===undefined)continue;
    if(!Array.isArray(value)||value.length!==3||value.some(v=>!isNum(v)||v<0||v>1))errors.push(`${where}.${key} needs three linear values from 0 to 1`);
    else out[key]=[...value] as [number,number,number];
  }
  if(raw.surfaceDetail!==undefined){const d=readSurfaceDetail(raw.surfaceDetail,`${where}.surfaceDetail`,errors);if(d)out.surfaceDetail=d;}
  if(raw.textures!==undefined){const t=readMaterialTextures(raw.textures,`${where}.textures`,errors);if(t)out.textures=t;}
  if(raw.displacement!==undefined){const d=readDisplacement(raw.displacement,`${where}.displacement`,errors);if(d)out.displacement=d;}
  for(const key of Object.keys(raw))if(!['diffuseColor','displacement','textures','surfaceDetail',...MATERIAL_PROPERTIES,...Object.keys(scalarLimits),'baseColor','absorptionColor','emissionColor'].includes(key))errors.push(`${where}.${key} is unknown`);
  for (const key of MATERIAL_PROPERTIES) {
    if (raw[key] === undefined) continue;
    const p = readProperty(raw[key], `${where}.${key}`, errors);
    if (p !== undefined) out[key] = p;
  }
  return errors.length > before ? undefined : out;
}

/** The same value for two materials that look the same: used to leave default fields out when saving. */
export function isDefaultMaterial(m: MaterialSettings): boolean {
  const r=resolveMaterial(m);
  return m.orbitColorInfluence===undefined && m.diffuseColor===undefined && m.displacement===undefined && m.textures===undefined && m.surfaceDetail===undefined && m.metallic === 0 && m.roughness === 1 && m.reflectivity === 0 && r.transmission===0&&r.ior===1.5&&r.absorptionDensity===0&&r.emissionStrength===0&&r.baseColor.every(v=>v===1);
}

/** True when the shader has anything to add: some part is driven by a measure, or there is metal or reflection. */
export function materialIsActive(m: MaterialSettings): boolean {
  const driven = (p: MaterialProperty) => typeof p !== "number";
  return (["metallic","roughness"] as const).some(k=>{const t=m.textures?.maps[k];return t?.enabled&&t.strength>0&&!!t.texture}) || driven(m.metallic) || driven(m.reflectivity) || driven(m.roughness) || (m.metallic as number) > 0 || (m.reflectivity as number) > 0;
}

// ---- the curve and the wrapping of a measure (the same rules as the colour's gradient)

/** The measure after cycles and offset, wrapped into 0 to 1 the way the gradient does it (mirror: 0 to 1 and back; repeat: fraction). */
export function wrapMeasure(x: number, wrap: WrapMode): number {
  if (wrap === "mirror") {
    const m = x - 2 * Math.floor(x / 2);
    return 1 - Math.abs(1 - m);
  }
  return x - Math.floor(x);
}

/** The value of a curve at t (0 to 1): linear between points, held beyond the first and last. */
export function sampleCurve(curve: readonly CurvePoint[], t: number): number {
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (t <= first.position) return first.value;
  if (t >= last.position) return last.value;
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i]!;
    if (t <= b.position) {
      const a = curve[i - 1]!;
      return a.value + ((b.value - a.value) * (t - a.position)) / (b.position - a.position);
    }
  }
  return last.value;
}

/** The curve as the table the shader reads (CURVE_TABLE_SIZE values from 0 to 1). */
export function curveTable(curve: readonly CurvePoint[]): number[] {
  return Array.from({ length: CURVE_TABLE_SIZE }, (_, i) => sampleCurve(curve, i / (CURVE_TABLE_SIZE - 1)));
}

/** What the shader does with a table: linear interpolation between neighbouring entries. */
export function tableValue(table: readonly number[], t: number): number {
  const f = Math.min(1, Math.max(0, t)) * (table.length - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, table.length - 1);
  return table[i]! + (table[j]! - table[i]!) * (f - i);
}

/** The value of a property for a raw measure value m (before cycles and offset). A number ignores m. */
export function propertyValue(p: MaterialProperty, m: number): number {
  if (typeof p === "number") return p;
  return sampleCurve(p.curve, wrapMeasure(m * p.cycles + p.offset, p.wrap));
}

// ---- the uniforms

/** One vec4 of general values, then for each of the three properties 10 vec4: head (constant, driven by, cycles, offset), wrap, 8 vec4 of table. */
export const MATERIAL_FLOATS = 4 + 3 * (8 + CURVE_TABLE_SIZE) + 16;

/** The measure number the shader uses for a source: the index in MEASURES, or 5 for "same as the colour". */
export function sourceIndex(source: MaterialSource): number {
  return source === "color" ? 5 : MEASURES.indexOf(source as Measure);
}

/**
 * The material as the shader reads it. The first number is 0 when the material adds nothing (default material), so
 * the shader takes the old path exactly. `maxLod` is the last mip level of the environment picture (blur by roughness).
 */
export function packMaterial(m: MaterialSettings, maxLod: number, out = new Float32Array(MATERIAL_FLOATS)): Float32Array {
  out.fill(0);
  const r=resolveMaterial(m);
  out.set([...r.baseColor,r.transmission,r.ior,r.absorptionDensity,0,0,...r.absorptionColor,0,...r.emissionColor,r.emissionStrength],124);
  const surfaceActive=materialIsActive(m);
  // Volume optics need constant property heads even with no specular surface lobe.
  // Keep the old surface flag: transmission-off and unsupported fractals must shade identically to 4A.
  if (!surfaceActive && r.transmission===0) return out;
  out[0] = surfaceActive?1:0;
  out[1] = surfaceActive?maxLod:0;
  MATERIAL_PROPERTIES.forEach((name, k) => {
    const p = m[name];
    const base = 4 + k * 40;
    if (typeof p === "number") {
      out.set([p, -1, 1, 0], base);
    } else {
      out.set([0, sourceIndex(p.measure), p.cycles, p.offset], base);
      out[base + 4] = p.wrap === "mirror" ? 1 : 0;
      out.set(curveTable(p.curve), base + 8);
    }
  });
  return out;
}

// ---- the reflection model (reference implementation; the shader does the same)

const PI = Math.PI;
type V3 = readonly [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): [number, number, number] => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** alpha: the roughness squared, as glTF and Filament define it. */
export function alphaOf(roughness: number): number {
  const r = Math.max(MIN_ROUGHNESS, Math.min(1, roughness));
  return r * r;
}

/** GGX normal distribution D(h): alpha^2 / (pi ((n.h)^2 (alpha^2 - 1) + 1)^2). */
export function ggxD(nh: number, alpha: number): number {
  const a2 = alpha * alpha;
  const d = nh * nh * (a2 - 1) + 1;
  return a2 / (PI * d * d);
}

/** Height-correlated Smith-GGX visibility V = G / (4 (n.l)(n.v)). */
export function smithV(nv: number, nl: number, alpha: number): number {
  const a2 = alpha * alpha;
  const gv = nl * Math.sqrt(nv * nv * (1 - a2) + a2);
  const gl = nv * Math.sqrt(nl * nl * (1 - a2) + a2);
  return 0.5 / Math.max(gv + gl, 1e-9);
}

/** Schlick's approximation of the Fresnel reflectance. */
export function schlick(f0: number, vh: number): number {
  return f0 + (1 - f0) * Math.pow(1 - Math.min(1, Math.max(0, vh)), 5);
}

/** F0 of the surface: 0.04 for a dielectric, the base colour for a metal. */
export function baseReflectance(base: V3, metallic: number,ior=1.5): [number, number, number] {
  const f0=ior===1.5?.04:dielectricF0(ior);
  return [0, 1, 2].map((k) => f0 + (base[k]! - f0) * metallic) as [number, number, number];
}

/**
 * The specular light of one light, per channel: BRDF x cosine, for a surface with normal n seen along v, lit from the
 * direction l (all unit vectors). Multiply by pi x the light's intensity (the project's lights use the convention that a
 * white diffuse surface facing the light shows the intensity itself, so the irradiance is pi times it).
 */
export function directSpecular(n: V3, v: V3, l: V3, f0: V3, roughness: number): [number, number, number] {
  const nl = dot(n, l);
  const nv = Math.max(dot(n, v), 1e-4);
  if (nl <= 0) return [0, 0, 0];
  const h = norm([v[0] + l[0], v[1] + l[1], v[2] + l[2]]);
  const nh = Math.max(dot(n, h), 0);
  const vh = Math.max(dot(v, h), 0);
  const alpha = alphaOf(roughness);
  const dv = ggxD(nh, alpha) * smithV(nv, nl, alpha) * nl;
  return [schlick(f0[0], vh) * dv, schlick(f0[1], vh) * dv, schlick(f0[2], vh) * dv];
}

/** The Fresnel term for the light of the environment, with the roughness-aware limit (Lagarde): never above 1. */
export function environmentFresnel(f0: V3, roughness: number, nv: number): [number, number, number] {
  const k = Math.pow(1 - Math.min(1, Math.max(0, nv)), 5);
  const r = Math.max(MIN_ROUGHNESS, Math.min(1, roughness));
  return [0, 1, 2].map((c) => f0[c]! + (Math.max(1 - r, f0[c]!) - f0[c]!) * k) as [number, number, number];
}

/** The gradient sky of the shader (used for the background and, without a picture, for reflections), as a function of the direction. */
export function skyGradient(d: V3): [number, number, number] {
  const t = 0.5 + 0.5 * d[1];
  return [0.08 + (0.25 - 0.08) * t, 0.1 + (0.3 - 0.1) * t, 0.16 + (0.4 - 0.16) * t];
}

/** The sky seen in a mirror of roughness r: the sky in the direction, blended towards its average for rough surfaces. */
export function skyReflection(d: V3, roughness: number): [number, number, number] {
  const r = Math.max(MIN_ROUGHNESS, Math.min(1, roughness));
  const sharp = skyGradient(d);
  const average = skyGradient([0, 0, 0]);
  const w = r * r;
  return [0, 1, 2].map((k) => sharp[k]! + (average[k]! - sharp[k]!) * w) as [number, number, number];
}

/** The mirror image of the viewing direction v in a surface with normal n. */
export function reflectDirection(v: V3, n: V3): [number, number, number] {
  const d = 2 * dot(n, v);
  return [d * n[0] - v[0], d * n[1] - v[1], d * n[2] - v[2]];
}

/** The mip level of the environment picture used for a roughness (0 sharp, maxLod blurred). */
export function environmentLod(roughness: number, maxLod: number): number {
  return Math.min(1, Math.max(0, roughness)) * maxLod;
}

/** Changes some properties of a scene's material. */
export function withMaterialChanges(m: MaterialSettings, changes: Partial<MaterialSettings>): MaterialSettings {
  return { ...m, ...changes };
}

export const MATERIAL_PRESETS:Record<string,CanonicalMaterial> = {
  'Matte':resolveMaterial(defaultMaterial()),
  'Polished Metal':resolveMaterial({metallic:1,roughness:0,reflectivity:1}),
  'Rough Metal':resolveMaterial({metallic:1,roughness:.4,reflectivity:1}),
  'Clear Glass':resolveMaterial({metallic:0,roughness:0,reflectivity:1,transmission:1}),
  'Frosted Glass':resolveMaterial({metallic:0,roughness:.2,reflectivity:1,transmission:1}),
  'Colored Glass':resolveMaterial({metallic:0,roughness:0,reflectivity:1,transmission:1,absorptionColor:[1,.5,.12],absorptionDensity:1}),
  'Emissive':resolveMaterial({metallic:0,roughness:1,reflectivity:0,emissionColor:[1,.6,.2],emissionStrength:2}),
  'Polished Gold':resolveMaterial({metallic:1,roughness:.08,reflectivity:1,baseColor:[1,.71,.26]}),
  'Brushed Gold':resolveMaterial({metallic:1,roughness:.18,reflectivity:1,baseColor:[1,.71,.26],surfaceDetail:withProceduralDetail({pattern:'brushed',strength:.3,scale:128,octaves:3,persistence:.45,seed:7,rotation:35,anisotropy:32,roughnessModulation:.04})}),
  'Hammered Copper':resolveMaterial({metallic:1,roughness:.22,reflectivity:1,baseColor:[.95,.47,.25],surfaceDetail:withProceduralDetail({pattern:'hammered',strength:.5,scale:48,seed:21,roughnessModulation:.04})}),
  'Weathered Bronze':resolveMaterial({metallic:.85,roughness:.4,reflectivity:1,baseColor:[.55,.32,.13],surfaceDetail:withProceduralDetail({pattern:'fbm',strength:.6,scale:64,octaves:4,seed:9,roughnessModulation:.18})}),
  'Rough Stone':resolveMaterial({metallic:0,roughness:.9,reflectivity:.08,baseColor:[.42,.39,.34],surfaceDetail:withProceduralDetail({pattern:'stone',strength:.6,scale:24,octaves:5,seed:5,roughnessModulation:.08})}),
  'Fine Ceramic':resolveMaterial({metallic:0,roughness:.22,reflectivity:.5,baseColor:[.93,.89,.8],surfaceDetail:withProceduralDetail({pattern:'fine-noise',strength:.08,scale:128,octaves:1,seed:31,roughnessModulation:.06})}),
  'Textured Glass':resolveMaterial({metallic:0,roughness:.07,reflectivity:1,transmission:1,surfaceDetail:withProceduralDetail({pattern:'fine-noise',strength:.06,scale:64,octaves:1,seed:3,roughnessModulation:.02})}),

};
