import {
  DISPLACEMENT_BLENDS, DISPLACEMENT_MASKS, DISPLACEMENT_PATTERNS, DISPLACEMENT_PRESETS, DISPLACEMENT_PRESET_LABELS, MAX_DISPLACEMENT_LAYERS, MAX_LIPSCHITZ,
  defaultFractalDisplacement, displacementPreset, fractalDisplacementActive, lipschitz,
} from '../engine/fractalDisplacement';
import type { DisplacementBlend, DisplacementLayer, DisplacementMaskMeasure, DisplacementPattern, DisplacementPreset, FractalDisplacement } from '../engine/fractalDisplacement';
import { enhanceNumberInput, enhanceRange } from './fineControl';

const PATTERN_LABELS: Record<DisplacementPattern, string> = { organic: 'Organic', ridged: 'Ridges', billow: 'Soft hills', pores: 'Pores', cracks: 'Cracks', erosion: 'Erosion', grain: 'Grain' };
const BLEND_LABELS: Record<DisplacementBlend, string> = { add: 'Out and in', carve: 'Dig in', raise: 'Build out' };
const MASK_LABELS: Record<DisplacementMaskMeasure, string> = { none: 'Hela fraktalen', orbit_trap: 'Orbit trap (like the colour)', iterations: 'Iterations (like the colour)', height: 'Height (Y)', radius: 'Distance from the centre', x: 'Side (X)', z: 'Depth (Z)' };

export interface FractalDisplacementHandlers {
  /** The distance from the camera to what it looks at, in scene units: the starting sizes of the ready-made layers follow it. */
  reference(): number;
  /** The range of a slider for a mask that measures a coordinate (around what the camera looks at). */
  maskSpan(measure: DisplacementMaskMeasure): [number, number];
  /** The new state. `begin` is true for the first change of a gesture (a drag, a typed value): that one is the Undo step. */
  onChange(next: FractalDisplacement, begin: boolean): void;
}

/**
 * Displacement of the fractal itself (fractalDisplacement.ts): layers of noise with masks. Every number is a slider with an exact field next to it (and the fine
 * control of the other panels); editing one only writes numbers, so nothing is rebuilt and Live LookDev 2 shows the change at once.
 */
export class FractalDisplacementPanel {
  private model: FractalDisplacement = defaultFractalDisplacement();
  private syncs: (() => void)[] = [];
  private signature = '';
  private gesture = false;
  private body!: HTMLElement;
  private enabled!: HTMLInputElement;
  private info!: HTMLElement;

  constructor(private root: HTMLElement, private handlers: FractalDisplacementHandlers) {
    const title = this.el('h3', '', 'Displacement on the fractal');
    const head = this.el('label', 'arow');
    this.enabled = Object.assign(this.el('input'), { type: 'checkbox' }); this.enabled.setAttribute('aria-label', 'Displace the shape of the fractal');
    head.append(this.enabled, ' Change the shape of the fractal with noise (real geometry: silhouette, shadows and reflections follow)');
    this.enabled.addEventListener('change', () => this.commit((m) => { m.enabled = this.enabled.checked; }, true));
    const presets = this.el('div', 'row'); presets.style.flexWrap = 'wrap'; presets.style.gap = '4px';
    presets.append(this.el('span', '', 'Add:'));
    for (const kind of DISPLACEMENT_PRESETS) presets.append(this.button(DISPLACEMENT_PRESET_LABELS[kind], () => this.addPreset(kind)));
    this.body = this.el('div'); this.info = this.el('div', 'note');
    root.append(title, head, presets, this.body, this.info);
    this.render();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e;
  }
  private button(text: string, click: () => void): HTMLButtonElement {
    const b = this.el('button', '', text); b.type = 'button'; b.addEventListener('click', click); return b;
  }

  /** The panel shows this state. Controls are only rebuilt when layers are added, removed or get another mask; otherwise the values are written into them in place (so a drag is not interrupted). */
  update(d: FractalDisplacement | undefined): void {
    this.model = structuredClone(d ?? defaultFractalDisplacement());
    const signature = this.model.layers.map((l) => `${l.id}:${l.mask.measure}`).join('|');
    if (signature !== this.signature) this.render(); else this.syncAll();
  }

  private commit(mutate: (m: FractalDisplacement) => void, begin: boolean): void {
    const next = structuredClone(this.model); mutate(next); this.model = next;
    const signature = next.layers.map((l) => `${l.id}:${l.mask.measure}`).join('|');
    this.handlers.onChange(structuredClone(next), begin);
    if (signature !== this.signature) this.render(); else this.syncAll();
  }
  private syncAll(): void { this.enabled.checked = this.model.enabled; for (const sync of this.syncs) sync(); this.showInfo(); }

  private addPreset(kind: DisplacementPreset): void {
    if (this.model.layers.length >= MAX_DISPLACEMENT_LAYERS) return;
    const ids = new Set(this.model.layers.map((l) => l.id)); let n = this.model.layers.length + 1; while (ids.has('lager-' + n)) n++;
    const layer = displacementPreset(kind, 'lager-' + n, this.handlers.reference());
    layer.seed = Math.floor(Math.random() * 100000);
    this.commit((m) => { m.layers.push(layer); m.enabled = true; }, true);
  }

  private render(): void {
    this.signature = this.model.layers.map((l) => `${l.id}:${l.mask.measure}`).join('|');
    this.syncs = []; this.body.replaceChildren();
    this.model.layers.forEach((layer, index) => this.body.append(this.layerCard(layer.id, index)));
    if (this.model.layers.length === 0) this.body.append(this.el('div', 'note', 'No layers yet. Choose a type above: it is added with a size and depth that suit what you are looking at.'));
    this.syncAll();
  }

  private find(m: FractalDisplacement, id: string): DisplacementLayer { return m.layers.find((l) => l.id === id)!; }

  private layerCard(id: string, index: number): HTMLElement {
    const card = this.el('details'); card.open = true; card.className = 'fd-layer';
    const summary = this.el('summary'); const label = this.el('span'); summary.append(label); card.append(summary);
    const get = () => this.find(this.model, id);
    const head = this.el('div', 'row'); head.style.gap = '4px'; head.style.flexWrap = 'wrap';
    const on = Object.assign(this.el('input'), { type: 'checkbox' }); on.setAttribute('aria-label', `Layer ${index + 1} on`);
    on.addEventListener('change', () => this.commit((m) => { this.find(m, id).enabled = on.checked; }, true));
    const pattern = this.select(DISPLACEMENT_PATTERNS, PATTERN_LABELS, `Layer ${index + 1} pattern`, (v) => this.commit((m) => { this.find(m, id).pattern = v; }, true));
    const blend = this.select(DISPLACEMENT_BLENDS, BLEND_LABELS, `Layer ${index + 1} direction`, (v) => this.commit((m) => { this.find(m, id).blend = v; }, true));
    const remove = this.button('Remove', () => this.commit((m) => { m.layers = m.layers.filter((l) => l.id !== id); }, true)); remove.title = 'Remove the layer';
    head.append(on, pattern, blend, remove); card.append(head);
    this.syncs.push(() => { const l = get(); on.checked = l.enabled; pattern.value = l.pattern; blend.value = l.blend; label.textContent = `Layer ${index + 1}: ${PATTERN_LABELS[l.pattern]} · ${BLEND_LABELS[l.blend]}${l.enabled ? '' : ' (off)'}`; });

    const r = Math.max(this.handlers.reference(), 1e-9), l0 = get();
    this.slider(card, 'Depth', { min: Math.min(r * 1e-4, l0.amount / 10 || r), max: Math.max(r * 1.5, l0.amount * 10), log: true, hard: [0, 1e6] }, () => get().amount, (v, b) => this.commit((m) => { this.find(m, id).amount = v; }, b));
    this.slider(card, 'Size of the details', { min: Math.min(r * 1e-3, 1 / l0.scale / 10), max: Math.max(r * 30, 10 / l0.scale), log: true, hard: [1e-9, 1e6] }, () => 1 / get().scale, (v, b) => this.commit((m) => { this.find(m, id).scale = 1 / v; }, b));
    this.slider(card, 'Detail levels', { min: 1, max: 6, integer: true, hard: [1, 6] }, () => get().octaves, (v, b) => this.commit((m) => { this.find(m, id).octaves = Math.round(v); }, b));
    this.slider(card, 'Sharpness of the details', { min: 0, max: 1, hard: [0, 1] }, () => get().persistence, (v, b) => this.commit((m) => { this.find(m, id).persistence = v; }, b));

    const more = this.el('details'); more.append(this.el('summary', '', 'More: density, seed, move the pattern'));
    this.slider(more, 'Denser details per level', { min: 1.25, max: 4, hard: [1.25, 4] }, () => get().lacunarity, (v, b) => this.commit((m) => { this.find(m, id).lacunarity = v; }, b));
    const seedRow = this.el('div', 'row'); const seed = Object.assign(this.el('input'), { type: 'number', min: '0', max: '16777215', step: '1' }); seed.setAttribute('aria-label', 'Seed');
    seed.addEventListener('input', () => { const v = Number(seed.value); if (Number.isInteger(v) && v >= 0 && v <= 16777215) this.commit((m) => { this.find(m, id).seed = v; }, !this.gesture); this.gesture = true; });
    seed.addEventListener('change', () => { this.gesture = false; });
    enhanceNumberInput(seed, { commit: 'input', integer: true });
    seedRow.append(this.el('span', '', 'Seed'), seed, this.button('Slumpa', () => this.commit((m) => { this.find(m, id).seed = Math.floor(Math.random() * 16777215); }, true)));
    more.append(seedRow);
    this.syncs.push(() => { if (document.activeElement !== seed) seed.value = String(get().seed); });
    (['x', 'y', 'z'] as const).forEach((axis, k) => this.slider(more, `Move the pattern ${axis.toUpperCase()}`, { min: -4 * r, max: 4 * r, hard: [-1e6, 1e6] }, () => get().offset[k]!, (v, b) => this.commit((m) => { this.find(m, id).offset[k] = v; }, b)));
    card.append(more);

    // where on the fractal it acts
    const maskRow = this.el('div', 'row'); const measure = this.select(DISPLACEMENT_MASKS, MASK_LABELS, `Lager ${index + 1} var`, (v) => this.commit((m) => { this.find(m, id).mask.measure = v; }, true));
    maskRow.append(this.el('span', '', 'Var:'), measure); card.append(maskRow);
    this.syncs.push(() => { measure.value = get().mask.measure; });
    const kind = l0.mask.measure;
    if (kind !== 'none') {
      const [lo, hi] = kind === 'orbit_trap' || kind === 'iterations' ? [0, 1] : this.handlers.maskSpan(kind);
      this.slider(card, 'From', { min: lo, max: hi, hard: [-1e6, 1e6] }, () => get().mask.low, (v, b) => this.commit((m) => { this.find(m, id).mask.low = v; }, b));
      this.slider(card, 'To', { min: lo, max: hi, hard: [-1e6, 1e6] }, () => get().mask.high, (v, b) => this.commit((m) => { this.find(m, id).mask.high = v; }, b));
      this.slider(card, 'Soft edge', { min: 0, max: (hi - lo) / 2, hard: [0, 1e6] }, () => get().mask.softness, (v, b) => this.commit((m) => { this.find(m, id).mask.softness = v; }, b));
      const invert = Object.assign(this.el('input'), { type: 'checkbox' }); const invertRow = this.el('label', 'arow'); invertRow.append(invert, ' Invert the mask (act outside the area)');
      invert.addEventListener('change', () => this.commit((m) => { this.find(m, id).mask.invert = invert.checked; }, true));
      this.syncs.push(() => { invert.checked = get().mask.invert; });
      card.append(invertRow);
    }
    return card;
  }

  private select<T extends string>(values: readonly T[], labels: Record<T, string>, aria: string, change: (v: T) => void): HTMLSelectElement {
    const s = this.el('select'); for (const v of values) s.add(new Option(labels[v], v)); s.setAttribute('aria-label', aria);
    s.addEventListener('change', () => change(s.value as T)); return s;
  }

  /** A slider (optionally logarithmic: a tenth of the width is a factor, not a distance) with an exact field and the fine control of the other panels. */
  private slider(parent: HTMLElement, label: string, o: { min: number; max: number; log?: boolean; integer?: boolean; hard?: [number, number] }, read: () => number, write: (v: number, begin: boolean) => void): void {
    const row = this.el('label', 'arow dense'); const group = this.el('span', 'numeric-range');
    const range = Object.assign(this.el('input'), { type: 'range' }); const number = Object.assign(this.el('input'), { type: 'number' }); number.className = 'exact-number';
    range.dataset.numericCompanion = 'external'; // this panel builds the exact field itself (the generic one would not know the logarithmic scale)
    if (o.integer) range.dataset.integer = 'true';
    const steps = 1000, lo = o.min, hi = Math.max(o.max, o.min * 1.0001 + 1e-12);
    const toPos = (v: number) => steps * Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo); // only used by the logarithmic ones
    const fromPos = (p: number) => o.log ? lo * Math.exp(Math.log(hi / lo) * p / steps) : p;
    range.min = o.log ? '0' : String(lo); range.max = o.log ? String(steps) : String(hi); range.step = o.log ? '1' : o.integer ? '1' : String((hi - lo) / 1000);
    const hard = o.hard ?? [lo, hi]; number.min = String(hard[0]); number.max = String(hard[1]); number.step = 'any';
    number.setAttribute('aria-label', `${label} exact value`); range.setAttribute('aria-label', label);
    const gestureStart = (): boolean => { const begin = !this.gesture; this.gesture = true; return begin; };
    range.addEventListener('input', () => write(o.integer || !o.log ? Number(range.value) : fromPos(Number(range.value)), gestureStart()));
    range.addEventListener('change', () => { this.gesture = false; });
    number.addEventListener('input', () => { const v = Number(number.value); if (number.value !== '' && Number.isFinite(v) && v >= hard[0] && v <= hard[1] && (!o.log || v > 0 || hard[0] === 0)) write(o.integer ? Math.round(v) : v, gestureStart()); });
    number.addEventListener('change', () => { this.gesture = false; });
    enhanceNumberInput(number, { commit: 'input', integer: !!o.integer });
    enhanceRange(range, () => Number(range.value), (v) => { range.value = String(v); range.dispatchEvent(new Event('input', { bubbles: true })); });
    group.append(range, number); row.append(this.el('span', '', label), group); parent.append(row);
    this.syncs.push(() => { const v = read(); range.value = String(o.log ? toPos(v) : v); if (document.activeElement !== number) number.value = String(+v.toPrecision(6)); });
  }

  private showInfo(): void {
    const active = fractalDisplacementActive(this.model);
    if (!active) { this.info.textContent = this.model.layers.length ? 'The displacement is off (or all layers have depth 0).' : ''; return; }
    const L = lipschitz(this.model);
    const cost = L >= MAX_LIPSCHITZ ? 'Too steep: the steps become very short. Reduce the depth or increase the size of the details.' : L > 3 ? 'Steep: drawing becomes noticeably slower. Reduce the depth or increase the size if it stutters.' : L > 1 ? 'Moderately steep: works well in Create.' : 'Soft: cheap to draw.';
    this.info.textContent = `${cost} The displacement changes the shape itself and is saved in the scene; Create and the final render draw the same shape.`;
  }
}
