/** Stop an export before it owns shared GPU state, even while an older viewport
 * shader/job is still pending. Never pretends to interrupt a submitted GPU job. */
export async function waitForRenderIdle(busy:()=>boolean,signal?:AbortSignal):Promise<void>{
 signal?.throwIfAborted();
 while(busy()){signal?.throwIfAborted();await new Promise(r=>setTimeout(r,16));}
 signal?.throwIfAborted();
}
