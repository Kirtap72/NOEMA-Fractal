/** Native MaxInv: independently evaluate both groups at the original point.
 * Normalized host contract: docs/mb3d-import/RECREATION_SIX.md.
 */
import {groupExecutionErrors,mappedFieldErrors,combineIndependentDistances,INDEPENDENT_OPERATIONS} from './groupExecution';
import type {IndependentFieldExecution,MappedFieldExecution} from './groupExecution';
import {compileMappedFieldOrbit,generateMappedFieldChain} from './groupExecution';
import type {ChainStep,ChainMode,ChainResult} from './chain';
import type {FieldMap} from '../fieldMaps';

// Reuse the already tested counted analytic/helper host. Its second-group code
// is changed below only at the explicit handoff and result combination sites.
function mapped(e:IndependentFieldExecution):MappedFieldExecution{return {kind:'mapped-field',fieldStop:'query',groups:e.groups};}
export function independentFieldErrors(steps:readonly ChainStep[],rounds:number,mode:ChainMode,e:IndependentFieldExecution):string[]{
 const errors=groupExecutionErrors(e,steps.length);if(errors.length)return errors;
 errors.push(...mappedFieldErrors(steps,rounds,mode,mapped(e)));
 if(!(INDEPENDENT_OPERATIONS as readonly string[]).includes(e.operation))errors.push('unsupported independent field operation');
 return errors;
}
export function compileIndependentFieldCpu(steps:readonly ChainStep[],e:IndependentFieldExecution,round32=false,maps:readonly FieldMap[]=[]){
 const errors=independentFieldErrors(steps,1,'sequence',e);if(errors.length)throw Error(errors.join('; '));
 // Reuse the verified primary host, resetting xyz to the original point at
 // the explicit second-group handoff. No dummy formula or scene is introduced.
 const primary=compileMappedFieldOrbit(steps,mapped(e),round32,maps);
 const r=round32?Math.fround:(n:number)=>n;
 return(point:readonly number[],params:readonly number[],_weights:readonly number[]=[],julia:readonly number[]|null=null,threshold=0)=>{
  // This mode is implemented by a dedicated orbit entry point, avoiding a
  // fabricated identity formula or dummy mapping group in scene data.
  const a=primary(point,params,julia,threshold,{independentSecond:true});
  const first=r(Math.max(threshold*.25,Math.hypot(...a.primary.v.slice(0,3))/Math.abs(a.primary.v[3])));
  const combined=combineIndependentDistances(e,first,a.field.bestDistance,threshold,r);
  const useSecond=combined.second,invalid=a.invalid||!Number.isFinite(first)||!Number.isFinite(combined.distance);
  return {dist:invalid?Infinity:combined.distance,iterations:useSecond?a.field.bestIteration:a.primary.count,trap:useSecond?a.field.free[1]:a.primary.trap,invalid};
 };
}
export function generateIndependentFieldChain(steps:readonly ChainStep[],rounds:number,mode:ChainMode,e:IndependentFieldExecution):ChainResult {
 const errors=independentFieldErrors(steps,rounds,mode,e);if(errors.length)return {ok:false,errors};
 return generateMappedFieldChain(steps,rounds,mode,mapped(e),{independentSecond:true,combine:e});
}
