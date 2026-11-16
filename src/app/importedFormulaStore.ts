/**
 * "Mina importerade formler": the private library of formulas converted from the owner's own .m3f files (FORMULA-IMPORTER-01).
 * It lives only in this browser/app profile (IndexedDB). Nothing here is ever bundled, exported with the public library or uploaded.
 */
export interface ImportedFormulaRecord {
  id: string;
  /** The generated formula text (data, parsed again at start-up; never code). */
  text: string;
  fileName: string;
  sha256: string;
  importedAt: string;
  comparisons: number;
  maxRelativeError: number;
  notes: string[];
}

const DB_NAME = 'noema-my-formulas';

const request = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error ?? new Error('IndexedDB error'));
});

export class ImportedFormulaStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is missing'));
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('formulas')) r.result.createObjectStore('formulas', { keyPath: 'id' }); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error('IndexedDB could not be opened'));
      });
      this.db.catch(() => (this.db = null));
    }
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> { return (await this.open()).transaction('formulas', mode).objectStore('formulas'); }
  async list(): Promise<ImportedFormulaRecord[]> { return request((await this.store('readonly')).getAll() as IDBRequest<ImportedFormulaRecord[]>); }
  async put(record: ImportedFormulaRecord): Promise<void> { await request((await this.store('readwrite')).put(record)); }
  async remove(id: string): Promise<void> { await request((await this.store('readwrite')).delete(id)); }
}
