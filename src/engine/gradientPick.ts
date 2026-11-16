/**
 * ARTIST-WORKFLOW 05: image-driven material editing. A click on a visible surface says WHICH PART OF THE GLOBAL MATERIAL GRADIENT that surface uses,
 * and which gradient stops make its colour. Everything here is arithmetic on the numbers the renderer itself returned for that pixel (the "measure"
 * debug view of the main shader) and on the scene's gradient; it never looks at displayed colours, so a colour that merely looks alike can never
 * be taken for the same gradient position.
 *
 * What the renderer does (shader.ts, surfaceBaseColorWith / gradientColor, and gradient.ts packColor):
 *   x        = measure * cycles + offset                     (measure: iterations, orbit trap, slope, cavity or radius of the surface point)
 *   position = fract(x)  or the mirrored triangle wave of x  (the "wrap" setting), 0 to 1 along the gradient
 *   colour   = the gradient at `position`, between the two stops on either side (locateRamp: linear, or the transition of material gradients)
 * The gradient is global: every surface whose position falls between the same two stops gets its colour from the same two stops. Editing a stop
 * therefore recolours all of them together. It is not a paint on one place.
 */
import { MEASURES } from "./gradient";
import type { ColorSettings, Gradient, Measure, WrapMode } from "./gradient";
import { locateRamp } from "./materialRamp";

/** The gradient position (0 to 1) of the unwrapped coordinate x, exactly as the shader wraps it. */
export function wrapGradient(x: number, wrap: WrapMode): number {
  if (!Number.isFinite(x)) return 0;
  if (wrap === "mirror") {
    const m = x - 2 * Math.floor(x * 0.5);
    return 1 - Math.abs(1 - m);
  }
  return x - Math.floor(x);
}

/** What the renderer returned for one pixel (see the "measure" debug view): the measure, the unwrapped coordinate and the measure's index. */
export interface RawMeasure {
  measure: number;
  coordinate: number;
  which: number;
}

export interface ContributingStop {
  /** Index in `gradient.stops`. */
  index: number;
  /** Share of this stop in the colour at the picked position, 0 to 1. The shares of a hit add up to 1. */
  weight: number;
}

export interface GradientHit {
  measure: Measure;
  /** The unwrapped coordinate (measure * cycles + offset). */
  coordinate: number;
  /** 0 to 1 along the gradient, after the wrap. */
  position: number;
  /** One or two stops (one beyond the ends of the gradient, or on a hard edge), the dominant one first. */
  stops: ContributingStop[];
  /** The stops on either side of the position (equal at and beyond the ends). */
  a: number;
  b: number;
  /** The part of the gradient these two stops cover (positions of stop a and stop b). */
  range: [number, number];
}

export type HitResult = { ok: true; hit: GradientHit } | { ok: false; reason: string };

/** The gradient hit of one pixel, or a Swedish reason why it cannot be given. */
export function gradientHit(color: ColorSettings, raw: RawMeasure): HitResult {
  if (![raw.measure, raw.coordinate, raw.which].every(Number.isFinite)) return { ok: false, reason: "The renderer gave no valid measure for this point." };
  const measure = MEASURES[Math.round(raw.which)];
  if (!measure) return { ok: false, reason: "Unknown measure from the renderer." };
  if (measure !== color.measure) return { ok: false, reason: "The measure in the picture does not match the setting of the scene. Wait until the picture is updated and try again." };
  const stops = color.gradient.stops;
  if (stops.length < 1) return { ok: false, reason: "The gradient lacks colour stops." };
  const position = wrapGradient(raw.coordinate, color.wrap);
  const loc = locateRamp(stops, position);
  const weights = loc.a === loc.b ? [{ index: loc.a, weight: 1 }] : [{ index: loc.a, weight: 1 - loc.s }, { index: loc.b, weight: loc.s }];
  const contributing = weights.filter((w) => w.weight > 1e-9).sort((x, y) => y.weight - x.weight);
  return {
    ok: true,
    hit: { measure, coordinate: raw.coordinate, position, stops: contributing, a: loc.a, b: loc.b, range: [stops[loc.a]!.position, stops[loc.b]!.position] },
  };
}

/** A map of the gradient position of every pixel of a small picture (NaN where nothing is hit), from the renderer's "measure" layer. */
export interface MeasureMap {
  width: number;
  height: number;
  /** Per pixel: the unwrapped gradient coordinate, or NaN. */
  coordinate: Float32Array;
}

export interface SharedSurfaces {
  /** Share of the visible surface pixels that use the same two stops (0 to 1): they change together with the picked surface. */
  share: number;
  /** Share that lies in a neighbouring part of the gradient which shares one of the two stops: it changes too, but only partly. */
  neighbours: number;
  /** Number of visible surface pixels. */
  visible: number;
  /** One byte per pixel: 0 = no surface, 1 = unaffected, 2 = same part of the gradient, 3 = neighbouring part that shares a stop (partly affected). */
  mask: Uint8Array;
}

/**
 * Which visible surfaces use the same part of the gradient as the picked one: those whose position lies between the same two stops
 * (the stops that make the picked colour), and, separately, those in a neighbouring part that shares one of the two stops (partly affected
 * by an edit). Uses the renderer's own coordinates; never the colours on screen.
 */
export function sharedSurfaces(color: ColorSettings, hit: GradientHit, map: MeasureMap): SharedSurfaces {
  const mask = new Uint8Array(map.width * map.height);
  const stops = color.gradient.stops;
  let visible = 0, same = 0, near = 0;
  for (let i = 0; i < mask.length; i++) {
    const x = map.coordinate[i]!;
    if (!Number.isFinite(x)) continue;
    visible++;
    const loc = locateRamp(stops, wrapGradient(x, color.wrap));
    if (loc.a === hit.a && loc.b === hit.b) { mask[i] = 2; same++; }
    // The gradient is continuous: a part next to the picked one blends from the same stop, so editing that stop moves its colours a little too.
    else if (loc.a === hit.a || loc.a === hit.b || loc.b === hit.a || loc.b === hit.b) { mask[i] = 3; near++; }
    else mask[i] = 1;
  }
  return { share: visible ? same / visible : 0, neighbours: visible ? near / visible : 0, visible, mask };
}

/** The edits the artist can make to the region under the click. All optional. */
export interface RegionEdit {
  /** New colour of the stop on the low side ("#rrggbb"). */
  colorA?: string;
  /** New colour of the stop on the high side. Ignored when the two sides are the same stop. */
  colorB?: string;
  /** New width of the blend between the two stops, 0 to 1 (1 = the whole interval, the plain linear blend). Ignored without two different stops. */
  transition?: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The gradient with the region edited (a new gradient; the argument is untouched). Invalid values leave their field unchanged. */
export function editRegion(gradient: Gradient, hit: GradientHit, edit: RegionEdit): Gradient {
  const stops = gradient.stops.map((s) => ({ ...s }));
  const lastIndex = stops.length - 1;
  if (edit.colorA !== undefined && HEX.test(edit.colorA) && stops[hit.a]) stops[hit.a]!.color = edit.colorA.toLowerCase();
  if (hit.a !== hit.b && edit.colorB !== undefined && HEX.test(edit.colorB) && stops[hit.b]) stops[hit.b]!.color = edit.colorB.toLowerCase();
  if (hit.a !== hit.b && hit.a < lastIndex && edit.transition !== undefined && Number.isFinite(edit.transition)) {
    const w = Math.min(1, Math.max(0, edit.transition));
    if (w >= 1) delete stops[hit.a]!.transition;
    else stops[hit.a]!.transition = w;
  }
  return { ...gradient, stops };
}

/** The "measure" layer of the renderer holds (t, measure, coordinate, which) per pixel; the last three are read from the normal layer slots. */
export function readMeasure(layers: { depth: ArrayLike<number>; normal: ArrayLike<number> }, pixel = 0): RawMeasure | null {
  const depth = layers.depth[pixel];
  if (!(typeof depth === "number" && Number.isFinite(depth) && depth > 0)) return null;
  return { measure: layers.normal[pixel * 3]!, coordinate: layers.normal[pixel * 3 + 1]!, which: layers.normal[pixel * 3 + 2]! };
}

/** Builds the map of coordinates from a whole small "measure" layer. */
export function measureMapOf(layers: { width: number; height: number; depth: ArrayLike<number>; normal: ArrayLike<number> }): MeasureMap {
  const coordinate = new Float32Array(layers.width * layers.height).fill(NaN);
  for (let i = 0; i < coordinate.length; i++) {
    const raw = readMeasure(layers, i);
    if (raw) coordinate[i] = raw.coordinate;
  }
  return { width: layers.width, height: layers.height, coordinate };
}

const MEASURE_LABELS: Record<Measure, string> = { iterations: "number of rounds", orbit_trap: "orbit trap", slope: "slope", cavity: "cavities", radius: "distance from the centre" };
export const measureLabel = (m: Measure): string => MEASURE_LABELS[m];
