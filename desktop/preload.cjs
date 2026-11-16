const {contextBridge,ipcRenderer}=require('electron');
// No ipcRenderer, filesystem paths, Node primitives or event objects cross this bridge.
contextBridge.exposeInMainWorld('noemaDesktop',{
 info:()=>ipcRenderer.invoke('noema:info'),
 openScene:()=>ipcRenderer.invoke('noema:openScene'),
 saveScene:text=>ipcRenderer.invoke('noema:saveScene',text),
 library:(operation,...args)=>ipcRenderer.invoke('noema:library',operation,...args),
 materials:(operation,...args)=>ipcRenderer.invoke('noema:materials',operation,...args),
 polyHaven:(operation,...args)=>ipcRenderer.invoke('noema:polyhaven',operation,...args),
 feedback:{preview:note=>ipcRenderer.invoke('noema:feedback-preview',note),save:text=>ipcRenderer.invoke('noema:feedback-save',text)},
 onPolyHavenProgress:callback=>{const listener=(_event,p)=>callback(p);ipcRenderer.on('noema:polyhaven-progress',listener);return()=>ipcRenderer.removeListener('noema:polyhaven-progress',listener);},
 looks:(operation,...args)=>ipcRenderer.invoke('noema:looks',operation,...args),
 importLibrary:()=>ipcRenderer.invoke('noema:importLibrary'),
 exportLibrary:()=>ipcRenderer.invoke('noema:exportLibrary'),
 output:(operation,...args)=>ipcRenderer.invoke('noema:output',operation,...args),
 animationQueue:(operation,...args)=>ipcRenderer.invoke('noema:animationQueue',operation,...args),
 onMenu:callback=>{const listener=(_event,name)=>callback(name);ipcRenderer.on('noema:menu',listener);return()=>ipcRenderer.removeListener('noema:menu',listener);},
 onScene:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('noema:scene',listener);return()=>ipcRenderer.removeListener('noema:scene',listener);},
});

// MCP-01: the optional AI bridge. Only the application window uses this; requests and answers are plain JSON, no paths or objects.
contextBridge.exposeInMainWorld('noemaAi',{
 register:()=>ipcRenderer.invoke('noema:ai-register'),
 status:()=>ipcRenderer.invoke('noema:ai-status'),
 enable:()=>ipcRenderer.invoke('noema:ai-enable'),
 disable:()=>ipcRenderer.invoke('noema:ai-disable'),
 respond:(id,result)=>ipcRenderer.invoke('noema:ai-respond',id,result),
 drafts:{save:(id,text)=>ipcRenderer.invoke('noema:ai-drafts-save',id,text),list:()=>ipcRenderer.invoke('noema:ai-drafts-list'),remove:id=>ipcRenderer.invoke('noema:ai-drafts-remove',id)},
 knowledge:{list:()=>ipcRenderer.invoke('noema:ai-knowledge-list'),append:text=>ipcRenderer.invoke('noema:ai-knowledge-append',text)},
 chat:{config:()=>ipcRenderer.invoke('noema:ai-chat-config'),models:provider=>ipcRenderer.invoke('noema:ai-chat-models',provider),send:(text,options)=>ipcRenderer.invoke('noema:ai-chat-send',text,options),cancel:()=>ipcRenderer.invoke('noema:ai-chat-cancel'),reset:()=>ipcRenderer.invoke('noema:ai-chat-reset'),keySet:(provider,key)=>ipcRenderer.invoke('noema:ai-chat-key-set',provider,key),keyClear:provider=>ipcRenderer.invoke('noema:ai-chat-key-clear',provider),keyTest:(provider,model)=>ipcRenderer.invoke('noema:ai-chat-key-test',provider,model),saveSession:ui=>ipcRenderer.invoke('noema:ai-chat-session-save',ui),loadSession:()=>ipcRenderer.invoke('noema:ai-chat-session-load'),state:()=>ipcRenderer.invoke('noema:ai-chat-state'),onEvent:callback=>{const listener=(_event,e)=>callback(e);ipcRenderer.on('noema:ai-chat-event',listener);return()=>ipcRenderer.removeListener('noema:ai-chat-event',listener);}},
 onRequest:callback=>{const listener=(_event,message)=>callback(message);ipcRenderer.on('noema:ai-request',listener);return()=>ipcRenderer.removeListener('noema:ai-request',listener);},
 onCancel:callback=>{const listener=(_event,message)=>callback(message);ipcRenderer.on('noema:ai-cancel',listener);return()=>ipcRenderer.removeListener('noema:ai-cancel',listener);},
 onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('noema:ai-state',listener);return()=>ipcRenderer.removeListener('noema:ai-state',listener);},
});

if(process.argv.includes('--noema-geo8'))contextBridge.exposeInMainWorld('noemaGeo8',{paint:data=>ipcRenderer.invoke('noema:geo8','paint',data),cancel:()=>ipcRenderer.invoke('noema:geo8','cancel'),record:data=>ipcRenderer.invoke('noema:geo8','record',data),configure:profile=>ipcRenderer.invoke('noema:geo8','configure',profile)});
