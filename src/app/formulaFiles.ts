import { buildLibrary } from "../engine";
import type { Library } from "../engine";

/**
 * Finds every .yaml file in the formulas/ folder (a Vite feature, so it lives
 * in the app and not in the engine). Adding a formula needs no code change.
 */
export function loadLibrary(): Library {
  const files = import.meta.glob("/formulas/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >;
  return buildLibrary(files);
}
