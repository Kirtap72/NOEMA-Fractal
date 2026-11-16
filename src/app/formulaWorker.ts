import { parseFormula } from "../engine/formula/parse";
import { inspectFormula } from "../engine/formulaFilter";
import type { FilterResult } from "../engine/formulaFilter";

/**
 * Runs the processor filters of a generated formula (ARCHITECTURE.md 8.21, step 2) away from the page, so that a
 * slow formula never freezes it. The page sends the formula file's text; the worker answers with the filter result.
 * Only data goes in and out.
 */
export interface WorkerRequest {
  id: number;
  text: string;
}
export type WorkerAnswer = { id: number; ok: true; result: FilterResult } | { id: number; ok: false; error: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage(message: WorkerAnswer): void };

ctx.onmessage = (e) => {
  const { id, text } = e.data;
  const parsed = parseFormula(text);
  if (!parsed.ok) {
    ctx.postMessage({ id, ok: false, error: parsed.errors.join("; ") });
    return;
  }
  ctx.postMessage({ id, ok: true, result: inspectFormula(parsed.formula, { now: () => performance.now() }) });
};
