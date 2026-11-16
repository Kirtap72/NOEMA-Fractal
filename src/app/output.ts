import type { ImageBuffer } from "../engine";
import { ZipWriter } from "./zip";
import {desktop} from './desktop';

/** Turns pixels into a PNG file (the browser does the compression). */
export async function encodePng(image: ImageBuffer): Promise<Blob> {
  const pixels = new Uint8ClampedArray(image.data.buffer as ArrayBuffer, image.data.byteOffset, image.data.byteLength);
  const data = new ImageData(pixels, image.width, image.height);
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext("2d")!.putImageData(data, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the PNG."))), "image/png"),
  );
}

/** Where the finished frames go. */
export interface FrameSink {
  write(fileName: string, data: Blob): Promise<void>;
  /** Called when all frames are written. For ZIP this starts the download. */
  finish(): Promise<void>;
  /** Short text for the screen, for example the folder name. */
  describe(): string;
}

interface DirectoryHandle {
  name: string;
  getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
}

type DirectoryPicker = (options: { mode: "readwrite" }) => Promise<DirectoryHandle>;

/** True if the browser can write straight into a folder chosen by the user (Chrome and Edge can). */
export function canWriteToFolder(): boolean {
  return !!desktop || typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/**
 * Asks the user for a folder. Must be called straight from a click, before anything slow happens,
 * or the browser refuses to show the picker. Files with the same names in the folder are overwritten.
 */
export async function createFolderSink(): Promise<FrameSink> {
  if(desktop){const host=desktop,folder=await host.output('folder') as {token:string;name:string};return {write:async(name,blob)=>{const file=await host.output('frameFile',folder.token,name) as {token:string};try{for await(const chunk of blob.stream() as ReadableStream<Uint8Array>&AsyncIterable<Uint8Array>)for(let offset=0;offset<chunk.length;offset+=16*1024*1024)await host.output('write',file.token,chunk.subarray(offset,offset+16*1024*1024));await host.output('close',file.token);}catch(error){await host.output('abort',file.token);throw error;}},finish:async()=>{},describe:()=>`the folder "${folder.name}"`};}
  const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  const dir = await picker.call(window, { mode: "readwrite" });
  return {
    async write(fileName, data) {
      const handle = await dir.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    },
    async finish() {},
    describe: () => `the folder "${dir.name}"`,
  };
}

/** Collects the frames in a ZIP file that is downloaded at the end. */
export function createZipSink(downloadName: string): FrameSink {
  const zip = new ZipWriter();
  return {
    write: (fileName, data) => zip.add(fileName, data),
    async finish() {
      const blob = zip.finish();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = downloadName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    },
    describe: () => `the ZIP file ${downloadName}`,
  };
}

/** One bounded file per download; avoids accumulating an enormous ZIP in memory. A chosen folder is preferable. */
export function createDownloadSink(): FrameSink {
  return { async write(fileName,data){const link=document.createElement('a');link.href=URL.createObjectURL(data);link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);},async finish(){},describe:()=> 'separate tile downloads (allow several downloads in the browser)' };
}

/** Turns the bytes of an OpenEXR file into a file the browser can save. */
export function encodeExrBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/x-exr" });
}

/** A single file that is written piece by piece. */
export interface FileStream {
  /** Absent for direct disk writing; bounded download fallback exposes its retained-byte budget. */
  bufferedByteLimit?:number;
  write(bytes: Uint8Array): Promise<void>;
  /** Finishes the file (or starts the download if the browser cannot write straight to disk). */
  close(): Promise<void>;
  /** Gives up: the file is not kept. */
  abort(): Promise<void>;
  describe(): string;
}

interface SavePickerHandle {
  name: string;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}

/**
 * Opens a file for writing piece by piece. Where the browser allows it (Chrome and Edge) the user picks a place and the
 * file is written straight to disk, so even a very large picture needs little memory. Otherwise the pieces are collected
 * and downloaded at the end, with an explicit file-byte memory limit. Must be called straight from a click,
 * before anything slow happens, or the browser refuses to show the picker.
 */
export async function openFileStream(suggestedName: string, mimeType: string, extension: string): Promise<FileStream> {
  if(desktop){const host=desktop,file=await host.output('file',suggestedName,extension) as {token:string;name:string};return {write:bytes=>host.output('write',file.token,bytes),close:()=>host.output('close',file.token),abort:()=>host.output('abort',file.token),describe:()=>`the file "${file.name}"`};}
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<SavePickerHandle> }).showSaveFilePicker;
  if (picker) {
    const handle = await picker.call(window, { suggestedName, types: [{ description: suggestedName, accept: { [mimeType]: [extension] } }] });
    const writable = await handle.createWritable();
    return {
      write: (bytes) => writable.write(bytes),
      close: () => writable.close(),
      abort: () => writable.abort().catch(() => undefined),
      describe: () => `the file "${handle.name}"`,
    };
  }
  const parts: Uint8Array[] = [];
  let bufferedBytes=0;
  return {
    bufferedByteLimit:512*2**20,
    async write(bytes) {
      bufferedBytes+=bytes.length;
      if(bufferedBytes>512*2**20){parts.length=0;throw Error('The download needs more than 512 MiB of buffered memory. Use a browser with streaming file writing; for PNG there is also PNG tiles + JSON.');}
      parts.push(bytes.slice()); // the writer may reuse its buffer
    },
    async close() {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob(parts as Uint8Array<ArrayBuffer>[], { type: mimeType }));
      link.download = suggestedName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    },
    async abort() {
      parts.length = 0;
    },
    describe: () => `nedladdningen ${suggestedName}`,
  };
}
