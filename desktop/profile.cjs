const fs=require('node:fs/promises');
const path=require('node:path');

// Storage identity is independent of package.json, product titles and release versions.
const PROFILE_NAME='NOEMA Fractal';
function resolveProfile(appData,args=[]){
 if(!path.isAbsolute(appData))throw Error('AppData must be absolute');
 const overrides=args.filter(arg=>arg.startsWith('--noema-test-profile='));
 if(overrides.length>1)throw Error('Multiple test profiles');
 if(overrides.length){const folder=overrides[0].slice('--noema-test-profile='.length);if(!path.isAbsolute(folder))throw Error('Test profile must be absolute');return {folder:path.resolve(folder),mode:'explicit-test'};}
 return {folder:path.join(appData,PROFILE_NAME),mode:'normal'};
}
async function hasPopulatedIndex(folder){
 try{const index=JSON.parse(await fs.readFile(path.join(folder,'index.json'),'utf8'));return index?.version===1&&index.entries&&Object.keys(index.entries).length>0;}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return false;throw error;}
}
async function assertNoHiddenLibrary(profile,appData,localAppData){
 // An existing index is validated by DiskLibrary, never bypassed by profile discovery.
 try{await fs.access(path.join(profile.folder,'Library','index.json'));return;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(profile.mode!=='normal')return;
 const candidates=[path.join(appData,'fraktalmotorn','Library')];
 if(localAppData){
  const packages=path.join(localAppData,'Packages');
  let names=[];try{names=await fs.readdir(packages,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const entry of names)if(entry.isDirectory())candidates.push(path.join(packages,entry.name,'LocalCache','Roaming',PROFILE_NAME,'Library'));
 }
 const populated=[];for(const candidate of candidates)if(await hasPopulatedIndex(candidate))populated.push(candidate);
 if(populated.length)throw Error('The library lacks an index in '+path.join(profile.folder,'Library')+'. An earlier library exists in '+populated.join(', ')+'. No empty replacement was created. Back up and import the earlier library into the normal profile.');
}
module.exports={PROFILE_NAME,resolveProfile,assertNoHiddenLibrary};
