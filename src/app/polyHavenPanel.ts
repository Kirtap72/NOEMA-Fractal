/**
 * The "Poly Haven" tab of the material library: browse the public CC0 texture catalogue without any AI or account, see what a material
 * looks like and which maps it really has, download it on demand, and put it in "My materials" (where the existing try / apply flow takes over).
 * All network work happens in the main process (desktop/polyHaven.cjs); this panel only asks for validated operations and draws the answers.
 */
import type { MaterialStore } from './materialStore';
import { importPolyHavenMaterial } from './polyHavenImport';

type Call = (operation: string, ...args: unknown[]) => Promise<any>;
interface Item { id: string; name: string; categories: string[]; authors: string[]; maxResolution: number | null; downloaded: string[] }
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const PAGE = 24;

export class PolyHavenPanel {
  readonly root = el('div', undefined, 'polyhaven-panel');
  private search = el('input'); private category = el('select'); private res = el('select');
  private grid = el('div', undefined, 'polyhaven-grid'); private detail = el('div', undefined, 'polyhaven-detail'); private status = el('output', undefined, 'polyhaven-status');
  private more = el('button', 'Show more'); private count = el('small');
  private offset = 0; private total = 0; private loaded = false; private generation = 0; private selected: string | undefined; private busy = false;
  private off: (() => void) | undefined;

  constructor(private call: Call, private store: Pick<MaterialStore, 'put'>, private onImported: (id: string) => void, onProgress?: (cb: (p: { id: string; step: number; steps: number; channel?: string }) => void) => () => void) {
    this.root.hidden = true;
    this.search.type = 'search'; this.search.placeholder = 'Search Poly Haven (for example rock, bronze, moss)'; this.search.setAttribute('aria-label', 'Search among the materials of Poly Haven');
    this.category.setAttribute('aria-label', 'Category'); this.category.add(new Option('All categories', ''));
    for (const r of ['1k', '2k', '4k']) this.res.add(new Option(r === '1k' ? '1k (fast, recommended)' : r === '2k' ? '2k (larger)' : '4k (very large)', r));
    this.res.setAttribute('aria-label', 'Resolution to fetch'); this.res.title = 'Higher resolution gives larger files and more graphics memory. 1k is enough for most fractals.';
    let timer: number | undefined;
    this.search.oninput = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void this.reload(), 300); };
    this.category.onchange = () => void this.reload(); this.res.onchange = () => { if (this.selected) void this.show(this.selected); };
    this.more.type = 'button'; this.more.onclick = () => void this.load(true);
    const bar = el('div', undefined, 'polyhaven-bar'); bar.append(this.search, this.category, this.res);
    const credit = el('small', 'Powered by Poly Haven · all materials are CC0 (free to use) · polyhaven.com', 'polyhaven-credit');
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.root.append(bar, this.count, this.grid, this.more, this.detail, this.status, credit);
    this.off = onProgress?.((p) => { this.status.textContent = `Fetching ${p.channel ? this.channelName(p.channel) : 'material'}… (${Math.min(p.step + 1, p.steps)} of ${p.steps})`; });
  }
  private channelName(c: string): string { return ({ baseColor: 'colour map', roughness: 'roughness map', metallic: 'metal map', ao: 'occlusion map', normal: 'normal map' } as Record<string, string>)[c] ?? c; }
  dispose(): void { this.off?.(); }

  activate(): void { this.root.hidden = false; if (!this.loaded) void this.reload(); }
  deactivate(): void { this.root.hidden = true; this.generation++; }

  private async reload(): Promise<void> { this.offset = 0; this.grid.replaceChildren(); await this.load(false); }
  private async load(append: boolean): Promise<void> {
    const generation = ++this.generation;
    this.status.textContent = 'Fetching the catalogue…';
    try {
      const r = await this.call('page', { query: this.search.value, category: this.category.value, offset: this.offset, limit: PAGE });
      if (generation !== this.generation) return;
      this.loaded = true; this.total = r.total;
      if (this.category.options.length <= 1) for (const c of r.categories ?? []) this.category.add(new Option(c, c));
      for (const item of r.items as Item[]) this.grid.append(this.card(item));
      this.offset += r.items.length;
      this.more.hidden = this.offset >= this.total;
      this.count.textContent = `${this.offset} of ${this.total} materials${r.offline ? ' (offline: saved catalogue)' : ''}`;
      this.status.textContent = r.note ?? (this.total ? '' : 'No materials match the search.');
    } catch (e) { if (generation === this.generation) { this.status.textContent = this.message(e); this.more.hidden = true; } }
    void append;
  }
  private message(e: unknown): string { return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '').slice(0, 300); }

  private card(item: Item): HTMLElement {
    const b = el('button', undefined, 'polyhaven-card'); b.type = 'button'; b.dataset.id = item.id;
    const img = el('img'); img.alt = ''; img.width = 96; img.height = 96; img.loading = 'lazy';
    const name = el('span', item.name, 'polyhaven-name');
    const info = el('small', `${item.authors.join(', ') || 'Poly Haven'}${item.maxResolution ? ' · up to ' + Math.round(item.maxResolution / 1024) + 'k' : ''}${item.downloaded.length ? ' · ✓ fetched ' + item.downloaded.join('/') : ''}`);
    b.append(img, name, info);
    b.onclick = () => void this.show(item.id);
    void this.call('thumbnail', item.id).then((src: string) => { if (b.isConnected) img.src = src; }, () => { img.alt = 'preview missing'; });
    return b;
  }

  /** What the material has, in the chosen resolution, before anything is downloaded. */
  private async show(id: string): Promise<void> {
    this.selected = id; this.detail.replaceChildren(el('small', 'Reading the material…'));
    try {
      const d = await this.call('details', id);
      if (this.selected !== id) return;
      const res = this.res.value;
      const have = (c: string): { bytes: number | null } | undefined => (d.channels[c] as { resolution: string; bytes: number | null }[]).find((x) => x.resolution === res);
      const rows: [string, string, string][] = [['baseColor', 'Colour', 'blandas i gradienter'], ['roughness', 'Roughness', 'blandas i gradienter'], ['metallic', 'Metal', 'blandas i gradienter'], ['ao', 'Ocklusion', 'blandas i gradienter'], ['normal', 'Normal', 'fetched but turned off; not blended in gradients']];
      const big = el('img', undefined, 'polyhaven-preview'); big.alt = `Preview of ${d.name}`;
      void this.call('thumbnail', id).then((src: string) => { if (this.selected === id) big.src = src; }, () => undefined);
      const list = el('ul', undefined, 'polyhaven-channels');
      let total = 0;
      for (const [c, label, note] of rows) { const h = have(c); if (h?.bytes) total += h.bytes; list.append(el('li', `${label}: ${h ? `available (${h.bytes ? (h.bytes / 1048576).toFixed(1) + ' MB' : 'unknown size'}) – ${note}` : 'is not available in ' + res}`)); }
      list.append(el('li', `Displacement: ${d.channels.displacement.length ? 'exists at Poly Haven but is not imported' : 'does not exist'}`));
      const credit = el('small', `${d.name} · ${d.authors.map((a: { name: string }) => a.name).join(', ')} · ${d.license} · ${d.url}`);
      const downloaded = (d.cached as string[]).includes(res);
      const getButton = el('button', downloaded ? 'Put in My materials (offline, already fetched)' : `Fetch ${res} and put in My materials (about ${(total / 1048576).toFixed(1)} MB)`); getButton.type = 'button';
      getButton.disabled = !have('baseColor') || this.busy; getButton.title = have('baseColor') ? '' : `The material lacks a colour map in ${res}`;
      getButton.onclick = () => void this.import(d, res);
      this.detail.replaceChildren(el('strong', d.name), big, list, credit, getButton, ...(downloaded ? [this.removeButton(id, res)] : []));
    } catch (e) { this.detail.replaceChildren(); this.status.textContent = this.message(e); }
  }
  private removeButton(id: string, res: string): HTMLButtonElement {
    const b = el('button', 'Remove from the cache'); b.type = 'button'; b.title = 'Deletes the fetched files. Materials already in My materials remain.';
    b.onclick = () => void this.call('remove', id, res).then(() => { this.status.textContent = 'Removed from the cache.'; void this.show(id); }, (e) => { this.status.textContent = this.message(e); });
    return b;
  }

  private async import(d: { id: string; name: string }, res: string): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.root.setAttribute('aria-busy', 'true');
    try {
      this.status.textContent = 'Fetching…';
      const imported = await importPolyHavenMaterial(this.call, this.store, d.id, res);
      this.status.textContent = `${imported.meta.name} is fetched and now lies in My materials. ${imported.status.filter((s) => s.state !== 'active').map((s) => `${s.label}: ${s.state}`).join(' · ')}`;
      this.onImported(imported.materialId);
    } catch (e) { this.status.textContent = this.message(e); }
    this.busy = false; this.root.removeAttribute('aria-busy');
    if (this.selected) void this.show(this.selected);
  }
}
