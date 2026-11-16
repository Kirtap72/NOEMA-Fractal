/**
 * "Random formula", step 3 (ARCHITECTURE.md 8.21 section 2, tests f and g): does a small picture of a formula show
 * structure, and is it a copy of one already shown? Everything here works on the layers of a picture (depth and
 * normals, plus the colour for the fingerprint), so it is the same for pictures from the graphics card and for
 * pictures marched on the processor in the tests.
 *
 * The thresholds are calibrated on formulas whose answer is known; the values are in ARCHITECTURE.md 8.21.
 */

export interface ThumbnailLayers {
  width: number;
  height: number;
  /** Distance along the ray per pixel, or below 0 where the ray hit nothing. */
  depth: Float32Array;
  /** Three numbers per pixel: the surface normal (0, 0, 0 where nothing is hit). */
  normal: Float32Array;
  /** RGBA, 8 bits per channel, for the fingerprint. Left out: the fingerprint is made from the normals. */
  color?: Uint8Array;
}

export interface ThumbnailMeasures {
  /** Share of pixels that hit the surface. */
  hitShare: number;
  /** Box-counting estimate of the dimension of the outline (about 1 for smooth outlines, more for fractal ones). */
  outlineDimension: number;
  /** How much the normal turns between neighbouring pixels on the surface, on average (0 for a plane). */
  surfaceDetail: number;
  /** 1 minus the length of the average normal: 0 when every normal points the same way. */
  normalSpread: number;
  /**
   * 64-bit perceptual fingerprint as 16 hexadecimal digits. Kept in the record as a short description of the
   * picture; it is NOT used to find copies, because measured on generated formulas it could not tell different
   * formulas from near copies (both differed in 0 to 2 bits; see ARCHITECTURE.md 8.21, step 3).
   */
  fingerprint: string;
}

export const THUMBNAIL_LIMITS = {
  hitRange: [0.05, 0.9] as const,
  /** An outline at or above this dimension counts as structure. */
  minOutlineDimension: 1.2,
  /** Surface detail at or above this counts as structure (when the outline is smooth). */
  minSurfaceDetail: 0.15,
  /** Below this the surface is close to one flat wall. */
  minNormalSpread: 0.05,
  /**
   * Two pictures where at least this share of the pixels hit in both and have nearly the same normal (within about
   * 25 degrees) are taken as copies. Measured: different formulas agree in at most 0.154 of the pixels.
   */
  copyAgreement: 0.25,
  /**
   * For variants of one formula (mutation) only nearly identical pictures count as copies: variants are meant to be
   * relatives. Measured: a 1 % change of every slider gave agreements up to 0.85, and 1 when the change had no effect.
   */
  mutationCopyAgreement: 0.6,
};

const hit = (l: ThumbnailLayers, x: number, y: number): boolean => x >= 0 && y >= 0 && x < l.width && y < l.height && l.depth[y * l.width + x]! >= 0;

/** The pixels on the outline: hit pixels with at least one of their four neighbours missed (or off the picture). */
export function outlineMask(l: ThumbnailLayers): Uint8Array {
  const out = new Uint8Array(l.width * l.height);
  for (let y = 0; y < l.height; y++) {
    for (let x = 0; x < l.width; x++) {
      if (!hit(l, x, y)) continue;
      if (!hit(l, x - 1, y) || !hit(l, x + 1, y) || !hit(l, x, y - 1) || !hit(l, x, y + 1)) out[y * l.width + x] = 1;
    }
  }
  return out;
}

/**
 * The box-counting dimension of a set of pixels: the slope of log(number of boxes that contain a pixel) against
 * log(1 / box size), fitted by least squares over the box sizes 2, 4, 8 and 16 pixels. Textbook definition of the
 * box-counting (Minkowski) dimension, measured over a small range of scales, so it is only an estimate.
 */
export function boxCountingDimension(mask: Uint8Array, width: number, height: number, sizes: readonly number[] = [2, 4, 8, 16]): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of sizes) {
    const bw = Math.ceil(width / s);
    const bh = Math.ceil(height / s);
    const boxes = new Uint8Array(bw * bh);
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!mask[y * width + x]) continue;
        const b = Math.floor(y / s) * bw + Math.floor(x / s);
        if (!boxes[b]) {
          boxes[b] = 1;
          count++;
        }
      }
    }
    if (count === 0) return 0;
    xs.push(Math.log(1 / s));
    ys.push(Math.log(count));
  }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** How much the normal turns between neighbours, averaged over pairs of neighbouring hit pixels: mean of 1 - n1 . n2. */
export function surfaceDetail(l: ThumbnailLayers): number {
  let sum = 0;
  let pairs = 0;
  const n = l.normal;
  for (let y = 0; y < l.height; y++) {
    for (let x = 0; x < l.width; x++) {
      if (!hit(l, x, y)) continue;
      const i = (y * l.width + x) * 3;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (!hit(l, x + dx, y + dy)) continue;
        const j = ((y + dy) * l.width + x + dx) * 3;
        sum += 1 - (n[i]! * n[j]! + n[i + 1]! * n[j + 1]! + n[i + 2]! * n[j + 2]!);
        pairs++;
      }
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

export function normalSpread(l: ThumbnailLayers): number {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (let p = 0; p < l.width * l.height; p++) {
    if (l.depth[p]! < 0) continue;
    x += l.normal[p * 3]!;
    y += l.normal[p * 3 + 1]!;
    z += l.normal[p * 3 + 2]!;
    count++;
  }
  return count === 0 ? 0 : 1 - Math.hypot(x, y, z) / count;
}

/**
 * A 64-bit fingerprint (an "average hash"): the picture's brightness averaged in 8 x 8 blocks, each block 1 when it
 * is brighter than the median of the blocks. Close pictures get fingerprints that differ in few bits.
 */
export function fingerprint(l: ThumbnailLayers): string {
  const sums = new Float64Array(64);
  const counts = new Float64Array(64);
  for (let y = 0; y < l.height; y++) {
    for (let x = 0; x < l.width; x++) {
      const p = y * l.width + x;
      let v: number;
      if (l.color) v = 0.2126 * l.color[p * 4]! + 0.7152 * l.color[p * 4 + 1]! + 0.0722 * l.color[p * 4 + 2]!;
      else v = l.depth[p]! < 0 ? 0 : 0.5 + 0.5 * l.normal[p * 3 + 1]!; // light from above, when there is no colour
      const b = Math.min(7, Math.floor((y * 8) / l.height)) * 8 + Math.min(7, Math.floor((x * 8) / l.width));
      sums[b] = sums[b]! + v;
      counts[b] = counts[b]! + 1;
    }
  }
  const avg = Array.from(sums, (s, i) => (counts[i] ? s / counts[i]! : 0));
  const median = [...avg].sort((a, b) => a - b)[32]!;
  let hex = "";
  for (let nibble = 0; nibble < 16; nibble++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v = (v << 1) | (avg[nibble * 4 + k]! > median ? 1 : 0);
    hex += v.toString(16);
  }
  return hex;
}

/** How many of the 64 bits two fingerprints differ in. */
export function fingerprintDistance(a: string, b: string): number {
  let bits = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i] ?? "0", 16) ^ parseInt(b[i] ?? "0", 16);
    while (x) {
      bits += x & 1;
      x >>= 1;
    }
  }
  return bits;
}

export function measureThumbnail(l: ThumbnailLayers): ThumbnailMeasures {
  let hits = 0;
  for (let p = 0; p < l.width * l.height; p++) if (l.depth[p]! >= 0) hits++;
  return {
    hitShare: hits / (l.width * l.height),
    outlineDimension: boxCountingDimension(outlineMask(l), l.width, l.height),
    surfaceDetail: surfaceDetail(l),
    normalSpread: normalSpread(l),
    fingerprint: fingerprint(l),
  };
}

export type StructureVerdict = { passed: true } | { passed: false; reason: "too-empty" | "too-full" | "flat" | "no-structure" };

/** Test f: the picture shows structure. */
export function judgeStructure(m: ThumbnailMeasures): StructureVerdict {
  if (m.hitShare < THUMBNAIL_LIMITS.hitRange[0]) return { passed: false, reason: "too-empty" };
  if (m.hitShare > THUMBNAIL_LIMITS.hitRange[1]) return { passed: false, reason: "too-full" };
  if (m.normalSpread < THUMBNAIL_LIMITS.minNormalSpread) return { passed: false, reason: "flat" };
  if (m.outlineDimension < THUMBNAIL_LIMITS.minOutlineDimension && m.surfaceDetail < THUMBNAIL_LIMITS.minSurfaceDetail) return { passed: false, reason: "no-structure" };
  return { passed: true };
}

/**
 * The share of pixels (of those hit in either picture) that are hit in both and whose normals agree (dot product
 * above 0.9). 1 for the same picture; low for different pictures, even when their outlines overlap.
 */
export function thumbnailAgreement(a: ThumbnailLayers, b: ThumbnailLayers): number {
  if (a.width !== b.width || a.height !== b.height) return 0;
  let union = 0;
  let same = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const ha = a.depth[i]! >= 0;
    const hb = b.depth[i]! >= 0;
    if (!ha && !hb) continue;
    union++;
    if (ha && hb && a.normal[i * 3]! * b.normal[i * 3]! + a.normal[i * 3 + 1]! * b.normal[i * 3 + 1]! + a.normal[i * 3 + 2]! * b.normal[i * 3 + 2]! > 0.9) same++;
  }
  return union === 0 ? 1 : same / union;
}

/** Test g: the picture is a copy of one already shown in the round. */
export function isCopyOf(layers: ThumbnailLayers, shown: readonly ThumbnailLayers[], limit: number = THUMBNAIL_LIMITS.copyAgreement): boolean {
  return shown.some((other) => thumbnailAgreement(layers, other) >= limit);
}
