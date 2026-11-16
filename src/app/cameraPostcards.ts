/**
 * ARTIST-WORKFLOW 02: camera postcards. The four camera bookmarks (localStorage "fractal-camera-bookmark-N") grow an optional name and a small
 * compressed thumbnail, and the number of slots grows to eight. Old bookmarks stay valid as they are (no name, no picture); the camera and render
 * fields keep their meaning, so "Hämta kameravy N" works on every bookmark ever saved.
 *
 * The thumbnail is stored as a data URL of a tiny WebP (about 128 px wide, a few KB). Only that exact kind of data URL is ever shown, so a hand-edited
 * storage value cannot make the panel load anything else.
 */
export const POSTCARD_SLOTS = 8;
export const POSTCARD_KEY_PREFIX = "fractal-camera-bookmark-";
export const postcardKey = (slot: number): string => POSTCARD_KEY_PREFIX + slot;
export const THUMB_WIDTH = 128;
/** A stored thumbnail larger than this is refused (a 128 px WebP is far below it): keeps the browser storage small. */
export const THUMB_MAX_CHARS = 16_000;
export const NAME_MAX = 40;

export interface Postcard {
  camera: unknown;
  render?: unknown;
  /** The artist's own name for the place. Optional. */
  name?: string;
  /** "data:image/webp;base64,..." of the view when the postcard was saved. Optional. */
  thumb?: string;
  /** Which fractal it was saved in (the formula chain), so a postcard from another fractal can be recognised. Optional. */
  world?: string;
}

/** Trimmed, one line, no control characters, at most NAME_MAX characters; undefined when nothing is left. */
export function cleanName(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const t = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return t || undefined;
}

/** Only a small WebP data URL passes. */
export function cleanThumb(text: unknown): string | undefined {
  return typeof text === "string" && text.length <= THUMB_MAX_CHARS && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(text) ? text : undefined;
}

/** Reads a stored bookmark. Anything that is not an object with a camera is null; name and thumbnail are kept only when they are clean. */
export function readPostcard(text: string | null): Postcard | null {
  if (!text) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.camera !== "object" || r.camera === null) return null;
  const name = cleanName(r.name), thumb = cleanThumb(r.thumb), world = typeof r.world === "string" && r.world.length <= 400 ? r.world : undefined;
  return { camera: r.camera, ...(r.render !== undefined ? { render: r.render } : {}), ...(name ? { name } : {}), ...(thumb ? { thumb } : {}), ...(world ? { world } : {}) };
}

export const writePostcard = (p: Postcard): string => JSON.stringify(p);

/** The stored text with another name (or none), everything else untouched. Null when there is no postcard to rename. */
export function renamed(text: string | null, name: unknown): string | null {
  const p = readPostcard(text);
  if (!p) return null;
  const { name: _old, ...rest } = p;
  const n = cleanName(name);
  return writePostcard(n ? { ...rest, name: n } : rest);
}

/** The stored text with a thumbnail added (or replaced). Null when there is no postcard or the thumbnail is not acceptable. */
export function withThumb(text: string | null, thumb: unknown): string | null {
  const p = readPostcard(text), t = cleanThumb(thumb);
  return p && t ? writePostcard({ ...p, thumb: t }) : null;
}

/** The formula chain of a scene as one short string. */
export function worldOf(scene: { content: readonly { chain?: readonly { formula: string }[] }[] }): string {
  return (scene.content[0]?.chain ?? []).map((s) => s.formula).join("+").slice(0, 400);
}

export interface RetryOptions {
  /** How many times to try in all. */
  attempts: number;
  /** Pause between tries (ms). */
  delayMs: number;
  /** False as soon as the picture would no longer belong to the postcard (the camera moved, the slot was saved over): the tries stop. */
  stillWanted: () => boolean;
  /** Replaceable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A postcard's picture is a tiny render of the view; it is refused while the graphics card is busy with something else (LookDev drawing, a final render).
 * Instead of giving up after one refusal it is asked for again a few times; it stops when the picture would no longer match the postcard.
 */
export async function captureWithRetry(capture: () => Promise<string | null>, o: RetryOptions): Promise<{ thumb: string | null; tries: number; stopped: boolean }> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let tries = 1; tries <= o.attempts; tries++) {
    if (!o.stillWanted()) return { thumb: null, tries: tries - 1, stopped: true };
    let thumb: string | null = null;
    try { thumb = cleanThumb(await capture()) ?? null; } catch { thumb = null; }
    if (thumb) return o.stillWanted() ? { thumb, tries, stopped: false } : { thumb: null, tries, stopped: true };
    if (tries < o.attempts) await sleep(o.delayMs);
  }
  return { thumb: null, tries: o.attempts, stopped: false };
}
