import type { JsonValue, LegacyRecord } from './types';
import layouts from './layout.json';

interface Field {
  name?: string; recordType?: string; offset?: number; kind: string; size: number;
  count?: number; lowerBound?: number; element?: Field;
}
interface Layout { size: number; fields: Field[] }
export const RECORDS = layouts as Record<string, Layout>;
export const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export class Mb3dParseError extends Error {
  constructor(readonly code: string, message: string, readonly offset?: number) {
    super(message); this.name = 'Mb3dParseError';
  }
}

/** Packed Win32 disk records, independently read as data; pointers are never followed. */
export class RecordReader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  require(offset: number, length: number) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > this.bytes.length)
      throw new Mb3dParseError('TRUNCATED', `Missing ${length} bytes at offset ${offset}`, offset);
  }
  record(name: string, offset = 0): LegacyRecord {
    const layout = RECORDS[name];
    if (!layout) throw new Mb3dParseError('LAYOUT', `Unknown record ${name}`);
    this.require(offset, layout.size);
    return Object.fromEntries(layout.fields.map(f => [f.name!, this.field(f, offset + f.offset!)]));
  }
  field(f: Field, offset: number): JsonValue {
    this.require(offset, f.size);
    const d = this.view;
    switch (f.kind) {
      case 'record': return this.record(f.recordType!, offset);
      case 'array': return Array.from({length:f.count!}, (_, i) => this.field(f.element!, offset + i * f.element!.size));
      case 'u8': return d.getUint8(offset);
      case 'i8': return d.getInt8(offset);
      case 'u16': return d.getUint16(offset, true);
      case 'i16': return d.getInt16(offset, true);
      case 'u32': return d.getUint32(offset, true);
      case 'i32': return d.getInt32(offset, true);
      case 'shortfloat': return d.getInt8(offset) * 10 ** (Math.max(-25, Math.min(25, d.getInt8(offset + 1))) - 1);
      case 'd7': {
        const full = new Uint8Array(8); full.set(this.bytes.subarray(offset, offset + 7), 1);
        return this.float(new DataView(full.buffer).getFloat64(0, true), offset, 7);
      }
      case 'f32': return this.float(d.getFloat32(offset, true), offset, 4);
      case 'f64': return this.float(d.getFloat64(offset, true), offset, 8);
      default: throw new Mb3dParseError('LAYOUT', `Unknown field kind ${f.kind}`);
    }
  }
  private float(value: number, offset: number, size: number): JsonValue {
    if (Number.isFinite(value) && !Object.is(value, -0)) return value;
    return { kind: 'special-float', value: Object.is(value, -0) ? '-0' : String(value),
      rawHex: hex(this.bytes.subarray(offset, offset + size)), storageBytes: size };
  }
}
