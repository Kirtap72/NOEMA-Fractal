/**
 * Window side of the bridge: answers the requests the main process forwards, one AppService call each, with cancellation.
 * The service is the only thing that decides; this only moves JSON.
 */
import type { AiHost } from '../desktop';
import type { AppService, ServiceResult } from './appService';

export function connectAiBridge(host: AiHost, service: Pick<AppService, 'handle'>): () => void {
  const running = new Map<string, AbortController>();
  const offRequest = host.onRequest(async ({ id, op, args }) => {
    const controller = new AbortController();
    running.set(id, controller);
    let result: ServiceResult;
    try { result = await service.handle(op, args, controller.signal); } catch { result = { ok: false, code: 'internal_error', message: 'An internal error occurred.' }; }
    running.delete(id);
    await host.respond(id, result).catch(() => {});
  });
  const offCancel = host.onCancel(({ id }) => running.get(id)?.abort());
  void host.register();
  return () => { offRequest(); offCancel(); for (const c of running.values()) c.abort(); running.clear(); };
}

/** RGBA pixels of a finished still as a base64 PNG (no data: prefix). Needs a DOM canvas. */
export function pngBase64(image: { width: number; height: number; data: ArrayLike<number> & { buffer?: ArrayBufferLike } }): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data as ArrayLike<number> as Uint8ClampedArray), image.width, image.height), 0, 0);
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}

/** A and B side by side in one PNG (A left, B right, thin labels), so the model can judge a change in one look. Needs a DOM canvas. */
export async function composeSideBySide(a: { base64: string; width: number; height: number; ms: number }, b: { base64: string; width: number; height: number; ms: number }): Promise<{ base64: string; mime: 'image/png'; width: number; height: number; ms: number }> {
  const load = (base64: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('The picture could not be read.')); img.src = 'data:image/png;base64,' + base64; });
  const [ia, ib] = await Promise.all([load(a.base64), load(b.base64)]);
  const gap = 4, height = Math.max(ia.height, ib.height), width = ia.width + gap + ib.width;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#202020'; g.fillRect(0, 0, width, height);
  g.drawImage(ia, 0, 0); g.drawImage(ib, ia.width + gap, 0);
  g.font = 'bold 14px sans-serif'; g.fillStyle = '#ffffff'; g.strokeStyle = '#000000'; g.lineWidth = 3;
  for (const [label, x] of [['A', 6], ['B', ia.width + gap + 6]] as const) { g.strokeText(label, x, 18); g.fillText(label, x, 18); }
  return { base64: canvas.toDataURL('image/png').split(',')[1] ?? '', mime: 'image/png', width, height, ms: a.ms + b.ms };
}
