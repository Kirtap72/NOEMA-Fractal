import { imageTiles, serializeScene } from "../engine";
import type { Engine, Formula, Scene } from "../engine";
import type { FrameSink } from "./output";
import { encodeExrBlob } from "./output";
import { encodeExr, depthChannels, normalChannels } from "../engine/exr";
import { PngStreamWriter } from "./pngStream";

/** Portable fallback: bounded PNG/EXR files plus global pixel origins and a complete source scene. */
export async function renderTileOutput(
  engine: Engine,
  scene: Scene,
  formulas: readonly Formula[],
  width: number,
  height: number,
  sink: FrameSink,
  layers: "none" | "depth" | "depth+normal",
  signal: AbortSignal,
  progress: (fraction: number) => void,
  tileSize = 2048,
): Promise<void> {
  const tiles: {
    file: string;
    x: number;
    y: number;
    width: number;
    height: number;
    depth?: string;
    normal?: string;
  }[] = [];
  let done = 0;
  for (const region of imageTiles(width, height, tileSize)) {
    if (signal.aborted)
      throw new DOMException("The render was cancelled.", "AbortError");
    const name = `tile_${region.x}_${region.y}`,
      options = {
        region,
        signal,
        onProgress: (p: { fraction: number }) =>
          progress(
            (done + p.fraction * region.width * region.height) /
              (width * height),
          ),
      };
    const result =
      layers === "none"
        ? await engine.renderToBuffer(width, height, options)
        : await engine.renderLayersToBuffer(width, height, options);
    const color = "color" in result ? result.color : result.data,
      parts: Uint8Array[] = [];
    const png = await PngStreamWriter.create(
      region.width,
      region.height,
      (b) => {
        parts.push(b.slice());
      },
      {
        Software: "Fraktalmotorn",
        Comment: `Global frame ${width}x${height}, tile origin ${region.x},${region.y}.`,
      },
    );
    await png.writeRows(color, region.height);
    await png.finish();
    const file = name + ".png";
    await sink.write(
      file,
      new Blob(parts as Uint8Array<ArrayBuffer>[], { type: "image/png" }),
    );
    const entry: {
      file: string;
      x: number;
      y: number;
      width: number;
      height: number;
      depth?: string;
      normal?: string;
    } = { file, ...region };
    if ("depth" in result) {
      entry.depth = name + "_depth.exr";
      await sink.write(
        entry.depth,
        encodeExrBlob(
          encodeExr(region.width, region.height, depthChannels(result.depth)),
        ),
      );
    }
    if (layers === "depth+normal" && "normal" in result) {
      entry.normal = name + "_normal.exr";
      await sink.write(
        entry.normal,
        encodeExrBlob(
          encodeExr(region.width, region.height, normalChannels(result.normal)),
        ),
      );
    }
    tiles.push(entry);
    done += region.width * region.height;
  }
  await sink.write(
    "scene.json",
    new Blob([serializeScene(scene, formulas)], { type: "application/json" }),
  );
  await sink.write(
    "tiles.json",
    new Blob(
      [
        JSON.stringify(
          {
            format: "fractal-render-tiles",
            version: 1,
            width,
            height,
            origin: "top-left",
            scene: "scene.json",
            tiles,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  await sink.finish();
}
