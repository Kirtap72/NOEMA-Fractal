import { SETTING_GROUPS, groupOfPanel, rankSettings } from "./settingsSearch";
import type { SettingEntry } from "./settingsSearch";
import { SettingsCollapse } from "./settingsCollapse";

/** One control the artist can jump to. `element` is the real control: there is never a second copy. */
export interface FoundSetting extends SettingEntry {
  element: HTMLElement;
  /** Open section(s) the control sits in, for the result line. */
  section: string;
}

interface Root {
  root: HTMLElement;
  /** Fixed category for controls outside the sidebar (e.g. the preview buttons above the image). */
  group?: string;
}

const CONTROLS = "input, select, textarea, button, summary";

/**
 * "Search settings" and category jump buttons at the top of the settings sidebar (ARTIST-UX-02, phase A).
 *
 * It only reads the existing controls and moves focus: choosing a result opens the sections around the real control,
 * scrolls it into view and focuses it. It never dispatches input/change events, so no scene value can change by searching.
 */
export class SettingsNavigator {
  readonly element = document.createElement("section");
  private readonly search = document.createElement("input");
  private readonly list = document.createElement("div");
  private readonly status = document.createElement("div");
  private results: FoundSetting[] = [];
  private active = -1;
  private highlight?: { element: HTMLElement; timer: number };
  /** Collapsible categories (ARTIST-UI-FIX-01). */
  readonly collapse: SettingsCollapse;
  /** Called before a result or category chip reveals a control, so a simplified view can open the part of the workspace that holds it. */
  onReveal?: () => void;

  constructor(
    private readonly controls: HTMLElement,
    private readonly panelToggle: HTMLButtonElement,
    private readonly extraRoots: readonly Root[] = [],
  ) {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; }
    this.collapse = new SettingsCollapse(controls, storage);
    this.groupPanels();
    this.element.id = "settings-nav";
    this.element.setAttribute("role", "search");
    this.element.setAttribute("aria-label", "Search settings");

    this.search.type = "search";
    this.search.id = "settings-search";
    this.search.autocomplete = "off";
    this.search.placeholder = "Search settings… (Ctrl+K)";
    this.search.setAttribute("aria-label", "Search settings");
    this.search.setAttribute("role", "combobox");
    this.search.setAttribute("aria-expanded", "false");
    this.search.setAttribute("aria-controls", "settings-results");
    this.search.setAttribute("aria-autocomplete", "list");
    this.search.title = "Type a word, e.g. roughness, texture size, fog, DOF or LookDev, and choose a hit. Ctrl+K jumps here.";

    this.list.id = "settings-results";
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", "Hits");
    this.list.hidden = true;
    this.status.setAttribute("role", "status");
    this.status.className = "settings-status";

    const chips = document.createElement("div");
    chips.className = "settings-chips";
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Jump to category");
    for (const group of SETTING_GROUPS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = group.label;
      chip.dataset.group = group.id;
      chip.title = `Jump to ${group.label}`;
      chip.onclick = () => this.jumpToGroup(group.id);
      chips.append(chip);
    }
    const all = document.createElement("div");
    all.className = "settings-all";
    all.setAttribute("role", "group");
    all.setAttribute("aria-label", "Open and close all categories");
    const allButton = (text: string, title: string, click: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = text; b.title = title; b.dataset.settingsChrome = ""; b.onclick = click;
      return b;
    };
    all.append(
      allButton("Open all categories", "Show the content of all categories", () => this.collapse.setAllCategories(true)),
      allButton("Collapse all categories", "Show only the category headings: a short overview", () => this.collapse.setAllCategories(false)),
      allButton("Open all parts", "Open all parts and sections in all categories", () => this.collapse.setParts(null, true)),
      allButton("Close all parts", "Close all parts and sections (the categories stay as they are)", () => this.collapse.setParts(null, false)),
    );
    this.element.append(this.search, this.list, this.status, chips, all);
    this.controls.prepend(this.element);

    this.search.addEventListener("input", () => this.query());
    this.search.addEventListener("focus", () => this.query());
    this.search.addEventListener("keydown", (e) => this.key(e));
    this.search.addEventListener("blur", () => window.setTimeout(() => this.closeIfIdle(), 150));
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.focusSearch();
      }
    });
  }

  focusSearch(): void {
    if (this.controlsHidden()) this.panelToggle.click();
    this.search.focus();
    this.search.select();
  }

  /** Test and automation access: the best matches for a query, without touching the page. */
  find(query: string, limit = 12): FoundSetting[] {
    return rankSettings(this.index(), query, limit).map((r) => r.entry);
  }

  /** Open the real control behind a result. */
  reveal(found: FoundSetting): void {
    this.onReveal?.();
    if (this.controlsHidden()) this.panelToggle.click();
    // Opens the category and the part (both may have been collapsed by the artist) and every section around the control.
    this.collapse.reveal(found.element);
    found.element.scrollIntoView({ block: "center", inline: "nearest" });
    if (typeof found.element.focus === "function") found.element.focus({ preventScroll: true });
    this.flash(found.element);
  }

  private controlsHidden(): boolean {
    return !!this.controls.hidden || getComputedStyle(this.controls).display === "none";
  }

  /** Put the panels under their category headings. Only moves existing nodes; ids, listeners and state stay. */
  private groupPanels(): void {
    const hostOf = (id: string): HTMLElement | null => {
      const el = document.getElementById(id);
      if (!el) return null;
      let host: HTMLElement = el;
      while (host.parentElement && host.parentElement !== this.controls) host = host.parentElement;
      return host.parentElement === this.controls ? host : null;
    };
    const used = new Set<HTMLElement>();
    const groups: { id: string; label: string; hosts: HTMLElement[] }[] = [];
    for (const group of SETTING_GROUPS) {
      // Several panels can live inside one host (details and format sit inside the still-image panel): list that host once, not once per panel.
      const hosts = [...new Set(group.panels.map(hostOf))].filter((h): h is HTMLElement => !!h && !used.has(h));
      if (!hosts.length) continue;
      for (const host of hosts) used.add(host);
      groups.push({ id: group.id, label: group.label, hosts });
    }
    const fragment = this.collapse.build(groups);
    // Anything not named above (save/open buttons, credits button) stays after the groups, in its old order.
    this.controls.prepend(fragment);
  }

  private jumpToGroup(id: string): void {
    this.onReveal?.();
    const heading = document.getElementById(`settings-group-${id}`);
    if (!heading) return;
    this.collapse.setCategory(id, true);
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
    this.flash(heading);
  }

  private flash(el: HTMLElement): void {
    if (this.highlight) {
      window.clearTimeout(this.highlight.timer);
      this.highlight.element.classList.remove("settings-found");
    }
    el.classList.add("settings-found");
    this.highlight = { element: el, timer: window.setTimeout(() => el.classList.remove("settings-found"), 2500) };
  }

  private query(): void {
    const text = this.search.value;
    this.results = text.trim() ? this.find(text) : [];
    this.active = this.results.length ? 0 : -1;
    this.list.replaceChildren();
    this.list.hidden = !text.trim();
    this.search.setAttribute("aria-expanded", String(!!text.trim()));
    if (!text.trim()) {
      this.status.textContent = "";
      return;
    }
    this.status.textContent = this.results.length ? `${this.results.length} hits` : "No hits. Try another word.";
    this.results.forEach((r, i) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `settings-result-${i}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(i === this.active));
      const name = document.createElement("span");
      name.textContent = r.label;
      const where = document.createElement("small");
      where.textContent = r.section ? `${r.group} › ${r.section}` : r.group;
      option.append(name, where);
      option.onmousedown = (e) => e.preventDefault(); // keep focus in the search box until the click lands
      option.onclick = () => this.choose(i);
      this.list.append(option);
    });
    this.markActive();
  }

  private markActive(): void {
    [...this.list.children].forEach((c, i) => c.setAttribute("aria-selected", String(i === this.active)));
    if (this.active >= 0) this.search.setAttribute("aria-activedescendant", `settings-result-${this.active}`);
    else this.search.removeAttribute("aria-activedescendant");
  }

  private key(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!this.results.length) return;
      e.preventDefault();
      this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + this.results.length) % this.results.length;
      this.markActive();
    } else if (e.key === "Enter") {
      if (this.active >= 0) {
        e.preventDefault();
        this.choose(this.active);
      }
    } else if (e.key === "Escape") {
      this.search.value = "";
      this.query();
    }
  }

  private choose(i: number): void {
    const found = this.results[i];
    if (!found) return;
    this.search.value = "";
    this.query();
    this.reveal(found);
  }

  private closeIfIdle(): void {
    if (document.activeElement !== this.search) this.list.hidden = true;
  }

  /** Collect the real controls. Rebuilt for every query, so sections that appear later are found too. */
  private index(): FoundSetting[] {
    const out: FoundSetting[] = [];
    const seen = new Set<string>();
    const roots: Root[] = [{ root: this.controls }, ...this.extraRoots];
    for (const { root, group: fixed } of roots) {
      for (const el of root.querySelectorAll<HTMLElement>(CONTROLS)) {
        if (this.element.contains(el) || el.hasAttribute("data-settings-chrome")) continue;
        // The AI studio is its own tab with its own chat; it is not a scene setting. Extra roots are listed once, under their own group.
        if (el.closest("#ai-dock")) continue;
        if (!fixed && this.extraRoots.some((r) => r.root.contains(el))) continue;
        if (el instanceof HTMLInputElement && el.type === "hidden") continue;
        if (el.closest("[hidden]") && el.tagName !== "SUMMARY") continue;
        if (el.classList.contains("exact-number")) continue; // the generated number twin of a slider: the slider itself is listed
        const label = labelOf(el);
        if (!label) continue;
        const panelHost = panelIdOf(el, this.controls);
        const group = fixed ?? (el.closest("#shell-view") ? "View & appearance" : groupOfPanel(panelHost));
        const section = sectionOf(el, root);
        const key = `${group}|${section}|${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const keywords = [el.title, section, el.getAttribute("aria-description") ?? ""].join(" ");
        out.push({ label, group, keywords, element: el, section });
      }
    }
    return out;
  }
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** The text the artist reads next to a control. */
function labelOf(el: HTMLElement): string {
  const aria = clean(el.getAttribute("aria-label"));
  if (el instanceof HTMLButtonElement || el.tagName === "SUMMARY") return clean(el.textContent) || aria;
  const label = el.closest("label") ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
  if (label) {
    const copy = label.cloneNode(true) as HTMLElement;
    // Controls, their option texts and the live value readout (.value) are not part of the name.
    copy.querySelectorAll("select, input, option, button, output, textarea, .value").forEach((n) => n.remove());
    const words: string[] = [];
    const walk = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) words.push(n.textContent ?? "");
    const text = clean(words.join(" "));
    if (text) return text;
  }
  const row = el.parentElement?.querySelector(":scope > span, :scope > legend");
  const rowText = clean(row?.textContent);
  if (rowText && rowText.length < 60 && !row?.contains(el)) return rowText;
  const legend = el.closest("fieldset")?.querySelector(":scope > legend");
  if (legend) return `${clean(legend.textContent)} · ${aria || ""}`.replace(/ · $/, "");
  return aria || clean(el.title);
}

/** Name of the nearest section around a control (a `<details>` summary or the panel heading). */
function sectionOf(el: HTMLElement, root: HTMLElement): string {
  for (let n = el.parentElement; n && n !== root.parentElement; n = n.parentElement) {
    if (n instanceof HTMLDetailsElement) {
      const summary = n.querySelector(":scope > summary");
      if (summary && !summary.contains(el)) return clean(summary.textContent);
    }
  }
  return "";
}

function panelIdOf(el: HTMLElement, controls: HTMLElement): string {
  let n: HTMLElement | null = el;
  while (n && n !== controls) {
    if (n.id && n.classList.contains("panel")) return n.id;
    n = n.parentElement;
  }
  return "";
}
