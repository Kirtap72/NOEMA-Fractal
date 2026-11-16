import type {MaterialSettings} from './material';
export interface DiffuseOrbit {influence:number;color:readonly [number,number,number]}
export function diffuseOrbitRequest(material:MaterialSettings):DiffuseOrbit|undefined {
 const influence=material.orbitColorInfluence??1;
 if(influence===1)return;
 return {influence,color:material.diffuseColor??[1,1,1]};
}
/** Decorates only the final primary diffuse inputs. Original base and F0 survive. */
export function diffuseOrbitShader(shader:string,request?:DiffuseOrbit):string {
 if(!request||request.influence===1)return shader;
 const {influence,color}=request;
 if(!Number.isFinite(influence)||influence<0||influence>1||color.length!==3||color.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Invalid diffuse orbit request');
 const helper=shader.match(/fn surfaceBaseColorWith\([^]*?\n}/)?.[0];
 const primary=shader.match(/  let base = ([^\n]*(?:objectBaseColor|surfaceBaseColorWith)\([^\n]+);/);
 if(!helper||!primary||shader.split(primary[0]).length!==2)throw Error('Primary diffuse orbit anchor changed');
 // The influence and the colour are read from the uniform block (u.tune, u.tuneColor): dragging the slider must not build the shader again.
 const gradient='gradientColor(m * u.color.y + u.color.z)';
 if(helper.split(gradient).length!==2)throw Error('Orbit gradient anchor changed');
 const mixed=helper.replace('fn surfaceBaseColorWith(','fn orbitDiffuseColor(').replace(gradient,`mix(u.tuneColor.xyz, ${gradient}, u.tune.x)`);
 const expression=primary[1]!.replace(/(?:objectBaseColor|surfaceBaseColorWith)\(/,'orbitDiffuseColor(');
 if(expression===primary[1])throw Error('Primary diffuse color source missing');
 const objects=shader.includes('var<private> surfaceIndex');
 shader=shader.replace(primary[0],primary[0]+`\n  var orbitDiffuseBase=base;\n  ${objects?'if(surfaceIndex<0){':''}orbitDiffuseBase=${expression};${objects?'}':''}`);
 // Headlight and legacy diffuse remain usable, with the same lighting math.
 const start=shader.indexOf('  var lit : vec3f;'),end=shader.indexOf('  return out;',start);
 if(start<0||end<start)throw Error('Primary lighting boundary changed');
 const region=shader.slice(start,end).replaceAll('lit = base *','lit = orbitDiffuseBase *');
 return shader.slice(0,start)+region+shader.slice(end)+'\n'+mixed+'\n';
}
