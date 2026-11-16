// Precise control of numbers (formula parameters, object position / rotation / size, material values).
//
// Two problems with the plain browser controls: the little arrows of a number field step by 1 whatever the value is, and a slider moves a whole tenth or more
// per pixel over its range, while a fractal can change completely with the fourth decimal. This module gives every number
//   - arrows (own buttons, the keyboard arrows and the mouse wheel in a focused field) whose step follows the size of the value: a hundredth of its size, so
//     1.234 steps by 0.01 and 0.05 by 0.0001, and never by a whole unit for a small number;
//   - finer steps on demand: Shift = 10 times finer, Alt = 100 times finer (Shift + Alt = 1000), and a "Finjustering" choice (10 / 100 / 1000 times finer) that stays on,
//     for people who do not want to hold a key while dragging;
//   - slider dragging that, when fine, works relative to where the drag began instead of jumping to the pointer: moving the pointer the full width of a slider then
//     changes the value by only that fraction of its range.
// Pure helpers (autoStep, steppedValue, modifierFactor) are exported for the tests; the rest touches the DOM.

export const FINE_LEVELS: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Normal' },
  { value: 0.1, label: '10× finer' },
  { value: 0.01, label: '100× finer' },
  { value: 0.001, label: '1000× finer' },
];
const STORAGE_KEY = 'noema-fine-control';
let globalFactor = 1;
const listeners = new Set<() => void>();

export function getGlobalFine(): number { return globalFactor; }
export function setGlobalFine(value: number): void {
  globalFactor = FINE_LEVELS.some((l) => l.value === value) ? value : 1;
  try { localStorage.setItem(STORAGE_KEY, String(globalFactor)); } catch { /* private window: the choice is simply not remembered */ }
  for (const listener of listeners) listener();
}
export function onFineChange(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

/** Shift = 10 times finer, Alt = 100 times finer, both = 1000 times. */
export function modifierFactor(e: { shiftKey?: boolean; altKey?: boolean }): number {
  return (e.shiftKey ? 0.1 : 1) * (e.altKey ? 0.01 : 1);
}
/** What a step or a drag is multiplied by now: the chosen finjustering and the keys held. Never below a millionth. */
export function effectiveFactor(e: { shiftKey?: boolean; altKey?: boolean } = {}): number {
  return Math.max(1e-6, Math.min(1, globalFactor * modifierFactor(e)));
}

/**
 * The step of an arrow for a value: a hundredth of its size (a power of ten), so the step always changes the value in about its third digit.
 * Zero and integers: a hundredth of the range (never less than 1e-6), whole numbers step by 1.
 */
export function autoStep(value: number, min: number, max: number, integer = false): number {
  if (integer) return 1;
  const size = Math.abs(value);
  const range = Number.isFinite(max - min) ? Math.abs(max - min) : 0;
  const base = size > 0 ? 10 ** Math.floor(Math.log10(size) - 2) : range > 0 ? 10 ** Math.floor(Math.log10(range) - 3) : 0.001;
  return Math.max(1e-9, Math.min(base, range > 0 ? range / 10 : base));
}
/** current + direction x step, rounded to the decimals the step has (so 0.1 + 0.2 never shows as 0.30000000000000004), and kept inside min and max. */
export function steppedValue(current: number, direction: 1 | -1, step: number, min: number, max: number): number {
  const decimals = Math.min(12, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9) + 1));
  const next = Number((current + direction * step).toFixed(decimals));
  return Math.min(max, Math.max(min, next));
}

const numberOr = (text: string | undefined, fallback: number): number => { const v = Number(text); return text !== undefined && text !== '' && Number.isFinite(v) ? v : fallback; };

export interface NumberOptions {
  /** The event the field's owner listens to: 'input' (the numeric companions of sliders) or 'change' (the object panel). */
  commit: 'input' | 'change';
  integer?: boolean;
}
/** Arrows, wheel, keys and own step buttons for one number field. Safe to call twice on the same field. */
export function enhanceNumberInput(input: HTMLInputElement, options: NumberOptions): void {
  if (input.dataset.fine === 'on') return;
  input.dataset.fine = 'on'; input.classList.add('fine-number');
  const range = (): [number, number] => [numberOr(input.min, -Infinity), numberOr(input.max, Infinity)];
  const step = (e: { shiftKey?: boolean; altKey?: boolean }, direction: 1 | -1, coarse = false): void => {
    if (input.disabled || input.readOnly) return;
    const [min, max] = range(); const value = numberOr(input.value, 0);
    const size = autoStep(value, min, max, options.integer) * (options.integer ? 1 : effectiveFactor(e)) * (coarse ? 10 : 1);
    const next = steppedValue(value, direction, size, min, max);
    if (next === value) return;
    input.value = String(next);
    input.dispatchEvent(new Event(options.commit, { bubbles: true }));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(e, e.key === 'ArrowUp' ? 1 : -1); }
    else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); step(e, e.key === 'PageUp' ? 1 : -1, true); }
  });
  // the wheel changes the value only while the field has the keyboard focus, so scrolling the panel never changes a number by accident
  input.addEventListener('wheel', (e) => { if (document.activeElement !== input) return; e.preventDefault(); step(e, e.deltaY < 0 ? 1 : -1); }, { passive: false });
  // own small buttons instead of the browser's, which always step by 1
  const group = document.createElement('span'); group.className = 'fine-steppers';
  const button = (label: string, title: string, direction: 1 | -1): HTMLButtonElement => {
    const b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1; b.textContent = label; b.setAttribute('aria-label', title); b.title = title + ' (Shift: 10× finer, Alt: 100× finer)';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); step(e, direction);
      let delay = 420; const repeat = (): void => { step(e, direction); delay = Math.max(60, delay * 0.8); timer = setTimeout(repeat, delay); };
      timer = setTimeout(repeat, delay);
    });
    for (const name of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(name, stop);
    return b;
  };
  group.append(button('▲', 'Increase', 1), button('▼', 'Decrease', -1));
  // the field and its buttons are ONE item of whatever layout the field sits in (a grid, a row of a label): the buttons never get a row of their own
  const wrap = document.createElement('span'); wrap.className = 'fine-number-wrap'; input.before(wrap); wrap.append(input, group);
}

/**
 * Slider dragging with fine control. When the effective factor is below 1 the drag is relative: the value starts where it was and moves by
 * (pointer movement / slider width) x range x factor, so a whole width of pointer movement is a fraction of the range. Keys and the factor can change mid-drag.
 * The keyboard arrows of a focused slider step by the auto step times the factor (PageUp / PageDown ten times more).
 */
export function enhanceRange(range: HTMLInputElement, read: () => number, write: (value: number) => void): void {
  if (range.dataset.fineRange === 'on') return;
  range.dataset.fineRange = 'on';
  const bounds = (): [number, number] => [numberOr(range.min, 0), numberOr(range.max, 100)];
  const integer = (): boolean => range.dataset.integer === 'true';
  const clamp = (v: number): number => { const [lo, hi] = bounds(); return Math.min(hi, Math.max(lo, v)); };
  let drag: { x: number; value: number; factor: number } | undefined;
  range.addEventListener('pointerdown', (e) => {
    if (integer() || range.disabled || e.button !== 0) return;
    const factor = effectiveFactor(e);
    if (factor >= 1) return; // the ordinary slider
    e.preventDefault(); range.focus({ preventScroll: true }); range.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, value: read(), factor };
  });
  range.addEventListener('pointermove', (e) => {
    if (!drag || !range.hasPointerCapture(e.pointerId)) return;
    const factor = Math.min(1, effectiveFactor(e));
    if (factor !== drag.factor) drag = { x: e.clientX, value: read(), factor }; // the keys changed: continue from here at the new fineness
    const [lo, hi] = bounds(); const width = Math.max(1, range.getBoundingClientRect().width);
    write(clamp(drag.value + ((e.clientX - drag.x) / width) * (hi - lo) * drag.factor));
  });
  const end = (e: PointerEvent): void => {
    if (!drag) return; drag = undefined;
    if (range.hasPointerCapture(e.pointerId)) range.releasePointerCapture(e.pointerId);
    range.dispatchEvent(new Event('change', { bubbles: true }));
  };
  range.addEventListener('pointerup', end); range.addEventListener('pointercancel', end);
  range.addEventListener('keydown', (e) => {
    const keys: Record<string, 1 | -1> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 1, PageDown: -1 };
    const direction = keys[e.key]; if (!direction || integer() || range.disabled) return;
    e.preventDefault();
    const [lo, hi] = bounds(); const value = read();
    const size = autoStep(value, lo, hi) * effectiveFactor(e) * (e.key.startsWith('Page') ? 10 : 1);
    write(steppedValue(value, direction, size, lo, hi));
    range.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** The "Finjustering" choice, placed in the settings navigator at the top of the control panel. */
export function installFineControl(host: HTMLElement): void {
  if (host.querySelector('.fine-control')) return;
  try { const saved = Number(localStorage.getItem(STORAGE_KEY)); if (FINE_LEVELS.some((l) => l.value === saved)) globalFactor = saved; } catch { /* nothing saved */ }
  const label = document.createElement('label'); label.className = 'fine-control';
  label.title = 'Fine control: makes all arrows and sliders 10, 100 or 1000 times finer, so you do not have to hold a key. Without a choice: hold Shift (10× finer) or Alt (100× finer) while you drag or press an arrow.';
  const text = document.createElement('span'); text.textContent = 'Fine control';
  const select = document.createElement('select'); select.id = 'fine-factor'; select.setAttribute('aria-label', 'Fine control of sliders and arrows');
  for (const level of FINE_LEVELS) { const o = document.createElement('option'); o.value = String(level.value); o.textContent = level.label; select.append(o); }
  select.value = String(globalFactor);
  select.onchange = () => setGlobalFine(Number(select.value));
  onFineChange(() => { select.value = String(globalFactor); label.dataset.fine = globalFactor < 1 ? 'on' : 'off'; });
  label.dataset.fine = globalFactor < 1 ? 'on' : 'off';
  label.append(text, select); host.append(label);
}
