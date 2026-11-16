/**
 * GEO-DETAIL-COMPAT-02, WP1. Why Geometry Detail (GD) is, or is not, available for a scene: ALL reasons at once, each with a
 * stable code, a class and Swedish text. Pure (no DOM), never throws, never changes the scene.
 *
 * The mathematics is untouched: this only reads the same facts the double-single (DS) generator and the engine already
 * refuse on. The kernel lists come from geometryDoubleSingle.ts so there is one source of truth.
 */
import type {ResolvedScene,Scene} from './scene';
import type {Formula} from './formula/types';
import {resolveScene} from './scene';
import {DS_FIELD_KERNELS,DS_PRIMARY_KERNELS,dsFieldShapeSupported} from './geometryDoubleSingle';
import {surfaceBlocksGeometry,surfaceMaterials} from './surfaceDetail';
import {texturedEntries} from './materialRamp';
import {displacementActive} from './displacement';
import {fractalDisplacementActive} from './fractalDisplacement';

/** policy = could be allowed after a test; missing-adapter = a DS version of a formula/kernel does not exist yet;
 * architecture = the solver cannot take this kind of formula chain; research = numerically unsettled;
 * unsupported = changes the field itself and stays unsupported. */
export type GeometryReasonClass='policy'|'missing-adapter'|'architecture'|'research'|'unsupported';
export interface GeometryReason {code:string;cls:GeometryReasonClass;text:string;hint?:string}
export interface GeometryEligibility {ok:boolean;reasons:GeometryReason[]}

const PREFIX='Geometry Detail is not verified for this scene: ';
const HINT_FALLBACK='You can use "High detail (Float32)" below.';
const reason=(code:string,cls:GeometryReasonClass,text:string,hint?:string):GeometryReason=>({code,cls,text,...(hint?{hint}:{})});

function paramsOf(step:ResolvedScene['chain'][number]):Record<string,number>{
  return Object.fromEntries(step.formula.parameters.map((p,i)=>[p.name,step.parameterValues[i]!]));
}
const nameOf=(f:Formula)=>f.name&&f.name!==f.id?`${f.name} (${f.id})`:f.id;

/** Scene-level reasons that do not need the formula chain. */
function sceneReasons(scene:Scene):GeometryReason[]{
  const out:GeometryReason[]=[];
  if(scene.primitives?.length)out.push(reason('primitives','unsupported','Scene objects (spheres, boxes, planes) are part of the field.','Remove the objects or use High detail (Float32).'));
  if(scene.cutout?.box)out.push(reason('box-cut','unsupported','Box Cut changes the field.','Turn off Box Cut or use High detail (Float32).'));
  if(scene.transport?.enabled)out.push(reason('transport','unsupported','Transport/GI use other light paths.','Turn off transport.'));
  if(scene.camera?.dof?.enabled)out.push(reason('dof','policy','Depth of field (DOF) is not verified together with Geometry Detail.','Turn off depth of field in Camera for a still picture with Geometry Detail.'));
  if(displacementActive(scene))out.push(reason('displacement','unsupported','Real displacement changes the field itself.','Turn off the displacement.'));
  if(fractalDisplacementActive(scene.fractalDisplacement))out.push(reason('fractal-displacement','unsupported','Displacement on the fractal is not supported with Geometry Detail.','Turn off Geometry Detail to keep the displaced shape in the final picture.'));
  // MATERIAL-GRADIENT-02 / RC-01: textured gradient materials are blended in the shading only, but their combination with Geometry Detail has not been verified on the GPU, so it fails closed with a visible reason.
  if(texturedEntries(scene.color.gradient.stops).length>0)out.push(reason('gradient-textures','research','Textured material stops in the gradient are not verified together with Geometry Detail.','Use the gradient without picture maps or turn off Geometry Detail.'));
  const mats=surfaceMaterials(scene);
  if(mats.some(m=>surfaceBlocksGeometry(m,'normal-bump')))out.push(reason('surface-normal-bump','research','A normal or bump map changes the light normal and is not combined with the micro-normal of Geometry Detail.','Turn off the normal/bump map. Colour, roughness, metal, AO and emission maps are fine.'));
  // PBR colour-class maps (base colour, roughness, metallic, AO, emission) are allowed since COMPAT-02 WP2: they change shading only
  // (depth/normal/status bit-identity is tested in tests/gpu/geometryDetailMaps.ts).
  if(mats.some(m=>surfaceBlocksGeometry(m,'procedural')))out.push(reason('surface-procedural','research','Procedural surface detail changes the light normal and is not combined with Geometry Detail.','Turn off the procedural surface detail.'));
  return out;
}

/** Reasons that come from the resolved formula chain. */
export function chainReasons(r:ResolvedScene):GeometryReason[]{
  const out:GeometryReason[]=[];
  const kind=r.execution?.kind;
  if(kind===undefined)out.push(reason('execution:plain','architecture','Ordinary formula chain: the solver requires a mapped field chain (mapped-field) with a finite field function.','High detail (Float32) works for all formulas.'));
  else if(kind!=='mapped-field')out.push(reason('execution:'+kind,'architecture',kind==='bounded-sequence'?'The chain is of the type bounded-sequence (IFS): it lacks the finite field function that the solver requires.':'The chain is of the type independent-field, which the double-precision field does not have.',HINT_FALLBACK));
  if(kind==='mapped-field'&&!r.julia?.[3])out.push(reason('julia-off','architecture','The double-precision field requires Julia mode (the constant is taken from the Julia value).','Turn on Julia in the formula chain if the formula allows it.'));
  // Formula maps are fine when every kernel that reads them has a DS version (COMPAT-03A); an unsupported one is named below.
  if(r.chainWeights?.some(w=>w!==1))out.push(reason('weighted-chain','research','A weighted chain is not validated with Geometry Detail.'));
  if(kind==='mapped-field'){
    const groups=r.execution!.groups as {start:number;end:number}[];
    if(groups.length!==2)out.push(reason('group-layout','architecture','The double-precision field requires exactly two groups (mapping and field).'));
    else groups.forEach((g,gi)=>{
      for(let i=g.start;i<=g.end&&i<r.chain.length;i++){
        const step=r.chain[i]!,id=step.formula.id,role=gi===0?'primary':'field';
        const supported=gi===0?DS_PRIMARY_KERNELS.includes(id):DS_FIELD_KERNELS.includes(id);
        if(!supported)out.push(reason('kernel-missing-ds:'+id,'missing-adapter',`The formula ${nameOf(step.formula)} (${role} step ${i+1}) lacks a double-precision version.`,HINT_FALLBACK));
        else if(gi===1&&id==='mb3d-randcubesifs'&&!dsFieldShapeSupported(paramsOf(step)))out.push(reason('field-shape','missing-adapter',`RandCubesIFS step ${i+1} uses a shape or inner rendering that the double-precision field does not have.`));
      }
    });
  }else{
    for(const id of new Set(r.chain.map(c=>c.formula.id))){
      const f=r.chain.find(c=>c.formula.id===id)!.formula;
      out.push(reason('kernel-missing-ds:'+id,'missing-adapter',`The formula ${nameOf(f)} lacks a double-precision version.`,HINT_FALLBACK));
    }
  }
  return out;
}

/** Reasons for an already resolved scene (what the engine has in hand when it refuses to compile). */
export function resolvedGeometryReasons(r:ResolvedScene):GeometryReason[]{
  const seen=new Set<string>();
  return [...sceneReasons(r.scene),...chainReasons(r)].filter(x=>!seen.has(x.code)&&!!seen.add(x.code));
}

/** All reasons Geometry Detail is unavailable for this scene (empty = available). */
export function geometryEligibility(scene:Scene,formulas:readonly Formula[]):GeometryEligibility{
  const reasons=sceneReasons(scene);
  let resolved:ReturnType<typeof resolveScene>;
  try{resolved=resolveScene(scene,formulas);}catch(e){resolved={ok:false,errors:[String(e instanceof Error?e.message:e)]};}
  if(!resolved.ok)reasons.push(reason('resolve-failed','unsupported','The scene cannot be interpreted: '+resolved.errors.join('; ')));
  else reasons.push(...chainReasons(resolved));
  // Stable order: scene-level first, then chain; one entry per code.
  const seen=new Set<string>(),unique=reasons.filter(x=>!seen.has(x.code)&&!!seen.add(x.code));
  return {ok:unique.length===0,reasons:unique};
}

/** Text for the legacy single-string consumers (`geometryUnavailable`). Empty reasons give undefined. */
export function geometryReasonText(e:GeometryEligibility):string|undefined{
  return e.ok?undefined:PREFIX+e.reasons.map(r=>r.text).join(' ');
}
export const GEOMETRY_REASON_CLASS_LABEL:Record<GeometryReasonClass,string>={
  policy:'Caution rule (can be opened after testing)',
  'missing-adapter':'Lacks a double-precision version',
  architecture:'The solver does not support this chain type yet',
  research:'Requires research',
  unsupported:'Changes the field itself (remains unsupported)',
};
