// Portable Windows release. Explicit inputs; never imports a profile, map pack or scene.
// npm ci; npm ci --prefix tools/noema-mcp; npm ci --prefix tools/openai-pilot
// npm run desktop:build; npm run desktop:pack -- <new-output-folder>
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]??'release/NOEMA-Fractal-1.0');
if(fs.existsSync(output))throw Error('Use a new output directory.');
const runtime=path.join(root,'node_modules/electron/dist');
for(const p of ['electron.exe','LICENSE','LICENSES.chromium.html'])if(!fs.existsSync(path.join(runtime,p)))throw Error('Install the pinned Electron runtime first.');
for(const p of ['desktop-dist/index.html','desktop-code/validation.cjs','desktop-dist/manual/index.html','tools/noema-mcp/node_modules','tools/openai-pilot/node_modules'])if(!fs.existsSync(path.join(root,p)))throw Error('Missing build input: '+p);
const copy=(from,to,filter)=>fs.cpSync(from,to,{recursive:true,filter,dereference:false});
// Preserve runtime code, data and all license/notice files; omit development-only artifacts.
const runtimeFile=(file)=>{
 const parts=file.split(path.sep);
 if(parts.some(x=>['.git','.github','.bin','test','tests','__tests__','examples','benchmark','benchmarks','coverage','@types'].includes(x)))return false;
 const name=path.basename(file);
 if(/^(license|licence|copying|notice|copyright)/i.test(name))return true;
 if(fs.lstatSync(file).isSymbolicLink())throw Error('Unreviewed symbolic link: '+file);
 if(fs.statSync(file).isDirectory())return true;
 return !(/\.(?:ts|mts|cts|map|md|markdown|log)$/.test(name)||['.package-lock.json','.DS_Store'].includes(name));
};
const exe=path.join(output,'NOEMA Fractal');
copy(runtime,exe,s=>path.basename(s)!=='default_app.asar');
fs.renameSync(path.join(exe,'electron.exe'),path.join(exe,'NOEMA Fractal.exe'));
const app=path.join(exe,'resources/app');fs.mkdirSync(app,{recursive:true});
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:pkg.name,productName:'NOEMA Fractal',version:pkg.version,main:'desktop/main.cjs',license:pkg.license},null,2)+'\n');
for(const folder of ['desktop-dist','desktop-code'])copy(path.join(root,folder),path.join(app,folder));
fs.mkdirSync(path.join(app,'desktop'),{recursive:true});
for(const n of fs.readdirSync(path.join(root,'desktop')))if(/\.(cjs|html)$/.test(n)&&n!=='builder.cjs')fs.copyFileSync(path.join(root,'desktop',n),path.join(app,'desktop',n));
for(const folder of ['tools/noema-mcp','tools/openai-pilot']){
 fs.mkdirSync(path.join(app,folder),{recursive:true});
 for(const name of fs.readdirSync(path.join(root,folder)))if(/\.mjs$/.test(name)||name==='package.json')fs.copyFileSync(path.join(root,folder,name),path.join(app,folder,name));
 copy(path.join(root,folder,'node_modules'),path.join(app,folder,'node_modules'),runtimeFile);
}
fs.mkdirSync(path.join(app,'src/capabilities'),{recursive:true});
fs.copyFileSync(path.join(root,'src/capabilities/manifest.json'),path.join(app,'src/capabilities/manifest.json'));
for(const name of ['LICENSE','NOTICE','LICENSING.md','CREDITS.md','THIRD_PARTY_NOTICES.md']){
 fs.copyFileSync(path.join(root,name),path.join(output,name));
 fs.copyFileSync(path.join(root,name),path.join(app,name));
}
copy(path.join(root,'LICENSES'),path.join(output,'LICENSES'));
for(const [from,to] of [['docs/START_HERE.md','START_HERE.md'],['docs/release/1.0/KNOWN-PROBLEMS.md','KNOWN-PROBLEMS.md']])fs.copyFileSync(path.join(root,from),path.join(output,to));
fs.writeFileSync(path.join(output,'Start-NOEMA-Fractal.cmd'),[
 '@echo off','setlocal','set "ELECTRON_RUN_AS_NODE="','set "NOEMA_GEO8_ROOT="','set "NOEMA_AI_TEST_ENDPOINTS="',
 'if not exist "%~dp0Profile" mkdir "%~dp0Profile"',
 'start "" "%~dp0NOEMA Fractal\\NOEMA Fractal.exe" "--noema-test-profile=%~dp0Profile"','endlocal',''
].join('\r\n'));
console.log('Prepared portable distribution:',output);
