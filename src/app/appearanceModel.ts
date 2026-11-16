/**
 * ARTIST-UX-POLISH-02: the look of the application chrome (top bar and sidebar) as plain data.
 *
 * Nothing here knows about the scene, the renderer or the artwork. The settings only choose colours and a decorative background for the
 * interface; they are stored per user in the browser's local storage, never in a scene file.
 */
export type ThemeId = "grafit" | "skymning" | "barnsten" | "skog" | "plommon" | "kol" | "pergament" | "dis" | "salvia";
export type Tone = "dark" | "light";
export type PatternId = "ingen" | "fraktal" | "sexkant" | "rutnat" | "diamant" | "kontur";
export type ImageMode = "photo" | "tile";

export interface Theme { id: ThemeId; label: string; tone: Tone; text: string; muted: string; accentInk: string; bg: string; surface: string; raised: string; line: string; accent: string; glowA: string; glowB: string }

/** Dark and light themes. Every theme carries its own text colours, so contrast belongs to the theme and not to the background picture. */
export const THEMES: readonly Theme[] = [
  { id: "grafit", label: "Graphite", tone: "dark", text: "#e9ecf1", muted: "#a0a8b5", accentInk: "#1a1203", bg: "#0e1014", surface: "#15181d", raised: "#1c2027", line: "#292e37", accent: "#ffb454", glowA: "#2b2a2e", glowB: "#171a20" },
  { id: "skymning", label: "Dusk", tone: "dark", text: "#e9ecf1", muted: "#a0a8b5", accentInk: "#1a1203", bg: "#0d1118", surface: "#141a24", raised: "#1b2330", line: "#27313f", accent: "#ffb454", glowA: "#1f2a3d", glowB: "#121823" },
  { id: "barnsten", label: "Amber", tone: "dark", text: "#e9ecf1", muted: "#a0a8b5", accentInk: "#1a1203", bg: "#110e0b", surface: "#18140f", raised: "#211b14", line: "#322a1f", accent: "#ffb454", glowA: "#34271a", glowB: "#171109" },
  { id: "skog", label: "Skog", tone: "dark", text: "#e9ecf1", muted: "#a0a8b5", accentInk: "#1a1203", bg: "#0b1210", surface: "#111b18", raised: "#18241f", line: "#24342d", accent: "#f0b45a", glowA: "#183029", glowB: "#0f1a16" },
  { id: "plommon", label: "Plum", tone: "dark", text: "#e9ecf1", muted: "#a0a8b5", accentInk: "#1a1203", bg: "#100d15", surface: "#17131f", raised: "#1f1a2a", line: "#2e2740", accent: "#ffb454", glowA: "#2b2040", glowB: "#150f1d" },
  { id: "kol", label: "Kol", tone: "dark", text: "#e9ecf1", muted: "#a0a8b5", accentInk: "#1a1203", bg: "#070708", surface: "#101012", raised: "#17171a", line: "#232327", accent: "#ffb454", glowA: "#151518", glowB: "#0a0a0b" },
  { id: "pergament", label: "Parchment", tone: "light", text: "#1d1a14", muted: "#5d564a", accentInk: "#ffffff", bg: "#f3ede0", surface: "#faf6ec", raised: "#ebe4d3", line: "#d3c9b2", accent: "#a85a05", glowA: "#fffaf0", glowB: "#ece4d2" },
  { id: "dis", label: "Dis", tone: "light", text: "#171b22", muted: "#505866", accentInk: "#ffffff", bg: "#e9edf2", surface: "#f6f8fb", raised: "#dfe5ed", line: "#c4cdd9", accent: "#a85a05", glowA: "#ffffff", glowB: "#dde3ec" },
  { id: "salvia", label: "Sage", tone: "light", text: "#14201a", muted: "#47584e", accentInk: "#ffffff", bg: "#e6ede7", surface: "#f4f8f4", raised: "#d9e4db", line: "#bccbbf", accent: "#9a5206", glowA: "#fbfffb", glowB: "#d8e3da" },
];

export const PATTERNS: readonly { id: PatternId; label: string }[] = [
  { id: "fraktal", label: "Fractal triangles" }, { id: "sexkant", label: "Hexagons" }, { id: "rutnat", label: "Fine grid" },
  { id: "diamant", label: "Diamonds" }, { id: "kontur", label: "Nested squares" }, { id: "ingen", label: "None" },
];

/** Tile sizes in CSS pixels at scale 1. */
const TILE: Record<Exclude<PatternId, "ingen">, number> = { fraktal: 64, sexkant: 56, rutnat: 24, diamant: 40, kontur: 48 };

/** Seamless SVG tiles drawn with hairlines. Each is built from the same stroke colour so the opacity control is the only strength knob. */
export function patternSvg(id: PatternId, tone: Tone = "dark"): string | null {
  if (id === "ingen") return null;
  const s = TILE[id], stroke = tone === "light" ? "%23000000" : "%23ffffff";
  const head = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}' viewBox='0 0 ${s} ${s}'><g fill='none' stroke='${stroke}' stroke-width='1'>`;
  let body = "";
  if (id === "fraktal") {
    // A Sierpinski-style triangle, two levels deep: each triangle gets an inverted triangle joining its edge midpoints.
    const tri = (x: number, y: number, w: number): string => `M${x} ${y + w}L${x + w / 2} ${y}L${x + w} ${y + w}Z`;
    const hole = (x: number, y: number, w: number): string => `M${x + w / 2} ${y + w}L${x + w / 4} ${y + w / 2}L${x + (3 * w) / 4} ${y + w / 2}Z`;
    body = `<path d='${tri(2, 2, 60)}${hole(2, 2, 60)}${hole(17, 2, 30)}${hole(2, 32, 30)}${hole(32, 32, 30)}'/>`;
  } else if (id === "sexkant") {
    body = "<path d='M14 0L28 8V24L14 32L0 24V8Z M42 28L56 36V52L42 60L28 52V36Z' transform='translate(0 -4)'/>";
  } else if (id === "rutnat") {
    body = `<path d='M0 .5H${s}M.5 0V${s}'/>`;
  } else if (id === "diamant") {
    body = `<path d='M20 2L38 20L20 38L2 20Z M20 10L30 20L20 30L10 20Z'/>`;
  } else {
    body = `<rect x='3' y='3' width='42' height='42'/><rect x='11' y='11' width='26' height='26'/><rect x='19' y='19' width='10' height='10'/>`;
  }
  return `url("data:image/svg+xml,${(head + body + "</g></svg>").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23").replace(/"/g, "'")}")`;
}
export const patternSize = (id: PatternId): number => (id === "ingen" ? 0 : TILE[id]);

export interface Appearance {
  v: 1;
  theme: ThemeId;
  pattern: PatternId;
  /** Strength of the built-in pattern, 0..1. The default is faint; the artist may take it all the way up. */
  patternStrength: number;
  image: { name: string; dataUrl: string; mode: ImageMode; luminance: number } | null;
  /** How visible the picture is, 0..1 (1 = the picture exactly as it is). */
  opacity: number;
  /** A black veil over the picture, 0..1 (0 = none; nothing else ever darkens it). */
  darken: number;
  /** How solid the cards behind labels and controls are, 0.3..1. Independent of the two above. */
  panelOpacity: number;
  /** Picture scale (tile size for a pattern), 0.25..4. */
  scale: number;
  /** Blur in CSS pixels, 0..12. */
  blur: number;
}

export const DEFAULT_APPEARANCE: Appearance = { v: 1, theme: "grafit", pattern: "fraktal", patternStrength: 0.045, image: null, opacity: 0.5, darken: 0.2, panelOpacity: 0.92, scale: 1, blur: 0 };
export const APPEARANCE_KEY = "noema.appearance.v1";

const clamp = (n: unknown, lo: number, hi: number, d: number): number => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);

/** Reads saved preferences; anything damaged falls back to the default for that field. The image must be a data: URL of a known picture type. */
export function parseAppearance(text: string | null | undefined): Appearance {
  if (!text) return { ...DEFAULT_APPEARANCE };
  try {
    const r = JSON.parse(text) as Partial<Appearance> & { image?: Partial<NonNullable<Appearance["image"]>> | null };
    if (!r || typeof r !== "object" || r.v !== 1) return { ...DEFAULT_APPEARANCE };
    const d = DEFAULT_APPEARANCE;
    const img = r.image;
    const image = img && typeof img.dataUrl === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(img.dataUrl) && img.dataUrl.length < 4_000_000
      ? { name: typeof img.name === "string" ? img.name.slice(0, 120) : "bild", dataUrl: img.dataUrl, mode: (img.mode === "tile" ? "tile" : "photo") as ImageMode, luminance: clamp(img.luminance, 0, 1, 0.3) }
      : null;
    return {
      v: 1,
      theme: THEMES.some((t) => t.id === r.theme) ? (r.theme as ThemeId) : d.theme,
      pattern: PATTERNS.some((p) => p.id === r.pattern) ? (r.pattern as PatternId) : d.pattern,
      patternStrength: clamp(r.patternStrength, 0, 1, d.patternStrength),
      image, opacity: clamp(r.opacity, 0, 1, d.opacity), darken: clamp(r.darken, 0, 1, d.darken), panelOpacity: clamp(r.panelOpacity, 0.3, 1, d.panelOpacity), scale: clamp(r.scale, 0.25, 4, d.scale), blur: clamp(r.blur, 0, 12, d.blur),
    };
  } catch { return { ...DEFAULT_APPEARANCE }; }
}

/**
 * The veil actually used: exactly what the artist chose. Nothing forces a picture darker. Readability comes from the theme's own text
 * colours and from the cards behind labels and controls (panelOpacity), never from suppressing the background.
 */
export const effectiveDarken = (a: Pick<Appearance, "darken">): number => a.darken;

/** A hint (never a rule) when a picture and the theme's text are likely to fight: bright picture under light text or the reverse. */
export function readabilityHint(a: Pick<Appearance, "opacity" | "darken" | "panelOpacity" | "image" | "theme">): string {
  if (!a.image || a.panelOpacity >= 0.8) return "";
  const tone = THEMES.find((t) => t.id === a.theme)?.tone ?? "dark";
  const shown = a.image.luminance * a.opacity * (1 - a.darken);
  if (tone === "dark" && shown > 0.3) return "The picture is light under light text. Increase Panel density or choose a light theme if something becomes hard to read.";
  if (tone === "light" && a.image.luminance < 0.4 && a.opacity > 0.5) return "The picture is dark under dark text. Increase Panel density or choose a dark theme if something becomes hard to read.";
  return "";
}

/** Mean relative luminance (0..1) of RGBA pixels, sampled sparsely. */
export function meanLuminance(rgba: ArrayLike<number>): number {
  let sum = 0, n = 0;
  const step = Math.max(4, Math.floor(rgba.length / 4 / 4000) * 4);
  for (let i = 0; i + 2 < rgba.length; i += step) { sum += (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) / 255; n++; }
  return n ? sum / n : 0.3;
}

export const isSupportedImage = (mime: string): boolean => /^image\/(png|jpeg|webp)$/.test(mime);
