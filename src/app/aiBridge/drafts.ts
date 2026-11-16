/**
 * Drafts: separate copies of a scene that the AI may edit and preview freely. A draft never touches the live scene; the artist's
 * explicit "Använd" is the only way it reaches the live scene (appService.ts `confirmApply`, which the AI cannot call).
 *
 * Revision 0 is the copy as it was made; every change appends a revision, and `undo` drops the last one (never below revision 0).
 */
import type { Scene } from '../../engine/scene';
import { lockMessage, lockViolations } from '../../engine/draftLocks';
import type { DraftLocks } from '../../engine/draftLocks';

export type DraftState = 'editing' | 'awaiting_user_confirmation' | 'applied' | 'declined' | 'discarded';

export interface DraftRevision { scene: Scene; note: string; at: number; changes: number }

/** Where a draft started: the live scene, a saved artwork (a COPY of it), or another draft. */
export interface DraftSource { kind: 'live' | 'artwork' | 'draft'; id?: string; title?: string }

export interface Draft {
  id: string;
  label: string;
  createdAt: number;
  /** Fingerprint of the live scene when the draft was made: used to notice that the live scene has changed since. */
  baseFingerprint: string;
  revisions: DraftRevision[];
  state: DraftState;
  previews: number;
  /** The AI's own message when it asked the artist to apply the draft. */
  requestMessage?: string;
  /** What it was made from. Absent in drafts saved by MCP-01A (treated as the live scene). */
  source?: DraftSource;
  /** FORMULA-EXPLORATION-01: the geometric idea this draft tests, in the AI's own words (one sentence). */
  idea?: string;
  /** Colour-independent measurements of the draft's latest preview and its cost (see imageMetrics.ts). */
  lastPreview?: { metrics: import('./imageMetrics').PreviewMetrics; ms: number; width: number };
  /** true for a draft that was read back from disk after a restart (never persisted; set while loading). */
  recovered?: boolean;
  /** ARTIST-WORKFLOW 07: parts the artist locked when the draft was made (camera, lights, material, formula structure). Enforced in `push`. */
  locks?: DraftLocks;
}

export interface DraftLimits { maxAlive: number; maxRevisions: number }

export class DraftError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const isOpen = (d: Draft): boolean => d.state === 'editing' || d.state === 'awaiting_user_confirmation';

export class DraftStore {
  private drafts = new Map<string, Draft>();
  private counter = 0;
  constructor(private limits: DraftLimits, private randomId: () => string = defaultRandomId) {}

  create(scene: Scene, baseFingerprint: string, label: string | undefined, now: number, source: DraftSource = { kind: 'live' }, idea?: string, locks?: DraftLocks): Draft {
    if ([...this.drafts.values()].filter(isOpen).length >= this.limits.maxAlive) {
      throw new DraftError('too_many_drafts', `At most ${this.limits.maxAlive} open drafts. Discard or use one first (noema_discard_draft).`);
    }
    let id: string;
    do { id = 'draft-' + this.randomId(); } while (this.drafts.has(id));
    const draft: Draft = {
      id, label: label?.trim() || `AI draft ${++this.counter}`, createdAt: now, baseFingerprint,
      revisions: [{ scene: structuredClone(scene), note: 'start', at: now, changes: 0 }], state: 'editing', previews: 0, source,
      ...(idea ? { idea } : {}), ...(locks && Object.keys(locks).length ? { locks: { ...locks } } : {}),
    };
    this.drafts.set(id, draft);
    return draft;
  }

  get(id: string): Draft {
    const d = this.drafts.get(id);
    if (!d) throw new DraftError('unknown_draft', `The draft ${id} does not exist (it may have been discarded or the app restarted).`);
    return d;
  }

  /** The draft, only if it can still be edited. */
  editable(id: string): Draft {
    const d = this.get(id);
    if (!isOpen(d)) throw new DraftError('draft_closed', `The draft ${id} is ${stateText(d.state)} and cannot be changed. Create a new draft with noema_create_draft.`);
    return d;
  }

  list(): Draft[] { return [...this.drafts.values()]; }

  /** Puts a draft read back from disk in place. Its id must be free; it counts against the open-draft limit like any other. */
  load(draft: Draft): void {
    if (this.drafts.has(draft.id)) throw new DraftError('duplicate_draft', `The draft ${draft.id} already exists.`);
    this.drafts.set(draft.id, { ...draft, recovered: true });
  }

  current(d: Draft): Scene { return d.revisions[d.revisions.length - 1]!.scene; }

  /** The scene as it was when the draft was made (revision 0). */
  revisionBase(d: Draft): Scene { return d.revisions[0]!.scene; }

  push(d: Draft, scene: Scene, note: string, changes: number, now: number): void {
    // The locks are checked here, for every tool and every AI host: a revision may not touch a locked part of the scene the draft started from.
    const violated = lockViolations(d.revisions[0]!.scene, scene, d.locks);
    if (violated.length) throw new DraftError('locked', lockMessage(violated));
    if (d.revisions.length > this.limits.maxRevisions) throw new DraftError('too_many_revisions', `The draft already has ${this.limits.maxRevisions} revision steps. Create a new draft from this one (noema_create_draft with from).`);
    d.revisions.push({ scene: structuredClone(scene), note: note.slice(0, 300), at: now, changes });
    if (d.state === 'awaiting_user_confirmation') { d.state = 'editing'; delete d.requestMessage; }
  }

  undo(d: Draft): void {
    if (d.revisions.length <= 1) throw new DraftError('nothing_to_undo', 'The draft has no changes to undo.');
    d.revisions.pop();
    if (d.state === 'awaiting_user_confirmation') { d.state = 'editing'; delete d.requestMessage; }
  }

  discard(d: Draft): void { d.state = 'discarded'; d.revisions = d.revisions.slice(-1); this.drafts.delete(d.id); }

  /** Open drafts are counted for the limit; closed ones (applied, declined) only wait to be cleared away. */
  openCount(): number { return [...this.drafts.values()].filter(isOpen).length; }
}

export function stateText(s: DraftState): string {
  return s === 'editing' ? 'open' : s === 'awaiting_user_confirmation' ? 'waiting for the artist\'s answer' : s === 'applied' ? 'already used' : s === 'declined' ? 'avvisat' : 'discarded';
}

function defaultRandomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10).replace(/[^a-z0-9]/g, 'x');
}
