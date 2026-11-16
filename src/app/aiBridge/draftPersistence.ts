/**
 * Persistent AI drafts (MCP-02). A draft is written to the isolated application profile after every change, so that it survives a restart
 * or an unexpected termination, and is NEVER applied to the artist's live scene by being read back.
 *
 * File format (one JSON file per draft, written atomically by the main process, see desktop/aiDrafts.cjs):
 *   the ORIGINAL scene of the draft (revision 0, in full) + for every later revision only the top-level scene keys that changed.
 * That keeps 50 revisions of a scene with big embedded pictures small, and loses nothing: every revision can be rebuilt exactly.
 * Every rebuilt revision is read through the application's own `parseScene`; a revision that no longer parses ends the history there
 * (with a warning) instead of dropping the whole draft.
 */
import { readLocks } from '../../engine/draftLocks';
import { parseScene } from '../../engine/scene';
import type { Scene } from '../../engine/scene';
import type { Draft, DraftRevision, DraftSource, DraftState } from './drafts';

export const DRAFT_FORMAT = 'noema-ai-draft';
export const DRAFT_VERSION = 1;
export const MAX_DRAFT_FILE_BYTES = 96 * 1024 * 1024;
const ID = /^draft-[a-z0-9]{6,32}$/;
const STATES: readonly DraftState[] = ['editing', 'awaiting_user_confirmation', 'applied', 'declined', 'discarded'];

interface RevisionDelta { note: string; at: number; changes: number; set: Record<string, unknown>; del: string[] }
export interface DraftFile {
  format: typeof DRAFT_FORMAT; version: typeof DRAFT_VERSION;
  id: string; label: string; createdAt: number; baseFingerprint: string; source?: DraftSource; idea?: string; locks?: unknown;
  state: DraftState; previews: number; requestMessage?: string;
  base: Scene; deltas: RevisionDelta[];
}

function delta(prev: Scene, next: Scene): { set: Record<string, unknown>; del: string[] } {
  const a = prev as unknown as Record<string, unknown>, b = next as unknown as Record<string, unknown>;
  const set: Record<string, unknown> = {}, del: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (b[key] === undefined) { if (a[key] !== undefined) del.push(key); }
    else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) set[key] = b[key];
  }
  return { set, del };
}

export function draftToFile(d: Draft): DraftFile {
  const deltas: RevisionDelta[] = d.revisions.slice(1).map((rev, i) => ({ note: rev.note, at: rev.at, changes: rev.changes, ...delta(d.revisions[i]!.scene, rev.scene) }));
  return {
    format: DRAFT_FORMAT, version: DRAFT_VERSION, id: d.id, label: d.label, createdAt: d.createdAt, baseFingerprint: d.baseFingerprint,
    ...(d.source ? { source: d.source } : {}), ...(d.idea ? { idea: d.idea } : {}), ...(d.locks ? { locks: d.locks } : {}), state: d.state, previews: d.previews, ...(d.requestMessage ? { requestMessage: d.requestMessage } : {}),
    base: d.revisions[0]!.scene, deltas,
  };
}

export const serializeDraft = (d: Draft): string => JSON.stringify(draftToFile(d));

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export type ParsedDraft = { ok: true; draft: Draft; warnings: string[] } | { ok: false; id?: string; reason: string };

/** Reads one draft file. Never throws; every kind of damage becomes a reason the panel can show. */
export function parseDraftFile(text: string): ParsedDraft {
  let raw: unknown;
  if (text.length > MAX_DRAFT_FILE_BYTES) return { ok: false, reason: 'The file is too large.' };
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: 'The file is not valid JSON (probably an interrupted write).' }; }
  if (!isObj(raw) || raw.format !== DRAFT_FORMAT) return { ok: false, reason: 'Inte en NOEMA-utkastfil.' };
  const id = typeof raw.id === 'string' ? raw.id : undefined;
  if (raw.version !== DRAFT_VERSION) return { ok: false, id, reason: `Unknown file version ${String(raw.version)}.` };
  if (!id || !ID.test(id)) return { ok: false, reason: 'Invalid draft id.' };
  if (typeof raw.label !== 'string' || raw.label.length > 200 || !Number.isFinite(raw.createdAt) || typeof raw.baseFingerprint !== 'string' || !STATES.includes(raw.state as DraftState)
    || !Number.isInteger(raw.previews) || (raw.previews as number) < 0 || (raw.previews as number) > 100000 || !isObj(raw.base) || !Array.isArray(raw.deltas) || raw.deltas.length > 200) {
    return { ok: false, id, reason: 'The fields of the draft file are invalid.' };
  }
  const source = isObj(raw.source) && ['live', 'artwork', 'draft'].includes(raw.source.kind as string)
    ? { kind: raw.source.kind as DraftSource['kind'], ...(typeof raw.source.id === 'string' ? { id: raw.source.id.slice(0, 160) } : {}), ...(typeof raw.source.title === 'string' ? { title: raw.source.title.slice(0, 200) } : {}) } : undefined;
  const warnings: string[] = [];
  const first = parseScene(structuredClone(raw.base));
  if (!first.ok) return { ok: false, id, reason: 'The original scene in the draft cannot be read: ' + first.errors.slice(0, 2).join('; ') };
  const revisions: DraftRevision[] = [{ scene: first.scene, note: 'start', at: raw.createdAt as number, changes: 0 }];
  let current = structuredClone(raw.base) as Record<string, unknown>;
  for (let i = 0; i < raw.deltas.length; i++) {
    const d = raw.deltas[i];
    if (!isObj(d) || !isObj(d.set) || !Array.isArray(d.del) || typeof d.note !== 'string' || !Number.isFinite(d.at) || !Number.isInteger(d.changes)) { warnings.push(`Step ${i + 1} is damaged; the history ends before it.`); break; }
    const next: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(d.set)) next[k] = structuredClone(v);
    for (const k of d.del) delete next[String(k)];
    const parsed = parseScene(structuredClone(next));
    if (!parsed.ok) { warnings.push(`Step ${i + 1} gives no valid scene; the history ends before it.`); break; }
    revisions.push({ scene: parsed.scene, note: String(d.note).slice(0, 300), at: d.at as number, changes: d.changes as number });
    current = next;
  }
  const draft: Draft = {
    id, label: raw.label, createdAt: raw.createdAt as number, baseFingerprint: raw.baseFingerprint, revisions, state: raw.state as DraftState, previews: raw.previews as number,
    ...(typeof raw.requestMessage === 'string' ? { requestMessage: raw.requestMessage.slice(0, 300) } : {}), ...(source ? { source } : {}), ...(typeof raw.idea === 'string' ? { idea: raw.idea.slice(0, 300) } : {}), ...(readLocks(raw.locks) ? { locks: readLocks(raw.locks)! } : {}),
  };
  return { ok: true, draft, warnings };
}

/** What the main process offers (desktop/aiDrafts.cjs behind IPC). */
export interface DraftDisk {
  save(id: string, text: string): Promise<boolean>;
  list(): Promise<{ drafts: string[]; problems: { id: string; reason: string }[] }>;
  remove(id: string): Promise<boolean>;
}

/**
 * Writes drafts through the disk port. Per draft the writes are strictly in order and a burst of changes is folded into the newest
 * state (the draft is serialised when its turn comes, not when it was changed). A failed write never loses the draft in memory; the
 * error is kept for the panel and the next change tries again.
 */
export class DraftPersistence {
  lastError: string | undefined;
  private queues = new Map<string, Promise<void>>();
  private pending = new Map<string, Draft>();
  constructor(private disk: DraftDisk, private onError: (message: string | undefined) => void = () => {}) {}

  save(draft: Draft): void {
    const first = !this.pending.has(draft.id);
    this.pending.set(draft.id, draft);
    if (!first) return; // a write for this draft is already waiting: it will pick up the newest state
    const prev = this.queues.get(draft.id) ?? Promise.resolve();
    this.queues.set(draft.id, prev.then(async () => {
      const latest = this.pending.get(draft.id);
      this.pending.delete(draft.id);
      if (!latest) return;
      try { await this.disk.save(latest.id, serializeDraft(latest)); this.setError(undefined); }
      catch (e) { this.setError('The draft could not be saved to disk: ' + String((e as Error)?.message ?? e).slice(0, 160)); }
    }));
  }

  remove(id: string): void {
    this.pending.delete(id);
    const prev = this.queues.get(id) ?? Promise.resolve();
    this.queues.set(id, prev.then(async () => { try { await this.disk.remove(id); } catch (e) { this.setError('The draft could not be removed from disk: ' + String((e as Error)?.message ?? e).slice(0, 160)); } }));
  }

  /** Waits until everything that was asked to be written has been written (used before quitting and in tests). */
  async flush(): Promise<void> { await Promise.all([...this.queues.values()]); }

  async loadAll(): Promise<{ drafts: Draft[]; warnings: string[]; problems: { id: string; reason: string }[] }> {
    const { drafts: texts, problems } = await this.disk.list();
    const drafts: Draft[] = [], warnings: string[] = [], bad = [...problems];
    for (const text of texts) {
      const r = parseDraftFile(text);
      if (r.ok) { drafts.push(r.draft); warnings.push(...r.warnings.map((w) => `${r.draft.label}: ${w}`)); }
      else bad.push({ id: r.id ?? '(unknown)', reason: r.reason });
    }
    return { drafts, warnings, problems: bad };
  }

  private setError(m: string | undefined): void { this.lastError = m; this.onError(m); }
}
