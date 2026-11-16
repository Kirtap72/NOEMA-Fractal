import './formulaImport.css';
import type { Formula } from '../engine';
import { parseFormula } from '../engine';
import { importM3f, migrateImportedText } from '../importers/m3f/importFormula';
import type { ImportReport } from '../importers/m3f/importFormula';
import { ImportedFormulaStore } from './importedFormulaStore';
import type { ImportedFormulaRecord } from './importedFormulaStore';

export interface FormulaImportHandlers {
  library(): readonly Formula[];
  /** Main adds the formula to the live library and refreshes the chain panel. */
  added(formula: Formula): void;
  removed(id: string): void;
  onMessage(message: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
};
const button = (text: string, action: () => void) => { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; };

const STAGE_SV: Record<string, string> = {
  classification: 'file type', parsing: 'parsing', translation: 'translation', compilation: 'compilation', validation: 'mathematical check',
};

/** Why a file stops, in words an artist can act on. The technical reason follows after the colon. */
export function explainRejection(report: ImportReport): string {
  if (report.kind === 'machine-code') return 'The file contains only precompiled machine code. The mathematics is not in readable form, so it cannot be imported safely. It requires manual reconstruction from a documented formula.';
  if (report.kind === 'unsupported') return 'The file is not a valid formula file.';
  return `Stopped at the step ${STAGE_SV[report.stage] ?? report.stage}: ${report.reasons[0] ?? 'unknown reason'}`;
}

/** Files are read as text only. Nothing from a file is evaluated; the importer parses a small, fixed language. */
export class FormulaImportPanel {
  private readonly store = new ImportedFormulaStore();
  private readonly list = el('div');
  private readonly results = el('div');
  private records: ImportedFormulaRecord[] = [];

  constructor(root: HTMLElement, private handlers: FormulaImportHandlers) {
    const box = el('div'); box.className = 'fimp';
    const title = el('strong', 'My imported formulas'); title.title = 'Personal library: stays on this computer and never follows the public distribution.';
    const one = el('input'); one.type = 'file'; one.accept = '.m3f'; one.multiple = true; one.hidden = true; one.setAttribute('aria-label', 'Formula files (.m3f)');
    const folder = el('input'); folder.type = 'file'; folder.hidden = true; folder.setAttribute('webkitdirectory', ''); folder.setAttribute('aria-label', 'Folder with formula files');
    one.addEventListener('change', () => { const files = [...(one.files ?? [])]; one.value = ''; void this.importFiles(files); });
    folder.addEventListener('change', () => { const files = [...(folder.files ?? [])].filter((f) => /\.m3f$/i.test(f.name)); folder.value = ''; void this.importFiles(files); });
    const actions = el('div'); actions.className = 'fimp-actions';
    actions.append(button('Import formula (.m3f)', () => one.click()), button('Import folder', () => folder.click()), one, folder);
    const note = el('p', 'Only readable JIT formulas can be translated. The result is personal and private, marked as unverified, and is used in the chain as an ordinary editable formula.'); note.className = 'fimp-note';
    box.append(title, actions, note, this.results, this.list);
    root.append(box);
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.records = await this.store.list();
      for (const r of this.records) { const p = parseFormula(migrateImportedText(r.text)); if (p.ok && !this.handlers.library().some((f) => f.id === p.formula.id)) this.handlers.added(p.formula); }
    } catch (e) { this.handlers.onMessage('Imported formulas could not be read: ' + String(e)); }
    this.renderList();
  }

  private async importFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    this.results.replaceChildren();
    const known = [...this.handlers.library()];
    const table = el('table'); table.className = 'fimp-table';
    const head = el('tr'); for (const h of ['Fil', 'Resultat', 'Explanation']) head.append(el('th', h)); table.append(head);
    let imported = 0;
    for (const file of files) {
      const row = el('tr');
      let report: ImportReport;
      try { report = await importM3f(await file.text(), file.name, known); }
      catch (e) { row.append(el('td', file.name), el('td', 'Rejected'), el('td', 'Unexpected error: ' + String(e))); table.append(row); continue; }
      if (report.status === 'imported' && report.formula && report.formulaText && report.validation) {
        const record: ImportedFormulaRecord = { id: report.formula.id, text: report.formulaText, fileName: file.name, sha256: report.sha256, importedAt: new Date().toISOString(), comparisons: report.validation.comparisons, maxRelativeError: report.validation.maxRelativeError, notes: report.notes };
        try { await this.store.put(record); } catch (e) { row.append(el('td', file.name), el('td', 'Rejected'), el('td', 'Could not be saved: ' + String(e))); table.append(row); continue; }
        known.push(report.formula); this.handlers.added(report.formula); this.records = [...this.records.filter((r) => r.id !== record.id), record]; imported++;
        row.append(el('td', file.name), el('td', 'Importerad'), el('td', `${record.comparisons} checkpoints, largest relative error ${record.maxRelativeError.toExponential(1)}. Transform: used before a formula with a distance function. ${report.notes.join(' ')}`));
        row.dataset.state = 'ok';
      } else { row.append(el('td', file.name), el('td', 'Rejected'), el('td', explainRejection(report))); row.dataset.state = 'rejected'; }
      table.append(row);
    }
    this.results.append(el('p', `${imported} of ${files.length} files were imported. A mathematical check is not a picture comparison: no rendering has been run.`), table);
    this.renderList();
    this.handlers.onMessage(`${imported} of ${files.length} formula files were imported.`);
  }

  private renderList(): void {
    this.list.replaceChildren();
    if (!this.records.length) return;
    const heading = el('div', `Personal formulas (${this.records.length}) – private, unverified`); heading.className = 'fimp-heading';
    this.list.append(heading);
    for (const r of this.records.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      const row = el('div'); row.className = 'fimp-item';
      const name = el('span', `${r.id}  ·  ${r.fileName}`); name.title = `Imported ${r.importedAt.slice(0, 10)}. SHA-256 ${r.sha256.slice(0, 12)}…`;
      row.append(name, button('Remove', () => { void this.remove(r.id); }));
      this.list.append(row);
    }
  }

  private async remove(id: string): Promise<void> {
    try { await this.store.remove(id); } catch (e) { this.handlers.onMessage('Could not remove: ' + String(e)); return; }
    this.records = this.records.filter((r) => r.id !== id); this.handlers.removed(id); this.renderList();
  }
}
