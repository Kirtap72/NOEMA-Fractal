/**
 * FORMULA-IMPORTER-01: the whole import of one .m3f file, with the four stages kept apart:
 *   1. classification + parsing      (is it readable JIT source, and does it fit the supported subset?)
 *   2. compilation                    (does NOEMA's own formula parser and chain generator accept the translated document?)
 *   3. mathematical validation        (does the NOEMA formula, run on the processor, give the same numbers as an independent
 *                                      interpreter of the original syntax tree, on random points and option values?)
 *   4. rendering                      (never decided here: it needs the graphics card; a GPU run reports it separately)
 * A file that fails any stage is rejected with the stage and the reason. Nothing is ever replaced by a similar formula.
 */
import { parse as yamlParse, stringify } from 'yaml';
import { parseFormula } from '../../engine/formula/parse';
import { compileChainCpu } from '../../engine/formula/cpu';
import { generateChain } from '../../engine/formula/chain';
import type { ChainStep } from '../../engine/formula/chain';
import type { Formula } from '../../engine/formula/types';
import { readM3f } from './m3fFile';
import type { M3fFile } from './m3fFile';
import { parseJit } from './pascalJit';
import { runJit } from './jitInterpreter';
import { translateJit } from './jitToFormula';
import type { TranslateSettings } from './jitToFormula';
import type { ParameterMap } from './jitToFormula';

export type Stage = 'classification' | 'parsing' | 'translation' | 'compilation' | 'validation';
export interface ValidationNumbers { points: number; comparisons: number; skippedInvalid: number; maxRelativeError: number }
export interface ImportReport {
  fileName: string;
  sha256: string;
  kind: M3fFile['kind'];
  status: 'imported' | 'rejected';
  /** Where it stopped (rejected) or 'validation' (imported). */
  stage: Stage;
  reasons: string[];
  /** Host settings and option names that were read but have no effect on the translation (always listed, never silently dropped). */
  notes: string[];
  id?: string;
  formulaText?: string;
  formula?: Formula;
  parameters?: ParameterMap[];
  validation?: ValidationNumbers;
  /** A JIT formula has no distance estimate of its own: it is a transform and cannot be drawn alone. */
  drawnAlone: false;
  rendering: 'not-run';
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PROBE = (axis: 'x' | 'y' | 'z' | 'w'): string => axis === 'w' ? `format: 1
id: importer-probe-w
name: Probe w
description: Test helper that reports the fourth coordinate of the carried 4D point as its distance.
credits:
  - { name: NOEMA, status: unverified }
sources:
  - { reference: "internal test helper", status: unverified }
added_by: NOEMA importer self-test
math_status: Test helper, no mathematical claim.
reviewed: false
iteration:
  iterations: 1
  carry: [q, dr]
  variables:
    - { name: q, type: vec4, init: "vec4(pos.x, pos.y, pos.z, 0.0)" }
    - { name: dr, type: float, init: 1 }
  steps:
    - "dr = dr * 1.0"
  distance: "q.w"
` : axis === 'x' || axis === 'y' || axis === 'z' ? `format: 1
id: importer-probe-${axis}
name: Probe ${axis}
description: Test helper that reports one coordinate of the carried point as its distance.
credits:
  - { name: NOEMA, status: unverified }
sources:
  - { reference: "internal test helper", status: unverified }
added_by: NOEMA importer self-test
math_status: Test helper, no mathematical claim.
reviewed: false
iteration:
  iterations: 1
  carry: [z, dr]
  variables:
    - { name: z, type: vec3, init: pos }
    - { name: dr, type: float, init: 1 }
  steps:
    - "dr = dr * 1.0"
  distance: "z.${axis}"
` : '';
/** The 4D probes read q.x, q.y, q.z, q.w of the carried vec4 (same carried name as the translated 4D formula). */
const PROBE4 = (axis: 'x' | 'y' | 'z' | 'w'): string => PROBE('w').replace('id: importer-probe-w', `id: importer-probe4-${axis}`).replace('distance: "q.w"', `distance: "q.${axis}"`);
const probeCache = new Map<string, Formula[]>();
function probeFormulas(fourD: boolean): Formula[] {
  const key = fourD ? '4' : '3';
  if (!probeCache.has(key)) probeCache.set(key, (fourD ? (['x', 'y', 'z', 'w'] as const).map((a) => PROBE4(a)) : (['x', 'y', 'z'] as const).map((a) => PROBE(a))).map((src) => { const r = parseFormula(src); if (!r.ok) throw new Error('internal probe formula is invalid: ' + r.errors.join('; ')); return r.formula; }));
  return probeCache.get(key)!;
}

/**
 * Imported formulas saved by the first generation carry an escape test and a bailout parameter. A transform has no distance estimate, so that test
 * stopped whole chains with the distance 0 (far points looked like surface). This removes both from a saved private formula when it is loaded;
 * nothing else changes, and the original file is not needed.
 */
export function migrateImportedText(text: string): string {
  let doc: any; try { doc = yamlParse(text); } catch { return text; }
  if (!doc?.catalog?.tags?.includes?.('importerad') || !Array.isArray(doc.iteration?.steps)) return text;
  const steps = doc.iteration.steps.filter((s: any) => !(s && typeof s === 'object' && 'break_if' in s && /bailout_squared/.test(String(s.break_if))));
  const params = (doc.parameters ?? []).filter((p: any) => p.name !== 'bailout_squared');
  if (steps.length === doc.iteration.steps.length && params.length === (doc.parameters ?? []).length) return text;
  doc.iteration.steps = steps; doc.parameters = params;
  return stringify(doc, { lineWidth: 0 });
}

/** Deterministic pseudo-random numbers, so the validation can be repeated exactly. */
function rng(seed: number): () => number { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

export async function importM3f(text: string, fileName: string, library: readonly Formula[] = [], settings: TranslateSettings = {}): Promise<ImportReport> {
  const sha256 = await sha256Hex(text);
  const base = { fileName, sha256, drawnAlone: false as const, rendering: 'not-run' as const };
  const reject = (kind: M3fFile['kind'], stage: Stage, reasons: string[], notes: string[] = []): ImportReport => ({ ...base, kind, status: 'rejected', stage, reasons, notes });
  const file = readM3f(text);
  if (file.kind !== 'jit-source') return reject(file.kind, 'classification', [file.reason]);

  const optionTypes = new Map<string, 'real' | 'int'>(file.options.map((o) => [o.name.toLowerCase(), o.type === 'Integer' ? 'int' : 'real']));
  const constants = new Map<string, number>();
  for (const c of file.constants) {
    if (c.type !== 'Double' || !Number.isFinite(c.value)) return reject('jit-source', 'parsing', [`The constant "${c.name}" has the type ${c.type} or no number as value: only Double constants are supported.`]);
    if (optionTypes.has(c.name.toLowerCase())) return reject('jit-source', 'parsing', [`The name "${c.name}" is declared both as an option and as a constant.`]);
    constants.set(c.name.toLowerCase(), c.value);
  }
  const parsed = parseJit(file.source!, optionTypes, constants);
  if (!parsed.ok) return reject('jit-source', 'parsing', parsed.errors.map((e) => (e.line ? `line ${e.line}: ` : '') + e.message));

  const displayName = fileName.replace(/\.m3f$/i, '').replace(/^.*[\\/]/, '');
  const notes: string[] = [];
  const hostIgnored = file.host.filter((h) => !['Version', 'SIPow', 'SIpower'].includes(h.name));
  if (hostIgnored.length) notes.push(`Host settings not translated (a JIT formula has no distance estimate of its own): ${hostIgnored.map((h) => `${h.name}=${h.value}`).join(', ')}.`);
  if (parsed.program.usesW) notes.push('The result is a 4D transform: w is a genuine fourth coordinate, carried as the vec4 q (it starts at the start_w slice). It has no distance estimate; put it in an ordinary chain in front of a 4D formula that carries q, such as the quaternion formulas. In front of a 3D formula it has no effect, and it cannot be a helper in a grouped execution.');
  else notes.push('The result is a transform: it changes the point and has no distance estimate. Put it in front of a formula that has one.');

  const t = translateJit(parsed.program, file.options, { fileName, sha256, displayName }, settings);
  if (!t.ok) return reject('jit-source', 'translation', t.errors, notes);
  if (library.some((f) => f.id === t.id)) return reject('jit-source', 'translation', [`The id ${t.id} already exists in the library: a second import of the same name must be removed first.`], notes);

  const doc = parseFormula(t.text);
  if (!doc.ok) return reject('jit-source', 'compilation', ['NOEMA\'s formula parser rejected the translated document: ' + doc.errors.join('; ')], notes);
  const formula = doc.formula;
  const fourD = parsed.program.usesW;
  const probe = probeFormulas(fourD);
  const startWIndex = formula.parameters.findIndex((p) => p.name === 'start_w');
  const steps = (p: Formula): ChainStep[] => [{ formula, iterations: 1 }, { formula: p, iterations: 1 }];
  const chain = generateChain(steps(probe[0]!), 1);
  if (!chain.ok) return reject('jit-source', 'compilation', ['The chain generator rejected the translated formula: ' + chain.errors.join('; ')], notes);

  // mathematical validation against the independent interpreter
  const random = rng(0x5eed1234);
  const dims = fourD ? 4 : 3;
  const runs = Array.from({ length: dims }, (_, i) => compileChainCpu(steps(probe[i]!), 1));
  const optionNames = file.options.map((o) => o.name.toLowerCase());
  const bailoutIndex = formula.parameters.findIndex((p) => p.name === 'bailout_squared');
  let comparisons = 0, skipped = 0, maxRel = 0; const points = 40, variants = 6;
  for (let v = 0; v < variants; v++) {
    const values = file.options.map((o, i) => (v === 0 ? o.value : o.value + (random() - 0.5) * Math.max(0.5, Math.abs(o.value)) * 0.6));
    const params = formula.parameters.map((p, i) => (p.name === 'bailout_squared' ? 1e6 : values[i] ?? p.default));
    void bailoutIndex;
    const optionMap = new Map(optionNames.map((n, i) => [n, values[i]!] as const));
    for (let k = 0; k < points; k++) {
      const point = [(random() - 0.5) * 3, (random() - 0.5) * 3, (random() - 0.5) * 3] as const;
      const startW = fourD ? (random() - 0.5) * 2 : 0;
      const pk = startWIndex >= 0 ? params.map((x, i) => (i === startWIndex ? startW : x)) : params;
      const ref = runJit(parsed.program, { x: point[0], y: point[1], z: point[2], w: startW }, { options: optionMap, c: point });
      const got = runs.map((r) => r(point, pk).dist);
      if (ref.invalid || !got.every(Number.isFinite) || Math.max(Math.abs(ref.x), Math.abs(ref.y), Math.abs(ref.z), fourD ? Math.abs(ref.w) : 0) > 1e2 || (fourD && !Number.isFinite(ref.w))) { skipped++; continue; }
      const want = fourD ? [ref.x, ref.y, ref.z, ref.w] : [ref.x, ref.y, ref.z];
      for (let i = 0; i < dims; i++) { const rel = Math.abs(got[i]! - want[i]!) / (1 + Math.abs(want[i]!)); maxRel = Math.max(maxRel, rel); comparisons++; }
    }
  }
  const validation: ValidationNumbers = { points: points * variants, comparisons, skippedInvalid: skipped, maxRelativeError: maxRel };
  if (comparisons < 30) return reject('jit-source', 'validation', [`Too few comparable points (${comparisons}) to validate the translation: the formula is invalid or explodes for almost every input.`], notes);
  if (maxRel > 1e-8) return reject('jit-source', 'validation', [`The translation disagrees with the independent interpreter (largest relative difference ${maxRel.toExponential(2)}).`], notes);
  return { ...base, kind: 'jit-source', status: 'imported', stage: 'validation', reasons: [], notes, id: t.id, formulaText: t.text, formula, parameters: t.parameters, validation };
}
