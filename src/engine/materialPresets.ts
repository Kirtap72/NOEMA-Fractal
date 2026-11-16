import {readMaterial} from './material';
import type {MaterialSettings} from './material';
import {readColorSettings} from './gradient';
import type {ColorSettings} from './gradient';
import type {Scene} from './scene';
import {replacementGradientColor} from './animationIdentity';
import {canonicalLibraryValue} from './discoveryLibrary';
import {discoveryHash} from './discoveryCatalog';
export interface MaterialPayload {kind:'material';material:MaterialSettings;color?:ColorSettings}
/** Same content-addressed disk envelope, separate collection and validator. Never an image preset. */
export interface MaterialRecord {version:1;id:string;type:'material';title:string;createdAt:string;rating:number;tags:string;notes:string;fingerprint:string;payload:MaterialPayload;thumbnail:string}
export interface MaterialBackup {format:'noema-material-library';version:1;exportedAt:string;records:MaterialRecord[]}
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function readMaterialRecord(raw:unknown):MaterialRecord {
 if(!obj(raw)||Object.keys(raw).some(k=>!['version','id','type','title','createdAt','rating','tags','notes','fingerprint','payload','thumbnail'].includes(k))||raw.version!==1||raw.type!=='material'||typeof raw.id!=='string'||!/^[-\w:]{1,128}$/.test(raw.id)||typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>120||typeof raw.createdAt!=='string'||!Number.isFinite(Date.parse(raw.createdAt))||raw.rating!==0||typeof raw.tags!=='string'||raw.tags.length>256||typeof raw.notes!=='string'||raw.notes.length>2000||raw.thumbnail!=='')throw Error('Invalid material preset.');
 if(!obj(raw.payload)||raw.payload.kind!=='material'||Object.keys(raw.payload).some(k=>!['kind','material','color'].includes(k)))throw Error('The material preset lacks material data.');
 const errors:string[]=[],material=readMaterial(raw.payload.material,'material',errors),color=raw.payload.color===undefined?undefined:readColorSettings(raw.payload.color,'color',errors);if(errors.length||!material)throw Error(errors.join('; '));
 const payload:MaterialPayload={kind:'material',material,...(color?{color}:{})},fingerprint=discoveryHash(canonicalLibraryValue(payload));if(raw.fingerprint!==fingerprint)throw Error('The fingerprint of the material preset does not match.');return {...raw,payload,fingerprint} as unknown as MaterialRecord;
}
export function createMaterialRecord(payload:MaterialPayload,title:string,id:string,now=new Date().toISOString()):MaterialRecord {return readMaterialRecord({version:1,id,type:'material',title,createdAt:now,rating:0,tags:'',notes:'',fingerprint:discoveryHash(canonicalLibraryValue(payload)),payload,thumbnail:''})}
export function readMaterialBackup(input:unknown):MaterialBackup {
 const raw=typeof input==='string'?JSON.parse(input):input;if(!obj(raw)||raw.format!=='noema-material-library'||raw.version!==1||typeof raw.exportedAt!=='string'||!Array.isArray(raw.records))throw Error('Invalid material backup.');const records=raw.records.map(readMaterialRecord);if(new Set(records.map(r=>r.id)).size!==records.length)throw Error('Duplicate material IDs.');return {format:'noema-material-library',version:1,exportedAt:raw.exportedAt,records};
}
export function applyMaterialPreset(scene:Scene,record:MaterialRecord,applyColor=false):Scene {const {material,color}=readMaterialRecord(record).payload;return {...scene,material:structuredClone(material),...(applyColor&&color?{color:replacementGradientColor(scene,structuredClone(color))}:{})}}
