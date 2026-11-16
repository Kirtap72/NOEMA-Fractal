/**
 * ARTIST-WORKFLOW 02: "Oväntade fynd". A small, optional shelf for variations whose picture was set aside by the quality gate (nearly one colour,
 * or too like another) although the mathematics behind it is valid. The artist can look at them, pick one and develop it further.
 *
 * Only valid discoveries get here: the caller adds an entry only after the picture was rendered and measured. Invalid calculations and shader
 * failures never produce a picture, so they cannot be added. The shelf is bounded, keeps one source at a time, and holds only what the panel
 * already has in memory (a small thumbnail and the recipe/scene), never extra renders.
 */
export const MAX_FINDS = 12;
/** Pictures closer than this (mean absolute difference of the coarse signature) count as the same discovery. */
export const FIND_DUPLICATE_DIFFERENCE = 0.006;

export interface FindEntry<T> {
  /** The recipe signature: the same numeric change is the same discovery. */
  key: string;
  sourceId: string;
  reasons: readonly string[];
  signature: readonly number[];
  item: T;
}

const difference = (a: readonly number[], b: readonly number[]): number => (a.length === b.length && a.length ? a.reduce((n, v, i) => n + Math.abs(v - b[i]!), 0) / a.length : 1);

export class FindShelf<T> {
  private entries: FindEntry<T>[] = [];
  constructor(private readonly max = MAX_FINDS) {}
  get size(): number { return this.entries.length; }
  /** Adds a discovery. Returns false for a duplicate (same recipe, or a picture the shelf already holds) or an entry from another source. */
  add(entry: FindEntry<T>): boolean {
    if (!entry.reasons.length || !entry.signature.length || !entry.signature.every(Number.isFinite)) return false;
    this.keepOnly(entry.sourceId);
    if (this.entries.some((e) => e.key === entry.key || difference(e.signature, entry.signature) < FIND_DUPLICATE_DIFFERENCE)) return false;
    this.entries.push(entry);
    while (this.entries.length > this.max) this.entries.shift(); // the oldest goes first
    return true;
  }
  list(sourceId: string): readonly FindEntry<T>[] { return this.entries.filter((e) => e.sourceId === sourceId); }
  /** A new source (another scene) starts with an empty shelf: its finds belong to a different image world. */
  keepOnly(sourceId: string): void { this.entries = this.entries.filter((e) => e.sourceId === sourceId); }
  remove(key: string): void { this.entries = this.entries.filter((e) => e.key !== key); }
  clear(): void { this.entries = []; }
}
