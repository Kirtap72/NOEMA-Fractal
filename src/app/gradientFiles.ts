import { buildGradientLibrary } from "../engine";
import type { GradientLibrary } from "../engine";

/** Finds every .yaml file in the gradients/ folder (a Vite feature, so it lives in the app). */
export function loadGradients(): GradientLibrary {
  const files = import.meta.glob("/gradients/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >;
  return buildGradientLibrary(files);
}
