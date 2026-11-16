/**
 * Formula Knowledge Atlas search (FORMULA-EXPLORATION-01). Answers a question with a SHORT list of entries instead of dumping the
 * formula library. Entry kinds: formula (generated from the library at run time), fact (verified engine facts), observation (artistic
 * observation), hypothesis (untested idea), reference (public source, principle only), experiment (the artist's own memory) and
 * own_works (aggregate statistics, only if the artist allowed it). The atlas guides; it never forbids a combination.
 */
import atlasData from './atlas.json';
import type { Formula } from '../engine/formula/types';
import type { ExperimentRecord, OwnWorksStats } from './experiments';
import { KB_VERSION, profileOf, searchKb } from './kb';

export const KNOWLEDGE_KINDS = ['formula', 'fact', 'observation', 'hypothesis', 'reference', 'experiment', 'own_works', 'case', 'trial', 'relation', 'gap'] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export const ATLAS_VERSION: number = atlasData.version;
export { KB_VERSION };
const MAX_REPLY_CHARS = 3000;

interface AtlasEntry { id: string; kind: string; topic: string; confidence: string; basis: string; text: string; tags: string[]; test?: string; sources?: { title: string; url: string; license: string }[] }
interface AtlasReference { id: string; artist: string; url: string; retrieved: string; confidence: string; license: string; note: string }
const entries = atlasData.entries as AtlasEntry[];
const references = atlasData.references as AtlasReference[];
const roles = atlasData.roles.map as Record<string, string>;

export interface KnowledgeContext {
  formulas: readonly Formula[];
  experiments: readonly ExperimentRecord[];
  /** Present only while the artist has allowed analysis of their own works. */
  ownWorks?: OwnWorksStats | null;
}

/** A coarse role for a formula: the atlas role if known, else its catalogue category/family, else tags. Flagged as a heuristic. */
export function formulaRole(f: Formula): string {
  return roles[f.id] ?? f.catalog?.category ?? f.catalog?.family ?? ((f.catalog?.tags ?? []).slice(0, 3).join(', ') || 'okänd roll');
}

const words = (q: string): string[] => q.toLowerCase().split(/[^\p{L}\p{N}_*+-]+/u).filter((w) => w.length > 1).slice(0, 8);
const score = (hay: string, ws: string[]): number => { let s = 0; for (const w of ws) if (hay.includes(w)) s++; return ws.length ? s / ws.length : 0; };
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export interface KnowledgeHit { kind: KnowledgeKind | string; id: string; confidence: string; text: string; [k: string]: unknown }

export function searchKnowledge(query: string, kinds: readonly KnowledgeKind[] | undefined, limit: number, ctx: KnowledgeContext): { atlasVersion: number; hits: KnowledgeHit[]; note: string } {
  const ws = words(query);
  const want = (k: KnowledgeKind): boolean => !kinds || kinds.length === 0 || kinds.includes(k);
  const scored: { s: number; hit: KnowledgeHit }[] = [];

  for (const e of entries) {
    const kind = e.kind as KnowledgeKind;
    if (!want(kind)) continue;
    const s = score(`${e.id} ${e.topic} ${e.tags.join(' ')} ${e.text}`.toLowerCase(), ws);
    if (s > 0) scored.push({ s: s + (kind === 'fact' ? 0.05 : 0), hit: { kind, id: e.id, confidence: e.confidence, text: clip(e.text, 380), basis: e.basis, ...(e.test ? { test: clip(e.test, 200) } : {}) } });
  }
  if (want('reference')) for (const r of references) {
    const s = score(`${r.artist} ${r.note}`.toLowerCase(), ws);
    if (s > 0) scored.push({ s, hit: { kind: 'reference', id: r.id, confidence: r.confidence, text: clip(r.note, 380), source: r.artist, url: r.url, license: clip(r.license, 160), retrieved: r.retrieved } });
  }
  if (want('formula')) for (const f of ctx.formulas) {
    const role = formulaRole(f);
    const s = score(`${f.id} ${f.name} ${(f.catalog?.tags ?? []).join(' ')} ${role} ${f.catalog?.family ?? ''}`.toLowerCase(), ws);
    const prof = profileOf(f.id);
    const used = prof?.usage ? ` Används i ${prof.usage.artistCorpus.uses} av ${prof.usage.artistCorpus.of} verk i konstnärens samling (först ${prof.usage.artistCorpus.first}, sist ${prof.usage.artistCorpus.last}).` : '';
    const cls = prof ? ` Klass: ${prof.class} (avståndsmått ${prof.distanceModel ?? 'steps'}).` : '';
    if (s > 0 || (prof && score(`${prof.class} ${prof.distanceModel ?? ''}`.toLowerCase(), ws) > 0)) scored.push({ s: s + 0.02, hit: { kind: 'formula', id: f.id, confidence: prof ? 'hög (klass ur motorn)' : roles[f.id] ? 'medel' : 'låg', text: `${f.name}. Roll (heuristik): ${role}.${cls}${used}`, parameters: f.parameters.slice(0, 6).map((p) => `${p.name} ${p.min}..${p.max} (standard ${p.default})`), ...(prof?.findings?.length ? { findings: prof.findings.slice(0, 4) } : {}) } });
  }
  if (want('experiment')) for (const x of [...ctx.experiments].reverse().slice(0, 400)) {
    const s = score(`${x.chain} ${x.idea} ${x.observation} ${x.tags.join(' ')} ${x.verdict}`.toLowerCase(), ws);
    if (s > 0) scored.push({ s: s + 0.03, hit: { kind: 'experiment', id: x.id, confidence: 'konstnärens egna försök', text: clip(`${x.chain} [${x.mode}, ${x.rounds} varv]: ${x.idea} – sett: ${x.observation}`, 380), verdict: x.verdict } });
  }
  if (want('own_works') && ctx.ownWorks) {
    const o = ctx.ownWorks;
    const top = (rec: Record<string, number>, n: number): string[] => Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`);
    const hay = `egna verk statistik formler par kombinationer ${Object.keys(o.formulaUse).join(' ')}`.toLowerCase();
    if (score(hay, ws) > 0) scored.push({ s: 0.5, hit: { kind: 'own_works', id: 'own-works-stats', confidence: 'mätt på konstnärens sparade verk (lokalt)', text: `${o.works} verk analyserade. Vanligaste formler: ${top(o.formulaUse, 8).join(', ') || 'inga'}. Vanligaste par: ${top(o.pairs, 6).join(', ') || 'inga'}. Endast antal, aldrig parametrar eller bilder.` } });
  }

  for (const x of searchKb(query, kinds, limit)) scored.push(x);
  scored.sort((a, b) => b.s - a.s || a.hit.id.localeCompare(b.hit.id));
  const hits: KnowledgeHit[] = [];
  let used = 0;
  for (const { hit } of scored) {
    if (hits.length >= limit) break;
    const size = JSON.stringify(hit).length;
    if (hits.length && used + size > MAX_REPLY_CHARS) break;
    hits.push(hit); used += size;
  }
  return { atlasVersion: ATLAS_VERSION, hits, note: hits.length ? 'Atlasen är vägledning, inte regler. fact = kontrollerat i motorn, hypothesis = otestad idé, observation/reference = allmän princip från offentlig källa.' : 'Inga träffar. Prova ett annat ord (till exempel en formelfamilj som ifs, fold, bulb, box) eller utforska fritt.' };
}
