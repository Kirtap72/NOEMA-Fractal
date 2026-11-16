/**
 * Experiment memory (FORMULA-EXPLORATION-01): a compact, provider-independent record of what the AI tried in a draft.
 * A record holds the formula chain, the idea, what was seen and a verdict. It never holds pictures, conversations or file paths,
 * so it stays small and can be read by any model. Stored on the artist's computer only (desktop/knowledge.cjs).
 */
import type { Scene } from '../engine/scene';

export const VERDICTS = ['promising', 'neutral', 'poor'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const MAX_EXPERIMENT_RECORDS = 1500;

export interface ExperimentRecord {
  id: string;
  at: number;
  /** "mandelbulb*8 > box-fold*1" style signature, formula ids and iterations only. */
  chain: string;
  mode: string;
  rounds: number;
  idea: string;
  observation: string;
  verdict: Verdict;
  tags: string[];
  /** Optional, voluntary opinion of the artist (stays on the computer). The AI's own verdict is an opinion until a person reviews it. */
  feedback?: 'liked' | 'disliked';
  /** Colour-independent measurements of the latest preview, if one was made. */
  metrics?: { objectShare: number; edgeDensity: number; brightness: number; previewMs: number };
}

/** The chain of a scene as a short readable signature (no parameter values: those belong to the draft, not to the memory). */
export function chainSignature(scene: Scene): { chain: string; mode: string; rounds: number } {
  const f = scene.content[0];
  if (!f || f.type !== 'fractal') return { chain: '', mode: 'sequence', rounds: 1 };
  return { chain: f.chain.map((s) => `${s.formula}*${s.iterations}`).join(' > '), mode: f.mode ?? 'sequence', rounds: f.rounds ?? 1 };
}

const text = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Reads one stored line back; anything malformed is dropped rather than trusted. */
export function parseRecord(raw: unknown): ExperimentRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.at !== 'number' || typeof r.chain !== 'string' || !VERDICTS.includes(r.verdict as Verdict)) return null;
  const m = r.metrics as Record<string, unknown> | undefined;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    id: text(r.id, 60), at: r.at, chain: text(r.chain, 300), mode: text(r.mode ?? 'sequence', 20), rounds: Math.max(1, Math.min(64, Math.round(num(r.rounds) || 1))),
    idea: text(r.idea, 300), observation: text(r.observation, 400), verdict: r.verdict as Verdict,
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 6).map((t) => text(t, 30)).filter(Boolean) : [],
    ...(r.feedback === 'liked' || r.feedback === 'disliked' ? { feedback: r.feedback } : {}),
    ...(m ? { metrics: { objectShare: num(m.objectShare), edgeDensity: num(m.edgeDensity), brightness: num(m.brightness), previewMs: num(m.previewMs) } } : {}),
  };
}

/** Keeps the newest records. The memory is a notebook, not an archive. */
export function trimRecords<T>(records: T[], max = MAX_EXPERIMENT_RECORDS): T[] { return records.length > max ? records.slice(records.length - max) : records; }

/** Aggregate statistics of the artist's own saved works. Only formula ids and counts, never titles, scenes or parameter values. */
export interface OwnWorksStats { works: number; formulaUse: Record<string, number>; pairs: Record<string, number> }

export function statsFromScenes(scenes: readonly Scene[]): OwnWorksStats {
  const formulaUse: Record<string, number> = {}, pairs: Record<string, number> = {};
  for (const sc of scenes) {
    const f = sc.content[0];
    if (!f || f.type !== 'fractal') continue;
    const ids = [...new Set(f.chain.map((s) => s.formula))];
    for (const id of ids) formulaUse[id] = (formulaUse[id] ?? 0) + 1;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = [ids[i], ids[j]].sort().join(' + '); pairs[k] = (pairs[k] ?? 0) + 1; }
  }
  return { works: scenes.length, formulaUse, pairs };
}
