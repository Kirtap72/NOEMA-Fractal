import { APPEARANCE_KEY, DEFAULT_APPEARANCE, PATTERNS, THEMES, effectiveDarken, isSupportedImage, meanLuminance, parseAppearance, patternSize, patternSvg, readabilityHint } from "./appearanceModel";
import type { Appearance, ImageMode, PatternId, ThemeId } from "./appearanceModel";

const store = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e;
};

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const PHOTO_EDGE = 1600, TILE_EDGE = 512;

/**
 * "Utseende": themes, a decorative pattern and an optional picture for the application chrome only (top bar and sidebar).
 *
 * Two fixed, non-interactive layers sit BEHIND the bar and the sidebar. They never overlap the artwork (the picture is fitted to the
 * area between them), so the viewport, the renderer and exported files cannot be touched. The artist's original file is only read;
 * a scaled-down copy is kept in this profile's local storage, and "Reset" removes it again.
 */
export class ChromeAppearance {
  private a: Appearance;
  private readonly layers = new Map<"bar" | "side", { root: HTMLElement; pattern: HTMLElement; image: HTMLElement; dim: HTMLElement }>();
  private natural = { w: 1, h: 1 };
  private saveTimer?: number;
  private readonly status = el("p", "shell-note");
  private readonly themeButtons = new Map<ThemeId, HTMLButtonElement>();
  private readonly inputs = new Map<string, HTMLInputElement>();
  private readonly patternSelect = el("select");
  private readonly modeInputs = new Map<ImageMode, HTMLInputElement>();
  private readonly imageName = el("span", "shell-note");
  private readonly removeButton = el("button", "shell-link", "Remove the picture");
  private readonly autoNote = el("p", "shell-note");

  constructor(private readonly bar: HTMLElement, private readonly controls: HTMLElement) {
    let raw: string | null = null; try { raw = store()?.getItem(APPEARANCE_KEY) ?? null; } catch { raw = null; }
    this.a = parseAppearance(raw);
    for (const region of ["bar", "side"] as const) this.layers.set(region, this.makeLayer(region));
    this.apply();
    const relayout = (): void => this.layout();
    new ResizeObserver(relayout).observe(controls); new ResizeObserver(relayout).observe(bar);
    window.addEventListener("resize", relayout);
    this.layout();
    this.restoreNaturalSize();
  }

  private makeLayer(region: "bar" | "side") {
    const root = el("div", "chrome-bg"); root.dataset.region = region; root.setAttribute("aria-hidden", "true");
    const base = el("div", "cb-base"), pattern = el("div", "cb-pattern"), image = el("div", "cb-image"), dim = el("div", "cb-dim");
    root.append(base, pattern, image, dim); document.body.append(root);
    return { root, pattern, image, dim };
  }

  /** Sizes the two layers to the bar and the sidebar. */
  private layout(): void {
    const b = this.bar.getBoundingClientRect(), c = this.controls.getBoundingClientRect();
    const bar = this.layers.get("bar")!.root, side = this.layers.get("side")!.root;
    Object.assign(bar.style, { left: "0px", top: "0px", width: `${window.innerWidth}px`, height: `${Math.round(b.height)}px` });
    const visible = !this.controls.hidden && c.width > 0 && c.height > 0;
    side.hidden = !visible;
    if (visible) Object.assign(side.style, { left: `${Math.round(c.left)}px`, top: `${Math.round(c.top)}px`, width: `${Math.round(c.width)}px`, height: `${Math.round(c.height)}px` });
    this.sizeImage();
  }

  /** A picture is laid out against the whole window (fixed), so the bar and the sidebar show matching halves of the same image. */
  private sizeImage(): void {
    const img = this.a.image; if (!img) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (const l of this.layers.values()) {
      if (img.mode === "tile") { l.image.style.backgroundSize = `${Math.round(160 * this.a.scale)}px auto`; continue; }
      const cover = Math.max(w / this.natural.w, h / this.natural.h) * this.a.scale;
      l.image.style.backgroundSize = `${Math.round(this.natural.w * cover)}px ${Math.round(this.natural.h * cover)}px`;
    }
  }

  /** Writes the current choices to the page. Visibility and colour only. */
  private apply(): void {
    const a = this.a, t = THEMES.find((x) => x.id === a.theme) ?? THEMES[0]!, body = document.body;
    for (const [k, v] of Object.entries({ bg: t.bg, surface: t.surface, raised: t.raised, line: t.line, accent: t.accent, "glow-a": t.glowA, "glow-b": t.glowB, text: t.text, muted: t.muted, "accent-ink": t.accentInk })) body.style.setProperty(`--${k}`, v);
    body.style.setProperty("--line-strong", `color-mix(in srgb, ${t.line} 70%, ${t.tone === "light" ? "black" : "white"})`);
    body.style.setProperty("--panel-alpha", String(a.panelOpacity));
    body.classList.toggle("theme-light", t.tone === "light"); body.classList.toggle("has-bg-image", !!a.image);
    body.style.colorScheme = t.tone;
    const svg = patternSvg(a.pattern, t.tone), size = patternSize(a.pattern);
    for (const l of this.layers.values()) {
      l.pattern.style.backgroundImage = svg ?? "none"; l.pattern.style.backgroundSize = `${size}px ${size}px`; l.pattern.style.opacity = String(a.patternStrength);
      l.image.hidden = l.dim.hidden = !a.image;
      if (a.image) {
        l.image.style.backgroundImage = `url("${a.image.dataUrl}")`; l.image.style.opacity = String(a.opacity); l.image.style.filter = a.blur > 0 ? `blur(${a.blur}px)` : "none";
        l.image.style.backgroundRepeat = a.image.mode === "tile" ? "repeat" : "no-repeat";
        l.image.style.backgroundPosition = a.image.mode === "tile" ? "0 0" : "center";
        l.dim.style.background = `rgba(0,0,0,${effectiveDarken(a).toFixed(3)})`;
      }
    }
    this.sizeImage();
    this.paintUi();
  }

  private change(next: Partial<Appearance>, persist = true): void {
    this.a = { ...this.a, ...next }; this.apply();
    if (!persist) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 250);
  }

  private save(): void {
    try { store()?.setItem(APPEARANCE_KEY, JSON.stringify(this.a)); this.status.textContent = ""; }
    catch { this.status.textContent = "The appearance could not be saved (picture too large or locked storage). It applies until the program is closed."; }
  }

  // ---- UI -------------------------------------------------------------------------------------------------------
  build(): HTMLElement {
    const root = el("details", "panel shell-appearance"); root.id = "shell-appearance";
    root.append(el("summary", "", "Appearance"));
    root.append(el("p", "shell-note", "Only applies to the top bar and the side panel of the program. The picture you work on, the rendering and exported artworks are never affected."));

    const themes = el("div", "theme-grid");
    for (const t of THEMES) {
      const b = el("button", "theme-card"); b.type = "button"; b.dataset.theme = t.id; b.setAttribute("aria-label", `Theme ${t.label}`);
      const sw = el("span", "theme-swatch"); sw.style.background = `linear-gradient(135deg, ${t.glowA}, ${t.bg} 70%)`; sw.style.borderColor = t.line;
      const dot = el("i"); dot.style.background = t.accent; sw.append(dot);
      b.append(sw, el("span", "theme-label", t.label)); b.onclick = () => this.change({ theme: t.id });
      this.themeButtons.set(t.id, b); themes.append(b);
    }
    root.append(el("h3", "shell-sub", "Theme"), themes);

    root.append(el("h3", "shell-sub", "Pattern"));
    for (const p of PATTERNS) this.patternSelect.append(Object.assign(el("option"), { value: p.id, textContent: p.label }));
    this.patternSelect.setAttribute("aria-label", "Decorative pattern"); this.patternSelect.onchange = () => this.change({ pattern: this.patternSelect.value as PatternId });
    root.append(this.patternSelect, this.slider("patternStrength", "Pattern strength", 0, 1, 0.005, (v) => this.change({ patternStrength: v })));

    root.append(el("h3", "shell-sub", "Own background"));
    const pick = el("label", "shell-file"); const file = el("input"); file.type = "file"; file.accept = "image/png,image/jpeg,image/webp"; file.id = "appearance-file";
    pick.append(el("span", "shell-filebtn", "Choose picture…"), file); file.onchange = () => { const f = file.files?.[0]; file.value = ""; if (f) void this.loadImage(f); };
    const modes = el("div", "shell-row"); modes.setAttribute("role", "radiogroup"); modes.setAttribute("aria-label", "How the picture is used");
    for (const [m, label] of [["photo", "Background picture"], ["tile", "Repeating pattern"]] as const) {
      const l = el("label", "shell-radio"); const r = el("input"); r.type = "radio"; r.name = "appearance-mode"; r.value = m;
      r.onchange = () => { if (r.checked && this.a.image) this.change({ image: { ...this.a.image, mode: m } }); };
      this.modeInputs.set(m, r); l.append(r, el("span", "", label)); modes.append(l);
    }
    this.removeButton.type = "button"; this.removeButton.onclick = () => this.change({ image: null });
    root.append(pick, this.imageName, modes, this.removeButton,
      this.slider("opacity", "Visibility of the picture", 0, 1, 0.01, (v) => this.change({ opacity: v })),
      this.slider("darken", "Darkening", 0, 1, 0.01, (v) => this.change({ darken: v })),
      this.slider("panelOpacity", "Panel density", 0.3, 1, 0.01, (v) => this.change({ panelOpacity: v })),
      this.slider("scale", "Scale", 0.25, 4, 0.05, (v) => this.change({ scale: v })),
      this.slider("blur", "Blur", 0, 12, 0.5, (v) => this.change({ blur: v })), this.autoNote,
      el("p", "shell-note", "Your original file is never changed. The program saves a scaled-down copy in your profile; Reset removes it. Nothing is darkened unless you choose it yourself."));

    const reset = el("button", "shell-primary shell-reset", "Reset to the default theme"); reset.type = "button"; reset.id = "appearance-reset";
    reset.onclick = () => { this.change({ ...DEFAULT_APPEARANCE }); this.status.textContent = "The default appearance is restored."; };
    this.status.setAttribute("role", "status");
    root.append(reset, this.status);
    this.paintUi();
    return root;
  }

  private slider(key: "patternStrength" | "opacity" | "darken" | "panelOpacity" | "scale" | "blur", label: string, min: number, max: number, step: number, on: (v: number) => void): HTMLElement {
    const row = el("label", "shell-slider"); const name = el("span", "", label); const out = el("output");
    const input = el("input"); input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step); input.dataset.appearance = key;
    input.oninput = () => { out.textContent = this.fmt(key, Number(input.value)); on(Number(input.value)); };
    this.inputs.set(key, input); row.append(name, input, out); return row;
  }
  private fmt(key: string, v: number): string {
    if (key === "blur") return `${v} px`;
    if (key === "scale") return `${v.toFixed(2)}×`;
    return key === "patternStrength" ? `${(v * 100).toFixed(1)} %` : `${Math.round(v * 100)} %`;
  }

  private paintUi(): void {
    const a = this.a;
    for (const [id, b] of this.themeButtons) { b.setAttribute("aria-pressed", String(id === a.theme)); b.classList.toggle("on", id === a.theme); }
    this.patternSelect.value = a.pattern;
    const values: Record<string, number> = { patternStrength: a.patternStrength, opacity: a.opacity, darken: a.darken, panelOpacity: a.panelOpacity, scale: a.scale, blur: a.blur };
    for (const [k, input] of this.inputs) {
      input.value = String(values[k]); (input.nextElementSibling as HTMLElement).textContent = this.fmt(k, values[k]!);
      if (k !== "patternStrength" && k !== "panelOpacity") input.disabled = !a.image;
    }
    for (const [m, r] of this.modeInputs) { r.checked = a.image?.mode === m; r.disabled = !a.image; }
    this.imageName.textContent = a.image ? `Chosen picture: ${a.image.name}` : "No picture of your own chosen.";
    this.removeButton.hidden = !a.image;
    this.autoNote.textContent = readabilityHint(a);
  }

  /** Reads a picture file (never writes to it), scales it down and uses the copy. */
  private async loadImage(file: File): Promise<void> {
    if (!isSupportedImage(file.type)) { this.status.textContent = "The picture must be PNG, JPG or WebP."; return; }
    if (file.size > MAX_FILE_BYTES) { this.status.textContent = "The picture is larger than 40 MB. Choose a smaller one."; return; }
    try {
      const bitmap = await createImageBitmap(file);
      const mode = this.a.image?.mode ?? "photo";
      const edge = mode === "tile" ? TILE_EDGE : PHOTO_EDGE, k = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * k)), h = Math.max(1, Math.round(bitmap.height * k));
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(bitmap, 0, 0, w, h); bitmap.close();
      const probe = document.createElement("canvas"); probe.width = probe.height = 32;
      const pctx = probe.getContext("2d", { willReadFrequently: true })!; pctx.drawImage(canvas, 0, 0, 32, 32);
      const luminance = meanLuminance(pctx.getImageData(0, 0, 32, 32).data);
      const keepAlpha = file.type === "image/png";
      let dataUrl = canvas.toDataURL(keepAlpha ? "image/png" : "image/webp", 0.86);
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) dataUrl = canvas.toDataURL("image/jpeg", 0.86);
      this.natural = { w, h };
      this.change({ image: { name: file.name.slice(0, 120), dataUrl, mode, luminance } });
      this.status.textContent = "";
    } catch (e) { this.status.textContent = `The picture could not be used: ${e instanceof Error ? e.message : String(e)}`; }
  }

  /** Called once the persisted picture has its natural size known. */
  restoreNaturalSize(): void {
    const img = this.a.image; if (!img) return;
    const probe = new Image(); probe.onload = () => { this.natural = { w: probe.naturalWidth || 1, h: probe.naturalHeight || 1 }; this.sizeImage(); };
    probe.src = img.dataUrl;
  }
}
