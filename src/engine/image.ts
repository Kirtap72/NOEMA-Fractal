import {displayRgba} from './display';
import type { ImageBuffer } from "./engine";

const GAMMA = 2.2; // the same curve the shader uses for output

const DECODE = new Float32Array(256).map((_, v) => (v / 255) ** GAMMA);

/**
 * Shrinks an image by a whole factor by averaging blocks of pixels (anti-aliasing:
 * render at a larger size, then shrink). Averaging is done in linear light, which is
 * how light really mixes, so edges do not get too dark.
 */
export function downsampleBox(image: ImageBuffer, factor: number): ImageBuffer {
  if (!Number.isInteger(factor) || factor < 1) throw new Error("factor must be a whole number, 1 or more");
  if (factor === 1) return image;
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  if (width < 1 || height < 1) throw new Error("the image is smaller than the factor");
  if(image.linear){
    const linear=new Float32Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let dy=0;dy<factor;dy++)for(let dx=0;dx<factor;dx++)for(let c=0;c<4;c++){
      const to=(y*width+x)*4+c;linear[to]=linear[to]!+image.linear[((y*factor+dy)*image.width+x*factor+dx)*4+c]!/(factor*factor);
    }
    return {width,height,linear,display:image.display,data:displayRgba(linear,image.display)};
  }
  const out = new Uint8Array(width * height * 4);
  const n = factor * factor;
  const inverse = 1 / GAMMA;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < factor; dy++) {
        let i = ((y * factor + dy) * image.width + x * factor) * 4;
        for (let dx = 0; dx < factor; dx++, i += 4) {
          r += DECODE[image.data[i]!]!;
          g += DECODE[image.data[i + 1]!]!;
          b += DECODE[image.data[i + 2]!]!;
          a += image.data[i + 3]!;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(255 * (r / n) ** inverse);
      out[o + 1] = Math.round(255 * (g / n) ** inverse);
      out[o + 2] = Math.round(255 * (b / n) ** inverse);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width, height, data: out };
}
