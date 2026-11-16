import type { Gradient } from '../engine/gradient';
import { choiceIsCurrent, colorStop, deleteStop, editableGradient, gradientCssOf, GradientPresets, insertStop, moveStop, setSoftness, setStopKind, setStopMaterial, setTextureScale, setTransition, stopKind } from './gradientEditing';
import { MAX_TEXTURED_MATERIALS, stopImageMaps, texturedEntries } from '../engine/materialRamp';
import type { SceneBaseline } from './gradientEditing';
import type { MaterialSource } from './materialGradientSource';
import type { MaterialRecord } from '../engine/materialPresets';

/** The scene's one-step history, shared with presets, Looks and imports: choosing a material is one reversible transaction. */
export interface GradientHistory { edit(g: Gradient): void; undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean }

/** Edits embedded scene data; preset deletion never removes the scene's colors. */
export class GradientEditor {
  private gradient!: Gradient;
  private selected = 0;
  private track = document.createElement('div');
  private color = document.createElement('input');
  private hex = document.createElement('input');
  private position = document.createElement('input');
  private name = document.createElement('input');
  private remove = document.createElement('button');
  private rename = document.createElement('button');
  private erase = document.createElement('button');
  private note = document.createElement('small');
  // MATERIAL-GRADIENT-01
  private kind = document.createElement('select');
  private material = document.createElement('select');
  private transition = document.createElement('input');
  private transitionOut = document.createElement('output');
  // MATERIAL-GRADIENT-02
  private softness = document.createElement('input');
  private softnessOut = document.createElement('output');
  private softnessReset = document.createElement('button');
  private textureScale = document.createElement('input');
  private scaleLabel = document.createElement('label');
  private materialInfo = document.createElement('small');
  private undoButton = document.createElement('button');
  private redoButton = document.createElement('button');
  private request = 0;
  /** ARTIST-UI-FIX-01: where the Material Browser's "Choose from the material library…" button is mounted. */
  private pickRoot = document.createElement('span');
  private neutralize = document.createElement('button');
  private dragging = false;
  private trackKey = '';
  /** ARTIST-WORKFLOW 05: the part of the gradient a clicked surface uses (stops with their share, and the position), or null. */
  private hit: { stops: { index: number; weight: number }[]; position: number } | null = null;
  presets: GradientPresets | null = null;
  constructor(root: HTMLElement, private change: (g: Gradient) => void, private refreshPresets: () => void, private hold: (active: boolean) => void = () => {}, private materials?: MaterialSource, private baseline: () => SceneBaseline = () => ({ metallic: 0, roughness: 1, reflectivity: 0 }), private history?: GradientHistory) {
    root.classList.add('gradient-editor');
    try { this.presets = new GradientPresets(localStorage); } catch (err) { this.note.textContent = 'Gradient library: ' + String(err); }
    this.track.className = 'gradient-track'; this.track.setAttribute('aria-label', 'Gradient: click for a colour stop');
    const fields = document.createElement('div'); fields.className = 'gradient-fields';
    this.color.type = 'color'; this.color.setAttribute('aria-label', 'Colour stop colour');
    this.hex.type = 'text'; this.hex.setAttribute('aria-label', 'Colour stop colour hex'); this.hex.size = 8; this.hex.style.width = '5rem'; this.hex.maxLength = 7;
    this.position.type = 'number'; this.position.min = '0'; this.position.max = '100'; this.position.step = 'any'; this.position.setAttribute('aria-label', 'Colour stop position percent');
    this.remove.textContent = 'Remove colour stop';
    fields.append(this.color, this.hex, this.position, document.createTextNode('%'), this.remove);
    const saved = document.createElement('div'); saved.className = 'gradient-fields';
    this.name.type = 'text'; this.name.placeholder = 'Gradient name'; this.name.setAttribute('aria-label', 'Gradient name');
    const save = document.createElement('button'); save.textContent = 'Save gradient as preset';
    this.rename.textContent = 'Rename'; this.erase.textContent = 'Delete own preset';
    saved.append(this.name, save, this.rename, this.erase);
    // ---- MATERIAL-GRADIENT-01: the stop is a Colour or a Material; one slider for the width of the blend towards the next stop.
    const ramp = document.createElement('div'); ramp.className = 'gradient-fields material-gradient';
    this.kind.setAttribute('aria-label', 'Material gradient: stop type (Colour or Material)'); this.kind.title = 'Material gradient: let the chosen stop be a colour or a material (metal, roughness, reflectivity, tone)';
    this.kind.add(new Option('Colour', 'color')); this.kind.add(new Option('Material', 'material'));
    this.material.setAttribute('aria-label', 'Material gradient: choose a material for the stop'); this.material.title = 'Material gradient: choose a built-in or saved material for the chosen stop';
    this.material.add(new Option('Choose material…', ''));
    this.transition.type = 'range'; this.transition.min = '0'; this.transition.max = '100'; this.transition.step = '1'; this.transition.value = '100';
    this.transition.setAttribute('aria-label', 'Material gradient: transition width towards the next stop'); this.transition.title = 'Material gradient: transition width. 100 % blends over the whole interval, less concentrates the blend around the middle, 0 % is a hard limit';
    this.transitionOut.textContent = '100 %'; this.materialInfo.className = 'material-gradient-info';
    const kindLabel = document.createElement('label'); kindLabel.append('Stop type ', this.kind);
    const widthLabel = document.createElement('label'); widthLabel.append('Transition width ', this.transition, ' ', this.transitionOut);
    this.undoButton.type = 'button'; this.undoButton.textContent = 'Undo'; this.undoButton.title = 'Undo the latest material choice (also applies to presets, Looks and import: the app has a single undo step)'; this.undoButton.setAttribute('aria-label', 'Material gradient: undo the latest material choice');
    this.redoButton.type = 'button'; this.redoButton.textContent = 'Redo'; this.redoButton.title = 'Redo the undone material choice'; this.redoButton.setAttribute('aria-label', 'Material gradient: redo material choice');
    this.undoButton.onclick = () => this.history?.undo(); this.redoButton.onclick = () => this.history?.redo();
    // MG-02: softness of the band edges (crisp ramp to smooth step) and the texture scale of the stop's material. Both live in the same row of controls.
    this.softness.type = 'range'; this.softness.min = '0'; this.softness.max = '100'; this.softness.step = '1'; this.softness.value = '100';
    this.softness.setAttribute('aria-label', 'Material gradient: softness of the transition'); this.softness.title = 'Material gradient: softness. 0 % is a straight, clear transition, 100 % a soft S-curve. Without a value of its own the old blending applies.';
    this.softnessOut.textContent = '100 %'; this.softnessReset.type = 'button'; this.softnessReset.textContent = 'Default'; this.softnessReset.title = 'Remove the softness and go back to the ordinary blending';
    this.softnessReset.setAttribute('aria-label', 'Material gradient: default softness');
    const softLabel = document.createElement('label'); softLabel.append('Softness ', this.softness, ' ', this.softnessOut, ' ', this.softnessReset);
    this.textureScale.type = 'number'; this.textureScale.min = '0.001'; this.textureScale.max = '100000'; this.textureScale.step = 'any'; this.textureScale.style.width = '6rem';
    this.textureScale.setAttribute('aria-label', 'Material gradient: texture scale for the material of the stop'); this.textureScale.title = 'Material gradient: how many times the picture maps of the material repeat per unit. All maps in the material share the scale, so they stay aligned.';
    this.scaleLabel.append('Texture scale ', this.textureScale, ' ×');
    this.pickRoot.className = 'material-gradient-pick';
    this.neutralize.type = 'button'; this.neutralize.textContent = 'Make the colour of the stop white'; this.neutralize.hidden = true;
    this.neutralize.title = 'The colour map of the material is multiplied by the colour of the stop. White lets the colours of the map show.'; this.neutralize.setAttribute('aria-label', 'Material gradient: make the colour of the stop white so that the colours of the material show');
    this.neutralize.onclick = () => error(() => { const next = colorStop(this.gradient, this.selected, '#ffffff'); if (this.history) this.history.edit(next); else this.change(next); });
    ramp.append(kindLabel, this.pickRoot, this.neutralize, this.material, widthLabel, softLabel, this.scaleLabel);
    if (this.history) ramp.append(this.undoButton, this.redoButton);
    root.append(this.track, fields, ramp, this.materialInfo, saved, this.note);
    const error = (fn: () => void): void => { try { fn(); this.note.textContent = ''; } catch(err) { this.note.textContent = err instanceof Error ? err.message : String(err); } };
    this.color.oninput = () => error(() => this.change(colorStop(this.gradient, this.selected, this.color.value)));
    this.hex.oninput = () => { const value = this.hex.value.trim(); const valid = /^#[0-9a-fA-F]{6}$/.test(value); this.hex.setCustomValidity(valid ? '' : 'Enter #rrggbb.'); if (valid) error(() => this.change(colorStop(this.gradient, this.selected, value.toLowerCase()))); };
    this.position.oninput = () => { const n = this.position.value === '' ? NaN : Number(this.position.value); if (!Number.isFinite(n) || n < 0 || n > 100) { this.position.setCustomValidity('Enter 0–100 %.'); return; } this.position.setCustomValidity(''); error(() => { const next = moveStop(this.gradient, this.selected, n / 100); this.selected = next.selected; this.change(next.gradient); }); };
    this.remove.onclick = () => error(() => { const next = deleteStop(this.gradient, this.selected); this.selected = Math.min(this.selected, editableGradient(next).stops.length-1); this.change(next); });
    save.onclick = () => error(() => { if (!this.presets) throw Error('Local storage is not available. The scene file keeps the gradient.'); const g = this.presets.save(this.gradient, this.name.value); this.refreshPresets(); this.change(g); });
    this.rename.onclick = () => error(() => { if (!this.presets || !this.gradient.id) return; this.presets.rename(this.gradient.id, this.name.value); const g = this.presets.gradients.find(g=>g.id===this.gradient.id)!; this.refreshPresets(); this.change(structuredClone(g)); });
    this.erase.onclick = () => error(() => { if (!this.presets || !this.gradient.id) return; this.presets.delete(this.gradient.id); this.refreshPresets(); this.change({ name: this.gradient.name, stops: structuredClone(this.gradient.stops) }); });
    this.kind.onchange = () => error(() => this.change(setStopKind(this.gradient, this.selected, this.kind.value as 'color' | 'material')));
    this.transition.oninput = () => error(() => { const w = Number(this.transition.value) / 100; this.transitionOut.textContent = `${Math.round(w * 100)} %`; this.change(setTransition(this.gradient, this.selected, w)); });
    this.softness.oninput = () => error(() => { const v = Number(this.softness.value) / 100; this.softnessOut.textContent = `${Math.round(v * 100)} %`; this.change(setSoftness(this.gradient, this.selected, v)); });
    this.softnessReset.onclick = () => error(() => this.change(setSoftness(this.gradient, this.selected, undefined)));
    this.textureScale.oninput = () => { const v = this.textureScale.value === '' ? NaN : Number(this.textureScale.value); if (!Number.isFinite(v)) return; error(() => this.change(setTextureScale(this.gradient, this.selected, v))); };
    this.material.onchange = () => {
      const id = this.material.value; if (!id || !this.materials) return;
      // The material may come from a store that answers later. Apply it only if the same stop of the same gradient is still selected.
      const token = ++this.request, stopId = this.gradient.stops[this.selected]?.id, gradient = this.gradient;
      this.materials.snapshot(id).then(snapshot => {
        if (!choiceIsCurrent({ gradient, stopId, token }, { gradient: this.gradient, selectedStopId: this.gradient.stops[this.selected]?.id, token: this.request })) return;
        error(() => { if (!snapshot) throw Error('The material no longer exists.'); const next = setStopMaterial(this.gradient, this.selected, snapshot); if (this.history) this.history.edit(next); else this.change(next); });
      }, err => { if (token === this.request) this.note.textContent = err instanceof Error ? err.message : String(err); });
    };
    const at = (e: PointerEvent): number => { const r = this.track.getBoundingClientRect(); return Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)); };
    this.track.onpointerdown = e => {
      if (e.button !== 0) return;
      const stop = (e.target as HTMLElement).closest<HTMLElement>('[data-stop]');
      if (stop) { this.selected = Number(stop.dataset.stop); this.update(this.gradient); this.dragging = this.selected > 0 && this.selected < this.gradient.stops.length - 1; }
      else error(() => { const next = insertStop(this.gradient, at(e), this.baseline()); this.selected = next.selected; this.change(next.gradient); this.dragging = true; });
      if (this.dragging) { this.track.setPointerCapture(e.pointerId); this.hold(true); }
      e.preventDefault();
    };
    this.track.onpointermove = e => { if (!this.dragging) return; error(() => { const next = moveStop(this.gradient, this.selected, at(e)); this.selected = next.selected; this.change(next.gradient); }); };
    const end = (): void => { if (this.dragging) { this.dragging = false; this.hold(false); } };
    this.track.onpointerup = end; this.track.onpointercancel = end; this.track.onlostpointercapture = end; window.addEventListener('blur', end);
  }
  /** Marks the stops that make the colour of a clicked surface and the position on the track (null removes the marks). The gradient itself is not changed. */
  setHit(hit: { stops: { index: number; weight: number }[]; position: number } | null): void {
    this.hit = hit;
    if (this.gradient) this.update(this.gradient);
  }
  update(gradient: Gradient): void {
    this.gradient = editableGradient(gradient); this.selected = Math.min(this.selected, this.gradient.stops.length-1);
    const key = JSON.stringify([this.gradient.stops, this.selected, this.hit]);
    if (key !== this.trackKey) {
      this.trackKey = key;
      this.track.style.background = gradientCssOf(this.gradient);
      this.track.replaceChildren(...this.gradient.stops.map((s,i) => {
      const b = document.createElement('button'); b.className = 'gradient-stop' + (stopKind(s) === 'material' ? ' gradient-stop-material' : ''); b.dataset.stop = String(i); b.style.left = `${s.position*100}%`; b.style.background = s.color; b.setAttribute('aria-label', `${stopKind(s) === 'material' ? 'Material stop' : 'Colour stop'} ${i+1}: ${s.position*100}%`); b.setAttribute('aria-pressed', String(i===this.selected));
      const share = this.hit?.stops.find(h => h.index === i);
      if (share) { b.classList.add('gradient-stop-hit'); b.dataset.hit = String(Math.round(share.weight * 100)); b.title = `Touched by the surface you chose: ${Math.round(share.weight * 100)} % of the colour`; }
      b.onclick = () => { this.selected = i; this.update(this.gradient); this.color.focus(); };
      b.onkeydown = e => { if ((e.key==='ArrowLeft'||e.key==='ArrowRight') && i>0 && i<this.gradient.stops.length-1) { e.preventDefault(); const next=moveStop(this.gradient,i,s.position+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?0.001:0.01)); this.selected=next.selected; this.change(next.gradient); (this.track.querySelector(`[data-stop="${this.selected}"]`) as HTMLElement)?.focus(); } };
      return b;
      }));
      if (this.hit) { const m = document.createElement('div'); m.className = 'gradient-hit-marker'; m.dataset.gradientHit = ''; m.style.left = `${this.hit.position * 100}%`; m.title = `The surface you chose lies here on the gradient (${Math.round(this.hit.position * 100)} %)`; this.track.append(m); }
    }
    const s = this.gradient.stops[this.selected]!;
    if (document.activeElement !== this.color) this.color.value = s.color;
    if (document.activeElement !== this.hex) { this.hex.value = s.color; this.hex.setCustomValidity(''); }
    if (document.activeElement !== this.position) this.position.value = String(s.position*100);
    this.position.disabled = this.remove.disabled = this.selected===0 || this.selected===this.gradient.stops.length-1;
    this.request++; // a pending material choice belongs to the previous gradient or selection
    if (document.activeElement !== this.material) this.material.value = '';
    this.kind.value = stopKind(s);
    this.kind.querySelector<HTMLOptionElement>('option[value=material]')!.disabled = !s.material;
    const last = this.selected === this.gradient.stops.length - 1;
    this.transition.disabled = last;
    if (document.activeElement !== this.transition) { const w = Math.round((s.transition ?? 1) * 100); this.transition.value = String(w); this.transitionOut.textContent = `${w} %`; }
    this.softness.disabled = last; this.softnessReset.disabled = last || s.softness === undefined;
    if (document.activeElement !== this.softness) { const v = Math.round((s.softness ?? ((s.transition ?? 1) < 1 ? 1 : 0)) * 100); this.softness.value = String(v); this.softnessOut.textContent = s.softness === undefined ? `${v} % (standard)` : `${v} %`; }
    const textured = !!s.material && stopImageMaps(s.material).length > 0;
    this.scaleLabel.hidden = !textured;
    if (textured && document.activeElement !== this.textureScale) this.textureScale.value = String(s.material!.textureScale ?? 1);
    this.describeMaterial(s);
    this.neutralize.hidden = !(textured && s.material!.active && stopImageMaps(s.material!).some(x => x.channel === 'baseColor') && !/^#(?:[e-f][0-9a-f]){3}$/i.test(s.color));
    if (this.history) { this.undoButton.disabled = !this.history.canUndo(); this.redoButton.disabled = !this.history.canRedo(); }
    const saved = this.presets?.gradients.find(g=>g.id===gradient.id);
    this.rename.disabled = this.erase.disabled = !saved;
    if (saved && document.activeElement !== this.name) this.name.value = saved.name ?? '';
  }
  /** What the selected stop contributes, and, in plain words, what the V1 material blend does NOT carry over. */
  private describeMaterial(s: ReturnType<typeof editableGradient>['stops'][number]): void {
    const m = s.material;
    if (!m) { this.materialInfo.textContent = 'Colour stop. Choose a material to blend metal, roughness, reflectivity and tone along the gradient.'; return; }
    const pct = (v: number): string => Math.round(v * 100) + ' %';
    const base = `${m.active ? 'Material stop' : 'Colour stop (material saved but off)'}: ${m.name ?? 'material'} – metal ${pct(m.metallic)}, roughness ${pct(m.roughness)}, reflectivity ${pct(m.reflectivity)}.`;
    const not = m.notBlended?.length ? ` Not blended: ${m.notBlended.join(', ')}.` : '';
    const names: Record<string, string> = { baseColor: 'colour', roughness: 'roughness', metallic: 'metal', ao: 'ocklusion' };
    const maps = stopImageMaps(m);
    const used = texturedEntries(this.gradient.stops).length;
    const tex = maps.length ? ` Picture maps that are blended: ${maps.map(x => names[x.channel]).join(', ')} (scale ${m.textureScale ?? 1} ×, shared by all maps). Textured materials in the gradient: ${used} of ${MAX_TEXTURED_MATERIALS}.` : '';
    const colourMap = maps.some(x => x.channel === 'baseColor');
    const tint = colourMap ? ` The colour map is multiplied by the colour of the stop itself (${s.color}): if it is dark or coloured the colours of the material become weak. The button "Make the colour of the stop white" releases it.` : '';
    this.materialInfo.textContent = base + tex + tint + not + ' The material transition is sharpest at about 3 % of the gradient.';
  }
  /**
   * Mounts the full material library (built-in, saved, Poly Haven) as a chooser for the selected stop. `make` builds the library's own
   * browser inside `root`; the chosen record comes back to `applyRecord`. The short list below stays as a quick way to reach built-in materials.
   */
  mountLibraryPicker(make: (root: HTMLElement, onPick: (record: MaterialRecord) => void, onOpen: () => void) => void): void {
    make(this.pickRoot, (record) => this.applyRecord(record), () => this.loadMaterials());
  }

  /** Puts a complete material from the library into the selected stop: one undoable step, with a clear message if it cannot. */
  applyRecord(record: MaterialRecord): void {
    if (!this.materials) return;
    const token = ++this.request, stopId = this.gradient.stops[this.selected]?.id, gradient = this.gradient;
    try {
      const snapshot = this.materials.snapshotRecord(record);
      if (!choiceIsCurrent({ gradient, stopId, token }, { gradient: this.gradient, selectedStopId: this.gradient.stops[this.selected]?.id, token: this.request })) return;
      const next = setStopMaterial(this.gradient, this.selected, snapshot);
      if (this.history) this.history.edit(next); else this.change(next);
      this.note.textContent = '';
      this.loadMaterials();
    } catch (err) { this.note.textContent = err instanceof Error ? err.message : String(err); }
  }

  /** Fills the material chooser once. A source that cannot be read only leaves the list short. */
  loadMaterials(): void {
    if (!this.materials) return;
    this.materials.list().then(list => {
      this.material.length = 1;
      for (const [group, title] of [['Built-in', 'Built-in'], ['Saved', 'Saved']] as const) {
        const items = list.filter(c => c.group === group); if (!items.length) continue;
        const og = document.createElement('optgroup'); og.label = title;
        for (const c of items) og.append(new Option(c.title, c.id));
        this.material.append(og);
      }
    }, () => { /* the list stays with only the placeholder */ });
  }
}
