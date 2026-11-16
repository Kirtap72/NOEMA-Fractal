export interface DesktopHost {
 info():Promise<{folder:string;profile?:{folder:string;mode:'normal'|'explicit-test'};version:string;features:Record<string,string>}>;
 openScene():Promise<{name:string;text:string}|undefined>;
 saveScene(text:string):Promise<{canceled?:boolean;saved?:string}>;
 library(operation:'page'|'get'|'thumbnail'|'put'|'remove'|'metadata'|'begin'|'finish'|'replace'|'import',...args:unknown[]):Promise<any>;
 importLibrary():Promise<{added:number;duplicates:number}|undefined>;
 exportLibrary():Promise<{saved:string;count:number}|undefined>;
 materials?(operation:string,...args:unknown[]):Promise<any>;
 polyHaven?(operation:string,...args:unknown[]):Promise<any>;
 feedback?:{preview(note:string):Promise<string>;save(text:string):Promise<{saved:boolean}>};
 onPolyHavenProgress?(callback:(progress:{id:string;step:number;steps:number;channel?:string;done?:boolean})=>void):()=>void;
 looks?(operation:string,...args:unknown[]):Promise<any>;
 output(operation:'file'|'folder'|'write'|'close'|'abort'|'frame'|'frameFile',...args:unknown[]):Promise<any>;
 animationQueue?(operation:'list'|'enqueue'|'clone'|'start'|'next'|'write'|'finish'|'pause'|'stop'|'retry'|'openFolder',...args:unknown[]):Promise<any>;
 onMenu(callback:(name:string)=>void):()=>void;
 onScene(callback:(data:{name:string;text:string})=>void):()=>void;
}
/** MCP-01: the optional AI bridge as the window sees it (see desktop/preload.cjs). Plain JSON only. */
export interface AiBridgeState {running:boolean;endpointFile:string;connections:number;protocol:string;registered:boolean;shimPath:string|null}
export interface AiChatConfig {available:boolean;reason?:string;providers?:{id:string;label:string;keyEnv:string;hasKey:boolean;costKnown:boolean;keyStatus?:{stored:boolean;fromEnv:boolean;protectedStorage:boolean;envName:string}}[];recommended?:Record<string,string[]>;defaultProvider?:string;modes?:{id:string;title:string;budget:Record<string,number>;readOnly?:boolean}[];defaults?:Record<string,number>;hardMax?:Record<string,number>}
export interface AiChatModel {id:string;recommended?:boolean;available?:boolean;capabilities?:string[]}
export interface AiChatSendOptions {mode:string;provider:string;model:string;budget?:Record<string,number>;images?:{mime:string;base64:string}[];activeDraftId?:string;allowDemo?:boolean}
export interface AiChatSession {log:{who:string;text:string}[];mode?:string;provider?:string;model?:string;activeDraftId?:string;lastExplanation?:string}
export interface AiChatHost {
 config():Promise<AiChatConfig>;models(provider:string):Promise<{provider:string;models:AiChatModel[];source:string;note?:string}>;
 send(text:string,options:AiChatSendOptions):Promise<{status:string;message?:string;finalOutput?:string}>;cancel():Promise<boolean>;reset():Promise<boolean>;
 keySet(provider:string,key:string):Promise<{stored:boolean;fromEnv:boolean;protectedStorage:boolean;envName:string}>;keyClear(provider:string):Promise<{stored:boolean;fromEnv:boolean;protectedStorage:boolean;envName:string}>;keyTest(provider:string,model:string):Promise<{ok:boolean;message:string}>;
 state():Promise<{running:boolean;turns:number;historyItems:number}>;saveSession(ui:AiChatSession):Promise<boolean>;loadSession():Promise<{ui:AiChatSession;engineRestored:boolean;savedAt?:number}|null>;onEvent(callback:(event:Record<string,any>)=>void):()=>void;
}
export interface AiHost {
 register():Promise<AiBridgeState>;status():Promise<AiBridgeState>;enable():Promise<AiBridgeState>;disable():Promise<AiBridgeState>;
 respond(id:string,result:unknown):Promise<boolean>;
 drafts:{save(id:string,text:string):Promise<boolean>;list():Promise<{drafts:string[];problems:{id:string;reason:string}[]}>;remove(id:string):Promise<boolean>};
 knowledge:{list():Promise<string[]>;append(text:string):Promise<boolean>};
 chat:AiChatHost;
 onRequest(callback:(message:{id:string;op:string;args:unknown})=>void):()=>void;
 onCancel(callback:(message:{id:string})=>void):()=>void;
 onState(callback:(state:AiBridgeState)=>void):()=>void;
}
declare global {interface Window {noemaDesktop?:DesktopHost;noemaAi?:AiHost}}
export const aiHost:AiHost|undefined=typeof window!=='undefined'?window.noemaAi:undefined;
export function selectDesktopHost(host:DesktopHost|undefined,protocol:string){
 if(protocol==='noema:'&&(!host||typeof host.library!=='function'||typeof host.info!=='function'))throw Error('The desktop connection is missing. The library is not opened as an empty browser storage. Restart NOEMA Fractal.');
 return host;
}
export const desktop=typeof window!=='undefined'?selectDesktopHost(window.noemaDesktop,window.location.protocol):undefined;
