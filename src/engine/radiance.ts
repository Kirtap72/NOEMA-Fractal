/**
 * Reading and writing pictures in the Radiance RGBE format (.hdr): an open, long-established format for pictures with
 * a high dynamic range. Each pixel is three 8-bit mantissas and one shared 8-bit exponent. The format description is
 * public (Greg Ward, "Real Pixels", Graphics Gems II, 1991; the Radiance file format notes). Written fresh for this
 * project from that description, without reading any program's code. Source details are unverified (see LICENSING.md).
 */

/** A picture of linear light: red, green and blue as floating point numbers, row by row from the top. */
export interface HdrImage {
  width: number;
  height: number;
  /** 3 numbers per pixel. */
  data: Float32Array;
}

/** The largest picture read at all (before it is made smaller). */
export const MAX_READ_WIDTH = 8192;
export const MAX_READ_HEIGHT = 4096;
/** The largest picture kept in a scene: a 2:1 map of 1024 x 512 pixels. */
export const MAX_ENV_WIDTH = 1024;
export const MAX_ENV_HEIGHT = 512;
export const MIN_ENV_WIDTH = 16;

export class RadianceError extends Error {}

/** The value of one pixel from its four bytes. */
function fromRgbe(r: number, g: number, b: number, e: number, out: Float32Array, at: number): void {
  if (e === 0) {
    out[at] = 0;
    out[at + 1] = 0;
    out[at + 2] = 0;
    return;
  }
  const f = Math.pow(2, e - 136); // 2^(e - (128 + 8))
  out[at] = r * f;
  out[at + 1] = g * f;
  out[at + 2] = b * f;
}

/** Decodes a .hdr file. Handles flat scanlines and the common run-length form; rejects anything else with a clear message. */
export function decodeRgbe(bytes: Uint8Array): HdrImage {
  let pos = 0;
  const line = (): string => {
    let s = "";
    while (pos < bytes.length && bytes[pos] !== 10) s += String.fromCharCode(bytes[pos++]!);
    pos++; // the newline
    return s;
  };
  const first = line();
  if (!first.startsWith("#?")) throw new RadianceError("not a Radiance .hdr file (it does not start with #?)");
  let sawFormat = false;
  for (let guard = 0; guard < 200; guard++) {
    if (pos >= bytes.length) throw new RadianceError("the .hdr header ends too early");
    const l = line();
    if (l === "") break;
    if (l.startsWith("FORMAT=")) {
      sawFormat = true;
      if (l !== "FORMAT=32-bit_rle_rgbe") throw new RadianceError(`the .hdr format "${l.slice(7)}" is not supported (only 32-bit_rle_rgbe)`);
    }
  }
  void sawFormat;
  const size = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (!size) throw new RadianceError("the .hdr size line must read -Y height +X width (a picture stored top to bottom)");
  const height = Number(size[1]);
  const width = Number(size[2]);
  if (width < 1 || height < 1 || width > MAX_READ_WIDTH || height > MAX_READ_HEIGHT) {
    throw new RadianceError(`the picture is ${width} x ${height}; at most ${MAX_READ_WIDTH} x ${MAX_READ_HEIGHT} can be read`);
  }

  const data = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    const rle = width >= 8 && width <= 32767 && bytes[pos] === 2 && bytes[pos + 1] === 2 && ((bytes[pos + 2]! << 8) | bytes[pos + 3]!) === width;
    if (rle) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          if (pos >= bytes.length) throw new RadianceError("the picture data ends too early");
          let count = bytes[pos++]!;
          if (count > 128) {
            count -= 128;
            if (x + count > width || pos >= bytes.length) throw new RadianceError("a run in the picture data is too long");
            const v = bytes[pos++]!;
            for (let i = 0; i < count; i++) scan[(x++) * 4 + c] = v;
          } else {
            if (count === 0 || x + count > width || pos + count > bytes.length) throw new RadianceError("a run in the picture data is wrong");
            for (let i = 0; i < count; i++) scan[(x++) * 4 + c] = bytes[pos++]!;
          }
        }
      }
    } else {
      if (pos + width * 4 > bytes.length) throw new RadianceError("the picture data ends too early");
      scan.set(bytes.subarray(pos, pos + width * 4));
      pos += width * 4;
    }
    for (let x = 0; x < width; x++) fromRgbe(scan[x * 4]!, scan[x * 4 + 1]!, scan[x * 4 + 2]!, scan[x * 4 + 3]!, data, (y * width + x) * 3);
  }
  return { width, height, data };
}

/** Encodes a picture as a .hdr file with flat scanlines (every reader understands them). */
export function encodeRgbe(image: HdrImage): Uint8Array {
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${image.height} +X ${image.width}\n`;
  const out = new Uint8Array(header.length + image.width * image.height * 4);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  let at = header.length;
  for (let p = 0; p < image.width * image.height; p++) {
    const r = Math.max(0, image.data[p * 3]!);
    const g = Math.max(0, image.data[p * 3 + 1]!);
    const b = Math.max(0, image.data[p * 3 + 2]!);
    const v = Math.max(r, g, b);
    if (!(v > 1e-32)) {
      at += 4; // four zero bytes: black
      continue;
    }
    let e = Math.floor(Math.log2(v)) + 1;
    let m = v / Math.pow(2, e);
    if (m >= 1) {
      m /= 2;
      e++;
    } else if (m < 0.5) {
      m *= 2;
      e--;
    }
    const scale = (m * 256) / v;
    out[at++] = Math.min(255, Math.floor(r * scale));
    out[at++] = Math.min(255, Math.floor(g * scale));
    out[at++] = Math.min(255, Math.floor(b * scale));
    out[at++] = e + 128;
  }
  return out;
}

/** Makes a picture smaller by averaging the pixels that fall into each new pixel (the average of light is kept). */
export function shrink(image: HdrImage, width: number, height: number): HdrImage {
  if (width >= image.width && height >= image.height) return image;
  const w = Math.min(width, image.width);
  const h = Math.min(height, image.height);
  const data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * image.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * image.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * image.width + xx) * 3;
          r += image.data[i]!;
          g += image.data[i + 1]!;
          b += image.data[i + 2]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      data.set([r / n, g / n, b / n], (y * w + x) * 3);
    }
  }
  return { width: w, height: h, data };
}

/**
 * The picture and its smaller versions down to one pixel (each half as wide and high, by averaging), for the graphics
 * card's mip levels. The roughness of a surface picks a level: a rougher surface sees a blurrier environment. A box
 * average of a map is only an approximation of the blur a rough surface really gives (ARCHITECTURE.md 8.22).
 */
export function buildMipChain(image: HdrImage): HdrImage[] {
  const out = [image];
  let cur = image;
  while (cur.width > 1 || cur.height > 1) {
    cur = shrink(cur, Math.max(1, cur.width >> 1), Math.max(1, cur.height >> 1));
    out.push(cur);
  }
  return out;
}

/**
 * Makes a picture ready for a scene: it must be an equirectangular map (twice as wide as high, within 1 %), and is
 * shrunk to at most 1024 x 512. Throws a RadianceError with a message to show the user otherwise.
 */
export function prepareEnvironmentImage(image: HdrImage): HdrImage {
  if (Math.abs(image.width - 2 * image.height) > Math.max(1, 0.01 * image.width)) {
    throw new RadianceError(`the picture is ${image.width} x ${image.height}; an environment map must be twice as wide as it is high (for example 2048 x 1024)`);
  }
  if (image.width < MIN_ENV_WIDTH) throw new RadianceError(`the picture is too small (at least ${MIN_ENV_WIDTH} pixels wide)`);
  for (let i = 0; i < image.data.length; i++) {
    if (!Number.isFinite(image.data[i]!)) throw new RadianceError("the picture contains values that are not numbers");
  }
  if (image.width <= MAX_ENV_WIDTH) return image;
  return shrink(image, MAX_ENV_WIDTH, MAX_ENV_HEIGHT);
}

/** The start of the data address that holds a picture in a scene. */
export const HDR_DATA_PREFIX = "data:image/vnd.radiance;base64,";
export const HDR_DATA_ADDRESS = /^data:image\/vnd\.radiance;base64,[A-Za-z0-9+/]+={0,2}$/;

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The data address for a picture, as kept in a scene. */
export function imageToDataAddress(image: HdrImage): string {
  return HDR_DATA_PREFIX + bytesToBase64(encodeRgbe(image));
}

/** Reads a data address from a scene back into a picture. */
export function dataAddressToImage(address: string): HdrImage {
  if (!HDR_DATA_ADDRESS.test(address)) throw new RadianceError("the environment data must be a data address like data:image/vnd.radiance;base64,...");
  return decodeRgbe(base64ToBytes(address.slice(HDR_DATA_PREFIX.length)));
}

/** A 32-bit number as a 16-bit half-precision number (for the graphics card's float16 pictures). Rounds to nearest even. */
// Synchronous scalar calls share scratch per JS isolate; large EXR streams avoid millions of allocations.
const halfScratch = new Float32Array(1);
const halfBits = new Uint32Array(halfScratch.buffer);
export function floatToHalf(value: number): number {
  const f32 = halfScratch;
  const u32 = halfBits;
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // infinity or not a number
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7bff; // too large: the largest half number (65504), never infinity
  if (e <= 0) {
    if (e < -10) return sign; // too small
    mant |= 0x800000;
    const shift = 14 - e;
    let half = mant >> shift;
    const rest = mant & ((1 << shift) - 1);
    const middle = 1 << (shift - 1);
    if (rest > middle || (rest === middle && (half & 1))) half++;
    return sign | half;
  }
  let half = sign | (e << 10) | (mant >> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1))) half++;
  return half;
}

/** A picture as the 16-bit float RGBA pixels the graphics card reads. */
export function toHalfRgba(image: HdrImage): Uint16Array {
  const out = new Uint16Array(image.width * image.height * 4);
  const one = floatToHalf(1);
  for (let p = 0; p < image.width * image.height; p++) {
    out[p * 4] = floatToHalf(image.data[p * 3]!);
    out[p * 4 + 1] = floatToHalf(image.data[p * 3 + 1]!);
    out[p * 4 + 2] = floatToHalf(image.data[p * 3 + 2]!);
    out[p * 4 + 3] = one;
  }
  return out;
}
