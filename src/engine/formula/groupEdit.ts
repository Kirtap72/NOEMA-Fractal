/**
 * GROUP-EXECUTION-BRIDGE-01: pure index arithmetic for editing a chain that has a grouped execution.
 *
 * A group is {start, end, repeat, maxIterations} over chain positions. Editing the chain therefore has to move the group borders too, or the
 * execution silently points at other formulas. These functions return the new execution (or a reason why the edit is refused); the caller
 * validates the result with chainExecutionErrors, so every rule of the engine still applies and nothing is approximated.
 */
import type { ChainExecution, ChainGroup } from './groupExecution';

export type GroupEditResult = { ok: true; execution: ChainExecution } | { ok: false; reason: string };

const shifted = (g: ChainGroup, by: number): ChainGroup => ({ ...g, start: g.start + by, end: g.end + by, repeat: g.repeat + by });
const withGroups = (e: ChainExecution, groups: ChainGroup[]): ChainExecution => ({ ...e, groups } as ChainExecution);

/** Which group a chain position belongs to. A position just past a group's end belongs to the next group, or to the last one at the very end. */
export function groupOfPosition(e: ChainExecution, position: number): number {
  const i = e.groups.findIndex((g) => position >= g.start && position <= g.end);
  return i >= 0 ? i : e.groups.length - 1;
}

/** A step is inserted at chain position `at`, as a member of group `group` (default: the group that owns that position). */
export function executionAfterInsert(e: ChainExecution, at: number, group?: number): GroupEditResult {
  const k = group ?? groupOfPosition(e, at);
  const target = e.groups[k];
  if (!target) return { ok: false, reason: `group ${group} does not exist (1 to ${e.groups.length} in this execution)` };
  if (at < target.start || at > target.end + 1) return { ok: false, reason: `position ${at} lies outside group ${k + 1} (${target.start}–${target.end}); insert within the group or right after its last step` };
  const groups = e.groups.map((g, i) => {
    if (i < k) return g;
    if (i === k) return { ...g, end: g.end + 1, repeat: at <= g.repeat ? g.repeat + 1 : g.repeat };
    return shifted(g, 1);
  });
  return { ok: true, execution: withGroups(e, groups) };
}

/** The step at `at` is removed. A group must keep at least one step, and its repeat point stays inside it. */
export function executionAfterRemove(e: ChainExecution, at: number): GroupEditResult {
  const k = e.groups.findIndex((g) => at >= g.start && at <= g.end);
  if (k < 0) return { ok: false, reason: `position ${at} lies in no group` };
  if (e.groups[k]!.end === e.groups[k]!.start) return { ok: false, reason: `group ${k + 1} would become empty; a group must have at least one step` };
  const groups = e.groups.map((g, i) => {
    if (i < k) return g;
    if (i === k) { const end = g.end - 1; const repeat = at < g.repeat ? g.repeat - 1 : g.repeat; return { ...g, end, repeat: Math.min(repeat, end) }; }
    return shifted(g, -1);
  });
  return { ok: true, execution: withGroups(e, groups) };
}

/** Moving inside one group keeps the borders. Moving across a border is refused: remove the step and insert it in the other group instead. */
export function executionAfterMove(e: ChainExecution, from: number, to: number): GroupEditResult {
  const a = e.groups.findIndex((g) => from >= g.start && from <= g.end), b = e.groups.findIndex((g) => to >= g.start && to <= g.end);
  if (a < 0 || b < 0) return { ok: false, reason: 'the step or the target place lies in no group' };
  if (a !== b) return { ok: false, reason: `the step is in group ${a + 1} but the target place in group ${b + 1}; moving across a group boundary changes which execution the step belongs to. Remove the step and insert it in the other group.` };
  return { ok: true, execution: e };
}

export const GROUP_FIELDS = ['repeat', 'maxIterations'] as const;
export type GroupField = (typeof GROUP_FIELDS)[number];

/** Sets a supported group setting. Borders (start/end) are never edited directly: they follow the steps. */
export function executionWithGroupField(e: ChainExecution, group: number, field: GroupField, value: number): GroupEditResult {
  const g = e.groups[group];
  if (!g) return { ok: false, reason: `group ${group + 1} does not exist (1 to ${e.groups.length})` };
  if (!(GROUP_FIELDS as readonly string[]).includes(field)) return { ok: false, reason: `the setting ${field} cannot be changed; valid: ${GROUP_FIELDS.join(', ')}` };
  if (!Number.isInteger(value)) return { ok: false, reason: 'the value must be an integer' };
  const next = { ...g, [field]: value };
  return { ok: true, execution: withGroups(e, e.groups.map((x, i) => (i === group ? next : x))) };
}
