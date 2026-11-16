/**
 * Creative macros (ARTIST-UX-REDESIGN-01): a few artist-friendly buttons, each a bundle of ordinary scene edits.
 *
 * A macro is a pure function Scene -> Scene. It writes only fields that already exist in the scene format and that the
 * advanced panels show, so every change stays editable there and there is no second scene model. Applying one is a single
 * undoable edit in the app. Geometry changes are formula-aware: they run only where the formula is known to have the
 * property the macro needs; otherwise the macro says what it did NOT change and why, instead of a silent or wrong edit.
 */
import { LIGHT_RIGS, applyRig } from "./lightRigs";
import { defaultEdgeSoftening } from "./renderDetails";
import type { Formula } from "./formula/types";
import { KERNELS } from "./formula/kernels";
import { MAX_STEP_ITERATIONS, MAX_TOTAL_ITERATIONS } from "./scene";
import type { ChainStepData, FractalContent, Scene } from "./scene";
import { QUALITY_LIMITS } from "./renderSetup";
import type { Gradient, GradientStop } from "./gradient";

export const MACRO_IDS = ["detail", "soft", "drama", "colors", "explore"] as const;
export type MacroId = (typeof MACRO_IDS)[number];

export interface MacroInfo {
  id: MacroId;
  title: string;
  /** One plain sentence for the card. */
  blurb: string;
  /** The longer explanation, shown as a tooltip. */
  help: string;
  /** `explore` opens the existing variations panel instead of editing the scene. */
  kind: "scene" | "explore";
}

export const MACROS: readonly MacroInfo[] = [
  { id: "detail", title: "More detail", blurb: "Finer structure and a sharper surface", help: "More iterations where the formula tolerates it, a finer hit limit and cavity shadows.", kind: "scene" },
  { id: "soft", title: "Softer shapes", blurb: "Rounder edges and softer surfaces", help: "Edge softening, softer surface normals and shadows, and rounded corners where the formula has a safe rounding parameter.", kind: "scene" },
  { id: "drama", title: "More dramatic light", blurb: "Low side light and deeper shadows", help: "The Dramatic side light rig with shadows and darker ambient light, in one step.", kind: "scene" },
  { id: "colors", title: "Richer colours", blurb: "More saturated colours, stronger contrast", help: "Saturation and contrast in the colour scale stops. Stops with their own material are left untouched.", kind: "scene" },
  { id: "explore", title: "Explore variations", blurb: "See variations of your fractal", help: "Opens the variation gallery. Nothing changes until you choose a variant.", kind: "explore" },
];

export type MacroResult =
  | { ok: true; scene: Scene; /** What changed, before → after, in plain Swedish. */ changes: string[]; /** What could not be changed and why. */ limits: string[] }
  | { ok: false; reason: string };

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round = (x: number, d = 4): number => +x.toFixed(d);

/** A step that carries the shape: has its own distance estimate (format 2) or is a counted kernel. Helpers/transforms are left alone. */
function isShapeStep(formula: Formula | undefined): boolean {
  if (!formula) return false;
  if (formula.kernel) return KERNELS[formula.kernel]?.role !== "helper";
  return formula.distance !== undefined;
}

const fractalOf = (scene: Scene): FractalContent | undefined => scene.content.find((c): c is FractalContent => c.type === "fractal");

// ---- Mer detalj --------------------------------------------------------------------------------------------------

function moreDetail(scene: Scene, formulas: readonly Formula[]): MacroResult {
  const changes: string[] = [];
  const limits: string[] = [];
  let next: Scene = structuredClone(scene);
  const fractal = fractalOf(next);
  if (!fractal) return { ok: false, reason: "There is no fractal in the scene to make more detailed." };

  // Geometry: more iterations on the main shape step. Only for the plain sequential chain: in grouped, alternating or blended
  // execution a changed count would change the mathematics in ways this macro cannot promise, so it is left alone.
  const plain = (fractal.mode === undefined || fractal.mode === "sequence") && fractal.execution === undefined;
  if (!plain) {
    limits.push("The formula chain runs in groups or mixed mode. The number of rounds is not changed automatically; adjust them under Shape.");
  } else {
    const byId = new Map(formulas.map((f) => [f.id, f]));
    let best = -1;
    let bestIterations = 0;
    fractal.chain.forEach((s, i) => {
      const f = byId.get(s.formula);
      const n = s.iterations ?? f?.iterations ?? 1;
      if (isShapeStep(f) && n > bestIterations) { best = i; bestIterations = n; }
    });
    if (best < 0) {
      limits.push("No formula in the chain is a shape-carrying formula with its own round count. Rounds are not changed.");
    } else {
      const step: ChainStepData = fractal.chain[best]!;
      const others = fractal.chain.reduce((sum, s, i) => sum + (i === best ? 0 : s.iterations ?? byId.get(s.formula)?.iterations ?? 1), 0);
      const room = Math.floor(MAX_TOTAL_ITERATIONS / Math.max(1, fractal.rounds)) - others;
      const target = Math.min(MAX_STEP_ITERATIONS, room, bestIterations + Math.max(1, Math.round(bestIterations * 0.25)));
      if (target > bestIterations) {
        step.iterations = target;
        changes.push(`Rounds in ${byId.get(step.formula)?.name ?? step.formula}: ${bestIterations} → ${target}`);
      } else {
        limits.push(`The number of rounds (${bestIterations}) is already at the limit of what the engine allows.`);
      }
    }
  }

  // Rendering: finer hit threshold and cavity shading bring the structure out. Both are ordinary Quality / Detail settings.
  const q = next.render.quality;
  const [lo] = QUALITY_LIMITS.hit_precision;
  if (q.precision_mode === "pixel") {
    const [pl] = QUALITY_LIMITS.hit_pixels;
    const v = Math.max(pl, round(q.hit_pixels * 0.7, 5));
    if (v < q.hit_pixels) { changes.push(`Hit precision (pixels): ${round(q.hit_pixels, 4)} → ${v}`); q.hit_pixels = v; }
  } else {
    const v = Math.max(lo, +(q.hit_precision * 0.7).toPrecision(3));
    if (v < q.hit_precision) { changes.push(`Hit precision: ${q.hit_precision} → ${v}`); q.hit_precision = v; }
  }
  if (!next.details.cavity.enabled) {
    next.details.cavity = { ...next.details.cavity, enabled: true };
    changes.push("Cavity shading: on");
  } else {
    const s = Math.min(1, round(next.details.cavity.strength + 0.15, 2));
    if (s > next.details.cavity.strength) { changes.push(`Cavity strength: ${next.details.cavity.strength} → ${s}`); next.details.cavity.strength = s; }
  }
  if (!changes.length) return { ok: false, reason: limits[0] ?? "Everything the macro can increase is already at its highest." };
  return { ok: true, scene: next, changes, limits };
}

// ---- Mjukare former ----------------------------------------------------------------------------------------------

/**
 * Formulas whose own shape has a reviewed rounding control: the parameter, how far it may be pushed and why that is safe.
 * `shape-box`: the distance is (outer box shrunk by `rounding`, then offset back out by `rounding`), so the outside size stays and only the corners round.
 */
const ROUNDING_PARAMETERS: Readonly<Record<string, { parameter: string; label: string; step: number }>> = {
  "shape-box": { parameter: "rounding", label: "Rounded corners", step: 0.25 },
};

function softerShapes(scene: Scene, formulas: readonly Formula[]): MacroResult {
  const changes: string[] = [];
  const limits: string[] = [];
  const next: Scene = structuredClone(scene);
  const fractal = fractalOf(next);
  const byId = new Map(formulas.map((f) => [f.id, f]));

  let geometryRounded = false;
  let geometryUnsupported: string[] = [];
  for (const step of fractal?.chain ?? []) {
    const f = byId.get(step.formula);
    const rule = ROUNDING_PARAMETERS[step.formula];
    if (rule && f) {
      const p = f.parameters.find((x) => x.name === rule.parameter);
      if (p) {
        const before = step.parameters[rule.parameter] ?? p.default;
        const after = clamp(round(before + rule.step, 3), p.min, p.max);
        if (after > before) { step.parameters[rule.parameter] = after; changes.push(`${rule.label} i ${f.name}: ${before} → ${after}`); geometryRounded = true; }
        continue;
      }
    }
    if (isShapeStep(f)) geometryUnsupported.push(f?.name ?? step.formula);
  }
  if (!geometryRounded && geometryUnsupported.length) {
    limits.push(`The shape itself in ${[...new Set(geometryUnsupported)].join(", ")} is not rounded: the formula has no safe softness parameter, and changing its mathematics would give a different fractal. The surface is softened in the rendering instead.`);
  }

  // Rendering softness: edge softening, smoother surface normals, softer shadows. All are ordinary settings.
  const edge = { ...(next.details.edge_softening ?? defaultEdgeSoftening()) };
  if (!edge.enabled) {
    edge.enabled = true;
    changes.push("Edge softening: on");
  } else {
    const strength = Math.min(0.9, round(edge.strength + 0.15, 2));
    const radius = Math.min(0.05, round(edge.radius * 1.4, 4));
    if (strength > edge.strength || radius > edge.radius) { changes.push(`Edge softening: strength ${edge.strength} → ${strength}, radius ${edge.radius} → ${radius}`); edge.strength = strength; edge.radius = radius; }
  }
  next.details.edge_softening = edge;

  const q = next.render.quality;
  if (q.precision_mode === "pixel") {
    const [, hi] = QUALITY_LIMITS.normal_pixels;
    const v = Math.min(hi, round(q.normal_pixels * 1.5, 3));
    if (v > q.normal_pixels) { changes.push(`Normal step (pixels): ${q.normal_pixels} → ${v}`); q.normal_pixels = v; }
  } else {
    const [, hi] = QUALITY_LIMITS.normal_epsilon;
    const v = Math.min(hi, +(q.normal_epsilon * 1.5).toPrecision(3));
    if (v > q.normal_epsilon) { changes.push(`Normal step: ${q.normal_epsilon} → ${v}`); q.normal_epsilon = v; }
  }
  let softer = 0;
  for (const l of next.lights) if (l.enabled && l.shadows === "soft" && l.shadow_softness < 1) { l.shadow_softness = Math.min(1, round(l.shadow_softness + 0.2, 2)); softer++; }
  if (softer) changes.push(`Shadow softness: ${softer} lights softer`);
  return { ok: true, scene: next, changes, limits };
}

// ---- Mer dramatiskt ljus -----------------------------------------------------------------------------------------

const DRAMA_RIG = "side-drama";

function dramaticLighting(scene: Scene): MacroResult {
  const rig = LIGHT_RIGS.find((r) => r.id === DRAMA_RIG);
  if (!rig) return { ok: false, reason: "The light rig for dramatic side light does not exist." };
  const applied = applyRig(scene, DRAMA_RIG, "replace-directional", { shadows: true });
  if (!applied.ok) return { ok: false, reason: applied.message };
  const next: Scene = structuredClone(applied.scene);
  const changes = [`Light rig: ${rig.name} (${applied.summary})`];
  const before = next.ambient.intensity;
  const after = Math.max(0.01, round(before * 0.7, 3));
  if (after < before) { next.ambient = { ...next.ambient, intensity: after }; changes.push(`Ambient light: ${round(before, 3)} → ${after}`); }
  return { ok: true, scene: next, changes, limits: [] };
}

// ---- Rikare färger -----------------------------------------------------------------------------------------------

const hex2 = (n: number): string => Math.round(clamp(n, 0, 1) * 255).toString(16).padStart(2, "0");
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${hex2(r + m)}${hex2(g + m)}${hex2(b + m)}`;
}

/** Stops that carry a material (Material Gradient) are kept exactly: their colour is only a swatch for a whole material. */
const isPlainStop = (s: GradientStop): boolean => {
  const { id: _id, position: _p, color: _c, ...rest } = s as GradientStop & Record<string, unknown>;
  return Object.values(rest).every((v) => v === undefined);
};

function richerColors(scene: Scene): MacroResult {
  const next: Scene = structuredClone(scene);
  const stops = next.color.gradient.stops;
  const plain = stops.filter(isPlainStop);
  if (!plain.length) return { ok: false, reason: "The colour scale consists of materials (Material Gradient). The colours are not changed here; adjust the materials under Material." };
  let changed = 0;
  for (const s of plain) {
    const [h, sat, l] = hexToHsl(s.color);
    const nsat = sat < 0.03 ? sat : Math.min(1, sat * 1.3 + 0.04);
    const nl = clamp(l + (l - 0.5) * 0.1, 0.03, 0.97);
    const hex = hslToHex(h, nsat, nl);
    if (hex !== s.color) { s.color = hex; changed++; }
  }
  if (!changed) return { ok: false, reason: "The colours are already as saturated and high-contrast as the macro can make them." };
  // The edited scale is a scene-local copy: the name says so, and pressing again does not pile up suffixes.
  const baseId = (next.color.gradient.id ?? "gradient").replace(/-richer$/, "");
  const baseName = (next.color.gradient.name ?? "Colour scale").replace(/ · richer$/, "");
  const gradient: Gradient = { ...next.color.gradient, id: `${baseId}-richer`, name: `${baseName} · richer` };
  next.color = { ...next.color, gradient };
  const limits = plain.length < stops.length ? [`${stops.length - plain.length} colour stops with a material of their own were left untouched.`] : [];
  return { ok: true, scene: next, changes: [`Colour scale: ${changed} of ${stops.length} colour stops were saturated and given more contrast (saturation ×1.3, brightness ±10 % from the middle)`], limits };
}

export function applyMacro(scene: Scene, id: MacroId, formulas: readonly Formula[]): MacroResult {
  switch (id) {
    case "detail": return moreDetail(scene, formulas);
    case "soft": return softerShapes(scene, formulas);
    case "drama": return dramaticLighting(scene);
    case "colors": return richerColors(scene);
    default: return { ok: false, reason: "This macro does not change the scene directly." };
  }
}
