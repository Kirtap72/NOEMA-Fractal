export type GpuSupport = "webgpu" | "webgl2" | "none";

/** The browser features we may need, passed in so the check can be tested without a browser. */
export interface GpuEnvironment {
  hasWebGpu: boolean;
  hasWebGl2: boolean;
}

/** Picks the best available graphics API: WebGPU first, WebGL2 as fallback. */
export function chooseGpuSupport(env: GpuEnvironment): GpuSupport {
  if (env.hasWebGpu) return "webgpu";
  if (env.hasWebGl2) return "webgl2";
  return "none";
}

export function describeGpuSupport(support: GpuSupport): string {
  switch (support) {
    case "webgpu":
      return "WebGPU works in your browser. Everything is ready for the next stage.";
    case "webgl2":
      return "WebGPU is missing, but WebGL2 works. The fallback plan can be used.";
    case "none":
      return "Neither WebGPU nor WebGL2 was found. Try a newer Chrome or Edge.";
  }
}
