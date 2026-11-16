import { ATLAS_MAX_ENTRIES, ATLAS_NAME_MAX, ATLAS_NOTE_MAX, addDiscovery, annotate, atlasWorld, depthOf, describeDifference, family, removeDiscovery, sceneHash } from "../engine/atlas";
import type { AtlasEntry } from "../engine/atlas";
import type { Scene } from "../engine/scene";
import { describeImport, exportAtlas, planImport } from "../engine/atlasExchange";
import { AtlasStore } from "./atlasStore";
import "./atlasPanel.css";

/** What the atlas needs from the application. It never writes the scene itself: "Gå dit" is one undoable step made by the application. */
export interface AtlasHandlers {
  /** The authored scene. */
  scene(): Scene;
  /** The application's own save text for a scene (exact and restorable). */
  serialize(scene: Scene): string;
  /** The scene in a saved text, or null when it is not a valid scene. */
  parse(text: string): Scene | null;
  /** A small WebP of what the viewport shows now, or null when the engine is busy. */
  thumbnail(width: number): Promise<string | null>;
  /** Makes `scene` the artwork as ONE undoable step. False when the application is busy. */
  restore(scene: Scene): boolean;
  undo(): boolean;
  busy(): boolean;
  store?: AtlasStore;
  /** Hands a text file to the artist (a save dialog in the desktop app). Left out: an ordinary browser download. */
  saveFile?(name: string, text: string): void;
}

let counter = 0;
const newId = (): string => `d${Date.now().toString(36)}${(counter++).toString(36)}`;
const dateText = (ms: number): string => { try { return new Date(ms).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" }); } catch { return ""; } };
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };

/**
 * ARTIST-WORKFLOW 07: "Upptäcktsatlas". The artist keeps the finds that matter, by hand: an exact scene with a small picture, an optional name and note, and
 * a link to the find it grew out of. A find can be revisited ("Gå dit", one undo step), compared with the picture on the screen now, continued from (the
 * next find becomes its branch) and shown with its whole branch. Nothing is recorded automatically and nothing is removed automatically.
 * Works without any AI.
 */
export class AtlasPanel {
  /** A plain block with a heading, not a fold: the shell remembers (and on a first run closes) every <details>, which hid the whole atlas behind one line. The part bar already folds it. */
  readonly root = node("div", undefined, "atlas");
  private store: AtlasStore;
  private entries: AtlasEntry[] = [];
  private origin: string | null = null;
  private branchOf: string | null = null;
  private busySaving = false;
  private nameInput = node("input");
  private noteInput = node("input");
  private saveButton = node("button", "Save this find");
  private originLine = node("small", undefined, "atlas-origin");
  private unlinkButton = node("button", "Detach");
  private status = node("small", undefined, "atlas-status");
  private filterLine = node("div", undefined, "atlas-buttons");
  private grid = node("div", undefined, "atlas-grid");
  private compareBox = node("figure", undefined, "atlas-compare");
  private undoButton = node("button", "Undo the latest Go there");
  private exportButton = node("button", "Export atlas");
  private importButton = node("button", "Import atlas…");
  private importInput = node("input");
  private summary = node("h3", undefined, "atlas-title");
  private editing: string | null = null;
  private confirming: string | null = null;
  private drawnCurrent = "";
  private refreshTimer = 0;

  constructor(parent: HTMLElement, private h: AtlasHandlers) {
    this.store = h.store ?? new AtlasStore();
    this.root.dataset.atlas = "";
    this.status.setAttribute("role", "status");
    this.status.dataset.atlasStatus = "";
    const note = node("p", "Save the finds that mean something to you, by hand. Each find is an exact scene with a small picture; you can go back there, compare it with what you see now and continue from there. Nothing is saved automatically and nothing is removed automatically. Everything stays on your computer.", "atlas-note");

    this.nameInput.type = "text"; this.nameInput.placeholder = "Name (optional)"; this.nameInput.maxLength = ATLAS_NAME_MAX; this.nameInput.dataset.atlasName = "";
    this.nameInput.setAttribute("aria-label", "Name of the find");
    this.noteInput.type = "text"; this.noteInput.placeholder = "Note (optional)"; this.noteInput.maxLength = ATLAS_NOTE_MAX; this.noteInput.dataset.atlasNote = "";
    this.noteInput.setAttribute("aria-label", "Note about the find");
    this.saveButton.type = "button"; this.saveButton.dataset.atlasSave = "";
    this.saveButton.title = "Saves the exact scene and a small picture of the view in the atlas. The artwork is not changed.";
    this.saveButton.addEventListener("click", () => void this.save());
    this.unlinkButton.type = "button"; this.unlinkButton.dataset.atlasUnlink = "";
    this.unlinkButton.title = "The next find becomes a separate one, not a branch of this one.";
    this.unlinkButton.addEventListener("click", () => { this.origin = null; this.draw(); });
    this.undoButton.type = "button"; this.undoButton.dataset.atlasUndo = ""; this.undoButton.hidden = true;
    this.undoButton.addEventListener("click", () => { if (this.h.undo()) { this.undoButton.hidden = true; this.say("Back to the artwork as it was before Go there."); this.draw(); } else this.say("It cannot be undone right now."); });

    // Export and import: the atlas as a file, so it survives a changed profile, a new computer or a reinstall. Import only ever adds (see planImport).
    this.exportButton.type = "button"; this.exportButton.dataset.atlasExport = "";
    this.exportButton.title = "Saves all finds (scenes, pictures, names, notes, branches) as a file where you choose to put it. Nothing in the atlas is changed.";
    this.exportButton.addEventListener("click", () => this.exportFile());
    this.importButton.type = "button"; this.importButton.dataset.atlasImport = "";
    this.importButton.title = "Reads an exported atlas file. Only new finds are added: your current finds are never changed, replaced or removed.";
    this.importButton.addEventListener("click", () => this.importInput.click());
    this.importInput.type = "file"; this.importInput.accept = ".json,application/json"; this.importInput.hidden = true; this.importInput.dataset.atlasImportFile = "";
    this.importInput.setAttribute("aria-label", "Choose an atlas file to import");
    this.importInput.addEventListener("change", () => { const file = this.importInput.files?.[0]; this.importInput.value = ""; if (file) void this.importFile(file); });
    const form = node("div", undefined, "atlas-form");
    const row = node("div", undefined, "atlas-buttons");
    row.append(this.saveButton, this.unlinkButton, this.undoButton);
    const fileRow = node("div", undefined, "atlas-buttons");
    fileRow.append(this.exportButton, this.importButton, this.importInput);
    form.append(this.nameInput, this.noteInput, this.originLine, row, fileRow);
    this.compareBox.hidden = true; this.compareBox.dataset.atlasComparison = "";
    this.root.append(this.summary, note, form, this.status, this.filterLine, this.grid, this.compareBox);
    parent.append(this.root);
    this.reload();
  }

  /** Reads the atlas again (another window may have changed it) and redraws. */
  reload(): void { this.entries = this.store.load(); if (this.origin && !this.entries.some((e) => e.id === this.origin)) this.origin = null; this.draw(); }

  private say(text: string): void { this.status.textContent = text; }
  private persist(next: AtlasEntry[]): boolean {
    if (!this.store.save(next)) { this.say("The atlas could not be saved (the storage of the browser is full or blocked). Nothing was changed."); return false; }
    this.entries = next;
    return true;
  }

  /** The whole atlas as a file. */
  exportFile(): void {
    if (!this.entries.length) { this.say("The atlas is empty: there is nothing to export yet."); return; }
    const text = exportAtlas(this.entries, new Date().toISOString());
    const name = `noema-atlas-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      if (this.h.saveFile) this.h.saveFile(name, text);
      else { const url = URL.createObjectURL(new Blob([text], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10_000); }
      this.say(`Exported ${this.entries.length} finds to ${name}. Choose where the file should be placed in the dialog; the atlas is unchanged.`);
    } catch (e) { this.say("The export failed: " + (e instanceof Error ? e.message : String(e)) + " The atlas is unchanged."); }
  }

  /** Reads an atlas file and ADDS what is new. A backup of the atlas as it was is kept first. */
  async importFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const plan = planImport(this.entries, text, { newId, validScene: (sceneText) => this.h.parse(sceneText) !== null });
      if (!plan.ok) { this.say(plan.message); return; }
      if (plan.value.report.added === 0) { this.say(describeImport(plan.value.report)); return; }
      this.store.backup(this.entries); // one step back, in case the file was not what was expected
      if (!this.persist(plan.value.entries)) return;
      this.say(describeImport(plan.value.report));
      this.draw();
    } catch (e) { this.say("The import failed: " + (e instanceof Error ? e.message : String(e)) + " The atlas is unchanged."); }
  }

  async save(): Promise<void> {
    if (this.busySaving) return;
    if (this.h.busy()) { this.say("The engine is busy. Try again in a moment."); return; }
    this.busySaving = true; this.saveButton.disabled = true;
    try {
      const scene = this.h.scene();
      const text = this.h.serialize(scene);
      let thumb = await this.h.thumbnail(160);
      if (thumb && thumb.length > 24_000) thumb = await this.h.thumbnail(112);
      const r = addDiscovery(this.entries, { id: newId(), scene: text, world: atlasWorld(scene), name: this.nameInput.value, note: this.noteInput.value, thumb: thumb ?? undefined, parentId: this.origin ?? undefined, now: Date.now() });
      if (!r.ok) { this.say(r.message); return; }
      if (!this.persist(r.value)) return;
      const saved = r.value[r.value.length - 1]!;
      this.origin = saved.id;
      this.nameInput.value = ""; this.noteInput.value = "";
      this.say(`Saved${saved.parentId ? " as a branch of an earlier find" : ""}${thumb ? "" : " (without a picture: the engine was busy)"}. The next find you save becomes a branch of this one, unless you detach.`);
    } catch (e) { this.say("The find could not be saved: " + (e instanceof Error ? e.message : String(e))); }
    finally { this.busySaving = false; this.saveButton.disabled = false; this.draw(); }
  }

  /** Revisits a find: it becomes the artwork in one undoable step. `continueFrom` also makes it the parent of the next find. */
  goTo(id: string, continueFrom = false): boolean {
    const e = this.entries.find((x) => x.id === id);
    if (!e) { this.say("The find no longer exists."); return false; }
    if (this.h.busy()) { this.say("The engine is busy. Try again in a moment."); return false; }
    const scene = this.h.parse(e.scene);
    if (!scene) { this.say("The saved scene cannot be read in this version. It is untouched in the atlas."); return false; }
    if (!this.h.restore(scene)) { this.say("Could not switch right now."); return false; }
    this.origin = e.id; // a find revisited is where the next one grows from, so the branch is recorded either way
    this.undoButton.hidden = false;
    this.compareBox.hidden = true;
    this.say(`${continueFrom ? "Continuing from" : "Went to"} "${e.name ?? "find"}". The next find you save becomes a branch of it. Undo takes you back.`);
    this.draw();
    return true;
  }

  async compare(id: string): Promise<void> {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    const saved = this.h.parse(e.scene);
    if (!saved) { this.say("The saved scene cannot be read in this version."); return; }
    const now = this.h.scene();
    const current = this.h.busy() ? null : await this.h.thumbnail(160);
    this.compareBox.replaceChildren();
    const fig = (src: string | undefined, caption: string, key: string): HTMLElement => {
      const f = node("div"); f.dataset.atlasCompareSide = key;
      if (src) { const i = node("img"); i.src = src; i.alt = caption; f.append(i); } else f.append(node("small", "(no picture)"));
      f.append(node("figcaption", caption)); return f;
    };
    this.compareBox.append(fig(e.thumb, `Saved: ${e.name ?? "find"}`, "saved"), fig(current ?? undefined, "This is how it looks now", "now"));
    const list = node("ul");
    for (const line of describeDifference(saved, now)) list.append(node("li", line));
    this.compareBox.append(list);
    this.compareBox.hidden = false;
    this.say("The comparison changes nothing in the artwork.");
  }

  private draw(): void {
    const n = this.entries.length;
    this.summary.textContent = `Discovery atlas · my finds (${n})`;
    this.saveButton.disabled = this.busySaving || n >= ATLAS_MAX_ENTRIES;
    const o = this.origin ? this.entries.find((e) => e.id === this.origin) : undefined;
    this.originLine.textContent = o ? `The next find becomes a branch of "${o.name ?? "find"}".` : "";
    this.unlinkButton.hidden = !o;

    this.filterLine.replaceChildren();
    if (this.branchOf) {
      const all = node("button", "Show all finds"); all.type = "button"; all.dataset.atlasShowAll = "";
      all.addEventListener("click", () => { this.branchOf = null; this.draw(); });
      this.filterLine.append(all, node("small", "Shows one branch."));
    }
    let shown = this.branchOf ? family(this.entries, this.branchOf) : [...this.entries].sort((a, b) => b.savedAt - a.savedAt);
    if (this.branchOf && shown.length === 0) { this.branchOf = null; shown = [...this.entries].sort((a, b) => b.savedAt - a.savedAt); }

    // The live scene is serialised once (only while the panel is open) so the find that is exactly the picture on the screen can be marked.
    const liveHash = this.liveHash();
    this.drawnCurrent = this.currentId(liveHash);

    this.grid.replaceChildren();
    if (!n) this.grid.append(node("small", "The atlas is empty. Find something you like and press Save this find."));
    for (const e of shown) this.grid.append(this.card(e, liveHash));
  }

  /** True when the atlas is on screen (its part is unfolded and its tab is shown). */
  private shown(): boolean { return this.root.isConnected && this.root.getClientRects().length > 0; }
  private liveHash(): string {
    if (!this.shown() || !this.entries.length) return "";
    try { return sceneHash(this.h.serialize(this.h.scene())); } catch { return ""; }
  }
  private currentId(hash: string): string { return hash ? (this.entries.find((e) => e.hash === hash)?.id ?? "") : ""; }

  /** Called by the application after the scene changed (an edit, Undo, an opened file): the find that equals the picture is marked again. Cheap and delayed. */
  refresh(): void {
    if (!this.shown()) return;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { if (this.currentId(this.liveHash()) !== this.drawnCurrent) this.draw(); }, 200);
  }

  private card(e: AtlasEntry, liveHash: string): HTMLElement {
    const c = node("div", undefined, "atlas-card");
    c.dataset.atlasId = e.id;
    if (e.parentId) { c.classList.add("atlas-branch"); c.style.marginLeft = Math.min(3, depthOf(this.entries, e.id)) * 8 + "px"; }
    if (liveHash && liveHash === e.hash) c.dataset.current = "";
    if (e.thumb) { const img = node("img"); img.src = e.thumb; img.alt = e.name ?? "Fynd"; img.loading = "lazy"; c.append(img); }
    c.append(node("strong", e.name ?? "Find without a name"));
    const parent = e.parentId ? this.entries.find((x) => x.id === e.parentId) : undefined;
    c.append(node("small", `${dateText(e.savedAt)}${e.world ? " · " + e.world : ""}${parent ? ` · branch of "${parent.name ?? "find"}"` : ""}${c.dataset.current !== undefined ? " · what you see now" : ""}`));
    if (e.note) c.append(node("small", e.note));

    if (this.editing === e.id) {
      const name = node("input"); name.type = "text"; name.value = e.name ?? ""; name.maxLength = ATLAS_NAME_MAX; name.dataset.atlasEditName = ""; name.setAttribute("aria-label", "New name");
      const note = node("input"); note.type = "text"; note.value = e.note ?? ""; note.maxLength = ATLAS_NOTE_MAX; note.dataset.atlasEditNote = ""; note.setAttribute("aria-label", "New note");
      const ok = this.button("Save text", () => {
        const r = annotate(this.entries, e.id, { name: name.value, note: note.value });
        if (r.ok && this.persist(r.value)) { this.editing = null; this.say("Name and note saved."); } else if (!r.ok) this.say(r.message);
        this.draw();
      }, "atlasEditSave");
      c.append(name, note, ok);
    } else {
      const row = node("div", undefined, "atlas-buttons");
      row.append(
        this.button("Go there", () => void this.goTo(e.id), "atlasGo", "Make this find the artwork. One step that can be undone."),
        this.button("Continue from here", () => void this.goTo(e.id, true), "atlasContinue", "Goes there, and the next find you save becomes a branch of this one."),
        this.button("Compare", () => void this.compare(e.id), "atlasCompare", "Shows the find next to what you see now, with the differences in words. Changes nothing."),
        this.button(this.branchOf === e.id ? "All" : "Gren", () => { this.branchOf = this.branchOf === e.id ? null : e.id; this.draw(); }, "atlasBranch", "Shows only finds that are connected to this one through branches."),
        this.button("Rename", () => { this.editing = e.id; this.confirming = null; this.draw(); }, "atlasRename"),
        this.button(this.confirming === e.id ? "Confirm deletion" : "Delete", () => {
          if (this.confirming !== e.id) { this.confirming = e.id; this.say("Press Confirm deletion to delete the find. It cannot be undone."); this.draw(); return; }
          const r = removeDiscovery(this.entries, e.id);
          if (r.ok && this.persist(r.value)) { this.say("The find has been deleted. Its branches are now attached to its parent."); if (this.branchOf === e.id) this.branchOf = null; if (this.origin === e.id) this.origin = null; } else if (!r.ok) this.say(r.message);
          this.confirming = null; this.draw();
        }, "atlasRemove"),
      );
      c.append(row);
    }
    return c;
  }

  private button(label: string, onClick: () => void, key: string, title?: string): HTMLButtonElement {
    const b = node("button", label); b.type = "button"; b.dataset[key] = "";
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---- for tests and for other panels --------------------------------------------------------------------------------------------------
  list(): readonly AtlasEntry[] { return this.entries; }
}
