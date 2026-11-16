import type { Scene } from "../engine/scene";
import type { Vec3 } from "../engine/camera";
import { fitSpotToTarget, formatLightValue } from "../engine/lightScale";
import type { FitAnchor, IntensityFit } from "../engine/lightScale";

export interface AimRect { left:number; top:number; width:number; height:number; film?:{width:number;height:number}; clip?:{left:number;top:number;width:number;height:number} }
export interface AimPixel { width:number; height:number; x:number; y:number }
/** Map actual fitted-image CSS coordinates into its integer film; never use panel bounds or multiply by DPR. */
export function aimPixel(rect:AimRect,clientX:number,clientY:number):AimPixel|null {
  const x=clientX-rect.left,y=clientY-rect.top;
  if(rect.clip&&!aimPixel(rect.clip,clientX,clientY))return null;
  if(![rect.left,rect.top,rect.width,rect.height,x,y].every(Number.isFinite)||rect.width<=0||rect.height<=0||x<0||y<0||x>=rect.width||y>=rect.height)return null;
  // The normal/hit reference film requires whole pixels. Use the displayed image's
  // actual backing film, and preserve its ray under CSS fit/zoom/scroll and DPI.
  const film=rect.film??{width:Math.max(1,Math.round(rect.width)),height:Math.max(1,Math.round(rect.height))};
  if(!Number.isInteger(film.width)||!Number.isInteger(film.height)||film.width<1||film.height<1)return null;
  return {width:film.width,height:film.height,x:x/rect.width*film.width,y:y/rect.height*film.height};
}
/** Canonical light fields only; no persistent target or implicit strength adjustment. */
export function aimSpotAt(scene:Scene,index:number,target:Vec3):Scene {
  const light=scene.lights[index];
  if(light?.type!=="spot"||!target.every(Number.isFinite))return scene;
  const direction=target.map((v,i)=>v-light.position[i]!) as Vec3;
  if(!direction.every(Number.isFinite)||Math.hypot(...direction)<=1e-15)return scene;
  return {...scene,lights:scene.lights.map((l,i)=>i===index?{...l,direction}:l)};
}
export interface SurfaceAimHooks {
  scene():Scene;
  rect():AimRect;
  available():boolean;
  pick(pixel:AimPixel):Promise<{position:Vec3}|null>;
  commit(scene:Scene):void;
  changed():void;
}
/** One cancellable UI intent; existing engine owns the actual world-space surface query. */
export class SurfaceAim {
  index:number|null=null;
  busy=false;
  message="";
  target?:{position:Vec3;pixel:AimPixel;rect:AimRect;scene:Scene};
  /** Set by a successful "aim and fit"; used by the illumination control. Session-only, never saved in the scene. */
  fitted?:{anchor:FitAnchor;fit:IntensityFit};
  private fitLevel?:number;
  private ticket=0;
  private light?:Scene['lights'][number];
  constructor(private hooks:SurfaceAimHooks){}
  /** `illumination` given = "aim and fit": direction AND intensity in one Undo step. Left out = direction only, as before. */
  start(index:number,illumination?:number):boolean {
    if(this.busy||!this.hooks.available()||this.hooks.scene().lights[index]?.type!=="spot")return false;
    this.light=this.hooks.scene().lights[index];
    this.fitLevel=illumination;
    this.ticket++;this.index=index;this.target=undefined;this.message=illumination===undefined?"Click a visible surface for the light target. Esc cancels.":"Click a visible surface: the light is aimed there and gets a strength that suits the distance. Esc cancels.";this.hooks.changed();return true;
  }
  cancel():void {this.ticket++;this.index=null;this.fitLevel=undefined;this.target=undefined;this.message="Light aiming cancelled. The scene is unchanged.";this.hooks.changed();}
  hide():void {this.target=undefined;this.hooks.changed();}
  async at(clientX:number,clientY:number):Promise<void> {
    if(this.index===null||this.busy||!this.hooks.available())return;
    const rect={...this.hooks.rect()},pixel=aimPixel(rect,clientX,clientY);
    if(!pixel){this.message="Outside the picture. No change.";this.hooks.changed();return;}
    const scene=this.hooks.scene(),light=this.light;
    const index=scene.lights.findIndex(l=>light?.id?l.id===light.id:l===light);
    if(index<0||scene.lights[index]?.type!=="spot"){this.cancel();this.message="The chosen spot light no longer exists. No change.";this.hooks.changed();return;}
    this.index=index;const ticket=++this.ticket;
    this.busy=true;this.message="Looking for the actual surface…";this.hooks.changed();
    try {
      const hit=await this.hooks.pick(pixel);
      if(ticket!==this.ticket)return;
      if(scene!==this.hooks.scene()||JSON.stringify(rect)!==JSON.stringify(this.hooks.rect())){
        this.index=null;this.message="The view or the scene changed during the search. No change.";return;
      }
      if(!hit){this.message="No surface was hit. Choose a surface or cancel with Esc.";return;}
      const level=this.fitLevel;
      if(level!==undefined){
        const fitted=fitSpotToTarget(scene,index,hit.position,level);
        if(!fitted.ok){this.message=fitted.message+" No change.";return;}
        this.hooks.commit(fitted.scene);this.index=null;this.fitLevel=undefined;
        this.target={position:[...hit.position],pixel,rect,scene:this.hooks.scene()};
        this.fitted={anchor:fitted.anchor,fit:fitted.fit};
        this.message="The light is aimed at the surface and fitted: distance "+formatLightValue(fitted.fit.distance)+", Strength "+formatLightValue(fitted.previousIntensity)+" → "+formatLightValue(fitted.fit.intensity)+" (illumination at the target "+formatLightValue(fitted.fit.illumination)+")."+(fitted.fit.floorEngaged?" The target is closer than 0.01: the light does not get stronger any closer.":"")+(fitted.fit.limited?" The strength was limited by the upper limit.":"");
        return;
      }
      const next=aimSpotAt(scene,index,hit.position);
      if(next===scene){this.message="Invalid light target. No change.";return;}
      this.hooks.commit(next);this.index=null;this.fitted=undefined;
      this.target={position:[...hit.position],pixel,rect,scene:this.hooks.scene()};
      this.message="Light target in the world: "+hit.position.map(v=>v.toPrecision(7)).join(", ")+". Only the direction was changed.";
    } catch(error){if(ticket===this.ticket){this.index=null;this.message="Surface search failed. No change. "+(error instanceof Error?error.message:String(error));}}
    finally {this.busy=false;this.hooks.changed();}
  }
}
