/**
 * FINAL-POLISH-11: export and import of the Discovery Atlas, so discoveries survive a changed profile, a new computer or a reinstall.
 * Pure data work (no files, no screen); the panel does the reading and writing of the file.
 */
import { ATLAS_FORMAT, ATLAS_MAX_ENTRIES, addDiscovery, readAtlasEntry } from "./atlas";
import type { AtlasEntry, AtlasError, AtlasOk } from "./atlas";

/** The file kind written by `exportAtlas`; an import refuses anything else. */
export const ATLAS_EXPORT_KIND = "noema-atlas-export";
/** An import file larger than this (characters) is refused unread: the atlas itself is bounded well below it. */
export const ATLAS_IMPORT_MAX_CHARS = 8_000_000;
/** Most entries looked at in one file. */
export const ATLAS_IMPORT_MAX_ENTRIES = 500;

/** The whole atlas as one readable JSON file to keep outside the profile. */
export function exportAtlas(entries: readonly AtlasEntry[], exportedAt: string): string {
  return JSON.stringify({ kind: ATLAS_EXPORT_KIND, format: ATLAS_FORMAT, exportedAt, count: entries.length, entries: entries.map(({ hash: _h, ...e }) => e) }, null, 1);
}

export interface ImportReport {
  /** Discoveries added. */
  added: number;
  /** Already in the atlas (the very same scene): left as they are. */
  duplicates: number;
  /** Not a usable discovery (damaged, or its scene cannot be read by this version). */
  invalid: number;
  /** Valid but did not fit (the atlas is bounded). */
  full: number;
  /** Got a new id because the same id was used by a different discovery already here. */
  renamed: number;
}

export interface ImportOptions {
  /** A fresh id that is not in use. */
  newId: () => string;
  /** True when this version of the application can read the scene text. */
  validScene: (sceneText: string) => boolean;
}

/**
 * What the atlas would become if `text` (an exported atlas file) were imported. SAFE by construction: it only ever ADDS. Nothing that is already in the atlas is
 * changed, replaced or removed. A discovery whose scene is already there is not added again (branches that pointed to it attach to the one that is there); an id
 * that is taken gets a new one; a scene the application cannot read is skipped and counted. Every entry goes through the same checks as a discovery saved by hand
 * (size, picture, name, note) and the bounds of the atlas hold.
 */
export function planImport(existing: readonly AtlasEntry[], text: string, options: ImportOptions): AtlasOk<{ entries: AtlasEntry[]; report: ImportReport }> | AtlasError {
  if (typeof text !== "string" || text.length === 0 || text.length > ATLAS_IMPORT_MAX_CHARS) return { ok: false, code: "too_large", message: "The file is empty or too large to be an atlas file. The atlas is unchanged." };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, code: "invalid", message: "The file is not an atlas file (it cannot be read as JSON). The atlas is unchanged." }; }
  const doc = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  // The atlas as the application stores it ({format, entries}) is accepted too, so a copy of the stored value works.
  const known = !!doc && doc.format === ATLAS_FORMAT && (doc.kind === ATLAS_EXPORT_KIND || doc.kind === undefined);
  if (!doc || !known || !Array.isArray(doc.entries)) return { ok: false, code: "invalid", message: "The file is not an atlas file from NOEMA Fractal (wrong type or version). The atlas is unchanged." };

  const report: ImportReport = { added: 0, duplicates: 0, invalid: 0, full: 0, renamed: 0 };
  const candidates: AtlasEntry[] = [];
  const items = doc.entries as unknown[];
  report.invalid += Math.max(0, items.length - ATLAS_IMPORT_MAX_ENTRIES);
  for (const item of items.slice(0, ATLAS_IMPORT_MAX_ENTRIES)) {
    const e = readAtlasEntry(item);
    if (!e || !options.validScene(e.scene)) { report.invalid++; continue; }
    candidates.push(e);
  }

  const byHash = new Map(existing.map((e) => [e.hash, e.id]));
  const taken = new Set(existing.map((e) => e.id));
  const idMap = new Map<string, string>(); // the file's id -> the id it has in the atlas now
  const parentOf = new Map<string, string | undefined>(); // new id -> the file's parent id
  const fresh: AtlasEntry[] = [];
  for (const e of [...candidates].sort((a, b) => a.savedAt - b.savedAt)) {
    const same = byHash.get(e.hash);
    if (same) { idMap.set(e.id, same); report.duplicates++; continue; }
    let id = e.id;
    if (taken.has(id)) { do { id = options.newId(); } while (taken.has(id)); report.renamed++; }
    taken.add(id); idMap.set(e.id, id); byHash.set(e.hash, id);
    parentOf.set(id, e.parentId);
    fresh.push({ ...e, id });
  }

  let entries: AtlasEntry[] = [...existing];
  const placed = new Set(existing.map((e) => e.id));
  const freshIds = new Set(fresh.map((f) => f.id));
  const refused = new Set<string>(); // did not fit: their branches cannot be placed either, and are counted the same way
  // Parents first, so a branch keeps its link; a few passes are enough for any chain the bounds allow.
  let pending = fresh;
  for (let pass = 0; pass <= ATLAS_MAX_ENTRIES && pending.length; pass++) {
    const later: AtlasEntry[] = [];
    for (const e of pending) {
      const fileParent = parentOf.get(e.id);
      const parent = fileParent ? idMap.get(fileParent) : undefined;
      if (parent && refused.has(parent)) { refused.add(e.id); report.full++; continue; }
      if (parent && parent !== e.id && freshIds.has(parent) && !placed.has(parent)) { later.push(e); continue; } // its parent comes first
      const r = addDiscovery(entries, { id: e.id, scene: e.scene, world: e.world, name: e.name, note: e.note, thumb: e.thumb, parentId: parent && placed.has(parent) ? parent : undefined, now: e.savedAt });
      if (r.ok) { entries = r.value; placed.add(e.id); report.added++; }
      else if (r.code === "full") { report.full++; refused.add(e.id); }
      else if (r.code === "duplicate") report.duplicates++;
      else report.invalid++;
    }
    if (later.length === pending.length) { report.invalid += later.length; break; }
    pending = later;
  }
  return { ok: true, value: { entries, report } };
}

/** The result of an import in plain Swedish, for the status line. Nothing is hidden: every kind of skipped discovery is named. */
export function describeImport(r: ImportReport): string {
  const parts = [`${r.added} ${r.added === 1 ? "find" : "finds"} imported`];
  if (r.duplicates) parts.push(`${r.duplicates} already existed (the same scene) and were left as they are`);
  if (r.renamed) parts.push(`${r.renamed} got a new id because the id was taken`);
  if (r.invalid) parts.push(`${r.invalid} could not be used (damaged or a scene this version cannot read)`);
  if (r.full) parts.push(`${r.full} did not fit (the atlas is limited; nothing has been removed)`);
  return parts.join(", ") + ". Your earlier finds are unchanged.";
}
