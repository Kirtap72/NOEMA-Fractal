export const FORMULA_PREFERENCES_KEY = "fraktalmotorn.formula-preferences.v1";
export const RECENT_LIMIT = 12;
export const SIDEBAR_WIDTH = { min: 380, default: 460, max: 650 };
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const clampWidth = (value: number) =>
  Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, value));
function browserStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
/** User preferences stay outside scenes and presets; denied/full storage is nonfatal. */
export class FormulaPreferences {
  favorites: string[] = [];
  recent: string[] = [];
  sidebarWidth = SIDEBAR_WIDTH.default;
  private listeners = new Set<() => void>();
  constructor(private storage: PreferenceStorage | null = browserStorage()) {
    try {
      const data = JSON.parse(
        storage?.getItem(FORMULA_PREFERENCES_KEY) ?? "null",
      );
      if (data?.version !== 1) return;
      const ids = (value: unknown, max: number) =>
        Array.isArray(value)
          ? [
              ...new Set(
                value.filter(
                  (v): v is string =>
                    typeof v === "string" && v.length > 0 && v.length <= 128,
                ),
              ),
            ].slice(0, max)
          : [];
      this.favorites = ids(data.favorites, 256);
      this.recent = ids(data.recent, RECENT_LIMIT);
      if (
        typeof data.sidebarWidth === "number" &&
        Number.isFinite(data.sidebarWidth)
      )
        this.sidebarWidth = clampWidth(data.sidebarWidth);
    } catch {
      /* Keep defaults for malformed or unavailable storage. */
    }
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  isFavorite(id: string) {
    return this.favorites.includes(id);
  }
  toggleFavorite(id: string) {
    this.favorites = this.isFavorite(id)
      ? this.favorites.filter((x) => x !== id)
      : [...this.favorites, id];
    this.save();
  }
  use(id: string) {
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(
      0,
      RECENT_LIMIT,
    );
    this.save();
  }
  setSidebarWidth(width: number) {
    if (!Number.isFinite(width)) return;
    this.sidebarWidth = clampWidth(width);
    this.save();
  }
  private save() {
    try {
      this.storage?.setItem(
        FORMULA_PREFERENCES_KEY,
        JSON.stringify({
          version: 1,
          favorites: this.favorites,
          recent: this.recent,
          sidebarWidth: this.sidebarWidth,
        }),
      );
    } catch {
      /* Selection remains usable if persistence is unavailable. */
    }
    for (const listener of this.listeners) listener();
  }
}
