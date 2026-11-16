import type { ColorSettings } from "./gradient";
import { readColorSettings } from "./gradient";
import { FOG_MODES } from "./fog";
import type { FogMode } from "./fog";
import { readMaterial } from "./material";
import type { MaterialSettings } from "./material";
import { canonicalLibraryValue } from "./discoveryLibrary";
import { discoveryHash } from "./discoveryCatalog";
import { replacementGradientColor } from "./animationIdentity";
import { LIGHT_RIGS, applyRig, planRig } from "./lightRigs";
import type { RigMode } from "./lightRigs";
import type { Scene } from "./scene";
import { RELATIVE_FOG_LIMITS, fogFromRelative, relativeFromFog } from "./subjectScale";
import type { RelativeFog, SubjectReference } from "./subjectScale";

/**
 * Artist Looks (ARTIST-LOOKS-03): a named combination of things that already exist, saved and applied as one.
 *
 * A Look holds up to four optional parts and nothing else:
 * - material: the scene's `MaterialSettings` (the same data a material preset holds),
 * - color: the scene's gradient/colour settings (only if the artist chose to include them when saving),
 * - rig: a camera-relative lighting rig as a TEMPLATE (rig id, mode, shadows), never as finished directions,
 * - fog: the atmosphere, stored scale-free (start in subject distances, strength) so it fits any subject size.
 *
 * Camera framing and depth of field are never part of a Look: they belong to the composition. The validator rejects any
 * unknown key, so a camera or DOF block cannot be smuggled in through a backup file either.
 *
 * Applying resolves the rig against the camera at that moment and the fog against the current subject distance, and
 * writes ordinary scene values in one go. Nothing in a Look follows the camera or the subject later.
 */

export interface LookRig {
  id: string;
  mode: RigMode;
  shadows: boolean;
}
export interface LookFog {
  color: string;
  mode: FogMode;
  affects_sky: boolean;
  relative: RelativeFog;
}
export interface LookPayload {
  kind: "look";
  material?: MaterialSettings;
  color?: ColorSettings;
  rig?: LookRig;
  fog?: LookFog;
}
/** The same envelope as the material and fractal libraries, in its own collection. */
export interface LookRecord {
  version: 1;
  id: string;
  type: "look";
  title: string;
  createdAt: string;
  rating: number;
  tags: string;
  notes: string;
  fingerprint: string;
  payload: LookPayload;
  thumbnail: string;
}
export interface LookBackup {
  format: "noema-look-library";
  version: 1;
  exportedAt: string;
  records: LookRecord[];
}

const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const HEX = /^#[0-9a-fA-F]{6}$/;
const RECORD_KEYS = ["version", "id", "type", "title", "createdAt", "rating", "tags", "notes", "fingerprint", "payload", "thumbnail"];
const PAYLOAD_KEYS = ["kind", "material", "color", "rig", "fog"];
const RIG_MODES: readonly RigMode[] = ["replace-directional", "add"];

function readRig(raw: unknown): LookRig {
  if (!obj(raw) || Object.keys(raw).some((k) => !["id", "mode", "shadows"].includes(k))) throw Error("Invalid light rig in Look.");
  if (typeof raw.id !== "string" || !LIGHT_RIGS.some((r) => r.id === raw.id)) throw Error("Unknown light rig in Look.");
  if (!RIG_MODES.includes(raw.mode as RigMode)) throw Error("Invalid rig mode in Look.");
  if (typeof raw.shadows !== "boolean") throw Error("Invalid shadow choice in Look.");
  return { id: raw.id, mode: raw.mode as RigMode, shadows: raw.shadows };
}

function readLookFog(raw: unknown): LookFog {
  if (!obj(raw) || Object.keys(raw).some((k) => !["color", "mode", "affects_sky", "relative"].includes(k))) throw Error("Invalid fog in Look.");
  if (typeof raw.color !== "string" || !HEX.test(raw.color)) throw Error("Invalid fog colour in Look.");
  if (!(FOG_MODES as readonly string[]).includes(raw.mode as string)) throw Error("Invalid fog mode in Look.");
  if (typeof raw.affects_sky !== "boolean") throw Error("Invalid fog choice in Look.");
  const r = raw.relative;
  if (!obj(r) || Object.keys(r).some((k) => !["start_multiple", "strength"].includes(k))) throw Error("Invalid fog values in Look.");
  const { start_multiple, strength } = r;
  const [sLo, sHi] = RELATIVE_FOG_LIMITS.start_multiple;
  const [tLo, tHi] = RELATIVE_FOG_LIMITS.strength;
  if (typeof start_multiple !== "number" || !Number.isFinite(start_multiple) || start_multiple < sLo || start_multiple > sHi) throw Error("The start of the fog is outside the limits.");
  if (typeof strength !== "number" || !Number.isFinite(strength) || strength < tLo || strength > tHi) throw Error("The strength of the fog is outside the limits.");
  return { color: raw.color.toLowerCase(), mode: raw.mode as FogMode, affects_sky: raw.affects_sky, relative: { start_multiple, strength } };
}

/** Reads and checks a Look record. Unknown keys anywhere are refused; the fingerprint must match the payload. */
export function readLookRecord(raw: unknown): LookRecord {
  if (!obj(raw) || Object.keys(raw).some((k) => !RECORD_KEYS.includes(k))) throw Error("Invalid Look.");
  if (raw.version !== 1 || raw.type !== "look" || typeof raw.id !== "string" || !/^[-\w:]{1,128}$/.test(raw.id)) throw Error("Invalid Look.");
  if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 120) throw Error("Invalid Look name.");
  if (typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt))) throw Error("Invalid Look date.");
  if (raw.rating !== 0 || typeof raw.tags !== "string" || raw.tags.length > 256 || typeof raw.notes !== "string" || raw.notes.length > 2000 || raw.thumbnail !== "") throw Error("Invalid Look.");
  const p = raw.payload;
  if (!obj(p) || p.kind !== "look" || Object.keys(p).some((k) => !PAYLOAD_KEYS.includes(k))) throw Error("The Look has no valid data (camera and depth of field are never included).");
  const errors: string[] = [];
  const payload: LookPayload = { kind: "look" };
  if (p.material !== undefined) {
    const material = readMaterial(p.material, "material", errors);
    if (!material) throw Error(errors.join("; "));
    payload.material = material;
  }
  if (p.color !== undefined) {
    const color = readColorSettings(p.color, "color", errors);
    if (!color) throw Error(errors.join("; "));
    payload.color = color;
  }
  if (errors.length) throw Error(errors.join("; "));
  if (p.rig !== undefined) payload.rig = readRig(p.rig);
  if (p.fog !== undefined) payload.fog = readLookFog(p.fog);
  if (!payload.material && !payload.color && !payload.rig && !payload.fog) throw Error("The Look contains nothing.");
  const fingerprint = discoveryHash(canonicalLibraryValue(payload));
  if (raw.fingerprint !== fingerprint) throw Error("The fingerprint of the Look does not match.");
  return { ...raw, payload, fingerprint } as unknown as LookRecord;
}

export function createLookRecord(payload: LookPayload, title: string, id: string, now = new Date().toISOString()): LookRecord {
  return readLookRecord({ version: 1, id, type: "look", title, createdAt: now, rating: 0, tags: "", notes: "", fingerprint: discoveryHash(canonicalLibraryValue(payload)), payload, thumbnail: "" });
}

export function readLookBackup(input: unknown): LookBackup {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!obj(raw) || raw.format !== "noema-look-library" || raw.version !== 1 || typeof raw.exportedAt !== "string" || !Array.isArray(raw.records)) throw Error("Invalid Look backup.");
  const records = raw.records.map(readLookRecord);
  if (new Set(records.map((r) => r.id)).size !== records.length) throw Error("The Look backup has duplicate ids.");
  return { format: "noema-look-library", version: 1, exportedAt: raw.exportedAt, records };
}

// ---- contents, capture, plan and apply ----------------------------------------------------------------------------------

export interface LookParts {
  material: boolean;
  color: boolean;
  rig: boolean;
  fog: boolean;
}

/** Which parts a Look has. */
export function lookHas(payload: LookPayload): LookParts {
  return { material: !!payload.material, color: !!payload.color, rig: !!payload.rig, fog: !!payload.fog };
}

/** Short names of what a Look holds, for cards and summaries. */
export function lookContents(payload: LookPayload): string[] {
  const out: string[] = [];
  if (payload.material) out.push("material");
  if (payload.color) out.push("gradient/colour");
  if (payload.rig) out.push("light rig " + (LIGHT_RIGS.find((r) => r.id === payload.rig!.id)?.name ?? payload.rig.id));
  if (payload.fog) out.push("fog");
  return out;
}

export interface CaptureChoice {
  material: boolean;
  color: boolean;
  fog: boolean;
  /** A rig is chosen by the artist: the lights in a scene are finished world-space values and cannot be turned back into a template. */
  rig?: LookRig;
}
export type CaptureResult = { ok: true; payload: LookPayload; notes: string[] } | { ok: false; message: string };

/**
 * Takes the chosen parts from the current scene. Camera, framing and DOF are not offered. Fog is stored scale-free from
 * the scene's absolute fog and the current subject distance.
 */
export function captureLook(scene: Scene, choice: CaptureChoice, subject: SubjectReference | null): CaptureResult {
  const payload: LookPayload = { kind: "look" };
  const notes: string[] = [];
  if (choice.material) payload.material = structuredClone(scene.material);
  if (choice.color) payload.color = structuredClone(scene.color);
  if (choice.rig) {
    if (!LIGHT_RIGS.some((r) => r.id === choice.rig!.id)) return { ok: false, message: "Unknown light rig. The Look was not saved." };
    payload.rig = { ...choice.rig };
  }
  if (choice.fog) {
    if (!scene.fog.enabled) return { ok: false, message: "The fog is turned off in the scene, so there is no fog to save. Turn on the fog or untick Fog." };
    if (!subject) return { ok: false, message: "The subject distance cannot be calculated, so the fog cannot be saved scale-free. Untick Fog." };
    const relative = relativeFromFog(scene.fog, subject.distance);
    const [sLo, sHi] = RELATIVE_FOG_LIMITS.start_multiple;
    const [tLo, tHi] = RELATIVE_FOG_LIMITS.strength;
    const clamped: RelativeFog = { start_multiple: Math.min(sHi, Math.max(sLo, relative.start_multiple)), strength: Math.min(tHi, Math.max(tLo, relative.strength)) };
    if (clamped.start_multiple !== relative.start_multiple || clamped.strength !== relative.strength) notes.push("The fog was outside the scale-free range and was saved with the nearest allowed value.");
    payload.fog = { color: scene.fog.color, mode: scene.fog.mode, affects_sky: scene.fog.affects_sky, relative: clamped };
  }
  if (!payload.material && !payload.color && !payload.rig && !payload.fog) return { ok: false, message: "Choose at least one part to save in the Look." };
  return { ok: true, payload, notes };
}

export type LookRefusal = { ok: false; message: string };
export interface LookApplied {
  ok: true;
  scene: Scene;
  /** What was really written. */
  applied: string[];
  summary: string;
  /** The schema's fog limits stopped the Look's fog from being reached exactly at this subject distance. */
  fogLimited: boolean;
}

/**
 * What applying would do, and the resulting scene. Pure: the input scene is never changed.
 * - "apply": the scene to commit; the Look's data is copied, so later edits can never reach back into the library record.
 * - "view": the same scene for a render-only trial; data is shared, not copied (no texture data is cloned per frame).
 * - "plan": only checks and describes; the returned scene is the input unchanged, so a panel can ask often.
 *
 * Only these scene fields can change: material, color, fog and lights. The camera, its DOF, the lens, ambient light,
 * environment, formula, render settings and everything else stay the very same objects. If any chosen part cannot be
 * applied (no subject distance for the fog, a rig that does not fit), nothing is applied at all.
 */
export type ApplyMode = "apply" | "view" | "plan";
export function applyLook(scene: Scene, payload: LookPayload, parts: LookParts, subject: SubjectReference | null, mode: ApplyMode = "apply"): LookApplied | LookRefusal {
  const want = { material: parts.material && !!payload.material, color: parts.color && !!payload.color, rig: parts.rig && !!payload.rig, fog: parts.fog && !!payload.fog };
  if (!want.material && !want.color && !want.rig && !want.fog) return { ok: false, message: "Nothing to apply: tick at least one part that the Look contains." };
  let next: Scene = scene;
  const applied: string[] = [];
  const clone = <T,>(v: T): T => (mode === "apply" ? structuredClone(v) : v);
  if (want.material) {
    if (mode !== "plan") next = { ...next, material: clone(payload.material!) };
    applied.push("material");
  }
  if (want.color) {
    if (mode !== "plan") next = { ...next, color: replacementGradientColor(next, clone(payload.color!)) };
    applied.push("gradient/colour");
  }
  let fogLimited = false;
  if (want.fog) {
    if (!subject) return { ok: false, message: "The subject distance cannot be calculated, so the fog of the Look cannot be applied. Untick Fog. Nothing has been changed." };
    const fog = payload.fog!;
    const f = fogFromRelative(fog.relative, subject.distance, fog.mode);
    fogLimited = f.limited;
    if (mode !== "plan") next = { ...next, fog: { enabled: true, color: fog.color, density: f.density, start: f.start, mode: fog.mode, affects_sky: fog.affects_sky } };
    applied.push("fog");
  }
  let rigSummary = "";
  if (want.rig) {
    const rig = payload.rig!;
    if (mode === "plan") {
      const plan = planRig(next, rig.id, rig.mode);
      if (!plan.ok) return { ok: false, message: plan.message };
      rigSummary = plan.summary;
    } else {
      const result = applyRig(next, rig.id, rig.mode, { shadows: rig.shadows });
      if (!result.ok) return { ok: false, message: result.message };
      next = result.scene;
      rigSummary = result.summary;
    }
    applied.push("light rig " + (LIGHT_RIGS.find((r) => r.id === rig.id)?.name ?? rig.id));
  }
  const summary = `Applying: ${applied.join(", ")}.` + (rigSummary ? ` Light: ${rigSummary}` : "") + (fogLimited ? " The fog was limited by the limits of the schema." : "") + " Camera, picture cut-out and depth of field are not touched.";
  return { ok: true, scene: next, applied, summary, fogLimited };
}

// ---- updating a saved Look from the current scene ------------------------------------------------------------------------

export interface UpdateChoice {
  /** The components the updated Look should have. Left out: exactly the ones the saved Look has now. */
  parts?: LookParts;
  /** A rig template, chosen by the artist. Left out: keep the saved one. `null`: take the rig out. Never read from the scene's lights. */
  rig?: LookRig | null;
}
export interface LookUpdated {
  ok: true;
  /** The saved Look with a new definition: same id, name, date, tags and notes. Nothing is written by this function. */
  record: LookRecord;
  notes: string[];
}

/**
 * The saved Look as it would be after "update from current scene". It uses the same capture rules as saving a new Look
 * (captureLook), so fog is stored scale-free from a valid subject distance, a rig is only ever a template and camera/DOF are
 * not offered. Pure: the caller passes the COMMITTED scene (never a trial view) and decides whether to store the result.
 * If any chosen part cannot be captured the whole update is refused and the saved Look stays as it was.
 */
export function updateLook(record: LookRecord, scene: Scene, subject: SubjectReference | null, choice: UpdateChoice = {}): LookUpdated | LookRefusal {
  const parts = choice.parts ?? lookHas(record.payload);
  let rig: LookRig | undefined;
  // `rig: null` is the explicit "take the rig out" and wins over a Look that had one.
  if (parts.rig && choice.rig !== null) {
    rig = choice.rig === undefined ? record.payload.rig : choice.rig;
    if (!rig) return { ok: false, message: "Choose a light rig for the Look. A rig cannot be taken from the light of the scene, because it is a template. The Look is unchanged." };
  }
  const captured = captureLook(scene, { material: parts.material, color: parts.color, fog: parts.fog, ...(rig ? { rig } : {}) }, subject);
  if (!captured.ok) return { ok: false, message: captured.message + " The Look is unchanged." };
  const next = readLookRecord({ ...record, payload: captured.payload, fingerprint: discoveryHash(canonicalLibraryValue(captured.payload)) });
  return { ok: true, record: next, notes: captured.notes };
}

// ---- importing a Look backup -------------------------------------------------------------------------------------------

export interface LookImportPlan {
  /** Not in the library yet: these are the only ones that are written. */
  fresh: LookRecord[];
  /** Already there with the same content: skipped, nothing is overwritten. */
  identical: LookRecord[];
  /** The id exists with other content: skipped, never overwritten. */
  conflicts: LookRecord[];
  invalid: { id: string; reason: string }[];
  exportedAt: string;
}

/** Plain-language error if this is not a Look backup. */
function checkLookEnvelope(raw: unknown): asserts raw is { format: string; version: number; exportedAt: string; records: unknown[] } {
  if (!obj(raw)) throw Error("The file is not a Look backup.");
  if (raw.format === "noema-material-library") throw Error("This is a material backup, not a Look backup. Import it in the Material library.");
  if (raw.format === "noema-fractal-library") throw Error("This is a backup of your artworks (My fractals), not a Look backup.");
  if (raw.format !== "noema-look-library") throw Error("Unknown file format: this is not a Look backup.");
  if (raw.version !== 1) throw Error("The version of the Look backup is not supported.");
  if (typeof raw.exportedAt !== "string" || !Array.isArray(raw.records)) throw Error("The Look backup is damaged: it lacks a time or entries.");
}

/**
 * Sorts a Look backup into new, identical, conflicting and invalid records, without reading or writing any library.
 * `existing` holds the records of the library that have the same ids as the file. Import is additive: nothing existing is
 * ever replaced, and one bad record never stops the good ones.
 */
export function classifyLookBackup(raw: unknown, existing: ReadonlyMap<string, LookRecord>): LookImportPlan {
  checkLookEnvelope(raw);
  const plan: LookImportPlan = { fresh: [], identical: [], conflicts: [], invalid: [], exportedAt: raw.exportedAt };
  const seen = new Set<string>();
  raw.records.forEach((item, i) => {
    const label = obj(item) && typeof item.id === "string" ? item.id : `(post ${i + 1})`;
    let record: LookRecord;
    try {
      record = readLookRecord(item);
    } catch (error) {
      plan.invalid.push({ id: label, reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (seen.has(record.id)) {
      plan.invalid.push({ id: record.id, reason: "The id occurs several times in the file." });
      return;
    }
    seen.add(record.id);
    const current = existing.get(record.id);
    if (!current) plan.fresh.push(record);
    else if (canonicalLibraryValue(current.payload) === canonicalLibraryValue(record.payload)) plan.identical.push(record);
    else plan.conflicts.push(record);
  });
  return plan;
}

/** The ids a file claims, so the caller can fetch the matching library records before classifying. */
export function lookBackupIds(raw: unknown): string[] {
  checkLookEnvelope(raw);
  return raw.records.flatMap((r) => (obj(r) && typeof r.id === "string" ? [r.id] : []));
}

export function describeLookImport(plan: LookImportPlan, added: number): string {
  const parts = [`Imported ${added} new Looks`];
  if (plan.identical.length) parts.push(`skipped ${plan.identical.length} that already exist`);
  if (plan.conflicts.length) parts.push(`skipped ${plan.conflicts.length} with the same id but other content (none was overwritten)`);
  if (plan.invalid.length) parts.push(`${plan.invalid.length} invalid: ${plan.invalid.slice(0, 3).map((x) => `${x.id} (${x.reason})`).join("; ")}${plan.invalid.length > 3 ? "; …" : ""}`);
  return parts.join(", ") + ".";
}
