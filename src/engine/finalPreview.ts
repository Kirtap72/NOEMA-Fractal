import {displayRgba} from './display';
import type { QualitySettings } from "./renderSetup";
import type { DetailSettings } from "./renderDetails";
import { FULL_VIEWPORT_FEATURES } from "./viewportQuality";
import type { ViewportFeatures } from "./viewportQuality";
import type { ImageBuffer } from "./engine";

export interface FinalPreviewPass {
  generation: number;
  sequence: number;
  width: number;
  height: number;
  quality: QualitySettings;
  details: DetailSettings;
  features: ViewportFeatures;
  approximation: boolean;
  sampleOffset: number;
  targetSamples: number;
  tilePixels: number;
}

/** Export dimensions deliberately do not enter this contract. Actual visible CSS pixels and DPR do. */
export function previewSize(
  width: number,
  height: number,
  dpr = 1,
  pixelBudget = 1_500_000,
): { width: number; height: number } {
  if (
    ![width, height, dpr, pixelBudget].every((n) => Number.isFinite(n) && n > 0)
  )
    throw Error("Invalid preview dimensions");
  const scale = Math.min(
    dpr,
    1920 / Math.max(width, height),
    Math.sqrt(pixelBudget / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export function previewDetails(
  details: DetailSettings,
  samples: number,
): DetailSettings {
  return {
    ...details,
    ao: { ...details.ao, samples: Math.min(samples, details.ao.samples) },
    cavity: {
      ...details.cavity,
      samples: Math.min(samples, details.cavity.samples),
    },
    edge_softening: details.edge_softening
      ? { ...details.edge_softening }
      : undefined,
  };
}

/** Progressive whole compositions first, then independent single lens/AA samples. Never edits persisted settings. */
export class FinalPreviewController {
  private generation = 0;
  private stage = 0;
  private samples = 0;
  private ceiling = 1;
  private sequence = 0;
  readonly targetSamples = 16;
  constructor(readonly targetMs = 300) {}
  invalidate(): void {
    this.generation++;
    this.stage = 0;
    this.samples = 0;
    this.sequence++;
  }
  resetCost(): void {
    this.ceiling = 1;
    this.invalidate();
  }
  plan(
    width: number,
    height: number,
    dpr: number,
    stored: QualitySettings,
    details: DetailSettings,
  ): FinalPreviewPass | null {
    if (this.samples >= this.targetSamples) return null;
    const size = previewSize(width, height, dpr),
      scale = Math.min(this.ceiling, [0.25, 0.5, 1, 1][this.stage]!);
    const quality: QualitySettings = {
      ...stored,
      samples_per_pixel: 1,
      max_steps: Math.min(stored.max_steps, [96, 192, 512, 1024][this.stage]!),
      shadow_steps: Math.min(
        stored.shadow_steps,
        [12, 24, 48, 96][this.stage]!,
      ),
      precision_mode: this.stage < 2 ? "pixel" : stored.precision_mode,
      hit_pixels:
        this.stage < 2
          ? Math.max(stored.hit_pixels, this.stage === 0 ? 1.25 : 0.8)
          : stored.hit_pixels,
      normal_pixels:
        this.stage < 2
          ? Math.max(stored.normal_pixels, 1.5)
          : stored.normal_pixels,
    };
    return {
      generation: this.generation,
      sequence: this.sequence,
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality,
      details: previewDetails(details, [2, 4, 8, 16][this.stage]!),
      features: { ...FULL_VIEWPORT_FEATURES, tetraNormal: this.stage === 0, reflectionBudget:{samples:1,maxSteps:[24,48,80,128][this.stage]!,maxBounces:[1,2,3,4][this.stage]!},maxTransportBounces:[2,3,4,8][this.stage]! },
      approximation: this.stage < 3,
      sampleOffset: this.samples,
      targetSamples: this.targetSamples,
      tilePixels: 65536,
    };
  }
  complete(pass: FinalPreviewPass, milliseconds: number): void {
    if (
      pass.generation !== this.generation ||
      pass.sequence !== this.sequence ||
      !Number.isFinite(milliseconds) ||
      milliseconds <= 0
    )
      return;
    if (milliseconds > this.targetMs * 1.7) {
      const currentScale = Math.min(
        this.ceiling,
        [0.25, 0.5, 1, 1][this.stage]!,
      );
      this.ceiling = Math.max(
        0.0625,
        currentScale * Math.sqrt(this.targetMs / milliseconds),
      );
      // Changing sampling resolution/precision invalidates only accumulation, retaining the already visible image.
      this.samples = 0;
      if (this.stage === 3) this.generation++;
    }
    if (this.stage < 3) this.stage++;
    else if (milliseconds <= this.targetMs * 1.7 || this.ceiling === 0.0625)
      this.samples++;
    this.sequence++;
  }
}

const linear = Float32Array.from({ length: 256 }, (_, i) => (i / 255) ** 2.2);
/** Unbiased linear-light sum. Approximate DOF images are never mixed into physical lens samples. */
export class PreviewAccumulator {
  private sum: Float32Array | null = null;
  private width = 0;
  private height = 0;
  private count = 0;
  /** A new scene generation must never inherit the previous linear sum. */
  reset():void {this.sum=null;this.width=0;this.height=0;this.count=0;}
  get sampleCount():number {return this.count;}
  add(image: ImageBuffer): ImageBuffer {
    if(image.linear){
      if(image.linear.length!==image.width*image.height*4)throw Error("Invalid linear preview image");
      if(!this.sum||image.width!==this.width||image.height!==this.height||this.sum.length!==image.linear.length){this.width=image.width;this.height=image.height;this.sum=new Float32Array(image.linear.length);this.count=0;}
      this.count++;const mean=new Float32Array(image.linear.length);
      for(let i=0;i<mean.length;i++){this.sum[i]=this.sum[i]!+image.linear[i]!;mean[i]=this.sum[i]!/this.count;}
      return {width:this.width,height:this.height,linear:mean,display:image.display,data:displayRgba(mean,image.display)};
    }
    if (image.data.length !== image.width * image.height * 4)
      throw Error("Invalid preview image");
    if (
      !this.sum ||
      image.width !== this.width ||
      image.height !== this.height
    ) {
      this.width = image.width;
      this.height = image.height;
      this.sum = new Float32Array(this.width * this.height * 3);
      this.count = 0;
    }
    this.count++;
    const data = new Uint8Array(image.data.length);
    for (let i = 0, p = 0; i < image.data.length; i += 4, p += 3) {
      for (let c = 0; c < 3; c++) {
        this.sum[p + c] = this.sum[p + c]! + linear[image.data[i + c]!]!;
        data[i + c] = Math.round(
          255 * (this.sum[p + c]! / this.count) ** (1 / 2.2),
        );
      }
      data[i + 3] = 255;
    }
    return { width: this.width, height: this.height, data };
  }
}
