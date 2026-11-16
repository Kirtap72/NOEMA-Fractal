import { parseFormula } from "./formula/parse";
import type { Formula } from "./formula/types";
import { parseFormulaRecord, recordMatches } from "./formulaFilter";
import type { FormulaRecord } from "./formulaFilter";

/**
 * A collection of saved formulas (ARCHITECTURE.md 8.21, decision 3 and section 8.1): one JSON file that holds, for
 * each formula, the text of its formula file, its measurement record and its thumbnail, so that others can take part.
 * The file has its own version. Everything in it is data: every formula text is checked by the ordinary formula
 * reader (credits are required), every record field by field, and every thumbnail must be a small PNG data address.
 * The owner's ratings and choices are left out unless asked for (8.21 section 8.1).
 */
export const COLLECTION_VERSION = 1;
export const MAX_COLLECTION_FORMULAS = 500;
export const MAX_THUMBNAIL_LENGTH = 300_000;
const PNG_ADDRESS = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export interface SavedFormula {
  /** The formula file's text (format 1). */
  text: string;
  record?: FormulaRecord;
  /** A PNG data address, 160 x 120. */
  thumbnail?: string;
}

/** One choice the owner made in the grid: the formula picked over the others shown (8.21 section 8.1 c). */
export interface ChoiceEvent {
  chosen: string;
  over: string[];
  kind: "implicit" | "rating";
  at: string;
}

export interface FormulaCollection {
  collection_version: number;
  formulas: SavedFormula[];
  choices?: ChoiceEvent[];
}

/** The collection as text. Ratings and choices are removed unless `includeRatings` is set. */
export function collectionToJson(formulas: readonly SavedFormula[], options: { includeRatings: boolean; choices?: readonly ChoiceEvent[] }): string {
  const out: FormulaCollection = {
    collection_version: COLLECTION_VERSION,
    formulas: formulas.map((f) => ({
      text: f.text,
      ...(f.record ? { record: options.includeRatings ? f.record : { ...f.record, rating: { value: null } } } : {}),
      ...(f.thumbnail ? { thumbnail: f.thumbnail } : {}),
    })),
    ...(options.includeRatings && options.choices && options.choices.length > 0 ? { choices: [...options.choices] } : {}),
  };
  return JSON.stringify(out, null, 1) + "\n";
}

export interface ReadFormula extends SavedFormula {
  formula: Formula;
}

export type CollectionParseResult = { ok: true; formulas: ReadFormula[]; choices: ChoiceEvent[]; warnings: string[] } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads a collection file (untrusted). Formulas that cannot be read are skipped with a warning; the rest are kept. */
export function parseCollection(text: string): CollectionParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!isObj(doc)) return { ok: false, errors: ["a collection must be a JSON object"] };
  if (doc.collection_version !== COLLECTION_VERSION) return { ok: false, errors: [`unknown collection version ${String(doc.collection_version)}; this program reads version ${COLLECTION_VERSION}`] };
  if (!Array.isArray(doc.formulas)) return { ok: false, errors: ["formulas must be a list"] };
  const warnings: string[] = [];
  const formulas: ReadFormula[] = [];
  const ids = new Set<string>();
  doc.formulas.slice(0, MAX_COLLECTION_FORMULAS).forEach((raw, i) => {
    const where = `formula ${i + 1}`;
    if (!isObj(raw) || typeof raw.text !== "string") return void warnings.push(`${where}: no formula text, skipped`);
    const parsed = parseFormula(raw.text);
    if (!parsed.ok) return void warnings.push(`${where}: not a valid formula (${parsed.errors[0]}), skipped`);
    const formula = parsed.formula;
    if (ids.has(formula.id)) return void warnings.push(`${where}: the id ${formula.id} is used twice, skipped`);
    ids.add(formula.id);
    const entry: ReadFormula = { text: raw.text, formula };
    if (raw.record !== undefined) {
      const r = parseFormulaRecord(JSON.stringify(raw.record));
      if (!r.ok) warnings.push(`${where}: the measurement record was left out (${r.error})`);
      else if (r.record.formula_id !== formula.id || !recordMatches(r.record, raw.text)) warnings.push(`${where}: the measurement record belongs to another formula and was left out`);
      else entry.record = r.record;
    }
    if (raw.thumbnail !== undefined) {
      if (typeof raw.thumbnail === "string" && raw.thumbnail.length <= MAX_THUMBNAIL_LENGTH && PNG_ADDRESS.test(raw.thumbnail)) entry.thumbnail = raw.thumbnail;
      else warnings.push(`${where}: the thumbnail was left out (it must be a PNG data address of at most ${MAX_THUMBNAIL_LENGTH} characters)`);
    }
    formulas.push(entry);
  });
  if (doc.formulas.length > MAX_COLLECTION_FORMULAS) warnings.push(`only the first ${MAX_COLLECTION_FORMULAS} formulas were read`);
  const choices: ChoiceEvent[] = [];
  if (Array.isArray(doc.choices)) {
    for (const c of doc.choices.slice(0, 10000)) {
      if (!isObj(c) || typeof c.chosen !== "string" || !Array.isArray(c.over) || !c.over.every((x) => typeof x === "string")) continue;
      if (c.kind !== "implicit" && c.kind !== "rating") continue;
      if (typeof c.at !== "string" || Number.isNaN(Date.parse(c.at))) continue;
      choices.push({ chosen: c.chosen.slice(0, 100), over: (c.over as string[]).slice(0, 20).map((x) => x.slice(0, 100)), kind: c.kind, at: c.at });
    }
  }
  return { ok: true, formulas, choices, warnings };
}

/** Makes a choice event when the owner picks one formula among others shown. */
export function choiceOf(chosen: string, shown: readonly string[], now: Date, kind: ChoiceEvent["kind"] = "implicit"): ChoiceEvent {
  return { chosen, over: shown.filter((id) => id !== chosen), kind, at: now.toISOString() };
}
