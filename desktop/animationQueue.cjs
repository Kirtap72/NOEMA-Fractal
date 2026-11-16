// Separate from Library/Materials. Only native-selected roots and queue-owned job folders are writable.
const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const {atomicWrite}=require('./storage.cjs');
const sha=x=>createHash('sha256').update(x).digest('hex');
const hashFile=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
const idValue=id=>{if(typeof id!=='string'||!/^[-a-f0-9]{36}$/.test(id))throw Error('Invalid animation job ID');return id;};
const states=['queued','running','paused','interrupted','complete','failed','cancelled'];
const BUDGET=128*1024*1024;
const directoryIdentity=async folder=>{const s=await fs.stat(folder,{bigint:true});return s.dev+':'+s.ino;};
async function readJson(file,limit=32*1024*1024){const s=await fs.stat(file);if(s.size>limit)throw Error('Manifest exceeds memory budget');return JSON.parse(await fs.readFile(file,'utf8'));}
async function imageHeader(file,o){
 const h=await fs.open(file,'r');try{
  const size=(await h.stat()).size,head=Buffer.alloc(Math.min(65536,size));await h.read(head,0,head.length,0);
  if(o.format==='png'){
   const tail=Buffer.alloc(12);await h.read(tail,0,12,size-12);
   if(head.length<33||head.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||head.toString('ascii',12,16)!=='IHDR'||head.readUInt32BE(16)!==o.width||head.readUInt32BE(20)!==o.height||head[24]!==8||head[25]!==2||tail.toString('hex')!=='0000000049454e44ae426082')throw Error('PNG header/dimensions/finish mismatch');
  }else{
   if(head.length<16||head.readUInt32LE(0)!==20000630||head.readUInt32LE(4)!==2)throw Error('Invalid EXR header');
   let p=8,box,channels,compression;
   const text=()=>{const end=head.indexOf(0,p);if(end<0)throw Error('Unbounded EXR header');const s=head.toString('ascii',p,end);p=end+1;return s;};
   while(head[p]){const name=text(),type=text();if(p+4>head.length)throw Error('Incomplete EXR header');const n=head.readUInt32LE(p);p+=4;if(p+n>=head.length)throw Error('EXR header budget exceeded');const b=head.subarray(p,p+n);if(name==='dataWindow'&&type==='box2i')box=b;if(name==='channels'&&type==='chlist')channels=b;if(name==='compression')compression=b[0];p+=n;}
   p++;if(!box||box.length!==16||box.readInt32LE(0)!==0||box.readInt32LE(4)!==0||box.readInt32LE(8)+1!==o.width||box.readInt32LE(12)+1!==o.height||compression!==0||!channels)throw Error('EXR layout/dimensions mismatch');
   let at=0,bytes=0,names=[];while(channels[at]){const end=channels.indexOf(0,at);if(end<0||end+17>channels.length)throw Error('Invalid EXR channels');names.push(channels.toString('ascii',at,end));const type=channels.readInt32LE(end+1);if(type!==(o.format==='exr-half'?1:2))throw Error('EXR precision mismatch');bytes+=type===1?2:4;at=end+17;}
   if(names.join(',')!=='A,B,G,R'||size!==p+o.height*8+o.height*(8+o.width*bytes))throw Error('Incomplete EXR scanlines');
  }
  return size;
 }finally{await h.close();}
}
class AnimationQueue {
 constructor(folder,v,compatibility){this.folder=folder;this.v=v;this.compatibility=compatibility;this.tail=Promise.resolve();this.active=null;this.frame=null;}
 transaction(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
 jobPath(id){return path.join(this.folder,idValue(id));}
 manifestPath(id){return path.join(this.jobPath(id),'manifest.json');}
 async save(j){j.updatedAt=new Date().toISOString();await atomicWrite(this.manifestPath(j.id),JSON.stringify(j));return this.summary(j);}
 validate(j,id){
  if(j?.format!=='noema-animation-job'||j.version!==1||j.id!==id||!states.includes(j.state)||typeof j.signature!=='string'||!/^[a-f0-9]{64}$/.test(j.signature)||!/^[a-f0-9]{64}$/.test(j.snapshotHash)||typeof j.compatibility!=='string'||!path.isAbsolute(j.outputFolder)||!j.completed||typeof j.completed!=='object'||Array.isArray(j.completed))throw Error('Invalid job manifest; originals preserved');
  j.options=this.v.readSequenceOptions(j.options);if(path.basename(j.outputFolder)!==j.options.prefix+'-'+j.id||typeof j.outputIdentity!=='string'||j.signature!==sha(JSON.stringify([j.snapshotHash,j.options,j.compatibility,j.outputFolder,j.outputIdentity])))throw Error('Job settings/directory/signature mismatch');
  for(const [n,r]of Object.entries(j.completed))this.validateReceipt(j,Number(n),r);return j;
 }
 async load(id){return this.validate(await readJson(this.manifestPath(id)),id);}
 summary(j){const {completed,...rest}=j;return {...rest,done:Object.keys(completed).length,total:this.v.sequenceFrameCount(j.options)};}
 async list(){return this.transaction(async()=>{
  let entries;try{entries=await fs.readdir(this.folder,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return {jobs:[],issues:[]};throw e;}
  const jobs=[],issues=[];for(const entry of entries){if(!entry.isDirectory()||!/^[-a-f0-9]{36}$/.test(entry.name))continue;try{const j=await this.load(entry.name);if(j.state==='running'&&this.active!==j.id){j.state='interrupted';j.error='Application interrupted. Verify completed files and explicitly Resume.';await this.save(j);}jobs.push(this.summary(j));}catch(e){issues.push({id:entry.name,error:String(e)});}}
  jobs.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));return {jobs,issues};
 });}
 async enqueue(raw,options,selectedRoot){return this.transaction(async()=>{
  // Validate on both sides of IPC. Snapshot bytes are frozen and content hashed, never a mutable recent-file reference.
  const snapshot=this.v.readAnimationSnapshot(raw),o=this.v.readSequenceOptions(options,snapshot.scene.cameraFlight?.duration_seconds),text=JSON.stringify(snapshot);
  if(Buffer.byteLength(text)>BUDGET)throw Error('Frozen scene exceeds 128 MiB budget');
  const root=await fs.realpath(selectedRoot),stat=await fs.stat(root);if(!stat.isDirectory())throw Error('Output must be a folder');
  const id=randomUUID(),outputFolder=path.join(root,o.prefix+'-'+id);
  await fs.mkdir(outputFolder); // unique, exclusive: no unrelated output is overwritten
  await fs.mkdir(path.join(this.jobPath(id),'frames'),{recursive:true});
  const snapshotHash=sha(text),outputIdentity=await directoryIdentity(outputFolder),j={format:'noema-animation-job',version:1,id,createdAt:new Date().toISOString(),compatibility:this.compatibility,snapshotHash,options:o,signature:sha(JSON.stringify([snapshotHash,o,this.compatibility,outputFolder,outputIdentity])),state:'queued',outputFolder,outputIdentity,completed:{}};
  await atomicWrite(path.join(this.jobPath(id),'snapshot.json.gz'),gzipSync(text));await this.save(j);return this.summary(j);
 });}
 async snapshot(j){const file=path.join(this.jobPath(j.id),'snapshot.json.gz');if((await fs.stat(file)).size>BUDGET)throw Error('Snapshot archive exceeds budget');const text=gunzipSync(await fs.readFile(file),{maxOutputLength:BUDGET}).toString('utf8');if(sha(text)!==j.snapshotHash)throw Error('Frozen scene/resources hash mismatch');return this.v.readAnimationSnapshot(JSON.parse(text));}
 async folderCheck(j){if(await fs.realpath(j.outputFolder)!==j.outputFolder||await directoryIdentity(j.outputFolder)!==j.outputIdentity)throw Error('Output folder identity changed. Preserve outputs and use a new job.');if(!(await fs.stat(j.outputFolder)).isDirectory())throw Error('Output folder unavailable');}
 receiptPath(j,n){return path.join(this.jobPath(j.id),'frames',n+'.json');}
 validateReceipt(j,n,r){const name=this.v.sequenceFrameName(j.options,n);if(r?.identity!==sha(j.signature+':'+n)||r.name!==name||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isSafeInteger(r.bytes)||r.bytes<1)throw Error('Invalid completion identity');return r;}
 async verify(j){
  await this.folderCheck(j);const complete={};
  // Include durable write-ahead receipts: a crash after publication but before manifest update is recoverable.
  const receipts=await fs.readdir(path.join(this.jobPath(j.id),'frames'));
  for(const name of receipts){if(!/^\d+\.json$/.test(name))continue;const n=Number(name.slice(0,-5)),r=this.validateReceipt(j,n,await readJson(this.receiptPath(j,n),4096)),file=path.join(j.outputFolder,r.name);
   try{const bytes=await imageHeader(file,j.options);if(bytes!==r.bytes||await hashFile(file)!==r.sha256)throw Error('Completed frame hash mismatch: '+r.name);complete[n]=r;}catch(e){if(e.code==='ENOENT'&&!j.completed[n])continue;throw Error('Frame '+n+' failed integrity: '+e.message);}
  }
  for(const n of Object.keys(j.completed))if(!complete[n])throw Error('Missing completion receipt/frame '+n);
  j.completed=complete;return complete;
 }
 async start(id){return this.transaction(async()=>{
  if(this.active)throw Error('One animation job is already active');const j=await this.load(id);if(j.state==='complete')throw Error('Job already complete');
  if(j.compatibility!==this.compatibility)throw Error('Renderer/application build changed. Preserve this job; enqueue a new snapshot in this build rather than mixing versions.');
  try{const snapshot=await this.snapshot(j);await this.verify(j);j.state='running';delete j.error;delete j.pauseRequested;this.active=id;await this.save(j);return {job:this.summary(j),snapshot};}catch(e){j.state='failed';j.error=String(e);await this.save(j);throw e;}
 });}
 async next(id){return this.transaction(async()=>{
  if(this.active!==id||this.frame)throw Error('Animation ownership/frame conflict');const j=await this.load(id);
  if(j.pauseRequested){j.state='paused';this.active=null;await this.save(j);return {job:this.summary(j)};}
  let n=j.options.firstFrame;while(j.completed[n]&&n<=j.options.lastFrame)n++;
  if(n>j.options.lastFrame){j.state='complete';this.active=null;await this.save(j);return {job:this.summary(j)};}
  await this.folderCheck(j);const name=this.v.sequenceFrameName(j.options,n),target=path.join(j.outputFolder,name);
  try{await fs.access(target);throw Error('Unverified output collision: '+name+'. No file was overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}
  const token=randomUUID(),temporary=target+'.'+token+'.partial',handle=await fs.open(temporary,'wx');this.frame={id,n,token,target,temporary,handle};return {n,token,job:this.summary(j)};
 });}
 async write(token,bytes){return this.transaction(async()=>{if(!this.frame||this.frame.token!==token||!(bytes instanceof Uint8Array)||bytes.byteLength>8*1024*1024)throw Error('Invalid frame token/chunk (8 MiB)');await this.frame.handle.writeFile(bytes);});}
 async finish(token){return this.transaction(async()=>{
  const f=this.frame;if(!f||f.token!==token)throw Error('Invalid frame token');const j=await this.load(f.id);
  await f.handle.sync();await f.handle.close();f.handle=null;
  const r={name:this.v.sequenceFrameName(j.options,f.n),identity:sha(j.signature+':'+f.n),bytes:await imageHeader(f.temporary,j.options),sha256:await hashFile(f.temporary)};
  await atomicWrite(this.receiptPath(j,f.n),JSON.stringify(r));
  await fs.link(f.temporary,f.target); // exclusive atomic publication; rename() could overwrite an unrelated file
  await fs.unlink(f.temporary);j.completed[f.n]=r;this.frame=null;await this.save(j);return this.summary(j);
 });}
 async pause(id){return this.transaction(async()=>{const j=await this.load(id);if(this.active===id)j.pauseRequested=true;else if(j.state!=='complete')j.state='paused';return this.save(j);});}
 async stop(id,state='cancelled',error){return this.transaction(async()=>{
  if(!['cancelled','interrupted','failed'].includes(state))throw Error('Invalid stop state');const j=await this.load(id);
  if(this.frame?.id===id){const f=this.frame;this.frame=null;await f.handle?.close().catch(()=>{});/* Partial files are retained as evidence, never counted as frames. */}
  if(this.active===id)this.active=null;j.state=state;if(error)j.error=String(error).slice(0,2000);return this.save(j);
 });}
 async retry(id){return this.transaction(async()=>{
  if(this.active)throw Error('Pause active job first');const j=await this.load(id);await this.folderCheck(j);
  // Only files already identified by this job's authenticated receipts can be quarantined.
  for(const name of await fs.readdir(path.join(this.jobPath(id),'frames'))){if(!/^\d+\.json$/.test(name))continue;const n=Number(name.slice(0,-5)),r=this.validateReceipt(j,n,await readJson(this.receiptPath(j,n),4096)),file=path.join(j.outputFolder,r.name);
   let valid=false;try{valid=await imageHeader(file,j.options)===r.bytes&&await hashFile(file)===r.sha256;}catch{}
   if(!valid){try{await fs.rename(file,file+'.invalid-'+randomUUID());}catch(e){if(e.code!=='ENOENT')throw e;}delete j.completed[n];await fs.rename(this.receiptPath(j,n),this.receiptPath(j,n)+'.invalid-'+randomUUID());}
  }
  j.state='paused';delete j.error;return this.save(j);
 });}
 async dispose(){if(this.active)await this.stop(this.active,'interrupted','Application closed; Resume is explicit.');}
}
module.exports={AnimationQueue,imageHeader,hashFile};
