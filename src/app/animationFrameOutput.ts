import type { Engine, RenderOptions, RenderTiming } from '../engine/engine';
import type { AnimationSnapshot, SequenceOptions } from '../engine/animationOutput';
import { evaluateSequenceFrame } from '../engine/animationOutput';
import { ExrStreamWriter } from '../engine/exr';
import { PngStreamWriter } from './pngStream';
/** The same full-quality, band/tile, denoise and color path as final still export. */
export async function renderAnimationFrame(engine:Engine,snapshot:AnimationSnapshot,options:SequenceOptions,n:number,
  write:(bytes:Uint8Array)=>void|Promise<void>,prepare:(scene:AnimationSnapshot['scene'])=>Promise<void>,
  signal:AbortSignal,onProgress:NonNullable<RenderOptions['onProgress']>=()=>{},onTiming:(t:RenderTiming)=>void=()=>{},tileSize?:number) {
  const scene=evaluateSequenceFrame(snapshot,options,n);signal.throwIfAborted();await prepare(scene);signal.throwIfAborted();
  const ready=await engine.setScene(scene);if(ready.errors.length||ready.superseded)throw Error(ready.errors.join('; ')||'Animation frame was superseded');
  const {width,height}=options;
  if(options.format==='png'){
    const writer=await PngStreamWriter.create(width,height,write,{Software:'NOEMA Fractal Animation 2.0',Comment:`Frame ${n}; time ${n/options.fps}; FPS ${options.fps}; display-transformed RGB8, opaque background; quality seed ${scene.render.quality.seed}.`});
    try{await engine.renderStream(width,height,{signal,onProgress,onTiming,...(tileSize?{tileSize}:{})},false,band=>writer.writeRows(band.color,band.rows));await writer.finish();}catch(e){await writer.abort();throw e;}
  }else{
    const writer=await ExrStreamWriter.create(width,height,write,{precision:options.format==='exr-half'?'half':'float',metadata:{software:'NOEMA Fractal Animation 2.0',colorSpace:'linear-sRGB',framesPerSecond:options.fps,timelineFrame:n,timelineTime:n/options.fps,displayExposureEV:scene.display?.exposure??0}});
    await engine.renderStream(width,height,{signal,onProgress,onTiming,...(tileSize?{tileSize}:{})},false,async band=>{if(!band.linear)throw Error('Missing scene-linear HDR');await writer.writeRows(band.linear,band.rows);});writer.finish();
  }
}
