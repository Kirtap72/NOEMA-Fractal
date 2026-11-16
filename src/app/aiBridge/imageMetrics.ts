/**
 * Colour-independent measurements of a preview picture, so the AI (and the tests) can tell a really different SHAPE from a recoloured copy.
 * Everything is derived from the picture's own pixels; nothing here knows about formulas. They are heuristics that help comparing, not a judgement
 * of beauty: the model still looks at the actual pictures.
 *  - objectShare: the share of pixels that differ from the background (the colour of the top-left corner).
 *  - edgeDensity: how much fine structure the object has (mean luminance step between neighbouring pixels inside the object, 0..255).
 *  - brightness: mean luminance of the object.
 *  - grid: a coarse 32 x 18 occupancy map of the silhouette (hex, 144 characters), used to compare silhouettes of two pictures.
 */
export interface PreviewMetrics { objectShare: number; edgeDensity: number; brightness: number; grid: string }
export interface GeometryDifference { silhouetteOverlap: number; edgeDensityA: number; edgeDensityB: number; edgeDensityRatio: number; objectShareA: number; objectShareB: number; verdict: 'clearly different' | 'partly different' | 'liknande'; note: string }

const GW = 32, GH = 18;

export function previewMetrics(rgba: ArrayLike<number>, width: number, height: number): PreviewMetrics {
  const n = width * height;
  const bg = [rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0];
  const mask = new Uint8Array(n);
  let count = 0, lum = 0;
  const luma = (i: number): number => 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
  for (let i = 0; i < n; i++) {
    if (Math.abs(rgba[i * 4]! - bg[0]!) + Math.abs(rgba[i * 4 + 1]! - bg[1]!) + Math.abs(rgba[i * 4 + 2]! - bg[2]!) > 30) { mask[i] = 1; count++; lum += luma(i); }
  }
  let steps = 0, stepCount = 0;
  for (let y = 0; y < height; y++) for (let x = 1; x < width; x++) { const i = y * width + x; if (mask[i] && mask[i - 1]) { steps += Math.abs(luma(i) - luma(i - 1)); stepCount++; } }
  // coarse silhouette: a cell is "inside" when at least a quarter of its pixels belong to the object
  const cells = new Uint8Array(GW * GH);
  const cw = width / GW, ch = height / GH;
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    let inside = 0, total = 0;
    for (let y = Math.floor(gy * ch); y < Math.floor((gy + 1) * ch); y++) for (let x = Math.floor(gx * cw); x < Math.floor((gx + 1) * cw); x++) { total++; if (mask[y * width + x]) inside++; }
    cells[gy * GW + gx] = total && inside / total >= 0.25 ? 1 : 0;
  }
  let hex = '';
  for (let i = 0; i < cells.length; i += 4) hex += (cells[i]! * 8 + cells[i + 1]! * 4 + cells[i + 2]! * 2 + cells[i + 3]!).toString(16);
  const r = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;
  return { objectShare: r(n ? count / n : 0), edgeDensity: r(stepCount ? steps / stepCount : 0, 2), brightness: r(count ? lum / count : 0, 1), grid: hex };
}

const bitsOf = (hex: string): number[] => [...hex].flatMap((c) => { const v = parseInt(c, 16) || 0; return [(v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1]; });

/** How different two pictures are as SHAPES (silhouette overlap, fine-structure density), independent of their colours. */
export function geometryDifference(a: PreviewMetrics, b: PreviewMetrics): GeometryDifference {
  const A = bitsOf(a.grid), B = bitsOf(b.grid);
  let inter = 0, union = 0;
  for (let i = 0; i < Math.min(A.length, B.length); i++) { if (A[i] && B[i]) inter++; if (A[i] || B[i]) union++; }
  const overlap = union ? inter / union : 1;
  const hi = Math.max(a.edgeDensity, b.edgeDensity), lo = Math.min(a.edgeDensity, b.edgeDensity);
  const ratio = hi > 0 ? lo / hi : 1;
  const shareDiff = Math.abs(a.objectShare - b.objectShare) / Math.max(0.01, Math.max(a.objectShare, b.objectShare));
  // Heuristic thresholds (not physics): a recoloured copy keeps the silhouette (overlap near 1) and the structure density (ratio near 1).
  const verdict = overlap < 0.8 || ratio < 0.7 || shareDiff > 0.25 ? 'clearly different' : overlap < 0.93 || ratio < 0.88 || shareDiff > 0.1 ? 'partly different' : 'liknande';
  const r = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;
  return { silhouetteOverlap: r(overlap), edgeDensityA: a.edgeDensity, edgeDensityB: b.edgeDensity, edgeDensityRatio: r(ratio), objectShareA: a.objectShare, objectShareB: b.objectShare, verdict,
    note: verdict === 'liknande' ? 'The shapes resemble each other: probably mostly colour/light. Try another formula chain if you want new geometry.' : 'The shapes differ (silhouette and/or fine structure). Look at the pictures to judge whether the difference is interesting.' };
}
