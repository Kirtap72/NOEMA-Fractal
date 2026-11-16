/**
 * Interactive LookDev (INTERACTIVE-LOOKDEV-06): when may the surface found by one picture be reused for the next one?
 *
 * The cache keeps what the march along each ray found (distance, steps, hit). It stays valid exactly as long as the SURFACE stays the same:
 * the camera, the picture size, the formulas and their parameters, the quality thresholds that decide where a ray counts as a hit, the cutout.
 * Light, ambient light, material, colour gradient, fog, tone curve and the sculpting settings are applied AFTER the march, from the hit point, so
 * changing them never invalidates the cache. A change that is not on either list errs on the safe side: it is in `render` or `content`, so it
 * rebuilds the surface instead of showing a stale one.
 *
 * Pure functions: no graphics card, no window.
 */
import type { Scene } from "./scene";
import { displacementActive } from "./displacement";

/**
 * A string that is equal for two scenes exactly when they have the same primary surface at this picture size.
 * `film` is the final picture size the thresholds are scaled against; `width` the interactive picture width.
 */
export function surfaceFingerprint(scene: Scene, width: number, film: { width: number; height: number }): string {
  // Objects that use the scene material take their displacement (a height map that moves the surface) from it, so it belongs to the surface as soon
  // as any object is displaced; otherwise the scene material stays a pure shading setting.
  const sceneDisplacement = displacementActive(scene) ? scene.material.displacement ?? null : null;
  return JSON.stringify([scene.content, scene.camera, scene.render, scene.cutout, scene.primitives ?? null, sceneDisplacement, scene.fractalDisplacement ?? null, scene.formulaFields ?? null, scene.discoveredFormulas ?? null, scene.geometryDetail ?? null, width, film.width, film.height]);
}

/**
 * What keeps a scene from Progressive LookDev (PROGRESSIVE-ALL-13): nothing. Earlier versions refused own objects, displacement, formula fields,
 * the box cut, glass transport and procedural detail. Measured against the ordinary renderer (tools/texture-lookdev-12, tests/progressiveAll13.test.ts)
 * every one of them now gives the same picture, also after changing light, colour or material, because
 *  - the cache keeps what the scene query found (distance, steps, which object, the exact normal of an object) instead of assuming a fractal-only march,
 *  - scenes that need several bounces (glass, multi-bounce reflections) are drawn with the same multi-bounce shader as the ordinary renderer, and
 *  - everything that moves the surface (objects, displacement, formula fields, box cut) is part of the surface fingerprint, so changing it never shows a stale surface.
 * The function stays as the one place to add a reason, should a combination ever be found that cannot be proven equal; each reason must be a Swedish phrase.
 */
export function interactiveBlockers(_scene: Scene): string[] {
  return [];
}

/** Null when the scene can be drawn interactively; otherwise one Swedish sentence saying why not and what to use instead. */
export function interactiveRefusal(scene: Scene): string | null {
  const blockers = interactiveBlockers(scene);
  if (!blockers.length) return null;
  return `The scene has ${blockers.join(", ")}. It cannot be previewed interactively without the picture becoming wrong; use Final Preview.`;
}

/** What the interactive picture leaves out, for the badge and the manual. Reflections, glass and global illumination are drawn with the same shader as the final picture (measured equal). */
export function interactiveLimits(scene: Scene): string[] {
  const out = ["no denoise"];
  if (scene.camera.dof?.enabled && scene.camera.projection !== "orthographic") out.push("no depth of field");
  return out;
}

// ---- PROGRESSIVE-LOOKDEV-07: when the picture on screen is updated while samples are re-shaded or added ----

/** Samples per pixel the progressive mode works towards (also the number of kept surfaces). */
export const PROGRESSIVE_SAMPLES = 16;
/** The fewest re-shaded samples shown after an artistic change: a one-sample picture is never shown for a change of light, material or colour. */
export const MIN_RESHADED_SAMPLES = 4;

/** A new surface (camera, size, formulas ...) has no samples yet: show it at 1, 2, 4, 8 and 16 samples, so something recognisable appears at once and then gets clean. */
export function freshPresentCounts(target: number = PROGRESSIVE_SAMPLES): number[] {
  const counts: number[] = [];
  for (let n = 1; n < target; n *= 2) counts.push(n);
  counts.push(target);
  return counts;
}

/** How many kept samples are re-shaded between two updates of the picture: 4, so the first update after a change already has 4 samples (or all there are). */
export function reshadeBatch(kept: number): number {
  return Math.max(1, Math.min(MIN_RESHADED_SAMPLES, kept));
}

/** While samples are added one by one, update the picture when a count doubles (8, 16 ...) and at the end. */
export function presentAfterAdd(count: number, target: number): boolean {
  return count >= target || (count & (count - 1)) === 0;
}

/** What to do for a request: the kept samples are re-shaded when the surface is the same but the scene is not the one they were shaded with. */
export function progressiveAction(input: { sameSurface: boolean; shadedWithThisScene: boolean; kept: number; target: number }): "begin" | "reshade" | "add" | "idle" {
  if (!input.sameSurface) return "begin";
  if (!input.shadedWithThisScene && input.kept > 0) return "reshade";
  return input.kept < input.target ? "add" : "idle";
}
