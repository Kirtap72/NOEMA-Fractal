const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomicWrite}=require('./storage.cjs');
/** Tokens refer only to paths selected by a native dialog in this app session. */
class DesktopExports {
 constructor(){this.files=new Map();this.folders=new Map();}
 async file(target){if(this.files.size>=8)throw Error('Too many active exports');const token=randomUUID(),temporary=target+'.'+token+'.tmp',handle=await fs.open(temporary,'wx');this.files.set(token,{target,temporary,handle});return {token,name:path.basename(target)};}
 folder(target){if(this.folders.size>=32)this.folders.delete(this.folders.keys().next().value);const token=randomUUID();this.folders.set(token,target);return {token,name:path.basename(target)};}
 bytes(data){if(!(data instanceof Uint8Array)||data.byteLength>64*1024*1024)throw Error('Invalid export chunk / 64 MiB chunk budget');return data;}
 async write(token,data){const file=this.files.get(token);if(!file)throw Error('Unknown export token');await file.handle.writeFile(this.bytes(data));}
 async close(token){const file=this.files.get(token);if(!file)throw Error('Unknown export token');await file.handle.sync();await file.handle.close();await fs.rename(file.temporary,file.target);this.files.delete(token);}
 async abort(token){const file=this.files.get(token);if(!file)return;this.files.delete(token);await file.handle.close().catch(()=>{});await fs.rm(file.temporary,{force:true});}
 framePath(token,name){const folder=this.folders.get(token);if(!folder||typeof name!=='string'||name.length>180||/[\\/:\x00]/.test(name)||name==='.'||name==='..'||name!==path.basename(name))throw Error('Invalid output filename / folder token');return path.join(folder,name);}
 async frame(token,name,data){await atomicWrite(this.framePath(token,name),this.bytes(data));}
 async frameFile(token,name){return this.file(this.framePath(token,name));}
 async dispose(){for(const token of this.files.keys())await this.abort(token);}
}
module.exports={DesktopExports};
