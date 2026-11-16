import type {Scene} from './scene';
import type {Vec3} from './camera';
import {resolveMaterial} from './material';
import type {MaterialSettings} from './material';
import type {PropertyBinding,MathematicalValue} from './propertyAnimation';
import {validAnimationId} from './animationIdentity';

/** Explicit uniform-backed whitelist. Resources, material families and geometry are never targets. */
export const MATERIAL_ANIMATION = {
 roughness:{label:'Roughness',min:0,max:1},metallic:{label:'Metal',min:0,max:1},
 reflectivity:{label:'Reflection',min:0,max:1},emissionStrength:{label:'Emission · strength',min:0,max:1000},
 baseColor:{label:'Base colour · linear RGB',min:0,max:1},emissionColor:{label:'Emission · linear RGB',min:0,max:1},
} as const;
export const LIGHT_ANIMATION = {
 intensity:{label:'Strength',min:0,max:10000},color:{label:'Colour',min:0,max:1},
 position:{label:'Position XYZ',min:-10000,max:10000},direction:{label:'Direction XYZ',min:-1e6,max:1e6},
 enabled:{label:'Active (hold)',min:0,max:1},
} as const;
export type AppearanceTarget =
 | {kind:'material';objectId:string;property:keyof typeof MATERIAL_ANIMATION}
 | {kind:'light';objectId:string;property:keyof typeof LIGHT_ANIMATION}
 | {kind:'gradient-stop';stopId:string;property:'color'}
 | {kind:'color';property:'cycles'|'offset'}
 | {kind:'ambient';property:'intensity'|'color'}
 | {kind:'environment';property:'intensity'|'rotation_degrees'};
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function readAppearanceTarget(raw:unknown):AppearanceTarget|undefined {
 if(!obj(raw))return;
 const keys=Object.keys(raw).sort().join(',');
 if((raw.kind==='material'||raw.kind==='light')&&keys==='kind,objectId,property'&&(raw.kind==='material'&&raw.objectId==='@scene'||validAnimationId(raw.objectId))&&
   Object.hasOwn(raw.kind==='material'?MATERIAL_ANIMATION:LIGHT_ANIMATION,String(raw.property)))return raw as unknown as AppearanceTarget;
 if(raw.kind==='gradient-stop'&&keys==='kind,property,stopId'&&validAnimationId(raw.stopId)&&raw.property==='color')return raw as unknown as AppearanceTarget;
 if(keys==='kind,property'&&(raw.kind==='color'&&['cycles','offset'].includes(String(raw.property))||raw.kind==='ambient'&&['intensity','color'].includes(String(raw.property))||raw.kind==='environment'&&['intensity','rotation_degrees'].includes(String(raw.property))))return raw as unknown as AppearanceTarget;
}
export function appearanceType(t:AppearanceTarget):PropertyBinding['valueType'] {
 return t.kind==='material'&&(t.property==='baseColor'||t.property==='emissionColor')?'color':
 t.kind==='light'&&(t.property==='direction'||t.property==='position')?'vector':t.kind==='light'&&t.property==='enabled'?'step':t.property==='color'?'color':'float';
}
export function validAppearanceValue(t:AppearanceTarget,v:MathematicalValue):boolean {
 if(appearanceType(t)==='step')return typeof v==='boolean';
 if(t.property==='color')return typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v);
 const limits=t.kind==='material'?MATERIAL_ANIMATION[t.property]:t.kind==='light'?LIGHT_ANIMATION[t.property]:
  t.kind==='color'?{min:t.property==='cycles'?.05:-100,max:t.property==='cycles'?20:100}:
  t.kind==='ambient'?{min:0,max:10}:{min:t.property==='intensity'?0:-36000,max:t.property==='intensity'?100:36000};
 const vector=appearanceType(t)==='vector'||appearanceType(t)==='color';
 if(vector?(!Array.isArray(v)||v.length!==3):typeof v!=='number')return false;
 return (Array.isArray(v)?v:[v]).every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=limits.min&&n<=limits.max)&&
  !(t.kind==='light'&&t.property==='direction'&&Math.hypot(...v as Vec3)<1e-9);
}
export function appearanceBindings(scene:Scene):PropertyBinding[] {
 const out:PropertyBinding[]=[];
 const add=(target:AppearanceTarget,label:string,min:number,max:number,value:MathematicalValue)=>out.push({target,label,min,max,value,valueType:appearanceType(target)});
 const material=(m:MaterialSettings,objectId:string,label:string)=>{const resolved=resolveMaterial(m);
  for(const property of Object.keys(MATERIAL_ANIMATION) as (keyof typeof MATERIAL_ANIMATION)[]){const meta=MATERIAL_ANIMATION[property],v=resolved[property];
   // A driven curve is authored structure; do not replace it with a scalar animation.
   if(typeof v==='number'||Array.isArray(v))add({kind:'material',objectId,property},label+' · '+meta.label,meta.min,meta.max,v);
  }
 };
 material(scene.material,'@scene','Fractal material');
 for(const p of scene.primitives??[])if(p.material!=='scene')material(p.material,p.id,'Objekt '+p.id);
 for(const [i,l] of scene.lights.entries())if(l.id)for(const property of Object.keys(LIGHT_ANIMATION) as (keyof typeof LIGHT_ANIMATION)[]){
  if(property==='position'&&l.type==='directional'||property==='direction'&&l.type==='point')continue;
  const m=LIGHT_ANIMATION[property];add({kind:'light',objectId:l.id,property},'Light '+(l.name??String(i+1))+' · '+m.label,m.min,m.max,l[property]);
 }
 for(const [i,s] of scene.color.gradient.stops.entries())if(s.id)add({kind:'gradient-stop',stopId:s.id,property:'color'},'Gradient · colour stop '+(i+1),0,1,s.color);
 add({kind:'color',property:'cycles'},'Gradient · repeats',.05,20,scene.color.cycles);
 add({kind:'color',property:'offset'},'Gradient · offset',-100,100,scene.color.offset);
 add({kind:'ambient',property:'color'},'Ambient light · colour',0,1,scene.ambient.color);
 add({kind:'ambient',property:'intensity'},'Ambient light · strength',0,10,scene.ambient.intensity);
 if(scene.environment.kind==='hdri'){
  add({kind:'environment',property:'intensity'},'HDR environment · strength',0,100,scene.environment.intensity);
  add({kind:'environment',property:'rotation_degrees'},'HDR environment · rotation (°)',-36000,36000,scene.environment.rotation_degrees);
 }
 return out;
}
export function setAppearanceValue(s:Scene,t:AppearanceTarget,value:MathematicalValue):Scene {
 switch(t.kind){
  case 'material': {const patch={[t.property]:value};return t.objectId==='@scene'?{...s,material:{...s.material,...patch} as MaterialSettings}:{...s,primitives:s.primitives?.map(p=>p.id===t.objectId&&p.material!=='scene'?{...p,material:{...p.material,...patch} as MaterialSettings}:p)};}
  case 'light':return {...s,lights:s.lights.map(l=>l.id===t.objectId?{...l,[t.property]:value}:l)} as Scene;
  case 'gradient-stop':return {...s,color:{...s.color,gradient:{...s.color.gradient,stops:s.color.gradient.stops.map(stop=>stop.id===t.stopId?{...stop,color:value as string}:stop)}}};
  case 'color':return {...s,color:{...s.color,[t.property]:value}} as Scene;
  case 'ambient':return {...s,ambient:{...s.ambient,[t.property]:value}} as Scene;
  case 'environment':return s.environment.kind==='hdri'?{...s,environment:{...s.environment,[t.property]:value}} as Scene:s;
 }
}
/** Same 2.2 transfer as the production light/gradient packers. Hex output is quantized to 8-bit. */
export const colorToLinear=(hex:string):Vec3=>[1,3,5].map(i=>(parseInt(hex.slice(i,i+2),16)/255)**2.2) as Vec3;
export const linearToColor=(v:Vec3)=>'#'+v.map(c=>Math.round(Math.max(0,Math.min(1,c))**(1/2.2)*255).toString(16).padStart(2,'0')).join('');
