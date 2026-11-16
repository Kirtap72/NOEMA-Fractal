import { gradientAt, MAX_GRADIENT_STOPS, readGradient } from '../engine/gradient';
import type { Gradient } from '../engine/gradient';
import { MAX_MATERIAL_STOPS, MAX_TEXTURED_MATERIALS, MAX_TEXTURE_SCALE, MIN_TEXTURE_SCALE, isTexturedStop, materialStopCount, rampActive, rampColorAt, rampScalarAt, rampTintAt, texturedEntries } from '../engine/materialRamp';
import type { RampScalar, StopMaterial } from '../engine/materialRamp';
export function editableGradient(gradient: Gradient): Gradient {
  const copy = structuredClone(gradient);
  if (copy.stops[0]!.position !== 0) copy.stops.unshift({ id:'stop-'+crypto.randomUUID(),position: 0, color: copy.stops[0]!.color });
  if (copy.stops.at(-1)!.position !== 1) copy.stops.push({ id:'stop-'+crypto.randomUUID(),position: 1, color: copy.stops.at(-1)!.color });
  return copy;
}
function custom(g: Gradient): Gradient { return { name: 'Egen gradient', stops: structuredClone(g.stops) }; }
function checked(g: Gradient): Gradient {
  // A maximum-sized external gradient may have implicit endpoints. Omitting a same-color
  // endpoint preserves interpolation exactly; the editor still displays that endpoint.
  if (g.stops.length > MAX_GRADIENT_STOPS && g.stops[0]!.color === g.stops[1]!.color) g.stops.shift();
  if (g.stops.length > MAX_GRADIENT_STOPS && g.stops.at(-1)!.color === g.stops.at(-2)!.color) g.stops.pop();
  const errors: string[] = []; if (!readGradient(g, 'gradient', errors)) throw Error(errors.join('; ')); return g;
}
export interface SceneBaseline { metallic: number; roughness: number; reflectivity: number }
const NEUTRAL_BASELINE: SceneBaseline = { metallic: 0, roughness: 1, reflectivity: 0 };
export function insertStop(g: Gradient, position: number, baseline: SceneBaseline = NEUTRAL_BASELINE): { gradient: Gradient; selected: number } {
  const copy = custom(editableGradient(g));
  if (copy.stops.length >= MAX_GRADIENT_STOPS) throw Error(`At most ${MAX_GRADIENT_STOPS} colour stops.`);
  const p = Math.max(0, Math.min(1, position));
  const ramp = rampActive(copy.stops);
  const color = '#' + (ramp ? rampColorAt(copy.stops, p) : gradientAt(copy.stops, p)).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
  const selected = copy.stops.findIndex(s => s.position > p);
  const index = selected < 0 ? copy.stops.length - 1 : Math.max(1, selected);
  const stop: Gradient['stops'][number] = { id:'stop-'+crypto.randomUUID(),position: p, color };
  if (ramp) {
    // MATERIAL-GRADIENT-01: a new stop inside a ramp must not change how the ramp looks. Between two stops where one is a Material
    // stop the new stop takes the interpolated material (a Colour stop contributes the scene baseline); the blend width continues.
    const below = copy.stops[index - 1]!, above = copy.stops[index]!;
    if (below.transition !== undefined) stop.transition = below.transition;
    if (below.softness !== undefined) stop.softness = below.softness;
    if (below.material?.active || above.material?.active) {
      if (materialStopCount(copy.stops) >= MAX_MATERIAL_STOPS) throw Error(`At most ${MAX_MATERIAL_STOPS} material stops. Remove a material stop first.`);
      const at = (key: RampScalar): number => rampScalarAt(copy.stops, p, key, baseline[key]);
      // MG-02: textures cannot be interpolated by a third stop. Between textured stops the new stop takes the NEARER textured neighbour's
      // material exactly (same maps, same scale, same values); it does not use up another of the textured materials. The look near it changes slightly.
      const nearer = p - below.position <= above.position - p ? below : above;
      const textured = [nearer, nearer === below ? above : below].find(isTexturedStop);
      if (textured) { stop.material = { ...textured.material!, active: true }; copy.stops.splice(index, 0, stop); return { gradient: checked(copy), selected: index }; }
      const tint = rampTintAt(copy.stops, p);
      stop.material = { active: true, name: 'Intermediate value', metallic: at('metallic'), roughness: at('roughness'), reflectivity: at('reflectivity'),
        ...(tint[0] !== 1 || tint[1] !== 1 || tint[2] !== 1 ? { baseColor: tint } : {}) };
    }
  }
  copy.stops.splice(index, 0, stop); return { gradient: checked(copy), selected: index };
}
export function moveStop(g: Gradient, index: number, position: number): { gradient: Gradient; selected: number } {
  const copy = custom(editableGradient(g));
  if (index <= 0 || index >= copy.stops.length - 1) return { gradient: checked(copy), selected: index };
  const [stop] = copy.stops.splice(index, 1); stop!.position = Math.max(0, Math.min(1, position));
  // Stable order at coincident stops preserves deliberate hard transitions.
  let selected = copy.stops.findIndex(s => s.position > stop!.position);
  if (selected < 0) selected = copy.stops.length - 1;
  selected = Math.max(1, selected); copy.stops.splice(selected, 0, stop!);
  return { gradient: checked(copy), selected };
}
export function deleteStop(g: Gradient, index: number): Gradient {
  const copy = custom(editableGradient(g));
  if (index > 0 && index < copy.stops.length - 1) copy.stops.splice(index, 1);
  return checked(copy);
}
export function colorStop(g: Gradient, index: number, color: string): Gradient {
  const copy = custom(editableGradient(g)); copy.stops[index]!.color = color;
  return checked(copy);
}
/** 'material' only for a stop that is a Material stop right now. A Colour stop may still hold a (switched-off) snapshot. */
export const stopKind = (stop: Gradient['stops'][number]): 'color' | 'material' => (stop.material?.active ? 'material' : 'color');

/** Makes the stop a Material stop with this snapshot. The stop's own colour is kept untouched. */
export function setStopMaterial(g: Gradient, index: number, material: StopMaterial): Gradient {
  const copy = custom(editableGradient(g)); const stop = copy.stops[index];
  if (!stop) throw Error('Unknown colour stop.');
  if (stop.material === undefined && materialStopCount(copy.stops) >= MAX_MATERIAL_STOPS) throw Error(`At most ${MAX_MATERIAL_STOPS} material stops.`);
  stop.material = { ...structuredClone(material), active: true };
  const distinct = texturedEntries(copy.stops).length;
  if (distinct > MAX_TEXTURED_MATERIALS) throw Error(`At most ${MAX_TEXTURED_MATERIALS} different textured materials in a gradient (now ${distinct}). Replace one of them with a material without picture maps, or use the same material on several stops.`);
  return checked(copy);
}

/**
 * Switches a stop between Colour and Material. Colour -> Material needs a snapshot already on the stop (choose a material first);
 * Material -> Colour keeps the snapshot (switched off), so the change is reversible and nothing else is lost.
 */
export function setStopKind(g: Gradient, index: number, kind: 'color' | 'material'): Gradient {
  const copy = custom(editableGradient(g)); const stop = copy.stops[index];
  if (!stop) throw Error('Unknown colour stop.');
  if (kind === 'material') {
    if (!stop.material) throw Error('Choose a material for the stop first.');
    stop.material = { ...stop.material, active: true };
  } else if (stop.material) stop.material = { ...stop.material, active: false };
  return checked(copy);
}

/** Blend width (0 to 1) from this stop towards the next one. 1 removes the setting, which is exactly the old linear blend. */
export function setTransition(g: Gradient, index: number, width: number): Gradient {
  const copy = custom(editableGradient(g)); const stop = copy.stops[index];
  if (!stop || index >= copy.stops.length - 1) throw Error('Transition width belongs to a stop that has a next stop.');
  if (!Number.isFinite(width) || width < 0 || width > 1) throw Error('Transition width must be 0–100 %.');
  if (width === 1) delete stop.transition; else stop.transition = width;
  return checked(copy);
}
/**
 * MATERIAL-GRADIENT-02: how soft the edges of the blend towards the next stop are, 0 (a crisp, linear ramp) to 1 (a smooth step).
 * `undefined` removes the setting and gives back the old behaviour exactly.
 */
export function setSoftness(g: Gradient, index: number, softness: number | undefined): Gradient {
  const copy = custom(editableGradient(g)); const stop = copy.stops[index];
  if (!stop || index >= copy.stops.length - 1) throw Error('Softness belongs to a stop that has a next stop.');
  if (softness === undefined) delete stop.softness;
  else { if (!Number.isFinite(softness) || softness < 0 || softness > 1) throw Error('Softness must be 0–100 %.'); stop.softness = softness; }
  return checked(copy);
}

/** The texture scale (repetitions per unit) of a stop's material. All of its maps share it, so they stay aligned. */
export function setTextureScale(g: Gradient, index: number, scale: number): Gradient {
  const copy = custom(editableGradient(g)); const stop = copy.stops[index];
  if (!stop?.material || !stop.material.textures) throw Error('The material of the stop has no picture maps to scale.');
  if (!Number.isFinite(scale) || scale < MIN_TEXTURE_SCALE || scale > MAX_TEXTURE_SCALE) throw Error(`The texture scale must be ${MIN_TEXTURE_SCALE}–${MAX_TEXTURE_SCALE}.`);
  stop.material = { ...stop.material, textureScale: scale };
  return checked(copy);
}

export interface GradientStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const GRADIENT_STORAGE_KEY = 'fractal-user-gradients-v1';
/** Local user settings, just like scene presets. Writes are atomic from the editor's perspective. */
export class GradientPresets {
  gradients: Gradient[] = [];
  constructor(private storage: GradientStorage) {
    const stored = storage.getItem(GRADIENT_STORAGE_KEY); if (!stored) return;
    const raw: unknown = JSON.parse(stored);
    if (!Array.isArray(raw)) throw Error('Invalid gradient library.');
    this.gradients = raw.map(g => { const errors: string[] = []; const parsed = readGradient(g, 'user gradient', errors); if (!parsed || !parsed.id?.startsWith('user-')) throw Error('Invalid saved gradient.'); return parsed; });
    if (new Set(this.gradients.map(g=>g.id)).size !== this.gradients.length) throw Error('Duplicate gradient IDs.');
  }
  private write(next: Gradient[]): void { this.storage.setItem(GRADIENT_STORAGE_KEY, JSON.stringify(next)); this.gradients = next; }
  save(g: Gradient, name: string): Gradient {
    if (!name.trim()) throw Error('Enter a name.');
    const next = { ...checked(editableGradient(g)), id: 'user-' + crypto.randomUUID(), name: name.trim() };
    const errors: string[] = []; if (!readGradient(next, 'gradient', errors)) throw Error(errors.join('; '));
    this.write([...this.gradients, next]); return structuredClone(next);
  }
  rename(id: string, name: string): void { if (!name.trim()) throw Error('Enter a name.'); this.write(this.gradients.map(g => g.id === id ? { ...g, name: name.trim() } : g)); }
  delete(id: string): void { this.write(this.gradients.filter(g => g.id !== id)); }
}

/**
 * The CSS for a gradient preview. Without the Material Gradient fields it is exactly the old stop list; with them the colour at
 * 65 sample points is drawn, so a reduced transition width is visible in the bar.
 */
export function gradientCssOf(g: Gradient): string {
  if (!rampActive(g.stops)) return `linear-gradient(to right, ${g.stops.map(s => `${s.color} ${(s.position * 100).toFixed(1)}%`).join(', ')})`;
  const hex = (c: number): string => Math.round(c * 255).toString(16).padStart(2, '0');
  const points = Array.from({ length: 65 }, (_, i) => { const x = i / 64, c = rampColorAt(g.stops, x); return `#${hex(c[0])}${hex(c[1])}${hex(c[2])} ${(x * 100).toFixed(2)}%`; });
  return `linear-gradient(to right, ${points.join(', ')})`;
}

/**
 * A material chosen from a store that answers later may only be applied to the stop it was chosen for, in the gradient that was
 * shown at the time. After a scene switch, a stop deletion or a new selection the answer is dropped, never applied to something else.
 */
export function choiceIsCurrent(captured: { gradient: Gradient; stopId: string | undefined; token: number }, now: { gradient: Gradient; selectedStopId: string | undefined; token: number }): boolean {
  return captured.token === now.token && captured.gradient === now.gradient && captured.stopId !== undefined && captured.stopId === now.selectedStopId;
}
