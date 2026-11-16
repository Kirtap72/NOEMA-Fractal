/**
 * Shader variants (LOOKDEV-05B). The picture shader depends on the formulas and on whether the sculpting code is in it (surfaceLook.ts), so the
 * first look used on a scene without one needs a new shader: 60-70 s on a heavy fractal (measured, reference scene, RTX 2080). Until it is ready the
 * artist should still see the NEW light, so the application draws the scene with the sculpting left out and says so. Pure functions only.
 */
import { displacementActive } from "./displacement";
import { materialTexturesActive } from "./materialTextures";
import { proceduralDetailActive } from "./proceduralDetail";
import { surfaceDetailActive, surfaceMaterials } from "./surfaceDetail";
import { surfaceLookActive } from "./surfaceLook";
import type { Scene } from "./scene";

/**
 * True when the shader text of the scene depends on nothing but the formulas and the look flag. A colour texture and a sky image are only bound as
 * resources, so they do not matter. Scenes whose shader is built from extra geometry or image resources (surface detail, material textures, height
 * maps, formula field maps, primitives, a box cut) are left to the normal path.
 */
export function warmupEligible(scene: Scene): boolean {
  const materials = surfaceMaterials(scene);
  return !scene.primitives?.length && !scene.formulaFields?.length && !scene.cutout.box && !displacementActive(scene)
    && !materials.some((m) => surfaceDetailActive(m) || materialTexturesActive(m) || proceduralDetailActive(m)) && !scene.transport?.enabled;
}

/**
 * The scene as the shader WITHOUT the sculpting code can draw it: light directions, colours, intensities, ambient light, full shadows, material and
 * tone curve are all kept; wide occlusion, bent light, calm reflections, indirect occlusion and contact shadows are left out. A drawing approximation
 * for the time the exact shader is being built, never the artist's scene and never used for a final picture.
 */
export function withoutLookCode(scene: Scene): Scene {
  if (!surfaceLookActive(scene)) return scene;
  return {
    ...scene,
    lights: scene.lights.map((l) => (l.shadows === "contact" ? { ...l, shadows: "none" as const } : l)),
    details: { ...scene.details, ...(scene.details.sculpt ? { sculpt: { ...scene.details.sculpt, enabled: false } } : {}) },
  };
}
