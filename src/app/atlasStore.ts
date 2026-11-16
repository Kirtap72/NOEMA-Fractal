/**
 * ARTIST-WORKFLOW 07: where the Discovery Atlas is kept: the browser's local storage (like the camera postcards and the cutbook), as one bounded text.
 * Everything read back goes through readAtlas, so a hand-edited or damaged value is dropped, never trusted. A write that fails (storage full or blocked)
 * is reported to the caller, never swallowed, so the panel can tell the artist the discovery was not kept.
 */
import { readAtlas, writeAtlas } from "../engine/atlas";
import type { AtlasEntry } from "../engine/atlas";

export const ATLAS_KEY = "noema-atlas-v1";
/** The atlas as it was just before the last import (one step back; never read by the application itself). */
export const ATLAS_BACKUP_KEY = "noema-atlas-v1-before-import";

export class AtlasStore {
  constructor(private storage: Storage | undefined = (() => { try { return window.localStorage; } catch { return undefined; } })()) {}

  get available(): boolean { return this.storage !== undefined; }

  load(): AtlasEntry[] {
    try { return readAtlas(this.storage?.getItem(ATLAS_KEY) ?? null); } catch { return []; }
  }

  /** Keeps the given list as the one-step backup. Best effort: a full storage must never stop an import that would otherwise work. */
  backup(entries: readonly AtlasEntry[]): void { try { this.storage?.setItem(ATLAS_BACKUP_KEY, writeAtlas(entries)); } catch { /* the import still goes ahead; it only adds */ } }

  /** True when the list was written. */
  save(entries: readonly AtlasEntry[]): boolean {
    if (!this.storage) return false;
    try { this.storage.setItem(ATLAS_KEY, writeAtlas(entries)); return true; } catch { return false; }
  }
}
