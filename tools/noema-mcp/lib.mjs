// NOEMA MCP shim, shared helpers. No business logic: the shim only turns MCP tool calls into frames for the running app and back.
// stdout belongs to the MCP protocol; everything diagnostic goes to stderr.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The authoritative capability manifest. NOEMA_MANIFEST overrides the location (for a packaged shim). */
export function loadManifest(file = process.env.NOEMA_MANIFEST ?? path.resolve(here, '../../src/capabilities/manifest.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Where the app writes its endpoint (pipe name + token) while the AI bridge is switched on. */
export function endpointPath(env = process.env) {
  if (env.NOEMA_AI_ENDPOINT) return env.NOEMA_AI_ENDPOINT;
  const appData = env.APPDATA ?? path.join(os.homedir(), '.config');
  return path.join(appData, 'NOEMA Fractal', 'ai-bridge', 'endpoint.json');
}

const OFF = { ok: false, code: 'bridge_off', message: 'The AI bridge in NOEMA Fractal is turned off or the app is not running. Ask the artist to open NOEMA Fractal and turn on "AI bridge" (the AI bridge panel), and try again.' };

/** One request/response over the pipe. The endpoint file is read for every call: MCP is stateless and the token changes on every start. */
export function callApp(op, args, { signal, file = endpointPath(), timeoutMs } = {}) {
  return new Promise((resolve) => {
    let endpoint;
    try { endpoint = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return resolve(OFF); }
    if (!endpoint?.pipe || !endpoint?.token) return resolve(OFF);
    const limit = timeoutMs ?? (op === 'render.preview' ? 210_000 : 35_000);
    const id = 'c' + Math.random().toString(36).slice(2, 12);
    const socket = net.connect(endpoint.pipe);
    socket.setEncoding('utf8');
    let buffer = '', done = false;
    const finish = (value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); socket.destroy(); resolve(value); };
    const timer = setTimeout(() => finish({ ok: false, code: 'timeout', message: 'NOEMA did not answer in time.' }), limit);
    const onAbort = () => finish({ ok: false, code: 'cancelled', message: 'Avbrutet.' });
    signal?.addEventListener('abort', onAbort);
    socket.on('connect', () => socket.write(JSON.stringify({ v: 1, id, token: endpoint.token, op, args: args ?? {} }) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try { const reply = JSON.parse(buffer.slice(0, nl)); finish(reply.id === id || reply.id === null ? reply : { ok: false, code: 'bad_reply', message: 'Unexpected answer from NOEMA.' }); } catch { finish({ ok: false, code: 'bad_reply', message: 'Unreadable answer from NOEMA.' }); }
    });
    socket.on('error', () => finish(OFF));
    socket.on('close', () => finish({ ok: false, code: 'closed', message: 'NOEMA closed the connection.' }));
  });
}

/** Turns an app answer into an MCP tool result. Errors are tool errors (isError) so the model can read and correct them. */
export function toToolResult(reply) {
  if (reply?.ok) {
    const content = [{ type: 'text', text: JSON.stringify(reply.data, null, 2) }];
    if (reply.image?.base64) content.push({ type: 'image', data: reply.image.base64, mimeType: reply.image.mime ?? 'image/png' });
    return { content, structuredContent: reply.data };
  }
  const error = { code: String(reply?.code ?? 'error'), message: String(reply?.message ?? 'Unknown error') };
  return { isError: true, content: [{ type: 'text', text: `${error.code}: ${error.message}` }], structuredContent: { error } };
}

/** The tools to advertise: only operations marked implemented, in deterministic order (sorted by tool name). */
export function implementedTools(manifest) {
  return manifest.operations.filter((o) => o.status === 'implemented').sort((a, b) => (a.mcpTool < b.mcpTool ? -1 : a.mcpTool > b.mcpTool ? 1 : 0));
}
