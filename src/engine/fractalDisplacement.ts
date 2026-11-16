/**
 * Geometric displacement of the FRACTAL itself (scene version 49).
 *
 * The fractal's distance estimate d(p) is changed to a field whose zero set is the displaced surface:
 *
 *     f(p) = (d(p) - H(p)) / (1 + L)        where  H(p) = the sum of the noise layers (each one masked, scaled and blended)
 *
 * so the silhouette, the shadows, the reflections and the normals all follow the new shape: it is geometry, not a shading trick. H is bounded by A (the sum of the layer
 * amounts), and every layer's steepest slope is bounded, which gives a number L such that f never overestimates the distance (a ray marcher can trust it, see \`lipschitz\`).
 * Far from the surface (more than 2A) H is not evaluated at all, so the layers cost something only where the surface is.
 *
 * Everything the shader needs is numbers in a small buffer (\`packFractalDisplacement\`): changing a layer never needs a new shader, and Live LookDev 2 and the final
 * renderer read the very same numbers with the very same WGSL (fractalDisplacementWgsl.ts), so they draw the same shape.
 * Amounts, scales and mask limits are in scene units. The panel picks sensible starting values from the distance of the camera to its target.
 */
export const MAX_DISPLACEMENT_LAYERS = 8;
export const DISPLACEMENT_PATTERNS = ['organic', 'ridged', 'billow', 'pores', 'cracks', 'erosion', 'grain'] as const;
export type DisplacementPattern = (typeof DISPLACEMENT_PATTERNS)[number];
/** add: both ways (the noise goes from -1 to 1); carve: only inwards (grooves, pits); raise: only outwards (bumps, ridges). */
export const DISPLACEMENT_BLENDS = ['add', 'carve', 'raise'] as const;
export type DisplacementBlend = (typeof DISPLACEMENT_BLENDS)[number];
/**
 * Where on the fractal a layer acts. orbit_trap and iterations are the same measures the colour gradient uses (0-1); height, radius, x and z are in scene units.
 * The mask is 1 between low and high and fades out over \`softness\` on both sides; \`invert\` turns it around.
 */
export const DISPLACEMENT_MASKS = ['none', 'orbit_trap', 'iterations', 'height', 'radius', 'x', 'z'] as const;
export type DisplacementMaskMeasure = (typeof DISPLACEMENT_MASKS)[number];

export interface DisplacementMask { measure: DisplacementMaskMeasure; low: number; high: number; softness: number; invert: boolean }
export interface DisplacementLayer {
  id: string;
  enabled: boolean;
  name?: string;
  pattern: DisplacementPattern;
  blend: DisplacementBlend;
  /** How far the surface moves at most, in scene units. */
  amount: number;
  /** Features per scene unit (a feature is about 1 / scale across). */
  scale: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  seed: number;
  /** Moves the pattern around without moving the fractal. */
  offset: [number, number, number];
  mask: DisplacementMask;
}
export interface FractalDisplacement { enabled: boolean; layers: DisplacementLayer[] }

export const DISPLACEMENT_LIMITS = { amount: [0, 1e6], scale: [1e-6, 1e9], octaves: [1, 6], lacunarity: [1.25, 4], persistence: [0, 1], seed: [0, 16777215], offset: [-1e6, 1e6], mask: [-1e6, 1e6], softness: [0, 1e6] } as const;

export const defaultMask = (): DisplacementMask => ({ measure: 'none', low: 0, high: 1, softness: 0.1, invert: false });
export const defaultDisplacementLayer = (id: string): DisplacementLayer => ({ id, enabled: true, pattern: 'organic', blend: 'add', amount: 0.01, scale: 8, octaves: 3, lacunarity: 2, persistence: 0.5, seed: 0, offset: [0, 0, 0], mask: defaultMask() });
export const defaultFractalDisplacement = (): FractalDisplacement => ({ enabled: false, layers: [] });
/** True when the displacement changes the geometry at all: on, and at least one layer with an amount. */
export function fractalDisplacementActive(d: FractalDisplacement | undefined): d is FractalDisplacement {
  return !!d && d.enabled && d.layers.some((l) => l.enabled && l.amount > 0);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const within = (v: unknown, [lo, hi]: readonly [number, number]): v is number => finite(v) && v >= lo && v <= hi;

/** Reads and checks a displacement block. No block means no displacement. Errors name the field. */
export function readFractalDisplacement(raw: unknown, where: string, errors: string[]): FractalDisplacement | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) { errors.push(`${where} must be an object`); return undefined; }
  const before = errors.length;
  for (const key of Object.keys(raw)) if (!['enabled', 'layers'].includes(key)) errors.push(`${where}.${key} is unknown`);
  if (typeof raw.enabled !== 'boolean') errors.push(`${where}.enabled must be true or false`);
  if (!Array.isArray(raw.layers) || raw.layers.length > MAX_DISPLACEMENT_LAYERS) { errors.push(`${where}.layers must be a list of at most ${MAX_DISPLACEMENT_LAYERS} layers`); return undefined; }
  const ids = new Set<string>(); const layers: DisplacementLayer[] = [];
  raw.layers.forEach((l: unknown, i: number) => {
    const at = `${where}.layers[${i}]`, start = errors.length;
    if (!isObj(l)) { errors.push(`${at} must be an object`); return; }
    for (const key of Object.keys(l)) if (!['id', 'enabled', 'name', 'pattern', 'blend', 'amount', 'scale', 'octaves', 'lacunarity', 'persistence', 'seed', 'offset', 'mask'].includes(key)) errors.push(`${at}.${key} is unknown`);
    if (typeof l.id !== 'string' || !/^[-\w]{1,64}$/.test(l.id)) errors.push(`${at}.id needs 1-64 letters, digits, - or _`); else if (ids.has(l.id)) errors.push(`${at}.id is used twice`); else ids.add(l.id);
    if (typeof l.enabled !== 'boolean') errors.push(`${at}.enabled must be true or false`);
    if (l.name !== undefined && (typeof l.name !== 'string' || l.name.length > 80)) errors.push(`${at}.name must be text of at most 80 characters`);
    if (!(DISPLACEMENT_PATTERNS as readonly unknown[]).includes(l.pattern)) errors.push(`${at}.pattern must be one of ${DISPLACEMENT_PATTERNS.join(', ')}`);
    if (!(DISPLACEMENT_BLENDS as readonly unknown[]).includes(l.blend)) errors.push(`${at}.blend must be one of ${DISPLACEMENT_BLENDS.join(', ')}`);
    for (const key of ['amount', 'scale', 'octaves', 'lacunarity', 'persistence', 'seed'] as const) if (!within(l[key], DISPLACEMENT_LIMITS[key])) errors.push(`${at}.${key} must be within ${DISPLACEMENT_LIMITS[key].join(' to ')}`);
    if (finite(l.octaves) && !Number.isInteger(l.octaves)) errors.push(`${at}.octaves must be a whole number`);
    if (finite(l.seed) && !Number.isInteger(l.seed)) errors.push(`${at}.seed must be a whole number`);
    if (!Array.isArray(l.offset) || l.offset.length !== 3 || !l.offset.every((v) => within(v, DISPLACEMENT_LIMITS.offset))) errors.push(`${at}.offset needs three numbers within ±1e6`);
    const m = l.mask;
    if (!isObj(m)) errors.push(`${at}.mask must be an object`);
    else {
      for (const key of Object.keys(m)) if (!['measure', 'low', 'high', 'softness', 'invert'].includes(key)) errors.push(`${at}.mask.${key} is unknown`);
      if (!(DISPLACEMENT_MASKS as readonly unknown[]).includes(m.measure)) errors.push(`${at}.mask.measure must be one of ${DISPLACEMENT_MASKS.join(', ')}`);
      for (const key of ['low', 'high'] as const) if (!within(m[key], DISPLACEMENT_LIMITS.mask)) errors.push(`${at}.mask.${key} must be within ±1e6`);
      if (!within(m.softness, DISPLACEMENT_LIMITS.softness)) errors.push(`${at}.mask.softness must be within 0 to 1e6`);
      if (typeof m.invert !== 'boolean') errors.push(`${at}.mask.invert must be true or false`);
    }
    if (errors.length === start) layers.push(structuredClone(l) as unknown as DisplacementLayer);
  });
  return errors.length === before ? { enabled: raw.enabled as boolean, layers } : undefined;
}

// ---- the numbers for the shader -----------------------------------------------------------------------------------------------------------------------------------------

/** One header vec4 and four vec4 per layer. */
export const FDISP_FLOATS = 4 + MAX_DISPLACEMENT_LAYERS * 16;
const PATTERN_CODE: Record<DisplacementPattern, number> = { organic: 0, ridged: 1, billow: 2, pores: 3, cracks: 4, erosion: 5, grain: 6 };
const BLEND_CODE: Record<DisplacementBlend, number> = { add: 0, carve: 1, raise: 2 };
const MASK_CODE: Record<DisplacementMaskMeasure, number> = { none: 0, orbit_trap: 1, iterations: 2, height: 3, radius: 4, x: 5, z: 6 };
/** The steepest slope of each pattern's single octave (change of its -1..1 value per unit of its own coordinates): measured on the CPU copy of the noise over 20000 random pairs (1.83, 3.66, 3.66, 6.0, 14.9, 3.66, 3.31) plus 15 % margin; tests/fractalDisplacement.test.ts keeps it honest. */
export const PATTERN_SLOPE: Record<DisplacementPattern, number> = { organic: 2.1, ridged: 4.2, billow: 4.2, pores: 6.9, cracks: 17.2, erosion: 4.4, grain: 3.8 };
/** The largest L allowed: beyond it the surface is marched with steps 13 times shorter than the plain fractal's, which is slow but safe. */
export const MAX_LIPSCHITZ = 12;

/** The share of the steepest slope that all octaves of a layer add up to, relative to its amount. */
export function octaveSlopeFactor(octaves: number, lacunarity: number, persistence: number): number {
  let slope = 0, weight = 0;
  for (let k = 0; k < octaves; k++) { slope += (lacunarity * persistence) ** k; weight += persistence ** k; }
  return weight > 0 ? slope / weight : 1;
}
/** How steeply one layer can change the field per unit of distance (amount x slope of its noise x frequency, plus the steepness of its mask's edges). */
export function layerSlope(l: DisplacementLayer): number {
  let slope = l.amount * l.scale * PATTERN_SLOPE[l.pattern] * octaveSlopeFactor(l.octaves, l.lacunarity, l.persistence);
  if (l.mask.measure !== 'none') slope += l.amount * Math.min(30, 1 / Math.max(l.mask.softness, l.mask.measure === 'orbit_trap' || l.mask.measure === 'iterations' ? 0.02 : 1e-6));
  return slope;
}
/** L: the layers' slopes added up (the field's slope is at most 1 + L, so f / (1 + L) never overestimates the distance). */
export function lipschitz(d: FractalDisplacement): number {
  let total = 0; for (const l of d.layers) if (l.enabled && l.amount > 0) total += layerSlope(l);
  return Math.min(MAX_LIPSCHITZ, total);
}
/** The largest distance the layers can move the surface (the sum of the amounts). */
export function totalAmount(d: FractalDisplacement): number {
  let total = 0; for (const l of d.layers) if (l.enabled && l.amount > 0) total += l.amount;
  return total * 1.0001;
}

/** Header: (number of layers, A, 1 / (1 + L), 1 when on or 2 when a mask needs the formula's core); then 4 vec4 per layer: pattern + 1 (0 = off), amount, scale, octaves / lacunarity, persistence, seed, blend / mask measure, low, high, softness / offset x y z, invert. */
export function packFractalDisplacement(d: FractalDisplacement | undefined, out = new Float32Array(FDISP_FLOATS)): Float32Array {
  out.fill(0);
  if (!fractalDisplacementActive(d)) return out;
  const active = d.layers.filter((l) => l.enabled && l.amount > 0);
  // w: 1 = on, 2 = on and a mask measures the fractal itself (iterations, orbit trap), which needs the formula's full result and not only its distance
  const needsCore = active.some((l) => l.mask.measure === 'orbit_trap' || l.mask.measure === 'iterations');
  out.set([active.length, totalAmount(d), 1 / (1 + lipschitz(d)), needsCore ? 2 : 1], 0);
  active.forEach((l, i) => out.set([
    PATTERN_CODE[l.pattern] + 1, l.amount, l.scale, l.octaves,
    l.lacunarity, l.persistence, l.seed, BLEND_CODE[l.blend],
    MASK_CODE[l.mask.measure], l.mask.low, l.mask.high, l.mask.softness,
    l.offset[0], l.offset[1], l.offset[2], l.mask.invert ? 1 : 0,
  ], 4 + i * 16));
  return out;
}

// ---- starting values and presets ----------------------------------------------------------------------------------------------------------------------------------------

export const DISPLACEMENT_PRESETS = ['large-forms', 'ridges', 'cracks', 'erosion', 'pores', 'fine-grain'] as const;
export type DisplacementPreset = (typeof DISPLACEMENT_PRESETS)[number];
export const DISPLACEMENT_PRESET_LABELS: Record<DisplacementPreset, string> = { 'large-forms': 'Large organic shapes', ridges: 'Ridges', cracks: 'Cracks', erosion: 'Erosion', pores: 'Pores', 'fine-grain': 'Fine grain' };
/**
 * A layer for a kind of effect, sized for a scene whose subject is \`reference\` units away (the distance of the camera to its target): feature sizes and amounts are
 * fractions of that, so the same preset gives a sensible start in a scene of any size.
 */
export function displacementPreset(kind: DisplacementPreset, id: string, reference: number): DisplacementLayer {
  const r = Math.max(reference, 1e-9), layer = defaultDisplacementLayer(id);
  switch (kind) {
    case 'large-forms': return { ...layer, name: DISPLACEMENT_PRESET_LABELS[kind], pattern: 'organic', blend: 'add', amount: 0.05 * r, scale: 1.2 / r, octaves: 3 };
    case 'ridges': return { ...layer, name: DISPLACEMENT_PRESET_LABELS[kind], pattern: 'ridged', blend: 'raise', amount: 0.03 * r, scale: 3 / r, octaves: 4, persistence: 0.45 };
    case 'cracks': return { ...layer, name: DISPLACEMENT_PRESET_LABELS[kind], pattern: 'cracks', blend: 'carve', amount: 0.008 * r, scale: 12 / r, octaves: 1 };
    case 'erosion': return { ...layer, name: DISPLACEMENT_PRESET_LABELS[kind], pattern: 'erosion', blend: 'carve', amount: 0.015 * r, scale: 6 / r, octaves: 4, persistence: 0.5, lacunarity: 2.1 };
    case 'pores': return { ...layer, name: DISPLACEMENT_PRESET_LABELS[kind], pattern: 'pores', blend: 'carve', amount: 0.004 * r, scale: 50 / r, octaves: 1 };
    case 'fine-grain': return { ...layer, name: DISPLACEMENT_PRESET_LABELS[kind], pattern: 'grain', blend: 'add', amount: 0.0015 * r, scale: 180 / r, octaves: 1 };
  }
}
