import {compileSynthesizedDefinition,readSynthesizedDefinition} from './synthesizedFormula';
import type {SynthesizedDefinition} from './synthesizedFormula';
import {createDefaultScene,defaultStep,resolveScene} from './scene';
import type {Scene} from './scene';
import {propertyTracks} from './propertyAnimation';
import {readSceneCamera} from './camera';

export function synthesizedCandidateScene(input:SynthesizedDefinition):Scene {
 const definition=readSynthesizedDefinition(input),formula=compileSynthesizedDefinition(definition),scene=createDefaultScene(formula);
 scene.discoveredFormulas=[definition];scene.content=[{id:'ast-'+definition.fingerprint,type:'fractal',chain:[{...defaultStep(formula),id:'ast-step-'+definition.fingerprint,step_factor:.7}],rounds:1}];
 return scene;
}
export function applySynthesizedScene(base:Scene,candidate:Scene,definition:SynthesizedDefinition,makeId:()=>string,frame:boolean):Scene {
 if(base.animation.keyframes.length)throw Error('Legacy keys must be handled before the chain is replaced; no automatic conversion.');
 const checked=readSynthesizedDefinition(definition);if(candidate.content.length!==1||candidate.content[0]?.chain.length!==1||candidate.content[0].chain[0]?.formula!==checked.id)throw Error('Candidate and mathematical source disagree');
 const resolved=resolveScene(candidate,[]);if(!resolved.ok||resolved.warnings.some(w=>w.includes('limited')||w.includes('ignored')))throw Error('Invalid synthesized candidate');
 const used=new Set([...base.content.flatMap(c=>[c.id,...c.chain.map(s=>s.id)]),...propertyTracks(base.cameraFlight).flatMap(t=>t.target.kind==='formula-parameter'?[t.target.contentId,t.target.stepId]:t.target.kind==='julia'?[t.target.contentId]:[])]);
 const fresh=()=>{const id=makeId();if(!/^[-\w]{1,64}$/.test(id)||used.has(id))throw Error('Invalid/colliding identity');used.add(id);return id;};
 const errors:string[]=[];const camera=readSceneCamera(candidate.camera,'candidate.camera',errors);if(!camera)throw Error(errors.join('; '));
 const source=candidate.content[0]!,result:Scene={...base,discoveredFormulas:[checked],content:[{...structuredClone(source),id:fresh(),chain:source.chain.map(s=>({...structuredClone(s),id:fresh()}))}],...(frame&&!base.composition?.locked?{camera:structuredClone(camera)}:{})};
 return result;
}
