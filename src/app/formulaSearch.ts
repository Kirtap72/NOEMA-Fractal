import { formulaCatalog } from "../engine";
import { FORMULA_CATEGORIES } from "../engine";
import type { Formula, FormulaCategory } from "../engine";
import type { FormulaPreferences } from "./formulaPreferences";
export const CATEGORY_LABELS: Record<FormulaCategory, string> = {
  fractals: "Fractals",
  ifs: "IFS / Polyedrar",
  hypercomplex: "4D / Hyperkomplex",
  transforms: "Transformer",
  spatial: "Rotation / Scale / Position",
  julia: "Julia / C-operationer",
  difs: "dIFS / Former",
  other: "Experimental / Other",
};
export type PickerFilter =
  "all" | "fractals" | "ifs" | "4d" | "transforms" | "difs";
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
export function searchFormulas(
  formulas: readonly Formula[],
  query: string,
  filter: PickerFilter = "all",
  favoritesOnly = false,
  preferences?: Pick<FormulaPreferences, "favorites">,
) {
  const terms = fold(query).trim().split(/\s+/).filter(Boolean);
  return formulas
    .filter((f) => {
      const c = formulaCatalog(f);
      if (favoritesOnly && !preferences?.favorites.includes(f.id)) return false;
      if (filter === "4d" && c.dimension !== 4) return false;
      if (
        filter === "transforms" &&
        !["transforms", "spatial", "julia"].includes(c.category)
      )
        return false;
      if (["fractals", "ifs", "difs"].includes(filter) && c.category !== filter)
        return false;
      const haystack = fold(
        [
          f.name,
          f.id,
          f.description,
          c.category,
          CATEGORY_LABELS[c.category],
          c.family,
          ...c.tags,
          ...f.credits.flatMap((x) => [x.name, x.role ?? ""]),
          `${c.dimension}D`,
          c.reviewed ? "verified verifierad" : "unverified ej granskad",
        ].join(" "),
      );
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    );
}
export function pickerGroups(
  formulas: readonly Formula[],
  preferences: Pick<FormulaPreferences, "favorites" | "recent">,
) {
  const byIds = (ids: readonly string[]) =>
    ids.flatMap((id) => formulas.find((f) => f.id === id) ?? []);
  return [
    {
      key: "favorites",
      label: "Favoriter",
      formulas: byIds(preferences.favorites).sort((a, b) =>
        a.name.localeCompare(b.name, "en"),
      ),
    },
    {
      key: "recent",
      label: "Recently used",
      formulas: byIds(preferences.recent),
    },
    ...FORMULA_CATEGORIES.map((category) => ({
      key: category,
      label: CATEGORY_LABELS[category],
      formulas: formulas.filter((f) => formulaCatalog(f).category === category),
    })),
  ].filter((group) => group.formulas.length);
}
