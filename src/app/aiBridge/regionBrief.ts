/**
 * ARTIST-WORKFLOW 07: the artist marks a region of the picture, writes a short wish, and may lock parts. This file turns that into the one message the
 * existing AI chat sends (the region goes along as a small picture, through the reference-picture path that already exists). It is pure text work.
 *
 * What the message says about the region is an ARTISTIC INTENTION, not a mathematical promise: an AI may try to keep the look of the marked place
 * (its forms, its rhythm of colour), but nothing here or anywhere checks that it does. The locks are different: they are enforced in code
 * (draftLocks.ts), and the message only tells the AI what it will not be allowed to change.
 */
import { lockInstruction, lockedKeys } from "../../engine/draftLocks";
import type { DraftLocks } from "../../engine/draftLocks";

/** A rectangle of the picture, each side as a share (0 to 1) of the picture's width or height. */
export interface Region { u0: number; v0: number; u1: number; v1: number }

export const MIN_REGION_SHARE = 0.04;
export const MAX_ALTERNATIVES = 3;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** A rectangle with its sides in order, inside the picture; null when it is too small to mean anything. */
export function cleanRegion(r: Region): Region | null {
  const u0 = clamp01(Math.min(r.u0, r.u1)), u1 = clamp01(Math.max(r.u0, r.u1));
  const v0 = clamp01(Math.min(r.v0, r.v1)), v1 = clamp01(Math.max(r.v0, r.v1));
  if (u1 - u0 < MIN_REGION_SHARE || v1 - v0 < MIN_REGION_SHARE) return null;
  return { u0, v0, u1, v1 };
}

const pct = (v: number): number => Math.round(v * 100);
const third = (a: number, b: number, names: [string, string, string]): string => {
  const c = (a + b) / 2;
  return c < 1 / 3 ? names[0] : c < 2 / 3 ? names[1] : names[2];
};

/** "i bildens övre vänstra del (från vänster 12–38 %, uppifrån 5–30 %)". */
export function describeRegion(r: Region): string {
  const col = third(r.u0, r.u1, ["left", "middle", "right"]);
  const row = third(r.v0, r.v1, ["upper", "middle", "lower"]);
  const place = col === "middle" && row === "middle" ? "centre" : row === "middle" ? `${col} part` : col === "middle" ? `${row} part` : `${row} ${col} part`;
  return `in the ${place} of the picture (from the left ${pct(r.u0)}–${pct(r.u1)} %, from the top ${pct(r.v0)}–${pct(r.v1)} %, ${pct(r.u1 - r.u0)} × ${pct(r.v1 - r.v0)} % of the picture)`;
}

export interface BriefInput {
  /** The artist's own short wish. */
  instruction: string;
  region?: Region | undefined;
  locks?: DraftLocks | undefined;
  /** How many alternative drafts to ask for (1 to MAX_ALTERNATIVES). */
  alternatives?: number | undefined;
}

/** The text sent to the AI. The artist's own words come first and unchanged; the rest are labelled additions. */
export function composeBrief(b: BriefInput): string {
  const parts = [b.instruction.trim()];
  const region = b.region ? cleanRegion(b.region) : null;
  if (region) {
    parts.push(
      `[Marked area: ${describeRegion(region)}. The attached picture shows exactly that area in the artist's current picture. Start from that area and try, as an artistic wish, to keep its local shapes and colour rhythm while you explore. It is a wish, not a requirement that can be checked mathematically, and the rest of the picture may well be changed.]`,
    );
  }
  const lock = lockInstruction(b.locks);
  if (lock) parts.push(`[${lock}]`);
  const n = Math.min(MAX_ALTERNATIVES, Math.max(1, Math.round(b.alternatives ?? 1)));
  if (n > 1) parts.push(`[Create ${n} different alternative drafts (each separately, from the artist's current scene) and describe briefly how they differ, so that the artist can compare them. No draft changes the live scene; the artist chooses themselves.]`);
  return parts.join("\n\n");
}

/** What the artist sees in the conversation instead of the long brief: their words and short tags. */
export function describeBrief(b: BriefInput): string {
  const tags: string[] = [];
  if (b.region && cleanRegion(b.region)) tags.push("marked area");
  const keys = lockedKeys(b.locks);
  if (keys.length) tags.push("locked: " + keys.map((k) => ({ camera: "camera", lights: "lights", material: "material", formula: "formula structure" })[k]).join(", "));
  const n = Math.min(MAX_ALTERNATIVES, Math.max(1, Math.round(b.alternatives ?? 1)));
  if (n > 1) tags.push(`${n} alternatives`);
  return tags.length ? `${b.instruction.trim()}\n[${tags.join(" · ")}]` : b.instruction.trim();
}
