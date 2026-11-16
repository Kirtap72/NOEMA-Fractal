import { MACROS, applyMacro } from "../engine/artistMacros";
import type { MacroId } from "../engine/artistMacros";
import { LIGHTING_PRESETS, applyLightingPreset } from "../engine/lights";
import { LIGHT_RIGS, applyRig } from "../engine/lightRigs";
import { MATERIAL_PRESETS } from "../engine/material";
import { lookDevRequest } from "../engine/lookDev";
import { withColor } from "../engine";
import type { Formula, Gradient, ImageBuffer, Scene } from "../engine";
import type { RenderOptions } from "../engine/engine";
import { gradientCssOf } from "./gradientEditing";
import type { SettingsNavigator } from "./settingsNavigator";
import { ChromeAppearance } from "./appearance";
import "./artistShell.css";

/** What the shell needs from the application. Every edit goes through `commit`: the same scene, the same one-step Undo as the advanced panels. */
export interface ShellHost {
  scene(): Scene;
  formulas(): readonly Formula[];
  gradients(): readonly Gradient[];
  busy(): boolean;
  /** Replaces the live scene with `next` as ONE undoable edit and refreshes every panel. */
  commit(next: Scene): void;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  capture(): { scene: Scene; film: { width: number; height: number } };
  render(scene: Scene, size: { width: number; height: number }, options: RenderOptions): Promise<ImageBuffer>;
  message(text: string): void;
  openVariations(): void;
  /** The curated starter scene, built from the library (never applied by itself). */
  starter(): Scene | null;
  /** The block at the top of the Render tab (quality level, Rendera stillbild, Progressiv rendering, Stoppa), when the application has one. */
  renderBar?(): HTMLElement;
}

export type TabId = "create" | "form" | "material" | "light" | "camera" | "view" | "render" | "ai";
export const SHELL_TABS: readonly { id: TabId; label: string; hint: string; groups: readonly string[] }[] = [
  { id: "create", label: "Start", hint: "Quick changes and presets", groups: [] },
  { id: "form", label: "Shape", hint: "Formulas, chain and geometry", groups: ["fractal"] },
  { id: "material", label: "Material", hint: "Colours and surface materials", groups: ["material"] },
  { id: "light", label: "Light", hint: "Light, fog and environment", groups: ["light", "atmosphere"] },
  { id: "camera", label: "Camera", hint: "Camera, focus and motion", groups: ["camera"] },
  { id: "view", label: "View", hint: "Preview, quality, compare lights, focus mode, diagnostics and appearance", groups: [] },
  { id: "render", label: "Render", hint: "Still picture, animation and export", groups: ["preview", "animation", "library"] },
  { id: "ai", label: "AI Studio", hint: "Create with AI: describe an idea and approve suggestions", groups: [] },
];


type PresetKind = "light" | "material" | "color";
/** The longest a single preset picture may take before its card says "No preview picture". */
const THUMBNAIL_MS = 90_000;
const swatchCss = (swatch: string): string => (swatch.startsWith("linear") ? swatch : `linear-gradient(90deg, ${swatch})`);
interface PresetItem { id: string; label: string; apply: (s: Scene) => Scene | null; swatch?: string }

const MATERIAL_LABELS: readonly [string, string][] = [
  ["Matte", "Matt"], ["Polished Metal", "Polished metal"], ["Rough Metal", "Rough metal"], ["Clear Glass", "Klart glas"], ["Polished Gold", "Polerat guld"],
  ["Brushed Gold", "Borstat guld"], ["Hammered Copper", "Hamrad koppar"], ["Weathered Bronze", "Vittrad brons"], ["Rough Stone", "Grov sten"], ["Fine Ceramic", "Fin keramik"],
];

const LIGHTING_LABELS: Record<string, string> = {
  "orbit100-candidate-a": "Strong raking light", "orbit100-candidate-b": "Warm copper, cool contrast", "orbit100-candidate-c": "Soft filmic studio",
};

const store = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e;
};

/**
 * The artist-first shell (ARTIST-UX-REDESIGN-01): a top bar with Create / Form / Material / Light / Camera / Render, a simplified
 * workspace that shows one task at a time, and a Create tab with creative macros and visual presets.
 *
 * It owns no scene data and no second control set. The tabs only choose WHICH of the existing panels are visible; "Avancerat"
 * shows all of them again in one long list. Macros and presets are ordinary scene edits through `host.commit`.
 */
export class ArtistShell {
  readonly bar = el("header");
  private readonly create = el("div");
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private readonly undoButton = el("button", "shell-icon", "Undo");
  private readonly redoButton = el("button", "shell-icon", "Redo");
  private readonly advanced = el("button", "shell-mode");
  private tab: TabId = "create";
  private advancedOn = false;
  private lastMacro?: { id: MacroId; scene: Scene };
  private readonly macroCards = new Map<MacroId, { card: HTMLElement; feedback: HTMLElement; undo: HTMLButtonElement }>();
  private presetKind: PresetKind = "light";
  private readonly presetTabs = new Map<PresetKind, HTMLButtonElement>();
  private readonly presetGrid = el("div", "preset-grid");
  private readonly presetStatus = el("p", "shell-note");
  private readonly presetRefresh = el("button", "shell-link", "Refresh preview pictures");
  /** `urls`: finished pictures. `failed`: cards whose picture could not be made (they say so). `busy`: pictures are being made right now. */
  private readonly thumbs = new Map<PresetKind, { key: string; urls: Map<string, string>; failed: Set<string>; busy: boolean }>();
  private seenScene?: Scene;
  private stableTicks = 0;
  private abort?: AbortController;
  private lastPresetApplied?: { id: string; scene: Scene };
  private welcome = el("section", "shell-welcome");
  private readonly view = el("div");
  private readonly appearance: ChromeAppearance;
  private aiDock?: HTMLElement;
  private renderBar?: HTMLElement;

  constructor(private readonly host: ShellHost, private readonly controls: HTMLElement, private readonly nav: SettingsNavigator, panelToggle: HTMLButtonElement) {
    document.body.classList.add("artist-shell");
    const s = store();
    this.appearance = new ChromeAppearance(this.bar, controls);
    this.tab = (SHELL_TABS.find((t) => t.id === s?.getItem("noema.shell.tab"))?.id as TabId | undefined) ?? "create";
    this.advancedOn = s?.getItem("noema.shell.advanced") === "1";
    this.buildBar(panelToggle);
    this.buildCreate();
    this.buildView();
    this.renderBar = host.renderBar?.();
    const searchBox = controls.querySelector("#settings-nav");
    const own = [this.create, this.view, ...(this.renderBar ? [this.renderBar] : [])];
    if (searchBox) searchBox.after(...own); else controls.prepend(...own);
    this.adoptAi();
    // First run: start the part bars closed so each tab is a tidy list; the artist opens what is needed (and the state is remembered by the existing panels).
    if (!s?.getItem("noema.shell.tidied")) { nav.collapse.setParts(null, false);
      for (const section of controls.querySelectorAll<HTMLElement>(":scope > section.settings-category")) {
        const first = section.querySelector<HTMLElement>(".settings-group-body > [data-part]")?.dataset.part;
        if (first) nav.collapse.setPart(first, true);
      }
      // A fresh profile starts with the long preview settings folded away, so the artwork is what you see first.
      const previewToggle = document.getElementById("preview-controls-toggle");
      if (previewToggle && /Hide/.test(previewToggle.textContent ?? "")) previewToggle.click();
      s?.setItem("noema.shell.tidied", "1"); }
    nav.onReveal = () => { if (!this.advancedOn) this.setAdvanced(true, true); };
    this.apply(false);
    window.setInterval(() => this.observe(), 400);
    this.showWelcome();
    window.addEventListener("keydown", (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-8]$/.test(e.key)) { e.preventDefault(); this.select(SHELL_TABS[Number(e.key) - 1]!.id); }
    });
  }

  // ---- bar ------------------------------------------------------------------------------------------------------
  private buildBar(panelToggle: HTMLButtonElement): void {
    this.bar.id = "artist-bar";
    const brand = el("div", "shell-brand");
    brand.append(el("span", "shell-logo", "◈"), el("span", "shell-name", "NOEMA Fractal"));
    brand.title = document.getElementById("hint")?.textContent ?? "";
    const nav = el("nav", "shell-tabs"); nav.setAttribute("aria-label", "Workspaces");
    const list = el("div"); list.setAttribute("role", "tablist");
    for (const [i, t] of SHELL_TABS.entries()) {
      const b = el("button", "shell-tab", t.label); b.type = "button"; b.id = `shell-tab-${t.id}`;
      b.setAttribute("role", "tab"); b.title = `${t.hint} (Alt+${i + 1})`;
      b.onclick = () => this.select(t.id);
      this.tabButtons.set(t.id, b); list.append(b);
    }
    nav.append(list);
    this.undoButton.type = this.redoButton.type = this.advanced.type = "button";
    this.undoButton.title = "Undo the last change"; this.redoButton.title = "Redo";
    this.undoButton.onclick = () => this.host.undo(); this.redoButton.onclick = () => this.host.redo();
    this.advanced.setAttribute("aria-pressed", "false");
    this.advanced.title = "Show all settings in one long list. Everything you changed is kept; they are the same settings.";
    this.advanced.onclick = () => this.setAdvanced(!this.advancedOn);
    this.bar.append(panelToggle, brand, nav, el("div", "shell-spacer"), this.undoButton, this.redoButton, this.advanced);
    document.body.prepend(this.bar);
  }

  private select(tab: TabId): void {
    this.tab = tab; store()?.setItem("noema.shell.tab", tab);
    this.apply(true);
    const panelToggle = this.bar.querySelector<HTMLButtonElement>("#panel-toggle");
    if (panelToggle && this.controls.hidden) panelToggle.click();
  }

  private setAdvanced(on: boolean, keepTab = false): void {
    this.advancedOn = on; store()?.setItem("noema.shell.advanced", on ? "1" : "0");
    this.apply(!keepTab);
  }

  /** Shows the panels of the current tab (or all of them in advanced mode). Visibility only: no value is read or written. */
  private apply(scroll: boolean): void {
    const tab = SHELL_TABS.find((t) => t.id === this.tab)!;
    document.body.dataset.shellTab = this.tab;
    document.body.classList.toggle("shell-advanced", this.advancedOn);
    for (const [id, b] of this.tabButtons) { b.setAttribute("aria-selected", String(id === this.tab)); b.classList.toggle("on", id === this.tab); b.tabIndex = id === this.tab ? 0 : -1; }
    this.advanced.setAttribute("aria-pressed", String(this.advancedOn));
    this.advanced.textContent = this.advancedOn ? "Simple view" : "Advanced";
    this.create.hidden = !(this.advancedOn || this.tab === "create");
    this.view.hidden = !(this.advancedOn || this.tab === "view");
    if (this.renderBar) this.renderBar.hidden = !(this.advancedOn || this.tab === "render");
    if (this.aiDock) this.aiDock.hidden = !(this.advancedOn || this.tab === "ai");
    document.body.dataset.shellTab = this.tab;
    for (const section of this.controls.querySelectorAll<HTMLElement>(":scope > section.settings-category")) {
      const group = section.dataset.group ?? "";
      const show = this.advancedOn || tab.groups.includes(group);
      section.hidden = !show;
      if (show && !this.advancedOn) this.nav.collapse.setCategory(group, true);
    }
    for (const child of this.controls.querySelectorAll<HTMLElement>(":scope > :not(section.settings-category):not(#settings-nav):not(#artist-create):not(#shell-view):not(#ai-dock):not(#render-bar)")) {
      child.hidden = !(this.advancedOn || this.tab === "create" || this.tab === "render");
    }
    const nav = this.controls.querySelector<HTMLElement>("#settings-nav"); if (nav) { nav.classList.toggle("shell-nav-simple", !this.advancedOn); nav.hidden = !this.advancedOn && this.tab === "ai"; }
    this.tidyHeadings();
    if (scroll) {
      this.controls.scrollTop = 0;
      if (this.advancedOn && tab.groups[0]) document.getElementById(`settings-group-${tab.groups[0]}`)?.scrollIntoView({ block: "start" });
    }
    if (this.tab === "create" && !this.create.hidden) this.ensureThumbnails();
  }

  // ---- view tab (everything that used to float over the picture) ---------------------------------------------------
  /** Moves the preview toolbar, the status labels and the diagnostics into the sidebar, so the viewport carries nothing but the artwork. */
  private buildView(): void {
    this.view.id = "shell-view"; this.view.className = "panel shell-view";
    const byId = (id: string): HTMLElement | null => document.getElementById(id);
    const section = (title: string, ...nodes: (HTMLElement | null)[]): HTMLElement => {
      const s = el("section", "view-section"); s.append(el("h2", "shell-h", title));
      for (const n of nodes) if (n) s.append(n);
      return s;
    };
    const access = byId("preview-access");
    if (access) { access.hidden = false; try { window.localStorage.removeItem("noema.lookdev.focus"); } catch { /* a convenience only */ } }
    const status = el("div", "view-status"); status.setAttribute("aria-label", "Status");
    for (const id of ["fps", "camera-frame-label", "lookdev-status"]) { const n = byId(id); if (n) status.append(n); }
    this.view.append(section("Preview", access), section("Status", status), section("Diagnostics", byId("preview-diagnostics")), this.appearance.build());
    // Focus mode used to hide the floating box; there is no box now, so it hides the sidebar and leaves the artwork alone on screen.
    // One delegated capture listener on the document (the button may be rebuilt), which stops the old "hide the box" handler from also running.
    document.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target.closest("#lookdev-focus") : null;
      if (!target) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const toggle = this.bar.querySelector<HTMLButtonElement>("#panel-toggle"); if (toggle && !this.controls.hidden) toggle.click();
    }, true);
    const focus = byId("lookdev-focus"); if (focus) focus.title = "Hide the side panel so only the artwork shows. Click a tab to bring it back.";
  }

  /** The AI studio lives in the sidebar as its own tab. The same elements (chat history, model settings, previews, approval) are moved, never rebuilt, so switching tabs cannot interrupt a session. */
  private adoptAi(): void {
    if (this.aiDock) return;
    const dock = document.getElementById("ai-dock"); if (!dock) return;
    dock.querySelectorAll(".ai-dock-head, .ai-dock-grip").forEach((n) => n.remove());
    document.getElementById("ai-dock-toggle")?.remove();
    this.controls.append(dock); this.aiDock = dock;
    this.apply(false);
  }

  /** A part bar already names its panel: the panel's own first heading is hidden when it says the same thing. */
  private tidyHeadings(): void {
    const norm = (t: string | null | undefined): string => (t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    for (const bar of this.controls.querySelectorAll<HTMLElement>(".settings-part-bar button")) {
      const host = bar.closest(".settings-part-bar")?.nextElementSibling; if (!host) continue;
      const title = host.querySelector<HTMLElement>(":scope > .ctitle, :scope > strong, :scope > h3, :scope > h2, :scope > div > .ctitle, :scope > div > strong");
      if (title) title.classList.toggle("dup-title", norm(title.textContent).length > 0 && (norm(bar.textContent).includes(norm(title.textContent)) || norm(title.textContent).includes(norm(bar.textContent))));
    }
  }

  // ---- create tab -----------------------------------------------------------------------------------------------
  private buildCreate(): void {
    this.create.id = "artist-create"; this.create.className = "panel shell-create";
    this.welcome.hidden = true;
    const macros = el("section"); macros.append(el("h2", "shell-h", "Quick changes"), el("p", "shell-note", "Each button changes several real settings at once. Everything can be undone in one step and fine-tuned under its tab."));
    const grid = el("div", "macro-grid");
    for (const m of MACROS) {
      const card = el("article", "macro-card"); card.dataset.macro = m.id;
      const b = el("button", "macro-button"); b.type = "button"; b.id = `macro-${m.id}`;
      b.append(el("span", "macro-title", m.title), el("span", "macro-blurb", m.blurb)); b.title = m.help;
      const feedback = el("div", "macro-feedback"); feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite");
      const undo = el("button", "shell-link", "Undo"); undo.type = "button"; undo.hidden = true; undo.onclick = () => this.host.undo();
      b.onclick = () => this.runMacro(m.id);
      card.append(b, feedback, undo); grid.append(card); this.macroCards.set(m.id, { card, feedback, undo });
    }
    macros.append(grid);

    const presets = el("section"); presets.append(el("h2", "shell-h", "Presets"), el("p", "shell-note", "The preview pictures show your own fractal. Pick one as a starting point; you can adjust it further under Light, Material and Colour."));
    const seg = el("div", "preset-tabs"); seg.setAttribute("role", "tablist");
    for (const [kind, label] of [["light", "Light"], ["material", "Material"], ["color", "Colour"]] as const) {
      const b = el("button", "shell-seg", label); b.type = "button"; b.setAttribute("role", "tab"); b.id = `preset-tab-${kind}`;
      b.onclick = () => { this.presetKind = kind; this.paintPresetTabs(); this.paintPresets(); this.ensureThumbnails(); };
      this.presetTabs.set(kind, b); seg.append(b);
    }
    this.presetRefresh.type = "button"; this.presetRefresh.onclick = () => { this.thumbs.delete(this.presetKind); this.paintPresets(); this.ensureThumbnails(true); };
    this.presetStatus.setAttribute("role", "status");
    presets.append(seg, this.presetGrid, this.presetStatus, this.presetRefresh);
    this.create.append(this.welcome, macros, presets);
    this.paintPresetTabs(); this.paintPresets();
  }

  private runMacro(id: MacroId): void {
    const card = this.macroCards.get(id)!;
    const info = MACROS.find((m) => m.id === id)!;
    if (info.kind === "explore") { this.host.openVariations(); card.feedback.textContent = "The variation gallery is open. The scene does not change until you choose a variant."; return; }
    if (this.host.busy()) { card.feedback.textContent = "Wait until the running work is done and try again."; card.feedback.className = "macro-feedback limit"; return; }
    const result = applyMacro(this.host.scene(), id, this.host.formulas());
    for (const c of this.macroCards.values()) { c.card.classList.remove("applied"); if (c !== card) { c.feedback.textContent = ""; c.undo.hidden = true; } }
    card.feedback.replaceChildren();
    if (!result.ok) { card.feedback.className = "macro-feedback limit"; card.feedback.textContent = result.reason; card.undo.hidden = true; return; }
    this.host.commit(result.scene);
    this.lastMacro = { id, scene: this.host.scene() };
    card.card.classList.add("applied"); card.feedback.className = "macro-feedback done";
    const ul = el("ul"); for (const c of result.changes) ul.append(el("li", "", c));
    card.feedback.append(el("strong", "", `${info.title}: klart`), ul);
    if (result.limits.length) { const lim = el("ul", "macro-limits"); for (const l of result.limits) lim.append(el("li", "", l)); card.feedback.append(lim); }
    card.undo.hidden = false;
    this.flash();
  }

  /** A brief ring around the artwork: the change is seen, not only read. */
  private flash(): void {
    const ring = document.getElementById("shell-flash") ?? Object.assign(document.createElement("div"), { id: "shell-flash" });
    if (!ring.isConnected) document.body.append(ring);
    ring.classList.remove("go"); void ring.offsetWidth; ring.classList.add("go");
  }

  // ---- presets with real thumbnails ------------------------------------------------------------------------------
  private presets(kind: PresetKind): PresetItem[] {
    if (kind === "light") {
      return [
        ...LIGHT_RIGS.map((r): PresetItem => ({ id: `rig:${r.id}`, label: r.name, apply: (s) => { const a = applyRig(s, r.id, "replace-directional", { shadows: true }); return a.ok ? a.scene : null; } })),
        ...LIGHTING_PRESETS.map((p): PresetItem => ({ id: `light:${p.id}`, label: LIGHTING_LABELS[p.id] ?? p.name, apply: (s) => applyLightingPreset(s, p.id) })),
      ];
    }
    if (kind === "material") {
      return MATERIAL_LABELS.filter(([k]) => MATERIAL_PRESETS[k]).map(([k, label]): PresetItem => ({ id: `mat:${k}`, label, apply: (s) => ({ ...s, material: structuredClone(MATERIAL_PRESETS[k]!) }) }));
    }
    return this.host.gradients().map((g): PresetItem => ({ id: `grad:${g.id}`, label: g.name ?? g.id ?? "Colour", swatch: gradientCssOf(g), apply: (s) => withColor(s, { gradient: { id: g.id, name: g.name, stops: structuredClone(g.stops) } }) }));
  }

  private paintPresetTabs(): void { for (const [k, b] of this.presetTabs) { b.setAttribute("aria-selected", String(k === this.presetKind)); b.classList.toggle("on", k === this.presetKind); } }

  private paintPresets(): void {
    const cache = this.thumbs.get(this.presetKind);
    this.presetGrid.replaceChildren();
    for (const p of this.presets(this.presetKind)) {
      const b = el("button", "preset-card"); b.type = "button"; b.dataset.preset = p.id; b.setAttribute("aria-label", `Use ${p.label}`);
      const url = cache?.urls.get(p.id);
      const pic = el("span", "preset-pic");
      // One card for all three kinds: a picture of the artist's own fractal with the preset on it. While it is being made the card shows the colour
      // swatch (colour presets) or the shimmer; if it could not be made, it says so. Never an endless shimmer.
      if (url) { const img = el("img"); img.alt = ""; img.src = url; pic.append(img); pic.dataset.state = "image"; }
      else if (cache && !cache.busy || cache?.failed.has(p.id)) { pic.classList.add("missing"); pic.dataset.state = "missing"; pic.append(el("span", "preset-missing", "No preview picture")); if (p.swatch) pic.style.background = swatchCss(p.swatch); }
      else if (p.swatch) { pic.style.background = swatchCss(p.swatch); pic.dataset.state = "swatch"; }
      else { pic.classList.add("loading"); pic.dataset.state = "loading"; }
      b.append(pic);
      if (p.swatch) { const strip = el("span", "preset-strip"); strip.style.background = swatchCss(p.swatch); b.append(strip); }
      b.append(el("span", "preset-label", p.label));
      if (this.lastPresetApplied?.id === p.id && this.lastPresetApplied.scene === this.host.scene()) b.classList.add("on");
      b.onclick = () => this.applyPreset(p);
      this.presetGrid.append(b);
    }
    this.presetRefresh.hidden = !cache || cache.busy;
  }

  private applyPreset(p: PresetItem): void {
    if (this.host.busy()) { this.presetStatus.textContent = "Wait until the running work is done and try again."; return; }
    const next = p.apply(this.host.scene());
    if (!next) { this.presetStatus.textContent = `${p.label} could not be used on this scene.`; return; }
    this.host.commit(next);
    this.lastPresetApplied = { id: p.id, scene: this.host.scene() };
    this.presetStatus.textContent = `${p.label} is applied. Adjust it further under ${this.presetKind === "light" ? "Light" : this.presetKind === "material" ? "Material" : "Material › Colour"}, or undo in one step.`;
    this.flash(); this.paintPresets();
  }

  /** Renders each preset on the artist's own fractal as a small LookDev still; one at a time, abandoned when the scene changes. */
  private ensureThumbnails(force = false): void {
    const kind = this.presetKind;
    if (this.create.hidden || (this.thumbs.has(kind) && !force)) return;
    if (this.host.busy()) { this.presetStatus.textContent = "The preview pictures are made when the other work is done."; window.setTimeout(() => this.ensureThumbnails(), 2500); return; }
    this.abort?.abort();
    const abort = new AbortController(); this.abort = abort;
    void (async () => {
      let captured: { scene: Scene; film: { width: number; height: number } };
      const items = this.presets(kind);
      if (!items.length) return;
      const urls = new Map<string, string>(); const failed = new Set<string>();
      const entry = { key: this.fingerprint(kind, this.host.scene()), urls, failed, busy: true };
      const finish = (message: string): void => { entry.busy = false; this.thumbs.set(kind, entry); this.presetStatus.textContent = message; if (this.presetKind === kind) this.paintPresets(); };
      try { captured = this.host.capture(); } catch (e) { for (const p of items) failed.add(p.id); finish(`The preview pictures could not be made: ${String(e instanceof Error ? e.message : e)}`); return; }
      this.thumbs.set(kind, entry);
      // A run that is taken over (another tab, a changed scene) leaves nothing behind: the next visit makes the pictures again instead of showing half of them.
      const giveUp = (): void => { if (this.thumbs.get(kind) === entry) this.thumbs.delete(kind); if (this.presetKind === kind) this.paintPresets(); };
      const request = lookDevRequest(captured.scene, captured.film, { width: 256, samples: 1, geometry: "scene" });
      const scale = Math.min(1, 150 / request.size.height);
      const size = { width: Math.max(1, Math.round(request.size.width * scale)), height: Math.max(1, Math.round(request.size.height * scale)) };
      let lastError = "";
      for (const [i, p] of items.entries()) {
        if (abort.signal.aborted) { giveUp(); return; }
        this.presetStatus.textContent = `Making preview pictures of your fractal… ${i + 1}/${items.length}`;
        // One card never holds up the others for ever: a picture that takes longer than THUMBNAIL_MS is given up on (the card says so), and the next one is tried.
        const own = new AbortController();
        const stop = (): void => own.abort();
        abort.signal.addEventListener("abort", stop, { once: true });
        const timer = window.setTimeout(stop, THUMBNAIL_MS);
        try {
          const scene = p.apply(request.scene);
          if (!scene) { failed.add(p.id); continue; }
          const image = await this.host.render(scene, size, { ...request.options, referenceFilm: size, tilePixels: 4096, signal: own.signal });
          own.signal.throwIfAborted();
          const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
          c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
          urls.set(p.id, c.toDataURL("image/jpeg", 0.85));
        } catch (e) {
          if (abort.signal.aborted) { giveUp(); return; } // the scene changed or the artist left: a new run takes over
          failed.add(p.id); lastError = own.signal.aborted ? "took too long" : String(e instanceof Error ? e.message : e);
        } finally { window.clearTimeout(timer); abort.signal.removeEventListener("abort", stop); }
        if (this.presetKind === kind) this.paintPresets();
      }
      finish(failed.size
        ? `${items.length - failed.size} of ${items.length} preview pictures were made (${lastError || "some could not be made"}). Cards without a picture say so; the presets still work. Press Refresh preview pictures to try again.`
        : "The preview pictures show your fractal with each preset. The scene is unchanged until you choose.");
    })();
  }

  // ---- welcome / starter -----------------------------------------------------------------------------------------
  private showWelcome(): void {
    const s = store();
    if (!s || s.getItem("noema.shell.welcome") === "done") return;
    const starter = this.host.starter();
    this.welcome.hidden = false;
    this.welcome.replaceChildren(el("h2", "shell-h", "Welcome"), el("p", "", "Start with a ready-made fractal, or continue from the one that is already there. Your latest artwork is never replaced on its own."));
    const row = el("div", "shell-row");
    if (starter) {
      const use = el("button", "shell-primary", "Start with a ready-made fractal"); use.type = "button"; use.id = "starter-use";
      use.onclick = () => { this.host.commit(starter); s.setItem("noema.shell.welcome", "done"); this.welcome.hidden = true; this.flash(); this.host.message("The starter fractal is applied. Undo if you want to go back."); };
      row.append(use);
    }
    const keep = el("button", "shell-link", "Keep what I have"); keep.type = "button"; keep.id = "starter-keep";
    keep.onclick = () => { s.setItem("noema.shell.welcome", "done"); this.welcome.hidden = true; };
    row.append(keep); this.welcome.append(row);
  }

  /** What a kind of thumbnail depends on: everything except the part that kind replaces. Large strings (pictures) are reduced to a marker. */
  private fingerprint(kind: PresetKind, scene: Scene): string {
    const { formulaFields: _f, ...rest } = scene as Scene & Record<string, unknown>;
    const keep: Record<string, unknown> = { ...rest };
    if (kind === "light") { delete keep.lights; delete keep.ambient; } else if (kind === "material") delete keep.material; else delete keep.color;
    return JSON.stringify(keep, (_k, v) => (typeof v === "string" && v.length > 2000 ? `${v.length}:${v.slice(0, 40)}` : v));
  }

  /** Cheap periodic refresh of button states (Undo/Redo, the Undo link on the macro that was just used). */
  private observe(): void {
    if (!this.aiDock) this.adoptAi();
    this.undoButton.disabled = !this.host.canUndo(); this.redoButton.disabled = !this.host.canRedo();
    const scene = this.host.scene();
    if (this.lastMacro) {
      const card = this.macroCards.get(this.lastMacro.id)!;
      if (scene !== this.lastMacro.scene) { card.card.classList.remove("applied"); card.feedback.textContent = ""; card.undo.hidden = true; this.lastMacro = undefined; }
      else card.undo.disabled = !this.host.canUndo();
    }
    // Thumbnails show the artist's own fractal: when what they depend on has changed and stayed still for two ticks, make them again.
    this.stableTicks = scene === this.seenScene ? this.stableTicks + 1 : 0; this.seenScene = scene;
    const cache = this.thumbs.get(this.presetKind);
    if (cache && this.stableTicks >= 5 && !this.create.hidden && cache.key !== this.fingerprint(this.presetKind, scene)) { this.thumbs.delete(this.presetKind); this.paintPresets(); this.ensureThumbnails(); }
  }
}
