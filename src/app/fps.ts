/** Counts frames and reports the average frames per second over a short window. */
export class FpsCounter {
  private frames = 0;
  private windowStart: number | null = null;
  fps = 0;

  constructor(private windowMs = 500) {}
  /** Idle previews do not render continuously; exclude that idle time from the next navigation window. */
  reset(): void { this.frames = 0; this.windowStart = null; this.fps = 0; }

  /** Call once per frame with the current time in milliseconds. */
  tick(nowMs: number): number {
    if (this.windowStart === null) {
      this.windowStart = nowMs;
      return this.fps;
    }
    this.frames++;
    const elapsed = nowMs - this.windowStart;
    if (elapsed >= this.windowMs) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frames = 0;
      this.windowStart = nowMs;
    }
    return this.fps;
  }
}
