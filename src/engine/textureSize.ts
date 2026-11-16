/**
 * "Texturstorlek" for imported PBR map sets (ARTIST-UX-02, phase B).
 *
 * The shared mapping (`material.surfaceDetail.scale`) is the number of times the image repeats per world unit:
 * higher = more repeats = smaller details. Artists think the other way round ("how big is the texture"), so the
 * control shows the SIZE of one repeat in world units, size = 1 / scale. The stored field and its meaning do not
 * change, so every older scene (scale 1 = size 1) looks exactly as before.
 */

/** Limits of the stored field `surfaceDetail.scale`, from `readSurfaceDetail`. */
export const MAPPING_SCALE_MIN = 0.000001;
export const MAPPING_SCALE_MAX = 16777216;

/** Slider range, as log10(size): 0.01 … 1000 world units per repeat. Values outside it can still be typed exactly. */
export const SIZE_SLIDER_MIN = -2;
export const SIZE_SLIDER_MAX = 3;

/** The stored scale for a typed size, or undefined if the size is not a usable number. Never returns NaN or Infinity. */
export function scaleFromSize(size: number): number | undefined {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return undefined;
  const scale = 1 / size;
  return Number.isFinite(scale) && scale >= MAPPING_SCALE_MIN && scale <= MAPPING_SCALE_MAX ? scale : undefined;
}

/** The size shown for a stored scale. Out-of-range or non-finite values fall back to the legacy default (size 1). */
export function sizeFromScale(scale: number): number {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale < MAPPING_SCALE_MIN || scale > MAPPING_SCALE_MAX) return 1;
  return 1 / scale;
}

/** Smallest and largest size the field can hold. */
export const SIZE_MIN = 1 / MAPPING_SCALE_MAX;
export const SIZE_MAX = 1 / MAPPING_SCALE_MIN;

export function sliderToSize(position: number): number {
  const t = Math.min(SIZE_SLIDER_MAX, Math.max(SIZE_SLIDER_MIN, Number.isFinite(position) ? position : 0));
  return 10 ** t;
}

export function sizeToSlider(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.min(SIZE_SLIDER_MAX, Math.max(SIZE_SLIDER_MIN, Math.log10(size)));
}

/** Short number text without float noise: 1.0000000000000002 → "1". */
export function formatSize(size: number): string {
  if (!Number.isFinite(size)) return "1";
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : size >= 1 ? 2 : size >= 0.1 ? 3 : 4;
  return String(Number(size.toFixed(digits)));
}

/** Explanation shown under the control. Direction is spelled out because it is the part that is easy to get backwards. */
export function describeTextureSize(scale: number): string {
  const size = sizeFromScale(scale);
  const repeats = 1 / size;
  const r = repeats >= 100 ? repeats.toFixed(0) : repeats >= 1 ? repeats.toFixed(2) : repeats.toPrecision(2);
  return `One repeat is ${formatSize(size)} world units wide, that is ${r} repeats per unit. Larger size = fewer repeats = larger details.`;
}
