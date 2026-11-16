import { classifyLookBackup, describeLookImport, lookBackupIds } from "../engine/looks";
import type { LookImportPlan, LookRecord } from "../engine/looks";

/** What importing needs from the Look library. */
export interface LookTransferStore {
  get(id: string): Promise<LookRecord | undefined>;
  /** Adds records that are not in the library yet (one all-or-nothing write). */
  importRecords(records: LookRecord[]): Promise<{ added: number; duplicates: number }>;
}

export interface LookImportResult {
  plan: LookImportPlan;
  added: number;
  message: string;
}

/**
 * Imports a parsed Look backup. Additive and duplicate-aware: only Looks whose id is new are written, in one write; Looks that
 * already exist (same or different content) and invalid records are skipped and reported, never overwritten. A file that is
 * not a Look backup (a material backup, a library backup, something else) is refused before the library is touched, and when
 * nothing is new the library is not written at all.
 */
export async function importLooks(raw: unknown, store: LookTransferStore): Promise<LookImportResult> {
  const existing = new Map<string, LookRecord>();
  for (const id of new Set(lookBackupIds(raw))) {
    const record = await store.get(id);
    if (record) existing.set(id, record);
  }
  const plan = classifyLookBackup(raw, existing);
  const written = plan.fresh.length ? await store.importRecords(plan.fresh) : { added: 0, duplicates: 0 };
  return { plan, added: written.added, message: describeLookImport(plan, written.added) };
}
