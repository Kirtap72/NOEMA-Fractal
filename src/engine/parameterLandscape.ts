/**
 * ARTIST-WORKFLOW 03: the parameter landscape. Two continuous parameters of the current fractal become the two axes of a flat map. The centre is
 * the scene as it is; moving a point away from the centre moves the two parameters away from their original values.
 *
 * Everything here is pure arithmetic on a scene and a list of reviewed controls; nothing renders and nothing is stored in a scene.
 *  - WHICH parameters: the controls the variation system already reviewed (auditVariationControls): continuous, with a safe range and no
 *    sign crossings or singular boundaries. Nothing new is guessed.
 *  - HOW FAR: each axis spans the control's reviewed radius times an adjustable scale (RANGE_SCALE_LIMITS), always clamped to the control's own
 *    safe interval, so a point on the map can never be an invalid scene.
 *  - NO RECOMPILATION: parameter values live in the uniform buffer, not in the generated shader. `landscapeKeepsShader` proves that for the
 *    two chosen controls by comparing the renderer's own shader key for the original scene and for the corners of the map; the panel refuses a pair
 *    for which it ever differs.
 */
import type { Formula } from "./formula/types";
import { resolveScene } from "./scene";
import type { Scene } from "./scene";
import { withJulia, withStepParameter } from "./sceneEdit";
import { auditVariationControls } from "./variations";
import type { VariationControl } from "./variations";

export interface LandscapeControl extends VariationControl {
  /** "step:name": a stable identity for the control inside this chain. */
  key: string;
  /** A formula parameter of a chain step, or one component of the Julia constant (step is then -1 and name "c0", "c1" or "c2"). */
  target: "step" | "julia";
  /** True for the controls the variation system reviewed; the others follow a generic rule (see landscapeControls). */
  reviewed: boolean;
  /** The value in the scene the landscape was opened on (the centre of the axis). */
  origin: number;
}

export const RANGE_SCALE_LIMITS = [0.25, 4] as const;
export const MAX_PINS = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Parameters whose names say they are not smooth continuous values. */
const NOT_CONTINUOUS = /iter|count|variant|type|mode|flag|seed|index|select|^n$/i;
/** The Julia constant: a real continuous control of the fractal, read at run time (it is not part of the shader key). */
const JULIA_RADIUS = 0.3;
const JULIA_LIMIT = 2.5;

/**
 * The continuous controls of the first fractal, each with the value it has in `scene`:
 *  1. the controls the variation system reviewed (formula-specific, with safe intervals and radii);
 *  2. for formulas written as expressions (not registered kernels), every other parameter with a real interval around its value, using the
 *     variation system's own rule for the radius (the smaller of 18 % of the value and 8 % of the declared range), clamped to the declared
 *     range of the formula file;
 *  3. the three components of the Julia constant, when Julia mode is on.
 * Kernel formulas keep to the reviewed list only: their other options are flags and map identifiers.
 */
export function landscapeControls(scene: Scene, formulas: readonly Formula[]): LandscapeControl[] {
  const fractal = scene.content[0];
  const chain = fractal?.chain ?? [];
  const reviewed = auditVariationControls(scene, formulas).controls;
  const out: LandscapeControl[] = reviewed.map((c) => {
    const step = chain[c.step]!;
    const formula = formulas.find((f) => f.id === step.formula)!;
    const origin = step.parameters[c.name] ?? formula.parameters.find((p) => p.name === c.name)!.default;
    return { ...c, key: `${c.step}:${c.name}`, origin, target: "step", reviewed: true };
  });
  chain.forEach((step, i) => {
    const formula = formulas.find((f) => f.id === step.formula);
    if (!formula || formula.kernel) return;
    for (const p of formula.parameters) {
      if (out.some((c) => c.step === i && c.name === p.name) || NOT_CONTINUOUS.test(p.name)) continue;
      const v = step.parameters[p.name] ?? p.default;
      if (!(Number.isFinite(v) && Number.isFinite(p.min) && Number.isFinite(p.max) && p.min < p.max && v >= p.min && v <= p.max)) continue;
      const radius = Math.min(Math.max(Math.abs(v) * 0.18, (p.max - p.min) * 0.01), (p.max - p.min) * 0.08);
      if (radius <= 1e-8) continue;
      out.push({ step: i, name: p.name, label: `${i + 1} · ${formula.name} · ${p.label ?? p.name}`, min: p.min, max: p.max, radius, positive: false, key: `${i}:${p.name}`, origin: v, target: "step", reviewed: false });
    }
  });
  if (fractal?.julia?.enabled) {
    (["x", "y", "z"] as const).forEach((axis, k) => {
      out.push({ step: -1, name: `c${k}`, label: `Julia · c ${axis}`, min: -JULIA_LIMIT, max: JULIA_LIMIT, radius: JULIA_RADIUS, positive: false, key: `julia:c${k}`, origin: fractal.julia!.c[k]!, target: "julia", reviewed: false });
    });
  }
  return out;
}

/** One control set to one value (a new scene). */
export function withControlValue(scene: Scene, control: LandscapeControl, value: number): Scene {
  if (control.target === "julia") {
    const c = [...(scene.content[0]?.julia?.c ?? [0, 0, 0])] as [number, number, number];
    c[Number(control.name.slice(1))] = value;
    return withJulia(scene, { c });
  }
  return withStepParameter(scene, control.step, control.name, value);
}

export interface LandscapeAxis {
  control: LandscapeControl;
  /** Multiplies the reviewed radius; 1 = the radius the variation system uses for gentle-to-moderate changes. */
  scale: number;
}

export const clampScale = (scale: number): number => (Number.isFinite(scale) ? clamp(scale, ...RANGE_SCALE_LIMITS) : 1);

/** Half the width of the axis, in parameter units. */
export const halfRange = (axis: LandscapeAxis): number => axis.control.radius * clampScale(axis.scale);

/** The parameter value at map position p (-1 to 1, 0 = the original value), always inside the control's safe interval. */
export function valueAt(axis: LandscapeAxis, p: number): number {
  const q = Number.isFinite(p) ? clamp(p, -1, 1) : 0;
  const { origin, min, max } = axis.control;
  return Number(clamp(origin + q * halfRange(axis), min, max).toPrecision(9));
}

/** The map position (-1 to 1) of a parameter value; values outside the axis sit on its edge. */
export function positionOf(axis: LandscapeAxis, value: number): number {
  const half = halfRange(axis);
  if (!(half > 0) || !Number.isFinite(value)) return 0;
  return clamp((value - axis.control.origin) / half, -1, 1);
}

/** The scene with the two controls set to the given values (a new scene; the argument is untouched). */
export function withLandscape(scene: Scene, x: { control: LandscapeControl; value: number }, y: { control: LandscapeControl; value: number }): Scene {
  return withControlValue(withControlValue(scene, x.control, x.value), y.control, y.value);
}

/** Two different controls, as an axis pair: the same parameter on both axes would make a line, not a map. */
export function compatiblePair(x: LandscapeControl, y: LandscapeControl): boolean {
  return x.key !== y.key;
}

/**
 * True when moving over the whole map never changes the renderer's shader key, i.e. dragging can only change uniforms. The key of the original
 * scene is compared with the key at the four corners and the centre of the map.
 */
export function landscapeKeepsShader(scene: Scene, formulas: readonly Formula[], ax: LandscapeAxis, ay: LandscapeAxis): boolean {
  const key = (s: Scene): string | undefined => {
    const r = resolveScene(s, formulas);
    return r.ok ? r.key : undefined;
  };
  const original = key(scene);
  if (original === undefined) return false;
  for (const [px, py] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const moved = withLandscape(scene, { control: ax.control, value: valueAt(ax, px) }, { control: ay.control, value: valueAt(ay, py) });
    if (key(moved) !== original) return false;
  }
  return true;
}

/** A position the artist wants to keep. Values, not map coordinates, so it survives a change of range. */
export interface LandscapePin<T = unknown> {
  id: number;
  x: number;
  y: number;
  extra?: T;
}

/** A small bounded list of pins. Pins closer than `tolerance` (as a share of each axis half range) to an existing one are not added twice. */
export class PinList<T = unknown> {
  private pins: LandscapePin<T>[] = [];
  private next = 1;
  constructor(private readonly max = MAX_PINS) {}
  get size(): number { return this.pins.length; }
  list(): readonly LandscapePin<T>[] { return this.pins; }
  /** Returns the new pin, or null when it duplicates one or the list is full. */
  add(x: number, y: number, ax: LandscapeAxis, ay: LandscapeAxis, extra?: T, tolerance = 0.01): LandscapePin<T> | null {
    if (!Number.isFinite(x) || !Number.isFinite(y) || this.pins.length >= this.max) return null;
    const hx = halfRange(ax) * tolerance, hy = halfRange(ay) * tolerance;
    if (this.pins.some((p) => Math.abs(p.x - x) <= hx && Math.abs(p.y - y) <= hy)) return null;
    const pin: LandscapePin<T> = { id: this.next++, x, y, ...(extra !== undefined ? { extra } : {}) };
    this.pins.push(pin);
    return pin;
  }
  get(id: number): LandscapePin<T> | undefined { return this.pins.find((p) => p.id === id); }
  remove(id: number): void { this.pins = this.pins.filter((p) => p.id !== id); }
  clear(): void { this.pins = []; }
}
