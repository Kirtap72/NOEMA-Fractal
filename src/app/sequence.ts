/** Frame by frame rendering of an image sequence. Pure logic with the real work passed in, so it can be tested. */

export interface FrameStats {
  renderMs: number;
  encodeMs: number;
  writeMs: number;
  totalMs: number;
}

export interface Progress {
  /** Frames finished so far. */
  done: number;
  total: number;
  last: FrameStats;
  /** Average time per frame so far, in milliseconds. */
  averageMs: number;
  elapsedSeconds: number;
  /** Estimated time left, in seconds, from the average so far. */
  remainingSeconds: number;
}

export interface SequenceJob<F> {
  /** The time (in seconds) of every frame to render, in order. */
  times: readonly number[];
  renderFrame(time: number, index: number): Promise<F>;
  encode(frame: F): Promise<Blob>;
  /** Further files for the same frame (for example depth and normals). `n` is the frame number, 1, 2, 3, ... */
  encodeExtras?(frame: F, n: number): Promise<{ name: string; data: Blob }[]>;
  write(fileName: string, data: Blob): Promise<void>;
  onProgress?(progress: Progress): void;
  signal?: AbortSignal;
  /** File name for frame number n (1, 2, 3, ...). */
  fileName?(n: number): string;
  /** A clock in milliseconds. Only replaced in tests. */
  now?(): number;
}

export interface SequenceResult {
  written: number;
  aborted: boolean;
  totalMs: number;
}

/** "frame_000001.png". The numbers are consecutive whatever frames were chosen, which video tools expect. */
export function frameFileName(n: number, prefix = "frame"): string {
  return `${prefix}_${String(n).padStart(6, "0")}.png`;
}

/** Renders, encodes and saves one frame at a time. Stops cleanly if the signal is aborted (between two frames). */
export async function runSequence<F>(job: SequenceJob<F>): Promise<SequenceResult> {
  const now = job.now ?? (() => performance.now());
  const name = job.fileName ?? ((n: number) => frameFileName(n));
  const start = now();
  let sumMs = 0;
  let written = 0;

  for (let i = 0; i < job.times.length; i++) {
    if (job.signal?.aborted) return { written, aborted: true, totalMs: now() - start };
    const t0 = now();
    const frame = await job.renderFrame(job.times[i]!, i);
    const t1 = now();
    const data = await job.encode(frame);
    const extras = job.encodeExtras ? await job.encodeExtras(frame, i + 1) : [];
    const t2 = now();
    await job.write(name(i + 1), data);
    for (const extra of extras) await job.write(extra.name, extra.data);
    const t3 = now();
    written++;
    sumMs += t3 - t0;
    const averageMs = sumMs / written;
    job.onProgress?.({
      done: written,
      total: job.times.length,
      last: { renderMs: t1 - t0, encodeMs: t2 - t1, writeMs: t3 - t2, totalMs: t3 - t0 },
      averageMs,
      elapsedSeconds: (t3 - start) / 1000,
      remainingSeconds: ((job.times.length - written) * averageMs) / 1000,
    });
  }
  return { written, aborted: false, totalMs: now() - start };
}

/** Text for the screen, for example "Bildruta 12/60 · 85 ms rendering + 30 ms PNG + 12 ms sparande = 127 ms · snitt 130 ms · kvar ca 6 s". */
export function describeProgress(p: Progress): string {
  const ms = (x: number): string => `${Math.round(x)} ms`;
  const left = p.remainingSeconds < 90 ? `${Math.round(p.remainingSeconds)} s` : `${(p.remainingSeconds / 60).toFixed(1)} min`;
  return (
    `Frame ${p.done}/${p.total} · ${ms(p.last.renderMs)} rendering + ${ms(p.last.encodeMs)} PNG + ${ms(p.last.writeMs)} saving ` +
    `= ${ms(p.last.totalMs)} · average ${ms(p.averageMs)} per frame · about ${left} left`
  );
}
