import type { NeutralMb3dPreset } from './types';

/** Compare surviving active formulas by identity, so legacy DE reordering is visible, not a false parameter failure. */
export function compareNativePreset(stored: NeutralMb3dPreset, native: NeutralMb3dPreset) {
  const unmatched = [...native.formulaChain.slots.filter(s => s.active)];
  const formulaComparisons = stored.formulaChain.slots.filter(s => s.active).map(slot => {
    const index = unmatched.findIndex(s => s.name?.toLowerCase() === slot.name?.toLowerCase());
    const loaded = index < 0 ? null : unmatched.splice(index, 1)[0]!;
    const originalParameters = stored.formulaParameters[slot.parameterSet]!;
    const loadedParameters = loaded ? native.formulaParameters[loaded.parameterSet]! : null;
    const count = Math.max(0, Math.min(16, originalParameters.declaredCount ?? 16, loadedParameters?.declaredCount ?? 0));
    const mismatches = Array.from({length:count},(_,i) => i).filter(i => originalParameters.parameters[i]!.rawHex !== loadedParameters!.parameters[i]!.rawHex);
    return { name: slot.name, storedSlot: slot.slot, nativeSlot: loaded?.slot ?? null,
      storedIterations: slot.iterations, nativeIterations: loaded?.iterations ?? null,
      storedWeight: slot.weight, nativeWeight: loaded?.weight ?? null,
      storedIterationEncoding: slot.iterationEncoding, nativeIterationEncoding: loaded?.iterationEncoding ?? null,
      storedParameterCount: originalParameters.declaredCount, nativeParameterCount: loadedParameters?.declaredCount ?? null,
      comparedParameterCount: count, parameterMismatches: mismatches,
      status: !loaded ? 'missing-or-renamed-in-native-export' : !count ? 'no-declared-parameters-compared' : mismatches.length ? 'parameters-changed-on-load' : 'stored-parameter-prefix-identical' };
  });
  return { storedMandId: stored.source.mandId, nativeMandId: native.source.mandId,
    storedActiveNames: stored.formulaChain.slots.filter(s=>s.active).map(s=>s.name),
    nativeActiveNames: native.formulaChain.slots.filter(s=>s.active).map(s=>s.name),
    formulaComparisons, additionalNativeFormulas: unmatched.map(s=>s.name),
    note: 'Source names/values only; missing metadata, load migrations and image fidelity need separate validation. No validation flag is changed.' };
}
