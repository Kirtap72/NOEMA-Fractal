import { LIGHT_RIGS } from "../engine/lightRigs";
import type { RigMode } from "../engine/lightRigs";
import { applyLook, createLookRecord, lookContents, lookHas, readLookRecord, updateLook } from "../engine/looks";
import type { UpdateChoice } from "../engine/looks";
import type { CaptureChoice, CaptureResult, LookParts, LookRecord } from "../engine/looks";
import { approximateSwatch, searchMaterials, sortMaterials, unknownSwatch } from "../engine/materialBrowse";
import type { Scene } from "../engine/scene";
import type { SubjectReference } from "../engine/subjectScale";
import { LookAudition } from "./lookAudition";
import type { LookHost } from "./lookAudition";
import { importLooks } from "./lookTransfer";
import { readLibraryBackupFile } from "./libraryBackupFile";
import { desktop } from "./desktop";
import { LookStore } from "./lookStore";
import type { LookEntry } from "./lookStore";

export interface LookPanelHandlers {
  host: LookHost;
  /** Takes the chosen parts from the current scene. */
  capture(choice: CaptureChoice): CaptureResult;
  scene(): Scene;
  subject(): SubjectReference | null;
}

const LOAD_LIMIT = 200;

/**
 * Looks: save the current material, optional gradient, a lighting rig and optional fog under a name, and apply them
 * later as one undoable step. Plain DOM, text only. Camera framing and depth of field are never part of a Look.
 * Building, opening, searching, selecting and trying never change the scene; only "Apply Look" writes.
 */
export class LookPanel {
  private store = new LookStore();
  private audition: LookAudition;
  private details!: HTMLDetailsElement;
  private name!: HTMLInputElement;
  private saveMaterial!: HTMLInputElement;
  private saveColor!: HTMLInputElement;
  private saveFog!: HTMLInputElement;
  private rig!: HTMLSelectElement;
  private rigMode!: HTMLSelectElement;
  private rigShadows!: HTMLInputElement;
  private search!: HTMLInputElement;
  private count!: HTMLElement;
  private list!: HTMLElement;
  private detail!: HTMLElement;
  private banner!: HTMLElement;
  private status!: HTMLElement;
  private restore!: HTMLButtonElement;
  private undo!: HTMLButtonElement;
  private entries: LookEntry[] = [];
  private records = new Map<string, { fingerprint: string; record?: LookRecord }>();
  private selected?: LookRecord;
  private partBoxes = new Map<keyof LookParts, HTMLInputElement>();
  private tiles = new Map<string, { swatch: HTMLElement; info: HTMLElement }>();
  private generation = 0;
  private busy = false;

  constructor(
    private root: HTMLElement,
    private handlers: LookPanelHandlers,
  ) {
    this.audition = new LookAudition(handlers.host, () => this.showTrial());
    this.build();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  }

  private button(label: string, click: () => void, data?: string): HTMLButtonElement {
    const b = this.el("button", label);
    b.type = "button";
    b.onclick = click;
    if (data) b.dataset[data] = "";
    return b;
  }

  private check(label: string, checked: boolean, data: string): { row: HTMLLabelElement; input: HTMLInputElement } {
    const input = this.el("input");
    input.type = "checkbox";
    input.checked = checked;
    input.dataset[data] = "";
    const row = this.el("label", " " + label);
    row.prepend(input);
    return { row, input };
  }

  private build(): void {
    this.details = this.el("details");
    this.details.id = "artist-looks";
    this.details.append(this.el("summary", "Looks (material, light and fog)"));
    this.details.addEventListener("toggle", () => {
      if (this.details.open) void this.refresh();
      else {
        this.generation++;
        this.audition.close();
      }
    });
    const body = this.el("div");
    this.details.append(body);

    body.append(this.el("div", "Save the current Look", "ctitle"));
    this.name = this.el("input");
    this.name.type = "text";
    this.name.maxLength = 120;
    this.name.placeholder = "Name of the Look";
    this.name.setAttribute("aria-label", "Look name");
    this.name.dataset.lookName = "";
    body.append(this.name);
    const material = this.check("Material", true, "lookSaveMaterial");
    const color = this.check("Gradient and colour", false, "lookSaveColor");
    const fog = this.check("Fog (saved scale-free)", false, "lookSaveFog");
    this.saveMaterial = material.input;
    this.saveColor = color.input;
    this.saveFog = fog.input;
    body.append(material.row, color.row, fog.row);
    this.rig = this.el("select");
    this.rig.setAttribute("aria-label", "Light rig in the Look");
    this.rig.dataset.lookRig = "";
    this.rig.add(new Option("No light rig", ""));
    for (const r of LIGHT_RIGS) this.rig.add(new Option(r.name, r.id));
    this.rigMode = this.el("select");
    this.rigMode.setAttribute("aria-label", "What the rig does with directional lights");
    this.rigMode.add(new Option("Replace directional lights", "replace-directional"));
    this.rigMode.add(new Option("Add the rig", "add"));
    const shadows = this.check("Soft shadows on the main light of the rig", false, "lookRigShadows");
    this.rigShadows = shadows.input;
    const rigRow = this.el("label", "Light rig: ");
    rigRow.append(this.rig, this.rigMode);
    body.append(rigRow, shadows.row);
    body.append(this.button("Save Look", () => void this.save(), "lookSave"));
    body.append(
      this.el(
        "small",
        "Camera, picture cut-out and depth of field are never part of a Look: they belong to the composition. A light rig is saved as a template and calculated from the camera when the Look is applied. The fog is saved relative to the distance of the subject, so it suits other scenes.",
      ),
    );

    body.append(this.el("div", "Your Looks", "ctitle"));
    const transfer = this.el("div");
    const file = this.el("input");
    file.type = "file";
    file.hidden = true;
    file.accept = ".json,.gz";
    file.setAttribute("aria-label", "Import Look backup");
    file.dataset.lookImportFile = "";
    file.onchange = () => {
      const f = file.files?.[0];
      file.value = "";
      if (f) void this.importFile(f); // choosing nothing (cancel) does not even get here
    };
    transfer.append(
      this.button("Export Looks…", () => void this.exportLooks(), "lookExport"),
      this.button("Import Looks…", () => file.click(), "lookImport"),
      file,
    );
    transfer.title = "Backup of the Look collection only. Import adds new Looks and never overwrites existing ones.";
    body.append(transfer);
    this.search = this.el("input");
    this.search.type = "search";
    this.search.placeholder = "Search Looks";
    this.search.setAttribute("aria-label", "Search Looks");
    this.search.dataset.lookSearch = "";
    this.search.addEventListener("input", () => this.render());
    this.count = this.el("div", "", "ainfo");
    this.list = this.el("div");
    this.list.className = "look-list";
    body.append(this.search, this.count, this.list);

    this.banner = this.el("div", "", "ainfo");
    this.banner.dataset.lookTrial = "";
    this.banner.setAttribute("role", "status");
    this.restore = this.button("Restore original", () => this.audition.restore(), "lookRestore");
    this.undo = this.button("Undo apply", () => void this.audition.undoApply(), "lookUndo");
    body.append(this.banner, this.restore, this.undo);

    this.detail = this.el("div");
    this.detail.dataset.lookDetail = "";
    body.append(this.detail);
    this.status = this.el("div");
    this.status.dataset.lookStatus = "";
    this.status.setAttribute("role", "status");
    body.append(this.status);
    this.root.append(this.details);
    this.showTrial();
  }

  // ---- saving --------------------------------------------------------------------------------------------------------

  private async save(): Promise<void> {
    if (this.busy) return;
    const choice: CaptureChoice = {
      material: this.saveMaterial.checked,
      color: this.saveColor.checked,
      fog: this.saveFog.checked,
      ...(this.rig.value ? { rig: { id: this.rig.value, mode: this.rigMode.value as RigMode, shadows: this.rigShadows.checked } } : {}),
    };
    const captured = this.handlers.capture(choice);
    if (!captured.ok) {
      this.status.textContent = captured.message;
      return;
    }
    this.busy = true;
    try {
      const record = createLookRecord(captured.payload, this.name.value.trim() || "Unnamed Look", "look:" + crypto.randomUUID());
      await this.store.put(record);
      this.status.textContent = `The Look "${record.title}" was saved (${lookContents(record.payload).join(", ")}). The scene is unchanged.` + (captured.notes.length ? " " + captured.notes.join(" ") : "");
      this.name.value = "";
      await this.refresh(record.id);
    } catch (error) {
      this.status.textContent = "The Look could not be saved: " + (error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }

  // ---- list ----------------------------------------------------------------------------------------------------------

  private async refresh(select?: string): Promise<void> {
    const generation = ++this.generation;
    try {
      const { entries } = await this.store.page();
      if (generation !== this.generation) return;
      this.entries = entries;
      this.render();
      let loaded = 0;
      for (const entry of sortMaterials(searchMaterials(this.entries, this.search.value), "newest")) {
        const cached = this.records.get(entry.id);
        if (cached && cached.fingerprint === entry.fingerprint) continue;
        if (++loaded > LOAD_LIMIT) break;
        let record: LookRecord | undefined;
        try {
          record = await this.store.get(entry.id);
        } catch {
          record = undefined;
        }
        if (generation !== this.generation) return;
        this.records.set(entry.id, { fingerprint: entry.fingerprint, record });
        this.paint(entry.id);
      }
      if (select) await this.select(select, false);
    } catch (error) {
      if (generation === this.generation) this.status.textContent = "The Look library could not be read: " + (error instanceof Error ? error.message : String(error));
    }
  }

  private render(): void {
    const shown = sortMaterials(searchMaterials(this.entries, this.search.value), "newest");
    this.tiles.clear();
    this.list.replaceChildren();
    for (const entry of shown) {
      const tile = this.el("div", "", "look-tile");
      const card = this.button(entry.title, () => void this.select(entry.id));
      card.className = "look-card";
      card.dataset.lookId = entry.id;
      const swatch = this.el("span", "", "material-swatch");
      swatch.setAttribute("aria-hidden", "true"); // no text: the card's text stays exactly the name
      const info = this.el("small", "", "material-tile-info");
      card.prepend(swatch);
      tile.append(card, info);
      this.list.append(tile);
      this.tiles.set(entry.id, { swatch, info });
      this.paint(entry.id);
    }
    this.count.textContent = this.entries.length === shown.length ? `${shown.length} Looks` : `${shown.length} av ${this.entries.length} Looks`;
  }

  private paint(id: string): void {
    const tile = this.tiles.get(id);
    if (!tile) return;
    const cached = this.records.get(id);
    const record = cached?.record;
    if (!record) {
      const s = unknownSwatch();
      tile.swatch.style.background = s.background;
      tile.swatch.title = s.description;
      tile.info.textContent = cached ? "Could not be read" : "";
      return;
    }
    const swatch = record.payload.material ? approximateSwatch(record.payload.material, record.payload.color) : unknownSwatch();
    tile.swatch.style.background = swatch.background;
    tile.swatch.title = swatch.description;
    tile.info.textContent = lookContents(record.payload).join(" · ");
  }

  // ---- selecting, trying, applying -----------------------------------------------------------------------------------

  private parts(): LookParts {
    const get = (k: keyof LookParts): boolean => this.partBoxes.get(k)?.checked ?? false;
    return { material: get("material"), color: get("color"), rig: get("rig"), fog: get("fog") };
  }

  private async select(id: string, tryIt = true): Promise<void> {
    const generation = ++this.generation;
    this.selected = undefined;
    this.detail.textContent = "Reading the Look…";
    let record: LookRecord | undefined;
    try {
      record = await this.store.get(id);
    } catch (error) {
      this.detail.textContent = "";
      this.status.textContent = "The Look could not be read: " + (error instanceof Error ? error.message : String(error));
      return;
    }
    if (generation !== this.generation || !this.details.open) return;
    if (!record) {
      this.detail.textContent = "";
      this.status.textContent = "The Look no longer exists.";
      return;
    }
    this.selected = record;
    this.inspect(record);
    // Clicking a card shows it at once, but only as a trial: nothing in the scene changes until Apply Look.
    if (tryIt) void this.audition.tryLook(record.id, async () => record, this.parts());
    this.showTrial();
  }

  private inspect(record: LookRecord): void {
    this.detail.replaceChildren();
    this.partBoxes.clear();
    const has = lookHas(record.payload);
    this.detail.append(this.el("div", `${record.title}: ${lookContents(record.payload).join(", ")}`, "ainfo"));
    const names: [keyof LookParts, string][] = [
      ["material", "Material"],
      ["color", "Gradient and colour"],
      ["rig", "Light rig"],
      ["fog", "Fog"],
    ];
    for (const [key, label] of names) {
      if (!has[key]) continue;
      const c = this.check(label, true, "lookPart" + key[0]!.toUpperCase() + key.slice(1));
      c.input.addEventListener("change", () => {
        this.audition.setParts(this.parts());
        this.showTrial();
      });
      this.partBoxes.set(key, c.input);
      this.detail.append(c.row);
    }
    const actions = this.el("div");
    actions.append(
      this.button("Apply Look", () => this.apply(record), "lookApply"),
      this.button("Rename", () => void this.rename(record), "lookRename"),
      this.button("Duplicate", () => void this.duplicate(record), "lookDuplicate"),
      this.button("Delete", () => void this.remove(record), "lookDelete"),
    );
    this.detail.append(actions);

    // Update from the scene: explicit, and only the components chosen here (those the Look has, unless changed).
    const box = this.el("div");
    box.append(this.el("div", "Update this Look from the scene", "ainfo"));
    const updateParts = new Map<keyof LookParts, HTMLInputElement>();
    for (const [key, label] of [["material", "Material"], ["color", "Gradient and colour"], ["fog", "Fog"]] as [keyof LookParts, string][]) {
      const c = this.check(label, has[key], "lookUpdatePart" + key[0]!.toUpperCase() + key.slice(1));
      updateParts.set(key, c.input);
      box.append(c.row);
    }
    const rigChoice = this.el("select");
    rigChoice.setAttribute("aria-label", "Light rig on update");
    rigChoice.dataset.lookUpdateRig = "";
    rigChoice.add(new Option(has.rig ? "Keep the light rig of the Look" : "No light rig", "keep"));
    if (has.rig) rigChoice.add(new Option("Remove the light rig", "none"));
    for (const r of LIGHT_RIGS) rigChoice.add(new Option("Change to " + r.name + " (position and shadows as in the Save part)", r.id));
    box.append(rigChoice);
    box.append(this.button("Update Look from the scene", () => void this.updateFromScene(record, { parts: updateParts, rig: rigChoice }), "lookUpdate"));
    box.append(this.el("small", "Overwrites the saved Look with the current values of the scene (reads the saved scene, never a test). The rig is not taken from the light of the scene but kept or chosen here. Duplicate first if you want to keep the old one."));
    this.detail.append(box);
  }

  private apply(record: LookRecord): void {
    if (this.audition.trial?.id !== record.id) {
      // Applying something that is not on trial: show it first so the artist sees what is about to happen, as one step.
      void this.audition.tryLook(record.id, async () => record, this.parts()).then((ok) => {
        if (ok) this.audition.apply();
        this.showTrial();
      });
      return;
    }
    this.audition.apply();
    this.showTrial();
  }

  private async rename(record: LookRecord): Promise<void> {
    const title = this.name.value.trim();
    if (!title) {
      this.status.textContent = "Write the new name in the name field first.";
      return;
    }
    await this.write(async () => {
      await this.store.put(readLookRecord({ ...record, title }));
      this.status.textContent = `Renamed to "${title}".`;
    }, record.id);
  }

  private async duplicate(record: LookRecord): Promise<void> {
    const copy = readLookRecord({ ...record, id: "look:" + crypto.randomUUID(), title: (this.name.value.trim() || record.title) + " – copy", createdAt: new Date().toISOString() });
    await this.write(async () => {
      await this.store.put(copy);
      this.status.textContent = `Created "${copy.title}".`;
    }, copy.id);
  }

  private async remove(record: LookRecord): Promise<void> {
    if (!confirm(`Delete the Look ${record.title}?`)) return;
    if (this.audition.trial?.id === record.id) this.audition.restore();
    await this.write(async () => {
      await this.store.remove(record.id);
      this.selected = undefined;
      this.detail.replaceChildren();
      this.status.textContent = `Removed "${record.title}".`;
    });
  }

  // ---- backup -------------------------------------------------------------------------------------------------------

  private async exportLooks(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (desktop?.looks) {
        this.status.textContent = (await this.store.exportFile()) ? "Look-backup exporterad." : "The export was cancelled. Nothing was written.";
      } else {
        const backup = await this.store.exportBackup();
        const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
        const a = document.createElement("a");
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = "looks.library.json";
        a.click();
        URL.revokeObjectURL(url);
        this.status.textContent = "Look-backup exporterad.";
      }
    } catch (error) {
      this.status.textContent = "The export failed: " + (error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }

  private async importFile(file: Blob & { name?: string }): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let raw: unknown;
      try {
        raw = await readLibraryBackupFile(file);
      } catch (error) {
        throw Error("The file could not be read as a backup: " + (error instanceof Error ? error.message : String(error)));
      }
      const result = await importLooks(raw, {
        get: (id) => this.store.get(id),
        importRecords: (records) => this.store.importRecords(records),
      });
      this.status.textContent = result.message;
      this.records.clear();
      await this.refresh();
    } catch (error) {
      this.status.textContent = "The import was not made: " + (error instanceof Error ? error.message : String(error)) + " Nothing has been changed.";
    } finally {
      this.busy = false;
    }
  }

  // ---- updating a saved Look from the scene ---------------------------------------------------------------------------

  private async updateFromScene(record: LookRecord, controls: { parts: Map<keyof LookParts, HTMLInputElement>; rig: HTMLSelectElement }): Promise<void> {
    const has = lookHas(record.payload);
    const get = (k: keyof LookParts): boolean => controls.parts.get(k)?.checked ?? false;
    const chosen = controls.rig.value;
    const choice: UpdateChoice = {
      parts: { material: get("material"), color: get("color"), fog: get("fog"), rig: chosen === "none" ? false : chosen === "keep" ? has.rig : true },
      ...(chosen !== "keep" && chosen !== "none" ? { rig: { id: chosen, mode: this.rigMode.value as RigMode, shadows: this.rigShadows.checked } } : {}),
    };
    // The committed scene, never a trial: a trial is only a view on top of it.
    const result = updateLook(record, this.handlers.scene(), this.handlers.subject(), choice);
    if (!result.ok) {
      this.status.textContent = result.message;
      return;
    }
    const what = lookContents(result.record.payload).join(", ");
    if (!confirm(`Overwrite the saved Look "${record.title}" with the current ${what} of the scene? Name and id are kept, but the old definition disappears. Press Cancel and use Duplicate if you want to keep it.`)) {
      this.status.textContent = "The update was cancelled. The Look is unchanged.";
      return;
    }
    if (this.audition.trial?.id === record.id) this.audition.restore();
    await this.write(async () => {
      await this.store.put(result.record);
      this.status.textContent = `Updated "${record.title}" from the scene (${what}).` + (result.notes.length ? " " + result.notes.join(" ") : "");
    }, record.id);
  }

  private async write(work: () => Promise<void>, select?: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await work();
      this.records.clear();
      await this.refresh(select);
    } catch (error) {
      this.status.textContent = "Look library: " + (error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }

  // ---- display -------------------------------------------------------------------------------------------------------

  private showTrial(): void {
    this.banner.textContent = this.audition.message;
    this.restore.disabled = !this.audition.trial;
    this.undo.disabled = !this.audition.canUndoApply;
  }

  /** Called whenever the lights panel is redrawn: refreshes what the buttons can do. Reads only. */
  update(scene: Scene): void {
    this.saveFog.disabled = !scene.fog.enabled;
    this.saveFog.title = scene.fog.enabled ? "" : "The fog is turned off in the scene.";
    if (this.selected && this.details.open) {
      const plan = applyLook(scene, this.selected.payload, this.parts(), this.handlers.subject(), "plan");
      const apply = this.detail.querySelector<HTMLButtonElement>("[data-look-apply]");
      if (apply) {
        apply.disabled = !plan.ok;
        apply.title = plan.ok ? plan.summary : plan.message;
      }
    }
    this.showTrial();
  }
}
