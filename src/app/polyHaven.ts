/**
 * Poly Haven in the window: turns the cached maps of a downloaded material into an ordinary NOEMA material and keeps where it came from.
 * No network here (the main process does that, see desktop/polyHaven.cjs); this file is pure so it can be tested without Electron.
 *
 * Channel mapping (documented, never invented):
 *   Diffuse -> baseColor (sRGB, multiplies the surface colour) | Rough -> roughness | Metal -> metallic | AO -> ao  (all linear data)
 *   nor_gl  -> surface-detail normal map, stored but SWITCHED OFF: the OpenGL convention matches NOEMA's right-handed charts, but the
 *              orientation has not been verified visually, so it is kept for reuse and never silently active.
 *   Displacement and the packed "arm" map are not imported (listed as such).
 * All maps of one material share one texture scale (`surfaceDetail.scale`), so they stay aligned.
 */
import { defaultMaterial } from '../engine/material';
import type { MaterialSettings } from '../engine/material';
import { defaultSurfaceDetail } from '../engine/surfaceDetail';
import type { PbrChannel } from '../engine/materialTextures';
import type { StopMaterial } from '../engine/materialRamp';

export interface PolyHavenMeta {
  id: string; resolution: string; name: string; license: string; url: string; filesHash?: string;
  authors: { name: string; role: string }[]; dimensionsCm?: number[]; downloadedAt?: string;
  maps: Record<string, { file: string; bytes: number }>; missing: string[]; notImported: string[];
}
export interface PolyHavenRead { meta: PolyHavenMeta; images: Record<string, string> }
export interface ChannelStatus { channel: string; label: string; state: 'active' | 'missing' | 'fetched but turned off' | 'not imported'; note: string }

const LABEL: Record<string, string> = { baseColor: 'Colour', roughness: 'Roughness', metallic: 'Metal', ao: 'Occlusion', normal: 'Normal', displacement: 'Displacement' };
export const DEFAULT_POLYHAVEN_SCALE = 4;

/** The NOEMA material for a downloaded Poly Haven material, and an honest per-channel status line for the artist. */
export function materialFromPolyHaven(read: PolyHavenRead, scale = DEFAULT_POLYHAVEN_SCALE): { material: MaterialSettings; status: ChannelStatus[] } {
  const { meta, images } = read;
  const named = (c: string): { data: string; name: string } => ({ data: images[c]!, name: `${meta.id}_${c}.jpg` });
  const maps: Partial<Record<PbrChannel, { enabled: boolean; strength: number; mode: 'multiply' | 'replace'; texture: { data: string; name: string } }>> = {};
  if (images.baseColor) maps.baseColor = { enabled: true, strength: 1, mode: 'multiply', texture: named('baseColor') };
  if (images.roughness) maps.roughness = { enabled: true, strength: 1, mode: 'replace', texture: named('roughness') };
  if (images.metallic) maps.metallic = { enabled: true, strength: 1, mode: 'replace', texture: named('metallic') };
  if (images.ao) maps.ao = { enabled: true, strength: 1, mode: 'multiply', texture: named('ao') };
  const detail = { ...defaultSurfaceDetail(), scale, ...(images.normal ? { normal: { enabled: false, strength: 1, texture: named('normal') } } : {}) };
  const material = { ...defaultMaterial(), metallic: 0, roughness: images.roughness ? 1 : 0.8, textures: { maps }, surfaceDetail: detail } as MaterialSettings;
  const status: ChannelStatus[] = (['baseColor', 'roughness', 'metallic', 'ao'] as const).map((c) => images[c]
    ? { channel: c, label: LABEL[c]!, state: 'active', note: 'also blended in material gradients' }
    : { channel: c, label: LABEL[c]!, state: 'missing', note: c === 'metallic' ? 'the material has no metal map (metal 0)' : 'does not exist at Poly Haven for this material' });
  status.push(images.normal ? { channel: 'normal', label: LABEL.normal!, state: 'fetched but turned off', note: 'the orientation is not visually verified; not blended in gradients' } : { channel: 'normal', label: LABEL.normal!, state: 'missing', note: 'no normal map' });
  status.push({ channel: 'displacement', label: LABEL.displacement!, state: 'not imported', note: 'displacement is not imported' });
  return { material, status };
}

/** Provenance stored in the library record's note and carried into a gradient stop's `source`. */
export interface PolyHavenSource { provider: 'polyhaven'; id: string; resolution: string; license: string; author: string; url: string; filesHash?: string }
export function polyHavenSource(meta: PolyHavenMeta): PolyHavenSource {
  const author = meta.authors.map((a) => a.name).filter(Boolean).slice(0, 3).join(', ') || 'Poly Haven';
  return { provider: 'polyhaven', id: meta.id, resolution: meta.resolution, license: meta.license || 'CC0', author: author.slice(0, 100), url: meta.url, ...(meta.filesHash ? { filesHash: meta.filesHash } : {}) };
}
export const polyHavenNotes = (s: PolyHavenSource): string => 'polyhaven:' + JSON.stringify(s);
export function parsePolyHavenNotes(notes: string): PolyHavenSource | undefined {
  if (!notes.startsWith('polyhaven:')) return undefined;
  try {
    const o = JSON.parse(notes.slice('polyhaven:'.length)) as Record<string, unknown>;
    if (o.provider !== 'polyhaven' || typeof o.id !== 'string' || typeof o.url !== 'string' || !/^https:\/\/polyhaven\.com\//.test(o.url) || typeof o.license !== 'string' || typeof o.author !== 'string' || typeof o.resolution !== 'string') return undefined;
    return { provider: 'polyhaven', id: o.id.slice(0, 80), resolution: o.resolution.slice(0, 8), license: o.license.slice(0, 60), author: o.author.slice(0, 100), url: o.url.slice(0, 300), ...(typeof o.filesHash === 'string' ? { filesHash: o.filesHash.slice(0, 64) } : {}) };
  } catch { return undefined; }
}
/** The `source` of a gradient stop for a material that came from Poly Haven. */
export const stopSourceOf = (s: PolyHavenSource, fingerprint?: string): NonNullable<StopMaterial['source']> => ({ id: `polyhaven:${s.id}:${s.resolution}`, ...(fingerprint ? { fingerprint } : {}), provider: 'polyhaven', license: s.license, author: s.author, url: s.url });

/** A short Swedish credit line for the artist's view and exports. */
export const creditLine = (s: PolyHavenSource): string => `${s.id.replace(/_/g, ' ')} · ${s.author} · ${s.license} · Poly Haven (${s.url})`;
