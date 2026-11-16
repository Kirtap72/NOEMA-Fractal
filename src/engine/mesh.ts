import type { Vec3 } from "./camera";

/** A triangle mesh. Triangles are counter-clockwise seen from outside, so the normals point out of the shape. */
export interface Mesh {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Unit normal (x, y, z) per vertex. */
  normals: Float32Array;
  /** Three vertex numbers per triangle. */
  indices: Uint32Array;
  /** Optional colour (red, green, blue) per vertex, in linear light from 0 to 1. Added with engine.colorsAt. */
  colors?: Float32Array;
}

export interface GridSpec {
  origin: Vec3;
  step: Vec3;
  /** Number of points along each axis. */
  size: [number, number, number];
}

/** A list of numbers that grows as needed (a plain array would be slow and heavy for millions of values). */
class Growing<T extends Float32Array | Uint32Array> {
  private data: T;
  length = 0;
  constructor(
    private make: (n: number) => T,
    capacity = 4096,
  ) {
    this.data = make(capacity);
  }
  push(...values: number[]): void {
    if (this.length + values.length > this.data.length) {
      const bigger = this.make(Math.max(this.data.length * 2, this.length + values.length));
      bigger.set(this.data.subarray(0, this.length));
      this.data = bigger;
    }
    for (const v of values) this.data[this.length++] = v;
  }
  result(): T {
    return this.data.slice(0, this.length) as T;
  }
}

/** The 12 edges of a cell, as pairs of its 8 corners (corner number = x + 2y + 4z). */
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

/**
 * Makes a triangle mesh from distance values on a grid, using Surface Nets: every cell that the surface
 * passes through gets one vertex (the average of the places where the surface crosses the cell's edges), and
 * every grid edge that the surface crosses gets a quad joining the four cells around it.
 *
 * `values` holds the distance at each grid point (negative inside the shape), with point (i, j, k) at
 * index i + nx * (j + ny * k). `level` moves the surface: it is drawn where the value equals `level`
 * (a positive level makes the shape a little fatter).
 *
 * Where the shape reaches the edge of the grid it is left open there. Normals are taken from the slope of
 * the distance values, so they follow the shape and do not depend on how the triangles happen to be cut.
 */
export function extractSurface(values: Float32Array, grid: GridSpec, level = 0, onVertex?: (cell: [number, number, number]) => void): Mesh {
  const [nx, ny, nz] = grid.size;
  if (values.length !== nx * ny * nz) throw new Error(`expected ${nx * ny * nz} values, got ${values.length}`);
  if (nx < 2 || ny < 2 || nz < 2) throw new Error("the grid needs at least 2 points along each axis");
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const at = (i: number, j: number, k: number): number => values[i + nx * (j + ny * k)]! - level;
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const positions = new Growing((n) => new Float32Array(n));
  const normals = new Growing((n) => new Float32Array(n));
  const indices = new Growing((n) => new Uint32Array(n));
  let vertexCount = 0;

  const corner = new Float64Array(8);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const v = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
          corner[c] = v;
          if (v < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue; // the surface does not pass through this cell
        // Average the crossing points of the edges where the sign changes.
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
        for (const [a, b] of EDGES) {
          const fa = corner[a]!;
          const fb = corner[b]!;
          if (fa < 0 === fb < 0) continue;
          const t = fa / (fa - fb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          crossings++;
        }
        const px = i + sx / crossings;
        const py = j + sy / crossings;
        const pz = k + sz / crossings;
        // The slope of the values in the cell, pointing out of the shape (values grow outward).
        const gx = (corner[1]! + corner[3]! + corner[5]! + corner[7]! - corner[0]! - corner[2]! - corner[4]! - corner[6]!) / grid.step[0];
        const gy = (corner[2]! + corner[3]! + corner[6]! + corner[7]! - corner[0]! - corner[1]! - corner[4]! - corner[5]!) / grid.step[1];
        const gz = (corner[4]! + corner[5]! + corner[6]! + corner[7]! - corner[0]! - corner[1]! - corner[2]! - corner[3]!) / grid.step[2];
        const len = Math.hypot(gx, gy, gz) || 1;
        positions.push(grid.origin[0] + px * grid.step[0], grid.origin[1] + py * grid.step[1], grid.origin[2] + pz * grid.step[2]);
        normals.push(gx / len, gy / len, gz / len);
        cellVertex[i + cx * (j + cy * k)] = vertexCount++;
        onVertex?.([i, j, k]);
      }
    }
  }

  // One quad for each grid edge that the surface crosses. For an edge along axis a, the four cells around it
  // are at offsets (0,0), (-1,0), (-1,-1), (0,-1) in the two other axes (taken in the order u = a+1, v = a+2).
  const dims = [nx, ny, nz];
  const cdims = [cx, cy, cz];
  const cell = (p: number[]): number => cellVertex[p[0]! + cx * (p[1]! + cy * p[2]!)]!;
  const p = [0, 0, 0];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const here = at(i, j, k);
        for (let axis = 0; axis < 3; axis++) {
          const u = (axis + 1) % 3;
          const v = (axis + 2) % 3;
          const g = [i, j, k];
          if (g[axis]! >= dims[axis]! - 1) continue; // no neighbour along this axis
          if (g[u]! < 1 || g[v]! < 1 || g[u]! >= cdims[u]! || g[v]! >= cdims[v]!) continue; // the quad would leave the grid
          const next = [i, j, k];
          next[axis] = next[axis]! + 1;
          const there = at(next[0]!, next[1]!, next[2]!);
          if (here < 0 === there < 0) continue;
          // The four cells around the edge, in the order A, B, C, D (counter-clockwise seen from +axis).
          const corners: number[] = [];
          for (const [du, dv] of [[-1, -1], [0, -1], [0, 0], [-1, 0]] as const) {
            p[axis] = g[axis]!;
            p[u] = g[u]! + du;
            p[v] = g[v]! + dv;
            corners.push(cell(p));
          }
          const [a, b, c, d] = corners as [number, number, number, number];
          if (a < 0 || b < 0 || c < 0 || d < 0) continue;
          if (here < 0) indices.push(a, b, c, a, c, d); // inside at the low end: the normal points toward +axis
          else indices.push(a, c, b, a, d, c);
        }
      }
    }
  }
  return { positions: positions.result(), normals: normals.result(), indices: indices.result() };
}

/** The volume enclosed by a closed, outward-facing mesh (positive when the triangles face outward). */
export function meshVolume(mesh: Mesh): number {
  let volume = 0;
  const P = mesh.positions;
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3;
    const b = I[t + 1]! * 3;
    const c = I[t + 2]! * 3;
    volume +=
      (P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) -
        P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) +
        P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!)) /
      6;
  }
  return volume;
}
