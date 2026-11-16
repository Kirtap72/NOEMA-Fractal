import {
  attemptSeed,
  choiceOf,
  collectionToJson,
  createDefaultScene,
  createEngine,
  createFormulaRecord,
  isCopyOf,
  judgeStructure,
  measureThumbnail,
  parseCollection,
  parseFormula,
  THUMBNAIL_LIMITS,
  withRecordRating,
  withThumbnailMeasures,
} from "../engine";
import { FORMULA_FAMILIES, MUTATION_STRENGTHS, generateProgram, mutateProgram, programToFormulaText } from "../engine/formulaGrammar";
import type { FormulaFamily, FormulaProgram, MutationStrength } from "../engine/formulaGrammar";
import type { Engine, FilterMeasures, FilterResult, Formula, FormulaRecord, ThumbnailLayers, ThumbnailMeasures } from "../engine";
import { FormulaStore } from "./formulaStore";
import type { StoredFormula } from "./formulaStore";
import type { WorkerAnswer, WorkerRequest } from "./formulaWorker";

/** One accepted formula in the grid. */
export interface GridEntry {
  program: FormulaProgram;
  text: string;
  formula: Formula;
  filter: FilterResult;
  thumbnail: ThumbnailMeasures;
  layers: ThumbnailLayers;
  picture: string;
  rating: number | null;
  locked: boolean;
}

export interface FormulaGridHandlers {
  /** The formulas in formulas/ (for the credits of the building blocks). */
  library(): readonly Formula[];
  /** Saved or imported formulas that should be usable in scenes from now on. */
  addToLibrary(formulas: readonly Formula[]): void;
  /** The user picked a formula: show it in the main view at the measured distance with the measured step factor. */
  onSelect(formula: Formula, measures: Pick<FilterMeasures, "viewDistance" | "stepFactor">): void;
  onMessage(text: string): void;
}

const CELLS = 12;
const MUTANTS = 8;
const THUMB_W = 160;
const THUMB_H = 120;
/** The size the structure and copy tests are measured on (calibrated at this size, 8.21 step 3). */
const MEASURE_SIZE = 96;
const WORKER_TIME_LIMIT_MS = 4000;
const MAX_CANDIDATES = 200;
/** Tries per mutant place before the place is left empty (8.21 section 4). */
const MUTANT_TRIES = 10;

const FAMILY_NAMES: Record<FormulaFamily, string> = {
  kifs: "A. Kalejdoskopisk IFS",
  mandelbox: "B. Mandelbox-familjen",
  kali: "C. Kali-familjen",
  mixed: "D. Blandade vikningar",
  power: "E. With power steps",
};
const STRENGTH_NAMES: Record<MutationStrength, string> = { small: "Small", medium: "Medium", large: "Large" };
const REASON_NAMES: Record<string, string> = {
  invalid: "invalid",
  "not-a-number": "invalid numbers",
  empty: "tom",
  solid: "massiv",
  "no-view": "not visible",
  unreliable: "unreliable distance",
  "too-empty": "picture too small",
  "too-full": "fills the picture",
  flat: "platt",
  "no-structure": "no structure",
  copy: "kopia",
  slow: "too slow",
  error: "fel",
};

function download(name: string, text: string, type: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * "Random formula" (ARCHITECTURE.md 8.21, steps 4 and 5): a grid of thumbnails of new formulas, mutation of a chosen
 * one, ratings, saving in the browser, and export and import of collections.
 */
export class FormulaGrid {
  private overlay!: HTMLDivElement;
  private familySelect!: HTMLSelectElement;
  private seedInput!: HTMLInputElement;
  private startButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private status!: HTMLDivElement;
  private cells: HTMLDivElement[] = [];
  private entries: (GridEntry | null)[] = new Array(CELLS).fill(null);
  private selected = -1;
  private selBox!: HTMLDivElement;
  private selName!: HTMLDivElement;
  private stars: HTMLButtonElement[] = [];
  private strength!: HTMLSelectElement;
  private mutateButton!: HTMLButtonElement;
  private lock!: HTMLInputElement;
  private savedList!: HTMLDivElement;
  private savedTitle!: HTMLDivElement;
  private withRatings!: HTMLInputElement;
  private running = false;
  /** Read-only fence for the newer gallery; generation/selection behavior is unchanged. */
  get busy():boolean{return this.running;}
  private cancelled = false;
  private thumbEngine: Engine | null = null;
  private worker: Worker | null = null;
  private nextId = 1;
  private store = new FormulaStore();
  private saved: StoredFormula[] = [];

  constructor(
    private openRoot: HTMLElement,
    private handlers: FormulaGridHandlers,
  ) {
    this.build();
  }

  /** Reads the saved formulas, puts them in the library and returns them (called once at start). */
  async loadSaved(): Promise<void> {
    try {
      this.saved = await this.store.listFormulas();
    } catch {
      this.saved = [];
      return; // no IndexedDB (for example a private window): the grid still works, nothing is kept
    }
    const formulas: Formula[] = [];
    for (const s of this.saved) {
      const p = parseFormula(s.text);
      if (p.ok) formulas.push(p.formula);
    }
    this.handlers.addToLibrary(formulas);
    this.renderSaved();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private button(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = this.el("button", undefined, text);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  private build(): void {
    this.openRoot.append(this.el("div", "ctitle", "Randomise the formula"));
    this.openRoot.append(this.el("div", "ainfo", "Creates new formulas from building blocks, sorts out those that cannot be drawn and shows the rest as thumbnails."));
    this.openRoot.append(this.button("Show the grid", "Opens the grid with random formulas and your saved formulas", () => this.show(true)));

    this.overlay = this.el("div", "fgrid panel");
    this.overlay.hidden = true;
    this.overlay.setAttribute("role", "region");
    this.overlay.setAttribute("aria-label", "Randomised formulas");
    const head = this.el("div", "fgridhead");
    this.familySelect = this.el("select");
    this.familySelect.add(new Option("All families", "all"));
    for (const f of FORMULA_FAMILIES) this.familySelect.add(new Option(FAMILY_NAMES[f], f));
    this.seedInput = this.el("input");
    this.seedInput.type = "number";
    this.seedInput.min = "0";
    this.seedInput.max = "4294967295";
    this.seedInput.placeholder = "seed (randomised)";
    this.seedInput.title = "The same seed and family give the same batch of formulas. Leave empty for a new one every time.";
    this.startButton = this.button("Randomise formulas", "Fills the cells that are not kept with new formulas", () => void this.runRound());
    this.stopButton = this.button("Cancel", "Stops looking for the formula being tried now", () => (this.cancelled = true));
    this.stopButton.disabled = true;
    head.append(this.familySelect, this.seedInput, this.startButton, this.stopButton, this.button("Close", "Hides the grid", () => this.show(false)));
    this.status = this.el("div", "ainfo", "Press Randomise formulas.");

    const grid = this.el("div", "fgridcells");
    for (let i = 0; i < CELLS; i++) {
      const cell = this.el("div", "fcell");
      cell.tabIndex = 0;
      cell.addEventListener("click", () => this.pick(i));
      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") this.pick(i);
      });
      this.cells.push(cell);
      grid.append(cell);
    }

    // What can be done with the chosen formula.
    this.selBox = this.el("div", "fsel");
    this.selName = this.el("div", "ainfo", "No formula chosen.");
    const starRow = this.el("div", "rbuttons");
    for (let i = 1; i <= 5; i++) {
      const b = this.button("☆", `Betyg ${i} av 5`, () => this.rate(i));
      b.setAttribute("aria-label", `Betyg ${i} av 5`);
      this.stars.push(b);
      starRow.append(b);
    }
    this.strength = this.el("select");
    for (const s of MUTATION_STRENGTHS) this.strength.add(new Option(`Mutation: ${STRENGTH_NAMES[s]}`, s));
    this.strength.value = "medium";
    this.mutateButton = this.button("Mutera", "Makes 8 variations of the chosen formula (5 small changes of the numbers, a swap, an addition or removal and a new order)", () => void this.mutate());
    this.lock = this.el("input");
    this.lock.type = "checkbox";
    this.lock.title = "A kept cell is not replaced when new formulas are randomised";
    this.lock.addEventListener("change", () => {
      const e = this.entries[this.selected];
      if (e) e.locked = this.lock.checked;
      this.cells[this.selected]?.classList.toggle("locked", this.lock.checked);
    });
    const lockLabel = this.el("label", undefined, " Keep");
    lockLabel.prepend(this.lock);
    const actions = this.el("div", "rbuttons");
    actions.append(
      this.strength,
      this.mutateButton,
      lockLabel,
      this.button("Save", "Saves the formula, the thumbnail, the measurements and your rating in the browser", () => void this.saveSelected()),
      this.button("Download .yaml", "Downloads the formula file (with credits), which can be put in the formulas/ folder or shared", () => this.downloadSelected()),
    );
    this.selBox.append(this.selName, starRow, actions);

    // Saved formulas.
    this.savedTitle = this.el("div", "ctitle", "Saved formulas");
    this.savedList = this.el("div", "fsaved");
    const files = this.el("div", "rbuttons");
    this.withRatings = this.el("input");
    this.withRatings.type = "checkbox";
    const withLabel = this.el("label", undefined, " with my ratings and choices");
    withLabel.prepend(this.withRatings);
    const importInput = this.el("input");
    importInput.type = "file";
    importInput.accept = ".json,.yaml,.yml";
    importInput.addEventListener("change", () => void this.importFile(importInput));
    const importLabel = this.el("label", "open", "Open collection or formula: ");
    importLabel.append(importInput);
    files.append(this.button("Export collection", "Saves all saved formulas with thumbnails and measurements in a file that others can open", () => void this.exportCollection()), withLabel, importLabel);

    this.overlay.append(head, this.status, grid, this.selBox, this.savedTitle, this.savedList, files);
    document.body.append(this.overlay);
    this.showSelection();
  }

  private show(visible: boolean): void {
    this.overlay.hidden = !visible;
    if (!visible) this.cancelled = true;
  }

  // ---- choosing and rating

  private pick(i: number): void {
    const entry = this.entries[i];
    if (!entry) return;
    this.selected = i;
    // A formula that is already saved shows the rating it was saved with.
    const stored = this.saved.find((x) => x.id === entry.formula.id);
    if (entry.rating === null && stored?.record) entry.rating = stored.record.rating.value;
    this.cells.forEach((c, k) => c.classList.toggle("selected", k === i));
    this.showSelection();
    // An implicit choice: this formula was picked over the others shown (8.21 section 8.1 c).
    const shown = this.entries.filter((e): e is GridEntry => e !== null).map((e) => e.formula.id);
    if (shown.length > 1) this.store.addChoice(choiceOf(entry.formula.id, shown, new Date())).catch(() => undefined);
    this.handlers.onSelect(entry.formula, entry.filter.measures);
  }

  private showSelection(): void {
    const e = this.entries[this.selected] ?? null;
    this.selBox.style.opacity = e ? "1" : "0.5";
    this.selName.textContent = e ? `${e.formula.name}: ${e.formula.description ?? ""}` : "No formula chosen. Click a thumbnail.";
    this.stars.forEach((b, k) => (b.textContent = e && e.rating !== null && k < e.rating ? "★" : "☆"));
    this.lock.checked = e?.locked ?? false;
    this.mutateButton.disabled = !e || this.running;
  }

  private rate(n: number): void {
    const e = this.entries[this.selected];
    if (!e) return;
    e.rating = e.rating === n ? null : n;
    this.showSelection();
    // A saved formula gets the new rating at once.
    const stored = this.saved.find((s) => s.id === e.formula.id);
    if (stored?.record) {
      stored.record = withRecordRating(stored.record, e.rating, new Date());
      void this.store.putFormula(stored).then(() => this.renderSaved());
    }
  }

  // ---- finding formulas

  private filterInWorker(text: string): Promise<FilterResult | "slow" | "error"> {
    if (!this.worker) this.worker = new Worker(new URL("./formulaWorker.ts", import.meta.url), { type: "module" });
    const worker = this.worker;
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        resolve("slow");
      }, WORKER_TIME_LIMIT_MS);
      const listener = (e: MessageEvent<WorkerAnswer>) => {
        if (e.data.id !== id) return;
        clearTimeout(timer);
        worker.removeEventListener("message", listener);
        resolve(e.data.ok ? e.data.result : "error");
      };
      worker.addEventListener("message", listener);
      worker.postMessage({ id, text } satisfies WorkerRequest);
    });
  }

  /** Runs every filter on a program; returns the grid entry, or why it was thrown away. */
  private async evaluate(program: FormulaProgram, shown: readonly ThumbnailLayers[], copyLimit: number): Promise<GridEntry | string> {
    const text = programToFormulaText(program, this.handlers.library());
    const filter = await this.filterInWorker(text);
    if (filter === "slow" || filter === "error") return filter;
    if (!filter.passed) return filter.reason!;
    const parsed = parseFormula(text);
    if (!parsed.ok) return "invalid";
    if (!this.thumbEngine) this.thumbEngine = await createEngine({});
    const engine = this.thumbEngine;
    engine.setFormulas([parsed.formula]);
    const set = await engine.setScene(createDefaultScene({ ...parsed.formula, cameraDistance: filter.measures.viewDistance }));
    if (set.errors.length > 0) return "error";
    const l = await engine.renderLayersToBuffer(MEASURE_SIZE, MEASURE_SIZE, { quality: { samples_per_pixel: 1 } });
    const layers: ThumbnailLayers = { width: MEASURE_SIZE, height: MEASURE_SIZE, depth: l.depth, normal: l.normal, color: l.color };
    const thumbnail = measureThumbnail(layers);
    const verdict = judgeStructure(thumbnail);
    if (!verdict.passed) return verdict.reason;
    if (isCopyOf(layers, shown, copyLimit)) return "copy";
    const pic = await engine.renderToBuffer(THUMB_W, THUMB_H, { quality: { samples_per_pixel: 2 } });
    const canvas = this.el("canvas");
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pic.data), THUMB_W, THUMB_H), 0, 0);
    return { program, text, formula: parsed.formula, filter, thumbnail, layers, picture: canvas.toDataURL("image/png"), rating: null, locked: false };
  }

  private place(i: number, entry: GridEntry | null): void {
    this.entries[i] = entry;
    const cell = this.cells[i]!;
    cell.classList.remove("selected");
    cell.classList.toggle("locked", entry?.locked ?? false);
    if (!entry) {
      cell.replaceChildren();
      cell.title = "";
      return;
    }
    const img = this.el("img");
    img.src = entry.picture;
    img.alt = entry.formula.name;
    const label = this.el("div", "fcelllabel", `${FAMILY_NAMES[entry.program.family].slice(0, 2)} ${entry.program.seed}${entry.program.parent ? " (variant)" : ""}`);
    cell.replaceChildren(img, label);
    cell.title = `${entry.formula.name}\n${entry.formula.description ?? ""}\nStep factor ${entry.filter.measures.stepFactor.toFixed(2)}`;
  }

  /** Runs a search: `next(n)` gives candidate n for place `slot`. Fills the given places, in order. */
  private async search(slots: number[], next: (slot: number, n: number) => FormulaProgram | null, describe: string, copyLimit: number): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.startButton.disabled = true;
    this.stopButton.disabled = false;
    this.mutateButton.disabled = true;
    const shown: ThumbnailLayers[] = this.entries.filter((e, i): e is GridEntry => e !== null && !slots.includes(i)).map((e) => e.layers);
    for (const s of slots) this.place(s, null);
    const rejected: Record<string, number> = {};
    let tried = 0;
    let filled = 0;
    const report = (extra = "") => {
      const why = Object.entries(rejected)
        .map(([k, n]) => `${REASON_NAMES[k] ?? k} ${n}`)
        .join(", ");
      this.status.textContent = `${describe} · tried ${tried} · approved ${filled}${why ? ` · kastade: ${why}` : ""}${extra}`;
    };
    try {
      for (const slot of slots) {
        for (let n = 0; !this.cancelled; n++) {
          const program = next(slot, n);
          if (!program) break;
          tried++;
          report(" …");
          let result: GridEntry | string;
          try {
            result = await this.evaluate(program, shown, copyLimit);
          } catch {
            result = "error";
          }
          if (typeof result === "string") {
            rejected[result] = (rejected[result] ?? 0) + 1;
            continue;
          }
          shown.push(result.layers);
          this.place(slot, result);
          filled++;
          break;
        }
        if (this.cancelled) break;
      }
      report(this.cancelled ? " · cancelled" : " · done");
    } catch (err) {
      this.handlers.onMessage(`The grid could not be filled: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
      this.startButton.disabled = false;
      this.stopButton.disabled = true;
      this.showSelection();
    }
  }

  private async runRound(): Promise<void> {
    const typed = this.seedInput.value.trim();
    const base = typed === "" ? Math.floor(Math.random() * 4294967296) : Math.floor(Number(typed));
    if (!Number.isFinite(base) || base < 0 || base > 4294967295) {
      this.handlers.onMessage("The seed must be an integer from 0 to 4,294,967,295.");
      return;
    }
    const family = this.familySelect.value === "all" ? undefined : (this.familySelect.value as FormulaFamily);
    const slots = this.entries.map((e, i) => (e?.locked ? -1 : i)).filter((i) => i >= 0);
    this.selected = this.entries[this.selected]?.locked ? this.selected : -1;
    // One running counter for the whole round, so that the same seed always gives the same candidates in the same order.
    let counter = 0;
    await this.search(
      slots,
      () => (counter < MAX_CANDIDATES ? generateProgram(attemptSeed(base, counter++), family ? { family } : {}) : null),
      `Seed ${base}${family ? `, ${FAMILY_NAMES[family]}` : ""}`,
      THUMBNAIL_LIMITS.copyAgreement,
    );
  }

  private async mutate(): Promise<void> {
    const parent = this.entries[this.selected];
    if (!parent) return;
    const strength = this.strength.value as MutationStrength;
    // The parent moves to the first place; the 8 variants take the next places that are not kept.
    const keep = this.entries.map((e, i) => (e && (e.locked || i === this.selected) ? e : null));
    const others = keep.filter((e, i): e is GridEntry => e !== null && i !== this.selected);
    this.entries = new Array(CELLS).fill(null);
    this.place(0, parent);
    let at = 1;
    for (const e of others) if (at < CELLS) this.place(at++, e);
    for (let i = at; i < CELLS; i++) this.place(i, null);
    this.selected = 0;
    this.cells[0]!.classList.add("selected");
    const slots = Array.from({ length: Math.min(MUTANTS, CELLS - at) }, (_, k) => at + k);
    await this.search(
      slots,
      (slot, n) => {
        if (n >= MUTANT_TRIES) return null;
        const variant = slot - at + n * MUTANTS; // same kind of change on every try for this place
        try {
          return mutateProgram(parent.program, variant, strength);
        } catch {
          return null;
        }
      },
      `Varianter av ${parent.formula.name} (${STRENGTH_NAMES[strength].toLowerCase()} mutation)`,
      THUMBNAIL_LIMITS.mutationCopyAgreement,
    );
  }

  // ---- saving, export and import

  private recordOf(e: GridEntry): FormulaRecord {
    const p = e.program;
    const origin = { grammar: p.grammar, seed: p.seed, family: p.family, operations: p.operations.map((o) => o.template), ...(p.parent ? { parent: p.parent } : {}) };
    let record = createFormulaRecord(e.formula.id, e.text, e.filter, new Date(), origin);
    record = withThumbnailMeasures(record, e.thumbnail, "passed");
    return withRecordRating(record, e.rating, new Date());
  }

  private async saveSelected(): Promise<void> {
    const e = this.entries[this.selected];
    if (!e) return;
    const stored: StoredFormula = { id: e.formula.id, text: e.text, record: this.recordOf(e), thumbnail: e.picture, saved_at: new Date().toISOString() };
    try {
      await this.store.putFormula(stored);
    } catch (err) {
      this.handlers.onMessage(`The formula could not be saved in the browser: ${err instanceof Error ? err.message : String(err)}. Use Download .yaml.`);
      return;
    }
    this.saved = [...this.saved.filter((s) => s.id !== stored.id), stored];
    this.handlers.addToLibrary([e.formula]);
    this.renderSaved();
    this.status.textContent = `Saved ${e.formula.name}.`;
  }

  private downloadSelected(): void {
    const e = this.entries[this.selected];
    if (e) download(`${e.formula.id}.yaml`, e.text, "text/yaml");
  }

  private renderSaved(): void {
    this.savedTitle.textContent = `Saved formulas (${this.saved.length})`;
    this.savedList.replaceChildren();
    if (this.saved.length === 0) {
      this.savedList.append(this.el("div", "ainfo", "None saved yet. Choose a thumbnail and press Save."));
      return;
    }
    const sorted = [...this.saved].sort((a, b) => (b.record?.rating.value ?? 0) - (a.record?.rating.value ?? 0) || (a.saved_at < b.saved_at ? 1 : -1));
    for (const s of sorted) {
      const row = this.el("div", "fsavedrow");
      if (s.thumbnail) {
        const img = this.el("img");
        img.src = s.thumbnail;
        img.alt = "";
        row.append(img);
      } else row.append(this.el("span"));
      const parsed = parseFormula(s.text);
      const name = parsed.ok ? parsed.formula.name : s.id;
      const r = s.record?.rating.value ?? 0;
      row.append(this.el("span", "fsavedname", `${name}  ${"★".repeat(r)}${"☆".repeat(5 - r)}`));
      row.append(
        this.button("Open", "Shows the formula in the large view", () => {
          if (!parsed.ok) return;
          const m = s.record?.measures;
          this.handlers.onSelect(parsed.formula, { viewDistance: m?.viewDistance || (parsed.formula.cameraDistance ?? 4), stepFactor: m?.stepFactor || 1 });
        }),
        this.button("✕", "Removes the formula from the browser (a scene that uses it then cannot be opened here)", () => {
          void this.store.deleteFormula(s.id).then(() => {
            this.saved = this.saved.filter((x) => x.id !== s.id);
            this.renderSaved();
          });
        }),
      );
      this.savedList.append(row);
    }
  }

  private async exportCollection(): Promise<void> {
    if (this.saved.length === 0) {
      this.handlers.onMessage("There are no saved formulas to export.");
      return;
    }
    const include = this.withRatings.checked;
    const choices = include ? await this.store.listChoices().catch(() => []) : [];
    download("fraktal.formulas.json", collectionToJson(this.saved, { includeRatings: include, choices }), "application/json");
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 100_000_000) return this.handlers.onMessage("The file is too large (at most 100 MB).");
    const text = await file.text();
    const now = new Date().toISOString();
    let incoming: StoredFormula[] = [];
    if (/\.ya?ml$/i.test(file.name)) {
      const parsed = parseFormula(text);
      if (!parsed.ok) return this.handlers.onMessage([`${file.name} is not a valid formula file:`, ...parsed.errors].join("\n"));
      incoming = [{ id: parsed.formula.id, text, saved_at: now }];
    } else {
      const c = parseCollection(text);
      if (!c.ok) return this.handlers.onMessage([`${file.name} is not a valid collection:`, ...c.errors].join("\n"));
      incoming = c.formulas.map((f) => ({ id: f.formula.id, text: f.text, ...(f.record ? { record: f.record } : {}), ...(f.thumbnail ? { thumbnail: f.thumbnail } : {}), saved_at: now }));
      for (const choice of c.choices) await this.store.addChoice(choice).catch(() => undefined);
      if (c.warnings.length > 0) this.handlers.onMessage(["Some parts were skipped:", ...c.warnings].join("\n"));
    }
    // A formula whose id is already used by a file in formulas/ is not added (it would hide that file).
    const base = new Set(this.handlers.library().map((f) => f.id));
    const added: Formula[] = [];
    for (const s of incoming) {
      if (base.has(s.id)) continue;
      const p = parseFormula(s.text);
      if (!p.ok) continue;
      try {
        await this.store.putFormula(s);
      } catch {
        // kept for this session only
      }
      this.saved = [...this.saved.filter((x) => x.id !== s.id), s];
      added.push(p.formula);
    }
    this.handlers.addToLibrary(added);
    this.renderSaved();
    this.status.textContent = `Read ${added.length} formulas from ${file.name}.`;
  }
}

