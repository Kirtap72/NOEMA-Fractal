/** One worker promise and one latest pending request. Compilation/dispatch already sent cannot be cancelled physically. */
export class DiscoveryQueue<T,R> {
 private generation=0;private active=false;private controller:AbortController|undefined;
 private pending:{token:number;items:T[];work:(item:T,signal:AbortSignal)=>Promise<R>;result:(item:T,result:R|Error)=>void;done:()=>void}|undefined;
 request(items:T[],work:(item:T,signal:AbortSignal)=>Promise<R>,result:(item:T,result:R|Error)=>void,done:()=>void){
  this.cancel();const token=this.generation;this.pending={token,items,work,result,done};void this.pump();
 }
 cancel(){this.generation++;this.controller?.abort();this.pending=undefined;}
 get busy(){return this.active||!!this.pending;}
 private async pump(){if(this.active)return;this.active=true;try{while(this.pending){const request=this.pending;this.pending=undefined;this.controller=new AbortController();for(const item of request.items){if(request.token!==this.generation)break;let result:R|Error;try{result=await request.work(item,this.controller.signal);}catch(e){result=e instanceof Error?e:Error(String(e));}if(request.token===this.generation)request.result(item,result);}if(request.token===this.generation)request.done();}}finally{this.active=false;this.controller=undefined;}}
}
