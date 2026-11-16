/**
 * AppService: the one place the AI bridge calls into the application (docs/ai-bridge/NOEMA-AI-BRIDGE-DESIGN.md §3).
 *
 * It owns no scene state of its own except the drafts. Everything it does to a scene uses the application's own pure functions
 * (`sceneEdit.ts`, `withColor`, `gradientEditing.ts`, `parseScene`) and every result is validated with `parseScene` before it is
 * stored. Which operations exist, with which parameters and limits, comes from `src/capabilities/manifest.json` and nothing else.
 *
 * The AI can edit and preview drafts freely. The live scene changes only through `confirmApply`, which is called by the artist's
 * button in the app and is deliberately NOT an operation: `handle` rejects it as unknown.
 */
import { LOCK_LABELS, lockMessage, lockViolations, lockedKeys, mergeLocks } from '../../engine/draftLocks';
import type { DraftLocks } from '../../engine/draftLocks';
import manifest from '../../capabilities/manifest.json';
import helpIndex from '../../capabilities/helpIndex.json';
import { parseScene, resolveScene, withColor } from '../../engine/scene';
import type { Scene } from '../../engine/scene';
import type { Formula } from '../../engine/formula/types';
import { buildGroupedContent, groupRolesOf, groupTemplate, GROUP_KINDS, GROUP_TEMPLATES } from '../../engine/formula/groupCreate';
import type { GroupSpec } from '../../engine/formula/groupCreate';
import { describeExecution } from '../../engine/formula/executionSummary';
import { frameFractal, withFramedCamera } from '../../engine/framing/frame';
import { diagnoseVisible } from '../../engine/framing/diagnose';
import { addStep, moveStep, removeStep, setStepFormula, stepEditRefusal, withChainMode, withExecutionGroup, withRounds, withStepIterations, withStepParameter } from '../../engine/sceneEdit';
import type { ChainMode } from '../../engine/formula/chain';
import { geometryDifference } from './imageMetrics';
import type { PreviewMetrics } from './imageMetrics';
import { searchKnowledge } from '../../knowledge/knowledge';
import type { KnowledgeKind } from '../../knowledge/knowledge';
import { chainSignature, statsFromScenes } from '../../knowledge/experiments';
import { checkChain, getRecord } from '../../knowledge/kb';
import type { ExperimentRecord, OwnWorksStats } from '../../knowledge/experiments';
import { MATERIAL_PRESETS } from '../../engine/material';
import type { MaterialSettings } from '../../engine/material';
import { MAX_TEXTURED_MATERIALS, stopImageMaps, texturedEntries } from '../../engine/materialRamp';
import { colorStop, editableGradient, moveStop, setSoftness, setStopKind, setStopMaterial, setTextureScale, setTransition } from '../gradientEditing';
import type { MaterialSource } from '../materialGradientSource';
import { DEFAULT_SECTIONS, SECTIONS, diffScenes, redact, sceneFingerprint, summarizeScene } from './sceneSummary';
import type { DiffEntry, Section } from './sceneSummary';
import { DraftError, DraftStore, isOpen, stateText } from './drafts';
import type { Draft, DraftSource } from './drafts';
import { CameraMoveError, moveCamera } from './cameraMoves';
import type { CameraMove } from './cameraMoves';
import { DraftPersistence } from './draftPersistence';
import type { DraftDisk } from './draftPersistence';
import { AMBIENT_LIMITS, LIGHT_LIMITS, MAX_LIGHTS, defaultLight } from '../../engine/lights';
import type { LightSettings } from '../../engine/lights';
import { validateAgainst, withDefaults } from './validate';
import type { JsonSchema } from './validate';

export type Manifest = typeof manifest;
type OperationDef = Manifest['operations'][number];
type SettingDef = Manifest['settings'][number] & { rangeFrom?: string; pattern?: string; values?: string[]; range?: number[]; needsIndex?: boolean; needsName?: boolean };

export interface RenderedPreview { base64: string; mime: 'image/png'; width: number; height: number; ms: number; /** Colour-independent shape measurements (imageMetrics.ts), when the renderer could compute them. */ metrics?: PreviewMetrics }

/** Everything the service needs from the application. Tests pass in-memory versions. */
export interface AppPorts {
  /** The authored live scene (never mutated by the service). */
  scene(): Scene;
  formulas(): readonly Formula[];
  materials: MaterialSource & { settings?(id: string): Promise<MaterialSettings | null> };
  /** Renders a LookDev-style still of this exact scene. Absent when the GPU path is not available. */
  render?(scene: Scene, options: { samples: 1 | 2; width: 256 | 512; signal: AbortSignal }): Promise<RenderedPreview>;
  /** Puts two rendered stills side by side (A left, B right) in one picture. Absent when no canvas is available. */
  compose?(a: RenderedPreview, b: RenderedPreview): Promise<RenderedPreview>;
  /** The artist's saved artworks. Read-only: the service can list them and read a COPY of a scene, nothing else. */
  artworks?: { list(query: string, offset: number, limit: number): Promise<{ total: number; items: { id: string; title: string; type: string }[] }>; scene(id: string): Promise<{ scene: Scene; title: string } | null> };
  /** Where drafts are kept between runs (the isolated profile). Absent in tests that do not need it. */
  persistence?: DraftDisk;
  /** Poly Haven (RC-01). Only reached while the artist has allowed it for this session (see `setPolyHavenAccess`). */
  polyHaven?: {
    search(q: { query: string; category: string; limit: number }): Promise<{ total: number; items: { id: string; name: string; categories: string[]; authors: string[]; maxResolution: number | null; downloaded: string[] }[] }>;
    import(id: string, resolution: '1k' | '2k'): Promise<{ materialId: string; title: string; status: { channel: string; label: string; state: string; note: string }[]; source: { license: string; author: string; url: string } }>;
  };
  /** The experiment memory (desktop/knowledge.cjs, or an in-memory list in tests). Local only. */
  knowledge?: { experiments(): Promise<ExperimentRecord[]>; record(r: ExperimentRecord): Promise<void> };
  /** Puts a scene in place as ONE reversible transaction (sync.editWithUndo). Called only from the artist's confirmation. */
  applyToLive(scene: Scene): void;
  now?(): number;
  /** A line for the artist's readable action log. Must contain no tokens, images or paths. */
  log?(entry: ActionLogEntry): void;
}

export interface ActionLogEntry { time: number; op: string; ok: boolean; summary: string }

export type ServiceResult =
  | { ok: true; data: Record<string, unknown>; image?: { mime: 'image/png'; base64: string } }
  | { ok: false; code: string; message: string; details?: unknown };

export interface DraftView {
  draft_id: string; label: string; state: Draft['state']; changes: number; revisions: number; previews: number;
  liveSceneChangedSinceDraft: boolean; requestMessage?: string; createdAt: number;
  /** Where it started (live scene, a saved artwork's copy, another draft) and whether it was read back from disk after a restart. */
  source?: Draft['source']; recovered?: boolean;
  /** The geometric idea the AI said this draft tests (FORMULA-EXPLORATION-01). */
  idea?: string;
  /** The parts the artist locked for this draft (ARTIST-WORKFLOW 07). */
  locks?: DraftLocks;
}

const fail = (code: string, message: string, details?: unknown): ServiceResult => ({ ok: false, code, message, ...(details !== undefined ? { details } : {}) });
const ok = (data: Record<string, unknown>, image?: { mime: 'image/png'; base64: string }): ServiceResult => ({ ok: true, data, ...(image ? { image } : {}) });

class ChangeError extends Error {}

export class AppService {
  readonly drafts: DraftStore;
  private windows = new Map<string, number[]>();
  private rendering = false;
  private listeners = new Set<() => void>();
  readonly actionLog: ActionLogEntry[] = [];
  readonly persistence: DraftPersistence | undefined;
  /** Recovery information for the panel: how many drafts came back from disk, what could not be read. */
  /** The artist's session permission for Poly Haven and what has been used of its quotas. Off at every start; only the artist's own switch changes it. */
  readonly polyHavenAccess = { allowed: false, searches: 0, downloads: 0 };
  /** ARTIST-WORKFLOW 07: what the artist has locked for the drafts made from now on (the chat panel sets it; an AI cannot). */
  private locks: DraftLocks = {};
  setLocks(locks: DraftLocks): void { this.locks = mergeLocks(locks, undefined); this.changed(); }
  getLocks(): DraftLocks { return { ...this.locks }; }
  /** Makes a draft whose starting scene keeps the locked parts of the live scene, or refuses (a draft from another artwork, template or camera mode that would move them). */
  private newDraft(scene: Scene, live: Scene, label: string | undefined, source: DraftSource, idea: string | undefined, parentLocks?: DraftLocks): Draft {
    const locks = mergeLocks(this.locks, parentLocks);
    // The comparison is with the live scene as the application's own parser reads it (the same normalisation every draft goes through), not the raw object.
    const violated = lockedKeys(locks).length ? lockViolations(this.validated(live), scene, locks) : [];
    if (violated.length) throw new DraftError('locked', lockMessage(violated) + (source.kind === 'artwork' ? ' A draft from another artwork would replace them.' : ''));
    return this.drafts.create(scene, sceneFingerprint(live), label, this.now(), source, idea, locks);
  }
  setPolyHavenAccess(allowed: boolean): void { this.polyHavenAccess.allowed = allowed; if (!allowed) { this.polyHavenAccess.searches = 0; this.polyHavenAccess.downloads = 0; } this.changed(); }
  recovery: { restored: number; warnings: string[]; problems: { id: string; reason: string }[]; diskError?: string } = { restored: 0, warnings: [], problems: [] };

  constructor(private ports: AppPorts, private def: Manifest = manifest) {
    this.drafts = new DraftStore({ maxAlive: def.limits.maxDraftsAlive, maxRevisions: def.limits.maxRevisionsPerDraft });
    this.persistence = ports.persistence ? new DraftPersistence(ports.persistence, (m) => { this.recovery = { ...this.recovery, diskError: m }; this.changed(); }) : undefined;
  }

  /**
   * Reads the drafts saved by an earlier run back into memory. Nothing is applied: a restored draft is exactly as open or closed as
   * it was, and the live scene is not touched. Call once at start-up, before the AI is allowed to create drafts.
   */
  async restore(): Promise<void> {
    if (!this.persistence) return;
    const r = await this.persistence.loadAll();
    let restored = 0;
    const problems = [...r.problems];
    for (const d of r.drafts) {
      try { this.drafts.load(d); restored++; } catch (e) { problems.push({ id: d.id, reason: String((e as Error).message).slice(0, 160) }); }
    }
    this.recovery = { restored, warnings: r.warnings, problems, ...(this.recovery.diskError ? { diskError: this.recovery.diskError } : {}) };
    this.changed();
  }

  private save(d: Draft): void { this.persistence?.save(d); }
  /** Waits for every pending write (used before quitting and in tests). */
  flush(): Promise<void> { return this.persistence?.flush() ?? Promise.resolve(); }

  private now(): number { return this.ports.now?.() ?? Date.now(); }
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private changed(): void { for (const l of this.listeners) l(); }

  // ---- the operations the AI may call -------------------------------------------------------------------------------------

  async handle(op: string, args: unknown, signal?: AbortSignal): Promise<ServiceResult> {
    const result = await this.dispatch(op, args, signal);
    const entry: ActionLogEntry = { time: this.now(), op, ok: result.ok, summary: result.ok ? 'ok' : `${result.code}: ${result.message}`.slice(0, 200) };
    this.actionLog.push(entry);
    if (this.actionLog.length > 100) this.actionLog.shift();
    this.ports.log?.(entry);
    this.changed();
    return result;
  }

  private async dispatch(op: string, args: unknown, signal?: AbortSignal): Promise<ServiceResult> {
    const def = this.def.operations.find((o) => o.id === op && o.status === 'implemented');
    if (!def) return fail('unknown_operation', `Unknown operation: ${String(op).slice(0, 60)}. See noema_get_capabilities.`);
    const limited = this.rateLimit(def);
    if (limited) return limited;
    const raw = args === undefined || args === null ? {} : args;
    if (typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid_params', 'The parameters must be an object.');
    const params = withDefaults(def.params as JsonSchema, raw as Record<string, unknown>);
    const problems = validateAgainst(def.params as JsonSchema, params);
    if (problems.length) return fail('invalid_params', problems.slice(0, 8).join('; '), { problems: problems.slice(0, 20) });
    try {
      const result = await this.run(def, params, signal ?? new AbortController().signal);
      if (result.ok && JSON.stringify(result.data).length > this.def.limits.maxResponseBytes) return fail('response_too_large', 'The response would be too large. Request fewer sections or smaller pages.');
      return result;
    } catch (e) {
      if (e instanceof DraftError) return fail(e.code, e.message);
      if (e instanceof ChangeError) return fail('change_rejected', e.message);
      if (signal?.aborted) return fail('cancelled', 'Avbrutet.');
      return fail('internal_error', 'An internal error occurred. Nothing in the live scene has been changed.');
    }
  }

  private rateLimit(def: OperationDef): ServiceResult | null {
    const t = this.now();
    const hit = (name: string, limit: number): boolean => {
      const w = (this.windows.get(name) ?? []).filter((x) => t - x < 60_000);
      this.windows.set(name, w);
      if (w.length >= limit) return true;
      w.push(t);
      return false;
    };
    if (hit('all', this.def.limits.callsPerMinute)) return fail('rate_limited', 'Too many calls per minute. Wait a moment.');
    if (def.kind === 'draft' && hit('mutation', this.def.limits.mutationsPerMinute)) return fail('rate_limited', 'Too many draft changes per minute. Wait a moment.');
    if (def.kind === 'render' && hit('preview', this.def.limits.previewsPerMinute)) return fail('rate_limited', `At most ${this.def.limits.previewsPerMinute} previews per minute.`);
    return null;
  }

  private async run(def: OperationDef, p: Record<string, unknown>, signal: AbortSignal): Promise<ServiceResult> {
    switch (def.id) {
      case 'capabilities.list': return this.capabilities(p);
      case 'formulas.list': return this.listFormulas(p);
      case 'settings.explain': return this.explain(p);
      case 'help.search': return this.helpSearch(p);
      case 'knowledge.search': return this.knowledgeSearch(p);
      case 'knowledge.get': return this.knowledgeGet(p);
      case 'chain.check': return this.chainCheck(p);
      case 'experiment.record': return this.recordExperiment(p);
      case 'scene.inspect': return this.inspect(p);
      case 'materials.list': return this.listMaterials(p);
      case 'artworks.list': return this.listArtworks(p);
      case 'polyhaven.search': return this.polyHavenSearch(p);
      case 'polyhaven.import': return this.polyHavenImport(p);
      case 'draft.list': return ok({ drafts: this.draftViews() });
      case 'draft.create': return this.createDraft(p);
      case 'draft.create_grouped': return this.createGroupedDraft(p);
      case 'draft.list_group_templates': return this.listGroupTemplates();
      case 'draft.frame': return this.frameDraft(p);
      case 'draft.set_parameters': return this.setParameters(p);
      case 'draft.apply_material': return this.applyMaterial(p);
      case 'draft.set_camera': return this.setCamera(p);
      case 'draft.set_light': return this.setLight(p);
      case 'draft.set_ambient': return this.setAmbient(p);
      case 'draft.undo_step': return this.undoStep(p);
      case 'draft.discard': return this.discardDraft(p);
      case 'draft.request_apply': return this.requestApply(p);
      case 'render.preview': return this.preview(p, signal);
      case 'render.compare': return this.compare(p, signal);
      default: return fail('not_implemented', `The operation ${def.id} is not connected yet.`);
    }
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------------

  private capabilities(p: Record<string, unknown> = {}): ServiceResult {
    const full = p.detail === 'full';
    const implemented = this.def.operations.filter((o) => o.status === 'implemented');
    // The compact answer is what the model should normally ask for: the tool descriptions it already has hold the details, so
    // repeating every purpose text on each run only costs input tokens (measured in docs/ai-bridge/MCP-02-RAPPORT.md).
    return ok({
      manifestVersion: this.def.manifestVersion, protocol: this.def.protocol, limits: this.def.limits,
      ...(full ? { approval: this.def.approvalLevels } : {}),
      operations: implemented.map((o) => ({ id: o.id, tool: o.mcpTool, kind: o.kind, ...(full ? { purpose: o.purpose, approval: o.approval, undo: o.undo } : {}) })),
      settings: this.def.settings.map((s) => { const x = s as SettingDef; return { id: x.id, ...(full ? { name: x.name } : {}), type: x.type, ...(x.range ? { range: x.range } : {}), ...(x.values ? { values: x.values } : {}), ...(x.needsIndex ? { needsIndex: true } : {}), ...(x.needsName ? { needsName: true } : {}) }; }),
      howItWorks: [
        'You never change the artist\'s live scene. Create a draft (noema_create_draft), change it freely, look at previews and then ask the artist to use it (noema_request_apply_draft).',
        'Only when the artist presses Use in the app themselves does the live scene change, as a single undoable transaction.',
        ...(full ? ['Material gradient blends metal, roughness, reflectivity, tone and the picture maps for colour, roughness, metal and occlusion (one scale per material; at most 4 different textured materials per gradient). Normal/bump maps, emission, displacement, procedural detail and transmission are not blended and are listed in the response. Geometry Detail with a material gradient is not verified.'] : []),
      ],
    });
  }

  private listFormulas(p: Record<string, unknown>): ServiceResult {
    const words = String(p.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const all = [...this.ports.formulas()].sort((a, b) => a.id.localeCompare(b.id));
    const hits = all.filter((f) => { const h = `${f.id} ${f.name} ${f.description ?? ''} ${(f.catalog?.tags ?? []).join(' ')} ${f.catalog?.family ?? ''}`.toLowerCase(); return words.every((w) => h.includes(w)); });
    const offset = p.offset as number, limit = p.limit as number;
    const items = hits.slice(offset, offset + limit).map((f) => ({
      id: f.id, name: f.name, description: redact(f.description ?? ''), reviewed: f.reviewed,
      credits: f.credits.map((c) => ({ name: c.name, role: c.role ?? null, status: c.status })),
      tags: f.catalog?.tags ?? [], dimension: f.catalog?.dimension ?? 3,
      group_roles: groupRolesOf(f, this.ports.formulas() as Formula[]),
      category: f.catalog?.category ?? null,
      // FORMULA-IMPORTER-01: converted personal formulas are marked so a draft never presents them as part of the public library.
      ...((f.catalog?.tags ?? []).includes('importerad') ? { origin: 'importerad-privat', private: true } : { origin: 'publik' }),
      parameters: f.parameters.map((x) => ({ name: x.name, min: x.min, max: x.max, default: x.default })),
    }));
    return ok({ total: hits.length, offset, items, ...(offset + limit < hits.length ? { nextOffset: offset + limit } : {}) });
  }

  private explain(p: Record<string, unknown>): ServiceResult {
    const settings = this.def.settings as SettingDef[];
    let found: SettingDef[] = [];
    if (typeof p.setting_id === 'string') found = settings.filter((s) => s.id === p.setting_id);
    else if (typeof p.query === 'string') {
      const words = p.query.toLowerCase().split(/\s+/).filter(Boolean);
      found = settings.filter((s) => { const h = `${s.id} ${s.name.en} ${s.explain.en}`.toLowerCase(); return words.every((w) => h.includes(w)); });
    } else return fail('invalid_params', 'Give setting_id or query.');
    if (!found.length) return fail('not_found', 'No setting matches. See noema_get_capabilities for the list.');
    return ok({ matches: found.slice(0, 5).map((s) => ({ id: s.id, name: s.name, explain: s.explain, type: s.type, ...(s.range ? { range: s.range } : {}), ...(s.values ? { values: s.values } : {}), ...(s.unit ? { unit: s.unit } : {}), ...('default' in s ? { default: s.default } : {}), ...(s.needsIndex ? { needsIndex: true } : {}), ...(s.needsName ? { needsName: true } : {}), ui: s.ui })) });
  }

  /** Short, targeted answers from the knowledge atlas, the artist's experiment memory and (only if allowed) aggregate statistics of their own works. */
  private async knowledgeSearch(p: Record<string, unknown>): Promise<ServiceResult> {
    const kinds = Array.isArray(p.kinds) ? (p.kinds as KnowledgeKind[]) : undefined;
    const wantsOwn = !kinds || kinds.length === 0 || kinds.includes('own_works');
    const ownWorks = wantsOwn && this.ownWorksAccess.allowed ? await this.ownWorksStats() : null;
    const experiments = this.ports.knowledge ? await this.ports.knowledge.experiments() : [];
    const r = searchKnowledge(String(p.query), kinds, (p.limit as number) ?? 5, { formulas: this.ports.formulas(), experiments, ownWorks });
    return ok({ ...r, ...(kinds?.includes('own_works') && !this.ownWorksAccess.allowed ? { ownWorks: 'The artist has not allowed analysis of their own artworks.' } : {}) });
  }

  /** One full record by id (a formula profile, a finding with evidence, a measured trial, a case or a source). */
  private knowledgeGet(p: Record<string, unknown>): ServiceResult {
    const r = getRecord(String(p.id));
    if (!r) return fail('not_found', `No knowledge entry with id ${String(p.id).slice(0, 60)}. Search with noema_search_knowledge.`);
    return ok({ kind: r.kind, record: r.record });
  }

  /** Whether a chain of library formulas can run, decided by the engine's own rules (no preview is drawn). */
  private chainCheck(p: Record<string, unknown>): ServiceResult {
    return ok({ ...checkChain(p.formulas as string[], this.ports.formulas(), ((p.mode as string) ?? 'sequence') as 'sequence') });
  }

  /** The artist's switch for letting the AI see AGGREGATE statistics of their saved works. Off at every start. Nothing is copied or sent anywhere. */
  readonly ownWorksAccess = { allowed: false };
  private ownWorksCache: OwnWorksStats | null = null;
  setOwnWorksAccess(allowed: boolean): void { this.ownWorksAccess.allowed = allowed; if (!allowed) this.ownWorksCache = null; this.changed(); }
  private async ownWorksStats(): Promise<OwnWorksStats | null> {
    if (this.ownWorksCache) return this.ownWorksCache;
    const lib = this.ports.artworks;
    if (!lib) return null;
    const scenes: Scene[] = [];
    const first = await lib.list('', 0, 200);
    for (const item of first.items) { const s = await lib.scene(item.id); if (s) scenes.push(s.scene); }
    this.ownWorksCache = statsFromScenes(scenes);
    return this.ownWorksCache;
  }

  /** Saves one compact experiment record (chain, idea, what was seen, verdict) from a draft. No pictures and no conversation. */
  private async recordExperiment(p: Record<string, unknown>): Promise<ServiceResult> {
    if (!this.ports.knowledge) return fail('not_supported', 'The experiment memory is not available in this app.');
    const d = this.drafts.get(p.draft_id as string);
    const sig = chainSignature(this.drafts.current(d));
    const last = d.lastPreview;
    const rec: ExperimentRecord = {
      id: `exp-${this.now().toString(36)}-${d.id.slice(-4)}`, at: this.now(), ...sig, idea: d.idea ?? '', observation: String(p.observation).replace(/\s+/g, ' ').trim().slice(0, 400),
      verdict: p.verdict as ExperimentRecord['verdict'], tags: Array.isArray(p.tags) ? (p.tags as string[]).slice(0, 6) : [],
      ...(last ? { metrics: { objectShare: last.metrics.objectShare, edgeDensity: last.metrics.edgeDensity, brightness: last.metrics.brightness, previewMs: last.ms } } : {}),
    };
    await this.ports.knowledge.record(rec);
    return ok({ recorded: rec.id, chain: rec.chain, verdict: rec.verdict, note: 'Saved locally in the experiment memory (no picture, no conversation).' });
  }

  /** Sections of the artist's own manual that match the words of the query, best first (a simple, deterministic word count; no network). */
  private helpSearch(p: Record<string, unknown>): ServiceResult {
    const words = String(p.query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
    if (!words.length) return fail('invalid_params', 'Write one or more search words.');
    const scored = (helpIndex.sections as { id: string; title: string; text: string }[]).map((s) => {
      const title = s.title.toLowerCase(), text = s.text.toLowerCase();
      return { s, score: words.reduce((n, w) => n + (title.includes(w) ? 5 : 0) + Math.min(5, text.split(w).length - 1), 0) };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, p.limit as number);
    if (!scored.length) return fail('not_found', 'The manual has no section about that. Ask the artist to search with Ctrl+K in the program, or use noema_explain_setting.');
    return ok({ sections: scored.map(({ s }) => ({ id: s.id, title: s.title, text: s.text })), note: 'This is the artist\'s own manual (Help ▸ User manual).' });
  }

  private targetScene(target: string): { scene: Scene; draft?: Draft } {
    if (target === 'current') return { scene: this.ports.scene() };
    const draft = this.drafts.get(target);
    return { scene: this.drafts.current(draft), draft };
  }

  private inspect(p: Record<string, unknown>): ServiceResult {
    const { scene, draft } = this.targetScene(p.target as string);
    const sections = (Array.isArray(p.sections) && p.sections.length ? p.sections : DEFAULT_SECTIONS) as Section[];
    return ok({
      target: p.target, ...(draft ? { state: draft.state, revisions: draft.revisions.length - 1 } : {}),
      sections: summarizeScene(scene, this.ports.formulas(), sections),
      available: SECTIONS,
    });
  }

  private async listMaterials(p: Record<string, unknown>): Promise<ServiceResult> {
    const words = String(p.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const list = (await this.ports.materials.list()).filter((m) => words.every((w) => `${m.title} ${m.group}`.toLowerCase().includes(w)));
    return ok({ total: list.length, items: list.slice(0, p.limit as number).map((m) => ({ id: m.id, title: m.title, group: m.group })) });
  }

  private async listArtworks(p: Record<string, unknown>): Promise<ServiceResult> {
    if (!this.ports.artworks) return fail('not_supported', 'The artwork library is not available in this app.');
    const offset = p.offset as number, limit = p.limit as number;
    const r = await this.ports.artworks.list(String(p.query ?? ''), offset, limit);
    return ok({ total: r.total, offset, items: r.items.map((x) => ({ id: x.id, title: String(redact(x.title)), type: x.type })), ...(offset + limit < r.total ? { nextOffset: offset + limit } : {}), note: 'Use the id in noema_create_draft (from: "artwork:<id>"). The original is never changed.' });
  }

  // ---- Poly Haven (session permission + quotas; the artist's own browsing in the material library needs neither) -------------------------------
  private polyHavenGate(): ServiceResult | null {
    if (!this.ports.polyHaven) return fail('not_supported', 'Poly Haven is not available in this app.');
    if (!this.polyHavenAccess.allowed) return fail('permission_needed', 'The artist has not allowed the AI to use Poly Haven in this session. Ask the artist to turn on "Let the AI search and fetch Poly Haven materials" in the AI panel. Meanwhile you can use the materials that already exist (noema_list_materials).');
    return null;
  }
  private async polyHavenSearch(p: Record<string, unknown>): Promise<ServiceResult> {
    const gate = this.polyHavenGate(); if (gate) return gate;
    const limit = this.def.limits.polyHavenSearchesPerSession;
    if (this.polyHavenAccess.searches >= limit) return fail('quota_used', `The quota for Poly Haven searches in this session (${limit}) is used up.`);
    this.polyHavenAccess.searches++;
    try {
      const r = await this.ports.polyHaven!.search({ query: String(p.query ?? ''), category: String(p.category ?? ''), limit: p.limit as number });
      return ok({ total: r.total, items: r.items.map((x) => ({ id: x.id, name: String(redact(x.name)), categories: x.categories.slice(0, 6), authors: x.authors.slice(0, 3), maxResolution: x.maxResolution, downloaded: x.downloaded })), searchesLeft: limit - this.polyHavenAccess.searches, note: 'All Poly Haven materials are CC0. Fetch one with noema_import_polyhaven_material.' });
    } catch (e) { return fail('polyhaven_failed', 'Poly Haven could not be reached: ' + String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  private async polyHavenImport(p: Record<string, unknown>): Promise<ServiceResult> {
    const gate = this.polyHavenGate(); if (gate) return gate;
    const limit = this.def.limits.polyHavenDownloadsPerSession;
    if (this.polyHavenAccess.downloads >= limit) return fail('quota_used', `The quota for Poly Haven downloads in this session (${limit}) is used up.`);
    this.polyHavenAccess.downloads++;
    try {
      const r = await this.ports.polyHaven!.import(String(p.id), (p.resolution as '1k' | '2k') ?? '1k');
      return ok({ material_id: 'saved:' + r.materialId, title: r.title, channels: r.status, license: r.source.license, author: r.source.author, url: r.source.url, downloadsLeft: limit - this.polyHavenAccess.downloads,
        next: 'Use material_id with noema_apply_material_to_draft: as a surface material, or with stop_index as a gradient stop (the colour, roughness, metal and occlusion maps are blended; the normal map is turned off and not blended).' });
    } catch (e) { this.polyHavenAccess.downloads--; return fail('polyhaven_failed', 'The material could not be fetched: ' + String((e as Error)?.message ?? e).slice(0, 200)); }
  }

  // ---- drafts --------------------------------------------------------------------------------------------------------------

  private view(d: Draft): DraftView {
    return {
      draft_id: d.id, label: d.label, state: d.state, changes: d.revisions.length - 1, revisions: d.revisions.length - 1, previews: d.previews,
      liveSceneChangedSinceDraft: d.source?.kind !== 'artwork' && sceneFingerprint(this.ports.scene()) !== d.baseFingerprint, ...(d.requestMessage ? { requestMessage: d.requestMessage } : {}), createdAt: d.createdAt,
      ...(d.source ? { source: d.source } : {}), ...(d.recovered ? { recovered: true } : {}), ...(d.idea ? { idea: d.idea } : {}), ...(d.locks ? { locks: d.locks } : {}),
    };
  }
  draftViews(): DraftView[] { return this.drafts.list().map((d) => this.view(d)); }

  /**
   * Builds a grouped-execution fractal in a NEW draft. The engine's own rules decide (see engine/formula/groupCreate.ts); a refusal returns the engine's
   * sentence and a hint and creates nothing. The live scene, camera, colours and material of the source are copied unchanged, so drafts made from the
   * same source differ in geometry only.
   */
  private async createGroupedDraft(p: Record<string, unknown>): Promise<ServiceResult> {
    const from = (p.from as string) ?? 'current';
    const hasTemplate = typeof p.template === 'string', hasKind = p.kind !== undefined || p.groups !== undefined;
    if (hasTemplate === hasKind) return fail('invalid_params', 'Give either template (a starting point, see noema_list_group_templates) or kind + groups, not both and not neither.');
    let spec: GroupSpec;
    if (hasTemplate) {
      const t = groupTemplate(p.template as string);
      if (!t) return fail('not_found', `Unknown starting point "${String(p.template).slice(0, 60)}". Valid: ${GROUP_TEMPLATES.map((x) => x.id).join(', ')}.`);
      spec = structuredClone(t.spec);
      if (p.julia) spec.julia = p.julia as GroupSpec['julia'];
    } else spec = { kind: p.kind as GroupSpec['kind'], groups: p.groups as GroupSpec['groups'], ...(p.julia ? { julia: p.julia as GroupSpec['julia'] } : {}) };
    const live = this.ports.scene();
    let base: Scene, source: DraftSource;
    if (from === 'current') { base = this.validated(live); source = { kind: 'live' }; }
    else if (from.startsWith('artwork:')) {
      if (!this.ports.artworks) return fail('not_supported', 'The artwork library is not available in this app.');
      const art = await this.ports.artworks.scene(from.slice('artwork:'.length));
      if (!art) return fail('not_found', `The artwork ${from.slice(0, 80)} does not exist. See noema_list_artworks.`);
      base = this.validated(art.scene); source = { kind: 'artwork', id: from.slice('artwork:'.length), title: String(redact(art.title)).slice(0, 120) };
    } else { const parent = this.drafts.get(from); base = this.validated(this.drafts.current(parent)); source = { kind: 'draft', id: from }; }
    const library = this.ports.formulas() as Formula[];
    const built = buildGroupedContent(spec, library, base, () => 'step-' + crypto.randomUUID());
    if (!built.ok) return fail('invalid_grouped_execution', 'The proposal was rejected by the engine. No draft was created. ' + built.errors.slice(0, 5).join(' | '), { errors: built.errors });
    let scene = this.validated({ ...base, content: [built.content, ...base.content.slice(1)] } as Scene);
    // Camera: 'keep' (default) leaves the source camera so drafts stay directly comparable; 'template_hint' uses the starting point's own camera; 'auto_frame' lets the engine propose one.
    // Moving the camera never hides a rendering problem: the framing result says when marching is unreliable or nothing is found.
    const cameraMode = (p.camera as string | undefined) ?? 'keep'; let framing: unknown;
    if (cameraMode === 'template_hint') {
      const hint = hasTemplate ? groupTemplate(p.template as string)?.camera_hint : undefined;
      if (hint) { scene = this.validated({ ...scene, camera: { ...scene.camera, position: [...hint.position], target: [...hint.target], fov_degrees: hint.fov_degrees } } as Scene); framing = { applied: 'template_hint', source: hint.source, visibleShare: hint.visibleShare ?? null }; }
      else framing = { applied: 'none', reason: 'the starting point has no camera proposal (own build); use camera:"auto_frame".' };
    } else if (cameraMode === 'auto_frame') {
      const proposal = frameFractal(scene, library, { budgetMs: 3000 });
      if (proposal.camera && (proposal.status === 'ok' || proposal.status === 'low-confidence')) { scene = this.validated(withFramedCamera(scene, proposal)); framing = { applied: 'auto_frame', status: proposal.status, message: proposal.message, visibleShare: proposal.visibleShare ?? null }; }
      else framing = { applied: 'none', status: proposal.status, message: proposal.message, evidence: proposal.evidence };
    }
    const info = describeExecution((built.content.chain).map((s) => ({ formula: library.find((f) => f.id === s.formula)!, iterations: s.iterations })) as never, built.content.execution!, 1);
    if (p.check_only === true) return ok({ valid: true, check_only: true, execution: info, note: 'The proposal is valid according to the engine. No draft was created.' });
    const idea = typeof p.idea === 'string' && p.idea.trim() ? p.idea.trim().slice(0, 300) : undefined;
    const draft = this.newDraft(scene, live, p.label as string | undefined, source, idea, from.startsWith('draft-') ? this.drafts.get(from).locks : undefined);
    this.save(draft);
    return ok({ draft_id: draft.id, label: draft.label, from, kind: spec.kind, ...(hasTemplate ? { template: p.template } : {}), ...(idea ? { idea } : {}), execution: info,
      ...(framing ? { framing } : {}),
      note: 'The draft is a separate copy with a new group execution; camera (unless otherwise stated), colour and material are the same as in the source. Change it with noema_set_draft_parameters (chain.group.*, chain.step.*), preview it with noema_render_preview. The live scene is untouched.' });
  }

  /**
   * "Frame Fractal" for a draft: finds visible geometry with the engine's own CPU marcher and proposes a camera. With apply:true (default) the draft's camera
   * becomes the proposal as ONE draft step (undo with noema_undo_draft_step); the live scene is never touched. When reliable framing is not possible
   * nothing is changed and the reason is returned (no geometry, camera inside solid, marching unreliable because the distance estimate overshoots).
   */
  private frameDraft(p: Record<string, unknown>): ServiceResult {
    const d = this.drafts.editable(p.draft_id as string);
    const before = this.drafts.current(d);
    const proposal = frameFractal(before, this.ports.formulas() as Formula[], { budgetMs: 3000 });
    const usable = !!proposal.camera && (proposal.status === 'ok' || proposal.status === 'low-confidence');
    if (!usable || p.apply === false) return ok({ draft_id: d.id, applied: false, ...proposal, note: usable ? 'The proposal is not applied (apply:false).' : 'No camera was changed. ' + proposal.message });
    const camera = { ...before.camera, position: [...proposal.camera!.position], target: [...proposal.camera!.target] } as Scene['camera'];
    const r = this.commit(d, before, { ...before, camera }, String(p.note ?? 'inramning av fraktalen'), 1);
    return r.ok ? ok({ ...r.data, applied: true, ...proposal }) : r;
  }

  private listGroupTemplates(): ServiceResult {
    return ok({ kinds: GROUP_KINDS, templates: GROUP_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, kind: t.spec.kind, groups: t.spec.groups.map((g, i) => ({ group: i, steps: g.steps.map((s) => ({ formula: s.formula, iterations: s.iterations })), repeat: g.repeat ?? 0, max_iterations: g.max_iterations })), ...(t.camera_hint ? { camera_hint: t.camera_hint } : {}), source: `the repository's example preset ${t.fixture}` })),
      note: 'Starting points are technical, editable examples from the repository\'s own Mandelbulb 3D examples, not limitations. Own structure: noema_create_grouped_draft with kind + groups. Formula roles: noema_list_formulas (group_roles).' });
  }

  private async createDraft(p: Record<string, unknown>): Promise<ServiceResult> {
    const from = p.from as string;
    const live = this.ports.scene();
    let scene: Scene, source: DraftSource;
    if (from === 'current') { scene = this.validated(live); source = { kind: 'live' }; }
    else if (from.startsWith('artwork:')) {
      if (!this.ports.artworks) return fail('not_supported', 'The artwork library is not available in this app.');
      const id = from.slice('artwork:'.length);
      const art = await this.ports.artworks.scene(id);
      if (!art) return fail('not_found', `The artwork ${id.slice(0, 80)} does not exist. See noema_list_artworks.`);
      scene = this.validated(art.scene); // a COPY, read through the application's own parser
      source = { kind: 'artwork', id, title: String(redact(art.title)).slice(0, 120) };
    } else { const parent = this.drafts.get(from); scene = this.validated(this.drafts.current(parent)); source = { kind: 'draft', id: from }; }
    const idea = typeof p.idea === 'string' && p.idea.trim() ? p.idea.trim().slice(0, 300) : undefined;
    const draft = this.newDraft(scene, live, p.label as string | undefined, source, idea, from.startsWith('draft-') ? this.drafts.get(from).locks : undefined);
    this.save(draft);
    return ok({ draft_id: draft.id, label: draft.label, from, ...(idea ? { idea } : {}), ...(draft.locks ? { locked: lockedKeys(draft.locks).map((k) => LOCK_LABELS[k]) } : {}), note: source.kind === 'artwork' ? `The draft is a separate copy of "${source.title}". The original and its thumbnail are never changed.` : 'The draft is a separate copy. Change it freely; the live scene is not affected.' });
  }

  private setting(id: string): SettingDef {
    const s = (this.def.settings as SettingDef[]).find((x) => x.id === id);
    if (!s) throw new ChangeError(`Unknown setting: ${id.slice(0, 60)}. See noema_get_capabilities.`);
    return s;
  }

  private applyOne(scene: Scene, c: { setting_id: string; value: unknown; index?: number; name?: string }): Scene {
    const s = this.setting(c.setting_id);
    const v = c.value;
    if (s.needsIndex && c.index === undefined) throw new ChangeError(`${s.id} requires index.`);
    if (s.needsName && c.name === undefined) throw new ChangeError(`${s.id} requires name (the name of the parameter).`);
    if (!s.needsIndex && c.index !== undefined) throw new ChangeError(`${s.id} takes no index.`);
    // generic type/range check from the manifest (formula parameter ranges are checked below)
    if (!s.rangeFrom) {
      const schema: JsonSchema = { type: s.type, ...(s.values ? { enum: s.values } : {}), ...(s.range ? { minimum: s.range[0], maximum: s.range[1] } : {}), ...(s.pattern ? { pattern: s.pattern } : {}) };
      const bad = validateAgainst(schema, v, 'value');
      if (bad.length) throw new ChangeError(`${s.id}: ${bad.join('; ')}`);
    }
    // The gradient helpers reject bad requests with a plain Error and a readable Swedish message (for example "a transition belongs to a stop
    // that has a next stop"). Those messages are for the model, so they become change errors instead of an opaque internal error.
    // Anything that is not a plain Error (a real bug) still surfaces as internal_error.
    const viaHelper = <T,>(fn: () => T): T => { try { return fn(); } catch (e) { if (e instanceof Error && e.constructor === Error) throw new ChangeError(`${s.id}: ${e.message}`); throw e; } };
    const gradient = () => editableGradient(scene.color.gradient);
    const stops = () => gradient().stops;
    const stopIndex = (): number => { const i = c.index!; if (i >= stops().length) throw new ChangeError(`${s.id}: colour stop ${i} does not exist (the gradient has ${stops().length} stops, index 0–${stops().length - 1}).`); return i; };
    const guard = (next: Scene, what: string): Scene => { if (next === scene) throw new ChangeError(`${s.id}: ${what}`); return next; };
    const step = (): { formula: string } => { const f = scene.content[0]; const st = f && f.type === 'fractal' ? f.chain[c.index!] : undefined; if (!st) throw new ChangeError(`${s.id}: step ${c.index} does not exist.`); return st; };
    const groupedFractal = () => { const f = scene.content[0]; if (!f || f.type !== 'fractal' || !f.execution) throw new ChangeError(`${s.id}: the scene has no group execution. Import a Mandelbulb 3D artwork with execution groups first (see noema_inspect_scene, section chain, the field execution).`); return f; };
    // A grouped scene is only valid when the engine accepts the whole execution; the engine's own message is returned so the model can correct itself.
    const grouped = (next: Scene): Scene => {
      const f = next.content[0];
      if (!f || f.type !== 'fractal' || !f.execution) return next;
      const r = resolveScene(next, this.ports.formulas() as Formula[]);
      if (!r.ok) throw new ChangeError(`${s.id}: the engine rejects the group execution: ${r.errors.slice(0, 3).join('; ')}`);
      return next;
    };
    const chainLength = (): number => { const f = scene.content[0]; return f && f.type === 'fractal' ? f.chain.length : 0; };
    const formula = (id: string): Formula => { const f = this.ports.formulas().find((x) => x.id === id); if (!f) throw new ChangeError(`The formula ${id.slice(0, 60)} does not exist. See noema_list_formulas.`); return f; };
    switch (s.id) {
      case 'camera.fov_degrees': return { ...scene, camera: { ...scene.camera, fov_degrees: v as number } };
      case 'color.measure': case 'color.cycles': case 'color.offset': case 'color.wrap': return withColor(scene, { [s.id.slice(6)]: v } as Partial<Scene['color']>);
      case 'color.gradient.stop.color': { const i = stopIndex(); return withColor(scene, { gradient: viaHelper(() => colorStop(scene.color.gradient, i, String(v).toLowerCase())) }); }
      case 'color.gradient.stop.position': { const i = stopIndex(); if (i === 0 || i === stops().length - 1) throw new ChangeError(`${s.id}: the first and last stops cannot be moved.`); return withColor(scene, { gradient: viaHelper(() => moveStop(scene.color.gradient, i, v as number).gradient) }); }
      case 'color.gradient.stop.softness': { const i = stopIndex(); return withColor(scene, { gradient: viaHelper(() => setSoftness(scene.color.gradient, i, v as number)) }); }
      case 'color.gradient.stop.texture_scale': { const i = stopIndex(); return withColor(scene, { gradient: viaHelper(() => setTextureScale(scene.color.gradient, i, v as number)) }); }
      case 'color.gradient.stop.transition': { const i = stopIndex(); return withColor(scene, { gradient: viaHelper(() => setTransition(scene.color.gradient, i, v as number)) }); }
      case 'color.gradient.stop.kind': { const i = stopIndex(); return withColor(scene, { gradient: viaHelper(() => setStopKind(scene.color.gradient, i, v as 'color' | 'material')) }); }
      case 'material.metallic': case 'material.roughness': case 'material.reflectivity': return { ...scene, material: { ...scene.material, [s.id.slice(9)]: v as number } };
      case 'chain.step.parameter': {
        const f = formula(step().formula), param = f.parameters.find((x) => x.name === c.name);
        if (!param) throw new ChangeError(`${s.id}: ${f.id} has no parameter ${c.name}. Valid: ${f.parameters.map((x) => x.name).join(', ')}.`);
        if (typeof v !== 'number' || !Number.isFinite(v) || v < param.min || v > param.max) throw new ChangeError(`${s.id}: ${param.name} must be a number between ${param.min} and ${param.max}.`);
        return guard(withStepParameter(scene, c.index!, c.name!, v), 'could not be changed.');
      }
      case 'chain.step.iterations': step(); return guard(withStepIterations(scene, c.index!, v as number), 'could not be changed.');
      case 'chain.step.formula': step(); return grouped(guard(setStepFormula(scene, c.index!, formula(v as string)), 'could not be changed.'));
      case 'chain.step.add': return grouped(guard(addStep(scene, formula(v as string)), 'the chain already has at most 8 steps.'));
      case 'chain.step.insert': { const why = stepEditRefusal(scene, { op: 'insert', index: c.index! }); if (why) throw new ChangeError(`${s.id}: ${why}.`); return grouped(guard(addStep(scene, formula(v as string), c.index!), 'the chain already has at most 8 steps.')); }
      case 'chain.step.move': { step(); if ((v as number) >= chainLength()) throw new ChangeError(`${s.id}: the target position ${v} does not exist (the chain has ${chainLength()} steps).`); const why = stepEditRefusal(scene, { op: 'move', from: c.index!, to: v as number }); if (why) throw new ChangeError(`${s.id}: ${why}`); return grouped(guard(moveStep(scene, c.index!, v as number), 'the step is already there.')); }
      case 'chain.group.repeat': case 'chain.group.max_iterations': { const f = groupedFractal(); const g = f.execution!.groups[c.index!]; if (!g) throw new ChangeError(`${s.id}: group ${c.index} does not exist (0 to ${f.execution!.groups.length - 1}).`); return grouped(guard(withExecutionGroup(scene, c.index!, s.id === 'chain.group.repeat' ? 'repeat' : 'maxIterations', v as number), 'could not be changed.')); }
      case 'chain.group.append_step': case 'chain.group.prepend_step': {
        const f = groupedFractal(), g = f.execution!.groups[c.index!]; if (!g) throw new ChangeError(`${s.id}: group ${c.index} does not exist (0 to ${f.execution!.groups.length - 1}).`);
        const at = s.id === 'chain.group.append_step' ? g.end + 1 : g.start;
        return grouped(guard(addStep(scene, formula(v as string), at, c.index!), 'the chain already has at most 8 steps.'));
      }
      case 'chain.rounds': return guard(withRounds(scene, v as number), 'the iteration count is already that.');
      case 'chain.mode': return guard(withChainMode(scene, v as ChainMode), 'the mode is already that.');
      case 'chain.step.remove': { step(); if (v !== true) throw new ChangeError(`${s.id}: the value must be true.`); const why = stepEditRefusal(scene, { op: 'remove', index: c.index! }); if (why) throw new ChangeError(`${s.id}: ${why}.`); return grouped(guard(removeStep(scene, c.index!), 'the last step cannot be removed.')); }
      default: throw new ChangeError(`${s.id} is not connected yet.`);
    }
  }

  /** Re-reads the scene through the application's own parser; the result is what would be saved and opened. */
  private validated(scene: Scene): Scene {
    const parsed = parseScene(structuredClone(scene) as unknown);
    if (!parsed.ok) throw new ChangeError('The result was not a valid scene: ' + parsed.errors.slice(0, 4).join('; '));
    return parsed.scene;
  }

  private diffNote(before: Scene, after: Scene): { entries: DiffEntry[]; total: number } { return diffScenes(before, after, this.ports.formulas(), 40); }

  private setParameters(p: Record<string, unknown>): ServiceResult {
    const d = this.drafts.editable(p.draft_id as string);
    const before = this.drafts.current(d);
    const changes = p.changes as { setting_id: string; value: unknown; index?: number; name?: string }[];
    let working = structuredClone(before);
    const problems: string[] = [];
    changes.forEach((c, i) => { try { working = this.applyOne(working, c); } catch (e) { if (e instanceof ChangeError) problems.push(`change ${i}: ${e.message}`); else throw e; } });
    if (problems.length) return fail('invalid_changes', 'No change was made. ' + problems.slice(0, 8).join(' | '), { problems });
    const after = this.validated(working);
    this.drafts.push(d, after, String(p.note ?? `${changes.length} changes`), changes.length, this.now());
    this.save(d);
    const warnings = this.warningsFor(changes.map((c) => c.setting_id));
    return ok({ draft_id: d.id, revision: d.revisions.length - 1, applied: changes.length, diff: this.diffNote(before, after), warnings });
  }

  private warningsFor(ids: string[]): string[] {
    const w: string[] = [];
    if (ids.some((i) => i.startsWith('color.gradient.stop.transition') || i === 'color.gradient.stop.kind')) w.push('The material transition is sharpest at about 3 % of the gradient (32-entry table).');
    return w;
  }

  private async applyMaterial(p: Record<string, unknown>): Promise<ServiceResult> {
    const d = this.drafts.editable(p.draft_id as string);
    const before = this.drafts.current(d);
    const id = p.material_id as string;
    const snapshot = await this.ports.materials.snapshot(id);
    if (!snapshot) return fail('not_found', `The material ${id.slice(0, 60)} does not exist. See noema_list_materials.`);
    let after: Scene, applied: 'surface' | 'gradient_stop', warnings: string[] = [];
    if (p.stop_index === undefined) {
      const full = this.ports.materials.settings ? await this.ports.materials.settings(id) : id.startsWith('builtin:') ? structuredClone(MATERIAL_PRESETS[id.slice(8)] ?? null) : null;
      if (!full) return fail('not_supported', 'This material cannot be applied as a surface material here.');
      after = this.validated({ ...before, material: structuredClone(full) });
      applied = 'surface';
      if (snapshot.notBlended?.length) warnings.push(`The material has properties that are not part of gradient blending: ${snapshot.notBlended.join(', ')}. As a surface material the whole material applies.`);
    } else {
      const index = p.stop_index as number;
      if (index >= editableGradient(before.color.gradient).stops.length) return fail('change_rejected', `Colour stop ${index} does not exist.`);
      try { after = this.validated(withColor(before, { gradient: setStopMaterial(before.color.gradient, index, snapshot) })); } catch (e) { return fail('change_rejected', (e as Error).message); }
      applied = 'gradient_stop';
      warnings = ['Material gradient blends metal, roughness, reflectivity, tone and the picture maps for colour, roughness, metal and occlusion.', ...(snapshot.notBlended?.length ? [`Not blended: ${snapshot.notBlended.join(', ')}.`] : []), 'Geometry Detail together with a material gradient is not verified.', 'The material transition is sharpest at about 3 % of the gradient.'];
    }
    this.drafts.push(d, after, `material ${snapshot.name ?? id}`, 1, this.now());
    this.save(d);
    return ok({ draft_id: d.id, revision: d.revisions.length - 1, applied, material: { id, name: snapshot.name ?? null }, notBlended: snapshot.notBlended ?? [], ...(snapshot.textures ? { texturesBlended: stopImageMaps(snapshot).map((x) => x.channel), textureScale: snapshot.textureScale ?? 1, texturedMaterialsInGradient: texturedEntries(after.color.gradient.stops).length, maxTexturedMaterials: MAX_TEXTURED_MATERIALS } : {}), warnings, diff: this.diffNote(before, after) });
  }

  private commit(d: Draft, before: Scene, after: Scene, note: string, changes: number): ServiceResult {
    const valid = this.validated(after);
    this.drafts.push(d, valid, note, changes, this.now());
    this.save(d);
    return ok({ draft_id: d.id, revision: d.revisions.length - 1, diff: this.diffNote(before, valid) });
  }

  private setCamera(p: Record<string, unknown>): ServiceResult {
    const d = this.drafts.editable(p.draft_id as string);
    const before = this.drafts.current(d);
    const move: CameraMove = {};
    for (const k of ['look_at', 'orbit_yaw_degrees', 'orbit_pitch_degrees', 'dolly_factor', 'roll_degrees', 'fov_degrees'] as const) if (p[k] !== undefined) (move as Record<string, unknown>)[k] = p[k];
    const keys = Object.keys(move);
    if (!keys.length) return fail('invalid_params', 'Give at least one camera move (look_at, orbit_yaw_degrees, orbit_pitch_degrees, dolly_factor, roll_degrees or fov_degrees).');
    let camera;
    try { camera = moveCamera(before.camera, move); } catch (e) { if (e instanceof CameraMoveError) return fail('change_rejected', e.message); throw e; }
    return this.commit(d, before, { ...before, camera }, String(p.note ?? `camera: ${keys.join(', ')}`), keys.length);
  }

  private setLight(p: Record<string, unknown>): ServiceResult {
    const d = this.drafts.editable(p.draft_id as string);
    const before = this.drafts.current(d);
    const lights: LightSettings[] = structuredClone(before.lights);
    const fields = ['enabled', 'type', 'color', 'intensity', 'direction', 'position', 'cone_degrees', 'cone_softness', 'shadows', 'shadow_softness'] as const;
    const index = p.index as number | undefined;
    if (p.remove === true) {
      if (index === undefined) return fail('invalid_params', 'remove requires index.');
      if (index >= lights.length) return fail('change_rejected', `Light ${index} does not exist (the scene has ${lights.length}).`);
      lights.splice(index, 1);
      return this.commit(d, before, { ...before, lights }, String(p.note ?? `removed light ${index}`), 1);
    }
    const patch: Record<string, unknown> = {};
    for (const k of fields) if (p[k] !== undefined) patch[k] = p[k];
    let target: LightSettings, note: string;
    if (index === undefined) {
      if (lights.length >= MAX_LIGHTS) return fail('change_rejected', `The scene already has ${MAX_LIGHTS} lights. Remove or change one.`);
      target = defaultLight(); target.intensity = 1; target.shadows = 'none';
      lights.push(target); note = `new light ${lights.length - 1}`;
    } else {
      if (index >= lights.length) return fail('change_rejected', `Light ${index} does not exist (the scene has ${lights.length}). Omit index to add a new one.`);
      if (!Object.keys(patch).length) return fail('invalid_params', 'Give at least one field to change.');
      target = lights[index]!; note = `light ${index}: ${Object.keys(patch).join(', ')}`;
    }
    if (patch.direction && Math.hypot(...(patch.direction as number[])) < 1e-9) return fail('change_rejected', 'direction must not be (0, 0, 0).');
    Object.assign(target, patch);
    for (const [k, [lo, hi]] of Object.entries(LIGHT_LIMITS)) { const v = (target as unknown as Record<string, unknown>)[k]; if (typeof v === 'number' && (v < lo || v > hi)) return fail('change_rejected', `${k} must be between ${lo} and ${hi}.`); }
    return this.commit(d, before, { ...before, lights }, String(p.note ?? note), Math.max(1, Object.keys(patch).length));
  }

  private setAmbient(p: Record<string, unknown>): ServiceResult {
    const d = this.drafts.editable(p.draft_id as string);
    const before = this.drafts.current(d);
    const ambient = { ...before.ambient };
    if (p.color === undefined && p.intensity === undefined) return fail('invalid_params', 'Give color and/or intensity.');
    if (p.color !== undefined) ambient.color = String(p.color).toLowerCase();
    if (p.intensity !== undefined) {
      const [lo, hi] = AMBIENT_LIMITS.intensity;
      if ((p.intensity as number) < lo || (p.intensity as number) > hi) return fail('change_rejected', `intensity must be between ${lo} and ${hi}.`);
      ambient.intensity = p.intensity as number;
    }
    return this.commit(d, before, { ...before, ambient }, String(p.note ?? 'omgivningsljus'), Object.keys(p).filter((k) => k === 'color' || k === 'intensity').length);
  }

  private undoStep(p: Record<string, unknown>): ServiceResult {
    const d = this.drafts.editable(p.draft_id as string);
    this.drafts.undo(d);
    this.save(d);
    return ok({ draft_id: d.id, revision: d.revisions.length - 1 });
  }

  private discardDraft(p: Record<string, unknown>): ServiceResult {
    const d = this.drafts.get(p.draft_id as string);
    this.drafts.discard(d);
    this.persistence?.remove(d.id);
    return ok({ draft_id: d.id, discarded: true, liveSceneUntouched: true });
  }

  private requestApply(p: Record<string, unknown>): ServiceResult {
    const d = this.drafts.editable(p.draft_id as string);
    if (d.revisions.length <= 1) return fail('nothing_to_apply', 'The draft has no changes to apply.');
    d.state = 'awaiting_user_confirmation';
    if (typeof p.message === 'string') d.requestMessage = String(redact(p.message));
    this.save(d);
    return ok({ draft_id: d.id, state: d.state, note: 'The artist sees the draft in the app and chooses Use or Reject. You cannot apply it yourself. Ask for the state with noema_list_drafts.' });
  }

  private async preview(p: Record<string, unknown>, signal: AbortSignal): Promise<ServiceResult> {
    if (!this.ports.render) return fail('preview_unavailable', 'Previews are not available in this app right now.');
    const target = p.target as string;
    const { scene, draft } = this.targetScene(target);
    if (draft && draft.previews >= this.def.limits.maxPreviewsPerDraft) return fail('preview_budget_used', `The draft already has ${draft.previews} previews (at most ${this.def.limits.maxPreviewsPerDraft}). Create a new draft from this one for more.`);
    if (this.rendering) return fail('busy', 'A preview is already being drawn. Wait until it is finished.');
    this.rendering = true;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 180_000);
    const onAbort = (): void => timeout.abort();
    signal.addEventListener('abort', onAbort);
    try {
      const image = await this.ports.render(structuredClone(scene), { samples: p.samples as 1 | 2, width: p.width as 256 | 512, signal: timeout.signal });
      if (draft) { draft.previews++; this.rememberPreview(draft, image); this.save(draft); }
      const diagnostics = (() => { try { return this.diagnoseCached(scene); } catch { return undefined; } })();
      return ok({ target, ...(diagnostics ? { diagnostics } : {}), width: image.width, height: image.height, ms: Math.round(image.ms), samples: p.samples, geometryDetail: 'av', ...(image.metrics ? { shape: { objectShare: image.metrics.objectShare, edgeDensity: image.metrics.edgeDensity, brightness: image.metrics.brightness } } : {}), ...(draft ? { previewsLeft: this.def.limits.maxPreviewsPerDraft - draft.previews } : {}) }, { mime: image.mime, base64: image.base64 });
    } catch (e) {
      if (timeout.signal.aborted) return fail('cancelled', signal.aborted ? 'Avbrutet.' : 'The preview took too long (180 s) and was cancelled.');
      return fail('preview_failed', 'The preview could not be drawn: ' + String((e as Error)?.message ?? e).slice(0, 200));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      this.rendering = false;
    }
  }

  private diagCache = new Map<string, ReturnType<typeof diagnoseVisible>>();
  /** The CPU diagnostics depend only on the chain, camera, render quality and formula set, so the same state is measured once. */
  private diagnoseCached(scene: Scene): ReturnType<typeof diagnoseVisible> {
    const formulas = this.ports.formulas() as Formula[];
    const key = JSON.stringify([scene.content[0], scene.camera, scene.render?.quality, scene.render?.format, formulas.length]);
    const hit = this.diagCache.get(key); if (hit) return hit;
    const fresh = diagnoseVisible(scene, formulas);
    if (this.diagCache.size >= 16) this.diagCache.delete(this.diagCache.keys().next().value as string);
    this.diagCache.set(key, fresh); return fresh;
  }

  /** Keeps the colour-independent measurements of a draft's latest preview (they feed noema_record_experiment). */
  private rememberPreview(draft: Draft, image: RenderedPreview): void {
    if (image.metrics) draft.lastPreview = { metrics: image.metrics, ms: Math.round(image.ms), width: image.width };
  }

  /** Renders A and B at the same size and returns one picture, A left and B right. Counts as two previews of each draft involved. */
  private async compare(p: Record<string, unknown>, signal: AbortSignal): Promise<ServiceResult> {
    if (!this.ports.render || !this.ports.compose) return fail('preview_unavailable', 'Comparison is not available in this app right now.');
    const a = this.targetScene(p.a as string), b = this.targetScene(p.b as string);
    for (const x of [a.draft, b.draft]) if (x && x.previews >= this.def.limits.maxPreviewsPerDraft) return fail('preview_budget_used', `The draft ${x.id} already has ${x.previews} previews (at most ${this.def.limits.maxPreviewsPerDraft}).`);
    if (this.rendering) return fail('busy', 'A preview is already being drawn. Wait until it is finished.');
    this.rendering = true;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 240_000);
    const onAbort = (): void => timeout.abort();
    signal.addEventListener('abort', onAbort);
    try {
      const opts = { samples: p.samples as 1 | 2, width: p.width as 256 | 512, signal: timeout.signal };
      const left = await this.ports.render(structuredClone(a.scene), opts);
      const right = await this.ports.render(structuredClone(b.scene), opts);
      const both = await this.ports.compose(left, right);
      for (const x of new Set([a.draft, b.draft])) if (x) { x.previews += a.draft === b.draft ? 2 : 1; this.save(x); }
      if (a.draft) this.rememberPreview(a.draft, left);
      if (b.draft) this.rememberPreview(b.draft, right);
      const geometry = left.metrics && right.metrics ? geometryDifference(left.metrics, right.metrics) : undefined;
      return ok({ a: p.a, b: p.b, left: 'A', right: 'B', width: both.width, height: both.height, ms: Math.round(left.ms + right.ms), ...(geometry ? { geometryDifference: geometry } : {}) },{ mime: both.mime, base64: both.base64 });
    } catch (e) {
      if (timeout.signal.aborted) return fail('cancelled', signal.aborted ? 'Avbrutet.' : 'The comparison took too long and was cancelled.');
      return fail('preview_failed', 'The comparison could not be drawn: ' + String((e as Error)?.message ?? e).slice(0, 200));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      this.rendering = false;
    }
  }

  // ---- the artist's actions (NOT operations: handle() never routes here) ---------------------------------------------------

  /** The artist pressed Använd. Applies the draft as one reversible transaction; refuses a changed live scene unless forced. */
  confirmApply(id: string, options: { force?: boolean } = {}): { ok: true } | { ok: false; code: string; message: string } {
    let d: Draft;
    try { d = this.drafts.get(id); } catch (e) { return { ok: false, code: (e as DraftError).code, message: (e as Error).message }; }
    if (!isOpen(d)) return { ok: false, code: 'draft_closed', message: `The draft is ${stateText(d.state)}.` };
    if (d.revisions.length <= 1) return { ok: false, code: 'nothing_to_apply', message: 'The draft has no changes.' };
    // A draft made from a saved artwork is meant to replace the current scene (the artist sees that in the panel), so no conflict check.
    if (!options.force && d.source?.kind !== 'artwork' && sceneFingerprint(this.ports.scene()) !== d.baseFingerprint) {
      return { ok: false, code: 'conflict', message: 'The scene has changed since the draft was created. If you use the draft, these later changes are replaced (you can undo).' };
    }
    this.ports.applyToLive(structuredClone(this.drafts.current(d)));
    d.state = 'applied';
    this.save(d);
    this.actionLog.push({ time: this.now(), op: 'artist.apply_draft', ok: true, summary: d.label });
    this.changed();
    return { ok: true };
  }

  declineDraft(id: string): void {
    const d = this.drafts.get(id);
    if (!isOpen(d)) return;
    d.state = 'declined';
    this.save(d);
    this.actionLog.push({ time: this.now(), op: 'artist.decline_draft', ok: true, summary: d.label });
    this.changed();
  }

  discardFromUi(id: string): void { this.drafts.discard(this.drafts.get(id)); this.persistence?.remove(id); this.changed(); }

  /** The artist has seen the recovery notice: it is cleared, the drafts themselves stay as they are. */
  acknowledgeRecovery(): void { this.recovery = { ...this.recovery, restored: 0, warnings: [], problems: [] }; this.changed(); }

  /** What the panel shows: the changes compared with the live scene as it is now. */
  draftChanges(id: string): { entries: DiffEntry[]; total: number } {
    const d = this.drafts.get(id);
    return diffScenes(this.drafts.revisionBase(d), this.drafts.current(d), this.ports.formulas(), 40);
  }
}
