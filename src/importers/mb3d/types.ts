export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type LegacyRecord = { [key: string]: JsonValue };
export interface FormulaSlot {
  slot: number;
  legacyId: number;
  storedName: string;
  name: string | null;
  active: boolean;
  iterations: number | null;
  storedIterationWord: number;
  iterationEncoding: 'int32-count' | 'float32-weight';
  weight: JsonValue;
  parameterSet: number;
}
export interface FormulaParameterSet {
  slot: number;
  declaredCount: number | null;
  parameters: { index: number; declared: boolean | null; typeCode: number | null; typeName: string | null; value: JsonValue; rawHex: string }[];
}
export interface NeutralMb3dPreset {
  format: 'mb3d-neutral';
  version: 1;
  source: {
    kind: 'm3p-binary' | 'mb3d-text'; fileName: string | null;
    mandId: number; headerType: string; headerBytes: number;
    textVersion: number | null; title: string | null; programVersion: JsonValue;
    encoding: string; authoritativeSourceCommit: string;
    originalInput: { hex?: string; text?: string }; decodedPayloadHex: string;
    authors: string[];
  };
  formulaChain: {
    available: boolean; mode: string | null; modeCode: number | null;
    slots: FormulaSlot[]; activeSlotOrder: number[];
    globalMaximumIterations: JsonValue; minimumIterations: JsonValue;
    julia: { enabled: boolean; constant: JsonValue[]; rawFlag: JsonValue };
    scheduling: LegacyRecord; options: LegacyRecord;
    legacyInline: LegacyRecord | null;
  };
  formulaParameters: FormulaParameterSet[];
  cameraView: LegacyRecord;
  coloringMaterial: LegacyRecord;
  lighting: LegacyRecord;
  postprocess: LegacyRecord;
  references: LegacyRecord;
  legacyRecords: { header: LegacyRecord; formulaAddon: LegacyRecord | null };
  unsupportedLegacyFields: LegacyRecord;
  compatibility: { warnings: string[]; requiredLoadTransforms: string[]; nativeValidation: 'not-verified' };
}
export interface ParseOptions { fileName?: string; ansiEncoding?: string; maxInputBytes?: number }
