/**
 * ARTIST-WORKFLOW 07: the Personal Discovery Atlas. A short list of discoveries the artist chose to keep: each one is an exact, restorable scene (the
 * saved scene text, with its credits), a tiny picture, an optional name and note, and, when it grew out of an earlier discovery, a link to its parent.
 *
 * Only what the artist saves by hand is kept (no recording of every action), the list is bounded in count and in size, and nothing is ever dropped
 * silently: when the atlas is full, saving is refused with a clear reason. This file is pure data work (no storage, no screen), so it also runs in tests.
 */

export const ATLAS_FORMAT = 1;
/** Most discoveries kept. */
export const ATLAS_MAX_ENTRIES = 60;
/** One saved scene text may not be larger than this (characters); an ordinary scene is a few KB. */
export const ATLAS_MAX_SCENE_CHARS = 120_000;
/** The whole atlas, in characters of its stored text. Keeps it well inside the browser's storage quota. */
export const ATLAS_MAX_TOTAL_CHARS = 2_400_000;
export const ATLAS_NAME_MAX = 60;
export const ATLAS_NOTE_MAX = 400;
export const ATLAS_THUMB_MAX_CHARS = 24_000;

export interface AtlasEntry {
  id: string;
  /** The discovery this one grew out of. Optional. */
  parentId?: string;
  name?: string;
  note?: string;
  /** Milliseconds since 1970 when it was saved. */
  savedAt: number;
  /** The formula chain, as a short text, so the browser can say what world it is. */
  world: string;
  /** "data:image/webp;base64,..." small picture. Optional. */
  thumb?: string;
  /** The exact scene (the application's own save text). */
  scene: string;
  /** A short fingerprint of the scene text: the same scene is not saved twice. */
  hash: string;
}

export type AtlasProblem = "full" | "too_large" | "duplicate" | "invalid" | "missing";
export interface AtlasError { ok: false; code: AtlasProblem; message: string; existingId?: string }
export interface AtlasOk<T> { ok: true; value: T }

/** The JSON with every object's keys in sorted order, so two texts that only differ in the order of keys give the same result. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}

/**
 * A short fingerprint of a scene text: FNV-1a (32 bit) of its canonical JSON, plus the length. The application writes the same scene with its keys in
 * a different order after reading it back, so the order of keys must not matter: "the same scene" means the same values.
 */
export function sceneHash(text: string): string {
  let canon = text;
  try { canon = canonicalJson(JSON.parse(text)); } catch { /* not JSON: the raw text is fingerprinted */ }
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) { h ^= canon.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0") + "-" + canon.length.toString(16);
}

export function cleanAtlasText(text: unknown, max: number): string | undefined {
  if (typeof text !== "string") return undefined;
  const t = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max).trim();
  return t || undefined;
}

/** Only a small WebP data URL passes (so a hand-edited storage value cannot make the page load anything else). */
export function cleanAtlasThumb(text: unknown): string | undefined {
  return typeof text === "string" && text.length <= ATLAS_THUMB_MAX_CHARS && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(text) ? text : undefined;
}

/** The formula chain of a scene as one short string. */
export function atlasWorld(scene: { content: readonly { chain?: readonly { formula: string }[] }[] }): string {
  return (scene.content[0]?.chain ?? []).map((s) => s.formula).join("+").slice(0, 400);
}

const ID_PATTERN = /^[\w-]{1,48}$/;

/** One stored entry, or null when it is not a valid one. Name, note and picture are cleaned; the scene must be a JSON object text of sane size. */
export function readAtlasEntry(raw: unknown): AtlasEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID_PATTERN.test(r.id)) return null;
  if (typeof r.scene !== "string" || r.scene.length === 0 || r.scene.length > ATLAS_MAX_SCENE_CHARS || !r.scene.trimStart().startsWith("{")) return null;
  const savedAt = typeof r.savedAt === "number" && Number.isFinite(r.savedAt) && r.savedAt >= 0 ? Math.round(r.savedAt) : 0;
  const parentId = typeof r.parentId === "string" && ID_PATTERN.test(r.parentId) && r.parentId !== r.id ? r.parentId : undefined;
  const name = cleanAtlasText(r.name, ATLAS_NAME_MAX), note = cleanAtlasText(r.note, ATLAS_NOTE_MAX), thumb = cleanAtlasThumb(r.thumb);
  const world = typeof r.world === "string" ? r.world.slice(0, 400) : "";
  return { id: r.id, savedAt, world, scene: r.scene, hash: sceneHash(r.scene), ...(parentId ? { parentId } : {}), ...(name ? { name } : {}), ...(note ? { note } : {}), ...(thumb ? { thumb } : {}) };
}

/** Everything that can be read from the stored text; damage gives fewer entries, never an exception. Parents that no longer exist are dropped. */
export function readAtlas(text: string | null): AtlasEntry[] {
  if (!text) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const list = typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw as { format?: unknown }).format === ATLAS_FORMAT ? (raw as { entries?: unknown }).entries : undefined;
  if (!Array.isArray(list)) return [];
  const out: AtlasEntry[] = [];
  for (const item of list) { const e = readAtlasEntry(item); if (e && !out.some((o) => o.id === e.id) && out.length < ATLAS_MAX_ENTRIES) out.push(e); }
  const ids = new Set(out.map((e) => e.id));
  return out.map((e) => { if (e.parentId && !ids.has(e.parentId)) { const { parentId: _gone, ...rest } = e; return rest; } return e; });
}

export function writeAtlas(entries: readonly AtlasEntry[]): string {
  return JSON.stringify({ format: ATLAS_FORMAT, entries: entries.map(({ hash: _h, ...e }) => e) });
}

export const atlasSize = (entries: readonly AtlasEntry[]): number => writeAtlas(entries).length;

export interface NewDiscovery { id: string; scene: string; world: string; name?: unknown; note?: unknown; thumb?: unknown; parentId?: string | undefined; now: number }

/** Adds a discovery (newest last). Refuses, with a reason, when full, too large, the same scene is already there, or the parent is unknown. */
export function addDiscovery(entries: readonly AtlasEntry[], d: NewDiscovery): AtlasOk<AtlasEntry[]> | AtlasError {
  if (!ID_PATTERN.test(d.id) || entries.some((e) => e.id === d.id)) return { ok: false, code: "invalid", message: "The find got an invalid or taken id." };
  if (d.scene.length === 0 || d.scene.length > ATLAS_MAX_SCENE_CHARS) return { ok: false, code: "too_large", message: `The scene is too large for the atlas (at most ${ATLAS_MAX_SCENE_CHARS} characters). Save it as an ordinary scene file instead.` };
  const hash = sceneHash(d.scene);
  const same = entries.find((e) => e.hash === hash);
  if (same) return { ok: false, code: "duplicate", existingId: same.id, message: `Exactly this scene already exists in the atlas${same.name ? ` as "${same.name}"` : ""}.` };
  if (entries.length >= ATLAS_MAX_ENTRIES) return { ok: false, code: "full", message: `The atlas is full (${ATLAS_MAX_ENTRIES} finds). Remove something you do not need, and the new one is saved. Nothing has been removed automatically.` };
  const parentId = d.parentId && entries.some((e) => e.id === d.parentId) ? d.parentId : undefined;
  const name = cleanAtlasText(d.name, ATLAS_NAME_MAX), note = cleanAtlasText(d.note, ATLAS_NOTE_MAX), thumb = cleanAtlasThumb(d.thumb);
  const entry: AtlasEntry = { id: d.id, savedAt: Math.max(0, Math.round(d.now)), world: d.world.slice(0, 400), scene: d.scene, hash, ...(parentId ? { parentId } : {}), ...(name ? { name } : {}), ...(note ? { note } : {}), ...(thumb ? { thumb } : {}) };
  const next = [...entries, entry];
  if (atlasSize(next) > ATLAS_MAX_TOTAL_CHARS) return { ok: false, code: "full", message: "The atlas has reached its size limit. Remove something you do not need, and the new one is saved. Nothing has been removed automatically." };
  return { ok: true, value: next };
}

/** A new name and/or note (undefined leaves it as it is; an empty text clears it). */
export function annotate(entries: readonly AtlasEntry[], id: string, change: { name?: unknown; note?: unknown }): AtlasOk<AtlasEntry[]> | AtlasError {
  if (!entries.some((e) => e.id === id)) return { ok: false, code: "missing", message: "The find no longer exists." };
  return {
    ok: true,
    value: entries.map((e) => {
      if (e.id !== id) return e;
      const { name: oldName, note: oldNote, ...rest } = e;
      const name = change.name === undefined ? oldName : cleanAtlasText(change.name, ATLAS_NAME_MAX);
      const note = change.note === undefined ? oldNote : cleanAtlasText(change.note, ATLAS_NOTE_MAX);
      return { ...rest, ...(name ? { name } : {}), ...(note ? { note } : {}) };
    }),
  };
}

/** Removes one discovery. Its children are linked to its parent instead (the branch is not cut in two). */
export function removeDiscovery(entries: readonly AtlasEntry[], id: string): AtlasOk<AtlasEntry[]> | AtlasError {
  const gone = entries.find((e) => e.id === id);
  if (!gone) return { ok: false, code: "missing", message: "The find no longer exists." };
  return {
    ok: true,
    value: entries.filter((e) => e.id !== id).map((e) => {
      if (e.parentId !== id) return e;
      const { parentId: _p, ...rest } = e;
      return gone.parentId ? { ...rest, parentId: gone.parentId } : rest;
    }),
  };
}

/** The whole branch tree the discovery belongs to (its ancestors, their other branches and its own descendants), oldest first. */
export function family(entries: readonly AtlasEntry[], id: string): AtlasEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  if (!byId.has(id)) return [];
  const keep = new Set<string>([id]);
  for (let cur = byId.get(id), guard = 0; cur?.parentId && guard < ATLAS_MAX_ENTRIES; guard++) { keep.add(cur.parentId); cur = byId.get(cur.parentId); }
  let grew = true;
  while (grew) { grew = false; for (const e of entries) if (e.parentId && keep.has(e.parentId) && !keep.has(e.id)) { keep.add(e.id); grew = true; } }
  return entries.filter((e) => keep.has(e.id)).sort((a, b) => a.savedAt - b.savedAt);
}

/** How many steps below a root a discovery sits (0 for a root); used to indent a branch. */
export function depthOf(entries: readonly AtlasEntry[], id: string): number {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let d = 0;
  for (let cur = byId.get(id); cur?.parentId && d < ATLAS_MAX_ENTRIES; d++) cur = byId.get(cur.parentId);
  return d;
}

interface ComparableScene {
  content: readonly { chain?: readonly { formula: string; iterations?: number; parameters?: Record<string, number> }[] }[];
  camera: { position: readonly number[]; target: readonly number[]; fov_degrees: number };
}

/** The differences between two scenes in a few plain Swedish sentences (what an artist would notice), never an empty text. */
export function describeDifference(a: ComparableScene, b: ComparableScene): string[] {
  const out: string[] = [];
  const ca = a.content[0]?.chain ?? [], cb = b.content[0]?.chain ?? [];
  const names = (c: typeof ca): string => c.map((s) => s.formula).join(" + ") || "(empty chain)";
  if (names(ca) !== names(cb)) out.push(`The formula chain differs: ${names(ca)} versus ${names(cb)}.`);
  else {
    let changed = 0;
    ca.forEach((s, i) => {
      const t = cb[i]!;
      const keys = new Set([...Object.keys(s.parameters ?? {}), ...Object.keys(t.parameters ?? {})]);
      for (const k of keys) if ((s.parameters?.[k] ?? NaN) !== (t.parameters?.[k] ?? NaN)) changed++;
      if ((s.iterations ?? -1) !== (t.iterations ?? -1)) changed++;
    });
    out.push(changed ? `Same formula chain, ${changed} parameter${changed === 1 ? "" : "s"} or rounds differ.` : "Same formula chain with the same parameters.");
  }
  const dist = Math.hypot(...a.camera.position.map((v, i) => v - (b.camera.position[i] ?? 0)));
  const turn = Math.hypot(...a.camera.target.map((v, i) => v - (b.camera.target[i] ?? 0)));
  out.push(dist < 1e-6 && turn < 1e-6 && a.camera.fov_degrees === b.camera.fov_degrees ? "Same camera view." : `The camera is ${dist < 1e-6 ? "at the same place but looks in another direction" : "at another place"}${a.camera.fov_degrees !== b.camera.fov_degrees ? " and has another field of view" : ""}.`);
  return out;
}
