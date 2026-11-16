import { CHAIN_STYLES } from "./randomChain";
import type { ChainStyle } from "./randomChain";
import { collectCredits, parseScene } from "./scene";
import type { CreditEntry, Scene } from "./scene";
import type { Formula } from "./formula/types";

/**
 * Saved presets: a scene with a name and a rating, kept as plain data. The scene inside carries the credits of
 * every formula it uses (CLAUDE.md rule 2), so a preset can be shared without losing who made what. The preset
 * file has its own version; the scene format inside it is unchanged and is checked and migrated by `parseScene`.
 */
export const PRESET_FILE_VERSION = 1;
export const MAX_PRESETS = 200;
export const MAX_PRESET_NAME = 80;
export const RATING_RANGE = [0, 5] as const;

/** How a preset was made, if a generator made it. */
export interface PresetOrigin {
  generator: "random-chain";
  style: ChainStyle;
  seed: number;
  attempt: number;
}

export interface Preset {
  /** Unique within a file. */
  id: string;
  name: string;
  /** 0 = not rated, 1 to 5 stars. */
  rating: number;
  /** When it was saved (ISO 8601 text). */
  created: string;
  origin?: PresetOrigin;
  scene: Scene;
}

export interface PresetFile {
  presets_version: number;
  presets: Preset[];
}

/** A short stable hash of a text, for ids (FNV-1a, 32 bits). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function cleanName(name: string): string {
  const t = name.replace(/\s+/g, " ").trim().slice(0, MAX_PRESET_NAME);
  return t.length > 0 ? t : "Unnamed";
}

function cleanRating(n: number): number {
  return Number.isFinite(n) ? Math.min(RATING_RANGE[1], Math.max(RATING_RANGE[0], Math.round(n))) : 0;
}

/** Makes a preset. The credits of every formula in the scene are filled in, so they travel with it. */
export function createPreset(
  scene: Scene,
  formulas: readonly Formula[],
  info: { name: string; rating?: number; now: Date; origin?: PresetOrigin },
): Preset {
  const credits = collectCredits(scene, formulas);
  const created = info.now.toISOString();
  const withCredits: Scene = { ...scene, ...(credits.length > 0 ? { credits } : {}) };
  return {
    id: hash(created + JSON.stringify(withCredits)),
    name: cleanName(info.name),
    rating: cleanRating(info.rating ?? 0),
    created,
    ...(info.origin ? { origin: info.origin } : {}),
    scene: withCredits,
  };
}

export function withPresetRating(preset: Preset, rating: number): Preset {
  return { ...preset, rating: cleanRating(rating) };
}

export function withPresetName(preset: Preset, name: string): Preset {
  return { ...preset, name: cleanName(name) };
}

/** Highest rating first, then the newest. Does not change the list it is given. */
export function sortPresets(presets: readonly Preset[]): Preset[] {
  return [...presets].sort((a, b) => b.rating - a.rating || (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
}

export function presetsToJson(presets: readonly Preset[]): string {
  const file: PresetFile = { presets_version: PRESET_FILE_VERSION, presets: [...presets] };
  return JSON.stringify(file, null, 2) + "\n";
}

export type PresetParseResult = { ok: true; presets: Preset[]; warnings: string[] } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the credit lines of a scene in a file. `parseScene` leaves them out (they are rebuilt from the library when a scene is saved), but a preset keeps what its file says. */
function readCredits(raw: unknown): CreditEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CreditEntry[] = [];
  for (const c of raw.slice(0, 500)) {
    if (!isObj(c) || typeof c.formula !== "string" || typeof c.text !== "string") continue;
    if (c.kind !== "author" && c.kind !== "source") continue;
    out.push({
      formula: c.formula,
      kind: c.kind,
      text: c.text.slice(0, 500),
      ...(typeof c.url === "string" ? { url: c.url.slice(0, 500) } : {}),
      status: c.status === "verified" ? "verified" : "unverified",
    });
  }
  return out;
}

/** Reads a preset file. Presets that cannot be read are skipped with a warning; the rest are kept. */
export function parsePresets(input: string): PresetParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(input);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!isObj(doc)) return { ok: false, errors: ["a preset file must be a JSON object"] };
  if (doc.presets_version !== PRESET_FILE_VERSION) {
    return { ok: false, errors: [`unknown preset file version ${String(doc.presets_version)}; this program reads version ${PRESET_FILE_VERSION}`] };
  }
  if (!Array.isArray(doc.presets)) return { ok: false, errors: ["presets must be a list"] };

  const warnings: string[] = [];
  const presets: Preset[] = [];
  const seen = new Set<string>();
  doc.presets.slice(0, MAX_PRESETS).forEach((raw, i) => {
    const where = `preset ${i + 1}`;
    if (!isObj(raw)) return void warnings.push(`${where}: not an object, skipped`);
    if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 64) return void warnings.push(`${where}: missing id, skipped`);
    if (seen.has(raw.id)) return void warnings.push(`${where}: the id ${raw.id} is used twice, skipped`);
    if (typeof raw.name !== "string") return void warnings.push(`${where}: missing name, skipped`);
    if (typeof raw.created !== "string" || Number.isNaN(Date.parse(raw.created))) return void warnings.push(`${where}: missing date, skipped`);
    if (typeof raw.rating !== "number") return void warnings.push(`${where}: missing rating, skipped`);
    const scene = parseScene(raw.scene);
    if (!scene.ok) return void warnings.push(`${where}: the scene is not valid (${scene.errors[0]}), skipped`);
    let origin: PresetOrigin | undefined;
    const o = raw.origin;
    if (isObj(o) && o.generator === "random-chain" && (CHAIN_STYLES as readonly unknown[]).includes(o.style) && typeof o.seed === "number" && typeof o.attempt === "number") {
      origin = { generator: "random-chain", style: o.style as ChainStyle, seed: o.seed, attempt: o.attempt };
    }
    seen.add(raw.id);
    const credits = readCredits(isObj(raw.scene) ? raw.scene.credits : undefined);
    presets.push({
      id: raw.id,
      name: cleanName(raw.name),
      rating: cleanRating(raw.rating),
      created: raw.created,
      ...(origin ? { origin } : {}),
      scene: { ...scene.scene, ...(credits.length > 0 ? { credits } : {}) },
    });
  });
  if (doc.presets.length > MAX_PRESETS) warnings.push(`only the first ${MAX_PRESETS} presets were read`);
  return { ok: true, presets, warnings };
}

/** Fills in the credits again from the library (for presets whose file lacked them, or to show the current check status). */
export function withFreshCredits(preset: Preset, formulas: readonly Formula[]): Preset {
  const { credits: _old, ...rest } = preset.scene;
  const credits = collectCredits(preset.scene, formulas);
  return { ...preset, scene: { ...rest, ...(credits.length > 0 ? { credits } : {}) } };
}

/** Adds the presets of an opened file to the ones already kept; a preset whose id exists is not added twice. */
export function mergePresets(existing: readonly Preset[], incoming: readonly Preset[]): Preset[] {
  const ids = new Set(existing.map((p) => p.id));
  const merged = [...existing, ...incoming.filter((p) => !ids.has(p.id))];
  return merged.slice(0, MAX_PRESETS);
}
