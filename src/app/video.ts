import type { ImageBuffer } from "../engine";
import { buildWebm } from "./webm";
import type { EncodedFrame } from "./webm";

export type VideoQuality = "low" | "medium" | "high";

/** Bits per pixel and frame: how much data the video gets. More means better picture and a bigger file. */
const BITS_PER_PIXEL: Record<VideoQuality, number> = { low: 0.05, medium: 0.12, high: 0.3 };

/** VP9, profile 0, 8 bits. The level says how large a picture the stream may have, so it is chosen from the size. */
function codecFor(width: number, height: number): string {
  const pixels = width * height;
  const level = pixels <= 1280 * 720 ? "31" : pixels <= 1920 * 1080 ? "41" : pixels <= 4096 * 2176 ? "51" : "62";
  return `vp09.00.${level}.08`;
}

export interface VideoOptions {
  width: number;
  height: number;
  fps: number;
  quality: VideoQuality;
}

/**
 * Makes a WebM video from frames, using the video encoder that comes with the browser (WebCodecs) and our own
 * WebM writer. Nothing leaves the computer. Width and height must be even numbers, because the video stores
 * colour at half resolution.
 */
export class VideoWriter {
  private frames: EncodedFrame[] = [];
  private count = 0;
  private error: Error | null = null;

  private constructor(
    private encoder: VideoEncoder,
    private options: VideoOptions,
  ) {}

  /** Checks that the browser can make this video, and starts the encoder. Throws a clear error if it cannot. */
  static async create(options: VideoOptions): Promise<VideoWriter> {
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
      throw new Error("This browser cannot encode video (WebCodecs is missing). Use a picture sequence instead, or Chrome/Edge.");
    }
    if (options.width % 2 !== 0 || options.height % 2 !== 0) throw new Error("The width and height of the video must be even numbers.");
    const config: VideoEncoderConfig = {
      codec: codecFor(options.width, options.height),
      width: options.width,
      height: options.height,
      framerate: options.fps,
      bitrate: Math.round(Math.min(120e6, Math.max(500e3, options.width * options.height * options.fps * BITS_PER_PIXEL[options.quality]))),
      latencyMode: "quality",
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) {
      throw new Error(`The browser cannot encode VP9 video at ${options.width}×${options.height}. Choose a smaller size or a picture sequence.`);
    }
    let writer!: VideoWriter;
    const encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        writer.frames.push({ timeMs: chunk.timestamp / 1000, keyFrame: chunk.type === "key", data });
      },
      error: (e) => {
        writer.error = e;
      },
    });
    encoder.configure(config);
    writer = new VideoWriter(encoder, options);
    return writer;
  }

  /** Adds the next frame. Waits if the encoder is behind, so memory does not fill up. */
  async add(image: ImageBuffer): Promise<void> {
    if (this.error) throw this.error;
    if (image.width !== this.options.width || image.height !== this.options.height) {
      throw new Error(`the picture is ${image.width}×${image.height}, but the video is ${this.options.width}×${this.options.height}`);
    }
    while (this.encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
    const frame = new VideoFrame(image.data as Uint8Array<ArrayBuffer>, {
      format: "RGBA",
      codedWidth: image.width,
      codedHeight: image.height,
      timestamp: Math.round((this.count * 1_000_000) / this.options.fps),
    });
    try {
      this.encoder.encode(frame, { keyFrame: this.count % 60 === 0 }); // a key frame about every 2 seconds, so players can jump around
    } finally {
      frame.close();
    }
    this.count++;
  }

  /** Waits for the encoder to finish and returns the finished file. */
  async finish(): Promise<Blob> {
    await this.encoder.flush();
    this.encoder.close();
    if (this.error) throw this.error;
    if (this.frames.length === 0) throw new Error("No frames were encoded.");
    const durationMs = (this.count * 1000) / this.options.fps;
    const bytes = buildWebm(this.frames, { width: this.options.width, height: this.options.height, durationMs });
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "video/webm" });
  }

  /** Stops without making a file. */
  cancel(): void {
    if (this.encoder.state !== "closed") this.encoder.close();
  }
}
