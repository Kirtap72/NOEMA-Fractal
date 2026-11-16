import type { ImageBuffer, LayerBuffers } from "../engine/engine";
import type { SceneCamera } from "../engine/camera";
import type { FovAxis } from "../engine/renderSetup";

/** Keep the bounded screen-space gather off the input/UI thread. Input can terminate obsolete work immediately. */
export function applyPreviewDof(
  layers: LayerBuffers,
  camera: SceneCamera,
  axis: FovAxis,
  signal: AbortSignal,
): Promise<ImageBuffer> {
  return new Promise((resolve, reject) => {
    const aborted = () =>
      new DOMException("The preview was cancelled.", "AbortError");
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const worker = new Worker(
      new URL("./dofPreviewWorker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
      signal.removeEventListener("abort", cancel);
      worker.terminate();
    };
    const cancel = () => {
      cleanup();
      reject(aborted());
    };
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (
      e: MessageEvent<{ image?: ImageBuffer; error?: string }>,
    ) => {
      cleanup();
      if (e.data.image) resolve(e.data.image);
      else reject(Error(e.data.error ?? "DOF preview failed"));
    };
    worker.onerror = (e) => {
      cleanup();
      reject(Error(e.message));
    };
    worker.postMessage({ layers, camera, axis }, [
      layers.color.buffer,
      layers.depth.buffer,
      layers.normal.buffer,
    ]);
  });
}
