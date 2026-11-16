import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,readdir,rm,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import * as validators from '../src/engine/discoveryLibrary';
import {createMaterialRecord,readMaterialRecord} from '../src/engine/materialPresets';
import {createDefaultScene} from '../src/engine/scene';
import {parseFormula} from '../src/engine/formula/parse';
import {readFileSync} from 'node:fs';
const {DiskLibrary,readBackup,atomicWrite}=createRequire(import.meta.url)('../desktop/storage.cjs');
const nativeFs:typeof import('node:fs/promises')=createRequire(import.meta.url)('node:fs/promises');
const formula=parseFormula(readFileSync('formulas/mandelbulb.yaml','utf8'));if(!formula.ok)throw Error('fixture');
const scene=createDefaultScene(formula.formula);
const record=(id='preset:one')=>validators.createLibraryRecord({kind:'preset',scene},'Ett verk','',''+id);
const backup=(records:unknown[])=>({format:'noema-fractal-library',version:1,exportedAt:new Date().toISOString(),records});
let folder:string,store:any;
beforeEach(async()=>{folder=await mkdtemp(path.join(os.tmpdir(),'noema-storage-'));store=new DiskLibrary(folder,validators);await store.initialize();});
afterEach(async()=>{await rm(folder,{recursive:true,force:true});});
describe('desktop atomic content-addressed production library',()=>{
 it('retries short Windows replacement locks and preserves old bytes after persistent failure',async()=>{
  const file=path.join(folder,'recent.json');await atomicWrite(file,'previous');const original=nativeFs.rename;
  let calls=0;const spy=vi.spyOn(nativeFs,'rename').mockImplementation(async(from,to)=>{if(calls++<2)throw Object.assign(Error('temporary lock'),{code:'EPERM'});return original(from,to);});
  try{await atomicWrite(file,'complete');expect(calls).toBe(3);expect(await readFile(file,'utf8')).toBe('complete');
   spy.mockImplementation(async()=>{throw Object.assign(Error('persistent lock'),{code:'EBUSY'});});await expect(atomicWrite(file,'lost')).rejects.toThrow('persistent lock');expect(await readFile(file,'utf8')).toBe('complete');expect((await readdir(folder)).filter(n=>n.endsWith('.tmp'))).toEqual([]);
  }finally{spy.mockRestore();}
 });
 it('keeps material CRUD/portable gzip in a separate collection without touching nineteen artworks',async()=>{
  for(let i=0;i<19;i++)await store.put(record('art:'+i));
  const original=await readFile(path.join(folder,'index.json'));
  const mv={readLibraryRecord:readMaterialRecord,canonicalLibraryValue:validators.canonicalLibraryValue};
  const directory=path.join(folder,'separate-materials'),materials=new DiskLibrary(directory,mv,'noema-material-library');await materials.initialize();
  const first=createMaterialRecord({kind:'material',material:scene.material,color:scene.color},'Reusable','material:first');await materials.put(first);await materials.put({...first,title:'Renamed'});await materials.put({...first,id:'material:copy'});await materials.remove('material:first');
  const file=path.join(folder,'materials.library.json.gz');await materials.exportTo(file);const saved=await readBackup(file);expect(saved.format).toBe('noema-material-library');expect(saved.records).toEqual([{...first,id:'material:copy'}]);
  const restored=new DiskLibrary(path.join(folder,'restored-materials'),mv,'noema-material-library');await restored.initialize();await restored.import(saved);expect(await restored.get('material:copy')).toEqual({...first,id:'material:copy'});
  await expect(restored.import(backup([record()]))).rejects.toThrow();await expect(store.import(saved)).rejects.toThrow();
  expect(await readFile(path.join(folder,'index.json'))).toEqual(original);expect((await store.page()).total).toBe(19);
 });
 it('does not silently replace a lost index with an empty library over orphaned artwork',async()=>{await store.put(record('artist'));const objects=await readdir(path.join(folder,'objects'));const bytes=await readFile(path.join(folder,'objects',objects[0]!));await unlink(path.join(folder,'index.json'));await expect(new DiskLibrary(folder,validators).initialize()).rejects.toThrow('No empty replacement');expect(await readFile(path.join(folder,'objects',objects[0]!))).toEqual(bytes);await expect(readFile(path.join(folder,'index.json'))).rejects.toMatchObject({code:'ENOENT'});});
 it('adds twelve recovered works without losing five existing artist records, then reopens and exports all seventeen',async()=>{
  const artists=Array.from({length:5},(_,i)=>({...record('artist:'+i),title:'User artwork '+i,notes:'Original artist settings '+i,tags:'artist',rating:4}));
  for(const artist of artists)await store.put(artist);
  const recovered=Array.from({length:12},(_,i)=>record('recovered:'+i));expect(await store.import(backup(recovered))).toEqual({added:12,duplicates:0});
  const reopened=new DiskLibrary(folder,validators);await reopened.initialize();expect((await reopened.page()).total).toBe(17);
  for(const artist of artists)expect(await reopened.get(artist.id)).toEqual(artist);
  const file=path.join(folder,'all-seventeen.library.json.gz');await reopened.exportTo(file);const saved=await readBackup(file);expect(saved.records).toHaveLength(17);for(const artist of artists)expect(saved.records.find((r:any)=>r.id===artist.id)).toEqual(artist);
 });
 it('persists exact records and thumbnails across a new instance without IndexedDB',async()=>{const r=record();await store.put(r);const reopen=new DiskLibrary(folder,validators);await reopen.initialize();expect(await reopen.get(r.id)).toEqual(r);expect((await reopen.page()).total).toBe(1);expect(await reopen.thumbnail(r.id)).toEqual({thumbnail:'',thumbnailState:undefined,title:r.title});});
 it('preserves long text byte-for-byte, shares content assets and detects corruption',async()=>{const r=record();r.thumbnail='data:image/png;base64,'+'a'.repeat(70000);await store.put(r);await store.put({...r,id:'preset:two'});const files=await readdir(path.join(folder,'assets'));expect(files).toHaveLength(1);expect(await store.get(r.id)).toEqual(r);await writeFile(path.join(folder,'assets',files[0]!),Buffer.from('bad gzip'));await expect(store.get(r.id)).rejects.toThrow();expect((await store.page()).total).toBe(2);});
 it('imports atomically, rejects conflicting IDs, preserves metadata and skips exact duplicates',async()=>{const r=record();await store.import(backup([r]));expect(await store.import(backup([{...r,title:'Changed'}]))).toEqual({added:0,duplicates:1});const conflict=record();conflict.payload.kind==='preset'&&(conflict.payload.scene.camera.position[0]+=1);conflict.fingerprint=validators.libraryPayloadFingerprint(conflict.payload);await expect(store.import(backup([record('new'),conflict]))).rejects.toThrow('ID conflict');expect((await store.page()).total).toBe(1);expect((await store.get(r.id)).title).toBe(r.title);});
 it('serializes concurrent writes and stale thumbnail completions cannot resurrect deletion',async()=>{await Promise.all([store.put(record('a')),store.put(record('b'))]);expect((await store.page()).total).toBe(2);const r=await store.update('a','begin',[]);await store.remove('a');expect(await store.update('a','finish',[r.thumbnailState.generation,r.fingerprint,'',{}])).toBeUndefined();expect((await store.page()).total).toBe(1);});
 it('restores last complete index on corruption and fails explicitly if both copies are corrupt',async()=>{await store.put(record('a'));await store.put(record('b'));await writeFile(path.join(folder,'index.json'),'partial');const reopen=new DiskLibrary(folder,validators);await reopen.initialize();expect((await reopen.page()).total).toBe(1);expect(reopen.notice).toContain('was restored');await reopen.put(record('c'));expect((await reopen.page()).total).toBe(2);await writeFile(path.join(folder,'index.json'),'bad');await writeFile(path.join(folder,'index.previous.json'),'bad');await expect(new DiskLibrary(folder,validators).initialize()).rejects.toThrow();});
 it('streams a gzip backup, reimports it and retains exact records',async()=>{await store.put(record());const file=path.join(folder,'backup.library.json.gz');await store.exportTo(file);const raw=await readBackup(file);expect(raw.records).toEqual([await store.get('preset:one')]);const target=new DiskLibrary(path.join(folder,'clean'),validators);await target.initialize();expect(await target.import(raw)).toEqual({added:1,duplicates:0});expect(await target.get('preset:one')).toEqual(await store.get('preset:one'));});
 it('bounds expansion and refuses traversal or unrecognized operations',async()=>{await expect(store.get('../../secrets')).rejects.toThrow('ID');await expect(store.update('preset:one','execute',[])).resolves.toBeUndefined();expect(()=>store.objectPath('../x')).toThrow('hash');const file=path.join(folder,'atomic');await atomicWrite(file,'first');await atomicWrite(file,'second');expect(await readFile(file,'utf8')).toBe('second');});
});
