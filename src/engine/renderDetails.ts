import { boxPlanes, readBoxCut, type BoxCut } from "./boxCut";
import type { Vec3 } from "./camera";

export const MAX_CLIP_PLANES = 3;
/** Retains dot(normalized normal, point) <= offset; invert retains the opposite side. No cap is added. */
export interface ClipPlane { enabled: boolean; normal: Vec3; offset: number; invert: boolean }
export interface CutoutSettings { planes: ClipPlane[]; box?: BoxCut }
export interface OcclusionSettings { enabled: boolean; strength: number; radius: number; samples: number }
export interface CavitySettings extends OcclusionSettings { contrast?: number }
export interface EdgeSofteningSettings { enabled: boolean; radius: number; strength: number; preserve_fine_detail: boolean }
/**
 * SURFACE-LIGHTING-01: opt-in sculpting of the light that reaches a surface, never of the surface itself.
 * - far_strength/far_radius: a second, wider ambient-occlusion pass for the large forms (the ordinary AO is the near one);
 * - bent_environment: the environment light is taken from the direction the point is open towards (the bent normal) instead of the surface normal;
 * - contact_length: how far a "contact" shadow looks towards the light, as a share of the picture height at the surface (resolution independent).
 */
export interface SculptSettings {
  enabled: boolean; far_strength: number; far_radius: number; bent_environment: boolean; contact_length: number;
  /** ARTISTIC-LIGHTING-02 (scene 46), all optional, 0/absent = off. Calmer reflections: 0–4 strength, footprint 0.5–32 pixels. */
  spec_filter?: number; spec_pixels?: number;
  /** Extra occlusion of ambient light, environment light and environment reflections (0–2). */
  indirect_occlusion?: number;
}
export interface DetailSettings { ao: OcclusionSettings; cavity: CavitySettings; edge_softening?: EdgeSofteningSettings; sculpt?: SculptSettings }
export const defaultSculpt = (): SculptSettings => ({ enabled: false, far_strength: 0.5, far_radius: 0.05, bent_environment: true, contact_length: 0.04, spec_filter: 0, spec_pixels: 3, indirect_occlusion: 0 });
export const defaultEdgeSoftening = (): EdgeSofteningSettings => ({ enabled: false, radius: 0.005, strength: 0.35, preserve_fine_detail: true });
export const defaultClipPlane = (): ClipPlane => ({ enabled: false, normal: [0, 0, 1], offset: 0, invert: false });
export const defaultCutout = (): CutoutSettings => ({ planes: [] });
export const defaultDetails = (): DetailSettings => ({
  ao: { enabled: false, strength: 0.65, radius: 0.15, samples: 8 },
  cavity: { enabled: false, strength: 0.35, radius: 0.015, samples: 6, contrast: 1 },
  edge_softening: defaultEdgeSoftening(),
});
/** Structural cost only: moving a plane or dragging strength/radius must retain adaptive feedback. */
export function renderDetailsCostKey(cutout: CutoutSettings, details: DetailSettings): string {
  return JSON.stringify([cutout.planes.map(p => p.enabled), !!cutout.box?.enabled, details.ao.enabled ? details.ao.samples : 0, details.cavity.enabled ? details.cavity.samples : 0, !!details.edge_softening?.enabled]);
}
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export function readCutout(raw: unknown, errors: string[]): CutoutSettings | undefined {
  if (raw === undefined) return defaultCutout();
  const before = errors.length;
  if (!obj(raw) || !Array.isArray(raw.planes) || raw.planes.length > MAX_CLIP_PLANES) {
    errors.push("cutout.planes must be a list of at most three planes"); return;
  }
  const planes: ClipPlane[] = [];
  raw.planes.forEach((p, i) => {
    if (!obj(p) || typeof p.enabled !== "boolean" || typeof p.invert !== "boolean" || !num(p.offset) || Math.abs(p.offset) > 1e6
      || !Array.isArray(p.normal) || p.normal.length !== 3 || !p.normal.every(n => num(n) && Math.abs(n) <= 1e6)
      || Math.hypot(...p.normal as number[]) < 1e-9) errors.push(`cutout.planes[${i}] needs booleans, a finite offset and a nonzero normal`);
    else planes.push({ enabled: p.enabled, invert: p.invert, offset: p.offset, normal: [...p.normal] as Vec3 });
  });
  const box = raw.box === undefined ? undefined : readBoxCut(raw.box, errors);
  return errors.length === before ? { planes, ...(box ? { box } : {}) } : undefined;
}
export function readDetails(raw: unknown, errors: string[]): DetailSettings | undefined {
  if (raw === undefined) return defaultDetails();
  if (!obj(raw)) { errors.push("details must be an object"); return; }
  const before = errors.length, result = defaultDetails();
  delete result.edge_softening;
  if (raw.sculpt !== undefined) {
    const s = raw.sculpt;
    if (!obj(s) || typeof s.enabled !== 'boolean' || typeof s.bent_environment !== 'boolean' || !num(s.far_strength) || s.far_strength < 0 || s.far_strength > 1 || !num(s.far_radius) || s.far_radius < 1e-6 || s.far_radius > 1000 || !num(s.contact_length) || s.contact_length < 0.001 || s.contact_length > 0.5)
      errors.push('details.sculpt needs enabled, bent_environment, far_strength 0–1, far_radius 0.000001–1000 and contact_length 0.001–0.5');
    else {
      const range = (key: string, lo: number, hi: number, fallback: number): number => {
        const v = s[key]; if (v === undefined) return fallback;
        if (!num(v) || v < lo || v > hi) { errors.push(`details.sculpt.${key} must be ${lo}–${hi}`); return fallback; }
        return v;
      };
      const extra = { spec_filter: range('spec_filter', 0, 4, 0), spec_pixels: range('spec_pixels', 0.5, 32, 3), indirect_occlusion: range('indirect_occlusion', 0, 2, 0) };
      result.sculpt = { enabled: s.enabled, bent_environment: s.bent_environment, far_strength: s.far_strength, far_radius: s.far_radius, contact_length: s.contact_length, ...extra };
    }
  }
  for (const key of ["ao", "cavity"] as const) {
    const p = raw[key];
    if (!obj(p) || typeof p.enabled !== "boolean" || !num(p.strength) || p.strength < 0 || p.strength > 1
      || !num(p.radius) || p.radius < 1e-6 || p.radius > 1000 || !num(p.samples) || !Number.isInteger(p.samples) || p.samples < 1 || p.samples > 32)
      errors.push(`details.${key} needs enabled, strength 0–1, radius 0.000001–1000 and samples 1–32`);
    else {
      result[key] = { enabled: p.enabled, strength: p.strength, radius: p.radius, samples: p.samples };
      if (key === 'cavity' && p.contrast !== undefined) {
        if (!num(p.contrast) || p.contrast < 0 || p.contrast > 4) errors.push('details.cavity.contrast must be 0–4');
        else result[key].contrast = p.contrast;
      }
    }
  }
  if (raw.edge_softening !== undefined) {
    const p = raw.edge_softening;
    if (!obj(p) || typeof p.enabled !== 'boolean' || typeof p.preserve_fine_detail !== 'boolean' || !num(p.radius) || p.radius < 1e-6 || p.radius > 1000 || !num(p.strength) || p.strength < 0 || p.strength > 1) errors.push('details.edge_softening needs enabled, preserve_fine_detail, radius 0.000001–1000 and strength 0–1');
    else result.edge_softening = { enabled: p.enabled, preserve_fine_detail: p.preserve_fine_detail, radius: p.radius, strength: p.strength };
  }
  return errors.length === before ? result : undefined;
}
export const DETAIL_FLOATS = 32; // three planes, flags, AO, cavity, shading bevel, art contrast
export function packRenderDetails(cutout = defaultCutout(), details = defaultDetails()): Float32Array {
  const out = new Float32Array(DETAIL_FLOATS);
  cutout.planes.forEach((p, i) => {
    const sign = p.invert ? -1 : 1, length = Math.hypot(...p.normal);
    out.set([...p.normal.map(n => sign * n / length), sign * p.offset], 4 * i);
    out[12 + i] = p.enabled ? 1 : 0;
  });
  for (const [i, p] of [details.ao, details.cavity].entries()) out.set([p.enabled ? p.strength : 0, p.radius, p.samples, p.enabled ? 1 : 0], 16 + 4 * i);
  const edge = details.edge_softening ?? defaultEdgeSoftening();
  out.set([edge.enabled ? edge.strength : 0, edge.radius, edge.preserve_fine_detail ? 1 : 0, edge.enabled ? 1 : 0], 24);
  out[28] = details.cavity.contrast ?? 1;
  // Free slots of the detail block: clipFlags.w, artContrast.y/z/w. All zero = shaders and scenes without sculpting.
  const sculpt = details.sculpt;
  if (sculpt) out[15] = sculpt.contact_length;
  if (sculpt?.enabled) { out[29] = sculpt.far_strength; out[30] = sculpt.far_radius; out[31] = sculpt.bent_environment ? 1 : 0; }
  return out;
}
/** CPU reference of the same retained half-space interval used by primary and shadow rays. */
export function clipRay(origin: Vec3, direction: Vec3, maxDistance: number, cutout: CutoutSettings): [number, number] {
  let near = 0, far = maxDistance;
  for (const p of [...cutout.planes, ...boxPlanes(cutout.box)]) {
    if (!p.enabled) continue;
    const sign = p.invert ? -1 : 1, length = Math.hypot(...p.normal);
    const n = p.normal.map(v => sign * v / length);
    const d = n.reduce((s, v, i) => s + v * origin[i]!, 0) - sign * p.offset;
    const slope = n.reduce((s, v, i) => s + v * direction[i]!, 0);
    if (Math.abs(slope) < 1e-8) { if (d > 0) return [1, 0]; }
    else if (slope > 0) far = Math.min(far, -d / slope);
    else near = Math.max(near, -d / slope);
  }
  return [near, far];
}
