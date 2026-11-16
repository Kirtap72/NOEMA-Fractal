/** One place that turns a Poly Haven id into a saved NOEMA material (download, mapping, provenance, library), used by the artist's tab and by the AI tools alike. */
import { createMaterialRecord, readMaterialRecord } from '../engine/materialPresets';
import type { MaterialStore } from './materialStore';
import { DEFAULT_POLYHAVEN_SCALE, materialFromPolyHaven, polyHavenNotes, polyHavenSource } from './polyHaven';
import type { ChannelStatus, PolyHavenMeta, PolyHavenRead, PolyHavenSource } from './polyHaven';

export type PolyHavenCall = (operation: string, ...args: unknown[]) => Promise<any>;
export interface ImportedMaterial { materialId: string; title: string; meta: PolyHavenMeta; status: ChannelStatus[]; source: PolyHavenSource }

export async function importPolyHavenMaterial(call: PolyHavenCall, store: Pick<MaterialStore, 'put'>, id: string, res: string, scale = DEFAULT_POLYHAVEN_SCALE): Promise<ImportedMaterial> {
  await call('download', id, res);
  const read = (await call('read', id, res)) as PolyHavenRead;
  const { material, status } = materialFromPolyHaven(read, scale);
  const source = polyHavenSource(read.meta);
  const materialId = `material:ph-${id}-${res}`;
  const title = `${read.meta.name} (Poly Haven ${res})`.slice(0, 120);
  const record = readMaterialRecord({ ...createMaterialRecord({ kind: 'material', material }, title, materialId), notes: polyHavenNotes(source) });
  await store.put(record);
  return { materialId, title, meta: read.meta, status, source };
}
