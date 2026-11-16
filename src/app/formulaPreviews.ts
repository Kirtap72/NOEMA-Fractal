/**
 * Small preview pictures for the formula selector (FORMULA-PREVIEWS 08).
 *
 * One 128x128 WebP per formula in src/assets/formula-previews, listed in index.json. The pictures are produced offline by
 * tools/formula-previews (the production renderer, the formula's own default scene; transforms behind a fixed standard host) and are only
 * looked up here: nothing is rendered, no shader is compiled and no engine is created while the selector is open. The bundle holds only the
 * file URLs (a few bytes each; `?no-inline` keeps Vite from embedding the pictures as data URLs). A picture is fetched only when its row
 * scrolls into view and the img element gets its address, so the editor pays nothing for rows nobody sees.
 */
import index from "../assets/formula-previews/index.json";

/** The bundler turns each file into a content-hashed asset and gives back its URL; nothing is fetched until an img uses the URL. */
const urls = import.meta.glob("../assets/formula-previews/*.webp", { query: "?no-inline", import: "default", eager: true }) as Record<string, string>;

export interface PreviewEntry {
  /** File name when several formulas share one picture (identical pixels are stored once); default is `<id>.webp`. */
  file?: string;
  /** Standard host formula shown behind a transform (undefined for a formula that is drawn by itself). */
  host?: string;
  /** Human-readable name of the host, for the caption. */
  hostName?: string;
}
const entries = (index as { previews: Record<string, PreviewEntry> }).previews;

const fileOf = (id: string): string => `../assets/formula-previews/${entries[id]?.file ?? id + ".webp"}`;
export function hasPreview(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(entries, id) && fileOf(id) in urls;
}
export function previewInfo(id: string): PreviewEntry | undefined {
  return hasPreview(id) ? entries[id] : undefined;
}
/** The picture URL of one formula (resolved at once; the picture itself is fetched when an img element is given this address). */
export async function previewUrl(id: string): Promise<string | undefined> {
  if (!hasPreview(id)) return undefined;
  return urls[fileOf(id)];
}
/** How many previews exist (for the test and the report). */
export const previewCount = (): number => Object.keys(entries).length;
