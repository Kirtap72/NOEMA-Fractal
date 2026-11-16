/**
 * Artist knowledge base (ARTIST-KNOWLEDGE-BASE-01): the versioned, local, searchable records behind noema_search_knowledge,
 * noema_get_knowledge and noema_check_chain. It extends the formula atlas (atlas.json) instead of replacing it.
 *
 * Files (src/knowledge/kb/*.json, built by tools/knowledge/build-kb.mjs from measured data and curated findings):
 *   meta, sources, findings (fact | observed | hypothesis | reference | gap), formulas (one profile per library formula),
 *   experiments (measured previews and refusals), relations (formula classes, corpus pairs), cases (frequent chain signatures).
 * Everything is guidance. Every record states what kind of knowledge it is and how sure it is; AI opinions never become facts here
 * (they stay in the experiment memory until a person reviews them, see tools/knowledge/promote-experiments.mjs).
 */
import { isImportedHelperCapable } from '../engine/formula/importedHelper';
import meta from './kb/meta.json';
import sources from './kb/sources.json';
import findings from './kb/findings.json';
import formulas from './kb/formulas.json';
import experiments from './kb/experiments.json';
import relations from './kb/relations.json';
import cases from './kb/cases.json';
import { kernelChainErrors } from '../engine/formula/kernelChain';
import { boundedSequenceErrors, mappedFieldErrors } from '../engine/formula/groupExecution';
import type { BoundedSequenceExecution, MappedFieldExecution } from '../engine/formula/groupExecution';
import { independentFieldErrors } from '../engine/formula/independentField';
import type { IndependentFieldExecution } from '../engine/formula/groupExecution';
import type { ChainMode } from '../engine/formula/chain';
import type { Formula } from '../engine/formula/types';

export const KB_VERSION: number = meta.version;
export interface KbFinding { id: string; kind: string; confidence: string; topic: string; tags: string[]; text: string; evidence: string[]; sources: string[]; test?: string }
export interface KbFormula { id: string; name: string; class: string; execution: string; role: string | null; distanceModel: string | null; dimension: number; category: string | null; tags: string[]; parameters: { name: string; min: number; max: number; default: number }[]; credit: string[]; usage?: { artistCorpus: { uses: number; first: number; last: number; of: number }; publicSet: { uses: number; of: number }; legacyNames: string[] }; legacyParameterRanges?: unknown; findings?: string[] }
export interface KbExperiment { id: string; kind: string; group: string; variable: string; versus?: string | null; chain?: { rounds: number; steps: { formula: string; iterations: number }[] }; cameraDolly?: number; framingValid?: boolean; metrics?: { objectShare: number; edgeDensity: number; brightness: number; renderMs: number }; image?: string; reason?: string }
export interface KbCase { id: string; source: string; signature: string; noemaIds: (string | null)[]; occurrences: number; of: number; mode: string; juliaSharePercent?: number; medianIterations?: number[]; bridge?: { runnable: boolean; reason: string }; lesson: string }
export interface Kb { meta: typeof meta; sources: typeof sources; findings: KbFinding[]; formulas: KbFormula[]; experiments: KbExperiment[]; relations: typeof relations; cases: KbCase[] }

export const KB: Kb = { meta, sources, findings: findings as KbFinding[], formulas: formulas as unknown as KbFormula[], experiments: experiments as KbExperiment[], relations, cases: cases as KbCase[] };

const FINDING_KINDS = ['fact', 'observed', 'hypothesis', 'reference', 'gap'];
const CONFIDENCE = ['verifierad', 'hög', 'medel', 'låg'];

/**
 * Integrity of a knowledge base: unique stable ids, known kinds and confidence levels, resolvable evidence and sources, provenance for
 * every reference, no private markers. Returns readable problems (empty = valid). Run by the tests and by build-kb.
 */
export function validateKb(kb: Kb = KB): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const unique = (id: string, what: string): void => { if (ids.has(id)) problems.push(`duplicate id ${id} (${what})`); ids.add(id); };
  const sourceIds = new Set(kb.sources.map((s) => s.id));
  kb.sources.forEach((s) => { unique(s.id, 'source'); if (!s.terms || !s.retrieved) problems.push(`${s.id}: source needs terms and retrieval date`); if (s.type !== 'private-corpus' && s.type !== 'experiment' && s.type !== 'software' && !/^https:\/\//.test(s.url)) problems.push(`${s.id}: public source needs an https URL`); });
  kb.formulas.forEach((f) => unique(f.id, 'formula'));
  kb.experiments.forEach((e) => unique(e.id, 'experiment'));
  kb.cases.forEach((c) => unique(c.id, 'case'));
  kb.findings.forEach((f) => {
    unique(f.id, 'finding');
    if (!FINDING_KINDS.includes(f.kind)) problems.push(`${f.id}: unknown kind ${f.kind}`);
    if (!CONFIDENCE.includes(f.confidence)) problems.push(`${f.id}: unknown confidence ${f.confidence}`);
    if (f.kind === 'hypothesis' && f.confidence !== 'låg') problems.push(`${f.id}: a hypothesis must have confidence låg`);
    if (f.kind === 'fact' && f.confidence !== 'verifierad') problems.push(`${f.id}: a fact must be verifierad`);
    if (!f.sources.length) problems.push(`${f.id}: needs at least one source`);
    f.sources.forEach((s) => { if (!sourceIds.has(s)) problems.push(`${f.id}: unknown source ${s}`); });
    if (!f.evidence.length) problems.push(`${f.id}: needs evidence`);
  });
  const known = new Set([...ids]);
  kb.findings.forEach((f) => f.evidence.forEach((ev) => {
    if (ev.startsWith('exp:')) { if (!known.has(ev)) problems.push(`${f.id}: evidence ${ev} does not exist`); }
    else if (/^(F|H|GAP)-/.test(ev)) { if (!known.has(ev)) problems.push(`${f.id}: evidence ${ev} does not exist`); }
  }));
  kb.cases.forEach((c) => { if (!sourceIds.has(c.source)) problems.push(`${c.id}: unknown source ${c.source}`); });
  kb.experiments.forEach((e) => { if (e.versus && !known.has(e.versus)) problems.push(`${e.id}: versus ${e.versus} does not exist`); });
  // sources may NAME a file format; the records themselves must not contain private paths, preset file names or image data
  const text = JSON.stringify([kb.findings, kb.formulas, kb.experiments, kb.relations, kb.cases]);
  if (/[A-Za-z]:[\\/](?:Users|fraktalprogram)|\.m3p\b|data:image|"base64"/i.test(text)) problems.push('private markers (paths, file names, image data) found in the knowledge base');
  return problems;
}

/** Brings an older knowledge document to the current shape. Version 1 was the atlas alone: it has no kb files, so the result is empty. */
export function migrateKb(raw: { version?: number; format?: string }): { version: number; migrated: boolean; note: string } {
  if (raw?.version === KB_VERSION && raw.format === 'noema-knowledge-base') return { version: KB_VERSION, migrated: false, note: 'current' };
  if (raw?.format === 'noema-formula-atlas' && raw.version === 1) return { version: KB_VERSION, migrated: true, note: 'atlas v1 kept as is; knowledge base v2 added beside it' };
  throw new Error(`Unknown knowledge version: ${String(raw?.version)}`);
}

const words = (q: string): string[] => q.toLowerCase().split(/[^\p{L}\p{N}_*+.-]+/u).filter((w) => w.length > 1).slice(0, 8);
const score = (hay: string, ws: string[]): number => { let s = 0; for (const w of ws) if (hay.includes(w)) s++; return ws.length ? s / ws.length : 0; };
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export interface KbHit { kind: string; id: string; confidence: string; text: string; [k: string]: unknown }
const KIND_OF: Record<string, string> = { observed: 'observation' };

/** Search over findings, cases, measured trials and relations. Formula profiles are returned through the formula kind in knowledge.ts. */
export function searchKb(query: string, wantKinds: readonly string[] | undefined, limit: number): { s: number; hit: KbHit }[] {
  const ws = words(query);
  const want = (k: string): boolean => !wantKinds || wantKinds.length === 0 || wantKinds.includes(k);
  const out: { s: number; hit: KbHit }[] = [];
  for (const f of KB.findings) {
    const kind = KIND_OF[f.kind] ?? f.kind;
    if (!want(kind)) continue;
    const s = score(`${f.id} ${f.topic} ${f.tags.join(' ')} ${f.text}`.toLowerCase(), ws);
    if (s > 0) out.push({ s: s + (f.kind === 'fact' ? 0.06 : 0.04), hit: { kind, id: f.id, confidence: f.confidence, text: clip(f.text, 520), evidence: f.evidence.slice(0, 4), ...(f.test ? { test: clip(f.test, 160) } : {}) } });
  }
  if (want('case')) for (const c of KB.cases) {
    const s = score(`${c.signature} ${c.noemaIds.join(' ')} ${c.lesson}`.toLowerCase(), ws);
    if (s > 0) out.push({ s: s + 0.01, hit: { kind: 'case', id: c.id, confidence: 'mätt (antal i samlingen)', text: clip(`${c.signature} – ${c.occurrences} av ${c.of} verk (${c.mode}). ${c.lesson}`, 420), bridgeRunnable: c.bridge?.runnable ?? null } });
  }
  if (want('trial')) for (const e of KB.experiments) {
    const text = e.kind === 'refusal' ? `${e.variable}: nekades av motorn – ${e.reason}` : `${e.variable}: ${e.chain?.steps.map((x) => `${x.formula}*${x.iterations}`).join(' > ')} (varv ${e.chain?.rounds}, kamera ${e.cameraDolly}) → objekt ${e.metrics?.objectShare}, finstruktur ${e.metrics?.edgeDensity}, ljushet ${e.metrics?.brightness}${e.framingValid === false ? ' [kameran fel för denna formel]' : ''}`;
    const s = score(`${e.id} ${e.group} ${text}`.toLowerCase(), ws);
    if (s > 0) out.push({ s, hit: { kind: 'trial', id: e.id, confidence: e.kind === 'refusal' ? 'verifierad (motorn nekade)' : 'mätt', text: clip(text, 420) } });
  }
  if (want('relation')) {
    const r = KB.relations.formulaClasses;
    const s = score(`${r.rule} ${Object.keys(r.meaning).join(' ')} ${Object.values(r.meaning).join(' ')} klass kompatibel blanda`.toLowerCase(), ws);
    if (s > 0) out.push({ s: s + 0.02, hit: { kind: 'relation', id: 'rel-formula-classes', confidence: 'verifierad', text: clip(`${r.rule} Klasser: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}.`, 420) } });
  }
  return out.sort((a, b) => b.s - a.s || a.hit.id.localeCompare(b.hit.id)).slice(0, Math.max(limit * 2, 6));
}

export function profileOf(id: string): KbFormula | undefined { return KB.formulas.find((f) => f.id === id); }

/** The full record for one id (kept to a few thousand characters). */
export function getRecord(id: string): { kind: string; record: unknown } | null {
  const f = KB.findings.find((x) => x.id === id);
  if (f) return { kind: 'finding', record: { ...f, evidenceDetail: f.evidence.filter((e) => e.startsWith('exp:')).slice(0, 8).map((e) => { const x = KB.experiments.find((y) => y.id === e); return x ? { id: x.id, variable: x.variable, metrics: x.metrics, chain: x.chain?.steps.map((s) => s.formula).join(' > '), reason: x.reason } : { id: e }; }), sourceDetail: f.sources.map((s) => KB.sources.find((y) => y.id === s)).filter(Boolean).map((s) => ({ id: s!.id, title: s!.title, url: s!.url, terms: s!.terms, confidence: s!.confidence })) } };
  const p = profileOf(id);
  if (p) return { kind: 'formula', record: { ...p, findingTexts: (p.findings ?? []).slice(0, 4).map((fid) => { const x = KB.findings.find((y) => y.id === fid); return x ? { id: x.id, confidence: x.confidence, text: clip(x.text, 300) } : { id: fid }; }) } };
  const e = KB.experiments.find((x) => x.id === id || x.id === 'exp:' + id);
  if (e) return { kind: 'trial', record: e };
  const c = KB.cases.find((x) => x.id === id);
  if (c) return { kind: 'case', record: c };
  const s = KB.sources.find((x) => x.id === id);
  if (s) return { kind: 'source', record: s };
  return null;
}

export interface ChainCheck {
  /** The AI draft tools can build this chain and the renderer runs it as a plain chain (rounds/sequence/alternate). Same meaning as before. */
  ok: boolean;
  /** Alias of `ok`, to make the distinction explicit. */
  drafts: boolean;
  /** Group executions the RENDERER can run for this chain (as an MB3D import creates them). The AI draft tools cannot set these yet. */
  executions: { kind: string; detail: string }[];
  /** True when the chain is renderable either as a plain chain or through one of the group executions. */
  renderable: boolean;
  errors: string[]; warnings: string[]; steps: { id: string; class: string }[]; seeAlso: string[];
}

/** Which group executions (the ones the MB3D importer creates) accept this chain, tried with neutral quotas. Informative: never used to weaken `ok`. */
function groupExecutions(formulas: readonly Formula[]): { kind: string; detail: string }[] {
  const out: { kind: string; detail: string }[] = [];
  if (formulas.length === 0 || !formulas.every((f) => f.kernel)) return out;
  const steps = formulas.map((formula) => ({ formula, iterations: 1, parameters: [] })) as never;
  const n = formulas.length;
  const one = [{ start: 0, end: n - 1, repeat: 0, maxIterations: 30 }];
  for (const [distance, label] of [['radius-over-w', 'analytic counted chain (radius/|w|)'], ['difs-minimum', 'dIFS chain with transforms (minimum of the shapes)']] as const) {
    const e: BoundedSequenceExecution = { kind: 'bounded-sequence', distance, groups: one };
    if (!boundedSequenceErrors(steps, 1, 'sequence', e).length) out.push({ kind: 'bounded-sequence', detail: label });
  }
  for (let k = 1; k < n; k++) {
    const groups: MappedFieldExecution['groups'] = [{ start: 0, end: k - 1, repeat: 0, maxIterations: 30 }, { start: k, end: n - 1, repeat: k, maxIterations: 6 }];
    const mapped: MappedFieldExecution = { kind: 'mapped-field', fieldStop: 'query', groups };
    if (!mappedFieldErrors(steps, 1, 'sequence', mapped).length) out.push({ kind: 'mapped-field', detail: `group 1 = steps 1-${k} maps the point, group 2 = steps ${k + 1}-${n} is the dIFS field (MB3D DE-combination, variant 5)` });
    const independent: IndependentFieldExecution = { kind: 'independent-field', operation: 'max-inverted-second', groups };
    if (!independentFieldErrors(steps, 1, 'sequence', independent).length) out.push({ kind: 'independent-field', detail: `two independent groups, steps 1-${k} and ${k + 1}-${n}, combined as max(analytic DE, inverted dIFS) (MB3D DE-combination, variant 2)` });
  }
  return out;
}

/**
 * Asks the engine's own rules whether a chain of library formulas can run, before a draft is built. Uses kernelChainErrors, the same
 * function the renderer uses, so this never disagrees with a real preview. Adds measured advice from the knowledge base as warnings.
 */
export function checkChain(ids: readonly string[], library: readonly Formula[], mode: ChainMode = 'sequence'): ChainCheck {
  const errors: string[] = [], warnings: string[] = [], seeAlso = new Set<string>();
  const fs = ids.map((id) => library.find((f) => f.id === id));
  const missing = ids.filter((_, i) => !fs[i]);
  const none = { drafts: false, executions: [], renderable: false };
  if (missing.length) return { ok: false, ...none, errors: [`Unknown formulas: ${missing.join(', ')}. See noema_list_formulas.`], warnings, steps: [], seeAlso: [] };
  if (ids.length < 1 || ids.length > 8) return { ok: false, ...none, errors: ['A chain has 1 to 8 steps.'], warnings, steps: [], seeAlso: ['F-ENG-01'] };
  const formulasOf = fs as Formula[];
  const kernels = formulasOf.filter((f) => f.kernel).length;
  if (kernels === formulasOf.length) errors.push(...kernelChainErrors(formulasOf.map((formula) => ({ formula, iterations: 1, parameters: [] })) as never, mode));
  else if (kernels > 0) errors.push('Registered formula kernels can currently only be chained with other registered kernels.' + (formulasOf.some((f) => isImportedHelperCapable(f)) ? ' An imported transform can instead be used as a helper in group 1 of a scene with execution groups (imported Mandelbulb 3D artwork): see noema_inspect_scene (chain.execution) and chain.group.prepend_step.' : ''));
  else if (kernels === 0 && !formulasOf.some((f) => f.distance)) errors.push('The chain has no formula with a distance function: a pure transform (for example an imported .m3f formula) cannot be drawn alone. Add a formula that provides distance.');
  if (errors.length) seeAlso.add(kernels > 0 && kernels < formulasOf.length ? 'F-ENG-03' : 'F-ENG-01');
  const classes = ids.map((id) => ({ id, class: profileOf(id)?.class ?? 'unknown' }));
  const mains = classes.filter((c) => c.class.endsWith('-main'));
  if (!errors.length && mains.length > 1) { warnings.push('Multiple main formulas: with default values, often only the first is visible. Give it few iterations (1–4) to make the second visible.'); seeAlso.add('F-OBS-02'); seeAlso.add('F-OBS-03'); seeAlso.add('F-OBS-04'); }
  if (classes.some((c) => /abox|amazingbox/.test(c.id))) { warnings.push('Cube-shaped Amazing Box formulas surround the default camera: move the camera back about 6–7 times (noema_set_draft_camera dolly_factor 0.15) before judging the shape.'); seeAlso.add('F-OBS-01'); }
  if (classes.some((c) => /heightmap/.test(c.id))) { warnings.push('The formula reads MB3D field maps, which are only available in the local artist version.'); seeAlso.add('F-ENG-04'); }
  if (mode === 'interpolate' && kernels > 0) seeAlso.add('F-ENG-01');
  // A 4D state (a carried vec4) only matters if a later formula reads the same carried name; otherwise the step silently does nothing.
  formulasOf.forEach((f, i) => {
    const v4 = f.carry.filter((n) => f.variables.some((v) => v.name === n && v.type === 'vec4'));
    for (const n of v4) if (!f.distance && !formulasOf.slice(i + 1).some((g) => g.carry.includes(n) && g.variables.some((v) => v.name === n && v.type === 'vec4'))) warnings.push(`${f.id} carries a four-dimensional point (${n}) that no later formula in the chain reads; this step therefore has no effect. Add a 4D formula carrying ${n} (for example quaternion-mandelbrot) after it.`);
  });
  const executions = groupExecutions(formulasOf);
  const drafts = errors.length === 0;
  if (!drafts && executions.length) {
    warnings.push(`The renderer can run this chain using group execution (${[...new Set(executions.map((e) => e.kind))].join(', ')}), as created by an MB3D import. This plain-chain draft check cannot build it; use a grouped draft or import an MB3D file for this chain.`);
    seeAlso.add('F-ENG-06');
  } else if (drafts) {
    warnings.push('The chain runs as an ordinary chain (rounds/sequence). An imported MB3D artwork uses counted group execution (RStop, prefix/repetition, groups), so the same formulas do not reproduce the original picture without it.');
    seeAlso.add('F-ENG-06');
  }
  return { ok: drafts, drafts, executions: executions.slice(0, 6), renderable: drafts || executions.length > 0, errors, warnings, steps: classes, seeAlso: [...seeAlso] };
}
