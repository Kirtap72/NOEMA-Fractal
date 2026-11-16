import type {Scene} from '../engine/scene';

/** Immutable scene values, with reference fast paths for unchanged resources/arrays.
 * Do not serialize texture payloads or the whole scene on the app frame clock. */
function equal(a:unknown,b:unknown):boolean {
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x);
 return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&equal(x[k],y[k]));
}
const comparisons=new WeakMap<Scene,WeakMap<Scene,boolean>>();
/** Surface/ray safety only. Lighting display freshness still uses LookDev's source/revision.
 * Material is conservative: it can carry geometric displacement and its chart mapping.
 * Render includes film, FOV axis and hit-quality policy. Animation is conservative too;
 * the app separately forbids queries against an evaluated view other than the saved scene. */
export function sameSurfacePickView(presented:Scene,current:Scene):boolean {
 if(presented===current)return true;
 let cache=comparisons.get(presented);if(!cache){cache=new WeakMap();comparisons.set(presented,cache);}
 const known=cache.get(current);if(known!==undefined)return known;
 const keys=['camera','content','primitives','formulaFields','discoveredFormulas','cutout',
  'geometryDetail','fractalDisplacement','material','render','animation','cameraFlight'] as const satisfies readonly (keyof Scene)[];
 const same=keys.every(k=>equal(presented[k],current[k]));cache.set(current,same);return same;
}
