import { computeTiming, timingKey } from "../engine";
import type { DistanceFn, Scene, Timing } from "../engine";

/**
 * Keeps the camera timing (how fast the camera moves along each stretch) up to date.
 * Measuring needs the graphics card, so it is done on request and remembered until the animation changes.
 */
export class TimingManager {
  timing: Timing | null = null;
  private computedFor: string | null = null;
  private running: Promise<void> | null = null;

  constructor(private measure: DistanceFn) {}

  /** True if the stored timing belongs to this scene's animation. */
  isCurrent(scene: Scene): boolean {
    return this.computedFor === timingKey(scene);
  }

  /** Measures again if the animation changed since last time. */
  async refresh(scene: Scene): Promise<void> {
    while (this.running) await this.running.catch(() => undefined);
    const key = timingKey(scene);
    if (key === this.computedFor) return;
    const job = (async () => {
      this.timing = scene.animation.keyframes.length >= 2 ? await computeTiming(scene, this.measure) : null;
      this.computedFor = key;
    })();
    this.running = job;
    try {
      await job;
    } finally {
      this.running = null;
    }
  }
}
