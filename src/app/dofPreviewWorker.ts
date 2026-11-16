import { previewDof } from "../engine/previewDof";
import type { LayerBuffers } from "../engine/engine";
import type { SceneCamera } from "../engine/camera";
import type { FovAxis } from "../engine/renderSetup";

self.onmessage = (
  e: MessageEvent<{ layers: LayerBuffers; camera: SceneCamera; axis: FovAxis }>,
) => {
  try {
    const image = previewDof(e.data.layers, e.data.camera, e.data.axis);
    self.postMessage({ image }, { transfer: [image.data.buffer] });
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
