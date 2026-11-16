/**
 * MATERIAL-GRADIENT-01: where the gradient editor gets materials from. The same two sources the Material Browser uses:
 * the built-in presets (`MATERIAL_PRESETS`) and the artist's saved materials (`MaterialStore`). Nothing is copied into a second
 * library: choosing one takes a self-contained snapshot into the stop (engine/materialRampApply.ts `snapshotStopMaterial`).
 */
import { MATERIAL_PRESETS } from '../engine/material';
import { snapshotStopMaterial } from '../engine/materialRampApply';
import { parsePolyHavenNotes, stopSourceOf } from './polyHaven';
import { readMaterialRecord } from '../engine/materialPresets';
import type { MaterialRecord } from '../engine/materialPresets';
import type { StopMaterial } from '../engine/materialRamp';
import type { MaterialSettings } from '../engine/material';

export interface MaterialChoice { id: string; title: string; group: 'Built-in' | 'Saved' }

export interface MaterialSource {
  list(): Promise<MaterialChoice[]>;
  /** The complete material (all properties and textures) behind a choice, for use as a scene's surface material; null if gone. */
  settings?(id: string): Promise<MaterialSettings | null>;
  /** null when the material no longer exists (deleted, or a library that is not available). */
  snapshot(id: string): Promise<StopMaterial | null>;
  /** The same snapshot from a record the Material Browser already holds (nothing is read twice, and a Poly Haven credit is kept). */
  snapshotRecord(record: MaterialRecord): StopMaterial;
}

/** The part of MaterialStore this needs (so tests can pass a fake). */
export interface MaterialLibraryLike {
  page(): Promise<{ entries: { id: string; title: string }[] }>;
  get(id: string): Promise<MaterialRecord | undefined>;
}

const BUILTIN = 'builtin:';
const SAVED = 'saved:';

/** A complete, self-contained snapshot of a saved material (all supported maps and its provenance) for a gradient stop. */
export function snapshotOfRecord(record: MaterialRecord): StopMaterial {
  const checked = readMaterialRecord(record); // throws on a damaged record: the editor shows the message
  const snap = snapshotStopMaterial(checked.payload.material, checked.title, { id: 'saved:' + checked.id, fingerprint: checked.fingerprint });
  // A material that came from Poly Haven keeps its credit, licence and link in the gradient stop (so the scene carries them).
  const ph = parsePolyHavenNotes(checked.notes);
  return ph ? { ...snap, source: stopSourceOf(ph, checked.fingerprint) } : snap;
}

export function createMaterialSource(library?: MaterialLibraryLike): MaterialSource {
  return {
    snapshotRecord: snapshotOfRecord,
    async list() {
      const out: MaterialChoice[] = Object.keys(MATERIAL_PRESETS).map((name) => ({ id: BUILTIN + name, title: name, group: 'Built-in' as const }));
      if (library) {
        try {
          const page = await library.page();
          for (const e of page.entries) out.push({ id: SAVED + e.id, title: e.title, group: 'Saved' });
        } catch {
          /* An unavailable library only hides the saved materials; the built-in ones still work. */
        }
      }
      return out;
    },
    async settings(id) {
      if (id.startsWith(BUILTIN)) { const m = MATERIAL_PRESETS[id.slice(BUILTIN.length)]; return m ? structuredClone(m) : null; }
      if (id.startsWith(SAVED) && library) { const record = await library.get(id.slice(SAVED.length)); return record ? structuredClone(readMaterialRecord(record).payload.material) : null; }
      return null;
    },
    async snapshot(id) {
      if (id.startsWith(BUILTIN)) {
        const name = id.slice(BUILTIN.length), m = MATERIAL_PRESETS[name];
        return m ? snapshotStopMaterial(m, name, { id }) : null;
      }
      if (id.startsWith(SAVED) && library) {
        const record = await library.get(id.slice(SAVED.length));
        if (!record) return null;
        const checked = readMaterialRecord(record); // throws on a damaged record: the editor shows the message
        const snap = snapshotStopMaterial(checked.payload.material, checked.title, { id, fingerprint: checked.fingerprint });
        // A material that came from Poly Haven keeps its credit, licence and link in the gradient stop (so the scene carries them).
        const ph = parsePolyHavenNotes(checked.notes);
        return ph ? { ...snap, source: stopSourceOf(ph, checked.fingerprint) } : snap;
      }
      return null;
    },
  };
}
