import {buildGroupExecutionEditor,groupEditProblem} from './groupExecutionEditor';
import {withGroupedExecution,withoutGroupedExecution,withSecondGroup} from '../engine/sceneEdit';
import { readNumber, setInputValue, isNumericEditing } from './numericRange';

import { FormulaPicker } from "./formulaPicker";
import type { PickerPlace } from "./formulaPicker";
import { formulaFit } from "../engine/formulaFit";
import type { FitEdit } from "../engine/formulaFit";

import { FormulaPreferences } from "./formulaPreferences";

import { createStepCard } from "./chainStepCard";

import {

  addStep,

  defaultStep,

  MAX_CHAIN_STEPS,

  MAX_STEP_ITERATIONS,

  MAX_ROUNDS,

  moveStep,

  removeStep,

  setStepFormula,

  withRounds,

  withStepIterations,

  withChainMode,

  withJulia,

  withStepFactor,

  withStepParameter,

  withStepSchedule,

  withStepWeight,

  KERNELS,

} from "../engine";

import type { ChainMode, Formula, Scene } from "../engine";

import { configureKernelRange, formatKernelParameter } from "./parameterRange";



export interface ChainPanelHandlers {

  /**

   * The user changed something. `structure` means steps were added, removed,

   * moved or swapped, so the panel must be rebuilt; sliders only change values.

   */

  edit(change: (scene: Scene) => Scene, kind: "value" | "structure"): void;

  /** A chosen formula was refused before any change (it does not fit the chain); the text says why. */
  refused?(message: string): void;

  /** "Show the effect of the step" was pressed on step `index` (0-based). */
  explainStep?(index: number): void;

  /** The panel was shown again for a scene (a hint that the chain may have changed). */
  shown?(): void;

}



interface Slider {

  input: HTMLInputElement;

  value: HTMLSpanElement;

}



interface StepRefs {

  iterations: Slider;

  stepFactor: Slider;

  weight?: Slider;

  every?: HTMLInputElement;

  start?: HTMLInputElement;

  params: Map<string, Slider>;

}



/** Builds and updates the panel where the chain of formulas is edited. Text only; nothing from files is used as HTML. */

export class ChainPanel {

  private signature = "";

  private picker: FormulaPicker;

  /** The scene as last shown: the picker asks what fits into THIS chain, at this place, in this mode. */
  private scene: Scene | null = null;

  private unsubscribe: () => void;

  private expanded: boolean[] = [];

  private dragState: { index: number | null } = { index: null };

  private steps: StepRefs[] = [];

  private roundsInput!: HTMLInputElement;

  private total!: HTMLDivElement;

  private modeSelect!: HTMLSelectElement;

  private juliaOn!: HTMLInputElement;

  private juliaC: Slider[] = [];

  private juliaBox!: HTMLDivElement;



  constructor(

    private root: HTMLElement,

    private formulas: readonly Formula[],

    private handlers: ChainPanelHandlers,

    private preferences = new FormulaPreferences(),

  ) {

    this.picker = new FormulaPicker(formulas, preferences);

    this.unsubscribe = preferences.subscribe(() => {

      for (const button of root.querySelectorAll<HTMLButtonElement>(

        "[data-favorite]",

      )) {

        const on = preferences.isFavorite(button.dataset.favorite!);

        button.textContent = on ? "★" : "☆";

        button.setAttribute("aria-pressed", String(on));

      }

    });

  }

  dispose() {

    this.unsubscribe();

    this.picker.dispose();

  }

  /** What the picker needs for one place in the chain (the verdicts come from the renderer's own rules and build no shader). */
  private placeFor(edit: FitEdit): PickerPlace | undefined {
    const scene = this.scene;
    const fractal = scene?.content[0];
    if (!scene || !fractal) return undefined;
    const mode = fractal.mode ?? "sequence";
    const modeName = mode === "interpolate" ? "interpolera" : mode === "alternate" ? "alternera" : "sequence";
    const n = fractal.chain.length;
    const where = edit.op === "add"
      ? `New step ${n + 1} (last in the chain) · mode: ${modeName}${fractal.execution ? " · group run" : ""}`
      : `Replaces step ${edit.index + 1} of ${n} · mode: ${modeName}${fractal.execution ? " · group run" : ""}`;
    return { fit: (f) => formulaFit(scene, this.formulas, edit, f), where };
  }

  /**
   * The picker already hides what does not fit; this is the second lock. A formula that slipped through (keyboard, a stale list, a scene
   * that changed while the dialog was open) is refused here with the reason, before the scene changes and before any shader is built.
   */
  private guarded(scene: Scene, edit: FitEdit, formula: Formula, edited: Scene): Scene {
    const fit = formulaFit(scene, this.formulas, edit, formula);
    if (fit.ok) return edited;
    this.signature = "";
    this.handlers.refused?.(`${formula.name} does not fit here: ${fit.reason ?? ""}`);
    return scene;
  }

  private move(from: number, to: number): void {

    if (

      !Number.isInteger(from) ||

      !Number.isInteger(to) ||

      from === to ||

      from < 0 ||

      to < 0 ||

      from >= this.steps.length ||

      to >= this.steps.length

    )

      return;

    const [open] = this.expanded.splice(from, 1);

    this.expanded.splice(to, 0, open ?? false);

    this.signature = "";

    this.handlers.edit((s) => moveStep(s, from, to), "structure");

    this.root

      .querySelector<HTMLButtonElement>(

        `[data-step-index="${to}"] .drag-handle`,

      )

      ?.focus();

  }



  /** Shows the scene. Rebuilds when the steps differ, otherwise only the values are updated. */

  update(scene: Scene): void {

    this.scene = scene;

    this.handlers.shown?.();

    const fractal = scene.content[0];

    if (!fractal) return;

    const signature =

      JSON.stringify(

        fractal.chain.map((s) => {

          const f = this.formulas.find((f) => f.id === s.formula);

          return [s.formula, f?.name, f?.parameters.map((p) => p.name)];

        }),

      ) +

      "/" +

      (fractal.mode ?? "sequence") + JSON.stringify(fractal.execution??null);

    if (signature !== this.signature) this.build(scene, signature);

    this.syncValues(scene);

  }



  private slider(

    label: string,

    min: number,

    max: number,

    step: number,

    decimals: number,

    onInput: (v: number) => void,

    format = (v: number) => v.toFixed(decimals),

  ): Slider & { row: HTMLElement } {

    const row = document.createElement("label");

    row.className = "slider";

    const name = document.createElement("span");

    name.textContent = label;

    const input = document.createElement("input");

    input.type = "range";

    input.min = String(min);

    input.max = String(max);

    input.step = String(step);

    const value = document.createElement("span");

    value.className = "value";

    input.addEventListener("input", () => {

      const v = readNumber(input);

      value.textContent = format(v);

      onInput(v);

    });

    row.append(name, input, value);

    return { input, value, row };

  }



  private build(scene: Scene, signature: string): void {

    this.signature = signature;

    this.steps = [];

    this.root.replaceChildren();

    const chain = scene.content[0]!.chain;

    const mode: ChainMode = scene.content[0]!.mode ?? "sequence";



    const title = document.createElement("div");

    title.className = "ctitle";

    title.textContent = "Formula chain";

    this.root.append(title);



    const list = document.createElement("div");

    list.className = "chain-steps";

    list.setAttribute("role", "list");

    list.setAttribute("aria-label", "Chosen formulas in running order");

    this.root.append(list);

    chain.forEach((data, i) => {

      const formula = this.formulas.find((f) => f.id === data.formula);

      const open = this.expanded[i] ?? i === 0;

      this.expanded[i] = open;

      const { card, controls } = createStepCard(

        formula,

        data.formula,

        i,

        chain.length,

        open,

        this.preferences,

        this.dragState,

        {

          replace: (opener) =>

            this.picker.open(

              (f) => {

                this.signature = "";

                this.handlers.edit((s) => this.guarded(s, { op: "replace", index: i }, f, setStepFormula(s, i, f)), "structure");

              },

              opener,

              true,

              this.placeFor({ op: "replace", index: i }),

            ),

          remove: () => {

            this.expanded.splice(i, 1);

            this.signature = "";

            this.handlers.edit((s) => removeStep(s, i), "structure");

            this.root

              .querySelector<HTMLButtonElement>(

                `[data-step-index="${Math.min(i, chain.length - 2)}"] .step-name`,

              )

              ?.focus();

          },

          move: (to) => this.move(i, to),

          explain: this.handlers.explainStep ? () => this.handlers.explainStep!(i) : undefined,

          toggle: (open) => {

            this.expanded[i] = open;

          },

        },

      );



      const helper = formula?.kernel && !!KERNELS[formula.kernel].role;

      const iterations = this.slider(

        helper ? "Helper calls" : "Rounds",

        1,

        MAX_STEP_ITERATIONS,

        1,

        0,

        (v) => this.handlers.edit((s) => withStepIterations(s, i, v), "value"),

      );

      iterations.input.dataset.integer = "true";

      controls.append(iterations.row);

      if (helper) {

        const explanation = document.createElement("div");

        explanation.className = "total";

        explanation.textContent =

          formula?.kernel && KERNELS[formula.kernel].role === "difs-transform"

            ? "Transforms the point without counting an iteration. Requires a following dIFS shape."

            : "Changes the point or the constant without counting an iteration. Requires a compatible counted main formula in the chain.";

        controls.append(explanation);

      }

      const stepFactor = this.slider("Step factor", 0.05, 1, 0.05, 2, (v) =>

        this.handlers.edit((s) => withStepFactor(s, i, v), "value"),

      );

      stepFactor.row.title =

        "Safety margin for this particular formula. Rays take shorter steps if any formula in the chain has a factor below 1 (the smallest applies, times the global step factor). Lower it for formulas whose distance is too optimistic.";

      controls.append(stepFactor.row);



      let weight: Slider | undefined;

      let every: HTMLInputElement | undefined;

      let start: HTMLInputElement | undefined;

      if (mode === "interpolate") {

        const w = this.slider("Vikt", 0, 2, 0.01, 2, (v) =>

          this.handlers.edit((s) => withStepWeight(s, i, v), "value"),

        );

        w.row.title =

          "How much this step weighs when the results of the steps are blended. 0 = nothing, all equal = average.";

        controls.append(w.row);

        weight = w;

      }

      if (mode === "alternate") {

        const row = document.createElement("label");

        row.className = "slider";

        row.title =

          "The step only runs on some iterations: from iteration 'from' (counted from 0), and then every n-th iteration.";

        const name = document.createElement("span");

        name.textContent = "Every n-th / from";

        every = document.createElement("input");

        start = document.createElement("input");

        for (const [input, min, max] of [

          [every, 1, MAX_ROUNDS],

          [start, 0, MAX_ROUNDS - 1],

        ] as const) {

          input.type = "number";

          input.min = String(min);

          input.max = String(max);

          input.step = "1";

          input.style.width = "3.2rem";

        }

        const send = (): void => {

          const e = readNumber(every!);

          const s0 = readNumber(start!);

          if (Number.isInteger(e) && Number.isInteger(s0))

            this.handlers.edit(

              (s) => withStepSchedule(s, i, e, s0),

              "structure",

            );

        };

        every.addEventListener("change", send);

        start.addEventListener("change", send);

        const pair = document.createElement("span");

        pair.append(every, " ", start);

        row.append(name, pair);

        controls.append(row);

      }



      const params = new Map<string, Slider>();

      for (const p of formula?.parameters ?? []) {

        const s = this.slider(

          p.label ?? p.name,

          p.min,

          p.max,

          (p.max - p.min) / 1000,

          2,

          (v) =>

            this.handlers.edit(

              (sc) => withStepParameter(sc, i, p.name, v),

              "value",

            ),

          formula?.kernel ? formatKernelParameter : undefined,

        );

        if (formula?.kernel) configureKernelRange(s.input, p);

        controls.append(s.row);

        params.set(p.name, s);

      }

      list.append(card);

      this.steps.push({

        iterations,

        stepFactor,

        params,

        ...(weight ? { weight } : {}),

        ...(every ? { every } : {}),

        ...(start ? { start } : {}),

      });

    });



    const addButton = document.createElement("button");

    addButton.type = "button";

    addButton.className = "add-formula";

    addButton.textContent = "＋ Add formula";

    addButton.disabled = chain.length >= MAX_CHAIN_STEPS;

    addButton.addEventListener("click", () =>

      this.picker.open((f) => {

        this.expanded[chain.length] = true;

        this.signature = "";

        this.handlers.edit((s) => this.guarded(s, { op: "add" }, f, addStep(s, f)), "structure");

      }, addButton, false, this.placeFor({ op: "add" })),

    );

    this.root.append(addButton);



    // Repeat the chain

    const rounds = document.createElement("label");

    rounds.className = "roundsrow";

    rounds.append("Repeat the chain ");

    this.roundsInput = document.createElement("input");

    this.roundsInput.type = "number";

    this.roundsInput.min = "1";

    this.roundsInput.max = String(MAX_ROUNDS);

    this.roundsInput.step = "1";

    this.roundsInput.addEventListener("input", () => {

      const v = readNumber(this.roundsInput);

      if (Number.isInteger(v))

        this.handlers.edit((s) => withRounds(s, v), "value");

    });

    rounds.append(this.roundsInput, " times");

    this.total = document.createElement("div");

    this.total.className = "total";

    this.root.append(rounds, this.total);



    // How the steps are combined

    const modeRow = document.createElement("label");

    modeRow.className = "roundsrow";

    modeRow.append("Combine the steps: ");

    this.modeSelect = document.createElement("select");

    this.modeSelect.add(new Option("Sequence (all steps every iteration)", "sequence"));

    this.modeSelect.add(new Option("Alternate (schedule per step)", "alternate"));

    this.modeSelect.add(

      new Option("Interpolate (blend with weights)", "interpolate"),

    );

    this.modeSelect.title =

      "Sequence: every iteration runs all steps in order. Alternate: a step only runs every n-th iteration, from a certain iteration. Interpolate: all steps start from the same point and the results are blended with one weight per step.";

    if(scene.content[0]!.execution) this.modeSelect.add(new Option(scene.content[0]!.execution!.kind === "bounded-sequence" ? (scene.content[0]!.execution!.distance==='difs-minimum'?'dIFS: shapes / uncounted transforms':"Counted prefix / repeat") : scene.content[0]!.execution!.kind === "independent-field" ? "Groups: independent fields" : "Groups: mapping → dIFS", scene.content[0]!.execution!.kind));

    this.modeSelect.value = scene.content[0]!.execution?.kind ?? mode;

    this.modeSelect.addEventListener("change", () =>

      this.handlers.edit(

        (s) => this.modeSelect.value === s.content[0]!.execution?.kind ? s : withChainMode(s, this.modeSelect.value as ChainMode),

        "structure",

      ),

    );

    modeRow.append(this.modeSelect);

    this.root.append(modeRow);

    if(scene.content[0]!.execution?.kind==='mapped-field') {
      const row=document.createElement('label'),input=document.createElement('input');
      row.className='roundsrow';input.type='checkbox';
      input.setAttribute('aria-label','Colour from the winning dIFS formula');
      input.checked=scene.content[0]!.execution.coloring==='field-otrap';
      input.title='Use the colour output of the winning formula as the orbit trap. Distance and geometry do not change. Older scenes keep their colouring until the choice is switched on.';
      input.addEventListener('change',()=>this.handlers.edit(s=>{
        const content=s.content[0]!;if(content.execution?.kind!=='mapped-field')return s;
        const execution={...content.execution};
        if(input.checked)execution.coloring='field-otrap';else delete execution.coloring;
        return {...s,content:[{...content,execution}]};
      },'structure'));
      row.append(input,' Colour from the winning dIFS formula');this.root.append(row);
    }
    // Group borders, repeat points and call limits of an imported hybrid scene (GROUP-EXECUTION-BRIDGE-01).
    const groupEditor=buildGroupExecutionEditor(scene,this.formulas,change=>this.handlers.edit(change,'structure'));
    if(groupEditor)this.root.append(groupEditor);



    if(scene.content[0]!.execution?.kind==='independent-field') {
      const exec=scene.content[0]!.execution;
      const row=document.createElement('label'),select=document.createElement('select'),seam=document.createElement('input');
      row.className='roundsrow';select.setAttribute('aria-label','Combine the two groups');
      for(const [value,text] of [['max-inverted-second','Cut away the second group (A minus B)'],['min','Union (A or B)'],['max','Intersection (A and B)'],['smooth-min','Soft union (smooth seam)'],['smooth-min-cubic','Soft union (extra smooth)']] as const)select.add(new Option(text,value));
      select.value=exec.operation;
      select.title='How the distances from the two formula groups are combined. The same way as in solid modelling: union, intersection and difference, with or without a soft seam. The scene\'s existing choice only changes when you choose here.';
      seam.type='number';seam.min='0.001';seam.max='10';seam.step='0.01';seam.value=String(exec.smooth??0.1);seam.setAttribute('aria-label','Seam width');
      seam.title='How wide the soft seam is, in scene units.';seam.hidden=!exec.operation.startsWith('smooth');
      const apply=()=>this.handlers.edit(s=>{
        const content=s.content[0]!;if(content.execution?.kind!=='independent-field')return s;
        const operation=select.value as typeof exec.operation,width=Math.min(10,Math.max(0.001,Number(seam.value)||0.1));
        const execution={...content.execution,operation} as typeof exec;
        if(operation.startsWith('smooth'))execution.smooth=width;else delete execution.smooth;
        return {...s,content:[{...content,execution}]};
      },'structure');
      select.addEventListener('change',apply);seam.addEventListener('change',apply);
      row.append('Kombinera: ',select,' ',seam);this.root.append(row);
    }

    // Create or remove grouped execution straight from the chain, so hybrids can be built without importing a preset.
    {
      const chainLength = scene.content[0]!.chain.length, execution = scene.content[0]!.execution;
      const row = document.createElement('div'), note = document.createElement('div');
      row.className = 'roundsrow'; note.setAttribute('role', 'status'); note.className = 'gx-note';
      if (execution) {
        const remove = document.createElement('button');
        remove.type = 'button'; remove.textContent = 'Remove the groups (ordinary chain)';
        remove.title = 'Runs the chain as an ordinary chain again. The steps and their values are kept.';
        remove.addEventListener('click', () => this.handlers.edit(withoutGroupedExecution, 'structure'));
        row.append(remove);
      } else if (chainLength >= 1) {
        // Group B is a dIFS shape. It arrives together with the groups, because a plain chain cannot hold both kinds.
        const shapes = this.formulas.filter((f) => f.kernel && KERNELS[f.kernel]?.method === 'difs' && !KERNELS[f.kernel]?.role && KERNELS[f.kernel]?.hints.deoption === 20);
        if (shapes.length) {
          const shape = document.createElement('select'), kind0 = document.createElement('select'), op0 = document.createElement('select'), add = document.createElement('button');
          shape.setAttribute('aria-label', 'Shape B (dIFS)');
          for (const f of shapes) shape.add(new Option(f.name, f.id));
          kind0.setAttribute('aria-label', 'How the groups combine (new B shape)');
          kind0.add(new Option('Two fields: combine the distances', 'independent-field'));
          kind0.add(new Option('Mapping → dIFS (mix)', 'mapped-field'));
          for (const [value, text] of [['min', 'Union (A or B)'], ['max', 'Intersection (A and B)'], ['max-inverted-second', 'Cut B away from A'], ['smooth-min', 'Soft union'], ['smooth-min-cubic', 'Soft union (extra smooth)']] as const) op0.add(new Option(text, value));
          kind0.addEventListener('change', () => { op0.hidden = kind0.value !== 'independent-field'; });
          add.type = 'button'; add.textContent = 'Add B and group';
          add.title = 'The whole current chain becomes group A and the chosen dIFS shape becomes group B. Group A should be counted analytic 3D formulas. The engine tells you if the pair does not fit.';
          add.addEventListener('click', () => {
            const formula = this.formulas.find((f) => f.id === shape.value)!;
            const make = (s: Scene) => withSecondGroup(s, formula, kind0.value as 'independent-field' | 'mapped-field', op0.value as 'min');
            const problem = groupEditProblem(scene, this.formulas, make(scene));
            if (problem) { note.textContent = problem; return; }
            note.textContent = '';
            this.handlers.edit(make, 'structure');
          });
          const line = document.createElement('div');
          line.className = 'roundsrow'; line.append('New B shape: ', shape, ' ', kind0, ' ', op0, ' ', add);
          this.root.append(line);
        }
      }
      if (!execution && chainLength >= 2) {
        const split = document.createElement('select'), kind = document.createElement('select'), operation = document.createElement('select'), go = document.createElement('button');
        split.setAttribute('aria-label', 'Split the chain after step');
        for (let i = 0; i < chainLength - 1; i++) split.add(new Option('Split after step ' + (i + 1), String(i)));
        kind.setAttribute('aria-label', 'How the groups combine');
        kind.add(new Option('Two fields: combine the distances', 'independent-field'));
        kind.add(new Option('Mapping → dIFS (mix)', 'mapped-field'));
        for (const [value, text] of [['min', 'Union (A or B)'], ['max', 'Intersection (A and B)'], ['max-inverted-second', 'Cut B away from A'], ['smooth-min', 'Soft union'], ['smooth-min-cubic', 'Soft union (extra smooth)']] as const) operation.add(new Option(text, value));
        kind.addEventListener('change', () => { operation.hidden = kind.value !== 'independent-field'; });
        go.type = 'button'; go.textContent = 'Gruppera';
        go.title = 'Splits the chain into two groups. Group A should be counted analytic 3D formulas and group B dIFS shapes. The engine tells you if the pair does not fit.';
        go.addEventListener('click', () => {
          const next = withGroupedExecution(scene, Number(split.value), kind.value as 'independent-field' | 'mapped-field', operation.value as 'min');
          const problem = groupEditProblem(scene, this.formulas, next);
          if (problem) { note.textContent = problem; return; }
          note.textContent = '';
          this.handlers.edit((s) => withGroupedExecution(s, Number(split.value), kind.value as 'independent-field' | 'mapped-field', operation.value as 'min'), 'structure');
        });
        row.append('Groups: ', split, ' ', kind, ' ', operation, ' ', go);
      }
      if (row.childNodes.length) { this.root.append(row, note); }
    }

    // Julia mode

    const juliaRow = document.createElement("label");

    juliaRow.className = "roundsrow";

    this.juliaOn = document.createElement("input");

    this.juliaOn.type = "checkbox";

    this.juliaOn.title =

      "In every iteration a fixed constant c is added instead of the point itself. This gives the Julia set of every formula in the chain.";

    this.juliaOn.addEventListener("change", () =>

      this.handlers.edit(

        (s) => withJulia(s, { enabled: this.juliaOn.checked }),

        "value",

      ),

    );

    juliaRow.append(this.juliaOn, " Julia mode");

    this.root.append(juliaRow);

    this.juliaBox = document.createElement("div");

    this.juliaC = ["x", "y", "z"].map((axis, k) => {

      const s = this.slider(`c ${axis}`, -2, 2, 0.001, 3, (v) =>

        this.handlers.edit((sc) => {

          const cur = sc.content[0]?.julia?.c ?? [0, 0, 0];

          const next = [...cur] as [number, number, number];

          next[k] = v;

          return withJulia(sc, { c: next });

        }, "value"),

      );

      this.juliaBox.append(s.row);

      return s;

    });

    const fromTarget = document.createElement("button");

    fromTarget.textContent = "Take c from the camera target point";

    fromTarget.title =

      "Sets the constant to the point the camera looks at. A good way to find interesting Julia sets: look at a place in the ordinary fractal and then switch on Julia mode.";

    fromTarget.addEventListener("click", () =>

      this.handlers.edit(

        (s) =>

          withJulia(s, { c: [...s.camera.target] as [number, number, number] }),

        "value",

      ),

    );

    this.juliaBox.append(fromTarget);

    const tip = document.createElement("div");

    tip.className = "total";

    tip.textContent =

      "Tip: c near (0, 0, 0) often gives a smooth, round shape. Look at a detail in the ordinary fractal, press the button and then switch on Julia mode.";

    this.juliaBox.append(tip);

    this.root.append(this.juliaBox);

  }



  private syncValues(scene: Scene): void {

    const fractal = scene.content[0]!;

    fractal.chain.forEach((data, i) => {

      const refs = this.steps[i];

      const formula = this.formulas.find((f) => f.id === data.formula);

      if (!refs || !formula) return;

      const iterations = data.iterations ?? formula.iterations;

      setInputValue(refs.iterations.input, iterations);

      refs.iterations.value.textContent = String(iterations);

      const factor = data.step_factor ?? 1;

      setInputValue(refs.stepFactor.input, factor);

      refs.stepFactor.value.textContent = factor.toFixed(2);

      if (refs.weight) {

        const w = data.weight ?? 1;

        setInputValue(refs.weight.input, w);

        refs.weight.value.textContent = w.toFixed(2);

      }

      if (refs.every && !isNumericEditing(refs.every))

        setInputValue(refs.every, data.every ?? 1);

      if (refs.start && !isNumericEditing(refs.start))

        setInputValue(refs.start, data.start ?? 0);

      for (const p of formula.parameters) {

        const slider = refs.params.get(p.name);

        if (!slider) continue;

        const v =

          data.parameters[p.name] ?? defaultStep(formula).parameters[p.name]!;

        setInputValue(slider.input, v);

        slider.value.textContent = formula.kernel

          ? formatKernelParameter(v)

          : v.toFixed(2);

      }

    });

    if (!isNumericEditing(this.roundsInput))

      setInputValue(this.roundsInput, fractal.rounds);

    this.roundsInput.disabled=!!fractal.execution;

    this.modeSelect.value = fractal.execution?.kind ?? fractal.mode ?? "sequence";

    const julia = fractal.julia;

    const synthesized=fractal.chain.some(s=>s.formula.startsWith('discovered-formula-'));
    this.juliaOn.disabled=synthesized;this.juliaOn.title=synthesized?'Julia is not defined for this synthesised AST.':'Julia mode';this.juliaBox.hidden=synthesized;
    this.juliaOn.checked = julia?.enabled ?? false;

    this.juliaBox.style.opacity = julia?.enabled ? "1" : "0.5";

    const cc = julia?.c ?? [0, 0, 0];

    this.juliaC.forEach((s, k) => {

      if (!isNumericEditing(s.input)) setInputValue(s.input, cc[k]!);

      s.value.textContent = cc[k]!.toFixed(3);

    });

    let counted = 0,

      helpers = 0;

    for (let round = 0; round < fractal.rounds; round++)

      for (const data of fractal.chain) {

        if (

          fractal.mode === "alternate" &&

          (round < (data.start ?? 0) ||

            (round - (data.start ?? 0)) % (data.every ?? 1) !== 0)

        )

          continue;

        const f = this.formulas.find((f) => f.id === data.formula),

          calls = data.iterations ?? f?.iterations ?? 0;

        if (f?.kernel && KERNELS[f.kernel].role) helpers += calls;

        else counted += calls;

      }

    if(fractal.execution){this.total.textContent=fractal.execution.groups.map((g,i)=>`${fractal.execution!.kind==="bounded-sequence"?(fractal.execution!.distance==='difs-minimum'?'dIFS (shape calls)':"Counted chain"):fractal.execution!.kind==="independent-field"?(i===0?"Analytic group":fractal.execution!.operation==='max-inverted-second'?"Inverted dIFS":"dIFS group"):i===0?"Mapping":"dIFS"}: step ${g.start+1}–${g.end+1}, repeat from ${g.repeat+1}, at most ${g.maxIterations} calls`).join(" · ");return;}

    this.total.textContent = helpers

      ? `Up to ${counted} counted iterations + ${helpers} helper calls per point`

      : `In total ${counted} iterations per point`;

  }

}
