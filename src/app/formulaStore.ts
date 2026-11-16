import type { ChoiceEvent, FormulaRecord } from "../engine";

/**
 * Saved random formulas in the browser (IndexedDB, ARCHITECTURE.md 8.21 section 8.1): the formula file's text, its
 * measurement record with the owner's rating, and its thumbnail; and the log of choices made in the grid.
 * localStorage is too small for hundreds of pictures. Everything stays on this computer until exported.
 */
export interface StoredFormula {
  id: string;
  text: string;
  record?: FormulaRecord;
  thumbnail?: string;
  saved_at: string;
}

const DB_NAME = "fraktal-formulas";
const DB_VERSION = 1;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB error"));
  });
}

export class FormulaStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") return reject(new Error("the browser has no IndexedDB"));
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains("formulas")) db.createObjectStore("formulas", { keyPath: "id" });
          if (!db.objectStoreNames.contains("choices")) db.createObjectStore("choices", { autoIncrement: true });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error("IndexedDB could not be opened"));
      });
      // A failed open is not remembered, so that a later call can try again.
      this.db.catch(() => (this.db = null));
    }
    return this.db;
  }

  private async store(name: "formulas" | "choices", mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(name, mode).objectStore(name);
  }

  async listFormulas(): Promise<StoredFormula[]> {
    return request((await this.store("formulas", "readonly")).getAll() as IDBRequest<StoredFormula[]>);
  }

  async putFormula(f: StoredFormula): Promise<void> {
    await request((await this.store("formulas", "readwrite")).put(f));
  }

  async deleteFormula(id: string): Promise<void> {
    await request((await this.store("formulas", "readwrite")).delete(id));
  }

  async addChoice(c: ChoiceEvent): Promise<void> {
    await request((await this.store("choices", "readwrite")).add(c));
  }

  async listChoices(): Promise<ChoiceEvent[]> {
    return request((await this.store("choices", "readonly")).getAll() as IDBRequest<ChoiceEvent[]>);
  }
}
