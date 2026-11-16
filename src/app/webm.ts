/**
 * A small WebM (Matroska) file writer for one video track, used to wrap frames from the browser's video
 * encoder into a file that every player and editor can open. WebM is an open format.
 *
 * Layout written: the EBML header, then one Segment holding SeekHead, Info, Tracks, the Clusters (each a
 * short run of frames, starting at a key frame) and Cues (for seeking). All sizes are known when the file
 * is finished, so no unknown-size elements are needed.
 */

// Element ids from the Matroska specification.
const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  EBMLVersion: [0x42, 0x86],
  EBMLReadVersion: [0x42, 0xf7],
  EBMLMaxIDLength: [0x42, 0xf2],
  EBMLMaxSizeLength: [0x42, 0xf3],
  DocType: [0x42, 0x82],
  DocTypeVersion: [0x42, 0x87],
  DocTypeReadVersion: [0x42, 0x85],
  Segment: [0x18, 0x53, 0x80, 0x67],
  SeekHead: [0x11, 0x4d, 0x9b, 0x74],
  Seek: [0x4d, 0xbb],
  SeekID: [0x53, 0xab],
  SeekPosition: [0x53, 0xac],
  Info: [0x15, 0x49, 0xa9, 0x66],
  TimecodeScale: [0x2a, 0xd7, 0xb1],
  Duration: [0x44, 0x89],
  MuxingApp: [0x4d, 0x80],
  WritingApp: [0x57, 0x41],
  Tracks: [0x16, 0x54, 0xae, 0x6b],
  TrackEntry: [0xae],
  TrackNumber: [0xd7],
  TrackUID: [0x73, 0xc5],
  TrackType: [0x83],
  CodecID: [0x86],
  Video: [0xe0],
  PixelWidth: [0xb0],
  PixelHeight: [0xba],
  Cluster: [0x1f, 0x43, 0xb6, 0x75],
  Timecode: [0xe7],
  SimpleBlock: [0xa3],
  Cues: [0x1c, 0x53, 0xbb, 0x6b],
  CuePoint: [0xbb],
  CueTime: [0xb3],
  CueTrackPositions: [0xb7],
  CueTrack: [0xf7],
  CueClusterPosition: [0xf1],
} as const;

const textEncoder = new TextEncoder();

/** The size field of an element: a number in 1 to 8 bytes, where the first bits say how many bytes. */
function sizeBytes(n: number): Uint8Array {
  let length = 1;
  while (length < 8 && n >= 2 ** (7 * length) - 1) length++;
  const out = new Uint8Array(length);
  let v = n;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0]! |= 0x80 >> (length - 1);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function element(id: readonly number[], payload: Uint8Array): Uint8Array {
  return concat([Uint8Array.from(id), sizeBytes(payload.length), payload]);
}

/** A whole number of the given width in bytes (a fixed width keeps positions from changing sizes). */
function uint(value: number, width?: number): Uint8Array {
  let bytes = width ?? Math.max(1, Math.ceil(Math.log2(value + 1) / 8));
  if (!width && value >= 2 ** (8 * bytes)) bytes++;
  const out = new Uint8Array(bytes);
  let v = value;
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

function float64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return out;
}

const text = (s: string): Uint8Array => textEncoder.encode(s);

/** A frame from the encoder. */
export interface EncodedFrame {
  /** Milliseconds from the start. */
  timeMs: number;
  keyFrame: boolean;
  data: Uint8Array;
}

export interface WebmOptions {
  width: number;
  height: number;
  /** Length of the video in milliseconds. */
  durationMs: number;
  /** For example "V_VP9". */
  codec?: string;
}

const MAX_CLUSTER_MS = 30000; // the time of a block inside a cluster is a 16-bit number of milliseconds

/** Builds the finished WebM file from encoded frames (in time order; the first must be a key frame). */
export function buildWebm(frames: readonly EncodedFrame[], options: WebmOptions): Uint8Array {
  if (frames.length === 0) throw new Error("there are no frames to write");
  if (!frames[0]!.keyFrame) throw new Error("the first frame must be a key frame");
  if (!Number.isInteger(options.width) || !Number.isInteger(options.height) || options.width < 1 || options.height < 1) {
    throw new Error("width and height must be whole numbers, 1 or more");
  }

  const header = element(
    ID.EBML,
    concat([
      element(ID.EBMLVersion, uint(1)),
      element(ID.EBMLReadVersion, uint(1)),
      element(ID.EBMLMaxIDLength, uint(4)),
      element(ID.EBMLMaxSizeLength, uint(8)),
      element(ID.DocType, text("webm")),
      element(ID.DocTypeVersion, uint(4)),
      element(ID.DocTypeReadVersion, uint(2)),
    ]),
  );

  const info = element(
    ID.Info,
    concat([
      element(ID.TimecodeScale, uint(1_000_000)), // one time unit = one millisecond
      element(ID.Duration, float64(options.durationMs)),
      element(ID.MuxingApp, text("Fraktalmotorn")),
      element(ID.WritingApp, text("Fraktalmotorn")),
    ]),
  );

  const tracks = element(
    ID.Tracks,
    element(
      ID.TrackEntry,
      concat([
        element(ID.TrackNumber, uint(1)),
        element(ID.TrackUID, uint(1)),
        element(ID.TrackType, uint(1)), // video
        element(ID.CodecID, text(options.codec ?? "V_VP9")),
        element(ID.Video, concat([element(ID.PixelWidth, uint(options.width)), element(ID.PixelHeight, uint(options.height))])),
      ]),
    ),
  );

  // Clusters: a new one at every key frame, and when the time inside would get too long.
  const clusters: { timeMs: number; bytes: Uint8Array }[] = [];
  let start = 0;
  while (start < frames.length) {
    const first = frames[start]!;
    let end = start + 1;
    while (end < frames.length && !frames[end]!.keyFrame && frames[end]!.timeMs - first.timeMs < MAX_CLUSTER_MS) end++;
    const blocks = frames.slice(start, end).map((f) => {
      const relative = Math.round(f.timeMs - first.timeMs);
      const head = Uint8Array.of(0x81, (relative >> 8) & 0xff, relative & 0xff, f.keyFrame ? 0x80 : 0x00);
      return element(ID.SimpleBlock, concat([head, f.data]));
    });
    clusters.push({
      timeMs: Math.round(first.timeMs),
      bytes: element(ID.Cluster, concat([element(ID.Timecode, uint(Math.round(first.timeMs))), ...blocks])),
    });
    start = end;
  }

  // The SeekHead has a fixed size (positions use 4 bytes), so everything after it can be placed before it is written.
  const seekHeadFor = (cuesPosition: number): Uint8Array =>
    element(
      ID.SeekHead,
      element(ID.Seek, concat([element(ID.SeekID, Uint8Array.from(ID.Cues)), element(ID.SeekPosition, uint(cuesPosition, 4))])),
    );
  const seekHeadSize = seekHeadFor(0).length;

  // Positions are counted from the start of the Segment's content.
  let position = seekHeadSize + info.length + tracks.length;
  const cuePoints: Uint8Array[] = [];
  for (const c of clusters) {
    cuePoints.push(
      element(
        ID.CuePoint,
        concat([
          element(ID.CueTime, uint(c.timeMs)),
          element(ID.CueTrackPositions, concat([element(ID.CueTrack, uint(1)), element(ID.CueClusterPosition, uint(position, 4))])),
        ]),
      ),
    );
    position += c.bytes.length;
  }
  const cues = element(ID.Cues, concat(cuePoints));
  const segment = element(ID.Segment, concat([seekHeadFor(position), info, tracks, ...clusters.map((c) => c.bytes), cues]));
  return concat([header, segment]);
}
