/**
 * A small ZIP file writer ("stored", no compression: PNG files are compressed already).
 * Used to hand over a whole image sequence as one download when the browser cannot write to a folder.
 * Limits of this simple format: at most 65 535 files and 4 GB in total.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const MAX_ENTRIES = 65535;
const MAX_BYTES = 0xffffffff - 1_000_000;

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Entry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

export class ZipWriter {
  private parts: BlobPart[] = [];
  private entries: Entry[] = [];
  private offset = 0;
  private stamp: {time:number;date:number};
  constructor(date=new Date()){this.stamp=dosDateTime(date);}

  /** Adds a portable relative UTF-8 path, including subdirectories. */
  async add(name: string, blob: Blob): Promise<void> {
    if(!name||name.startsWith('/')||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='..'||p==='.'))throw new Error('Unsafe ZIP path');
    if(this.entries.some(e=>new TextDecoder().decode(e.name)===name))throw new Error('Duplicate ZIP path');
    if (this.entries.length >= MAX_ENTRIES) throw new Error("A ZIP file can hold at most 65 535 files.");
    if (this.offset + blob.size > MAX_BYTES) throw new Error("The ZIP file would be larger than 4 GB. Save to a folder instead.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(bytes);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // names are UTF-8
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, this.stamp.time, true);
    header.setUint16(12, this.stamp.date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);

    this.entries.push({ name: nameBytes, crc, size: bytes.length, offset: this.offset });
    this.parts.push(header.buffer, nameBytes.slice().buffer, bytes.buffer);
    this.offset += 30 + nameBytes.length + bytes.length;
  }

  get fileCount(): number {
    return this.entries.length;
  }

  /** The finished ZIP file. */
  finish(): Blob {
    const central: BlobPart[] = [];
    let centralSize = 0;
    for (const e of this.entries) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true); // made by
      h.setUint16(6, 20, true); // needed
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, this.stamp.time, true);
      h.setUint16(14, this.stamp.date, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.size, true);
      h.setUint32(24, e.size, true);
      h.setUint16(28, e.name.length, true);
      h.setUint32(42, e.offset, true);
      central.push(h.buffer, e.name.slice().buffer);
      centralSize += 46 + e.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...central, end.buffer], { type: "application/zip" });
  }
}
