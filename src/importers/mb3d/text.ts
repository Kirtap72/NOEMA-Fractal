import { Mb3dParseError } from './reader';
/** Source: DivUtils ThreeBytesTo4Chars/FourCharsTo3Bytes; this is not RFC 4648 Base64. */
export const TEXT_ALPHABET = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function decodeMb3dText(text: string): { bytes: Uint8Array; textVersion: number; title: string | null } {
  const match = /Mandelbulb3Dv(\d+(?:\.\d+)?)\s*\{([^}]*)\}/i.exec(text);
  if (!match) throw new Mb3dParseError('TEXT_HEADER', 'Expected Mandelbulb3Dv<number>{...}');
  const version = Number(match[1]);
  if (!Number.isFinite(version) || version < 0 || version > 250) throw new Mb3dParseError('TEXT_VERSION', 'Unsupported text transport version');
  const body = match[2]!.replace(/\u2026|\u0085/g, '...').replace(/\s/g, '');
  if (body.length % 4) throw new Mb3dParseError('TEXT_LENGTH', 'Encoded text must contain complete groups of four characters');
  const bytes = new Uint8Array(body.length / 4 * 3);
  for (let i = 0; i < body.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      const digit = TEXT_ALPHABET.indexOf(body[i + j]!);
      if (digit < 0) throw new Mb3dParseError('TEXT_CHARACTER', `Invalid MB3D text character at ${i + j}`, i + j);
      word |= digit << (j * 6);
    }
    bytes.set([word & 255, word >>> 8 & 255, word >>> 16 & 255], i / 4 * 3);
  }
  const title = /\{Titel:\s*([^}\r\n]*)\}/.exec(text.slice(match.index + match[0].length))?.[1] ?? null;
  return {bytes, textVersion:version, title};
}
