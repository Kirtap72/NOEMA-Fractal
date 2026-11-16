/**
 * Putting a separately rendered region (for example Geometry Detail) into an ordinary picture (INTELLIGENT-RENDERING-02).
 *
 * The region is rendered a little LARGER than the part the artist chose (the margin). Inside the chosen rectangle the region replaces the
 * picture exactly; across the margin its weight falls smoothly from 1 to 0, in linear light, so the join cannot show as a hard line even
 * where the two renders find different detail. Outside the margin the ordinary picture is untouched, bit for bit.
 */
import { displayRgba } from "./display";
import type { DisplaySettings } from "./display";

export interface Rect { x: number; y: number; width: number; height: number }

/** The chosen rectangle grown by `margin` pixels on every side, kept inside a picture of `width` x `height`. */
export function grownRect(roi: Rect, margin: number, width: number, height: number): Rect {
  const x0 = Math.max(0, roi.x - margin), y0 = Math.max(0, roi.y - margin), x1 = Math.min(width, roi.x + roi.width + margin), y1 = Math.min(height, roi.y + roi.height + margin);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Weight of the region at pixel (x, y) of the whole picture: 1 inside `roi`, falling smoothly to 0 at `margin` pixels outside it. */
export function regionWeight(roi: Rect, margin: number, x: number, y: number): number {
  const dx = Math.max(roi.x - x, 0, x - (roi.x + roi.width - 1)), dy = Math.max(roi.y - y, 0, y - (roi.y + roi.height - 1));
  const d = Math.hypot(dx, dy);
  if (d <= 0) return 1;
  if (margin <= 0 || d >= margin) return 0;
  const u = 1 - d / margin;
  return u * u * (3 - 2 * u);
}

export interface Composite { linear: Float32Array; data: Uint8Array; touched: Rect }

/**
 * `base` is the whole picture (linear light, RGBA floats). `patch` was rendered over `patchRect` (a grown version of `roi`). Returns a new
 * picture; `base` is not changed. Only the pixels of `patchRect` are converted to 8 bits again (the rest are copied from `baseData`).
 */
export function compositeRegion(
  base: { width: number; height: number; linear: Float32Array; data?: Uint8Array; display?: DisplaySettings },
  patch: Float32Array, patchRect: Rect, roi: Rect, margin: number,
): Composite {
  const { width, height } = base, linear = new Float32Array(base.linear);
  for (let y = 0; y < patchRect.height; y++) {
    for (let x = 0; x < patchRect.width; x++) {
      const w = regionWeight(roi, margin, patchRect.x + x, patchRect.y + y);
      if (w <= 0) continue;
      const to = ((patchRect.y + y) * width + patchRect.x + x) * 4, from = (y * patchRect.width + x) * 4;
      for (let c = 0; c < 4; c++) linear[to + c] = base.linear[to + c]! * (1 - w) + patch[from + c]! * w;
    }
  }
  const data = base.data ? new Uint8Array(base.data) : displayRgba(base.linear, base.display);
  for (let y = 0; y < patchRect.height; y++) {
    const row = ((patchRect.y + y) * width + patchRect.x) * 4;
    data.set(displayRgba(linear.subarray(row, row + patchRect.width * 4), base.display), row);
  }
  return { linear, data, touched: patchRect };
}
