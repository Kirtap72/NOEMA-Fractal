/**
 * Which scenes need the sculpting shader (SURFACE-LIGHTING-01): those that switch on details.sculpt or give a light "contact" shadows.
 * Every other scene keeps the exact shader text it always had.
 */
import type { Scene } from "./scene";

export function surfaceLookActive(scene: Pick<Scene, "lights" | "details">): boolean {
  return !!scene.details?.sculpt?.enabled || scene.lights.some((l) => l.enabled && l.shadows === "contact");
}
