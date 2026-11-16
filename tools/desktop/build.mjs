// Public build: all assets come from reviewed source. No local map/profile discovery.
import { build } from 'vite';
import { copyFile } from 'node:fs/promises';
await import('../release-candidate-01/build-manual.mjs');
await build({configFile:false,publicDir:false,build:{outDir:'desktop-dist',emptyOutDir:true}});
await build({configFile:false,publicDir:false,build:{outDir:'desktop-code',emptyOutDir:true,lib:{entry:'desktop/validation.ts',formats:['cjs'],fileName:()=> 'validation.cjs'},minify:false}});
await copyFile('desktop/help.html','desktop-dist/desktop-help.html');
// The main output build empties its directory, so create the offline manual after it.
await import('../release-candidate-01/build-manual.mjs?after-build');
