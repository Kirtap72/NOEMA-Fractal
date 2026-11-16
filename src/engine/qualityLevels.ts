/**
 * Quality levels (INTELLIGENT-RENDERING-01): three independent choices that coordinate the many numbers of QualitySettings.
 *
 *  - Geometry: how exactly the surface is found and shaded (hit threshold, normal step, step budget, step size). Pixel based, so the
 *    same level means the same thing at 1080p and at 8K.
 *  - Antialiasing: samples per pixel. It only smooths edges and noise; it cannot reveal detail that the geometry level did not find.
 *  - Shadows: how far a shadow ray may travel (soft shadows need more steps).
 *
 * Reflections, fog, materials and Geometry Detail are other panels and are never touched here. The levels only write fields that
 * already exist in the scene's quality block, so no scene version changes and every manual control keeps working.
 *
 * The numbers come from measurements on three real scenes (docs/rendering/INTELLIGENT_RENDERING_01.md): finer geometry is the cheapest way
 * to remove the error of a basic picture, and extra samples only pay once the geometry is fine.
 */
import type { QualitySettings } from "./renderSetup";

export type GeometryLevel = "draft" | "standard" | "fine" | "extra" | "max" | "ultra";
export type AntialiasLevel = 1 | 2 | 4 | 8 | 16 | 32;
export type ShadowLevel = 16 | 32 | 64 | 128 | 256;

export const GEOMETRY_LEVELS: readonly { id: GeometryLevel; label: string; hint: string; values: Pick<QualitySettings, "precision_mode" | "hit_pixels" | "normal_pixels" | "max_steps" | "step_factor"> & { precision_floor: number } }[] = [
  { id: "draft", label: "Draft", hint: "Fastest. Coarse surfaces, may miss thin parts.", values: { precision_mode: "pixel", hit_pixels: 0.75, normal_pixels: 1.5, max_steps: 160, step_factor: 0.8, precision_floor: 1 } },
  { id: "standard", label: "Standard", hint: "Like the preview with good quality. The starting level.", values: { precision_mode: "pixel", hit_pixels: 0.5, normal_pixels: 1.0, max_steps: 260, step_factor: 0.75, precision_floor: 1 } },
  { id: "fine", label: "Fine", hint: "Noticeably sharper surface detail. Costs a little extra on ordinary pictures.", values: { precision_mode: "pixel", hit_pixels: 0.2, normal_pixels: 0.5, max_steps: 900, step_factor: 0.5, precision_floor: 1 } },
  { id: "extra", label: "Extra fine", hint: "Fine structures and thin parts with the program's ordinary Float32 floor.", values: { precision_mode: "pixel", hit_pixels: 0.12, normal_pixels: 0.35, max_steps: 1500, step_factor: 0.4, precision_floor: 1 } },
  { id: "max", label: "Maximum (lowered floor)", hint: "Like Extra fine, but lowers the Float32 floor to a tenth. Shows more fine structure in deep zooms (where the floor otherwise limits the picture) for the same cost; on ordinary pictures it is identical to Extra fine.", values: { precision_mode: "pixel", hit_pixels: 0.12, normal_pixels: 0.35, max_steps: 1500, step_factor: 0.4, precision_floor: 0.1 } },
  { id: "ultra", label: "Ultra", hint: "Even finer limits and floor (a twentieth). Expensive; the floor is near the level of the Float32 noise.", values: { precision_mode: "pixel", hit_pixels: 0.08, normal_pixels: 0.25, max_steps: 2500, step_factor: 0.35, precision_floor: 0.05 } },
];

export const ANTIALIAS_LEVELS: readonly { value: AntialiasLevel; label: string }[] = [
  { value: 1, label: "None (1 sample)" }, { value: 2, label: "Low (2 samples)" }, { value: 4, label: "Medium (4 samples)" },
  { value: 8, label: "High (8 samples)" }, { value: 16, label: "Very high (16 samples)" }, { value: 32, label: "Extreme (32 samples)" },
];

export const SHADOW_LEVELS: readonly { value: ShadowLevel; label: string }[] = [
  { value: 16, label: "Quick (16 steps)" }, { value: 32, label: "Simple (32 steps)" }, { value: 64, label: "Good (64 steps)" },
  { value: 128, label: "Fine (128 steps)" }, { value: 256, label: "Very fine (256 steps)" },
];

/** Named combinations. The numbers come from the measured frontier: finer geometry first, samples second. */
export const QUALITY_PRESETS: readonly { id: string; label: string; hint: string; geometry: GeometryLevel; antialias: AntialiasLevel; shadows: ShadowLevel }[] = [
  { id: "draft", label: "Draft", hint: "Very fast, for trying ideas.", geometry: "standard", antialias: 1, shadows: 32 },
  { id: "good", label: "Good", hint: "Sharper surfaces and soft edges for a little extra time.", geometry: "fine", antialias: 2, shadows: 64 },
  { id: "fine", label: "Fine", hint: "Fine surfaces and clean edges. For most final pictures.", geometry: "extra", antialias: 4, shadows: 128 },
  { id: "extra", label: "Extra fine", hint: "Very clean edges everywhere. Considerably slower on dense fractals.", geometry: "extra", antialias: 16, shadows: 128 },
  { id: "max", label: "Maximum", hint: "Lowered Float32 floor for more fine structure in deep zooms, 8 samples. The step before Geometry Detail.", geometry: "max", antialias: 8, shadows: 128 },
];

export interface QualityChoice { geometry: GeometryLevel; antialias: AntialiasLevel; shadows: ShadowLevel }

/** The quality fields a choice sets. Other fields (seed, policies, distances) are left as they are. */
export function qualityValues(choice: Partial<QualityChoice>): Partial<QualitySettings> {
  const out: Partial<QualitySettings> = {};
  if (choice.geometry) { const g = GEOMETRY_LEVELS.find((x) => x.id === choice.geometry); if (g) Object.assign(out, g.values); }
  if (choice.antialias) out.samples_per_pixel = choice.antialias;
  if (choice.shadows) out.shadow_steps = choice.shadows;
  return out;
}

/** Which levels a scene's quality block currently equals, or null for an axis that has custom values. */
export function describeQuality(q: Pick<QualitySettings, "precision_mode" | "hit_pixels" | "normal_pixels" | "max_steps" | "step_factor" | "samples_per_pixel" | "shadow_steps" | "precision_floor">): { geometry: GeometryLevel | null; antialias: AntialiasLevel | null; shadows: ShadowLevel | null } {
  const geometry = GEOMETRY_LEVELS.find((g) => g.values.precision_mode === q.precision_mode && g.values.hit_pixels === q.hit_pixels && g.values.normal_pixels === q.normal_pixels && g.values.max_steps === q.max_steps && g.values.step_factor === q.step_factor && g.values.precision_floor === (q.precision_floor ?? 1))?.id ?? null;
  const antialias = ANTIALIAS_LEVELS.find((a) => a.value === q.samples_per_pixel)?.value ?? null;
  const shadows = SHADOW_LEVELS.find((s) => s.value === q.shadow_steps)?.value ?? null;
  return { geometry, antialias, shadows };
}
