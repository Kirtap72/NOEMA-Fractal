const fs=require('node:fs/promises');
const {createReadStream,createWriteStream}=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {gzip,gunzip,createGzip,createGunzip}=require('node:zlib');
const {promisify}=require('node:util');
const {pipeline}=require('node:stream/promises');
const {Readable,Transform}=require('node:stream');
const compress=promisify(gzip),expand=promisify(gunzip),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const LIMIT=512*1024*1024;
async function replaceAtomically(temporary,file){
 // Short Windows locks must not require unlinking the previous good file.
 for(let attempt=0;;attempt++){
  try{await fs.rename(temporary,file);return;}catch(error){
   if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=5)throw error;
   await new Promise(resolve=>setTimeout(resolve,25*2**attempt));
  }
 }
}
async function atomicWrite(file,bytes){
 await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';
 try{const handle=await fs.open(temporary,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await replaceAtomically(temporary,file);}catch(error){await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
}
const validId=id=>{if(typeof id!=='string'||!/^[-\w:]{1,128}$/.test(id))throw Error('Invalid record ID');return id;};
class DiskLibrary {
 constructor(folder,validators,format='noema-fractal-library'){if(!['noema-fractal-library','noema-material-library','noema-look-library'].includes(format))throw Error('Invalid collection format');this.format=format;this.folder=folder;this.v=validators;this.tail=Promise.resolve();this.notice='';}
 transaction(fn){const job=this.tail.then(fn);this.tail=job.catch(()=>{});return job;}
 async initialize(){this.index={version:1,entries:{}};let found=false;
  for(const name of ['index.json','index.previous.json']){try{const bytes=await fs.readFile(path.join(this.folder,name),'utf8');found=true;const index=JSON.parse(bytes);if(index.version!==1||!index.entries||typeof index.entries!=='object'||Array.isArray(index.entries))throw Error('Invalid disk library index');for(const [id,entry] of Object.entries(index.entries)){validId(id);this.objectPath(entry.object);await fs.access(this.objectPath(entry.object));}this.index=index;if(name!=='index.json'){this.notice='The previous complete library index was restored after a storage error.';await fs.copyFile(path.join(this.folder,'index.json'),path.join(this.folder,'index.corrupt.'+randomUUID()+'.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});await atomicWrite(path.join(this.folder,'index.json'),JSON.stringify(index));}return;}catch(error){if(error.code==='ENOENT')continue;this.notice='The library index could not be read: '+String(error);}}
  if(found)throw Error(this.notice||'The files of the library are missing. Restore an exported backup.');
  for(const name of ['objects','assets']){
   let files=[];try{files=await fs.readdir(path.join(this.folder,name));}catch(error){if(error.code!=='ENOENT')throw error;}
   if(files.length)throw Error('The library index is missing but saved objects/resources remain in '+this.folder+'. No empty replacement was created. Back up the library before restoring.');
  }
  await fs.mkdir(path.join(this.folder,'objects'),{recursive:true});await fs.mkdir(path.join(this.folder,'assets'),{recursive:true});
 }

 objectPath(hash,asset=false){if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid content hash');return path.join(this.folder,asset?'assets':'objects',hash+(asset?'.txt.gz':'.json'));}
 async immutable(file,bytes){try{await fs.access(file);}catch(error){if(error.code!=='ENOENT')throw error;await atomicWrite(file,bytes);}}
 async detached(record){const assets=[];
  const visit=async(value,route)=>{if(typeof value==='string'&&value.length>=65536){const hash=sha(value);try{await fs.access(this.objectPath(hash,true));}catch(error){if(error.code!=='ENOENT')throw error;await this.immutable(this.objectPath(hash,true),await compress(Buffer.from(value)));}assets.push({route,hash});return null;}if(Array.isArray(value)){const out=[];for(let i=0;i<value.length;i++)out.push(await visit(value[i],[...route,i]));return out;}if(value&&typeof value==='object'){const out={};for(const [key,item]of Object.entries(value))Object.defineProperty(out,key,{value:await visit(item,[...route,key]),enumerable:true,writable:true,configurable:true});return out;}return value;};
  const data=await visit(record,[]),descriptor=JSON.stringify({version:1,data,assets}),hash=sha(descriptor);await this.immutable(this.objectPath(hash),descriptor);const {payload,thumbnail,...metadata}=record;return {object:hash,metadata,thumbnail:typeof data.thumbnail==='string'?{inline:data.thumbnail}:{asset:assets.find(a=>a.route.length===1&&a.route[0]==='thumbnail').hash}};
 }
 async asset(hash){const text=(await expand(await fs.readFile(this.objectPath(hash,true)),{maxOutputLength:LIMIT})).toString('utf8');if(sha(text)!==hash)throw Error('Asset hash mismatch: '+hash);return text;}
 async record(entry){const bytes=await fs.readFile(this.objectPath(entry.object));if(sha(bytes)!==entry.object)throw Error('Record hash mismatch');const descriptor=JSON.parse(bytes);if(descriptor.version!==1)throw Error('Invalid disk record version');for(const {route,hash}of descriptor.assets){let parent=descriptor.data;for(const key of route.slice(0,-1)){if(!Object.hasOwn(parent,key))throw Error('Invalid asset route');parent=parent[key];}Object.defineProperty(parent,route.at(-1),{value:await this.asset(hash),enumerable:true,writable:true,configurable:true});}return this.v.readLibraryRecord(descriptor.data);}
 async commit(entries){const file=path.join(this.folder,'index.json');try{const current=await fs.readFile(file);JSON.parse(current);await atomicWrite(path.join(this.folder,'index.previous.json'),current);}catch(error){if(error.code!=='ENOENT')throw error;}await atomicWrite(file,JSON.stringify({version:1,entries}));this.index={version:1,entries};}
 get(id){return this.transaction(async()=>{const entry=this.index.entries[validId(id)];return entry?this.record(entry):undefined;});}
 thumbnail(id){return this.transaction(async()=>{const entry=this.index.entries[validId(id)];return entry?{thumbnail:entry.thumbnail.asset?await this.asset(entry.thumbnail.asset):entry.thumbnail.inline,thumbnailState:entry.metadata.thumbnailState,title:entry.metadata.title}:undefined;});}
 page(search='',type='',offset=0,limit=24){return this.transaction(async()=>{if(typeof search!=='string'||typeof type!=='string'||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid library query');const query=search.trim().toLocaleLowerCase('en');const records=Object.values(this.index.entries).map(e=>e.metadata).filter(m=>(!type||m.type===type)&&(!query||(m.title+' '+m.tags+' '+m.notes).toLocaleLowerCase('en').includes(query))).sort((a,b)=>a.id.localeCompare(b.id,'en'));return {entries:records.slice(offset,offset+limit),total:records.length,notice:this.notice};});}
 put(raw){return this.transaction(async()=>{const record=this.v.readLibraryRecord(raw),entry=await this.detached(record);await this.commit({...this.index.entries,[record.id]:entry});});}
 remove(id){return this.transaction(async()=>{validId(id);const entries={...this.index.entries};delete entries[id];await this.commit(entries);});}
 update(id,operation,args){return this.transaction(async()=>{const entry=this.index.entries[validId(id)];if(!entry)return;const record=await this.record(entry);let next;
  if(operation==='metadata'){const value=args[0];if(!value||Object.keys(value).some(k=>!['title','rating','tags','notes'].includes(k)))throw Error('Invalid metadata');next={...record,...value};}
  else if(operation==='begin'){if(record.type!=='preset'&&record.type!=='legacy-variation')return;next={...record,thumbnail:'',thumbnailState:{...record.thumbnailState,status:'pending',generation:(record.thumbnailState?.generation??0)+1,sourceFingerprint:record.fingerprint,message:undefined}};}
  else if(operation==='finish'){const [generation,fingerprint,png,state]=args;if(record.fingerprint!==fingerprint||record.thumbnailState?.generation!==generation||record.thumbnailState.status!=='pending')return false;next={...record,thumbnail:png,thumbnailState:state};}
  else if(operation==='replace'){const [fingerprint,png,state]=args;if((record.type!=='preset'&&record.type!=='legacy-variation')||record.fingerprint!==fingerprint)return false;next={...record,thumbnail:png,thumbnailState:state};}
  else throw Error('Invalid update');next=this.v.readLibraryRecord(next);await this.commit({...this.index.entries,[id]:await this.detached(next)});return operation==='finish'||operation==='replace'?true:next;
 });}
 import(raw){return this.transaction(async()=>{if(!raw||raw.format!==this.format||raw.version!==1||typeof raw.exportedAt!=='string'||!Array.isArray(raw.records))throw Error('Unknown library backup/version.');const entries={...this.index.entries},ids=new Set();let added=0,duplicates=0;
  for(let i=0;i<raw.records.length;i++){const record=this.v.readLibraryRecord(raw.records[i]);if(ids.has(record.id))throw Error('Backup contains duplicate IDs');ids.add(record.id);const current=entries[record.id];
   if(current){const original=await this.record(current);if(this.v.canonicalLibraryValue(original.payload)!==this.v.canonicalLibraryValue(record.payload))throw Error('ID conflict with other content: '+record.id);duplicates++;continue;}
   let duplicate=false;for(const other of Object.values(entries)){if(other.metadata.type!==record.type||other.metadata.fingerprint!==record.fingerprint)continue;const original=await this.record(other);if(this.v.canonicalLibraryValue(original.payload)!==this.v.canonicalLibraryValue(record.payload))throw Error('Fingerprint conflict');if(record.type==='formula')duplicate=true;}
   if(duplicate){duplicates++;continue;}entries[record.id]=await this.detached(record);added++;
  }await this.commit(entries);return {added,duplicates};
 });}
 exportTo(file){return this.transaction(async()=>{const temporary=file+'.'+randomUUID()+'.tmp',self=this;async function* records(){yield '{"format":'+JSON.stringify(self.format)+',"version":1,"exportedAt":'+JSON.stringify(new Date().toISOString())+',"records":[';let first=true;for(const entry of Object.values(self.index.entries)){yield (first?'':',')+JSON.stringify(await self.record(entry));first=false;}yield ']}';}
  try{const source=Readable.from(records());await pipeline(...[source,...(/\.gz$/i.test(file)?[createGzip()]:[]),createWriteStream(temporary,{flags:'wx'})]);const handle=await fs.open(temporary,'r+');await handle.sync();await handle.close();await fs.rename(temporary,file);return {saved:file,count:Object.keys(this.index.entries).length};}catch(error){await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
 });}
}
async function readBackup(file){if((await fs.stat(file)).size>128*1024*1024)throw Error('Backup exceeds 128 MiB file budget');let size=0;const chunks=[],bounded=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;if(size>LIMIT)return callback(Error('Backup exceeds 512 MiB expanded budget'));chunks.push(chunk);callback();}});await pipeline(...[createReadStream(file),...(/\.gz$/i.test(file)?[createGunzip()]:[]),bounded]);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
module.exports={DiskLibrary,atomicWrite,readBackup};
