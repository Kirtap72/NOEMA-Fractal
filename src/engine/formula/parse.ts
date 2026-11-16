import { FORMULA_CATEGORIES } from "./types";
import type { FormulaCatalog } from "./types";
import { parse as parseYaml } from "yaml";
import { generateChain } from "./chain";
import { RESERVED_NAMES } from "./expression";
import { MAX_PARAMETERS } from "./types";
import { PROVENANCE_COLLECTIONS } from "./types";
import { isKernelId, KERNELS } from "./kernels";
import type { KernelId } from "./kernels";
import type { Credit, Formula, Parameter, Provenance, ProvenanceCollection, Source, Step, VerificationStatus, Variable } from "./types";

export type ParseResult = { ok: true; formula: Formula } | { ok: false; errors: string[] };

const ID = /^[a-z][a-z0-9-]*$/;
const NAME = /^[a-z][a-z0-9_]*$/;
const ASSIGN = /^\s*([a-z][a-z0-9_]*)\s*(\+=|-=|\*=|\/=|=)(?!=)\s*(.+)$/s;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

function status(raw: unknown, where: string, errors: string[]): VerificationStatus {
  if (raw === "verified" || raw === "unverified") return raw;
  errors.push(`${where}: status must be "verified" or "unverified"`);
  return "unverified";
}

function exprText(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return isText(raw) ? raw : undefined;
}

/** Reads the provenance block of a formula reimplemented from Mandelbulb 3D (format 2). */
function readProvenance(raw: unknown, errors: string[]): Provenance | undefined {
  const where = "provenance";
  if (!isObj(raw)) return void errors.push(`${where} must be a mapping`);
  const before = errors.length;
  if (raw.origin !== "mandelbulb3d") errors.push(`${where}.origin must be "mandelbulb3d"`);
  const internal=typeof raw.internal_id==='number'&&Number.isInteger(raw.internal_id)&&raw.internal_id>=0&&raw.internal_id<20;
  if(raw.internal_id!==undefined&&!internal)errors.push(`${where}.internal_id must be a stable built-in ID from 0 to 19`);
  if (!isText(raw.file) || !(internal?/^[^/\\]+\.pas$/i:/^[^/\\]+\.m3f$/i).test(raw.file)) errors.push(`${where}.file must be the original basename (.m3f for external formulas, .pas for explicit internal IDs)`);
  if (!isText(raw.credited_author)) errors.push(`${where}.credited_author is required: the author exactly as the source credits them`);
  if (raw.credited_authors !== undefined && (!Array.isArray(raw.credited_authors) || raw.credited_authors.length === 0 || !raw.credited_authors.every(isText))) errors.push(`${where}.credited_authors must be a nonempty list of source-credited names`);
  if (Array.isArray(raw.credited_authors) && raw.credited_author !== raw.credited_authors.join("; ")) errors.push(`${where}.credited_author must retain the credited_authors names joined with '; '`);
  if (!(PROVENANCE_COLLECTIONS as readonly unknown[]).includes(raw.collection)) errors.push(`${where}.collection must be one of: ${PROVENANCE_COLLECTIONS.join(", ")}`);
  if (!isText(raw.note) || !/independent reimplementation/i.test(raw.note)) errors.push(`${where}.note must say that this is an independent reimplementation of the mathematical formula`);
  if (raw.conditions !== undefined && !isText(raw.conditions)) errors.push(`${where}.conditions must be a text`);
  if (raw.collection === "EM_JIT_M3Formulas" && !isText(raw.conditions)) errors.push(`${where}.conditions is required for EM_JIT_M3Formulas: the collection asks for a clear credit`);
  if (typeof raw.verified_against_mb3d !== "boolean") errors.push(`${where}.verified_against_mb3d must be true or false`);
  if (errors.length > before) return undefined;
  return {
    origin: "mandelbulb3d",
    file: raw.file as string,
    ...(internal?{internalId:raw.internal_id as number}:{}),
    creditedAuthor: raw.credited_author as string,
    ...(Array.isArray(raw.credited_authors) ? { creditedAuthors: raw.credited_authors as string[] } : {}),
    collection: raw.collection as ProvenanceCollection,
    note: (raw.note as string).trim(),
    ...(isText(raw.conditions) ? { conditions: raw.conditions.trim() } : {}),
    verifiedAgainstMb3d: raw.verified_against_mb3d as boolean,
  };
}

/** Reads and checks a formula file (YAML text). Every problem found is reported, not just the first. */
export function parseFormula(text: string): ParseResult {
  const errors: string[] = [];
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    return { ok: false, errors: [`not valid YAML: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!isObj(doc)) return { ok: false, errors: ["the file must contain a YAML mapping (key: value)"] };

  // Format 2 (CLAUDE.md section 10) adds the optional provenance block; a format 1 file is read exactly as before.
  if (doc.format !== 1 && doc.format !== 2 && doc.format !== 3) errors.push("format must be 1, 2 or 3");
  let provenance: Provenance | undefined;
  if (doc.provenance !== undefined) {
    if (doc.format !== 2 && doc.format !== 3) errors.push("provenance requires format: 2 or 3");
    else provenance = readProvenance(doc.provenance, errors);
  }
  if (!(typeof doc.id === "string" && ID.test(doc.id))) errors.push("id is required: lowercase letters, digits and hyphens");
  if (!isText(doc.name)) errors.push("name is required");
  if (!isText(doc.added_by)) errors.push("added_by is required");
  if (!isText(doc.math_status)) errors.push("math_status is required (see LICENSING.md)");
  if (typeof doc.reviewed !== "boolean") errors.push("reviewed must be true or false");

  // --- credits: the author and source must always be present
  const credits: Credit[] = [];
  if (!Array.isArray(doc.credits) || doc.credits.length === 0) {
    errors.push("credits is required: at least one person (use name: okänd if the author is unknown)");
  } else {
    doc.credits.forEach((c: unknown, i: number) => {
      const where = `credits[${i}]`;
      if (!isObj(c) || !isText(c.name)) return void errors.push(`${where}: name is required`);
      credits.push({
        name: c.name,
        ...(isText(c.role) ? { role: c.role } : {}),
        status: status(c.status, where, errors),
      });
    });
  }

  const sources: Source[] = [];
  if (!Array.isArray(doc.sources) || doc.sources.length === 0) {
    errors.push("sources is required: at least one link or reference");
  } else {
    doc.sources.forEach((s: unknown, i: number) => {
      const where = `sources[${i}]`;
      if (!isObj(s)) return void errors.push(`${where}: must be a mapping`);
      if (!isText(s.url) && !isText(s.reference)) return void errors.push(`${where}: give a url or a reference`);
      if (isText(s.url) && !/^https?:\/\/[^\s]+$/.test(s.url)) {
        return void errors.push(`${where}: url must start with http:// or https://`);
      }
      sources.push({
        ...(isText(s.url) ? { url: s.url } : {}),
        ...(isText(s.reference) ? { reference: s.reference } : {}),
        status: status(s.status, where, errors),
      });
    });
  }

  if (doc.reviewed === true && [...credits, ...sources].some((x) => x.status !== "verified")) {
    errors.push('reviewed: true requires every credit and source to have status "verified"');
  }

  // --- parameters
  const parameters: Parameter[] = [];
  const rawParams = doc.parameters ?? [];
  const parameterLimit = isObj(doc.iteration) && isKernelId(doc.iteration.kernel) ? 32 : MAX_PARAMETERS;
  if (!Array.isArray(rawParams)) errors.push("parameters must be a list");
  else if (rawParams.length > parameterLimit) errors.push(`at most ${parameterLimit} parameters are allowed`);
  else {
    const seen = new Set<string>();
    rawParams.forEach((p: unknown, i: number) => {
      const where = `parameters[${i}]`;
      if (!isObj(p)) return void errors.push(`${where}: must be a mapping`);
      const { name, default: def, min, max } = p;
      if (typeof name !== "string" || !NAME.test(name) || RESERVED_NAMES.has(name)) {
        return void errors.push(`${where}: invalid name (lowercase letters, digits, _ ; not a function name)`);
      }
      if (seen.has(name)) return void errors.push(`${where}: duplicate name "${name}"`);
      seen.add(name);
      if (![def, min, max].every((n) => typeof n === "number" && Number.isFinite(n))) {
        return void errors.push(`${where}: default, min and max must be numbers`);
      }
      if (!((min as number) <= (def as number) && (def as number) <= (max as number))) {
        return void errors.push(`${where}: need min <= default <= max`);
      }
      parameters.push({
        name,
        ...(isText(p.label) ? { label: p.label } : {}),
        default: def as number,
        min: min as number,
        max: max as number,
      });
    });
  }

  // --- iteration
  const iteration = doc.iteration;
  const variables: Variable[] = [];
  const steps: Step[] = [];
  let iterations = 0;
  let distance: string | undefined;
  let orbitPoint: string | undefined;
  let carry: string[] = [];
  let kernel: KernelId | undefined;
  if (!isObj(iteration)) {
    errors.push("iteration is required");
  } else {
    iterations = iteration.iterations as number;
    if (doc.format === 3 && iteration.kernel === undefined) errors.push("format: 3 requires iteration.kernel; expression formulas keep format 1 or 2");
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 64) {
      errors.push("iteration.iterations must be a whole number from 1 to 64");
    }
    if (iteration.kernel !== undefined) {
      if (doc.format !== 3) errors.push("iteration.kernel requires format: 3");
      if (!isKernelId(iteration.kernel)) errors.push("iteration.kernel must name a registered engine kernel");
      else {
        kernel = iteration.kernel;
        const expected = KERNELS[kernel].parameters.map(p => p.name);
        if (expected.length !== parameters.length || expected.some((name, i) => parameters[i]?.name !== name)) errors.push("kernel parameters must match the registered names and order");
      }
      for (const field of ["variables", "steps", "distance", "carry", "orbit_point"]) {
        if (iteration[field] !== undefined) errors.push("iteration." + field + " cannot override a registered kernel");
      }
    } else {
    const taken = new Set(parameters.map((p) => p.name));
    if (!Array.isArray(iteration.variables)) errors.push("iteration.variables must be a list");
    else {
      iteration.variables.forEach((v: unknown, i: number) => {
        const where = `iteration.variables[${i}]`;
        if (!isObj(v)) return void errors.push(`${where}: must be a mapping`);
        const init = exprText(v.init);
        if (typeof v.name !== "string" || !NAME.test(v.name) || RESERVED_NAMES.has(v.name) || taken.has(v.name)) {
          return void errors.push(`${where}: invalid or duplicate name`);
        }
        if (v.type !== "float" && v.type !== "vec3" && v.type !== "vec4") return void errors.push(`${where}: type must be float, vec3 or vec4`);
        if (init === undefined) return void errors.push(`${where}: init is required`);
        taken.add(v.name);
        variables.push({ name: v.name, type: v.type, init });
      });
    }
    if (!Array.isArray(iteration.steps)) errors.push("iteration.steps must be a list");
    else {
      iteration.steps.forEach((s: unknown, i: number) => {
        const where = `iteration.steps[${i}]`;
        if (typeof s === "string") {
          const m = ASSIGN.exec(s);
          if (!m) return void errors.push(`${where}: write steps as "name = expression"`);
          steps.push({ kind: "assign", target: m[1]!, op: m[2] as "=", expr: m[3]!.trim() });
        } else if (isObj(s) && isText(s.break_if)) {
          steps.push({ kind: "break_if", expr: s.break_if });
        } else {
          errors.push(`${where}: must be "name = expression" or { break_if: condition }`);
        }
      });
    }
    if (iteration.orbit_point !== undefined) {
      const op = iteration.orbit_point;
      const v = variables.find((x) => x.name === op);
      if (!v || v.type === "float") errors.push("iteration.orbit_point must name a declared vec3 or vec4 variable");
      else orbitPoint = v.name;
    } else {
      orbitPoint = variables.find((x) => x.type !== "float")?.name;
    }
    if (iteration.carry !== undefined) {
      const c = iteration.carry;
      if (!Array.isArray(c) || !c.every((n) => typeof n === "string" && variables.some((v) => v.name === n))) {
        errors.push("iteration.carry must be a list of declared variable names");
      } else carry = [...new Set(c as string[])];
    } else if (orbitPoint !== undefined) {
      carry = [orbitPoint]; // older files: only the point itself is passed on
    }
    if (iteration.distance !== undefined) {
      const d = exprText(iteration.distance);
      if (d === undefined) errors.push("iteration.distance must be an expression");
      else distance = d;
    }
    }
  }

  let cameraDistance: number | undefined;
  if (doc.view !== undefined) {
    const cd = isObj(doc.view) ? doc.view.camera_distance : undefined;
    if (typeof cd === "number" && cd >= 1.5 && cd <= 20) cameraDistance = cd;
    else errors.push("view.camera_distance must be a number from 1.5 to 20");
  }

  if (errors.length > 0) return { ok: false, errors };

  let catalog: FormulaCatalog | undefined;
  if (doc.catalog !== undefined) {
    const raw = doc.catalog;
    if (!isObj(raw)) return { ok: false, errors: ["catalog must be an object"] };
    catalog = {};
    if (raw.category !== undefined) {
      if (!FORMULA_CATEGORIES.includes(raw.category as never))
        return { ok: false, errors: ["catalog.category is unknown"] };
      catalog.category = raw.category as NonNullable<FormulaCatalog["category"]>;
    }
    if (raw.dimension !== undefined) {
      if (raw.dimension !== 3 && raw.dimension !== 4)
        return { ok: false, errors: ["catalog.dimension must be 3 or 4"] };
      catalog.dimension = raw.dimension;
    }
    if (raw.family !== undefined) {
      if (!isText(raw.family) || raw.family.length > 160)
        return { ok: false, errors: ["catalog.family must be a short nonempty string"] };
      catalog.family = raw.family.trim();
    }
    if (raw.tags !== undefined) {
      if (!Array.isArray(raw.tags) || raw.tags.length > 24 ||
          raw.tags.some((t: unknown) => !isText(t) || (t as string).length > 80))
        return { ok: false, errors: ["catalog.tags must be a list of up to 24 short strings"] };
      catalog.tags = [...new Set(raw.tags.map((t: string) => t.trim()))];
    }
  }

  const formula: Formula = {
      id: doc.id as string,
      ...(kernel ? { kernel } : {}),
      name: doc.name as string,
      ...(catalog ? { catalog } : {}),
      ...(isText(doc.description) ? { description: doc.description.trim() } : {}),
      credits,
      sources,
      addedBy: doc.added_by as string,
      mathStatus: doc.math_status as string,
      reviewed: doc.reviewed as boolean,
      parameters,
      iterations,
      variables,
      steps,
      ...(distance !== undefined ? { distance } : {}),
      ...(orbitPoint !== undefined ? { orbitPoint } : {}),
      carry,
      ...(cameraDistance !== undefined ? { cameraDistance } : {}),
      ...(provenance ? { provenance } : {}),
  };
  // Check the expressions now, so mistakes are reported when the file is read.
  // Registered helpers contain no expressions to validate and intentionally cannot
  // execute alone. Validate their host compatibility when the real chain is built.
  if (!kernel || !KERNELS[kernel].role) {
    const check = generateChain([{ formula, iterations }], 1, { allowNoDistance: true });
    if (!check.ok) return { ok: false, errors: check.errors };
  }
  return { ok: true, formula };
}
