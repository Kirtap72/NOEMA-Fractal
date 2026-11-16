import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { KB, validateKb } from '../src/knowledge/kb';
import { GROUP_TEMPLATES } from '../src/engine/formula/groupCreate';
import { buildLibrary } from '../src/engine/formula/library';

describe('public distribution data boundary', () => {
  it('contains no preset-derived recipes or research corpus records', () => {
    expect(GROUP_TEMPLATES).toEqual([]);
    expect(KB.cases).toEqual([]);
    expect(KB.experiments).toEqual([]);
    expect(KB.findings).toEqual([]);
    expect(KB.relations.corpusPairs).toEqual([]);
    expect(KB.relations.corpusBigramsTop).toEqual([]);
    expect(KB.relations.publicBigramsTop).toEqual([]);
    expect(KB.relations.observedEffects).toEqual([]);
    for (const f of KB.formulas) {
      expect(f.usage).toBeUndefined();
      expect(f.legacyParameterRanges).toBeUndefined();
    }
    expect(validateKb()).toEqual([]);
  });
  it('retains attribution and valid definitions for all built-in formulas', () => {
    const files = Object.fromEntries(readdirSync('formulas').filter(f => f.endsWith('.yaml')).map(f => [f, readFileSync('formulas/' + f, 'utf8')]));
    const lib = buildLibrary(files);
    expect(lib.problems).toEqual([]);
    expect(lib.formulas.length).toBeGreaterThan(200);
    const credits = readFileSync('CREDITS.md', 'utf8');
    for (const f of lib.formulas) {
      // Generated variants inherit their base formula's metadata.
      expect(f.credits.length).toBeGreaterThan(0);
      for (const credit of f.credits) expect(credits).toContain(credit.name);
    }
  });
});
