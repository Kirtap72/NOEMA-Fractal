const {app, BrowserWindow, protocol, net, session, Menu, dialog, shell, ipcMain} = require('electron');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const fs = require('node:fs/promises');
const {createReadStream}=require('node:fs');
const {createGunzip}=require('node:zlib');
const {Readable}=require('node:stream');
const exportName=require('./exportName.cjs');
// Keep Chromium-owned dialogs in the same language as the English interface.
app.commandLine?.appendSwitch?.('lang','en-US');

// PROGRESSIVE-REFLECT-14: the DXC shader compiler builds the large multi-bounce picture shaders about a third faster than the default one (measured
// 36 s against 52 s for a platinum scene with three reflection bounces) and gives pixel-identical pictures. Set NOEMA_FXC=1 to turn it off.
if(!process.env.NOEMA_FXC)app.commandLine?.appendSwitch?.('enable-dawn-features','use_dxc');
app.setName('NOEMA Fractal');
const {resolveProfile,assertNoHiddenLibrary}=require('./profile.cjs');
const profile=resolveProfile(app.getPath('appData'),process.argv);
app.setPath('userData',profile.folder);
protocol.registerSchemesAsPrivileged([{scheme:'noema',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const origin = 'noema://app';
// Public distribution: no development host or external reference profile.
const geo8=undefined;
const contentPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";
const ownsProfile=app.requestSingleInstanceLock();if(!ownsProfile)app.quit();
let window;
app.on('second-instance',()=>{window?.show();window?.focus();});
const trusted = event => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === origin+'/';
function handle(name, fn) {ipcMain.handle('noema:'+name,async(event,...args)=>{if(!trusted(event))throw Error('Untrusted desktop request');return fn(...args);});}
function action(name) {window?.webContents.send('noema:menu',name);}
const recentFile=()=>path.join(app.getPath('userData'),'recent.json');
async function recent() {try{return JSON.parse(await fs.readFile(recentFile(),'utf8')).filter(p=>typeof p==='string'&&path.isAbsolute(p)).slice(0,8);}catch{return [];}}
let recentTail=Promise.resolve();
function remember(file) {const job=recentTail.then(async()=>{const {atomicWrite}=require('./storage.cjs');await atomicWrite(recentFile(),JSON.stringify([file,...(await recent()).filter(p=>p!==file)].slice(0,8)));await menu();});recentTail=job.catch(()=>{});return job;}
async function openScene(file) {if(!file){const result=await dialog.showOpenDialog(window,{title:'Open scene',properties:['openFile'],filters:[{name:'Fractal scene',extensions:['json']}]});if(result.canceled)return;file=result.filePaths[0];}if((await fs.stat(file)).size>128*1024*1024)throw Error('The scene exceeds the file budget of 128 MiB.');const text=await fs.readFile(file,'utf8');await remember(file);return {name:path.basename(file),text};}
async function menu() {const files=await recent();Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{label:'Open scene…',accelerator:'CmdOrCtrl+O',click:()=>action('open')},{label:'Save scene as…',accelerator:'CmdOrCtrl+Shift+S',click:()=>action('save')},{label:'Recent scenes',submenu:files.length?files.map(file=>({label:path.basename(file),click:async()=>{try{window.webContents.send('noema:scene',await openScene(file));}catch(error){dialog.showErrorBox('The scene could not be opened',String(error));}}})):[{label:'No saved scenes yet',enabled:false}]},{type:'separator'},{label:'My fractals',click:()=>action('library')},{label:'Material library…',click:()=>action('materials')},{label:'Import library…',click:()=>action('import')},{label:'Export library…',click:()=>action('export')},{label:'Show library folder',click:async()=>{const folder=path.join(app.getPath('userData'),'Library');await fs.mkdir(folder,{recursive:true});await shell.openPath(folder);}},{type:'separator'},{role:'quit',label:'Quit'}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'Help',submenu:[{label:'User manual (offline)',accelerator:'Shift+F1',click:()=>{const manual=new BrowserWindow({width:1100,height:800,title:'NOEMA Fractal – user manual',parent:window,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});manual.setMenuBarVisibility(false);manual.webContents.setWindowOpenHandler(()=>({action:'deny'}));manual.loadURL(origin+'/manual/index.html');}},{label:'Export feedback (local)…',click:()=>action('feedback')},{type:'separator'},{label:'About / graphics status',click:()=>action('status')},{label:'Read the local desktop guide',click:()=>{const help=new BrowserWindow({width:900,height:750,parent:window,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});help.webContents.setWindowOpenHandler(()=>({action:'deny'}));help.loadURL(origin+'/desktop-help.html');}}]}]));}
app.whenReady().then(async () => {
  if(!ownsProfile)return;
  await assertNoHiddenLibrary(profile,app.getPath('appData'),process.env.LOCALAPPDATA);
  const root = path.resolve(__dirname, '../desktop-dist');
  await protocol.handle('noema', async request => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app' || request.method !== 'GET') return new Response('Forbidden',{status:403});
      const resource=url.pathname.startsWith('/mb3d-maps/');
      const base=resource?(app.isPackaged?path.join(process.resourcesPath,'mb3d-maps'):path.resolve(__dirname,'../desktop-resources/mb3d-maps')):root;
      const pathname=resource?url.pathname.slice('/mb3d-maps'.length):url.pathname;
      const file = path.resolve(base, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(base + path.sep)) return new Response('Forbidden',{status:403});
      if(resource&&/\/\d+\.json$/.test(pathname)){await fs.access(file+'.gz');return new Response(Readable.toWeb(createReadStream(file+'.gz').pipe(createGunzip())),{headers:{'Content-Type':'application/json','Content-Security-Policy':contentPolicy}});}
      await fs.access(file);
      const response = await net.fetch(pathToFileURL(file).href);
      response.headers.set('Content-Security-Policy',contentPolicy);
      return response;
    } catch { return new Response('Resource unavailable',{status:404}); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window = new BrowserWindow({width:1440,height:960,title:geo8?'NOEMA Fractal · GEO8 Artist Test':'NOEMA Fractal',backgroundColor:'#111111',webPreferences:{preload:path.join(__dirname,'preload.cjs'),additionalArguments:geo8?['--noema-geo8']:[],sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('preload-error',(_event,_file,error)=>{dialog.showErrorBox('The desktop connection is missing','The library is not opened in an empty browser storage. '+String(error));app.quit();});
  window.webContents.on('will-navigate',(event,url)=>{if(url !== origin+'/')event.preventDefault();});
  window.webContents.on('render-process-gone',(_event,details)=>{dialog.showMessageBox({type:'error',title:'The window was interrupted',message:'The rendering window has ended ('+details.reason+'). Saved scenes and libraries are still on disk.',buttons:['Open again','Quit']}).then(result=>result.response===0?window.reload():app.quit());});
  app.on('child-process-gone',(_event,details)=>{if(details.type==='GPU')window?.webContents.send('noema:menu','gpu-lost');});
  if(geo8)handle('geo8',geo8.invoke);
  handle('info',async()=>({folder:path.join(app.getPath('userData'),'Library'),profile,version:app.getVersion(),features:app.getGPUFeatureStatus()}));
  const {DiskLibrary,readBackup}=require('./storage.cjs');
  const store=new DiskLibrary(path.join(app.getPath('userData'),'Library'),require('../desktop-code/validation.cjs'));await store.initialize();
  // Lazy, separate collection: opening the application never migrates artwork records.
  let materials;
  const materialCollection=()=>materials??=(async()=>{const v=require('../desktop-code/validation.cjs');const collection=new DiskLibrary(path.join(app.getPath('userData'),'Materials'),{readLibraryRecord:v.readMaterialRecord,canonicalLibraryValue:v.canonicalLibraryValue},'noema-material-library');await collection.initialize();return collection;})().catch(error=>{materials=undefined;throw error;});
  // Poly Haven (RC-01): catalogue, previews and downloads. The window never gets a path or a network connection, only these validated operations.
  let polyHaven;
  const polyHavenService=()=>polyHaven??=require('./polyHaven.cjs').createPolyHaven({dir:path.join(app.getPath('userData'),'PolyHaven'),onProgress:p=>{const w=window;if(w&&!w.isDestroyed())w.webContents.send('noema:polyhaven-progress',p);}});
  handle('polyhaven',async(operation,...args)=>{const s=polyHavenService();switch(operation){case 'page':return s.page(args[0]&&typeof args[0]==='object'?args[0]:{});case 'thumbnail':return s.thumbnail(args[0]);case 'details':return s.details(args[0]);case 'download':return s.download(args[0],args[1]);case 'read':return s.read(args[0],args[1]);case 'cache':return s.cacheInfo();case 'remove':return s.remove(args[0],args[1]);default:throw Error('Unknown Poly Haven operation');}});
  handle('materials',async(operation,...args)=>{const collection=await materialCollection();switch(operation){case 'page':return collection.page(...args);case 'get':return collection.get(...args);case 'put':return collection.put(...args);case 'remove':return collection.remove(...args);case 'import':return collection.import(args[0]);case 'exportFile':{const result=await dialog.showSaveDialog(window,{title:'Export material library',defaultPath:path.join(app.getPath('documents'),'material.library.json.gz'),filters:[{name:'Compressed material backup',extensions:['gz']},{name:'JSON material backup',extensions:['json']}]});if(result.canceled)return;return collection.exportTo(result.filePath);}default:throw Error('Unknown material operation');}});
  // ARTIST-LOOKS-03: Looks are a third, separate collection in their own folder. Nothing existing is read or migrated.
  let looks;
  const lookCollection=()=>looks??=(async()=>{const v=require('../desktop-code/validation.cjs');const collection=new DiskLibrary(path.join(app.getPath('userData'),'Looks'),{readLibraryRecord:v.readLookRecord,canonicalLibraryValue:v.canonicalLibraryValue},'noema-look-library');await collection.initialize();return collection;})().catch(error=>{looks=undefined;throw error;});
  handle('looks',async(operation,...args)=>{const collection=await lookCollection();switch(operation){case 'page':return collection.page(...args);case 'get':return collection.get(...args);case 'put':return collection.put(...args);case 'remove':return collection.remove(...args);case 'import':return collection.import(args[0]);case 'exportFile':{const result=await dialog.showSaveDialog(window,{title:'Export Look library',defaultPath:path.join(app.getPath('documents'),'looks.library.json.gz'),filters:[{name:'Compressed Look backup',extensions:['gz']},{name:'JSON Look backup',extensions:['json']}]});if(result.canceled)return;return collection.exportTo(result.filePath);}default:throw Error('Unknown look operation');}});
  handle('library',async(operation,...args)=>{switch(operation){case 'page':return store.page(...args);case 'get':return store.get(...args);case 'thumbnail':return store.thumbnail(...args);case 'put':return store.put(...args);case 'remove':return store.remove(...args);case 'metadata':case 'begin':case 'finish':case 'replace':return store.update(args[0],operation,args.slice(1));case 'import':return store.import(args[0]);default:throw Error('Unknown library operation');}});
  handle('importLibrary',async()=>{const result=await dialog.showOpenDialog(window,{title:'Import library',properties:['openFile'],filters:[{name:'Library backup',extensions:['json','gz']}]});if(result.canceled)return;return store.import(await readBackup(result.filePaths[0]));});
  handle('exportLibrary',async()=>{const result=await dialog.showSaveDialog(window,{title:'Export library',defaultPath:path.join(app.getPath('documents'),'my-fractals.library.json.gz'),filters:[{name:'Compressed lossless backup',extensions:['gz']},{name:'JSON backup',extensions:['json']}]});if(result.canceled)return;return store.exportTo(result.filePath);});
  const exports=new(require('./exports.cjs').DesktopExports)();
  const {AnimationQueue}=require('./animationQueue.cjs');
  const asar=path.join(process.resourcesPath,'app.asar'),bundle=app.isPackaged&&require('node:fs').existsSync(asar)?asar:path.join(__dirname,'../desktop-code/validation.cjs'); // an installer build is an asar; the portable artist build is a plain folder
  // Electron's patched fs treats .asar as a directory. Hash the physical bundle through original-fs.
  const bundleHash=require('node:crypto').createHash('sha256');for await(const bytes of require('original-fs').createReadStream(bundle))bundleHash.update(bytes);
  const animationQueue=new AnimationQueue(path.join(app.getPath('userData'),'AnimationQueue'),require('../desktop-code/validation.cjs'),app.getVersion()+':'+bundleHash.digest('hex'));
  handle('animationQueue',async(operation,...args)=>{switch(operation){
    case 'list':return animationQueue.list();
    case 'enqueue':{const result=await dialog.showOpenDialog(window,{title:'Choose animation folder',properties:['openDirectory','createDirectory']});if(result.canceled)return;return animationQueue.enqueue(args[0],args[1],result.filePaths[0]);}
    case 'clone':{const job=await animationQueue.load(args[0]),snapshot=await animationQueue.snapshot(job);const result=await dialog.showOpenDialog(window,{title:'Choose animation folder for a new build',properties:['openDirectory','createDirectory']});if(result.canceled)return;return animationQueue.enqueue(snapshot,job.options,result.filePaths[0]);}
    case 'start':return animationQueue.start(args[0]);case 'next':return animationQueue.next(args[0]);
    case 'write':return animationQueue.write(args[0],args[1]);case 'finish':return animationQueue.finish(args[0]);
    case 'pause':return animationQueue.pause(args[0]);case 'stop':return animationQueue.stop(...args);case 'retry':return animationQueue.retry(args[0]);
    case 'openFolder':{const j=await animationQueue.load(args[0]);await animationQueue.folderCheck(j);const error=await shell.openPath(j.outputFolder);if(error)throw Error(error);return;}
    default:throw Error('Unknown animation queue operation');
  }});
  window.webContents.on('render-process-gone',()=>void animationQueue.dispose());
  handle('output',async(operation,...args)=>{switch(operation){case 'file':{const name=args[0];if(typeof name!=='string'||name!==path.basename(name)||name.length>180)throw Error('Invalid export name');const ext=exportName.wantedExtension(name,args[1]);const result=await dialog.showSaveDialog(window,{title:'Export picture/film',defaultPath:path.join(app.getPath('documents'),name),filters:exportName.dialogFilters(ext)});if(result.canceled)throw Error('Export canceled');return exports.file(exportName.resolveSavePath(result.filePath,ext));}case 'folder':{const result=await dialog.showOpenDialog(window,{title:'Choose export folder',properties:['openDirectory','createDirectory']});if(result.canceled)throw Error('Export canceled');return exports.folder(result.filePaths[0]);}case 'write':return exports.write(...args);case 'close':return exports.close(...args);case 'abort':return exports.abort(...args);case 'frame':return exports.frame(...args);case 'frameFile':return exports.frameFile(...args);default:throw Error('Unknown export operation');}});
  let disposed=false;app.on('before-quit',event=>{if(disposed)return;event.preventDefault();disposed=true;void animationQueue.dispose().finally(()=>exports.dispose()).finally(()=>app.quit());});
  handle('openScene',()=>openScene());
  handle('saveScene',async text=>{if(typeof text!=='string'||Buffer.byteLength(text)>128*1024*1024)throw Error('Invalid scene file/budget.');const {parseScene}=require('../desktop-code/validation.cjs');let sceneText=text;if(geo8){const doc=JSON.parse(text);if(doc.kind==='noema-geo8-artist-scene'){await geo8.validate(doc);sceneText=JSON.stringify(doc.scene);}}const result=parseScene(sceneText);if(!result.ok)throw Error(result.errors.join('; '));const chosen=await dialog.showSaveDialog(window,{title:'Save scene',defaultPath:(await recent())[0]??path.join(app.getPath('documents'),'fractal.scene.json'),filters:[{name:'Fractal scene',extensions:['json']}]});if(chosen.canceled)return {canceled:true};const {atomicWrite}=require('./storage.cjs');await atomicWrite(chosen.filePath,Buffer.from(text));await remember(chosen.filePath);return {saved:chosen.filePath};});
  session.defaultSession.on('will-download',async(_event,item)=>{item.pause();const ext=exportName.wantedExtension(item.getFilename());const result=await dialog.showSaveDialog(window,{title:'Export file',defaultPath:path.join(app.getPath('documents'),path.basename(item.getFilename())),filters:exportName.dialogFilters(ext)});if(result.canceled){item.cancel();return;}item.setSavePath(exportName.resolveSavePath(result.filePath,ext));item.resume();item.once('done',(_event,state)=>{if(state!=='completed')dialog.showErrorBox('The export failed','The file could not be finished: '+state);});});
  // MCP-01: optional AI bridge; nothing listens until the artist switches it on in the window.
  const ai=require('./aiBridge.cjs').install({app,handle,getWindow:()=>window,dir:path.join(app.getPath('userData'),'ai-bridge')});
  // Voluntary, local feedback file: previewed in the window, saved only where the artist chooses. No upload exists.
  const feedback=require('./feedback.cjs').createFeedback({app,dialog,getWindow:()=>window,secrets:()=>['ollama','openai'].map(p=>ai.credentials?.get(p)).filter(Boolean),keyFacts:()=>Object.fromEntries(['ollama','openai'].map(p=>{const s=ai.credentials?.status(p);return [p,{keyStored:!!s?.stored,keyInEnvironment:!!s?.fromEnv}];}))});
  feedback.watch(window);
  handle('feedback-preview',note=>feedback.build(note));
  handle('feedback-save',text=>feedback.save(text));
  await menu();
  await window.loadURL(origin+'/');
}).catch(error=>{dialog.showErrorBox('NOEMA Fractal could not start',String(error)+'\nSaved original files are not changed. Library: '+path.join(app.getPath('userData'),'Library'));app.quit();});
app.on('window-all-closed',()=>app.quit());
