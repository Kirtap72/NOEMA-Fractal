'use strict';
/**
 * The local AI bridge transport (MCP-01). No Electron here, so it can be tested directly.
 *
 * - A named pipe on Windows (a Unix socket elsewhere) carries newline-delimited JSON frames: {v:1,id,token,op,args} -> {id,ok,...}.
 * - Authentication is a random token (>=128 bit) written to <dir>/endpoint.json when the bridge is switched on and removed when it
 *   is switched off. MCP is stateless, so EVERY frame carries the token. The default permissions of a Windows pipe let other
 *   accounts connect, so the token (not the pipe) is the authentication.
 * - Frames, in-flight calls, time and bad-token attempts are limited here, in addition to the limits inside the app service.
 * - Nothing is listened on unless start() is called. stop() closes everything and deletes the endpoint file.
 */
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_FRAME_BYTES = 262144;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const MAX_IN_FLIGHT = 4;
const DEFAULT_TIMEOUT_MS = 30000;
const SLOW_TIMEOUT_MS = 200000;
const MAX_BAD_TOKENS = 5;
const LOCK_MS = 30000;
const PROTOCOL = 'noema-ai-bridge/1';

const digest = (text) => crypto.createHash('sha256').update(String(text)).digest();
const sameToken = (given, expected) => typeof given === 'string' && crypto.timingSafeEqual(digest(given), digest(expected));

function createBridge({ dir, dispatch, onChange = () => {}, timeouts = {}, now = () => Date.now(), tokenBytes = 24 }) {
  const defaultTimeout = timeouts.default ?? DEFAULT_TIMEOUT_MS;
  const slowTimeout = timeouts.slow ?? SLOW_TIMEOUT_MS;
  const endpointFile = path.join(dir, 'endpoint.json');
  let server = null, token = null, pipe = null, lockedUntil = 0, failures = [];
  const connections = new Set();

  const status = () => ({ running: server !== null, endpointFile, connections: connections.size, protocol: PROTOCOL });
  const changed = () => { try { onChange(status()); } catch { /* UI errors never stop the bridge */ } };

  function handleConnection(socket) {
    connections.add(socket);
    changed();
    let buffer = '';
    let inFlight = 0;
    const aborts = new Set();
    const send = (obj) => {
      if (socket.destroyed) return;
      const text = JSON.stringify(obj);
      socket.write(Buffer.byteLength(text) > MAX_RESPONSE_BYTES ? JSON.stringify({ id: obj.id, ok: false, code: 'response_too_large', message: 'The response became too large.' }) + '\n' : text + '\n');
    };
    // end() flushes the answer before closing; destroy() could drop it.
    const reject = (id, code, message, close = false) => { if (close) { if (!socket.destroyed) socket.end(JSON.stringify({ id, ok: false, code, message }) + '\n'); } else send({ id, ok: false, code, message }); };

    async function onFrame(line) {
      let frame;
      try { frame = JSON.parse(line); } catch { return reject(null, 'bad_frame', 'Invalid JSON.', true); }
      const id = typeof frame?.id === 'string' && frame.id.length <= 64 ? frame.id : null;
      if (!frame || typeof frame !== 'object' || frame.v !== 1 || id === null || typeof frame.op !== 'string' || frame.op.length > 64 || (frame.args !== undefined && (typeof frame.args !== 'object' || frame.args === null || Array.isArray(frame.args)))) {
        return reject(id, 'bad_frame', 'Invalid frame.', true);
      }
      if (now() < lockedUntil) return reject(id, 'locked', 'Too many incorrect attempts. The bridge is locked for a while.', true);
      if (token === null || !sameToken(frame.token, token)) {
        failures = failures.filter((t) => now() - t < 60000);
        failures.push(now());
        if (failures.length >= MAX_BAD_TOKENS) { lockedUntil = now() + LOCK_MS; failures = []; }
        return reject(id, 'unauthorized', 'Wrong or missing token.', true);
      }
      if (inFlight >= MAX_IN_FLIGHT) return reject(id, 'busy', 'Too many ongoing calls on this connection.');
      inFlight++;
      const controller = new AbortController();
      aborts.add(controller);
      const limit = frame.op === 'render.preview' ? slowTimeout : defaultTimeout;
      const timer = setTimeout(() => controller.abort(), limit);
      try {
        const result = await Promise.race([
          Promise.resolve(dispatch(frame.op, frame.args ?? {}, controller.signal)),
          new Promise((resolve) => controller.signal.addEventListener('abort', () => resolve({ ok: false, code: 'cancelled', message: 'Cancelled or too slow.' }))),
        ]);
        send({ id, ...(result && typeof result === 'object' ? result : { ok: false, code: 'internal_error', message: 'Empty response.' }) });
      } catch {
        send({ id, ok: false, code: 'internal_error', message: 'An internal error occurred.' });
      } finally {
        clearTimeout(timer);
        aborts.delete(controller);
        inFlight--;
      }
    }

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_FRAME_BYTES && !buffer.includes('\n')) return reject(null, 'frame_too_large', 'The frame is too large.', true);
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.length > MAX_FRAME_BYTES) return reject(null, 'frame_too_large', 'The frame is too large.', true);
        if (line.trim()) void onFrame(line);
      }
    });
    const gone = () => { for (const c of aborts) c.abort(); connections.delete(socket); changed(); };
    socket.on('close', gone);
    socket.on('error', () => socket.destroy());
  }

  async function start() {
    if (server) return status();
    await fs.mkdir(dir, { recursive: true });
    token = crypto.randomBytes(tokenBytes).toString('hex');
    pipe = process.platform === 'win32' ? '\\\\.\\pipe\\noema-ai-' + crypto.randomBytes(8).toString('hex') : path.join(dir, 'bridge.sock');
    if (process.platform !== 'win32') await fs.rm(pipe, { force: true });
    server = net.createServer(handleConnection);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
    const tmp = endpointFile + '.tmp';
    await fs.writeFile(tmp, JSON.stringify({ version: 1, protocol: PROTOCOL, pipe, token, pid: process.pid, createdAt: new Date(now()).toISOString() }), { mode: 0o600 });
    await fs.rename(tmp, endpointFile);
    changed();
    return status();
  }

  async function stop() {
    const s = server;
    server = null;
    token = null;
    for (const c of connections) c.destroy();
    connections.clear();
    if (s) await new Promise((resolve) => s.close(resolve));
    await fs.rm(endpointFile, { force: true });
    await fs.rm(endpointFile + '.tmp', { force: true });
    if (process.platform !== 'win32' && pipe) await fs.rm(pipe, { force: true });
    pipe = null;
    changed();
  }

  /** Last-resort synchronous cleanup for process exit: closes the pipe and removes the endpoint file (token). */
  function shutdownSync() {
    try { server?.close(); } catch { /* already closed */ }
    server = null; token = null;
    for (const c of connections) c.destroy();
    connections.clear();
    try { require('node:fs').rmSync(endpointFile, { force: true }); require('node:fs').rmSync(endpointFile + '.tmp', { force: true }); } catch { /* best effort */ }
    if (process.platform !== 'win32' && pipe) { try { require('node:fs').rmSync(pipe, { force: true }); } catch { /* best effort */ } }
  }

  return { start, stop, status, endpointFile, shutdownSync };
}

module.exports = { createBridge, PROTOCOL, MAX_FRAME_BYTES, MAX_IN_FLIGHT };
