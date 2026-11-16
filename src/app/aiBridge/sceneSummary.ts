/**
 * What the AI may see of a scene, and how two scenes are compared. Nothing here changes a scene.
 *
 * Privacy rule (docs/ai-bridge/PRIVACY-PERMISSIONS-CHECKLIST.md §C): the summary never contains embedded images (`data:` addresses),
 * absolute file paths or other library entries. Every string passes through `redact`.
 */
import { stopImageMaps } from '../../engine/materialRamp';
import { collectCredits } from '../../engine/scene';
import type { Scene } from '../../engine/scene';
import type { Formula } from '../../engine/formula/types';
import { describeExecution } from '../../engine/formula/executionSummary';
import type { FractalContent } from '../../engine/scene';

export const SECTIONS = ['camera', 'color', 'material', 'chain', 'render', 'lights', 'credits'] as const;
export type Section = (typeof SECTIONS)[number];
export const DEFAULT_SECTIONS: readonly Section[] = ['camera', 'color', 'material', 'chain', 'render'];

const PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|file:)/;

/** Replaces images and paths, shortens long text, and limits depth and list length. Returns a new value. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `[embedded data omitted, ${value.length} characters]`;
    if (PATH.test(value)) return '[path omitted]';
    return value.length > 500 ? value.slice(0, 500) + '…' : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[too deep structure omitted]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (v !== undefined) out[k] = redact(v, depth + 1);
  return out;
}

const asNumberOrFollows = (p: unknown): unknown => (typeof p === 'number' ? p : { följerYtan: true, mått: (p as { measure?: string } | undefined)?.measure });

/** A sanitised, JSON-safe summary of chosen sections of the scene. */
export function summarizeScene(scene: Scene, formulas: readonly Formula[], sections: readonly Section[] = DEFAULT_SECTIONS): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const section of sections) {
    if (section === 'camera') out.camera = redact(scene.camera);
    else if (section === 'color') {
      const c = scene.color;
      out.color = {
        measure: c.measure, cycles: c.cycles, offset: c.offset, wrap: c.wrap, hasPictureTexture: !!c.texture,
        gradient: {
          name: c.gradient.name ?? null,
          stops: c.gradient.stops.map((s, index) => ({
            index, position: s.position, color: s.color, kind: s.material?.active ? 'material' : 'color',
            ...(s.transition !== undefined ? { transition: s.transition } : {}),
            ...(s.softness !== undefined ? { softness: s.softness } : {}),
            ...(s.material ? { material: { name: s.material.name ?? null, active: s.material.active, metallic: s.material.metallic, roughness: s.material.roughness, reflectivity: s.material.reflectivity, notBlended: s.material.notBlended ?? [],
              // MG-02: which PBR maps blend (channel, strength, mode: never the image), their one shared scale, and where the material came from
              ...(stopImageMaps(s.material).length ? { maps: stopImageMaps(s.material).map((x) => ({ channel: x.channel, strength: x.strength, mode: x.mode })), textureScale: s.material.textureScale ?? 1 } : {}),
              ...(s.material.source ? { source: redact(s.material.source) } : {}) } } : {}),
          })),
        },
      };
    } else if (section === 'material') {
      const m = scene.material;
      const maps = Object.entries(m.textures?.maps ?? {}).filter(([, v]) => v?.enabled && v.texture).map(([k]) => k);
      out.material = {
        metallic: asNumberOrFollows(m.metallic), roughness: asNumberOrFollows(m.roughness), reflectivity: asNumberOrFollows(m.reflectivity),
        ...(m.baseColor ? { baseColor: m.baseColor } : {}), ...(m.emissionStrength ? { emissionStrength: m.emissionStrength } : {}),
        ...(m.transmission ? { transmission: m.transmission } : {}),
        textureMaps: maps, displacement: !!m.displacement?.enabled,
      };
    } else if (section === 'chain') {
      const f = scene.content[0];
      out.chain = f && f.type === 'fractal'
        ? { rounds: f.rounds, steps: f.chain.map((s, index) => ({ index, formula: s.formula, name: formulas.find((x) => x.id === s.formula)?.name ?? null, iterations: s.iterations, parameters: s.parameters })), execution: executionSection(f, formulas) }
        : { steps: [] };
    } else if (section === 'render') out.render = redact(scene.render);
    else if (section === 'lights') { out.lights = redact(scene.lights); out.ambient = redact(scene.ambient); } // ambient belongs to the lighting: without it a change made with noema_set_draft_ambient would be invisible
    else if (section === 'credits') out.credits = redact(collectCredits(scene, formulas));
  }
  return out;
}

/** FNV-1a over the scene's JSON: only used to notice that the live scene changed under a draft. */
export function sceneFingerprint(scene: Scene): string {
  const text = JSON.stringify(scene);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + ':' + text.length;
}

export interface DiffEntry { path: string; from: unknown; to: unknown }

function flatten(value: unknown, path: string, out: Map<string, unknown>): void {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    if (entries.length === 0) out.set(path, Array.isArray(value) ? '[]' : '{}');
    for (const [k, v] of entries) flatten(v, path ? `${path}.${k}` : k, out);
  } else out.set(path, value);
}

/** The differences between two summaries, as `path: from -> to`, at most `limit`. */
export function diffSummaries(a: Record<string, unknown>, b: Record<string, unknown>, limit = 60): { entries: DiffEntry[]; total: number } {
  const fa = new Map<string, unknown>(), fb = new Map<string, unknown>();
  flatten(a, '', fa); flatten(b, '', fb);
  const entries: DiffEntry[] = [];
  let total = 0;
  for (const key of new Set([...fa.keys(), ...fb.keys()])) {
    const x = fa.get(key), y = fb.get(key);
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    total++;
    if (entries.length < limit) entries.push({ path: key, from: x ?? null, to: y ?? null });
  }
  return { entries, total };
}

/** Compares two full scenes in all the summary sections that matter for a picture. */
export function diffScenes(a: Scene, b: Scene, formulas: readonly Formula[], limit = 60): { entries: DiffEntry[]; total: number } {
  const sections: Section[] = ['camera', 'color', 'material', 'chain', 'render', 'lights'];
  return diffSummaries(summarizeScene(a, formulas, sections), summarizeScene(b, formulas, sections), limit);
}

/** The grouped execution of a fractal (null for an ordinary chain): kind, groups with their steps and roles, repeat points, call limits, and the engine's own verdict. */
function executionSection(f: FractalContent, formulas: readonly Formula[]): unknown {
  if (!f.execution) return null;
  const steps = f.chain.map((s) => ({ formula: formulas.find((x) => x.id === s.formula), iterations: s.iterations, every: s.every, start: s.start }));
  if (steps.some((s) => !s.formula)) return { kind: f.execution.kind, errors: ['a formula in the chain does not exist in the library'] };
  return describeExecution(steps as never, f.execution, f.rounds);
}
