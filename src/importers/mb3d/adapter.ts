import { effectiveSchedule, firstAtOrAfter, lastAtOrBefore, positionGroups } from './hybridSchedule';
import {KERNELS} from '../../engine/formula/kernels';
import {fieldMapErrors} from '../../engine/fieldMaps';
import type {FieldMap} from '../../engine/fieldMaps';
import { mappedFieldErrors,boundedSequenceErrors } from '../../engine/formula/groupExecution';
import {independentFieldErrors} from '../../engine/formula/independentField';
import { previewMb3dCamera } from './cameraAdapter';
import type { Mb3dCameraPreview } from './cameraAdapter';
import type { MappedFieldExecution,ChainExecution,BoundedSequenceExecution,IndependentFieldExecution } from '../../engine/formula/groupExecution';
import { nearestEven } from '../../engine/formula/primitives';
import type { Formula } from '../../engine/formula/types';
import { generateChain, MAX_ROUNDS } from '../../engine/formula/chain';
import { MAX_CHAIN_STEPS, MAX_STEP_ITERATIONS, MAX_TOTAL_ITERATIONS, parseScene, resolveScene } from '../../engine/scene';
import type { ChainStepData, FractalContent, Scene } from '../../engine/scene';
import { MB3D_FORMULA_MAPPINGS } from './adapterRegistry';
import type { Mb3dFormulaMapping } from './adapterRegistry';
import type { FormulaSlot, JsonValue, NeutralMb3dPreset } from './types';

export type CompatibilityState = 'EXACT' | 'COMPATIBLE_ADAPTER' | 'UNSUPPORTED' | 'AMBIGUOUS';
export interface CompatibilityField {
  path: string;
  state: CompatibilityState;
  reason: string;
  value: JsonValue;
  target?: string;
}
export interface AdaptedFormula {
  slot: number;
  name: string;
  identity: CompatibilityField;
  parameters: CompatibilityField[];
  iterations: CompatibilityField;
  /** Contains all declared values and engine-only defaults, even when the whole chain cannot apply. */
  step: ChainStepData | null;
}
export interface Mb3dCompatibilityPreview {
  variantSelections:Record<string,number>;
  variants:{file:string;parameter:string;choices:readonly {value:number;label:string}[];selected:number|null}[];
  /** Original parser result, including every unknown field and original byte. */
  neutral: NeutralMb3dPreset;
  formulas: AdaptedFormula[];
  scheduling: CompatibilityField;
  julia: CompatibilityField[];
  camera: Mb3dCameraPreview;
  excluded: CompatibilityField[];
  chain: CompatibilityField;
  /** Only an entirely mapped chain with a supported schedule and Julia state can replace a chain. */
  content: FractalContent | null;
  canApply: boolean;
  resources: CompatibilityField[];
  formulaFields: FieldMap[];
}
const supported = (f: CompatibilityField) => f.state === 'EXACT' || f.state === 'COMPATIBLE_ADAPTER';
const finite = (value: JsonValue | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const numberValue = (value: JsonValue | undefined): number => typeof value === 'number' ? value : NaN;
const field = (path: string, state: CompatibilityState, reason: string, value: JsonValue, target?: string): CompatibilityField =>
  ({ path, state, reason, value, ...(target ? { target } : {}) });
const sourceName = (file: string) => file.replace(/\.m3f$/i, '');

function mapSlot(preset: NeutralMb3dPreset, slot: FormulaSlot, library: readonly Formula[],variantSelections:Readonly<Record<string,number>>): AdaptedFormula {
  const path = `formulaChain.slots.${slot.slot}`, name = slot.name ?? slot.storedName;
  // External numeric IDs are not stable. Use the exact NUL-terminated source filename identity.
  // Internal IDs have a separate namespace, so Amazing Box never resolves to Mandelbox/AmazingBox2.
  const matches = MB3D_FORMULA_MAPPINGS.filter(m => slot.legacyId>=20 ? m.internalId===undefined&&
    (sourceName(m.file) === slot.storedName || m.aliases.includes(slot.storedName)) : m.internalId===slot.legacyId);
  let mapping: Mb3dFormulaMapping | undefined, formula: Formula | undefined;
  let identity = field(path, 'UNSUPPORTED', 'No reviewed mapping for this exact MB3D variant.', name);
  if (matches.length > 1) identity = field(path, 'AMBIGUOUS', 'Several source identities match; none is chosen automatically.', name);
  else if (matches.length === 1) {
    mapping = matches[0]!;
    const candidates = library.filter(f => f.provenance?.origin === 'mandelbulb3d' && f.provenance.file === mapping!.file && f.provenance.internalId===mapping!.internalId);
    if (candidates.length > 1) identity = field(path, 'AMBIGUOUS', 'Several library variants have the same source file.', name);
    else if (candidates.length === 1 && candidates[0]!.id === mapping.engineId && candidates[0]!.provenance?.collection === mapping.collection) {
      formula = candidates[0]!;
      identity = field(path, mapping.internalId!==undefined || slot.storedName === sourceName(mapping.file) ? 'EXACT' : 'COMPATIBLE_ADAPTER',
        `Source file ${mapping.file}; parameter order: ${mapping.specification}.`, name, formula.id);
      if(mapping.variant){const selected=mapping.variant.choices.find(c=>c.value===variantSelections[mapping!.file]);identity=field(path,selected?'COMPATIBLE_ADAPTER':'AMBIGUOUS',selected?`Explicitly chosen original version: ${selected.label}. The .m3p contains no formula body hash.`:'Several original versions have the same file name but different map coordinates. Choose the source variant explicitly; none is chosen automatically.',name,formula.id);}
    }
  } else if (slot.legacyId >= 20 && library.some(f => f.provenance?.file === `${slot.storedName}.m3f`)) {
    identity = field(path, 'AMBIGUOUS', 'The source file exists, but the parameter layout has no reviewed adapter yet.', name);
  }
  const iterations = field(`${path}.iterations`, slot.iterationEncoding === 'int32-count' &&
    Number.isInteger(slot.iterations) && slot.iterations! >= 1 && slot.iterations! <= MAX_STEP_ITERATIONS ? 'EXACT' : 'UNSUPPORTED',
    'Repeats per step; Float32 weights are not iteration counts. Limit: 1–64.', slot.iterations ?? slot.weight, 'iterations');
  const sets = preset.formulaParameters.filter(p => p.slot === slot.parameterSet), set = sets.length === 1 ? sets[0] : undefined;
  const parameters: CompatibilityField[] = [];
  const values: Record<string, number> = formula ? Object.fromEntries(formula.parameters.map(p => [p.name, p.default])) : {};
  if(mapping?.variant&&mapping.variant.choices.some(c=>c.value===variantSelections[mapping!.file]))values[mapping.variant.parameter]=variantSelections[mapping.file]!;
  let layoutOK = !!formula && !!mapping && set?.declaredCount === mapping.parameters.length;
  if (!layoutOK) parameters.push(field(`formulaParameters.${slot.parameterSet}.declaredCount`,
    formula ? 'AMBIGUOUS' : 'UNSUPPORTED', 'The declared option layout cannot be transferred safely.', set?.declaredCount ?? null));
  for (const option of set?.parameters.filter(p => p.declared !== false) ?? []) {
    const target = mapping?.parameters[option.index];
    const definition = formula?.parameters.find(p => p.name === target);
    const indexUnique = set!.parameters.filter(p => p.index === option.index).length === 1;
    const typeOK = mapping?.typeCodes[option.index] === option.typeCode;
    // Integer options become Float32 GPU uniforms. A change of rounded integer changes discrete branches/hash seeds.
    const integerOK = option.typeCode !== 2 || finite(option.value) && nearestEven(option.value) === nearestEven(Math.fround(option.value));
    const valueOK = definition && finite(option.value) && option.value >= definition.min && option.value <= definition.max && integerOK;
    const state: CompatibilityState = !formula ? 'UNSUPPORTED' : !layoutOK || !indexUnique || !typeOK || !definition ? 'AMBIGUOUS' : valueOK ? 'EXACT' : 'UNSUPPORTED';
    parameters.push(field(`formulaParameters.${slot.parameterSet}.parameters.${option.index}`, state,
      state === 'EXACT' ? `${definition!.label ?? target}: stored Float64 value without rounding.` :
        'The value, the option type or the order cannot be transferred without being changed/guessed.', option.value, target));
    if (state === 'EXACT') values[target!] = option.value as number;
  }
  if (mapping && set) layoutOK &&= mapping.parameters.every((_, i) => set.parameters.some(p => p.index === i && p.declared === true));
  for (const parameter of formula?.parameters.filter(p => !mapping?.parameters.includes(p.name)) ?? []) {
    parameters.push(field(`defaults.${slot.slot}.${parameter.name}`, 'COMPATIBLE_ADAPTER',
      mapping?.variant?.parameter===parameter.name?'Explicit choice of a recovered original version; this value is not stored in the .m3p.':'Extra engine sliders keep the default value of the formula specification; no corresponding preset value is imported.', values[parameter.name]!, parameter.name));
  }
  return { slot: slot.slot, name, identity, parameters, iterations,
    step: layoutOK && supported(identity) && supported(iterations) && parameters.every(supported) ?
      { formula: formula!.id, iterations: slot.iterations!, parameters: values } : null };
}

/** Read-only adapter: parser, neutral data, library and current scene are never mutated. */
export function previewMb3dPreset(neutral: NeutralMb3dPreset, library: readonly Formula[], maps:readonly FieldMap[]=[],variantSelections:Readonly<Record<string,number>>={}): Mb3dCompatibilityPreview {
  const c = neutral.formulaChain;
  const formulas = c.activeSlotOrder.map(id => c.slots.find(s => s.slot === id)).filter((s): s is FormulaSlot => !!s && s.active)
    .map(s => mapSlot(neutral, s, library,variantSelections));
  const orderOK = formulas.length === c.activeSlotOrder.length && new Set(c.activeSlotOrder).size === formulas.length &&
    c.slots.filter(s => s.active).length === formulas.length;
  const maximum = c.globalMaximumIterations, schedule = c.scheduling;
  // HYBRID-ENGINE-01: the schedule MB3D runs after its own load-time correction, in chain positions (empty slots dropped, see hybridSchedule.ts).
  const slotCounts = [0, 0, 0, 0, 0, 0];
  for (const s of c.slots) if (s.active && s.slot >= 0 && s.slot < 6 && s.iterationEncoding === 'int32-count' && typeof s.iterations === 'number') slotCounts[s.slot] = s.iterations;
  const hybridMode = c.mode === 'alternating' || c.mode === 'de-combination' || c.mode === 'ifs' ? c.mode : null;
  const eff = hybridMode && neutral.source.mandId >= 42 && [schedule.end1, schedule.repeat1, schedule.start2, schedule.end2, schedule.repeat2].every(finite) ?
    effectiveSchedule(hybridMode, slotCounts, { end1: schedule.end1 as number, repeat1: schedule.repeat1 as number, start2: schedule.start2 as number, end2: schedule.end2 as number, repeat2: schedule.repeat2 as number }) : null;
  const lastPos = c.activeSlotOrder.length - 1;
  const endPos = eff ? lastAtOrBefore(c.activeSlotOrder, eff.end1) : c.activeSlotOrder.indexOf(numberValue(schedule.end1));
  const repeatPos = eff ? firstAtOrAfter(c.activeSlotOrder, eff.repeat1) : c.activeSlotOrder.indexOf(numberValue(schedule.repeat1));
  const posGroups = eff ? positionGroups(c.activeSlotOrder, eff) : null;
  const counts = formulas.reduce((n, f) => n + (f.step?.iterations ?? 0), 0);
  const rounds = finite(maximum) && counts > 0 ? maximum / counts : 0;
  // Exact supported subset: the full active block repeats from its first slot, no second group or prefix.
  // Older presets explicitly carry repeat-from in the header, not the modern addon nibbles.
  const fullCycle = neutral.source.mandId < 42 ? schedule.legacyRepeatFrom === c.activeSlotOrder[0] &&
    schedule.rawFirst === 0 && schedule.rawSecond === 0 :
    (eff ? repeatPos === 0 && endPos === lastPos : schedule.repeat1 === c.activeSlotOrder[0] && schedule.end1 === c.activeSlotOrder.at(-1)) && schedule.rawSecond === 0;
  let execution: ChainExecution | undefined;
  // The recovered helpers are validated for counted mapping groups, not this rounds-only shortcut.
  // Summing their quotas as ordinary escape counts would silently truncate the native orbit.
  const recoveredMappingHelpers = formulas.some(f => f.step && KERNELS[library.find(d => d.id === f.step!.formula)!.kernel!]?.role);
  const scheduleOK = !recoveredMappingHelpers && c.available && orderOK && formulas.length > 0 && c.mode === 'alternating' && fullCycle &&
    Number.isInteger(rounds) && rounds >= 1 && rounds <= MAX_ROUNDS && finite(maximum) && maximum <= MAX_TOTAL_ITERATIONS;
  const groups = posGroups && c.mode === 'de-combination' ? [
    { ...posGroups.group1, maxIterations: maximum },
    { ...posGroups.group2, maxIterations: numberValue(c.options.iMaxItsF2) },
  ] : [
    { start: c.activeSlotOrder.indexOf(0), end: c.activeSlotOrder.indexOf(numberValue(schedule.end1)), repeat: c.activeSlotOrder.indexOf(numberValue(schedule.repeat1)), maxIterations: maximum },
    { start: c.activeSlotOrder.indexOf(numberValue(schedule.start2)), end: c.activeSlotOrder.indexOf(numberValue(schedule.end2)), repeat: c.activeSlotOrder.indexOf(numberValue(schedule.repeat2)), maxIterations: numberValue(c.options.iMaxItsF2) },
  ];
  const candidate = { kind: 'mapped-field', groups, fieldStop: 'query' } as MappedFieldExecution;
  const independent:IndependentFieldExecution={kind:'independent-field',operation:'max-inverted-second',groups:candidate.groups};
  const independentOK=c.available&&orderOK&&neutral.source.mandId>=42&&c.mode==='de-combination'&&
    c.options.bOptions1===2&&c.options.bOptions3===2&&c.options.bOptions2===0&&c.minimumIterations===1&&
    schedule.rawFirst===(numberValue(schedule.end1)|numberValue(schedule.repeat1)<<4)&&
    schedule.rawSecond===(numberValue(schedule.start2)|numberValue(schedule.end2)<<4|numberValue(schedule.repeat2)<<8)&&
    finite(c.options.RStop)&&c.options.RStop>=1&&c.options.RStop<=65536&&formulas.every(f=>f.step)&&
    !independentFieldErrors(formulas.map(f=>({formula:library.find(d=>d.id===f.step!.formula)!,iterations:f.step!.iterations!})),1,'sequence',independent).length;
  const mappedOK = c.available && orderOK && neutral.source.mandId >= 42 && c.mode === 'de-combination' &&
    (numberValue(c.options.bOptions1) & 3) === 2 && c.options.bOptions3 === 5 && c.options.bOptions2 === 0 && c.minimumIterations === 1 &&
    schedule.rawFirst === (numberValue(schedule.end1) | numberValue(schedule.repeat1) << 4) &&
    schedule.rawSecond === (numberValue(schedule.start2) | numberValue(schedule.end2) << 4 | numberValue(schedule.repeat2) << 8) &&
    finite(c.options.RStop) && c.options.RStop >= 1 && c.options.RStop <= 65536 &&
    formulas.every(f => f.step) && !mappedFieldErrors(formulas.map(f => ({formula: library.find(d => d.id === f.step!.formula)!,iterations:f.step!.iterations!})),1,'sequence',candidate).length;
  if(mappedOK||independentOK) {
    execution = independentOK ? independent : candidate;
    for(const f of formulas.slice(0,groups[0]!.end+1)) {
      if (KERNELS[library.find(d => d.id === f.step!.formula)!.kernel!].role) continue;
      f.step!.parameters.bailout_squared = c.options.RStop as number;
      const extra = f.parameters.find(p => p.target === 'bailout_squared')!;
      extra.value = c.options.RStop!;extra.state='EXACT';extra.reason='Global MB3D radius² escape limit for the mapping group.';
    }
  }
  const counted:BoundedSequenceExecution={kind:'bounded-sequence',distance:'radius-over-w',groups:[{
    start:0,end:formulas.length-1,repeat:repeatPos,maxIterations:numberValue(maximum)}]};
  const boundedOK=!scheduleOK&&c.available&&orderOK&&neutral.source.mandId>=42&&c.mode==='alternating'&&
    (eff?endPos===lastPos:schedule.end1===c.activeSlotOrder.at(-1))&&schedule.rawFirst===(numberValue(schedule.end1)|numberValue(schedule.repeat1)<<4)&&
    c.minimumIterations===1&&c.options.bOptions1===0&&[0,2,4,6].includes(numberValue(c.options.bOptions2))&&
    finite(c.options.RStop)&&c.options.RStop>=1&&c.options.RStop<=65536&&formulas.every(f=>f.step)&&
    !boundedSequenceErrors(formulas.map(f=>({formula:library.find(d=>d.id===f.step!.formula)!,iterations:f.step!.iterations!})),1,'sequence',counted).length;
  if(boundedOK){
    execution=counted;
    for(const f of formulas){
      f.step!.parameters.bailout_squared=c.options.RStop as number;
      const p=f.parameters.find(p=>p.target==='bailout_squared')!;p.value=c.options.RStop!;p.state='EXACT';
      p.reason='Global MB3D radius² escape limit, counted prefix/repeat chain.';
    }
  }
  const difs:BoundedSequenceExecution={...counted,distance:'difs-minimum',...(c.options.bOptions2===4?{fieldStop:'all' as const}:{})};
  const difsOK=c.available&&orderOK&&neutral.source.mandId>=42&&c.mode==='alternating'&&
    (eff?endPos===lastPos:schedule.end1===c.activeSlotOrder.at(-1))&&schedule.rawFirst===(numberValue(schedule.end1)|numberValue(schedule.repeat1)<<4)&&
    c.minimumIterations===1&&c.options.bOptions1===0&&[0,4].includes(numberValue(c.options.bOptions2))&&formulas.every(f=>f.step)&&
    !boundedSequenceErrors(formulas.map(f=>({formula:library.find(d=>d.id===f.step!.formula)!,iterations:f.step!.iterations!})),1,'sequence',difs).length;
  if(difsOK)execution=difs;
  const needed=[...new Set(formulas.flatMap(f=>{const formula=library.find(d=>d.id===(f.step?.formula??f.identity.target)),key=formula?.kernel&&KERNELS[formula.kernel].fieldMapParameter;
    const value=key?(f.step?.parameters[key]??f.parameters.find(p=>p.target===key)?.value):undefined;
    return key&&finite(value)&&!(formula?.id==='mb3d-heightmapifs'&&nearestEven(value)===0)?[nearestEven(value)]:[];}))];
  const mapErrors=fieldMapErrors([...maps]),formulaFields=maps.filter(m=>needed.includes(m.id));
  const resources=needed.map(id=>field(`formulaFields.${id}`,!mapErrors.length&&formulaFields.some(m=>m.id===id&&m.rgb8)?'EXACT':formulaFields.some(m=>m.id===id&&m.status==='AMBIGUOUS')?'AMBIGUOUS':'UNSUPPORTED',
    formulaFields.some(m=>m.id===id&&m.rgb8)?'The original resource is read as RGB8 with periodic B-spline sampling; no gamma conversion.':formulaFields.some(m=>m.id===id&&m.status==='AMBIGUOUS')?'Several original maps have the same number. Choose the right original picture explicitly; none is chosen automatically.':'Missing external formula map. No black map or other picture replaces the resource.',id,'formulaFields'));
  const scheduling = field('formulaChain.scheduling', scheduleOK || mappedOK || independentOK || boundedOK || difsOK ? 'COMPATIBLE_ADAPTER' : 'UNSUPPORTED',
    independentOK?'MaxInv: two independent groups on the original point; max(analytic DE, 2 × render threshold − dIFS). Separate quotas, prefix/repeat and group budgets.':difsOK?`dIFS chain with uncounted transform calls, counted shape calls (at most ${maximum}), prefix/repeat and minimum field / accumulated scale. ${difs.fieldStop==='all'?'The whole minimum field is calculated without early stop. Native switching of inside/outside rays is not transferred; this remains a render limitation.':'Stop uses the distance threshold of the render query × 1.03.'}`:
    boundedOK?`Counted chain: prefix once, repeat from step ${counted.groups[0]!.repeat+1}, at most ${maximum} calls, even in the middle of a quota. Common analytic radius/|w| estimator; no integer rounding to whole blocks.`:
    mappedOK ? `Mapping group ${groups[0]!.start+1}–${groups[0]!.end+1}: at most ${maximum} counted calls (helpers keep quota/order without count/bailout); field group ${groups[1]!.start+1}–${groups[1]!.end+1}: at most ${c.options.iMaxItsF2} calls. Start/end/repeat are preserved, even an end in the middle of a repeat block. dIFS on the mapped point / |w|; the distance threshold comes from the render query of the engine.` :
    scheduleOK ? `The whole block is repeated ${rounds} times; ${maximum} calls, with unchanged step counts.` :
      'The schedule cannot be expressed exactly: groups, prefix, DE combination, interpolation, unknown layout or iteration limit.',
    { mode: c.mode, maximum, schedule, ...(execution ? { execution: execution as unknown as JsonValue } : {}) }, execution ? 'content[0].execution' : 'content[0].rounds / sequence');
  const julia = [field('formulaChain.julia.enabled', 'EXACT', 'Global Julia-flagga.', c.julia.enabled, 'julia.enabled')];
  // Opt in per reviewed identity, never infer C.w independence from a 3D display label.
  // Unknown formulas and transforms that mutate C must keep the fourth-coordinate blocker.
  const unusedJuliaW = formulas.length > 0 && formulas.every(f => f.step &&
    MB3D_FORMULA_MAPPINGS.some(m => m.engineId === f.step!.formula && m.juliaW === 'unused'));
  c.julia.constant.forEach((value, i) => julia.push(field(`formulaChain.julia.constant.${i}`,
    i < 3 ? finite(value) && Math.abs(value) <= 1000 ? 'EXACT' : 'UNSUPPORTED' :
      value === 0 || finite(value) && unusedJuliaW ? 'COMPATIBLE_ADAPTER' : 'UNSUPPORTED',
    i < 3 ? 'Global Julia C (xyz), without rounding; engine limit ±1000.' :
      unusedJuliaW ? 'A reviewed 3D chain never reads C.w. The stored value is preserved in the neutral data; the xyz projection changes neither the orbit nor the analytic derivative w.' :
      'Global Julia w requires a separate 4D coupling. Only w=0 has an adapter.', value, i < 3 ? `julia.c[${i}]` : undefined)));
  const juliaOK = c.julia.constant.length === 4 && julia.every(supported);
  const camera = previewMb3dCamera(neutral);
  const excluded: CompatibilityField[] = [
    ...(['coloringMaterial', 'lighting', 'postprocess', 'references', 'unsupportedLegacyFields', 'legacyRecords'] as const)
      .map(key => field(key, 'UNSUPPORTED', 'Preserved in the neutral data/report; not transferred to the scene in this stage.', neutral[key] as JsonValue)),
    field('formulaChain.options', 'UNSUPPORTED', execution ? 'Other MB3D render/colour flags are preserved. RStop, iMaxItsF2, ADE/inside flags and the group DE variant are used by the reviewed schedule.' : 'Render/DE flags are not transferred. No visual or DE similarity is claimed.', execution ? Object.fromEntries(Object.entries(c.options).filter(([key]) => !(execution.kind==='bounded-sequence'?(execution.distance==='difs-minimum'?[]:['RStop']):['RStop','iMaxItsF2','bOptions1','bOptions2','bOptions3']).includes(key))) : c.options),
    field('formulaChain.minimumIterations', execution ? 'EXACT' : 'UNSUPPORTED', execution ? 'At least one counted call, according to the validated group schedule.' : 'Minimum iterations are not transferred.', c.minimumIterations),
    field('formulaChain.inactiveSlots', 'UNSUPPORTED', 'Inactive slots are preserved, but are not active engine steps.', c.slots.filter(s => !s.active) as unknown as JsonValue),
    field('formulaParameters.undeclared', 'UNSUPPORTED', 'Undeclared and inactive option values are preserved without import.',
      neutral.formulaParameters.map(s => ({ slot: s.slot, parameters: formulas.some(f => f.slot === s.slot) ?
        s.parameters.filter(p => p.declared === false) : s.parameters })) as unknown as JsonValue),
  ];
  let content: FractalContent | null = (scheduleOK || mappedOK || independentOK || boundedOK || difsOK) && resources.every(supported) && !mapErrors.length && juliaOK && formulas.every(f => f.step) && formulas.length <= MAX_CHAIN_STEPS ?
    { type: 'fractal', chain: formulas.map(f => f.step!), rounds: execution ? 1 : rounds, mode: 'sequence', ...(execution ? { execution } : {}),
      julia: { enabled: c.julia.enabled, c: c.julia.constant.slice(0, 3) as [number, number, number] } } : null;
  let reason = 'The chain cannot be applied as a whole. No steps are removed or replaced.';
  if (content) {
    const generated = generateChain(content.chain.map(step => ({ formula: library.find(f => f.id === step.formula)!, iterations: step.iterations! })), content.rounds, {execution});
    if (!generated.ok) { content = null; reason = generated.errors.join(' '); }
  }
  const variants=MB3D_FORMULA_MAPPINGS.filter(m=>m.variant&&formulas.some(f=>f.name===sourceName(m.file))).map(m=>({file:m.file,parameter:m.variant!.parameter,choices:m.variant!.choices,selected:m.variant!.choices.some(c=>c.value===variantSelections[m.file])?variantSelections[m.file]!:null}));
  return { neutral,variantSelections:{...variantSelections},variants, resources, formulaFields:[...formulaFields], formulas, scheduling, julia, camera, excluded, content, canApply: content !== null,
    chain: field('formulaChain', content ? 'COMPATIBLE_ADAPTER' : 'UNSUPPORTED', content ?
      'All active steps, declared parameters, repeat counts and Julia values can be transferred. Camera/view follows the separate review; light/material/post-processing are kept.' : reason,
      c.activeSlotOrder) };
}

/** Revalidate at apply time (library changes and stale previews must never bypass compatibility). */
export function applyMb3dPreset(scene: Scene, preview: Mb3dCompatibilityPreview, library: readonly Formula[]): Scene {
  const checked = previewMb3dPreset(preview.neutral, library, preview.formulaFields,preview.variantSelections);
  if (!checked.content) throw new Error(checked.chain.reason);
  if (!scene.content[0]) throw new Error('The current scene has no fractal content.');
  // View changes use the existing camera/format model; unsupported views keep the current camera.
  const result: Scene = { ...scene, ...(checked.formulaFields.length?{formulaFields:structuredClone(checked.formulaFields)}:{formulaFields:undefined}), content: [structuredClone(checked.content), ...scene.content.slice(1)],
    ...(checked.camera.camera ? {camera:structuredClone(checked.camera.camera),render:{...scene.render,
      fov_axis:'vertical',...(checked.camera.format ? {format:structuredClone(checked.camera.format),resolution:undefined} : {})}} : {}) };
  const parsed = parseScene(result);
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  const resolved = resolveScene(result, library);
  if (!resolved.ok) throw new Error(resolved.errors.join(' '));
  if (resolved.warnings.length) throw new Error(resolved.warnings.join(' '));
  return result;
}
