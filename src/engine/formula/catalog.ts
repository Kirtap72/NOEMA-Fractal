import { KERNELS } from "./kernels";
import type { Formula, FormulaCategory } from "./types";

/** Discovery facts only. Classification never changes the counted role or mathematics. */
export function formulaCatalog(formula: Formula) {
  const kernel = formula.kernel ? KERNELS[formula.kernel] : undefined;
  const dimension =
    formula.catalog?.dimension ??
    kernel?.dimension ??
    (formula.variables.some((v) => v.type === "vec4") ? 4 : 3);
  const category: FormulaCategory =
    formula.catalog?.category ??
    (kernel?.method === "difs"
      ? "difs"
      : kernel?.role
        ? "transforms"
        : kernel?.method === "ifs"
          ? "ifs"
          : dimension === 4
            ? "hypercomplex"
            : formula.distance || kernel
              ? "fractals"
              : "transforms");
  return {
    category,
    dimension,
    family: formula.catalog?.family ?? formula.description ?? "",
    tags: formula.catalog?.tags ?? [],
    reviewed: formula.reviewed,
  };
}
