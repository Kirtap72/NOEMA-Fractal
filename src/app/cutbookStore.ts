/**
 * ARTIST-WORKFLOW 06: the discoveries of the geological cutbook are kept in the browser's local storage (like the camera postcards), a few KB each:
 * a position of the plane (normal, offset, side), the artist's own name and a tiny WebP picture. They belong to a fractal (its formula chain) and are
 * only offered there. Everything read back is checked: a hand-edited or damaged value is dropped, never trusted.
 */
import type { CutDiscovery } from "../engine/cutbook";
import { MAX_DISCOVERIES_PER_WORLD } from "../engine/cutbook";
import { cleanName, cleanThumb } from "./cameraPostcards";

export const CUTBOOK_KEY = "noema-cutbook-v1";
/** All fractals together; the oldest go first. */
export const MAX_DISCOVERIES_TOTAL = 48;

const finite3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6);

/** One stored entry, or null when it is not a valid discovery. */
export function readDiscovery(raw: unknown): CutDiscovery | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^[\w-]{1,48}$/.test(r.id)) return null;
  if (!finite3(r.normal) || Math.hypot(...r.normal) < 1e-9) return null;
  if (typeof r.offset !== "number" || !Number.isFinite(r.offset) || Math.abs(r.offset) > 1e6) return null;
  if (typeof r.invert !== "boolean") return null;
  if (typeof r.world !== "string" || r.world.length > 400) return null;
  const name = cleanName(r.name) ?? "Fynd";
  const thumb = cleanThumb(r.thumb);
  return { id: r.id, name, normal: r.normal, offset: r.offset, invert: r.invert, world: r.world, ...(thumb ? { thumb } : {}) };
}

/** The stored list from its text; damaged text gives an empty list and damaged entries are skipped. */
export function readDiscoveries(text: string | null): CutDiscovery[] {
  if (!text) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: CutDiscovery[] = [];
  for (const item of raw) { const d = readDiscovery(item); if (d && !out.some((o) => o.id === d.id)) out.push(d); }
  return out;
}

export class CutbookStore {
  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {}

  all(): CutDiscovery[] {
    try { return readDiscoveries(this.storage?.getItem(CUTBOOK_KEY) ?? null); } catch { return []; }
  }

  /** The discoveries of one fractal, oldest first. */
  list(world: string): CutDiscovery[] { return this.all().filter((d) => d.world === world); }

  private write(items: CutDiscovery[]): boolean {
    try { this.storage?.setItem(CUTBOOK_KEY, JSON.stringify(items)); return !!this.storage; } catch { return false; }
  }

  /** Adds a discovery (the oldest of its fractal, and of all, go when the limits are reached). False when it could not be stored. */
  add(d: CutDiscovery): boolean {
    const valid = readDiscovery(d);
    if (!valid) return false;
    let items = this.all().filter((x) => x.id !== valid.id);
    items.push(valid);
    const same = items.filter((x) => x.world === valid.world);
    if (same.length > MAX_DISCOVERIES_PER_WORLD) { const drop = new Set(same.slice(0, same.length - MAX_DISCOVERIES_PER_WORLD).map((x) => x.id)); items = items.filter((x) => !drop.has(x.id)); }
    if (items.length > MAX_DISCOVERIES_TOTAL) items = items.slice(items.length - MAX_DISCOVERIES_TOTAL);
    return this.write(items);
  }

  rename(id: string, name: unknown): boolean {
    const n = cleanName(name);
    const items = this.all();
    const hit = items.find((x) => x.id === id);
    if (!hit || !n) return false;
    hit.name = n;
    return this.write(items);
  }

  remove(id: string): boolean { return this.write(this.all().filter((x) => x.id !== id)); }
}
