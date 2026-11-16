import {withAnimationIdentities} from './animationIdentity';
import {readSynthesizedDefinition} from './synthesizedFormula';
import type {SynthesizedDefinition} from './synthesizedFormula';
import {parseScene,resolveScene,SCENE_SCHEMA_VERSION} from './scene';
import type {Scene} from './scene';
import {discoveryHash} from './discoveryCatalog';
import type {DiscoveryRecipe} from './discoveryCandidates';
import {parseFormula} from './formula/parse';

export type LibraryPayload={kind:'formula';definition:SynthesizedDefinition}|{kind:'preset';scene:Scene}|{kind:'legacy-variation';scene:Scene;recipe:DiscoveryRecipe}|{kind:'legacy-formula';text:string};
export interface LibraryThumbnailState {status:'pending'|'failed'|'ready';generation:number;sourceFingerprint:string;width?:number;height?:number;message?:string}
export interface LibraryRecord {version:1;id:string;type:LibraryPayload['kind'];title:string;createdAt:string;rating:number;tags:string;notes:string;fingerprint:string;payload:LibraryPayload;thumbnail:string;thumbnailState?:LibraryThumbnailState}
export type LibraryMetadata=Omit<LibraryRecord,'payload'|'thumbnail'>;
export interface LibraryBackup {format:'noema-fractal-library';version:1;exportedAt:string;records:LibraryRecord[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function canonicalLibraryValue(v:unknown):string {function sort(x:unknown):unknown{return Array.isArray(x)?x.map(sort):obj(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;}return JSON.stringify(sort(v));}
export function libraryPayloadFingerprint(payload:LibraryPayload){return discoveryHash(canonicalLibraryValue(payload));}
function readPayload(raw:unknown):LibraryPayload {
 if(!obj(raw))throw Error('The library entry has no content.');
 if(raw.kind==='formula')return {kind:'formula',definition:readSynthesizedDefinition(raw.definition)};
 if(raw.kind==='legacy-formula'){if(typeof raw.text!=='string'||raw.text.length>200000||!parseFormula(raw.text).ok)throw Error('Invalid older formula file.');return {kind:'legacy-formula',text:raw.text};}
 if(raw.kind==='preset'||raw.kind==='legacy-variation'){const scene=parseScene(raw.scene);if(!scene.ok)throw Error('Invalid scene preset: '+scene.errors.join('; '));if(scene.scene.content[0]?.chain.some(s=>s.formula.startsWith('discovered-formula-'))){const r=resolveScene(scene.scene,[]);if(!r.ok)throw Error(r.errors.join('; '));}
  if(raw.kind==='preset')return {kind:'preset',scene:scene.scene};
  // Legacy recipe is provenance only; scene data remains authority and is never relabelled synthesized.
  if(!obj(raw.recipe)||raw.recipe.version!=='FG2A-1'||typeof raw.recipe.id!=='string'||!Array.isArray(raw.recipe.chain))throw Error('Invalid older variation recipe.');
  return {kind:'legacy-variation',scene:scene.scene,recipe:structuredClone(raw.recipe) as unknown as DiscoveryRecipe};
 }
 throw Error('Unknown library type.');
}
export function readLibraryRecord(raw:unknown):LibraryRecord {
 if(!obj(raw)||Object.keys(raw).some(k=>!['version','id','type','title','createdAt','rating','tags','notes','fingerprint','payload','thumbnail','thumbnailState'].includes(k)))throw Error('Invalid library entry.');
 if(raw.version!==1||typeof raw.id!=='string'||!/^[-\w:]{1,128}$/.test(raw.id)||typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>120||typeof raw.createdAt!=='string'||!Number.isFinite(Date.parse(raw.createdAt))||!Number.isInteger(raw.rating)||Number(raw.rating)<0||Number(raw.rating)>5||typeof raw.tags!=='string'||raw.tags.length>256||typeof raw.notes!=='string'||raw.notes.length>2000)throw Error('Invalid name, date or metadata.');
 if(typeof raw.thumbnail!=='string'||raw.thumbnail.length>10*1024*1024||raw.thumbnail!==''&&!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(raw.thumbnail))throw Error('Invalid PNG thumbnail or picture budget.');
 const payload=readPayload(raw.payload),fingerprint=libraryPayloadFingerprint(payload);
 // A neutral scene-version migration changes the payload fingerprint, while preserving
 // source mathematics and view. VISUAL-02 additionally initializes only its
 // missing research gain to zero; original fingerprint validation stays mandatory.
 // Verify the original bytes' fingerprint first and accept only this pure bump.
 const original=raw.payload,oldScene=obj(original)&&obj(original.scene)?original.scene:null;
 const oldReflections=obj(oldScene?.reflections)?oldScene.reflections:{};
 const neutralVersionMigration=[31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48].includes(Number(oldScene?.schema_version))&&SCENE_SCHEMA_VERSION===49&&
   raw.fingerprint===discoveryHash(canonicalLibraryValue(original))&&
   canonicalLibraryValue({...original as object,scene:withAnimationIdentities({...oldScene,reflections:{...oldReflections,secondary_radiance_gain:oldReflections.secondary_radiance_gain??0},schema_version:SCENE_SCHEMA_VERSION} as unknown as Scene)})===canonicalLibraryValue(payload);
 if(raw.type!==payload.kind||raw.fingerprint!==fingerprint&&!neutralVersionMigration)throw Error('Library content/fingerprint does not match.');
 if(raw.thumbnailState!==undefined){const s=raw.thumbnailState;if(!obj(s)||Object.keys(s).some(k=>!['status','generation','sourceFingerprint','width','height','message'].includes(k))||!['pending','failed','ready'].includes(String(s.status))||!Number.isSafeInteger(s.generation)||Number(s.generation)<0||s.sourceFingerprint!==raw.fingerprint||s.message!==undefined&&(typeof s.message!=='string'||s.message.length>500)||[s.width,s.height].some(n=>n!==undefined&&(!Number.isInteger(n)||Number(n)<1||Number(n)>1024))||s.status==='ready'&&(!raw.thumbnail||!s.width||!s.height))throw Error('Invalid thumbnail state or scene identity.');}
 // Payload has already been parsed into an independent validated scene. Do not
 // clone the huge raw embedded maps only to immediately overwrite that clone.
 const {payload:originalPayload,...metadata}=raw;
 const record={...structuredClone(metadata),payload,fingerprint} as unknown as LibraryRecord;
 if(neutralVersionMigration&&record.thumbnailState)record.thumbnailState.sourceFingerprint=fingerprint;
 // IndexedDB preserves own undefined keys; JSON backup does not. Keep descriptors portable byte-for-byte.
 if(record.thumbnailState)record.thumbnailState=Object.fromEntries(Object.entries(record.thumbnailState).filter(([,value])=>value!==undefined)) as unknown as LibraryThumbnailState;
 return record;
}
export function createLibraryRecord(payload:LibraryPayload,title:string,thumbnail:string,id:string,createdAt=new Date().toISOString()):LibraryRecord {const normalized=readPayload(payload);return readLibraryRecord({version:1,id,type:normalized.kind,title,createdAt,rating:0,tags:'',notes:'',fingerprint:libraryPayloadFingerprint(normalized),payload:normalized,thumbnail});}
export function readLibraryBackup(input:unknown):LibraryBackup {
 const raw=typeof input==='string'?JSON.parse(input):input;if(!obj(raw)||raw.format!=='noema-fractal-library'||raw.version!==1||typeof raw.exportedAt!=='string'||!Array.isArray(raw.records))throw Error('Unknown library backup/version.');
 const records=raw.records.map(readLibraryRecord);if(new Set(records.map(r=>r.id)).size!==records.length)throw Error('The backup contains duplicate entry IDs.');return {format:'noema-fractal-library',version:1,exportedAt:raw.exportedAt,records};
}
/** Validate everything before any storage transaction. Existing content wins duplicate metadata. */
export function planLibraryImport(existing:readonly LibraryRecord[],backup:LibraryBackup):{add:LibraryRecord[];duplicates:number} {
 const byId=new Map(existing.map(r=>{const normalized=readLibraryRecord(r);return [normalized.id,normalized];})),add:LibraryRecord[]=[];let duplicates=0;
 for(const record of backup.records){const current=byId.get(record.id);if(current){if(canonicalLibraryValue(current.payload)!==canonicalLibraryValue(record.payload))throw Error('ID conflict with other content: '+record.id);duplicates++;continue;}
  const sameType=[...byId.values()].filter(r=>r.type===record.type);if(sameType.some(r=>r.fingerprint===record.fingerprint&&canonicalLibraryValue(r.payload)!==canonicalLibraryValue(record.payload)))throw Error('Fingerprint conflict with other content');const duplicate=record.type==='formula'&&sameType.some(r=>canonicalLibraryValue(r.payload)===canonicalLibraryValue(record.payload));if(duplicate){duplicates++;continue;}add.push(record);byId.set(record.id,record);
 }return {add,duplicates};
}
