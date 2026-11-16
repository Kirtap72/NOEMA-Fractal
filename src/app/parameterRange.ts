import type { Parameter } from '../engine/formula/types';

/** A continuous kernel parameter must preserve exact defaults when assigned to a browser range input. */
export function configureKernelRange(input: HTMLInputElement, parameter: Parameter): void {
  input.min = String(parameter.min);
  input.max = String(parameter.max);
  input.dataset.integer = String(parameter.name.startsWith('log2_'));
  input.step = parameter.name.startsWith('log2_') ? '1' : 'any';
}

/** Tiny nonzero constants and field thresholds must not appear as zero in the UI. */
export function formatKernelParameter(value: number): string {
  return value !== 0 && Math.abs(value) < 0.01 ? String(value) : value.toFixed(2);
}
