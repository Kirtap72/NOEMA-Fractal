import type {Scene,Formula} from '../engine';
import {serializeScene} from '../engine';
import {readAnimationSnapshot} from '../engine/animationOutput';
import {parseFormula} from '../engine/formula/parse';
import {FormulaStore} from './formulaStore';
import {SYNTHESIS_PREFIX} from '../engine/synthesizedFormula';
/** Freeze only the actual used mathematical sources, including saved custom expressions. */
export async function captureAnimationSnapshot(scene:Scene,formulas:readonly Formula[]){
 const files=import.meta.glob('/formulas/*.yaml',{query:'?raw',import:'default',eager:true}) as Record<string,string>;
 const used=new Set(scene.content[0]!.chain.map(s=>s.formula)),sources=new Map<string,string>();
 const consider=(text:string)=>{const p=parseFormula(text);if(p.ok&&used.has(p.formula.id)&&JSON.stringify(p.formula)===JSON.stringify(formulas.find(f=>f.id===p.formula.id)))sources.set(p.formula.id,text);};
 for(const text of Object.values(files))consider(text);
 if([...used].some(id=>!id.startsWith(SYNTHESIS_PREFIX)&&!sources.has(id)))for(const saved of await new FormulaStore().listFormulas())consider(saved.text);
 return readAnimationSnapshot({scene:JSON.parse(serializeScene(scene,formulas)),formulaSources:[...sources.values()]});
}
