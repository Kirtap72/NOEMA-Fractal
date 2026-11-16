/**
 * A writer for OpenEXR files (an open image format for pictures with decimal numbers per pixel, used
 * for depth, normals and other layers by Blender, Unreal, Nuke and many more).
 *
 * Single-part, uncompressed scanlines: the streamed writer supports half/full float beauty; the older whole-image helper writes Float32 layers.
 * The file layout follows the OpenEXR technical introduction:
 * magic number and version, a header of named attributes ending with a zero byte, a table with the position
 * of each scanline, and then the scanlines (a line number, a byte count, and the pixels of each channel).
 */

import {floatToHalf} from './radiance';

export interface ExrChannel {
  /** Channel name, for example "Z" or "N.X". Channels are stored in alphabetical order, as the format requires. */
  name: string;
  /** width x height numbers, the top row first. */
  data: Float32Array;
}

export interface ExrChannelLayout {
  name: string;
  component: number;
  type: 'half' | 'float';
}

export interface ExrStreamOptions {
  precision?: 'half' | 'float';
  /** Interleaved component indices permit future passes without changing file framing. */
  channels?: readonly ExrChannelLayout[];
  metadata?: Readonly<Record<string, string | number>>;
}

/** Single-part, uncompressed scanlines; offsets are known before rendering, so no seek or whole image is needed.
 * Format reference: https://openexr.com/en/latest/OpenEXRFileLayout.html. Own implementation. */
export class ExrStreamWriter {
  private row = 0;
  private busy = false;
  private failed = false;
  private finished = false;

  private constructor(
    private width: number,
    private height: number,
    private channels: readonly ExrChannelLayout[],
    private write: (bytes: Uint8Array) => void | Promise<void>,
  ) {}

  static async create(
    width: number,
    height: number,
    write: (bytes: Uint8Array) => void | Promise<void>,
    options: ExrStreamOptions = {},
  ): Promise<ExrStreamWriter> {
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n < 2 ** 31)) {
      throw Error('Invalid EXR dimensions');
    }
    if (options.precision !== undefined && !['half', 'float'].includes(options.precision)) {
      throw Error('Invalid EXR precision');
    }
    const type = options.precision ?? 'half';
    const channels = [...(options.channels ?? [
      {name: 'R', component: 0, type}, {name: 'G', component: 1, type},
      {name: 'B', component: 2, type}, {name: 'A', component: 3, type},
    ])].map(c => ({...c})).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    if (!channels.length || new Set(channels.map(c => c.name)).size !== channels.length ||
        channels.some(c => !/^[\x21-\x7e]{1,31}$/.test(c.name) ||
          !Number.isSafeInteger(c.component) || c.component < 0 || !['half', 'float'].includes(c.type))) {
      throw Error('Invalid EXR channel layout');
    }
    const list: number[] = [];
    for (const c of channels) {
      list.push(...encoder.encode(c.name), 0, ...int32s(c.type === 'half' ? 1 : 2),
        0, 0, 0, 0, ...int32s(1, 1));
    }
    list.push(0);
    const box = int32s(0, 0, width - 1, height - 1);
    const attrs = [
      attribute('channels', 'chlist', Uint8Array.from(list)),
      attribute('compression', 'compression', Uint8Array.of(0)),
      attribute('dataWindow', 'box2i', box),
      attribute('displayWindow', 'box2i', box),
      attribute('lineOrder', 'lineOrder', Uint8Array.of(0)),
      attribute('pixelAspectRatio', 'float', float32s(1)),
      attribute('screenWindowCenter', 'v2f', float32s(0, 0)),
      attribute('screenWindowWidth', 'float', float32s(1)),
      attribute('chromaticities', 'chromaticities', float32s(.64, .33, .30, .60, .15, .06, .3127, .3290)),
    ];
    const used = new Set(['chromaticities', 'channels', 'compression', 'dataWindow', 'displayWindow',
      'lineOrder', 'pixelAspectRatio', 'screenWindowCenter', 'screenWindowWidth']);
    for (const [name, value] of Object.entries(options.metadata ?? {})) {
      if (!/^[\x21-\x7e]{1,31}$/.test(name) || used.has(name) ||
          typeof value === 'number' && !Number.isFinite(value) ||
          typeof value !== 'number' && typeof value !== 'string') {
        throw Error('Invalid EXR metadata');
      }
      used.add(name);
      attrs.push(attribute(name, typeof value === 'number' ? 'float' : 'string',
        typeof value === 'number' ? float32s(value) : encoder.encode(value)));
    }
    const headerLength = attrs.reduce((n, a) => n + a.length, 0) + 1;
    const header = new Uint8Array(8 + headerLength);
    header.set([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]);
    let at = 8;
    for (const a of attrs) {
      header.set(a, at);
      at += a.length;
    }
    const lineBytes = width * channels.reduce((n, c) => n + (c.type === 'half' ? 2 : 4), 0);
    const first = header.length + height * 8;
    const block = 8 + lineBytes;
    if (lineBytes >= 2 ** 31 || !Number.isSafeInteger(first + block * height)) {
      throw Error('EXR layout exceeds numeric/scanline limits');
    }
    await write(header);
    // Bounded offset table, including very tall images.
    for (let y = 0; y < height; y += 8192) {
      const count = Math.min(8192, height - y);
      const bytes = new Uint8Array(count * 8);
      const view = new DataView(bytes.buffer);
      for (let j = 0; j < count; j++) {
        view.setBigUint64(j * 8, BigInt(first + (y + j) * block), true);
      }
      await write(bytes);
    }
    return new ExrStreamWriter(width, height, channels, write);
  }

  async writeRows(values: Float32Array, rows: number, stride = 4): Promise<void> {
    if (this.finished || this.failed || this.busy) {
      throw Error('EXR writer is finished, failed or already writing');
    }
    if (!Number.isSafeInteger(rows) || rows < 1 || this.row + rows > this.height ||
        !Number.isSafeInteger(stride) || stride < 1 || this.channels.some(c => c.component >= stride) ||
        values.length !== this.width * rows * stride) {
      throw Error('Invalid EXR row data');
    }
    this.busy = true;
    try {
      const lineBytes = this.width * this.channels.reduce((n, c) => n + (c.type === 'half' ? 2 : 4), 0);
      const block = 8 + lineBytes;
      const chunkRows = Math.max(1, Math.floor(512 * 1024 / block));
      for (let y = 0; y < rows; y += chunkRows) {
        const count = Math.min(chunkRows, rows - y);
        const bytes = new Uint8Array(count * block);
        const view = new DataView(bytes.buffer);
        let at = 0;
        for (let j = 0; j < count; j++) {
          view.setInt32(at, this.row + y + j, true);
          view.setInt32(at + 4, lineBytes, true);
          at += 8;
          for (const c of this.channels) {
            for (let x = 0; x < this.width; x++) {
              const v = values[((y + j) * this.width + x) * stride + c.component]!;
              if (!Number.isFinite(v) || c.type === 'half' && Math.abs(v) > 65504) {
                throw Error('EXR channel value exceeds finite precision range; choose Float32 for values above 65504');
              }
              if (c.type === 'half') {
                view.setUint16(at, floatToHalf(v), true);
                at += 2;
              } else {
                view.setFloat32(at, v, true);
                at += 4;
              }
            }
          }
        }
        await this.write(bytes);
      }
      this.row += rows;
    } catch (e) {
      this.failed = true;
      throw e;
    } finally {
      this.busy = false;
    }
  }

  finish(): void {
    if (this.failed || this.busy || this.finished || this.row !== this.height) {
      throw Error('EXR image is incomplete or writer unavailable');
    }
    this.finished = true;
  }
}


const encoder = new TextEncoder();

function attribute(name: string, type: string, value: Uint8Array): Uint8Array {
  const n = encoder.encode(name);
  const t = encoder.encode(type);
  const out = new Uint8Array(n.length + 1 + t.length + 1 + 4 + value.length);
  let o = 0;
  out.set(n, o);
  o += n.length + 1; // the name ends with a zero byte
  out.set(t, o);
  o += t.length + 1;
  new DataView(out.buffer).setInt32(o, value.length, true);
  o += 4;
  out.set(value, o);
  return out;
}

function int32s(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const v = new DataView(out.buffer);
  values.forEach((x, i) => v.setInt32(i * 4, x, true));
  return out;
}

function float32s(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const v = new DataView(out.buffer);
  values.forEach((x, i) => v.setFloat32(i * 4, x, true));
  return out;
}

/** Builds an OpenEXR file. */
export function encodeExr(width: number, height: number, channels: readonly ExrChannel[]): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("width and height must be whole numbers, 1 or more");
  }
  if (channels.length === 0) throw new Error("at least one channel is needed");
  const names = new Set<string>();
  for (const c of channels) {
    if (c.name.length === 0 || c.name.includes("\0")) throw new Error("a channel name must be text without zero bytes");
    if (names.has(c.name)) throw new Error(`channel "${c.name}" is used twice`);
    names.add(c.name);
    if (c.data.length !== width * height) throw new Error(`channel "${c.name}" must have ${width * height} numbers`);
  }
  const sorted = [...channels].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Channel list: name, pixel type 2 (32-bit float), then padding and sampling (1 and 1), and a final zero byte.
  const chlist: number[] = [];
  for (const c of sorted) {
    chlist.push(...encoder.encode(c.name), 0);
    chlist.push(...int32s(2), 0, 0, 0, 0, ...int32s(1, 1));
  }
  chlist.push(0);

  const box = int32s(0, 0, width - 1, height - 1);
  const header = [
    ...attribute("channels", "chlist", Uint8Array.from(chlist)),
    ...attribute("compression", "compression", Uint8Array.of(0)), // none
    ...attribute("dataWindow", "box2i", box),
    ...attribute("displayWindow", "box2i", box),
    ...attribute("lineOrder", "lineOrder", Uint8Array.of(0)), // lines increase downward
    ...attribute("pixelAspectRatio", "float", float32s(1)),
    ...attribute("screenWindowCenter", "v2f", float32s(0, 0)),
    ...attribute("screenWindowWidth", "float", float32s(1)),
    0, // end of header
  ];

  const prefix = 8; // magic number and version
  const tableBytes = 8 * height;
  const lineBytes = width * 4 * sorted.length;
  const blockBytes = 8 + lineBytes;
  const total = prefix + header.length + tableBytes + blockBytes * height;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  out.set([0x76, 0x2f, 0x31, 0x01], 0); // magic number
  out.set([2, 0, 0, 0], 4); // version 2, no special flags
  out.set(header, prefix);
  const firstBlock = prefix + header.length + tableBytes;
  for (let y = 0; y < height; y++) {
    view.setBigUint64(prefix + header.length + 8 * y, BigInt(firstBlock + blockBytes * y), true);
  }
  for (let y = 0; y < height; y++) {
    let o = firstBlock + blockBytes * y;
    view.setInt32(o, y, true);
    view.setInt32(o + 4, lineBytes, true);
    o += 8;
    for (const c of sorted) {
      for (let x = 0; x < width; x++, o += 4) view.setFloat32(o, c.data[y * width + x]!, true);
    }
  }
  return out;
}

/** The depth layer as an EXR channel list: one channel "Z". */
export function depthChannels(depth: Float32Array): ExrChannel[] {
  return [{ name: "Z", data: depth }];
}

/** The normals (three numbers per pixel) as an EXR channel list: "N.X", "N.Y", "N.Z". */
export function normalChannels(normal: Float32Array): ExrChannel[] {
  const n = normal.length / 3;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = normal[i * 3]!;
    y[i] = normal[i * 3 + 1]!;
    z[i] = normal[i * 3 + 2]!;
  }
  return [
    { name: "N.X", data: x },
    { name: "N.Y", data: y },
    { name: "N.Z", data: z },
  ];
}
