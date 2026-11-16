/**
 * ARTIST-UI-FIX-01: collapsible categories in the settings sidebar.
 *
 * Three levels: category (the orange headings) > part (one panel, with its own bar) > section (the `<details>` inside a panel).
 * Collapsing only hides: nothing is removed from the page, so every control keeps its value and its listeners, and the settings search
 * (which reads the real controls) still finds controls inside collapsed categories and opens whatever surrounds the one it jumps to.
 * What the artist left open or closed is remembered in the browser's local storage, never in the scene.
 */
export const COLLAPSE_STORAGE_KEY = 'noema.settingsUi.v1';

export interface CollapseState {
  /** true = open. Absent = the default. */
  categories: Record<string, boolean>;
  parts: Record<string, boolean>;
  sections: Record<string, boolean>;
}

/** First visit: only the formula category is open, so the artist sees a short overview and nothing scrolls away. */
export const DEFAULT_OPEN_CATEGORIES: readonly string[] = ['fractal'];

export const emptyState = (): CollapseState => ({ categories: {}, parts: {}, sections: {} });

const record = (v: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'boolean' && k.length <= 200) out[k] = x;
  return out;
};

/** Reads what was saved; anything damaged or unknown is ignored (the defaults apply). */
export function parseState(text: string | null | undefined): CollapseState {
  if (!text) return emptyState();
  try {
    const raw = JSON.parse(text) as { v?: number; categories?: unknown; parts?: unknown; sections?: unknown };
    if (!raw || raw.v !== 1) return emptyState();
    return { categories: record(raw.categories), parts: record(raw.parts), sections: record(raw.sections) };
  } catch { return emptyState(); }
}
export const serializeState = (s: CollapseState): string => JSON.stringify({ v: 1, ...s });

export const isCategoryOpen = (s: CollapseState, id: string): boolean => s.categories[id] ?? DEFAULT_OPEN_CATEGORIES.includes(id);
/** A part is open unless the artist closed it. */
export const isPartOpen = (s: CollapseState, id: string): boolean => s.parts[id] ?? true;

const PART_NAMES: Record<string, string> = {
  navigation: 'Navigation / focus', 'camera-panel': 'Camera & depth of field', 'camera-flight': 'Camera paths', 'atlas-panel': 'Discovery atlas', chain: 'Formula chain', random: 'Random & MB3D import', formulas: 'My fractals',
  primitives: 'Scene objects', 'fractal-displacement': 'Displacement on the fractal', cutout: 'Cuts & cut-out', color: 'Colour & gradient', material: 'Material & textures', lights: 'Lights', fog: 'Fog', environment: 'Environment (HDRI)',
  still: 'Still picture & quality', details: 'Render details', format: 'Format', animation: 'Animation', render: 'Film rendering', mesh: 'Export 3D content',
};
const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

export interface CategoryInput { id: string; label: string; hosts: HTMLElement[] }

export class SettingsCollapse {
  state: CollapseState;
  private readonly categories = new Map<string, HTMLElement>();
  private readonly hostToPart = new Map<HTMLElement, { id: string; bar: HTMLButtonElement }>();

  constructor(private readonly controls: HTMLElement, private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
    let saved: string | null = null;
    try { saved = storage?.getItem(COLLAPSE_STORAGE_KEY) ?? null; } catch { saved = null; }
    this.state = parseState(saved);
    // `toggle` does not bubble, so listen while it travels down: this remembers sections opened or closed by hand.
    controls.addEventListener('toggle', (e) => { const d = e.target; if (d instanceof HTMLDetailsElement) this.rememberSection(d); }, true);
  }

  private save(): void { try { this.storage?.setItem(COLLAPSE_STORAGE_KEY, serializeState(this.state)); } catch { /* local storage may be unavailable: the choice then only lasts for this run */ } }

  /** Builds the headings and bodies for the categories and returns them in order. Existing nodes are moved, never copied. */
  build(groups: readonly CategoryInput[]): DocumentFragment {
    const fragment = document.createDocumentFragment();
    for (const g of groups) {
      const section = document.createElement('section');
      section.className = 'settings-category'; section.dataset.group = g.id;
      const heading = document.createElement('h2');
      heading.className = 'settings-group'; heading.id = `settings-group-${g.id}`; heading.tabIndex = -1;
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'settings-group-toggle'; toggle.dataset.settingsChrome = '';
      toggle.textContent = g.label; // the arrow is drawn by CSS so the heading's text stays exactly the category name
      toggle.setAttribute('aria-controls', `settings-body-${g.id}`);
      toggle.title = `Show or hide ${g.label}`;
      const count = document.createElement('small'); count.className = 'settings-group-count';
      const tools = document.createElement('span'); tools.className = 'settings-group-tools';
      const openAll = this.chrome('Open all parts', `Open all parts in ${g.label}`, () => this.setParts(g.id, true));
      const closeAll = this.chrome('Close all parts', `Close all parts in ${g.label}`, () => this.setParts(g.id, false));
      tools.append(openAll, closeAll);
      heading.append(toggle);
      const row = document.createElement('div');
      row.className = 'settings-group-row';
      row.append(heading, count, tools);
      const body = document.createElement('div');
      body.className = 'settings-group-body'; body.id = `settings-body-${g.id}`;
      for (const host of g.hosts) {
        if (!(host instanceof HTMLDetailsElement)) body.append(this.partBar(host));
        body.append(host);
      }
      count.textContent = `${body.querySelectorAll('input, select, textarea, button:not([data-settings-chrome])').length} controls`;
      section.append(row, body);
      toggle.onclick = () => this.setCategory(g.id, !isCategoryOpen(this.state, g.id));
      this.categories.set(g.id, section);
      fragment.append(section);
      this.paintCategory(g.id);
    }
    this.restoreSections();
    return fragment;
  }

  private chrome(text: string, label: string, click: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.title = label; b.setAttribute('aria-label', label); b.dataset.settingsChrome = ''; b.onclick = click;
    return b;
  }

  private partBar(host: HTMLElement): HTMLElement {
    const id = host.id || `part-${this.hostToPart.size}`;
    const wrap = document.createElement('div');
    wrap.className = 'settings-part-bar';
    const bar = document.createElement('button');
    bar.type = 'button'; bar.dataset.settingsChrome = ''; bar.dataset.part = id; bar.textContent = PART_NAMES[id] ?? (clean(host.querySelector('.ctitle, strong, h3, summary')?.textContent) || id);
    bar.title = `Show or hide the part ${bar.textContent}`;
    // Opening a part near the bottom of the sidebar used to look like nothing happened (the content opened below the visible area): bring the bar to the top, under the sticky search bar.
    wrap.style.scrollMarginTop = '170px';
    bar.onclick = () => { const open = !isPartOpen(this.state, id); this.setPart(id, open); if (open) requestAnimationFrame(() => wrap.scrollIntoView({ block: 'start', behavior: 'smooth' })); };
    wrap.append(bar);
    host.dataset.part = id;
    this.hostToPart.set(host, { id, bar });
    this.paintPart(host);
    return wrap;
  }

  private paintCategory(id: string): void {
    const section = this.categories.get(id); if (!section) return;
    const open = isCategoryOpen(this.state, id);
    section.classList.toggle('collapsed', !open);
    section.querySelector<HTMLButtonElement>('.settings-group-toggle')?.setAttribute('aria-expanded', String(open));
  }
  private paintPart(host: HTMLElement): void {
    const p = this.hostToPart.get(host); if (!p) return;
    const open = isPartOpen(this.state, p.id);
    host.classList.toggle('settings-part-collapsed', !open);
    p.bar.setAttribute('aria-expanded', String(open));
  }

  isCategoryOpen(id: string): boolean { return isCategoryOpen(this.state, id); }
  isPartOpen(id: string): boolean { return isPartOpen(this.state, id); }
  categoryIds(): string[] { return [...this.categories.keys()]; }

  setCategory(id: string, open: boolean): void { this.state.categories[id] = open; this.paintCategory(id); this.save(); }
  setAllCategories(open: boolean): void { for (const id of this.categories.keys()) { this.state.categories[id] = open; this.paintCategory(id); } this.save(); }
  setPart(partId: string, open: boolean): void { this.state.parts[partId] = open; for (const h of this.hostToPart.keys()) if (this.hostToPart.get(h)!.id === partId) this.paintPart(h); this.save(); }

  /** Opens or closes every part and every section inside one category (or in all categories). The category itself keeps its own state. */
  setParts(categoryId: string | null, open: boolean): void {
    for (const [id, section] of this.categories) {
      if (categoryId && id !== categoryId) continue;
      for (const host of section.querySelectorAll<HTMLElement>('.settings-group-body > [data-part]')) { const p = this.hostToPart.get(host); if (p) { this.state.parts[p.id] = open; this.paintPart(host); } }
      for (const d of section.querySelectorAll('details')) { d.open = open; this.rememberSection(d); }
      if (open) { this.state.categories[id] = true; this.paintCategory(id); }
    }
    this.save();
  }

  /** Opens everything around an element so that it can be seen (used by the settings search and the category chips). */
  reveal(el: HTMLElement): void {
    const section = el.closest<HTMLElement>('.settings-category');
    if (section?.dataset.group) { this.state.categories[section.dataset.group] = true; this.paintCategory(section.dataset.group); }
    const host = el.closest<HTMLElement>('[data-part]');
    if (host && host.dataset.part) { this.state.parts[host.dataset.part] = true; this.paintPart(host); }
    for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n instanceof HTMLDetailsElement && !n.open) n.open = true;
    this.save();
  }

  private sectionKey(d: HTMLDetailsElement): string | null {
    const label = clean(d.querySelector(':scope > summary')?.textContent);
    if (!label) return null;
    const host = d.closest<HTMLElement>('[data-part]');
    return `${host?.dataset.part ?? ''}/${label}`.slice(0, 190);
  }
  private rememberSection(d: HTMLDetailsElement): void { const k = this.sectionKey(d); if (k) { this.state.sections[k] = d.open; this.save(); } }
  /** Sections the artist opened or closed last time keep that state. */
  restoreSections(): void {
    for (const d of this.controls.querySelectorAll('details')) { const k = this.sectionKey(d); if (k && k in this.state.sections) d.open = this.state.sections[k]!; }
  }
}
