/**
 * FORMULA-IMPORTER-01: reads the outer structure of a Mandelbulb 3D formula file (.m3f) and says what kind of file it is.
 *
 *   [OPTIONS]   one line per setting: `.Double Name = value`, plus a few host settings (`.DEScale`, `.DEOption`, ...)
 *   [CONSTANTS] constant table of a machine-code formula (never needed here)
 *   [SOURCE]    readable Pascal-like source of a JIT formula (this is what the importer can translate)
 *   [CODE]      machine code as hex text. It is NEVER decoded, executed or translated: a file with only [CODE] is reported as
 *               "machine code without a usable description" and left alone.
 *
 * The file is data. Nothing in it is executed. Size and line limits keep a damaged or hostile file from costing anything.
 */
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_SOURCE_LINES = 400;

export type M3fKind = 'jit-source' | 'machine-code' | 'unsupported';

export interface M3fOption { type: string; name: string; value: number; line: number }
export interface M3fHostSetting { name: string; value: number }
export interface M3fFile {
  kind: M3fKind;
  /** Why the file got this kind, in plain words (used by the inventory and the dialog). */
  reason: string;
  options: M3fOption[];
  host: M3fHostSetting[];
  /** Named numeric constants of the file's own [CONSTANTS] section (`.Double name = value`). Fixed numbers, never parameters. */
  constants: M3fOption[];
  /** The readable source, only for `jit-source`. The hex code block is never copied into this structure. */
  source: string | null;
  sections: string[];
}

const SECTION = /^\[([A-Za-z]+)\]\s*$/;
const OPTION_TYPES = new Set(['Double', 'Single', 'Integer', '3SingleAngles', '6SingleAngles', '2Doubles', 'Boolean', '3Doubles']);

export function readM3f(text: string): M3fFile {
  const fail = (reason: string): M3fFile => ({ kind: 'unsupported', reason, options: [], constants: [], host: [], source: null, sections: [] });
  if (typeof text !== 'string' || text.length === 0) return fail('The file is empty.');
  if (text.length > MAX_FILE_BYTES) return fail(`The file is larger than ${MAX_FILE_BYTES} characters.`);
  if (text.includes('\u0000')) return fail('The file contains binary data and is not a text formula file.');
  const lines = text.split(/\r?\n/);
  const bodies = new Map<string, string[]>(); const order: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    const m = SECTION.exec(line.trim());
    if (m) { current = m[1]!.toUpperCase(); if (bodies.has(current)) return fail(`The section [${m[1]}] occurs twice.`); bodies.set(current, []); order.push(current); continue; }
    if (current && current !== 'CODE') bodies.get(current)!.push(line); // the hex block is skipped, not stored
  }
  if (!bodies.has('OPTIONS')) return fail('There is no [OPTIONS] section: this is not a Mandelbulb 3D formula file.');
  const options: M3fOption[] = [], host: M3fHostSetting[] = [];
  (bodies.get('OPTIONS') ?? []).forEach((raw, i) => {
    const m = /^\.(\S+)(?:\s+(.+?))?\s*=\s*(.+?)\s*$/.exec(raw.trim());
    if (!m) return;
    const first = m[1]!, name = m[2], value = Number(m[3]);
    if (OPTION_TYPES.has(first) && name !== undefined) options.push({ type: first, name: name.trim(), value, line: i + 1 });
    else if (name === undefined && Number.isFinite(value)) host.push({ name: first, value });
    else if (name !== undefined) options.push({ type: first, name: name.trim(), value, line: i + 1 }); // an unknown type: kept so the importer can name it
  });
  const constants: M3fOption[] = [];
  (bodies.get('CONSTANTS') ?? []).forEach((raw, i) => {
    const m = /^\.(\S+)\s+(\S+)\s*=\s*(.+?)\s*$/.exec(raw.trim());
    if (m) constants.push({ type: m[1]!, name: m[2]!, value: Number(m[3]), line: i + 1 });
  });
  const sections = order.map((s) => s);
  if (bodies.has('SOURCE')) {
    const source = bodies.get('SOURCE')!.join('\n');
    if (source.split('\n').length > MAX_SOURCE_LINES) return { ...fail(`The source is longer than ${MAX_SOURCE_LINES} lines.`), options, constants, host, sections };
    return { kind: 'jit-source', reason: 'Readable JIT source is present.', options, constants, host, source, sections };
  }
  if (order.includes('CODE')) return { kind: 'machine-code', constants: [], reason: 'Only machine code is stored. It is not read, decoded or run; the formula needs a mathematical description or manual reconstruction.', options, host, source: null, sections };
  return { ...fail('Neither [SOURCE] nor [CODE] is present.'), options, constants, host, sections };
}
