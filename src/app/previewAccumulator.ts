import type { ImageBuffer } from "../engine/engine";

/** One worker per stable accumulation generation; input disposes it without waiting for old CPU work. */
export class PreviewAccumulatorWorker {
  private worker: Worker | null = null;
  private reject: ((reason: unknown) => void) | null = null;
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.reject?.(new DOMException("Preview cancelled", "AbortError"));
    this.reject = null;
  }
  add(
    image: ImageBuffer,
    signal: AbortSignal,
  ): Promise<{ image: ImageBuffer; milliseconds: number }> {
    if (signal.aborted)
      return Promise.reject(
        new DOMException("Preview cancelled", "AbortError"),
      );
    if (this.reject) throw Error("Only one preview sample may be in flight");
    this.worker ??= new Worker(
      new URL("./finalPreviewWorker.ts", import.meta.url),
      { type: "module" },
    );
    return new Promise((resolve, reject) => {
      this.reject = (reason) => {
        cleanup();
        reject(reason);
      };
      const cancel = () => this.dispose();
      const cleanup = () => {
        this.reject = null;
        signal.removeEventListener("abort", cancel);
      };
      signal.addEventListener("abort", cancel, { once: true });
      this.worker!.onmessage = (e) => {
        cleanup();
        if (e.data.error) reject(Error(e.data.error));
        else resolve(e.data);
      };
      this.worker!.onerror = (e) => {
        cleanup();
        reject(Error(e.message));
        this.dispose();
      };
      this.worker!.postMessage(image, [image.data.buffer,...(image.linear?[image.linear.buffer]:[])]);
    });
  }
}
