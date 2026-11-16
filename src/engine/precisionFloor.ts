/**
 * The Float32 floor (INTELLIGENT-RENDERING-02).
 *
 * Every picture shader keeps the hit threshold and the normal step at or above a floor of 2e-6 x (1 + |p|) (p = the surface point), the size
 * at which 32-bit arithmetic was judged unable to tell surface from noise near the scale 1. In a deep zoom the footprint of one pixel is
 * smaller than that floor, so every finer setting ("hit threshold 0.12 pixel") is silently clamped to the same few pixels: Extra fin and
 * Ultra then give the same picture. Measured on reference scene: the distance estimate itself is good to about 0.05 pixel there, far below the floor.
 *
 * `precision_floor` (scene version 44) scales the floor; this module says WHETHER the floor is what limits a picture, from its depth.
 */
import type { Engine, RenderOptions } from "./engine";
import type { Scene } from "./scene";
import { cameraBasis } from "./camera";

export const FLOOR_BASE = 2.0e-6;

/** The floor at surface point p (before the artist's scale). */
export const floorAt = (p: readonly number[]): number => FLOOR_BASE * (1 + Math.hypot(p[0]!, p[1]!, p[2]!));

export interface FloorReport {
  /** Hit pixels counted. */
  hits: number;
  /** Share of them whose hit threshold (hit_pixels x pixel size) is below the floor, so the floor decides. */
  bindingShare: number;
  /** Median of (hit threshold / floor at scale 1): above 1 the floor does not matter, below 1 it does. */
  medianRatio: number;
  /** The floor in pixels (median): the smallest hit threshold that is really used. */
  floorPixels: number;
  /** Median number of distinct 32-bit coordinate values per pixel (pixel size divided by the spacing of 32-bit numbers at the surface point). Below about 6, Float32 cannot place the surface finer than the floor allows. */
  coordinateStepsPerPixel: number;
  /** The scale of the floor that would stop it from binding for the hit threshold in use (the 20th percentile of the ratio, capped to 1). */
  suggestedScale: number;
}

/**
 * Reads the depth of a picture (distance along each ray, negative for misses) and says how much of the surface the floor limits.
 * Pure: `depth` has `width x height` entries of a picture with the film height `film.height`, drawn with the pixel threshold `hitPixels`.
 */
export function floorBinding(scene: Pick<Scene, "camera">, depth: Float32Array, width: number, height: number, film: { width: number; height: number }, hitPixels: number, floorScale = 1, region?: { x: number; y: number }): FloorReport {
  const b = cameraBasis(scene.camera), tanHalf = Math.tan((scene.camera.fov_degrees * Math.PI) / 360);
  const ratios: number[] = [], steps: number[] = []; let binding = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = depth[y * width + x]!; if (!(t > 0)) continue;
      const fx = region ? region.x + x + 0.5 : (x + 0.5) * (film.width / width), fy = region ? region.y + y + 0.5 : (y + 0.5) * (film.height / height);
      const nx = (2 * fx - film.width) / film.height, ny = (film.height - 2 * fy) / film.height;
      const d = [0, 1, 2].map((i) => b.forward[i]! + (b.right[i]! * nx + b.up[i]! * ny) * tanHalf), n = Math.hypot(d[0]!, d[1]!, d[2]!);
      const p = [0, 1, 2].map((i) => b.position[i]! + (d[i]! / n) * t);
      const threshold = hitPixels * ((2 * tanHalf * t) / film.height), floor = floorAt(p) * floorScale;
      ratios.push(threshold / floor); if (threshold < floor) binding++;
      steps.push(((2 * tanHalf * t) / film.height) / (Math.max(Math.abs(p[0]!), Math.abs(p[1]!), Math.abs(p[2]!), 1e-30) * 2 ** -23));
    }
  }
  const sorted = ratios.slice().sort((a, c) => a - c), q = (f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] ?? NaN;
  return { hits: ratios.length, bindingShare: ratios.length ? binding / ratios.length : 0, medianRatio: q(0.5), floorPixels: hitPixels / q(0.5), coordinateStepsPerPixel: steps.slice().sort((a, c) => a - c)[Math.floor(steps.length / 2)] ?? NaN, suggestedScale: Math.min(1, Math.max(0.02, q(0.2) * floorScale)) };
}

/** A small depth picture (half size) of the scene with the quality in use, then `floorBinding` on it. Cheap: no shading detail is needed. */
export async function probeFloor(engine: Engine, scene: Scene, film: { width: number; height: number }, hitPixels: number, floorScale: number, common: Omit<RenderOptions, "quality" | "region" | "refine"> = {}): Promise<FloorReport | null> {
  if (scene.camera.projection === "orthographic") return null;
  const w = Math.max(16, Math.round(film.width / 2)), h = Math.max(16, Math.round(film.height / 2));
  const layers = await engine.renderLayersToBuffer(w, h, { ...common, quality: { samples_per_pixel: 1 }, referenceFilm: film, dofMode: "off", denoise: false } as RenderOptions);
  return floorBinding(scene, layers.depth, w, h, film, hitPixels, floorScale);
}

/** Like probeFloor, but for one rectangle of the final picture drawn 1:1 (Detail View): the numbers describe exactly the pixels the artist is looking at. */
export async function probeFloorRegion(engine: Engine, scene: Scene, rect: { x: number; y: number; width: number; height: number }, film: { width: number; height: number }, hitPixels: number, floorScale: number, common: Omit<RenderOptions, "quality" | "region" | "refine"> = {}): Promise<FloorReport | null> {
  if (scene.camera.projection === "orthographic") return null;
  const layers = await engine.renderLayersToBuffer(film.width, film.height, { ...common, region: rect, quality: { samples_per_pixel: 1 }, referenceFilm: film, dofMode: "off", denoise: false } as RenderOptions);
  return floorBinding(scene, layers.depth, rect.width, rect.height, film, hitPixels, floorScale, { x: rect.x, y: rect.y });
}

/** Says in words (Swedish) whether the Float32 floor limits the detail, from a report. Empty when it does not. `floorScale` is the scale in use (1 = the ordinary floor). */
export function floorAdviceText(r: FloorReport, floorScale: number): string {
  const coarse = r.coordinateStepsPerPixel < 6 ? ` Note: here only ${r.coordinateStepsPerPixel.toFixed(1)} 32-bit values per pixel fit in the coordinates; Float32 is not enough for full detail at this zoom, Geometry Detail is required.` : "";
  if (r.bindingShare < 0.05) return coarse;
  const pct = Math.round(r.bindingShare * 100);
  return floorScale >= 1
    ? ` The Float32 floor limits ${pct} % of the surface: finer settings give no more detail there. Try the Maximum level (lowered floor; suggestion ${r.suggestedScale.toFixed(2)}).${coarse}`
    : ` Even the lowered floor (about ${r.floorPixels.toFixed(2)} pixel) limits ${pct} % of the surface; Float32 cannot safely be lowered much more, finer detail there requires Geometry Detail.${coarse}`;
}
