import { desktop } from "./desktop";
import { readLookBackup, readLookRecord } from "../engine/looks";
import type { LookBackup, LookRecord } from "../engine/looks";

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const completed = (tx: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? Error("The Look storage was cancelled"));
  });

export type LookEntry = Omit<LookRecord, "payload">;

/**
 * The saved Looks. In the desktop app they live in their own folder through the host (`desktop.looks`); in a plain
 * browser (development only) they live in their own IndexedDB. It is a separate collection: material presets, the
 * fractal library and scenes are never read or written here.
 */
export class LookStore {
  private database?: Promise<IDBDatabase>;
  private host(operation: string, ...args: unknown[]) {
    if (!desktop?.looks) throw Error("The desktop connection for Looks is missing. Update the app; no alternative storage is created.");
    return desktop.looks(operation, ...args);
  }
  private open() {
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("noema-look-presets", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("entries", { keyPath: "id" });
        r.result.createObjectStore("payloads", { keyPath: "id" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(Error("Another tab blocks the Look library"));
    }).catch((e) => {
      this.database = undefined;
      throw e;
    }));
  }
  /** Every Look's metadata, newest first. */
  async page(): Promise<{ entries: LookEntry[]; total: number }> {
    if (desktop) {
      const entries: LookEntry[] = [];
      let total = 0;
      do {
        const page = await this.host("page", "", "", entries.length, 100);
        total = page.total;
        entries.push(...page.entries);
        if (!page.entries.length) break;
      } while (entries.length < total);
      return { entries, total };
    }
    const db = await this.open();
    const entries = await request(db.transaction("entries", "readonly").objectStore("entries").getAll());
    return { entries: entries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), total: entries.length };
  }
  async get(id: string): Promise<LookRecord | undefined> {
    if (desktop) return this.host("get", id);
    const db = await this.open();
    const r = await request(db.transaction("payloads", "readonly").objectStore("payloads").get(id));
    return r ? readLookRecord(r) : undefined;
  }
  async put(raw: LookRecord): Promise<void> {
    const record = readLookRecord(raw);
    if (desktop) {
      await this.host("put", record);
      return;
    }
    const db = await this.open();
    const tx = db.transaction(["entries", "payloads"], "readwrite");
    const done = completed(tx);
    const { payload: _payload, ...metadata } = record;
    tx.objectStore("entries").put(metadata);
    tx.objectStore("payloads").put(record);
    await done;
  }
  /** Adds records that are new to the library, in one write. The caller has already left out existing ids. */
  async importRecords(records: LookRecord[]): Promise<{ added: number; duplicates: number }> {
    const backup: LookBackup = readLookBackup({ format: "noema-look-library", version: 1, exportedAt: new Date().toISOString(), records });
    if (desktop) return this.host("import", backup);
    const db = await this.open();
    const tx = db.transaction(["entries", "payloads"], "readwrite");
    const done = completed(tx);
    try {
      for (const record of backup.records) {
        if (await request(tx.objectStore("payloads").get(record.id))) throw Error("Look id already exists: " + record.id);
        const { payload: _payload, ...metadata } = record;
        tx.objectStore("entries").put(metadata);
        tx.objectStore("payloads").put(record);
      }
      await done;
      return { added: backup.records.length, duplicates: 0 };
    } catch (error) {
      tx.abort();
      await done.catch(() => {});
      throw error;
    }
  }
  /** Desktop: the host asks where to save and writes a compressed backup of the Look collection only. False if cancelled. */
  async exportFile(): Promise<boolean> {
    return Boolean(await this.host("exportFile"));
  }
  /** Browser-only (development) export: the whole Look collection as a backup object. */
  async exportBackup(): Promise<LookBackup> {
    const records: LookRecord[] = [];
    const page = await this.page();
    for (const entry of page.entries) {
      const record = await this.get(entry.id);
      if (!record) throw Error("The Look collection changed during the export. Try again.");
      records.push(record);
    }
    return { format: "noema-look-library", version: 1, exportedAt: new Date().toISOString(), records };
  }
  async remove(id: string): Promise<void> {
    if (desktop) {
      await this.host("remove", id);
      return;
    }
    const db = await this.open();
    const tx = db.transaction(["entries", "payloads"], "readwrite");
    const done = completed(tx);
    tx.objectStore("entries").delete(id);
    tx.objectStore("payloads").delete(id);
    await done;
  }
}
