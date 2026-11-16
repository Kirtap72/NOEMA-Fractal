import {loadMb3dFieldResources,fieldMapFromImage} from '../importers/mb3d/fieldResources';
import './mb3dImport.css';
import type { Formula, Scene } from '../engine';
import { parseMb3dPreset } from '../importers/mb3d';
import { previewMb3dPreset, applyMb3dPreset } from '../importers/mb3d/adapter';
import { withNeededPixelPrecision } from '../engine/framing/rayMarch';
import type { CompatibilityField, Mb3dCompatibilityPreview } from '../importers/mb3d/adapter';

export interface Mb3dImportHandlers {
  library(): readonly Formula[];
  /** Main uses SceneSync.editWithUndo: adapter failures leave both scene and Undo untouched. */
  apply(change: (scene: Scene) => Scene): void;
  undo(): void;
  canUndo(): boolean;
  onMessage(message: string): void;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
};
const button = (text: string, action: () => void) => {
  const result = el('button', text); result.type = 'button'; result.addEventListener('click', action); return result;
};

/** Preview is independent of the live scene. Only the explicit Apply action enters a SceneSync transaction. */
export class Mb3dImportPanel {
  private readonly input = el('input');
  private readonly dialog = el('dialog');
  private readonly undoButton: HTMLButtonElement;
  private generation = 0;
  private opener: HTMLElement | null = null;

  constructor(root: HTMLElement, private handlers: Mb3dImportHandlers) {
    const actions = el('div'); actions.className = 'mb3d-actions';
    const open = button('Import MB3D preset', () => this.input.click());
    open.title = 'Read a .m3p and review the compatibility before the scene is changed.';
    this.input.type = 'file'; this.input.accept = '.m3p'; this.input.hidden = true;
    this.input.setAttribute('aria-label', 'MB3D parameter file (.m3p)');
    this.input.addEventListener('change', () => {
      const file = this.input.files?.[0]; this.input.value = ''; if (file) void this.previewFile(file);
    });
    this.undoButton = button('Undo MB3D import', () => {
      handlers.undo(); this.undoButton.disabled = !handlers.canUndo();
    });
    this.undoButton.title = 'Restore the whole scene before the latest import, including changes made after the import.';
    this.undoButton.disabled = !handlers.canUndo();
    actions.append(open, this.undoButton, this.input); root.append(actions);
    this.dialog.className = 'mb3d-preview'; this.dialog.setAttribute('aria-label', 'MB3D compatibility review');
    this.dialog.addEventListener('close', () => { this.opener?.focus(); });
    root.append(this.dialog);
  }

  async previewFile(file: File): Promise<void> {
    const generation = ++this.generation;
    try {
      if (!/\.m3p$/i.test(file.name)) throw new Error('Choose a .m3p file.');
      // Parser limits stay authoritative; reject oversized uploads before allocating their ArrayBuffer.
      if (file.size > 4 * 1024 * 1024) throw new Error('The parameter file is too large (at most 4 MiB).');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (generation !== this.generation) return;
      const neutral = parseMb3dPreset(bytes, { fileName: file.name });
      let preview = previewMb3dPreset(neutral, this.handlers.library());
      if(preview.resources.length){const maps=await loadMb3dFieldResources(preview.resources.map(r=>r.value as number));
        if(generation!==this.generation)return;preview=previewMb3dPreset(neutral,this.handlers.library(),maps);}
      this.show(preview);
    } catch (error) {
      if (generation === this.generation) this.handlers.onMessage(`MB3D-import: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private row(parent: HTMLElement, item: CompatibilityField, label = item.path): void {
    const line = el('div'); line.className = 'mb3d-field'; line.dataset.state = item.state;
    line.append(el('strong', `${item.state}: ${label}`), el('span', item.reason)); parent.append(line);
  }

  private show(preview: Mb3dCompatibilityPreview): void {
    if (!this.dialog.open) this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.dialog.replaceChildren(el('h2', `MB3D preset: ${preview.neutral.source.fileName ?? 'without a file name'}`));
    this.dialog.append(el('p', 'The review does not change the scene. Compatible camera and picture proportions are transferred on Apply. Colour, light, material and post-processing are kept. No picture similarity is verified.'));
    for(const variant of preview.variants){
      const label=el('label',`Source variant: ${variant.file} `),select=el('select');select.setAttribute('aria-label',`Source variant ${variant.file}`);
      select.add(new Option('Choose the original version…',''));for(const c of variant.choices)select.add(new Option(c.label,String(c.value)));select.value=variant.selected===null?'':String(variant.selected);
      select.addEventListener('change',()=>{const selection={...preview.variantSelections};if(select.value==='')delete selection[variant.file];else selection[variant.file]=Number(select.value);this.show(previewMb3dPreset(preview.neutral,this.handlers.library(),preview.formulaFields,selection));});label.append(select);this.dialog.append(label);
    }
    this.dialog.append(el('h3', 'Formula chain'));
    for (const formula of preview.formulas) {
      this.row(this.dialog, formula.identity, `${formula.slot + 1}. ${formula.name}`);
      this.row(this.dialog, formula.iterations, `Repetitioner: ${String(formula.iterations.value)}`);
      const details = el('details'); details.append(el('summary', `Parameters: ${formula.name}`));
      for (const parameter of formula.parameters) this.row(details, parameter, `${parameter.target ?? parameter.path} = ${JSON.stringify(parameter.value)}`);
      this.dialog.append(details);
    }
    const declared = preview.formulas.flatMap(f => f.parameters).filter(p => p.path.includes('.parameters.'));
    const mapped = declared.filter(p => p.state === 'EXACT' || p.state === 'COMPATIBLE_ADAPTER').length;
    this.dialog.append(el('h3', `Parameters: ${mapped} / ${declared.length} mapped`));
    this.dialog.append(el('h3', 'Iteration/scheduling')); this.row(this.dialog, preview.scheduling, 'Iteration scheme');
    this.dialog.append(el('h3', 'Julia'));
    const juliaDetails = el('details');
    const juliaCompatible = preview.julia.every(item => item.state === 'EXACT' || item.state === 'COMPATIBLE_ADAPTER');
    juliaDetails.append(el('summary', `${juliaCompatible ? 'COMPATIBLE_ADAPTER' : 'UNSUPPORTED'}: Julia ${preview.neutral.formulaChain.julia.enabled ? 'on' : 'off'}, C = ${JSON.stringify(preview.neutral.formulaChain.julia.constant)}`));
    for (const [index, item] of preview.julia.entries()) this.row(juliaDetails, item,
      index === 0 ? `Julia ${item.value ? 'on' : 'off'}` : `C ${'xyzw'[index - 1]} = ${JSON.stringify(item.value)}`);
    this.dialog.append(juliaDetails);
    this.dialog.append(el('h3', 'Camera/view')); this.row(this.dialog,preview.camera.summary,'Camera and view');
    const cameraDetails = el('details'); cameraDetails.append(el('summary','Camera field and conversion'));
    for(const item of preview.camera.fields) this.row(cameraDetails,item,`${item.path} = ${JSON.stringify(item.value)}${item.target ? ` → ${item.target}` : ''}`);
    if(preview.camera.camera) cameraDetails.append(el('pre',JSON.stringify(preview.camera.camera,null,2)));
    this.dialog.append(cameraDetails);
    if(preview.resources.length){
      this.dialog.append(el('h3','External formula maps'));
      for(const item of preview.resources){
        this.row(this.dialog,item,`Karta ${item.value}`);
        if(item.state==='UNSUPPORTED'||item.state==='AMBIGUOUS'){
          const input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/bmp';input.setAttribute('aria-label',`Read the original map ${item.value}`);
          input.addEventListener('change',()=>{const file=input.files?.[0];if(!file)return;const generation=this.generation;
            void fieldMapFromImage(file,item.value as number).then(map=>{if(generation!==this.generation||!this.dialog.open)return;
              this.show(previewMb3dPreset(preview.neutral,this.handlers.library(),[...preview.formulaFields.filter(m=>m.id!==map.id),map],preview.variantSelections));
            }).catch(e=>this.handlers.onMessage(`Map reading: ${e}`));});this.dialog.append(input);
        }
      }
    }
    const omitted = el('details'); omitted.append(el('summary', 'UNSUPPORTED: fields that are kept in the report but not imported'));
    const labels: Record<string, string> = { cameraView: 'Camera and view', coloringMaterial: 'Colour and material',
      lighting: 'Light', postprocess: 'Efterbehandling', references: 'Picture and map references',
      unsupportedLegacyFields: 'Unknown legacy fields', legacyRecords: 'Raw entries', 'formulaChain.options': 'Render and DE settings',
      'formulaChain.minimumIterations': 'Minimum iterations', 'formulaChain.inactiveSlots': 'Inactive formula steps',
      'formulaParameters.undeclared': 'Undeclared and inactive parameter values' };
    for (const item of preview.excluded) this.row(omitted, item, labels[item.path] ?? item.path);
    for (const warning of preview.neutral.compatibility.warnings) omitted.append(el('p', warning));
    this.dialog.append(omitted); this.row(this.dialog, preview.chain, 'Applying the whole chain');
    const actions = el('div'); actions.className = 'mb3d-actions';
    const cancel = button('Cancel', () => this.dialog.close());
    const apply = button('Apply compatible values', () => {
      try {
        // A deeply zoomed MB3D artwork needs the pixel precision mode or the picture is one flat colour; the CPU marcher decides (rayMarch.ts) and the note below says so.
        let precisionNote = '';
        this.handlers.apply(scene => { const applied = applyMb3dPreset(scene, preview, this.handlers.library()); const adj = withNeededPixelPrecision(applied, this.handlers.library()); precisionNote = adj.changed ? ' Hit precision was set to pixel mode because the camera would otherwise be inside solid material (changed under Quality).' : ''; return adj.scene; });
        this.undoButton.disabled = !this.handlers.canUndo(); this.dialog.close();
        this.handlers.onMessage(`MB3D: compatible chain, parameters, repeats and Julia transferred.${precisionNote} ${preview.camera.camera ? 'Camera and compatible picture format transferred.' : 'Camera and picture format were kept: the view adapter lacks support.'} Light/material/post-processing were kept. Picture similarity is not verified.`);
      } catch (error) { this.handlers.onMessage(`MB3D-import: ${error instanceof Error ? error.message : String(error)}`); }
    });
    apply.disabled = !preview.canApply;
    const save = button('Download compatibility report', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(preview, null, 2)], { type: 'application/json' }));
      const link = el('a'); link.href = url; link.download = `${preview.neutral.source.fileName ?? 'mb3d'}.compatibility.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    actions.append(cancel, apply, save); this.dialog.append(actions);
    if (!this.dialog.open) this.dialog.showModal();
    cancel.focus({ preventScroll: true });
    this.dialog.scrollTop = 0;
  }
}
