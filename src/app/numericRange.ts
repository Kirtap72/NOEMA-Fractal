import { enhanceNumberInput, enhanceRange } from './fineControl';

/** Exact values live outside the native range control: browsers quantize its value to step. */
const values = new WeakMap<HTMLInputElement, number>();
const companions = new WeakMap<HTMLInputElement, HTMLInputElement>();
const forwarded = new WeakSet<Event>();
const tracked = new WeakSet<HTMLInputElement>();
function track(range: HTMLInputElement): void {
  if (tracked.has(range)) return;
  tracked.add(range);
  range.addEventListener('input', event => {
    if (!forwarded.has(event)) values.set(range, Number(range.value));
    const number = companions.get(range);
    if (number) { number.value = String(readNumber(range)); number.setCustomValidity(''); }
  }, { capture: true });
}
export function readNumber(input: HTMLInputElement | HTMLSelectElement): number {
  // With step 'any' the native value is exact; a panel that writes input.value directly must not be overruled by a stale remembered number.
  return input instanceof HTMLInputElement && input.type === 'range' && input.step !== 'any' ? values.get(input) ?? Number(input.value) : Number(input.value);
}
export function setInputValue(input: HTMLInputElement | HTMLSelectElement, value: number): void {
  input.value = String(value);
  if (input instanceof HTMLInputElement && input.type === 'range') {
    track(input);
    values.set(input, value);
    const number = companions.get(input);
    if (number && document.activeElement !== number) number.value = String(value);
  }
}
export function isNumericEditing(input: HTMLInputElement): boolean {
  return document.activeElement === input || document.activeElement === companions.get(input);
}
export function validNumeric(text: string, min: number, max: number, integer = false): number | undefined {
  const value = text.trim() === '' ? NaN : Number(text);
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)) ? value : undefined;
}
/** One reusable installer, including ranges added later when formula panels rebuild. */
export function installNumericRanges(root: HTMLElement): () => void {
  const mount = (range: HTMLInputElement): void => {
    // Logarithmic controls can supply their own exact (non-logarithmic) input.
    if (range.dataset.numericCompanion === 'external') {
      // Position-only sliders (logarithmic scales, orbit influence...) still get fine dragging and arrows; their panel reads the native value, so it must not be rounded to step.
      if (range.dataset.integer !== 'true') range.step = 'any';
      enhanceRange(range, () => Number(range.value), value => { range.value = String(value); range.dispatchEvent(new Event('input', { bubbles: true })); });
      return;
    }
    if (companions.has(range)) return;
    // The browser rounds a slider's value to its step, which would swallow every fine move for panels that read range.value: the exact number is kept in step 'any'.
    if (range.dataset.integer !== 'true') range.step = 'any';
    const initial = readNumber(range);
    const group = document.createElement('span'); group.className = 'numeric-range';
    const number = document.createElement('input'); number.type = 'number'; number.step = range.dataset.integer === 'true' ? '1' : 'any'; number.className = 'exact-number';
    number.title = range.title;
    const label = range.getAttribute('aria-label') ?? range.closest('label')?.querySelector('span')?.textContent ?? range.closest('label')?.firstChild?.textContent ?? (range.id || 'Value');
    range.setAttribute('aria-label', label.trim()); number.setAttribute('aria-label', `${label.trim()} exact value`);
    range.before(group); group.append(range, number); companions.set(range, number);
    if (range.id) number.id = `${range.id}-exact`;
    const sync = (): void => {
      number.disabled = range.disabled;
      number.min = range.dataset.numericMin ?? (range.min || '0');
      number.max = range.dataset.numericMax ?? (range.max || '100');
      if (!isNumericEditing(range)) number.value = String(readNumber(range));
    };
    track(range);
    number.addEventListener('input', () => {
      const value = validNumeric(number.value, Number(number.min), Number(number.max), range.dataset.integer === 'true');
      number.setCustomValidity(value === undefined ? `Enter ${range.dataset.integer === 'true' ? 'an integer' : 'a number'} between ${number.min} and ${number.max}.` : '');
      if (value === undefined) return;
      setInputValue(range, value);
      const event = new Event('input', { bubbles: true }); forwarded.add(event); range.dispatchEvent(event);
    });
    // Arrows, wheel, own step buttons and keys for fine steps (fineControl.ts): the step follows the size of the value, never a whole unit for a small number.
    enhanceNumberInput(number, { commit: 'input', integer: range.dataset.integer === 'true' });
    // The slider itself: Shift / Alt / the Finjustering choice make a drag relative and finer, and the keyboard arrows step finely.
    enhanceRange(range, () => readNumber(range), value => { setInputValue(range, value); const event = new Event('input', { bubbles: true }); forwarded.add(event); range.dispatchEvent(event); });
    number.addEventListener('blur', () => { if (!number.validationMessage) number.value = String(readNumber(range)); });
    setInputValue(range, initial); sync();
    // Attribute observer only; no per-frame scan, and detached controls are garbage collectible.
    const attrs = new MutationObserver(sync); attrs.observe(range, { attributes: true, attributeFilter: ['disabled', 'min', 'max', 'data-numeric-min', 'data-numeric-max'] });
  };
  const scan = (): void => { root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(mount); };
  scan();
  const observer = new MutationObserver(scan); observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
