import { PreviewAccumulator } from "../engine/finalPreview";
import type { ImageBuffer } from "../engine/engine";
const accumulator = new PreviewAccumulator();
self.onmessage = (e: MessageEvent<ImageBuffer>) => {
  const started = performance.now();
  try {
    const image = accumulator.add(e.data);
    self.postMessage(
      { image, milliseconds: performance.now() - started },
      { transfer: [image.data.buffer,...(image.linear?[image.linear.buffer]:[])] },
    );
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
