import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {selectDesktopHost} from '../src/app/desktop';
const {resolveProfile,assertNoHiddenLibrary}=createRequire(import.meta.url)('../desktop/profile.cjs');
describe('stable desktop profile and fail-closed backend selection',()=>{
 it('boots the actual main entry point into the pinned profile instead of Electron product-derived userData',()=>{
  const appData=path.resolve('roaming-fixture'),entry=path.resolve('desktop/main.cjs'),requireDesktop=createRequire(entry);
  for(const productName of ['fraktalmotorn','NOEMA Fractal 0.2']){
   const paths:unknown[]=[];
   const app={setName(){},getPath:(key:string)=>key==='appData'?appData:path.join(appData,productName),setPath:(key:string,value:string)=>paths.push([key,value]),requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then:()=>({catch(){}})})};
   runInNewContext(readFileSync(entry,'utf8'),{require:(name:string)=>name==='electron'?{app,protocol:{registerSchemesAsPrivileged(){}}}:requireDesktop(name),process:{argv:[productName],env:{}},__dirname:path.dirname(entry)});
   expect(paths).toEqual([['userData',path.join(appData,'NOEMA Fractal')]]);
  }
 });
 it('pins the original storage identity across executable/product/version changes',()=>{
  const appData=path.resolve('profile-fixture');
  for(const title of ['NOEMA Fractal.exe','NOEMA-Fractal-0.2.exe','fraktalmotorn'])expect(resolveProfile(appData,[title,'--version=0.2','--user-data-dir=wrong'])).toEqual({folder:path.join(appData,'NOEMA Fractal'),mode:'normal'});
  expect(resolveProfile(appData,['--noema-test-profile='+path.resolve('isolated')]).mode).toBe('explicit-test');
  expect(()=>resolveProfile(appData,['--noema-test-profile='])).toThrow();
  expect(()=>resolveProfile(appData,['--noema-test-profile=relative'])).toThrow();
 });
 it('refuses an empty normal profile when an MSIX-redirected library exists, without copying or creating files',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'noema-profile-'));
  try{
   const appData=path.join(root,'Roaming'),local=path.join(root,'Local'),profile=resolveProfile(appData),other=path.join(local,'Packages','Example.Package','LocalCache','Roaming','NOEMA Fractal','Library');
   await mkdir(other,{recursive:true});const bytes=JSON.stringify({version:1,entries:{'preset:artist':{}}});await writeFile(path.join(other,'index.json'),bytes);
   await expect(assertNoHiddenLibrary(profile,appData,local)).rejects.toThrow('No empty replacement');
   await expect(readdir(profile.folder)).rejects.toMatchObject({code:'ENOENT'});
   expect(await readFile(path.join(other,'index.json'),'utf8')).toBe(bytes);
   await mkdir(path.join(profile.folder,'Library'),{recursive:true});await writeFile(path.join(profile.folder,'Library','index.json'),'existing index validated by DiskLibrary');
   await expect(assertNoHiddenLibrary(profile,appData,local)).resolves.toBeUndefined();
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('keeps web IndexedDB but never silently falls back to it on the desktop origin',()=>{
  expect(selectDesktopHost(undefined,'http:')).toBeUndefined();
  expect(()=>selectDesktopHost(undefined,'noema:')).toThrow('empty browser storage');
  const host={library(){},info(){}} as any;expect(selectDesktopHost(host,'noema:')).toBe(host);
  expect(()=>selectDesktopHost({} as any,'noema:')).toThrow();
 });
});
