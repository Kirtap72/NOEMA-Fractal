// MCP-01A: one bounded OpenAI Agents SDK run against NOEMA through the EXISTING stdio shim of MCP-01.
// - the model chooses and calls NOEMA's tools itself (nothing is scripted); every call and result is logged
// - at most ONE preview render: the preview tool is removed from the model's tool list after the first use
// - the API key is never printed or written (and the shim does not even receive it); tracing upload is off
// - the shim talks to the running app over the local named pipe; no remote MCP server, no public endpoint
import { Agent, MCPServerStdio, run, setTracingDisabled } from '@openai/agents';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

setTracingDisabled(true); // traces would upload every tool input/output (including images) to OpenAI's dashboard

export const INSTRUCTIONS = `You are an AI art assistant working inside NOEMA Fractal, a fractal renderer, through MCP tools.
Hard rules:
- You can only edit a separate DRAFT. You can never change the artist's live scene, and you must never try to apply a draft yourself.
- The artist decides in the app. When you are done, call noema_request_apply_draft once, with a short message.
- Use only real NOEMA settings and ids from the tools. Do not invent parameters. If a tool says a change was rejected, read the message and correct it.
- You may call noema_render_preview EXACTLY ONCE. You will receive the image: look at it carefully and describe what you actually see.
- Be efficient: avoid repeating calls; no more than about 20 tool calls in total.
- Write the final answer to the artist in plain English.`;

export const DEFAULT_TASK = `Create one genuinely interesting, editable variation of the artist's current NOEMA scene with a metallic / stone-like look.
Steps:
1. Call noema_get_capabilities and noema_inspect_scene (target current; sections camera, color, material, chain, render) to understand what exists.
2. Call noema_list_materials to see which materials you can use, then noema_create_draft.
3. In the draft, experiment with the colour gradient (stop colours, colour measure, cycles, offset, wrap) and with Material Gradient V1 (give gradient stops a Material, e.g. stone to metal; choose a transition width). Use noema_set_draft_parameters and noema_apply_material_to_draft. Leave camera and the formula chain alone unless you have a strong reason.
4. Request exactly ONE preview of your draft (noema_render_preview, target = your draft id, samples 1). Look at the image.
5. Do NOT change the draft after the preview. If you would change something, say so as a suggestion. Then call noema_request_apply_draft once so the artist can decide in the app.
6. Final answer, in English: (a) what you actually see in the preview image, (b) a table of the real NOEMA parameters you changed (setting id, before -> after), (c) limits or surprises you noticed, (d) what you would try next.`;

const SAFE_ENV = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT', 'WINDIR'];
/** The shim gets only what Node needs plus the endpoint file. In particular it never sees OPENAI_API_KEY. */
export function shimEnvironment(endpointFile, source = process.env) {
  const env = {};
  for (const k of SAFE_ENV) if (source[k] !== undefined) env[k] = source[k];
  env.NOEMA_AI_ENDPOINT = endpointFile;
  return env;
}

const B64 = /^[A-Za-z0-9+/=\s]{200,}$/;
/** A copy that is safe to write to disk: pictures become a short note; the API key (if it ever appears) becomes ***. */
export function redact(value, key = process.env.OPENAI_API_KEY, otherKey = process.env.OLLAMA_API_KEY) {
  const seen = (v) => {
    if (typeof v === 'string') {
      let s = key && v.includes(key) ? v.split(key).join('***') : v;
      if (otherKey && s.includes(otherKey)) s = s.split(otherKey).join('***');
      if (/^data:[a-z]+\/[a-z0-9.+-]+;base64,/.test(s) || B64.test(s)) return `[bild/data utesluten, ${s.length} tecken]`;
      return s.length > 4000 ? s.slice(0, 4000) + '…' : s;
    }
    if (Array.isArray(v)) return v.map(seen);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, seen(x)]));
    return v;
  };
  return seen(value);
}

/** Finds PNG/JPEG pictures in whatever shape the SDK hands the tool output over in. */
export function collectImages(value, out = []) {
  if (typeof value === 'string') {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/s.exec(value);
    if (m) out.push({ mime: m[1], base64: m[2] });
    return out;
  }
  if (Array.isArray(value)) { value.forEach((v) => collectImages(v, out)); return out; }
  if (value && typeof value === 'object') {
    if ((value.type === 'image' || value.type === 'input_image') && typeof value.data === 'string' && value.mimeType) out.push({ mime: value.mimeType, base64: value.data });
    for (const v of Object.values(value)) collectImages(v, out);
  }
  return out;
}

/** The SDK hands the same picture over in two places; keep one copy of each distinct picture. */
export function uniqueImages(images) {
  const seen = new Set();
  return images.filter((i) => { const h = createHash('sha256').update(i.base64).digest('hex'); if (seen.has(h)) return false; seen.add(h); return true; });
}

const parseMaybe = (s) => { try { return JSON.parse(s); } catch { return s; } };

/**
 * Runs the pilot. Returns a summary with every tool call, every result (redacted), pictures, token usage and the final answer.
 */
export async function runPilot({ model, task = DEFAULT_TASK, shimPath, endpointFile, outDir, maxTurns = 24, log = console.log, nodeCommand = process.execPath }) {
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error('OPENAI_API_KEY is missing from the environment.'), { code: 'no_key' });
  fs.mkdirSync(outDir, { recursive: true });
  const transcript = fs.createWriteStream(path.join(outDir, 'transcript.jsonl'), { flags: 'a' });
  const write = (entry) => transcript.write(JSON.stringify(redact({ t: new Date().toISOString(), ...entry })) + '\n');
  let previewsDone = 0;
  const calls = [];
  const images = [];

  const server = new MCPServerStdio({
    name: 'noema-fractal', command: nodeCommand, args: [shimPath], env: shimEnvironment(endpointFile),
    cacheToolsList: false, clientSessionTimeoutSeconds: 240,
    // a hard bound, not a request: after one preview the tool is gone from the model's list
    toolFilter: async (_ctx, tool) => !(tool.name === 'noema_render_preview' && previewsDone >= 1),
  });
  const agent = new Agent({ name: 'NOEMA art assistant', instructions: INSTRUCTIONS, model, mcpServers: [server], modelSettings: { parallelToolCalls: false, reasoning: { effort: 'low' } } });

  await server.connect();
  const started = Date.now();
  let stream;
  try {
    write({ kind: 'start', model, tools: (await server.listTools()).map((t) => t.name), task });
    stream = await run(agent, task, { stream: true, maxTurns });
    const pending = new Map();
    for await (const event of stream) {
      if (event.type !== 'run_item_stream_event') continue;
      const raw = event.item.rawItem ?? {};
      if (event.name === 'tool_called') {
        const entry = { n: calls.length + 1, name: raw.name, args: parseMaybe(raw.arguments), callId: raw.callId ?? raw.id, at: Date.now() - started };
        calls.push(entry); pending.set(entry.callId, entry);
        log(`  → ${entry.name} ${JSON.stringify(redact(entry.args)).slice(0, 220)}`);
        write({ kind: 'tool_call', ...entry });
      } else if (event.name === 'tool_output') {
        const out = event.item.output ?? raw.output;
        const found = uniqueImages(collectImages(out).concat(collectImages(raw.output)));
        const entry = pending.get(raw.callId) ?? calls.at(-1) ?? {};
        if (entry.name === 'noema_render_preview') previewsDone++;
        found.forEach((img, i) => { const file = `preview-${images.length + 1}.${img.mime.endsWith('png') ? 'png' : 'jpg'}`; fs.writeFileSync(path.join(outDir, file), Buffer.from(img.base64, 'base64')); images.push({ file, mime: img.mime, bytes: Buffer.byteLength(img.base64, 'base64'), forCall: entry.n }); });
        entry.resultMs = Date.now() - started; entry.images = found.length;
        write({ kind: 'tool_output', n: entry.n, name: entry.name, output: out, images: found.length });
        log(`  ← ${entry.name} ${found.length ? `[${found.length} bild]` : ''} ${JSON.stringify(redact(out)).slice(0, 160)}`);
      } else if (event.name === 'message_output_created') {
        write({ kind: 'message', text: raw.content });
      } else if (event.name === 'reasoning_item_created') write({ kind: 'reasoning' });
    }
    await stream.completed;
  } finally {
    await server.close().catch(() => {});
    transcript.end();
  }

  const usage = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const r of stream.rawResponses ?? []) { const u = r.usage ?? {}; usage.requests++; usage.inputTokens += u.inputTokens ?? 0; usage.outputTokens += u.outputTokens ?? 0; usage.totalTokens += u.totalTokens ?? ((u.inputTokens ?? 0) + (u.outputTokens ?? 0)); }
  const summary = { model, ms: Date.now() - started, toolCalls: calls.map(({ n, name, args, images: im }) => ({ n, name, args: redact(args), images: im ?? 0 })), previewsRequested: previewsDone, images, usage, finalOutput: stream.finalOutput };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(redact(summary), null, 2));
  return summary;
}

export function estimateCost(usage, perMillion) {
  if (!perMillion) return null;
  return (usage.inputTokens * perMillion.input + usage.outputTokens * perMillion.output) / 1_000_000;
}
