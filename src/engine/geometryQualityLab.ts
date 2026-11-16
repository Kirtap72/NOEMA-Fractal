/** GEO4 laboratory contract. No scene migration or production quality defaults.
 * Independent request for a one-pixel / level acceptance band. Reuses the
 * validated GEO3 finite DS solver rather than inventing another renderer.
 */
import type {GeometryRecoveryExperiment} from './geometryRecovery';
export interface GeometryQualityRequest {
 stepMultiplier:number;
 detailLevel:number;
 maxQueries:number;
 stepRule?:'legacy'|'margin'|'adaptive';
 constantDetailSize?:number;
}
export function geometryQualityRequest(r:GeometryQualityRequest):GeometryRecoveryExperiment {
 for(const n of [r.stepMultiplier,r.detailLevel])if(!Number.isFinite(n)||n<=0)throw Error('Finite positive step multiplier and detail level required');
 if(!Number.isInteger(r.maxQueries)||r.maxQueries<1||r.maxQueries>20000)throw Error('Explicit bounded query budget required');
 if(r.constantDetailSize!==undefined&&(!Number.isFinite(r.constantDetailSize)||r.constantDetailSize<=0))throw Error('Finite positive constant detail size required');
 if(r.stepRule!==undefined&&!['legacy','margin','adaptive'].includes(r.stepRule))throw Error('Unknown step rule');
 return {effort:r.detailLevel/2,maxQueries:r.maxQueries,stable:true,ds:true,dsProduct:'split',solver:'direct',sourceParameters:true,normalMode:'micro',hardEdges:true,preciseColor:true,marchRule:r.stepRule??'margin',...(r.constantDetailSize!==undefined?{detailWorld:r.constantDetailSize/r.detailLevel}:{})};
}
/** World-space footprint supplied by the frozen target film, never the ROI. */
export function geometryDetailTarget(pixelFootprint:number,level:number,arithmeticFloor:number,constantSize?:number) {
 if(![pixelFootprint,level,arithmeticFloor].every(n=>Number.isFinite(n)&&n>0))throw Error('Finite positive footprint, effort and floor required');
 if(constantSize!==undefined&&(!Number.isFinite(constantSize)||constantSize<=0))throw Error('Invalid constant size');
 const requested=(constantSize??pixelFootprint)/level;
 return {requested,effective:Math.max(requested,arithmeticFloor),limited:requested<arithmeticFloor,representable:requested>0&&Number.isFinite(Math.fround(requested))&&Math.fround(requested)>0};
}
