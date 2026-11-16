/**
 * The layer noise on the CPU, written the same way as the shader's (fractalDisplacementWgsl.ts): same hash, same patterns, same octave sums and masks.
 * It is used to measure how steep the patterns can get (tests/fractalDisplacement.test.ts, which keeps PATTERN_SLOPE honest) and to give anything that has no
 * graphics card (checks, later a mesh export) the displaced height of a point. Values agree with the shader up to rounding in 32-bit numbers.
 */
import type { DisplacementLayer, DisplacementPattern } from './fractalDisplacement';

type V3 = readonly [number, number, number];
const imul = Math.imul;
function hash(x: number, y: number, z: number, seed: number): number {
  let h = (imul(x | 0, 0x8da6b343) ^ imul(y | 0, 0xd8163841) ^ imul(z | 0, 0xcb1ab31f) ^ imul(seed | 0, 0x9e3779b9)) >>> 0;
  h = imul((h ^ (h >>> 15)) >>> 0, 0x2c1b3c6d) >>> 0; h = imul((h ^ (h >>> 12)) >>> 0, 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
const quintic = (f: number) => f * f * f * (f * (f * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function gradient(h: number, dx: number, dy: number, dz: number): number {
  return ((h & 255) / 127.5 - 1) * dx + (((h >>> 8) & 255) / 127.5 - 1) * dy + (((h >>> 16) & 255) / 127.5 - 1) * dz;
}
export function perlin(p: V3, seed: number): number {
  const bx = Math.floor(p[0]), by = Math.floor(p[1]), bz = Math.floor(p[2]);
  const fx = p[0] - bx, fy = p[1] - by, fz = p[2] - bz, wx = quintic(fx), wy = quintic(fy), wz = quintic(fz);
  const n = (ox: number, oy: number, oz: number) => gradient(hash(bx + ox, by + oy, bz + oz, seed), fx - ox, fy - oy, fz - oz);
  const v = lerp(lerp(lerp(n(0, 0, 0), n(1, 0, 0), wx), lerp(n(0, 1, 0), n(1, 1, 0), wx), wy), lerp(lerp(n(0, 0, 1), n(1, 0, 1), wx), lerp(n(0, 1, 1), n(1, 1, 1), wx), wy), wz);
  return Math.max(-1, Math.min(1, v));
}
const valueAt = (x: number, y: number, z: number, seed: number) => (hash(x, y, z, seed) >>> 8) * (2 / 16777216) - 1;
export function valueNoise(p: V3, seed: number): number {
  const bx = Math.floor(p[0]), by = Math.floor(p[1]), bz = Math.floor(p[2]);
  const wx = quintic(p[0] - bx), wy = quintic(p[1] - by), wz = quintic(p[2] - bz);
  const n = (ox: number, oy: number, oz: number) => valueAt(bx + ox, by + oy, bz + oz, seed);
  return lerp(lerp(lerp(n(0, 0, 0), n(1, 0, 0), wx), lerp(n(0, 1, 0), n(1, 1, 0), wx), wy), lerp(lerp(n(0, 0, 1), n(1, 0, 1), wx), lerp(n(0, 1, 1), n(1, 1, 1), wx), wy), wz);
}
/** Distances to the nearest and the second nearest feature point, in cell units. */
export function cell(p: V3, seed: number): [number, number] {
  const bx = Math.floor(p[0]), by = Math.floor(p[1]), bz = Math.floor(p[2]), fx = p[0] - bx, fy = p[1] - by, fz = p[2] - bz;
  let d1 = 9, d2 = 9;
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const h = hash(bx + x, by + y, bz + z, seed);
    const jx = (h & 1023) * (0.9 / 1023) + 0.05, jy = ((h >>> 10) & 1023) * (0.9 / 1023) + 0.05, jz = ((h >>> 20) & 1023) * (0.9 / 1023) + 0.05;
    const d = Math.hypot(x + jx - fx, y + jy - fy, z + jz - fz);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return [d1, d2];
}
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const CODES: Record<DisplacementPattern, number> = { organic: 0, ridged: 1, billow: 2, pores: 3, cracks: 4, erosion: 5, grain: 6 };
function octave(pattern: number, q: V3, seed: number): number {
  if (pattern === 0) return perlin(q, seed);
  if (pattern === 1 || pattern === 5) return 1 - 2 * Math.abs(perlin(q, seed));
  if (pattern === 2) return 2 * Math.abs(perlin(q, seed)) - 1;
  if (pattern === 3) return 1 - 2 * smooth(cell(q, seed)[0] / 0.5);
  if (pattern === 4) { const [a, b] = cell(q, seed); return 1 - 2 * smooth((b - a) / 0.4); }
  return valueNoise(q, seed);
}
/** A pattern at p (already multiplied by the scale), -1 to 1. */
export function pattern(kind: DisplacementPattern, p: V3, octaves: number, lacunarity: number, persistence: number, seed: number): number {
  const code = CODES[kind];
  let sum = 0, norm = 0, amp = 1, freq = 1, weight = 1;
  for (let k = 0; k < octaves; k++) {
    const v = octave(code, [p[0] * freq + 17.13 * k, p[1] * freq + 31.71 * k, p[2] * freq + 9.37 * k], seed);
    sum += amp * weight * v; norm += amp;
    if (code === 5) weight = 0.5 + 0.5 * v;
    amp *= persistence; freq *= lacunarity;
  }
  return sum / Math.max(norm, 1e-6);
}
/** One layer's contribution at pos without its mask (the mask needs the fractal's own measures, see maskValue). */
export function layerHeight(l: DisplacementLayer, pos: V3): number {
  const v = pattern(l.pattern, [(pos[0] + l.offset[0]) * l.scale, (pos[1] + l.offset[1]) * l.scale, (pos[2] + l.offset[2]) * l.scale], l.octaves, l.lacunarity, l.persistence, l.seed);
  return l.amount * (l.blend === 'carve' ? -(0.5 + 0.5 * v) : l.blend === 'raise' ? 0.5 + 0.5 * v : v);
}
/** The mask of a layer (0-1) for a measure value: 1 between low and high, fading out over the softness. */
export function maskValue(l: DisplacementLayer, measure: number): number {
  if (l.mask.measure === 'none') return 1;
  const s = Math.max(l.mask.softness, 1e-9);
  const m = smooth((measure - (l.mask.low - s)) / s) * (1 - smooth((measure - l.mask.high) / s));
  return l.mask.invert ? 1 - m : m;
}
