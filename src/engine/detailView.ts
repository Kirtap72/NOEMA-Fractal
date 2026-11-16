/**
 * Detail View (DETAIL-LOOKDEV-03B): inspect any rectangle of a large picture at its true final resolution, without drawing the whole picture.
 *
 * Pure planning and geometry, tested without a graphics card:
 *  - the rectangle is given in pixels of the FINAL film (for example 7000 x 3938); the engine draws it with `region` and `referenceFilm`
 *    so every pixel is exactly the pixel the full render would give (same camera, same pixel footprint);
 *  - the plan is the geometry ladder of the progressive render, cut to the rectangle, ending in Maximal or Ultra;
 *  - a change of lighting or material restarts the plan from a fast level (the geometry level is not what changed), a change of
 *    camera or picture size cancels it because the rectangle no longer matches.
 */
import { progressivePlan } from "./progressiveRender";
import type { ProgressStage, ProgressTarget } from "./progressiveRender";
import { GEOMETRY_LEVELS } from "./qualityLevels";
import type { GeometryLevel } from "./qualityLevels";

export interface PixelRect { x: number; y: number; width: number; height: number }
export interface Film { width: number; height: number }

/** The most pixels one detail picture holds (a 2048 x 1950 area). Larger areas are cut down, never refused silently. */
export const DETAIL_MAX_PIXELS = 4_000_000;
/** The smallest side of a detail picture. */
export const DETAIL_MIN_SIDE = 16;

/** The geometry levels a detail picture can end in. */
export const DETAIL_FINAL_LEVELS: readonly GeometryLevel[] = ["extra", "max", "ultra"];

/** Keeps a rectangle inside the film, at least DETAIL_MIN_SIDE wide and no larger than DETAIL_MAX_PIXELS. Whole numbers only. */
export function clampDetailRect(rect: PixelRect, film: Film): PixelRect {
  let w = Math.max(DETAIL_MIN_SIDE, Math.min(film.width, Math.round(rect.width)));
  let h = Math.max(DETAIL_MIN_SIDE, Math.min(film.height, Math.round(rect.height)));
  if (w * h > DETAIL_MAX_PIXELS) { const k = Math.sqrt(DETAIL_MAX_PIXELS / (w * h)); w = Math.max(DETAIL_MIN_SIDE, Math.floor(w * k)); h = Math.max(DETAIL_MIN_SIDE, Math.floor(h * k)); }
  const x = Math.max(0, Math.min(film.width - w, Math.round(rect.x)));
  const y = Math.max(0, Math.min(film.height - h, Math.round(rect.y)));
  return { x, y, width: w, height: h };
}

/** A rectangle of the given size centred on a film point (clamped). */
export function detailRectAround(center: { x: number; y: number }, size: { width: number; height: number }, film: Film): PixelRect {
  return clampDetailRect({ x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height }, film);
}

/** The same rectangle moved by (dx, dy) film pixels, kept inside the film. */
export function nudgeDetailRect(rect: PixelRect, dx: number, dy: number, film: Film): PixelRect {
  return clampDetailRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, film);
}

/**
 * Where a picture of the film's aspect ends up inside a viewport box drawn with "contain" (the viewport and the progressive picture both
 * show the whole frame that way). Returns the box of the picture in the viewport's coordinates.
 */
export function containedBox(view: { width: number; height: number }, film: Film): { x: number; y: number; width: number; height: number } {
  const k = Math.min(view.width / film.width, view.height / film.height), w = film.width * k, h = film.height * k;
  return { x: (view.width - w) / 2, y: (view.height - h) / 2, width: w, height: h };
}

/** A viewport point (relative to the viewport box) -> film pixel, or null when it lies outside the picture. */
export function viewToFilm(point: { x: number; y: number }, view: { width: number; height: number }, film: Film): { x: number; y: number } | null {
  const b = containedBox(view, film);
  if (point.x < b.x || point.y < b.y || point.x > b.x + b.width || point.y > b.y + b.height) return null;
  return { x: ((point.x - b.x) / b.width) * film.width, y: ((point.y - b.y) / b.height) * film.height };
}

/** A film rectangle -> its box in the viewport (for the frame drawn over the viewport). */
export function filmRectToView(rect: PixelRect, view: { width: number; height: number }, film: Film): { left: number; top: number; width: number; height: number } {
  const b = containedBox(view, film), k = b.width / film.width;
  return { left: b.x + rect.x * k, top: b.y + rect.y * k, width: rect.width * k, height: rect.height * k };
}

/** The rectangle spanned by two viewport points dragged by the artist, in film pixels (clamped). Null when both points are outside the picture. */
export function rectFromDrag(a: { x: number; y: number }, b: { x: number; y: number }, view: { width: number; height: number }, film: Film): PixelRect | null {
  const box = containedBox(view, film), clampPoint = (p: { x: number; y: number }) => ({ x: Math.max(box.x, Math.min(box.x + box.width, p.x)), y: Math.max(box.y, Math.min(box.y + box.height, p.y)) });
  const pa = viewToFilm(clampPoint(a), view, film), pb = viewToFilm(clampPoint(b), view, film);
  if (!pa || !pb) return null;
  return clampDetailRect({ x: Math.min(pa.x, pb.x), y: Math.min(pa.y, pb.y), width: Math.abs(pa.x - pb.x), height: Math.abs(pa.y - pb.y) }, film);
}

export interface DetailStagesOptions {
  /** The first geometry level drawn. A restart after a lighting or material change starts at "fine" (fast) instead of "standard". */
  startAt?: GeometryLevel;
}

/**
 * The stages of a detail picture. It is the progressive plan of the rectangle's own size (so a rectangle of at most 4 Mpx has no small
 * "first picture" stage: it is already 1:1) with the geometry stages below `startAt` dropped.
 */
export function detailStages(rect: PixelRect, target: ProgressTarget, options: DetailStagesOptions = {}): ProgressStage[] {
  const plan = progressivePlan({ width: rect.width, height: rect.height }, target);
  const order = GEOMETRY_LEVELS.map((g) => g.id), from = options.startAt ? order.indexOf(options.startAt) : 0, final = order.indexOf(target.geometry);
  const kept = plan.filter((s) => {
    if (s.scale !== 1) return false; // never a scaled picture: the point is true 1:1 pixels
    const i = order.indexOf(s.id.replace("geometry-", "") as GeometryLevel);
    return !s.id.startsWith("geometry-") || i >= Math.min(from, final);
  });
  return kept;
}

export type DetailChange = "same" | "restart" | "cancel";

/** What a changed scene means for a running or finished detail picture. `identical` is true when the scene object is the very one captured. */
export function classifyDetailChange(captured: { camera: unknown; film: Film }, next: { camera: unknown; film: Film; identical: boolean }): DetailChange {
  if (next.identical) return "same";
  if (JSON.stringify(next.camera) !== JSON.stringify(captured.camera)) return "cancel";
  if (next.film.width !== captured.film.width || next.film.height !== captured.film.height) return "cancel";
  return "restart";
}

/**
 * Human text for what the final quality of the area cost and what that means for the whole picture (a rough scale-up, labelled as such).
 * `ms` is the time of the stages at the final geometry level (the part that scales with the number of pixels); `totalMs` is the whole run,
 * which also holds the coarser stages and, the first time a scene is drawn, the one-off compilation of its shader.
 */
export function detailCostNote(rect: PixelRect, film: Film, ms: number, totalMs = ms): string {
  const share = (rect.width * rect.height) / (film.width * film.height);
  const fmt = (s: number) => (s < 10 ? `${s.toFixed(1)} s` : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
  const percent = (share * 100).toFixed(share < 0.1 ? 1 : 0);
  const prep = totalMs > ms * 1.5 + 2000 ? ` The whole run took ${fmt(totalMs / 1000)}; the first drawing of a scene also contains one-off work (compilation), later drawings are faster.` : "";
  return `The final level in the area (${percent} % of the picture) took ${fmt(ms / 1000)}. The whole picture at the same level would take about ${fmt(ms / 1000 / share)} (rough estimate).${prep}`;
}

/** The hit-threshold of a level in pixels and its Float32 floor scale, for the limit text. */
export function levelFloor(level: GeometryLevel): number {
  return GEOMETRY_LEVELS.find((g) => g.id === level)!.values.precision_floor;
}
