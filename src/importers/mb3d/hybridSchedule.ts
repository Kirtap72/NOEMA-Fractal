/**
 * HYBRID-ENGINE-01: the schedule MB3D actually runs, as opposed to the one stored in the file.
 *
 * A preset stores the group boundaries as slot numbers (end of group 1, where group 1 repeats from, start/end/repeat of group 2).
 * When MB3D loads a preset it first rewrites those numbers to fit the formulas that really exist. The rewrite is described here in our own
 * words, from the observable behaviour of that load step (see docs/hybrid-engine-01/HYBRID.md):
 *
 *  - A slot with an iteration count of 0 is empty. The highest non-empty slot (counted from slot 1) limits every boundary.
 *  - Group 2 cannot start before slot 1 or after the last non-empty slot.
 *  - Alternating chains run everything as one group: group 1 ends at the last non-empty slot.
 *  - DE-combination and IFS chains split in two: group 1 ends directly before group 2 starts, group 2 ends at the last non-empty slot.
 *  - "Repeat from" of group 1 may not lie after the last non-empty slot of group 1; "repeat from" of group 2 stays inside group 2
 *    (and, in DE-combination, not after the last non-empty slot).
 *  - Interpolation chains use fixed boundaries and are not handled here.
 *
 * Slot numbers still count empty slots. A boundary can therefore point at an empty slot (for example "group 1 ends at slot 2" while slot 2 is
 * empty). The engine's chain contains only the real formulas, so boundaries are translated to positions in that chain: a start or a repeat
 * means "the first real formula at or after this slot", an end means "the last real formula at or before this slot". An empty slot makes no
 * calls, so this translation does not change the calculation.
 */
export interface StoredSchedule { end1: number; repeat1: number; start2: number; end2: number; repeat2: number }
export interface EffectiveSchedule extends StoredSchedule { lastSlot: number }
export type HybridMode = 'alternating' | 'de-combination' | 'ifs';

/** `counts[i]` is the iteration count of slot i (0 for an empty slot). Slots beyond the array are empty. */
export function effectiveSchedule(mode: HybridMode, counts: readonly number[], stored: StoredSchedule): EffectiveSchedule {
  const count = (i: number): number => counts[i] ?? 0;
  let last = 5;
  while (last > 0 && count(last) === 0) last--;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const start2 = Math.max(1, Math.min(last, stored.start2));
  const end1 = mode === 'alternating' ? last : start2 - 1;
  const end2 = Math.max(start2, last);
  let repeat2 = clamp(stored.repeat2, start2, end2);
  let x = end1;
  while (x > 0 && count(x) <= 0) x--;
  const repeat1 = Math.min(x, stored.repeat1);
  if (mode === 'de-combination') {
    let y = 5;
    while (y > start2 && count(y) <= 0) y--;
    repeat2 = Math.min(y, repeat2);
  }
  return { end1, repeat1, start2, end2, repeat2, lastSlot: last };
}

/** Chain position (index among the real formulas) of the first real formula at or after `slot`, or -1 if there is none. */
export function firstAtOrAfter(order: readonly number[], slot: number): number {
  return order.findIndex((s) => s >= slot);
}
/** Chain position of the last real formula at or before `slot`, or -1 if there is none. */
export function lastAtOrBefore(order: readonly number[], slot: number): number {
  for (let i = order.length - 1; i >= 0; i--) if (order[i]! <= slot) return i;
  return -1;
}

export interface PositionGroups { group1: { start: number; end: number; repeat: number }; group2: { start: number; end: number; repeat: number } }

/** The two groups as chain positions, or null when a group would be empty or the groups would overlap (then the preset stays unsupported). */
export function positionGroups(order: readonly number[], s: StoredSchedule): PositionGroups | null {
  const g1 = { start: 0, end: lastAtOrBefore(order, s.end1), repeat: firstAtOrAfter(order, s.repeat1) };
  const g2 = { start: firstAtOrAfter(order, s.start2), end: lastAtOrBefore(order, s.end2), repeat: firstAtOrAfter(order, s.repeat2) };
  if (g1.end < 0 || g1.repeat < 0 || g1.repeat > g1.end || g2.start < 0 || g2.end < g2.start || g2.repeat < g2.start || g2.repeat > g2.end) return null;
  if (g2.start <= g1.end) return null;
  return { group1: g1, group2: g2 };
}
