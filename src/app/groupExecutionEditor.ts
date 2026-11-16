import type { Formula, Scene } from '../engine';
import { resolveScene } from '../engine/scene';
import { addStep, stepEditRefusal, withExecutionGroup } from '../engine/sceneEdit';
import { describeExecution } from '../engine/formula/executionSummary';
import type { ExecutionInfo } from '../engine/formula/executionSummary';
import { isImportedHelperCapable } from '../engine/formula/importedHelper';

/** What the editor shows, as plain data (also used by the tests). Null for an ordinary chain. */
export function groupEditorModel(scene: Scene, formulas: readonly Formula[]): ExecutionInfo | null {
  const f = scene.content[0];
  if (!f || f.type !== 'fractal' || !f.execution) return null;
  const steps = f.chain.map((s) => ({ formula: formulas.find((x) => x.id === s.formula), iterations: s.iterations, every: s.every, start: s.start }));
  if (steps.some((s) => !s.formula)) return null;
  return describeExecution(steps as never, f.execution, f.rounds);
}

/** Why a group edit is refused, or null when the engine accepts the resulting scene. The scene is never changed here. */
export function groupEditProblem(scene: Scene, formulas: readonly Formula[], next: Scene): string | null {
  if (next === scene) return 'The change is not possible here (the limit, the position or the value is invalid).';
  const r = resolveScene(next, formulas as Formula[]);
  return r.ok ? null : `The engine rejects the change: ${r.errors.slice(0, 2).join('; ')}`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e;
};

/**
 * A focused editor for a scene with grouped execution (an imported Mandelbulb 3D hybrid, or an AI draft made the same way). It uses the same
 * scene edit functions and engine rules as the AI tools, so manual and AI edits cannot disagree. Chain cards above still edit values, order inside a group and removal.
 */
export function buildGroupExecutionEditor(scene: Scene, formulas: readonly Formula[], edit: (change: (s: Scene) => Scene) => void): HTMLElement | null {
  const model = groupEditorModel(scene, formulas);
  if (!model) return null;
  const box = el('section', undefined, 'gx'); box.setAttribute('aria-label', 'Execution groups');
  box.append(el('strong', 'Execution groups'), el('p', model.explanation, 'gx-text'));
  const note = el('div', undefined, 'gx-note'); note.setAttribute('role', 'status');
  const apply = (change: (s: Scene) => Scene) => {
    const problem = groupEditProblem(scene, formulas, change(scene));
    if (problem) { note.textContent = problem; return; }
    note.textContent = ''; edit(change);
  };
  const addable = formulas.filter((f) => isImportedHelperCapable(f));
  for (const g of model.groups) {
    const sec = el('div', undefined, 'gx-group');
    sec.append(el('h4', `Grupp ${g.group + 1}: ${g.job}`));
    const list = el('ol', undefined, 'gx-steps'); list.start = g.start + 1;
    for (const s of g.steps) {
      const li = el('li', `${s.name} × ${s.iterations}`);
      li.append(el('span', s.role === 'counted' ? 'counted call' : 'helper step (moves the point, not counted)', 'gx-badge'));
      if (s.imported) li.append(el('span', 'importerad omvandling', 'gx-badge gx-imported'));
      if (s.index === g.repeat) li.append(el('span', 'repeats from here', 'gx-badge'));
      list.append(li);
    }
    sec.append(list);
    const repeat = el('select'); repeat.setAttribute('aria-label', `Group ${g.group + 1}: repeat from step`);
    for (const s of g.steps) repeat.append(new Option(`${s.index + 1}. ${s.name}`, String(s.index), false, s.index === g.repeat));
    repeat.addEventListener('change', () => apply((sc) => withExecutionGroup(sc, g.group, 'repeat', Number(repeat.value))));
    const limit = el('input'); limit.type = 'number'; limit.min = '1'; limit.max = '256'; limit.step = '1'; limit.value = String(g.maxIterations);
    limit.setAttribute('aria-label', `Group ${g.group + 1}: highest number of counted calls`);
    limit.addEventListener('change', () => apply((sc) => withExecutionGroup(sc, g.group, 'maxIterations', Math.round(Number(limit.value)))));
    const row = (label: string, ...nodes: HTMLElement[]) => { const r = el('label', undefined, 'gx-row'); r.append(el('span', label), ...nodes); return r; };
    sec.append(row('Repeat from', repeat), row('Highest number of counted calls', limit));
    if (addable.length) {
      const pick = el('select'); pick.setAttribute('aria-label', `Group ${g.group + 1}: transform to add`);
      for (const f of addable) pick.append(new Option(f.name, f.id));
      const add = (at: number, label: string) => { const b = el('button', label); b.type = 'button'; b.addEventListener('click', () => {
        const f = formulas.find((x) => x.id === pick.value)!;
        const why = stepEditRefusal(scene, { op: 'insert', index: at, group: g.group });
        if (why) { note.textContent = why; return; }
        apply((sc) => addStep(sc, f, at, g.group));
      }); return b; };
      const actions = el('div', undefined, 'gx-actions'); actions.append(pick, add(g.start, 'First in the group'), add(g.end + 1, 'Last in the group'));
      sec.append(actions);
    }
    box.append(sec);
  }
  if (model.errors.length) box.append(el('div', `Assessment by the engine: ${model.errors.join('; ')}`, 'gx-error'));
  box.append(note);
  return box;
}
