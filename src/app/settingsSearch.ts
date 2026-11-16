/** Pure search logic for "Sök inställning" (ARTIST-UX-02, phase A). No DOM, so it is covered by ordinary unit tests. */

export interface SettingEntry {
  /** What the artist sees in the result list. */
  label: string;
  /** Swedish category, e.g. "Material & textures". */
  group: string;
  /** Extra text that also matches (title text, section name, aliases). */
  keywords: string;
}

/** Display order and panel membership of the categories. Keys are the ids of the panels in `index.html`. */
export const SETTING_GROUPS: readonly { id: string; label: string; panels: readonly string[] }[] = [
  { id: "camera", label: "Camera & focus", panels: ["navigation", "camera-panel", "camera-flight", "atlas-panel"] },
  { id: "fractal", label: "Fractal & geometry", panels: ["chain", "random", "formulas", "primitives", "fractal-displacement", "cutout"] },
  { id: "material", label: "Material & textures", panels: ["color", "material"] },
  { id: "light", label: "Light", panels: ["lights"] },
  { id: "atmosphere", label: "Atmosphere", panels: ["fog", "environment"] },
  { id: "preview", label: "Preview & rendering", panels: ["still", "details", "format"] },
  { id: "animation", label: "Animation", panels: ["animation", "render"] },
  { id: "library", label: "Library & export", panels: ["mesh"] },
];

export function groupOfPanel(panelId: string): string {
  return SETTING_GROUPS.find((g) => g.panels.includes(panelId))?.label ?? "Other";
}

/**
 * English words that mean the same thing. If an entry's own text contains a word from a row,
 * the other words of that row also match it. Only whole-word matching, so "ao" cannot match "kaos".
 */
const SYNONYMS: readonly (readonly string[])[] = [
  ["texture size", "texture scale", "tiling", "repeat", "image scale", "scale"],
  ["roughness"],
  ["metallic", "metalness", "metal"],
  ["normal", "normal map"],
  ["depth of field", "dof", "focus", "blur"],
  ["spot", "spotlight"],
  ["light", "lamp", "lights"],
  ["fog", "mist"],
  ["geometry detail"],
  ["render preview", "preview"],
  ["lookdev", "look dev", "still quality", "still picture"],
  ["thumbnail", "thumbnails", "picture preset", "preset", "my fractals", "library"],
  ["camera"],
  ["colour", "color", "gradient"],
  ["material", "surface material"],
  ["resolution", "picture size", "size"],
  ["samples", "spp", "camera samples"],
  ["environment", "hdri", "sky"],
  ["animation", "keyframe", "timeline"],
];

const strip = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Lower case, accents removed except å/ä/ö kept as their base letters on both sides of the comparison. */
export function normalizeText(s: string): string {
  return strip(s.toLocaleLowerCase("en")).replace(/[^a-z0-9]+/g, " ").trim();
}

const SYNONYM_ROWS = SYNONYMS.map((row) => row.map(normalizeText));

function containsWords(haystack: string, phrase: string): boolean {
  return (" " + haystack + " ").includes(" " + phrase + " ");
}

/** Words that should also match an entry, from its text. */
export function expandedKeywords(entry: SettingEntry): string {
  const text = normalizeText(`${entry.label} ${entry.keywords}`);
  const extra: string[] = [];
  for (const row of SYNONYM_ROWS) if (row.some((w) => containsWords(text, w))) extra.push(...row);
  return text + " " + extra.join(" ");
}

export interface RankedSetting<T extends SettingEntry> {
  entry: T;
  score: number;
}

/**
 * Entries that match every word of the query, best first. A word matches when a word of the entry starts with it
 * (so "gro" finds "Roughness"); label hits count more than keyword hits. An empty query returns nothing.
 */
export function rankSettings<T extends SettingEntry>(entries: readonly T[], query: string, limit = 12): RankedSetting<T>[] {
  const words = normalizeText(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const out: RankedSetting<T>[] = [];
  for (const entry of entries) {
    const label = normalizeText(entry.label);
    const all = expandedKeywords(entry);
    let score = 0;
    let ok = true;
    // Swedish writes compounds as one word: "textur storlek" should find "Texturstorlek".
    if (words.length > 1 && !words.every((w) => containsPrefix(all, w)) && containsPrefix(all, words.join(""))) {
      out.push({ entry, score: 3 - label.length / 1000 });
      continue;
    }
    for (const word of words) {
      const inLabel = containsPrefix(label, word);
      const inAll = inLabel || containsPrefix(all, word);
      if (!inAll) {
        ok = false;
        break;
      }
      score += inLabel ? (label === word ? 6 : 4) : 1;
    }
    if (ok) out.push({ entry, score: score - label.length / 1000 });
  }
  out.sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label, "en"));
  return out.slice(0, limit);
}

function containsPrefix(haystack: string, prefix: string): boolean {
  return (" " + haystack).includes(" " + prefix);
}
