/**
 * Chooses the picture quality: coarse while the user is moving something,
 * full again when things have been still for a moment.
 */
export class QualityController {
  private lastTouch = -Infinity;

  constructor(
    private idleMs = 250,
    private movingScale = 0.5,
  ) {}

  /** Call whenever the user changes the camera or a parameter. */
  touch(nowMs: number): void {
    this.lastTouch = nowMs;
  }

  /** 1 = full resolution, smaller = coarser. */
  scale(nowMs: number): number {
    return nowMs - this.lastTouch < this.idleMs ? this.movingScale : 1;
  }
}
