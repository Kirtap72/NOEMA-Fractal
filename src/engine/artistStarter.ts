/**
 * The curated starter fractal offered on a fresh installation (ARTIST-UX-REDESIGN-01).
 * It is only a scene built from existing pieces (a library formula, a library gradient, a lighting rig, built-in material and detail
 * settings); it is never applied automatically, so an existing artist's last artwork is never replaced.
 */
import { applyRig } from "./lightRigs";
import { MATERIAL_PRESETS } from "./material";
import { createDefaultScene, withColor } from "./scene";
import type { Scene } from "./scene";
import type { Formula } from "./formula/types";
import type { Gradient } from "./gradient";
import { QUALITY_PRESETS, qualityValues } from "./qualityLevels";
import { withQuality } from "./renderSetup";

export const STARTER_FORMULA = "mandelbulb";
const GRADIENT_CHOICES = ["aurora", "ember", "deep-sea"];

/** A new user's first final render: the "Fin" level (fine surfaces, clean edges, 4 samples), not the 1-sample draft the engine uses for scene files of old versions. */
export function withFirstRenderQuality(scene: Scene): Scene {
  const level = QUALITY_PRESETS.find((p) => p.id === "fine")!;
  return { ...scene, render: withQuality(scene.render, qualityValues(level)) };
}

export function starterScene(formulas: readonly Formula[], gradients: readonly Gradient[]): Scene | null {
  const formula = formulas.find((f) => f.id === STARTER_FORMULA);
  if (!formula) return null;
  let scene = createDefaultScene(formula);
  const gradient = GRADIENT_CHOICES.map((id) => gradients.find((g) => g.id === id)).find((g) => g !== undefined);
  if (gradient) scene = withColor(scene, { gradient: { id: gradient.id, name: gradient.name, stops: structuredClone(gradient.stops) } });
  const rig = applyRig(scene, "side-drama", "replace-directional", { shadows: true });
  if (rig.ok) scene = rig.scene;
  const ceramic = MATERIAL_PRESETS["Fine Ceramic"];
  scene = {
    ...scene,
    ...(ceramic ? { material: structuredClone(ceramic) } : {}),
    details: { ...scene.details, cavity: { ...scene.details.cavity, enabled: true } },
  };
  return withFirstRenderQuality(scene);
}
