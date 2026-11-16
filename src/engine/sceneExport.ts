import {cameraBasis} from './camera';
import {cameraFov,focusDistance,lensFromFov} from './cameraOptics';
import {outputSize,verticalFovDegrees} from './renderSetup';
import {propertyValue,resolveMaterial,skyGradient} from './material';
import type {MaterialSettings} from './material';
import type {Scene} from './scene';
import {extractAdaptiveMesh} from './adaptiveMesh';
import {sampleSurfacePoints,pointsToPly} from './pointCloud';
import {constructGaussians,gaussiansToPly,MAX_GAUSSIAN_COUNT} from './gaussianExport';
import type {GaussianOptions} from './gaussianExport';
import {exportAdaptiveGaussians} from './adaptiveGaussians';
import type {AdaptiveGaussianOptions} from './adaptiveGaussians';
import {meshToGlb,meshToObjParts,meshToPly} from './meshExport';
import {exportVolume,volumeEstimate} from './volumeExport';
import {base64ToBytes,encodeRgbe} from './radiance';
import {checkCancelled,samplingGrid} from './geometrySampling';
import type {GeometrySampler,SamplingOptions} from './geometrySampling';

export type ExportMode='geometry'|'volume'|'points'|'gaussians'|'scene';
export type FractalRepresentation='mesh'|'points'|'volume'|'gaussians';
export interface ContentExportOptions extends SamplingOptions {
 mode:ExportMode;format?:'glb'|'obj'|'ply';representation?:FractalRepresentation;
 count?:number;seed?:number;withColors?:boolean;withNormals?:boolean;
 simplifyTolerance?:number;planeHalfSize?:number;windowAspect?:number;
 volumeMode?:'raw-field'|'surface-density';densityWidth?:number;
 gaussian?:GaussianOptions;
 adaptiveGaussian?:Omit<AdaptiveGaussianOptions,'bounds'|'gaussian'|'signal'>;
}
export interface ExportSink {write(path:string,bytes:Uint8Array):Promise<void>}
export interface ExportFile {path:string;bytes:number}
export interface ExportStatus {ok:boolean;status:'complete'|'failed'|'cancelled';files:ExportFile[];warnings:string[];error?:string;manifest?:SceneBundleManifest}
export interface ExportMaterial {id:string;baseColor:number[];metallic:number;roughness:number;reflectivity:number;transmission:number;ior:number;absorptionColor:number[];absorptionDensity:number;emissionColor:number[];emissionStrength:number;source:MaterialSettings;images:Partial<Record<'bump'|'normal',string>>}
export interface SceneBundleManifest {
 format:'fraktalmotorn-scene-bundle';version:1;exporterVersion:'phase8-v1';sourceSceneVersion:number;sourceScene:'source.scene.json';
 coordinateSystem:'right-handed Y-up';units:string;bounds:SamplingOptions['bounds'];
 representations:{id:string;kind:FractalRepresentation;path:string;materialId:string;colorsIncludeBaseColor:boolean;diagnostics:unknown}[];
 primitives:(NonNullable<Scene['primitives']>[number] & {materialId:string})[];planeHalfSize:number;
 materials:ExportMaterial[];
 camera:{source:Scene['camera'];basis:ReturnType<typeof cameraBasis>;verticalFovDegrees:number;focalLengthMm:number;sensorWidthMm:number;focusDistance:number;apertureRadius:number};
 resolution:{width:number;height:number};lights:Scene['lights'];ambient:Scene['ambient'];
 environment:{source:Scene['environment'];path:string;skyPath:string;rotationDegrees:number;strength:number;backgroundVisible:boolean};
 metadata:{cutout:Scene['cutout'];fog:Scene['fog'];content:Scene['content'];credits:Scene['credits'];display:Scene['display'];details:Scene['details']};
 diagnostics:{feature:string;status:'EXPORTED'|'APPROXIMATED'|'METADATA_ONLY'|'UNSUPPORTED';reason:string}[];
 files:ExportFile[];
}
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value,null,2)+'\n');
const defaultGaussian=():GaussianOptions=>({scaleMultiplier:1.3,opacity:.9,opacityMode:'constant',colorMode:'surface-color'});
/** One scriptable dispatcher over the shared sampler. Sink errors/cancellation are data; already-written files are listed. */
export async function exportContent(scene:Scene,sampler:GeometrySampler,options:ContentExportOptions,sink:ExportSink,helpers?:{blender:string;vdb:string}):Promise<ExportStatus>{
 const files:ExportFile[]=[],warnings:string[]=[];
 const write=async(path:string,bytes:Uint8Array)=>{checkCancelled(options.signal);if(!/^[a-zA-Z0-9_./-]+$/.test(path)||path.startsWith('/')||path.split('/').includes('..'))throw Error('Unsafe export path');
  if(files.some(f=>f.path===path))throw Error('Duplicate export path');
  if(files.reduce((sum,f)=>sum+f.bytes,0)+bytes.length>256*1024*1024)throw Error('Export package exceeds 256 MiB; lower quality or use an independent streaming volume operation');
  await sink.write(path,bytes);files.push({path,bytes:bytes.length});};
 try{
  samplingGrid(options);if(!['geometry','volume','points','gaussians','scene'].includes(options.mode))throw Error('Unsupported export mode');
  const representation=options.mode==='scene'?(options.representation??'mesh'):options.mode==='geometry'?'mesh':options.mode==='volume'?'volume':options.mode==='points'?'points':'gaussians';
  if(!['mesh','volume','points','gaussians'].includes(representation))throw Error('Unsupported fractal representation');
  const colorsIncludeBaseColor=representation==='points'||representation==='gaussians'||(representation==='mesh'&&(options.format??'glb')!=='glb');
  let fractalId='fractal';while(scene.primitives?.some(p=>p.id===fractalId))fractalId='fractal:'+fractalId;
  if(['points','gaussians'].includes(representation)){const count=options.count??20000;if(!Number.isInteger(count)||count<1||count>(representation==='gaussians'&&options.adaptiveGaussian?MAX_GAUSSIAN_COUNT:1000000))throw Error('Invalid point/Gaussian count before sampling');}
  if(options.mode==='scene'&&!helpers)throw Error('Complete scene requires the Blender and VDB import helpers');
  let geometryPath='',diagnostics:unknown;
  if(representation==='volume'){
   const estimate=volumeEstimate(options);
   if((estimate.valuesBytes+estimate.validityBytes)*2>256*1024*1024)throw Error('Buffered volume exceeds 256 MiB memory budget before sampling; lower resolution or use exportVolume with a streaming sink');
   const values:Uint8Array[]=[],validity:Uint8Array[]=[];
   // Browser packages buffer the bounded final file; exportVolume itself remains independently streamable.
   const result=await exportVolume(sampler,{...options,mode:options.volumeMode??'surface-density'},{async values(b){values.push(b);},async validity(b){validity.push(b);}});
   const merge=(parts:Uint8Array[])=>{const size=parts.reduce((sum,b)=>sum+b.length,0);if(size>256*1024*1024)throw Error('Volume file exceeds package memory limit');const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;};
   await write('volume/field.raw',merge(values));await write('volume/validity.raw',merge(validity));await write('volume/field.mhd',new TextEncoder().encode(result.header));await write('volume/field.json',encode(result.metadata));geometryPath='volume/field.json';diagnostics=result.metadata;warnings.push(...result.metadata.diagnostics.warnings);
  }else if(representation==='gaussians'&&options.adaptiveGaussian){
   // ZIP is deliberately bounded. Standalone exportAdaptiveGaussians accepts a direct
   // streaming sink and supports files larger than this conventional package budget.
   const parts:Uint8Array[]=[];let bytes=0;
   const memoryBudgetMiB=options.adaptiveGaussian.memoryBudgetMiB??512;
   const bufferedCountBudget=Math.floor((memoryBudgetMiB*2**20-8*2**20)/(184+4*248));
   const result=await exportAdaptiveGaussians(sampler,{...options.adaptiveGaussian,memoryBudgetMiB,maxCount:Math.min(options.adaptiveGaussian.maxCount??5000000,bufferedCountBudget),fileBudgetMiB:Math.min(options.adaptiveGaussian.fileBudgetMiB??240,240),bounds:options.bounds,isoLevel:options.isoLevel,seed:options.seed,withColors:options.withColors,baseColor:resolveMaterial(scene.material).baseColor as [number,number,number],gaussian:options.gaussian,signal:options.signal,onProgress:(stage,done,total)=>options.onProgress?.(done,total)},{async write(part){bytes+=part.length;if(bytes>240*2**20)throw Error('Gaussian scene package exceeds buffered budget; use standalone streaming PLY');parts.push(part);}});
   const merged=new Uint8Array(bytes);let offset=0;for(const part of parts){merged.set(part,offset);offset+=part.length;}parts.length=0;
   geometryPath='geometry/fractal.3dgs.ply';await write(geometryPath,merged);diagnostics=result;warnings.push(...result.warnings);
  }else{
   const surface=await extractAdaptiveMesh(sampler,{...options,simplifyTolerance:representation==='mesh'?options.simplifyTolerance:0,withColors:options.withColors??true});diagnostics=surface.diagnostics;warnings.push(...surface.diagnostics.warnings);
   if(!surface.mesh.indices.length)throw Error('No isosurface; adjust bounds or use a positive isovalue for unsigned interiors');
   if(options.withColors!==false&&!surface.mesh.colors)warnings.push('No colour sampler: gradient/image appearance is not baked; only the material base colour is exported.');
   if(representation==='mesh'){
    const format=options.format??'glb';if(!['glb','obj','ply'].includes(format))throw Error('Unsupported mesh format');geometryPath=`geometry/fractal.${format}`;
    const material=resolveMaterial(scene.material),credits=(scene.credits??[]).map(c=>`${c.formula}: ${c.text} (${c.status})`);
    if(colorsIncludeBaseColor&&surface.mesh.colors)surface.mesh.colors=surface.mesh.colors.map((value,i)=>value*material.baseColor[i%3]!);
    await write(geometryPath,format==='glb'?meshToGlb(surface.mesh,{name:fractalId,objectId:fractalId,credits,metallic:propertyValue(material.metallic,.5),roughness:propertyValue(material.roughness,.5),color:[...material.baseColor],extras:{diagnostics:surface.diagnostics}}):format==='ply'?meshToPly(surface.mesh,credits):new TextEncoder().encode(meshToObjParts(surface.mesh,credits).join('')));
   }else{
    const points=sampleSurfacePoints(surface.mesh,{objectId:fractalId,materialId:'scene',count:options.count??20000,seed:options.seed??42,bounds:options.bounds,resolution:options.resolution,semantics:sampler.semantics,withColors:options.withColors??true,adaptiveByCurvature:true,signal:options.signal});
    if(points.colors){const baseColor=resolveMaterial(scene.material).baseColor;for(let i=0;i<points.colors.length;i++)points.colors[i]=points.colors[i]!*baseColor[i%3]!;}
    geometryPath=representation==='points'?'geometry/fractal.points.ply':'geometry/fractal.3dgs.ply';
    await write(geometryPath,representation==='points'?pointsToPly(points,{normals:options.withNormals??true,colors:options.withColors??true}):gaussiansToPly(constructGaussians(points,options.gaussian??defaultGaussian())));
   }
  }
  if(options.mode!=='scene'){
   if(representation==='volume'&&helpers)await write('field_to_vdb.py',new TextEncoder().encode(helpers.vdb));
   await write('export.json',encode({format:'fraktalmotorn-content-export',version:1,objectId:fractalId,representation,colorsIncludeBaseColor,semantics:sampler.semantics,bounds:options.bounds,resolution:options.resolution,isoLevel:options.isoLevel,material:scene.material,credits:scene.credits,files,diagnostics,warnings}));
   return {ok:true,status:'complete',files,warnings};
  }
  if(!helpers)throw Error('Complete scene requires the Blender and VDB import helpers');
  const featureDiagnostics:SceneBundleManifest['diagnostics']=[
   {feature:'geometry',status:'EXPORTED',reason:'Bounded sampled isosurface/field; explicit isovalue and fidelity diagnostics.'},
   {feature:'materials',status:'APPROXIMATED',reason:'Principled PBR; driven properties sampled at measure 0.5, image/procedural mappings may differ.'},
   {feature:'lighting',status:'APPROXIMATED',reason:'Native Lambert intensity to Blender: sun π×I, point/spot 4π²×I. Softness is an approximation.'},
   {feature:'cutout',status:'METADATA_ONLY',reason:'Open native clipping planes and optional Box Cut preserved as metadata; raw exported fields/geometry are not clipped.'},
   {feature:'fog/details/transport',status:'METADATA_ONLY',reason:'Native fog, AO/cavity/bevel and ray budgets are preserved in source JSON, not recreated as Blender renderer settings.'},
  ];
  if(scene.material.displacement||(scene.primitives??[]).some(p=>p.material!=='scene'&&p.material.displacement))featureDiagnostics.push({feature:'geometric-displacement',status:'METADATA_ONLY',reason:'Native sphere/plane height displacement is preserved with embedded images in source-scene JSON; exported primitive geometry and fractal mesh/SDF do not bake it.'});
  if(representation==='gaussians')featureDiagnostics.push({feature:'native-gaussians',status:'UNSUPPORTED',reason:'Requires target Gaussian PointCloud feature detection (normally Blender 5.3). No ordinary-point fallback.'});
  const materials:ExportMaterial[]=[];
  const packImage=async(data:string,path:string)=>{const match=/^data:image\/(png|jpeg|vnd\.radiance);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);if(!match)throw Error('Unsupported embedded image format');const extension=match[1]==='png'?'png':match[1]==='jpeg'?'jpg':'hdr';const name=`assets/${path}.${extension}`;await write(name,base64ToBytes(match[2]!));return name;};
  for(const [id,source] of [['scene',scene.material],...(scene.primitives??[]).filter(p=>p.material!=='scene').map(p=>[`primitive:${p.id}`,p.material])] as [string,MaterialSettings][]){
   const material=resolveMaterial(source),images:ExportMaterial['images']={};
   for(const key of ['bump','normal'] as const){const texture=material.surfaceDetail[key].texture;if(texture)images[key]=await packImage(texture.data,`material-${materials.length}-${key}`);}
   const detail={...material.surfaceDetail,bump:{...material.surfaceDetail.bump,texture:undefined},normal:{...material.surfaceDetail.normal,texture:undefined}};
   materials.push({id,baseColor:[...material.baseColor],metallic:propertyValue(material.metallic,.5),roughness:propertyValue(material.roughness,.5),reflectivity:propertyValue(material.reflectivity,.5),transmission:material.transmission,ior:material.ior,absorptionColor:[...material.absorptionColor],absorptionDensity:material.absorptionDensity,emissionColor:[...material.emissionColor],emissionStrength:material.emissionStrength,source:{...source,surfaceDetail:detail},images});
   if(material.surfaceDetail.procedural?.enabled)featureDiagnostics.push({feature:`material:${id}:procedural`,status:'APPROXIMATED',reason:'Blender noise/Voronoi reconstruction is not native seeded field math; original settings remain metadata.'});
   if(material.surfaceDetail.normal.enabled&&images.normal)featureDiagnostics.push({feature:`material:${id}:normal`,status:id==='scene'?'METADATA_ONLY':'APPROXIMATED',reason:id==='scene'?'UV-less fractal tangent normal map is packaged; no false UV transfer.':'Blender primitive UV tangent frame differs from native analytic/triplanar mapping.'});
  }
  if(scene.color.texture)await packImage(scene.color.texture.data,'base-color-source');
  const skyPixels=new Float32Array(64*32*3);for(let y=0;y<32;y++){const color=skyGradient([0,Math.cos((y+.5)*Math.PI/32),0]);for(let x=0;x<64;x++)skyPixels.set(color,(y*64+x)*3);}
  const skyPath='assets/sky.hdr';await write(skyPath,encodeRgbe({width:64,height:32,data:skyPixels}));
  const environment=scene.environment,path=environment.kind==='hdri'?await packImage(environment.data,'environment'):skyPath;
  const resolution=outputSize(scene.render,options.windowAspect??1.5),sensorWidthMm=scene.camera.lens?.sensor_width_mm??36;
  const vfov=verticalFovDegrees(cameraFov(scene.camera,scene.render.fov_axis,resolution.width,resolution.height),scene.render.fov_axis,resolution.width,resolution.height);
  const manifest:SceneBundleManifest={format:'fraktalmotorn-scene-bundle',version:1,exporterVersion:'phase8-v1',sourceSceneVersion:scene.schema_version,sourceScene:'source.scene.json',coordinateSystem:'right-handed Y-up',units:scene.units,bounds:options.bounds,
   representations:[{id:fractalId,kind:representation,path:geometryPath,materialId:'scene',colorsIncludeBaseColor,diagnostics}],primitives:(scene.primitives??[]).map(p=>({...structuredClone(p),material:p.material==='scene'?'scene':materials.find(m=>m.id===`primitive:${p.id}`)!.source,materialId:p.material==='scene'?'scene':`primitive:${p.id}`})),planeHalfSize:options.planeHalfSize??10,materials,
   camera:{source:structuredClone(scene.camera),basis:cameraBasis(scene.camera),verticalFovDegrees:vfov,focalLengthMm:lensFromFov(vfov,sensorWidthMm/(resolution.width/resolution.height)),sensorWidthMm,focusDistance:focusDistance(scene.camera),apertureRadius:scene.camera.dof?.aperture_radius??0},resolution,
   lights:structuredClone(scene.lights),ambient:structuredClone(scene.ambient),environment:{source:environment.kind==='hdri'?{...environment,data:'[packaged asset]'}:environment,path,skyPath,rotationDegrees:environment.kind==='hdri'?environment.rotation_degrees:0,strength:environment.kind==='hdri'?environment.intensity:1,backgroundVisible:environment.kind==='hdri'?environment.background_visible:true},
   metadata:{cutout:scene.cutout,fog:scene.fog,content:scene.content,credits:scene.credits,display:scene.display,details:scene.details},diagnostics:featureDiagnostics,files};
  if(!Number.isFinite(manifest.planeHalfSize)||manifest.planeHalfSize<=0||manifest.planeHalfSize>1e6)throw Error('Invalid bounded plane size');
  await write('source.scene.json',encode(scene));await write('import_blender.py',new TextEncoder().encode(helpers.blender));await write('field_to_vdb.py',new TextEncoder().encode(helpers.vdb));
  await write('README.txt',new TextEncoder().encode('Fractal engine – scene package v1\n\n1. Unpack the ZIP file with the folders preserved.\n2. Blender: Scripting > Open > import_blender.py > Run Script.\n3. File > Import > Fractal engine Scene (.json); choose scene.manifest.json.\nA new scene is created; earlier scenes are kept. Requires Object Mode.\n\nAlternative: blender --background --python import_blender.py -- scene.manifest.json --save scene.blend --render preview.png\nOptional: --glb scene.glb --usd scene.usda (installed Blender exporters).\n\nScene 28 is preserved in source.scene.json. Manifest 1 has relative paths.\nRead the diagnostics: the sampling loses details smaller than the cell size, material/light are approximated and clipping/fog/AO are saved as metadata.\nGaussian PLY is real anisotropic surface splats; native import requires Gaussian PointCloud support, normally Blender 5.3. No ordinary point fallback.\nRaw DE is not automatically a signed SDF. Volume is converted to a real VDB with the existing OpenVDB module of Blender.\n'));
  // The manifest lists content files; listing itself would require a self-referential byte count.
  manifest.files=[...files];await write('scene.manifest.json',encode(manifest));
  warnings.push(...featureDiagnostics.filter(d=>d.status!=='EXPORTED').map(d=>`${d.feature}: ${d.reason}`));
  return {ok:true,status:'complete',files,warnings,manifest};
 }catch(error){return {ok:false,status:options.signal?.aborted?'cancelled':'failed',files,warnings,error:error instanceof Error?error.message:String(error)};}
}
