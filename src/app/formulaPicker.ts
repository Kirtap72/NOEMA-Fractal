import type { Formula } from "../engine";
import type { Fit } from "../engine/formulaFit";
import { displayCreditName, formulaCatalog } from "../engine";
import { CATEGORY_LABELS, pickerGroups, searchFormulas } from "./formulaSearch";
import type { PickerFilter } from "./formulaSearch";
import { FormulaPreferences } from "./formulaPreferences";
import { hasPreview, previewInfo, previewUrl } from "./formulaPreviews";

/** What the picker needs to know about the place the formula would go (see engine/formulaFit.ts). */
export interface PickerPlace {
  /** The renderer's verdict for one formula at this place. Cheap: no shader is built. */
  fit(formula: Formula): Fit;
  /** One Swedish line saying where the formula goes, for example "Steg 3 av 3 · läge: följd". */
  where: string;
}

/** Native modal supplies focus trapping and Escape; formula text is never HTML. */
export class FormulaPicker {
  readonly dialog = document.createElement("dialog");
  private search = document.createElement("input");
  private results = document.createElement("div");
  private count = document.createElement("div");
  private heading = document.createElement("h2");
  private onlyFavorites = document.createElement("input");
  private showAll = document.createElement("input");
  private place = document.createElement("div");
  /** The verdicts for the place the picker was opened for; null when it was opened without a place (everything is shown). */
  private fits: Map<string, Fit> | null = null;
  private filter: PickerFilter = "all";
  private filterButtons: HTMLButtonElement[] = [];
  private pick: ((formula: Formula) => void) | null = null;
  private opener: HTMLElement | null = null;
  private unsubscribe: () => void;
  /** Loads a row's preview picture only when the row scrolls into view; created on first use, never renders or compiles anything. */
  private seen: IntersectionObserver | null = null;
  constructor(
    private formulas: readonly Formula[],
    private preferences: FormulaPreferences,
  ) {
    this.dialog.className = "formula-picker";
    this.dialog.setAttribute("aria-labelledby", "formula-picker-title");
    this.heading.id = "formula-picker-title";
    const head = document.createElement("div");
    head.className = "picker-header";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close the formula picker");
    close.addEventListener("click", () => this.dialog.close());
    head.append(this.heading, close);
    this.search.type = "search";
    this.search.placeholder = "Search name, tag, author, 3D/4D…";
    this.search.setAttribute("aria-label", "Search formulas");
    this.search.addEventListener("input", () => this.render());
    const filters = document.createElement("div");
    filters.className = "picker-filters";
    filters.setAttribute("aria-label", "Filter formulas");
    for (const [key, label] of [
      ["all", "All"],
      ["fractals", "Fractals"],
      ["ifs", "IFS"],
      ["4d", "4D"],
      ["transforms", "Transformer"],
      ["difs", "dIFS"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.filter = key;
      button.addEventListener("click", () => {
        this.filter = key;
        this.render();
      });
      filters.append(button);
      this.filterButtons.push(button);
    }
    const favorites = document.createElement("label");
    this.onlyFavorites.type = "checkbox";
    this.onlyFavorites.addEventListener("change", () => this.render());
    favorites.append(this.onlyFavorites, " Only favourites");
    filters.append(favorites);
    const all = document.createElement("label");
    all.className = "picker-show-all";
    this.showAll.type = "checkbox";
    this.showAll.addEventListener("change", () => this.render());
    all.append(this.showAll, " Show all formulas, even those that do not fit here");
    filters.append(all);
    this.place.className = "picker-place";
    this.results.className = "picker-results";
    this.count.className = "picker-count";
    this.count.setAttribute("role", "status");
    this.dialog.append(head, this.place, this.search, filters, this.count, this.results);
    document.body.append(this.dialog);
    this.dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.dialog.close();
      }
    });
    this.dialog.addEventListener("close", () => {
      this.pick = null;
      if (this.opener?.isConnected) this.opener.focus();
    });
    this.search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.results
          .querySelector<HTMLButtonElement>(".formula-choice")
          ?.focus();
      }
    });
    this.results.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
      const choices = Array.from(
        this.results.querySelectorAll<HTMLButtonElement>(".formula-choice"),
      );
      const index = choices.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (index < 0) return;
      e.preventDefault();
      const next = index + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0) this.search.focus();
      else choices[Math.min(next, choices.length - 1)]?.focus();
    });
    this.unsubscribe = preferences.subscribe(() => {
      if (this.dialog.open) this.render();
    });
  }
  open(
    onPick: (formula: Formula) => void,
    opener: HTMLElement,
    replace = false,
    place?: PickerPlace,
  ) {
    this.pick = onPick;
    // The verdicts are asked once, here, for the whole library: they depend on the chain, the position and the mode, none of which change while the dialog is open.
    this.fits = place ? new Map(this.formulas.map((f) => [f.id, place.fit(f)])) : null;
    this.place.textContent = place ? place.where : "";
    this.place.hidden = !place;
    this.dialog.classList.toggle("has-place", !!place);
    this.showAll.checked = false;
    this.showAll.closest("label")!.hidden = !place;
    this.opener = opener;
    this.heading.textContent = replace ? "Change formula" : "Add formula";
    this.filter = "all";
    this.search.value = "";
    this.onlyFavorites.checked = false;
    this.render();
    this.dialog.showModal();
    this.search.focus();
  }
  private render() {
    const focused =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement.dataset.favoriteKey
        : undefined;
    this.results.replaceChildren();
    const found = searchFormulas(
      this.formulas,
      this.search.value,
      this.filter,
      this.onlyFavorites.checked,
      this.preferences,
    );
    // By default only formulas that fit the place are listed; "show all" adds the others, greyed out with the reason.
    const fits = this.fits;
    const fitsHere = (f: Formula): boolean => !fits || fits.get(f.id)?.ok !== false;
    const hidden = fits && !this.showAll.checked ? found.filter((f) => !fitsHere(f)).length : 0;
    const matches = hidden ? found.filter(fitsHere) : found;
    const misfits = fits && this.showAll.checked ? found.filter((f) => !fitsHere(f)).length : 0;
    this.count.textContent = matches.length
      ? `${matches.length} formulas${fits ? (hidden ? ` fit here · ${hidden} hidden (tick "Show all" to see why)` : misfits ? `, of which ${misfits} do not fit here` : " fit here") : ""}`
      : hidden
        ? `No matches that fit here (${hidden} hidden). Tick "Show all formulas" to see them and why they do not fit.`
        : "No matches. Try another search word or filter.";
    for (const button of this.filterButtons)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.filter === this.filter),
      );
    for (const group of pickerGroups(matches, this.preferences)) {
      const section = document.createElement("section");
      section.setAttribute("aria-label", group.label);
      const title = document.createElement("h3");
      title.textContent = group.label;
      section.append(title);
      for (const formula of group.formulas) {
        const row = document.createElement("div");
        row.className = "picker-formula";
        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = "formula-choice";
        choose.dataset.formulaId = formula.id;
        choose.title = formula.name;
        choose.setAttribute("aria-label", `Choose ${formula.name}`);
        const name = document.createElement("span");
        name.className = "formula-name";
        name.textContent = formula.name;
        const meta = document.createElement("span");
        meta.className = "formula-meta";
        const catalog = formulaCatalog(formula);
        meta.textContent = `${CATEGORY_LABELS[catalog.category]} · ${catalog.dimension}D · ${formula.credits.map((c) => displayCreditName(c.name)).join(", ")}`;
        const text = document.createElement("span");
        text.className = "formula-text";
        text.append(name, meta);
        const thumb = this.makeThumb(formula.id);
        choose.append(thumb, text);
        const verdict = fits?.get(formula.id);
        if (verdict && !verdict.ok) {
          // Not selectable: the reason is part of the row, and the click does nothing but keep the dialog open.
          row.classList.add("picker-incompatible");
          choose.setAttribute("aria-disabled", "true");
          choose.dataset.incompatible = "";
          const why = document.createElement("span");
          why.className = "formula-reason";
          why.textContent = "Does not fit here: " + (verdict.reason ?? "");
          text.append(why);
          choose.title = verdict.reason ?? formula.name;
          choose.addEventListener("click", () => this.search.focus());
          row.append(choose);
          section.append(row);
          continue;
        }
        choose.addEventListener("click", () => {
          const callback = this.pick;
          this.dialog.close();
          this.preferences.use(formula.id);
          callback?.(formula);
        });
        const star = document.createElement("button");
        star.type = "button";
        star.className = "favorite-toggle";
        star.dataset.favoriteKey = group.key + ":" + formula.id;
        star.textContent = this.preferences.isFavorite(formula.id) ? "★" : "☆";
        star.setAttribute(
          "aria-pressed",
          String(this.preferences.isFavorite(formula.id)),
        );
        star.setAttribute("aria-label", `Favourite: ${formula.name}`);
        star.title = "Add or remove favourite";
        star.addEventListener("click", () =>
          this.preferences.toggleFavorite(formula.id),
        );
        row.append(choose, star);
        section.append(row);
      }
      this.results.append(section);
    }
    if (focused) {
      const buttons = Array.from(
        this.results.querySelectorAll<HTMLButtonElement>("[data-favorite-key]"),
      );
      (
        buttons.find((b) => b.dataset.favoriteKey === focused) ??
        buttons.find((b) =>
          b.dataset.favoriteKey?.endsWith(
            ":" + focused.split(":").slice(1).join(":"),
          ),
        )
      )?.focus();
    }
  }
  /** A 56 px square that stays empty until it is visible; formulas without a picture get a quiet placeholder of the same size. */
  private makeThumb(id: string): HTMLElement {
    const frame = document.createElement("span");
    frame.className = "formula-preview";
    frame.setAttribute("aria-hidden", "true");
    if (!hasPreview(id)) {
      frame.classList.add("formula-preview-none");
      return frame;
    }
    const info = previewInfo(id);
    if (info?.host) {
      frame.title = `Preview: shown behind default values ${info.hostName ?? info.host}`;
      const tag = document.createElement("span");
      tag.className = "formula-preview-host";
      tag.textContent = "on " + (info.hostName ?? info.host);
      frame.append(tag);
    }
    frame.dataset.previewId = id;
    if (typeof IntersectionObserver === "undefined") {
      void this.fill(frame);
      return frame;
    }
    this.seen ??= new IntersectionObserver(
      (items) => {
        for (const item of items) {
          if (!item.isIntersecting) continue;
          this.seen?.unobserve(item.target);
          void this.fill(item.target as HTMLElement);
        }
      },
      { root: this.results, rootMargin: "120px" },
    );
    this.seen.observe(frame);
    return frame;
  }
  private async fill(frame: HTMLElement) {
    const id = frame.dataset.previewId;
    const url = id ? await previewUrl(id) : undefined;
    if (!url || !frame.isConnected) return;
    const img = document.createElement("img");
    img.width = 56;
    img.height = 56;
    img.alt = "";
    img.decoding = "async";
    img.src = url;
    frame.prepend(img);
  }
  dispose() {
    this.seen?.disconnect();
    this.unsubscribe();
    this.dialog.remove();
  }
}
