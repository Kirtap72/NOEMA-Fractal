/** Host-only PERF-01B experiment. No shader constant, per-ray budget or scene field. */
export function rayBatchCapacity(request?:number):number {
 if(request===undefined)return 1024;
 if(!Number.isSafeInteger(request)||request<1||request>16384)throw Error('QA ray batch capacity must be an integer in 1–16384');
 return request;
}
