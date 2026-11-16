import { createBoxFromView, readBoxCut, scaleBox, type BoxCut } from '../engine/boxCut';
import type { Scene } from '../engine/scene';
import { isNumericEditing, readNumber, setInputValue } from './numericRange';

export interface BoxCutControls {
  edit(change: (s: Scene) => Scene): void;
  view(): { scene: Scene; width: number; height: number };
  undo?(): void;
  canUndo?(): boolean;
}
export class BoxCutPanel {
  readonly root = document.createElement('fieldset');
  private scene!: Scene;
  private fields = new Map<string, HTMLInputElement>();
  private actions = new Map<string, HTMLButtonElement>();
  private status = document.createElement('p');
  private error = document.createElement('small');
  constructor(parent: HTMLElement, private controls: BoxCutControls) {
    this.root.id = 'box-cut';
    const legend = document.createElement('legend'); legend.textContent = 'Box Cut'; this.root.append(legend, this.status);
    const button = (name: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = action; this.actions.set(name, b); this.root.append(b); };
    const fit = () => { const v = controls.view(); return createBoxFromView(v.scene.camera, v.scene.render.fov_axis, Math.max(1,v.width), Math.max(1,v.height)); };
    button('Create a box from the current view', () => { if (!this.scene.cutout.box) this.apply(fit()); });
    this.input('Box Cut on', 'checkbox', b => ({ ...b, enabled: this.fields.get('Box Cut on')!.checked }));
    this.input('Show the outline of the box', 'checkbox', b => ({ ...b, outline: this.fields.get('Show the outline of the box')!.checked }));
    button('Fit the box to the current view', () => { if (this.scene.cutout.box) this.apply({ ...fit(), enabled: this.scene.cutout.box.enabled, outline: this.scene.cutout.box.outline }); });
    button('Reset the walls of the box', () => this.change(b => ({ ...b, min: [...b.resetMin], max: [...b.resetMax] })));
    button('Remove the box', () => controls.edit(s => { const { box: _box, ...cutout } = s.cutout; return { ...s, cutout }; }));
    if (controls.undo) button('Undo scene change (Box Cut)', () => controls.undo!());
    for (const [axis, name] of ['X','Y','Z'].entries()) this.input('Box position ' + name, 'number', b => ({ ...b, position: b.position.map((v,i) => i===axis?readNumber(this.fields.get('Box position '+name)!):v) as BoxCut['position'] }));
    for (const [axis, names] of [['left','right'],['bottom','top'],['front / near','back / far']].entries()) for (const [side,name] of names.entries()) {
      const key = side ? 'max' : 'min', label = 'Box wall ' + name;
      this.input(label, 'number', b => ({ ...b, [key]: b[key].map((v,i) => i===axis?readNumber(this.fields.get(label)!):v) }));
    }
    this.input('Box uniform scale factor', 'number'); this.fields.get('Box uniform scale factor')!.value = '1';
    button('Scale box', () => this.change(b => scaleBox(b, readNumber(this.fields.get('Box uniform scale factor')!))));
    const note = document.createElement('small'); note.textContent = 'No box is created automatically. The box stays in the world when the camera is moved. Front/near is the smallest local Z, back/far the largest. Yellow handles move a wall; the centre point moves the box. Shift fine-tunes, Esc cancels. The box and manual planes keep their common interior, without caps.';
    this.error.setAttribute('role','status'); this.root.append(this.error, note); parent.prepend(this.root);
  }
  private input(name: string, type: string, change?: (b: BoxCut) => BoxCut): void {
    const label = document.createElement('label'), f = document.createElement('input'); label.textContent = name; f.type = type; f.setAttribute('aria-label',name);
    if (type === 'number') { f.step = 'any'; f.style.width = '7rem'; }
    if (change) f.onchange = () => {
      if (type === 'number' && (!f.value.trim() || !Number.isFinite(readNumber(f)))) { this.error.textContent = 'Enter a finite number.'; return; }
      this.change(change);
    };
    this.fields.set(name,f); label.append(f); this.root.append(label);
  }
  private change(change: (b: BoxCut) => BoxCut): void { const b = this.scene.cutout.box; if (b) this.apply(change(b)); }
  private apply(value: BoxCut): void {
    const errors: string[] = [], box = readBoxCut(value,errors); this.error.textContent = errors.length ? 'Invalid box values: the walls must have positive thickness and be finite numbers.' : '';
    if (box) this.controls.edit(s => ({ ...s, cutout: { ...s.cutout, box } }));
  }
  update(scene: Scene): void {
    this.scene = scene; const b = scene.cutout.box;
    this.status.textContent = b ? (b.enabled ? 'On · fixed box in world space' : 'Off · the settings of the box are preserved') : 'Off · no box';
    for (const [name,button] of this.actions) button.disabled = name === 'Undo scene change (Box Cut)' ? !this.controls.canUndo?.() : name === 'Create a box from the current view' ? !!b : !b;
    for (const f of this.fields.values()) f.disabled = !b;
    if (!b) return;
    this.fields.get('Box Cut on')!.checked = b.enabled; this.fields.get('Show the outline of the box')!.checked = b.outline;
    const set = (name: string, value: number) => { const f = this.fields.get(name)!; if (!isNumericEditing(f)) setInputValue(f,value); };
    ['X','Y','Z'].forEach((v,i) => set('Box position '+v,b.position[i]!));
    [['left','right'],['bottom','top'],['front / near','back / far']].forEach((names,i) => names.forEach((v,j) => set('Box wall '+v,(j?b.max:b.min)[i]!)));
  }
}
