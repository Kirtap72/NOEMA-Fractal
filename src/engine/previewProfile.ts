import type { Engine, RenderOptions, RenderTiming } from "./engine";
import { FULL_VIEWPORT_FEATURES } from "./viewportQuality";
import type { DetailSettings } from "./renderDetails";
export interface PreviewProfileRow {
  name: string;
  cumulativeMs: number;
  marginalMs: number;
  clock: RenderTiming["gpuClock"];
  readbackMs: number;
  cpuMs: number;
}

/** Controlled cumulative GPU passes: differences are measured marginal costs, not exact additive shader timers. */
export async function profilePreview(
  engine: Engine,
  width: number,
  height: number,
  options: RenderOptions,
  details: DetailSettings,
  signal: AbortSignal,
): Promise<PreviewProfileRow[]> {
  const names = [
    "Fractal raymarch",
    "Normals / bevel",
    "Lighting / material BRDF",
    "Shadows",
    "AO / cavity",
    "Environment / secondary reflections",
    "Fog / post",
  ];
  const rows: PreviewProfileRow[] = [];
  for (let stage = 1; stage <= 7; stage++) {
    if (signal.aborted)
      throw new DOMException("Preview cancelled", "AbortError");
    const measured: RenderTiming[] = [];
    const effects = {
      ...details,
      ao: { ...details.ao, enabled: stage >= 5 && details.ao.enabled },
      cavity: {
        ...details.cavity,
        enabled: stage >= 5 && details.cavity.enabled,
      },
    };
    const render = {
      ...options,
      signal,
      dofMode: "off" as const,
      quality: { ...options.quality, samples_per_pixel: 1 },
      profileStage: stage,
      details: effects,
      features: {
        ...FULL_VIEWPORT_FEATURES,
        ...options.features,
        shadows: stage >= 4,
        reflections: stage >= 6,
        fog: stage >= 7,
      },
      onTiming: (t: RenderTiming) => measured.push(t),
    };
    await engine.renderToBuffer(width, height, {
      ...render,
      onTiming: undefined,
    }); // warm each conditional path
    const trials: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = measured.length;
      await engine.renderToBuffer(width, height, render);
      trials.push(measured.slice(start).reduce((n, t) => n + t.gpuMs, 0));
    }
    trials.sort((a, b) => a - b);
    const cumulativeMs = trials[1]!;
    rows.push({
      name: names[stage - 1]!,
      cumulativeMs,
      marginalMs: cumulativeMs - (rows.at(-1)?.cumulativeMs ?? 0),
      clock: measured[0]!.gpuClock,
      readbackMs: measured.reduce((n, t) => n + t.readbackMs, 0) / 3,
      cpuMs: measured.reduce((n, t) => n + t.accumulationMs, 0) / 3,
    });
  }
  return rows;
}
