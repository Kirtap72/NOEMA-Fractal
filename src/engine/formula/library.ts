import { parseFormula } from "./parse";
import type { Formula } from "./types";

export interface LibraryProblem {
  file: string;
  errors: string[];
}

export interface Library {
  formulas: Formula[];
  problems: LibraryProblem[];
}

/** Turns raw file texts into a library. A broken file is reported but never blocks the others. */
export function buildLibrary(files: Record<string, string>): Library {
  const formulas: Formula[] = [];
  const problems: LibraryProblem[] = [];
  for (const file of Object.keys(files).sort()) {
    const result = parseFormula(files[file]!);
    if (!result.ok) {
      problems.push({ file, errors: result.errors });
    } else if (formulas.some((f) => f.id === result.formula.id)) {
      problems.push({ file, errors: [`id "${result.formula.id}" is already used by another formula file`] });
    } else {
      formulas.push(result.formula);
    }
  }
  return { formulas, problems };
}
