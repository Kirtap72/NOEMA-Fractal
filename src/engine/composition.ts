export interface CompositionSettings {
  thirds: boolean;
  center: boolean;
  safe: boolean;
  diagonals: boolean;
  locked: boolean;
}
export const defaultComposition = (): CompositionSettings => ({
  thirds: false,
  center: false,
  safe: false,
  diagonals: false,
  locked: false,
});
export function readComposition(
  raw: unknown,
  errors: string[],
): CompositionSettings | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push("composition must be an object");
    return undefined;
  }
  const out = defaultComposition();
  for (const key of Object.keys(out) as (keyof CompositionSettings)[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (value !== undefined) {
      if (typeof value !== "boolean")
        errors.push(`composition.${key} must be boolean`);
      else out[key] = value;
    }
  }
  return out;
}
/** Fit the exact output gate in available viewport space; the canvas itself renders this rectangle. */
export function frameRect(
  width: number,
  height: number,
  aspect: number,
): { x: number; y: number; width: number; height: number } {
  const w = Math.min(width, height * aspect),
    h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
