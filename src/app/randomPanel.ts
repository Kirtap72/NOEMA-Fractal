import {
  CHAIN_STYLES,
  MAX_PRESETS,
  UNVERIFIED_LABEL,
  displayCreditName,
  createPreset,
  mergePresets,
  parsePresets,
  presetsToJson,
  sortPresets,
  tryRandomChain,
  withFreshCredits,
  withPresetRating,
} from "../engine";
import type { ChainStyle, Formula, Preset, PresetOrigin, RandomChain, Scene } from "../engine";

export interface RandomPanelHandlers {
  /** A random chain was made (or a preset was opened): show it. */
  onApply(scene: Scene): void;
  /** The scene as it is now, for saving. */
  currentScene(): Scene;
  onMessage(text: string): void;
}

const STORAGE_KEY = "fraktal.presets";
const STYLE_LABELS: Record<ChainStyle, string> = {
  fold: "Repeated folding",
  warp: "Warped shape",
  hybrid: "Hybrid",
};
/** How many attempts are made before giving up, and how many in a row before the page gets a chance to redraw. */
const MAX_ATTEMPTS = 80;

/**
 * Random chains, rating and saved presets. Presets are kept in the browser (localStorage) and can be exported to,
 * and opened from, a file that carries the credits of every formula. Text only; nothing from files becomes HTML.
 */
export class RandomPanel {
  private styleSelect!: HTMLSelectElement;
  private seedInput!: HTMLInputElement;
  private status!: HTMLDivElement;
  private creditLine!: HTMLDivElement;
  private nameInput!: HTMLInputElement;
  private stars: HTMLButtonElement[] = [];
  private list!: HTMLDivElement;
  private makeButton!: HTMLButtonElement;
  private presets: Preset[] = [];
  private rating = 0;
  /** The last chain made here, so a saved preset can say how it was made while the chain is unchanged. */
  private last: { origin: PresetOrigin; content: string } | null = null;
  private busy = false;

  constructor(
    private root: HTMLElement,
    private formulas: readonly Formula[],
    private handlers: RandomPanelHandlers,
  ) {
    this.presets = this.readStored();
    this.build();
    this.renderList();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private row(label: string, ...controls: HTMLElement[]): HTMLElement {
    const r = this.el("label", "arow");
    r.append(this.el("span", undefined, label), ...controls);
    return r;
  }

  private build(): void {
    this.root.append(this.el("div", "ctitle", "Randomise chain"));

    this.styleSelect = this.el("select");
    this.styleSelect.add(new Option("All kinds", "all"));
    for (const s of CHAIN_STYLES) this.styleSelect.add(new Option(STYLE_LABELS[s], s));
    this.styleSelect.title = "Repeated folding: folds and scaling again and again, finished with a shape. Warped shape: space is bent before a shape or fractal. Hybrid: two fractals with a step in between.";
    this.root.append(this.row("Kind", this.styleSelect));

    this.seedInput = this.el("input");
    this.seedInput.type = "number";
    this.seedInput.min = "0";
    this.seedInput.max = "4294967295";
    this.seedInput.step = "1";
    this.seedInput.placeholder = "randomised";
    this.seedInput.title = "The same seed always gives the same chain. Leave empty for a new one every time.";
    this.root.append(this.row("Seed", this.seedInput));

    this.makeButton = this.el("button", undefined, "Randomise a new chain");
    this.makeButton.type = "button";
    this.makeButton.addEventListener("click", () => void this.make());
    this.root.append(this.makeButton);

    this.status = this.el("div", "ainfo");
    this.creditLine = this.el("div", "ainfo");
    this.root.append(this.status, this.creditLine);

    this.root.append(this.el("div", "ctitle", "Rate and save"));
    const starRow = this.el("div", "stars");
    starRow.style.display = "flex";
    starRow.style.gap = "2px";
    for (let i = 1; i <= 5; i++) {
      const b = this.el("button", undefined, "☆");
      b.type = "button";
      b.title = `${i} av 5`;
      b.setAttribute("aria-label", `Rating ${i} of 5`);
      b.addEventListener("click", () => this.setRating(this.rating === i ? 0 : i));
      this.stars.push(b);
      starRow.append(b);
    }
    this.root.append(this.row("Rating", starRow));

    this.nameInput = this.el("input");
    this.nameInput.type = "text";
    this.nameInput.maxLength = 80;
    this.nameInput.placeholder = "Name";
    this.root.append(this.row("Name", this.nameInput));

    const save = this.el("button", undefined, "Save as preset");
    save.type = "button";
    save.title = "Saves the scene as it is now, with rating and credits, in the browser.";
    save.addEventListener("click", () => this.save());
    this.root.append(save);

    this.root.append(this.el("div", "ctitle", "Presets"));
    this.list = this.el("div", "kflist");
    this.list.style.maxHeight = "14rem";
    this.root.append(this.list);

    const files = this.el("div", "rbuttons");
    const exportButton = this.el("button", undefined, "Save to file");
    exportButton.type = "button";
    exportButton.addEventListener("click", () => this.exportFile());
    const importLabel = this.el("label", "open", "Open file: ");
    const importInput = this.el("input");
    importInput.type = "file";
    importInput.accept = ".json,application/json";
    importInput.addEventListener("change", () => void this.importFile(importInput));
    importLabel.append(importInput);
    files.append(exportButton, importLabel);
    this.root.append(files);
    this.showRating();
  }

  private showRating(): void {
    this.stars.forEach((b, i) => (b.textContent = i < this.rating ? "★" : "☆"));
  }

  private setRating(n: number): void {
    this.rating = n;
    this.showRating();
  }

  /** Looks for a chain, a few attempts at a time so the page stays alive, and shows it. */
  private async make(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.makeButton.disabled = true;
    try {
      const typed = this.seedInput.value.trim();
      const seed = typed === "" ? Math.floor(Math.random() * 4294967296) : Math.floor(Number(typed));
      if (!Number.isFinite(seed) || seed < 0 || seed > 4294967295) {
        this.handlers.onMessage("The seed must be an integer from 0 to 4,294,967,295.");
        return;
      }
      const style = this.styleSelect.value === "all" ? undefined : (this.styleSelect.value as ChainStyle);
      let found: RandomChain | null = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !found; attempt++) {
        this.status.textContent = `Searching … attempt ${attempt + 1}`;
        await new Promise((r) => setTimeout(r, 0));
        found = tryRandomChain(this.formulas, seed, attempt, style ? { style } : {});
      }
      if (!found) {
        this.status.textContent = "";
        this.handlers.onMessage("No chain that draws anything was found with that seed. Try another.");
        return;
      }
      this.rating = 0;
      this.showRating();
      this.nameInput.value = `${STYLE_LABELS[found.style]} ${seed}`;
      this.last = { origin: { generator: "random-chain", style: found.style, seed: found.seed, attempt: found.attempt }, content: JSON.stringify(found.scene.content) };
      this.status.textContent = `${STYLE_LABELS[found.style]}, seed ${found.seed}, attempt ${found.attempt + 1}`;
      this.showCredits(found.scene);
      const current = this.handlers.currentScene();
      // Keep the colours, lights, fog and image format; the chain, the camera and the timeline (whose keyframes follow the chain) are new.
      this.handlers.onApply({ ...current, camera: found.scene.camera, animation: { ...current.animation, keyframes: [] }, content: found.scene.content });
    } finally {
      this.busy = false;
      this.makeButton.disabled = false;
    }
  }

  /** The formulas of a scene and their authors, marked when a person has not checked them yet. */
  private showCredits(scene: Scene): void {
    const used = new Set(scene.content[0]?.chain.map((s) => s.formula));
    const parts = this.formulas
      .filter((f) => used.has(f.id))
      .map((f) => `${f.name} (${f.credits.map((c) => (c.status === "verified" ? displayCreditName(c.name) :`${displayCreditName(c.name)}, ${UNVERIFIED_LABEL}`)).join("; ")})`);
    this.creditLine.textContent = parts.length > 0 ? `Byggstenar: ${parts.join(" · ")}` : "";
  }

  private save(): void {
    if (this.presets.length >= MAX_PRESETS) {
      this.handlers.onMessage(`There may be at most ${MAX_PRESETS} presets. Remove some first.`);
      return;
    }
    const scene = this.handlers.currentScene();
    const sameChain = this.last !== null && this.last.content === JSON.stringify(scene.content);
    const preset = createPreset(scene, this.formulas, {
      name: this.nameInput.value,
      rating: this.rating,
      now: new Date(),
      ...(sameChain && this.last ? { origin: this.last.origin } : {}),
    });
    this.presets = [preset, ...this.presets];
    this.store();
    this.renderList();
    this.status.textContent = `Saved "${preset.name}".`;
  }

  private renderList(): void {
    this.list.replaceChildren();
    if (this.presets.length === 0) {
      this.list.append(this.el("div", "ainfo", "None saved yet."));
      return;
    }
    for (const p of sortPresets(this.presets)) {
      const row = this.el("div", "kfrow");
      row.style.gridTemplateColumns = "1fr auto auto auto";
      const open = this.el("button", undefined, p.name);
      open.type = "button";
      open.title = "Open the preset";
      open.style.textAlign = "left";
      open.style.overflow = "hidden";
      open.style.textOverflow = "ellipsis";
      open.addEventListener("click", () => this.open(p));
      const stars = this.el("button", undefined, "★".repeat(p.rating) + "☆".repeat(5 - p.rating));
      stars.type = "button";
      stars.title = "Click to raise the rating (after 5 stars it starts over)";
      stars.addEventListener("click", () => {
        this.presets = this.presets.map((x) => (x.id === p.id ? withPresetRating(x, p.rating >= 5 ? 0 : p.rating + 1) : x));
        this.store();
        this.renderList();
      });
      const info = this.el("button", undefined, "i");
      info.type = "button";
      info.title = "Show building blocks and authors";
      info.addEventListener("click", () => {
        this.status.textContent = p.name;
        this.showCredits(p.scene);
      });
      const del = this.el("button", undefined, "✕");
      del.type = "button";
      del.title = "Remove";
      del.addEventListener("click", () => {
        this.presets = this.presets.filter((x) => x.id !== p.id);
        this.store();
        this.renderList();
      });
      row.append(open, stars, info, del);
      this.list.append(row);
    }
  }

  private open(p: Preset): void {
    this.last = p.origin ? { origin: p.origin, content: JSON.stringify(p.scene.content) } : null;
    this.rating = p.rating;
    this.showRating();
    this.nameInput.value = p.name;
    this.status.textContent = `Opened "${p.name}".`;
    this.showCredits(p.scene);
    // The credits of the preset are rebuilt from the library, so a check done since it was saved shows up when it is saved again.
    const { scene } = withFreshCredits(p, this.formulas);
    const { credits: _credits, ...rest } = scene;
    this.handlers.onApply(rest);
  }

  private exportFile(): void {
    if (this.presets.length === 0) {
      this.handlers.onMessage("There are no presets to save.");
      return;
    }
    const text = presetsToJson(this.presets.map((p) => withFreshCredits(p, this.formulas)));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    link.download = "fraktal.presets.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const parsed = parsePresets(await file.text());
    if (!parsed.ok) {
      this.handlers.onMessage([`${file.name} is not a valid presets file:`, ...parsed.errors].join("\n"));
      return;
    }
    const before = this.presets.length;
    this.presets = mergePresets(this.presets, parsed.presets);
    this.store();
    this.renderList();
    this.status.textContent = `Read ${this.presets.length - before} new presets.`;
    if (parsed.warnings.length > 0) this.handlers.onMessage(["Some presets were skipped:", ...parsed.warnings].join("\n"));
  }

  private readStored(): Preset[] {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      if (!text) return [];
      const parsed = parsePresets(text);
      return parsed.ok ? parsed.presets : [];
    } catch {
      return [];
    }
  }

  private store(): void {
    try {
      localStorage.setItem(STORAGE_KEY, presetsToJson(this.presets));
    } catch {
      this.handlers.onMessage("The presets could not be saved in the browser (the storage is full or turned off). Use Save to file.");
    }
  }
}
