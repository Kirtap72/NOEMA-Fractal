/**
 * A PNG writer that takes the picture a few rows at a time and writes the file as it goes, so a very large
 * picture never has to be kept whole in memory. The compression is done by the browser's own
 * CompressionStream ("deflate" is the zlib format PNG uses). Only the parts of PNG needed here:
 * 8 bits per channel RGB, filter type 1 ("Sub"), and optional UTF-8 text chunks (iTXt) for credits.
 * Format: the PNG specification (W3C / ISO 15948), public.
 */

/** The size of the image data chunks. */
const IDAT_SIZE = 262_144;

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The checksum PNG puts at the end of every chunk (CRC-32 of the type and the data). */
export function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts) for (let i = 0; i < part.length; i++) c = CRC_TABLE[(c ^ part[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const t = ascii(type);
  out.set(t, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(t, data));
  return out;
}

/** An international text chunk: a keyword (1 to 79 plain characters) and a UTF-8 text. */
function textChunk(keyword: string, text: string): Uint8Array {
  if (!/^[\x20-\x7e]{1,79}$/.test(keyword)) throw new Error("a PNG text keyword is 1 to 79 plain characters");
  const body = new TextEncoder().encode(text);
  const key = ascii(keyword);
  // keyword, 0, not compressed, method 0, empty language tag, 0, empty translated keyword, 0, the text
  const data = new Uint8Array(key.length + 5 + body.length);
  data.set(key, 0);
  data.set(body, key.length + 5);
  return chunk("iTXt", data);
}

export type PngWriteFn = (bytes: Uint8Array) => void | Promise<void>;

export class PngStreamWriter {
  private rowsWritten = 0;
  private compressor = new CompressionStream("deflate");
  private input: WritableStreamDefaultWriter<Uint8Array>;
  private pump: Promise<void>;
  private finished = false;

  private constructor(
    readonly width: number,
    readonly height: number,
    private write: PngWriteFn,
  ) {
    this.input = this.compressor.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
    this.pump = this.readCompressed();
    // Output may fail before finish() awaits the pump; keep errors owned by this writer.
    void this.pump.catch(() => undefined);
  }

  /** Starts a file: writes the signature, the header and the text chunks. `text` maps a keyword to a UTF-8 text. */
  static async create(width: number, height: number, write: PngWriteFn, text: Record<string, string> = {}): Promise<PngStreamWriter> {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff) {
      throw new Error("the picture size must be whole numbers, 1 or more");
    }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header.set([8, 2, 0, 0, 0], 8); // 8 bits, colour type 2 (RGB), standard compression, standard filtering, no interlace
    await write(SIGNATURE);
    await write(chunk("IHDR", header));
    for (const [keyword, value] of Object.entries(text)) await write(textChunk(keyword, value));
    return new PngStreamWriter(width, height, write);
  }

  /** Takes the compressed bytes as they come out and writes them as image data chunks of about 256 KB. */
  private async readCompressed(): Promise<void> {
    const reader = this.compressor.readable.getReader();
    let pending: Uint8Array[] = [];
    let size = 0;
    const flush = async (): Promise<void> => {
      if (size === 0) return;
      const data = new Uint8Array(size);
      let at = 0;
      for (const p of pending) {
        data.set(p, at);
        at += p.length;
      }
      pending = [];
      size = 0;
      // Chunks of at most 256 KB, however much the compressor gave at once.
      for (let from = 0; from < data.length; from += IDAT_SIZE) await this.write(chunk("IDAT", data.subarray(from, from + IDAT_SIZE)));
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending.push(value as Uint8Array);
        size += value.length;
        if (size >= IDAT_SIZE) await flush();
      }
      await flush();
    } catch (error) {
      // Release compressor backpressure on disk/memory failure so pending row writes cannot hang.
      await reader.cancel(error).catch(() => undefined);
      throw error;
    }
  }

  /** Adds `rows` rows of RGBA pixels (alpha is dropped, the picture is opaque). */
  async writeRows(rgba: Uint8Array, rows: number): Promise<void> {
    if (this.finished) throw new Error("the PNG file is already finished");
    if (!Number.isInteger(rows) || rows < 1 || this.rowsWritten + rows > this.height) throw new Error("more rows than the picture has");
    if (rgba.length < rows * this.width * 4) throw new Error("not enough pixels for the rows");
    const stride = this.width * 3 + 1;
    const filtered = new Uint8Array(stride * rows);
    for (let y = 0; y < rows; y++) {
      const src = y * this.width * 4;
      const dst = y * stride;
      filtered[dst] = 1; // filter type 1: each byte minus the byte one pixel to the left
      for (let x = 0; x < this.width; x++) {
        for (let c = 0; c < 3; c++) {
          const here = rgba[src + x * 4 + c]!;
          const left = x === 0 ? 0 : rgba[src + (x - 1) * 4 + c]!;
          filtered[dst + 1 + x * 3 + c] = (here - left) & 0xff;
        }
      }
    }
    await this.input.write(filtered);
    this.rowsWritten += rows;
  }

  /** Ends the file. All rows must have been written. */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (this.rowsWritten !== this.height) {
      await this.input.abort().catch(() => undefined);
      await this.pump.catch(() => undefined);
      throw new Error(`the picture has ${this.height} rows but ${this.rowsWritten} were written`);
    }
    await this.input.close();
    await this.pump;
    await this.write(chunk("IEND", new Uint8Array(0)));
  }

  /** Gives up without finishing (for example when the render was cancelled). */
  async abort(): Promise<void> {
    this.finished = true;
    await this.input.abort().catch(() => undefined);
    await this.pump.catch(() => undefined);
  }
}
