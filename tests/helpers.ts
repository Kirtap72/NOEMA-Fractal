import { generateChain } from "../src/engine/formula/chain";
import type { Formula } from "../src/engine/formula/types";

/** The shader code of a formula on its own (a chain of one step). */
export function wgslOf(formula: Formula, rounds = 1): string {
  const r = generateChain([{ formula, iterations: formula.iterations }], rounds);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.wgsl;
}
