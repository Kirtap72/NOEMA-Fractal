/**
 * ARTIST-WORKFLOW 07: locks for AI drafts. The artist can lock camera, lighting, materials or the structure of the formula chain. A lock is NOT a hint to
 * the AI: it is checked in code every time a draft is created or changed (DraftStore.push and AppService.createDraft), whichever tool or AI host makes the
 * change, and a change that touches a locked part is refused as a whole with a readable reason. The draft keeps the scene it started from (revision 0) as
 * the reference: every later revision must leave the locked parts exactly as they were there, and revision 0 itself must equal the live scene in them.
 *
 * What each lock keeps still:
 *   camera   : the whole camera (position, target, field of view, depth of field, projection).
 *   lights   : the light sources, the ambient light and the environment (sky or picture).
 *   material : the surface material and the colour settings (gradient, measure, cycles, offset, wrap, texture).
 *   formula  : the STRUCTURE of the chain: which formulas, in which order, how they are combined (mode, repeats, grouped execution). Parameter values and the
 *              number of iterations of a step stay free, because they are the usual way to explore a form without changing what it is made of.
 *
 * Keeping the local look of a marked region is a different matter: that is an artistic wish passed to the AI in words, never a guarantee, and never a lock.
 */
import type { Scene } from "./scene";

export const LOCK_KEYS = ["camera", "lights", "material", "formula"] as const;
export type LockKey = (typeof LOCK_KEYS)[number];
export type DraftLocks = Partial<Record<LockKey, boolean>>;

export const LOCK_LABELS: Record<LockKey, string> = { camera: "camera", lights: "lights", material: "material", formula: "formula structure" };
export const LOCK_EXPLANATIONS: Record<LockKey, string> = {
  camera: "the position, target, field of view and depth of field of the camera",
  lights: "the light sources, the ambient light and the environment",
  material: "the surface material and the colouring (the gradient)",
  formula: "which formulas are used, in which order and how they are combined (parameters and round counts are free)",
};

const stable = (x: unknown): string => {
  if (x === undefined) return "u";
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
  const o = x as Record<string, unknown>;
  return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
};

/** The locked keys of a lock set, in a fixed order. */
export const lockedKeys = (locks: DraftLocks | undefined): LockKey[] => LOCK_KEYS.filter((k) => locks?.[k] === true);

/** The part of the scene a lock keeps still, as a value to compare. */
export function lockedPart(scene: Scene, key: LockKey): unknown {
  switch (key) {
    case "camera": return scene.camera;
    case "lights": return [scene.lights, scene.ambient, scene.environment];
    case "material": return [scene.material, scene.color];
    case "formula": {
      const fractals = scene.content.map((c) => (c.type === "fractal" ? { chain: c.chain.map((s) => s.formula), mode: c.mode ?? "sequence", rounds: c.rounds, execution: c.execution ?? null } : { type: c.type }));
      return { fractals };
    }
  }
}

/** Which locked parts differ between `base` and `next`. Empty when every locked part is as it was. */
export function lockViolations(base: Scene, next: Scene, locks: DraftLocks | undefined): LockKey[] {
  return lockedKeys(locks).filter((k) => stable(lockedPart(base, k)) !== stable(lockedPart(next, k)));
}

/** "camera and lights": the labels as an English list. */
export const lockList = (keys: readonly LockKey[]): string => (keys.length <= 1 ? keys.map((k) => LOCK_LABELS[k]).join("") : keys.slice(0, -1).map((k) => LOCK_LABELS[k]).join(", ") + " and " + LOCK_LABELS[keys[keys.length - 1]!]);

/** The refusal sentence for a change that touched locked parts. */
export function lockMessage(violated: readonly LockKey[]): string {
  return `The change was rejected: ${lockList(violated)} ${violated.length > 1 ? "are" : "is"} locked by the artist and cannot be changed in the drafts. Nothing in the draft was changed. Work with what is not locked.`;
}

/** The sentence that tells an AI which parts are locked (the code enforces it either way). Empty when nothing is locked. */
export function lockInstruction(locks: DraftLocks | undefined): string {
  const keys = lockedKeys(locks);
  if (!keys.length) return "";
  return `Locked parts (the drafts cannot change them; a change that touches them is rejected): ${keys.map((k) => `${LOCK_LABELS[k]} = ${LOCK_EXPLANATIONS[k]}`).join("; ")}. Work with what is unlocked.`;
}

/** Two lock sets together: a part is locked when either locks it. */
export function mergeLocks(a: DraftLocks | undefined, b: DraftLocks | undefined): DraftLocks {
  const out: DraftLocks = {};
  for (const k of LOCK_KEYS) if (a?.[k] === true || b?.[k] === true) out[k] = true;
  return out;
}

/** Reads a stored lock set; anything that is not exactly true for a known key is ignored. */
export function readLocks(raw: unknown): DraftLocks | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: DraftLocks = {};
  for (const k of LOCK_KEYS) if ((raw as Record<string, unknown>)[k] === true) out[k] = true;
  return lockedKeys(out).length ? out : undefined;
}
