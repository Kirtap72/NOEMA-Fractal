/**
 * Turning flagged tiles into a small number of rectangles for Geometry Detail (INTELLIGENT-RENDERING-03).
 *
 * Geometry Detail renders rectangles, and every call has a fixed cost, so the flagged tiles are merged: runs of tiles in a row are joined, runs that
 * have the same extent in consecutive rows are stacked into one rectangle, and rectangles that are close are merged when the waste is small.
 * Pure geometry; tested without a graphics card.
 */
export interface TileRect { x: number; y: number; width: number; height: number }

/** Flags (one byte per tile, row by row) -> rectangles in PIXELS of the film, clipped to `film`. */
export function flagsToRects(flags: Uint8Array, cols: number, rows: number, tile: number, film: { width: number; height: number }, dilate = 0): TileRect[] {
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!flags[y * cols + x]) continue;
    for (let dy = -dilate; dy <= dilate; dy++) for (let dx = -dilate; dx <= dilate; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) grid[yy * cols + xx] = 1; }
  }
  // Runs per row, stacked while the same run continues in the next row.
  const open = new Map<string, { x0: number; x1: number; y0: number; y1: number }>(), done: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let y = 0; y <= rows; y++) {
    const runs: [number, number][] = [];
    if (y < rows) for (let x = 0; x < cols; ) { if (!grid[y * cols + x]) { x++; continue; } let e = x; while (e < cols && grid[y * cols + e]) e++; runs.push([x, e]); x = e; }
    const keys = new Set(runs.map(([a, b]) => `${a}:${b}`));
    for (const [k, r] of open) if (!keys.has(k)) { done.push(r); open.delete(k); }
    for (const [a, b] of runs) { const k = `${a}:${b}`, r = open.get(k); if (r) r.y1 = y + 1; else open.set(k, { x0: a, x1: b, y0: y, y1: y + 1 }); }
  }
  return done.map((r) => ({ x: r.x0 * tile, y: r.y0 * tile, width: Math.min(film.width, r.x1 * tile) - r.x0 * tile, height: Math.min(film.height, r.y1 * tile) - r.y0 * tile }));
}

const area = (r: TileRect): number => r.width * r.height;
const union = (a: TileRect, b: TileRect): TileRect => { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.width, b.x + b.width), y1 = Math.max(a.y + a.height, b.y + b.height); return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }; };

/** Merges rectangles while the union wastes at most `waste` (share of the union that was not covered) and until at most `maxRects` remain. */
export function mergeRects(rects: readonly TileRect[], waste = 0.35, maxRects = 24): TileRect[] {
  const list = rects.map((r) => ({ ...r }));
  for (;;) {
    let best: { i: number; j: number; cost: number } | null = null;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const u = union(list[i]!, list[j]!), cost = (area(u) - area(list[i]!) - area(list[j]!)) / area(u);
      if (cost <= waste || list.length > maxRects) { if (!best || cost < best.cost) best = { i, j, cost }; }
    }
    if (!best) return list;
    list[best.i] = union(list[best.i]!, list[best.j]!); list.splice(best.j, 1);
  }
}

export const totalArea = (rects: readonly TileRect[]): number => rects.reduce((s, r) => s + area(r), 0);

/** Pixels that would be drawn with Geometry Detail when every rectangle is grown by `margin` (clipped to the film). */
export function pixelsWithMargin(rects: readonly TileRect[], margin: number, film: { width: number; height: number }): number {
  return rects.reduce((s, r) => s + (Math.min(film.width, r.x + r.width + margin) - Math.max(0, r.x - margin)) * (Math.min(film.height, r.y + r.height + margin) - Math.max(0, r.y - margin)), 0);
}
