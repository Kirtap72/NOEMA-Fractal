'use strict';
/**
 * Electron side of the in-app AI chat (MCP-02). The chat engine (tools/openai-pilot/chatEngine.mjs) runs HERE, in the main process,
 * because the window has no network access (CSP) and must never see an API key. The window only sends text, a mode, a provider id,
 * a model name and budget numbers, and receives events (text, tool calls, pictures, budget). Keys come from the environment
 * (OLLAMA_API_KEY / OPENAI_API_KEY) and are never written to a file, a log, an event or the window.
 *
 * The engine reaches NOEMA through the same local MCP shim and named pipe as any other AI host, so the AI can only do what the draft
 * tools allow. If the engine files are not part of this installation (a packaged build without tools/), the chat says so and the
 * rest of the application is unaffected.
 */
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { atomicWrite } = require('./storage.cjs');

const MODEL = /^[\w.:\-/]{1,100}$/;
const root = path.resolve(__dirname, '../tools/openai-pilot');

/** Is the graphics card busy with something else? Used only to hide the preview tools for a turn, never to stop anything. */
function createGpuProbe({ run = (cb) => execFile('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true }, cb), now = Date.now } = {}) {
  let cached = { at: -Infinity, busy: false };
  return async function busy() {
    if (now() - cached.at < 4000) return cached.busy;
    const value = await new Promise((resolve) => run((err, out) => {
      if (err) return resolve(false); // no nvidia-smi: nothing to protect, the render path has its own lock and timeout
      const [util, used, total] = String(out).trim().split(/\s*,\s*/).map(Number);
      resolve(Number.isFinite(util) && (util >= 90 || (Number.isFinite(total) && Number.isFinite(used) && total - used < 1500)));
    }));
    cached = { at: now(), busy: value };
    return value;
  };
}

function install({ handle, getWindow, bridge, bridgeStatus, dir, env: baseEnv = process.env, testEndpoints, credentials }) {
  // Keys come from the OS-protected store first (see credentials.cjs), then from the environment. The window never sees one.
  const env = credentials ? credentials.environment() : baseEnv;
  const sessionFile = dir ? path.join(dir, 'chat-session.json') : null;
  const send = (payload) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('noema:ai-chat-event', payload); };
  let lib = null, engine = null, loadError = null;

  async function load() {
    if (lib || loadError) return lib;
    try {
      if (!fs.existsSync(path.join(root, 'chatEngine.mjs')) || !fs.existsSync(path.join(root, 'node_modules'))) throw Error('The chat engine is not included in this installation.');
      const href = (f) => pathToFileURL(path.join(root, f)).href;
      lib = { engine: await import(href('chatEngine.mjs')), providers: await import(href('providers.mjs')), core: await import(href('agentCore.mjs')) };
    } catch (e) { loadError = String(e?.message ?? e).slice(0, 200); }
    return lib;
  }

  const gpuBusy = createGpuProbe();

  async function ensureEngine() {
    const l = await load();
    if (!l) throw Error(loadError ?? 'The chat is not available.');
    if (engine) return engine;
    const shimPath = path.resolve(__dirname, '../tools/noema-mcp/server.mjs');
    if (!fs.existsSync(shimPath)) throw Error('The MCP shim is not included in this installation.');
    engine = l.engine.createChatEngine({
      // evaluated for every message: the pipe may have been restarted
      shim: { command: process.execPath, args: [shimPath], get env() { return l.core.shimEnv(bridge.endpointFile, { electronAsNode: !!process.versions.electron }); } },
      gpuBusy, onEvent: (e) => send(e), env, ...(testEndpoints ? { endpoints: testEndpoints } : {}),
    });
    return engine;
  }

  handle('ai-chat-config', async () => {
    const l = await load();
    if (!l) return { available: false, reason: loadError };
    return {
      available: true,
      providers: Object.values(l.providers.PROVIDERS).map((p) => ({ id: p.id, label: p.label, keyEnv: p.keyEnv, hasKey: !!l.providers.apiKeyFor(p.id, env), costKnown: p.id === 'openai', ...(credentials ? { keyStatus: credentials.status(p.id) } : {}) })),
      recommended: l.providers.RECOMMENDED,
      defaultProvider: l.providers.DEFAULT_PROVIDER,
      modes: Object.entries(l.engine.MODES).map(([id, m]) => ({ id, title: m.title, budget: m.budget, readOnly: !!m.readOnlyUnlessDemo })),
      defaults: l.core.DEFAULT_BUDGET, hardMax: l.core.HARD_MAX_BUDGET,
    };
  });

  handle('ai-chat-models', async (provider) => {
    const l = await load();
    if (!l) throw Error(loadError ?? 'The chat is not available.');
    if (typeof provider !== 'string') throw Error('Invalid provider.');
    try { return await l.providers.listModels(provider, { env }); }
    catch (e) { return { provider, models: l.providers.RECOMMENDED[provider]?.map((id) => ({ id, recommended: true })) ?? [], source: 'default', note: String(e?.message ?? e).slice(0, 160) + ' Shows suggestions.' }; }
  });

  handle('ai-chat-send', async (text, options) => {
    const o = options && typeof options === 'object' ? options : {};
    if (typeof text !== 'string' || text.length > 4000) return { status: 'error', message: 'The message is invalid or too long.' };
    if (typeof o.model !== 'string' || !MODEL.test(o.model)) return { status: 'error', message: 'Choose a model first.' };
    const budget = {};
    if (o.budget && typeof o.budget === 'object') for (const k of ['toolCalls', 'previews', 'seconds', 'costUSD', 'tokens']) if (typeof o.budget[k] === 'number') budget[k] = o.budget[k];
    let eng;
    try { eng = await ensureEngine(); } catch (e) { return { status: 'error', message: String(e?.message ?? e).slice(0, 200) }; }
    const pid = typeof o.provider === 'string' ? o.provider : lib.providers.DEFAULT_PROVIDER, prov = lib.providers.PROVIDERS[pid];
    if (!prov) return { status: 'error', message: 'Unknown provider.' };
    if (!lib.providers.apiKeyFor(pid, env)) return { status: 'no_key', message: `${prov.label} is not turned on: the environment variable ${prov.keyEnv} is missing. Set it (Windows: Settings > Environment variables) and restart NOEMA. The app works without AI.` };
    // Sending a message is the artist's own act, so it also switches the local bridge on (it is the same switch as in the AI-brygga panel).
    try { if (!bridgeStatus().running) await bridge.start(); } catch (e) { return { status: 'error', message: 'The bridge could not be started: ' + String(e?.message ?? e).slice(0, 120) }; }
    // Reference pictures go to the cloud model only with this deliberate send. They are checked again by the engine and never written to disk.
    const images = Array.isArray(o.images) ? o.images.slice(0, 3).map((i) => ({ mime: i?.mime, base64: i?.base64 })) : undefined;
    const result = await eng.send(text, { mode: typeof o.mode === 'string' ? o.mode : 'create', provider: typeof o.provider === 'string' ? o.provider : undefined, model: o.model, budget, images, activeDraftId: typeof o.activeDraftId === 'string' ? o.activeDraftId : undefined, allowDemo: o.allowDemo === true });
    await saveEngineSession();
    return result;
  });
  // ---- connecting a provider: the artist types the key here; it is stored encrypted by Windows and never shown again ------------------------------
  const knownProvider = (p) => { if (typeof p !== 'string' || !credentials || !(p in credentials.PROVIDERS)) throw Error('Unknown provider.'); return p; };
  handle('ai-chat-key-set', async (provider, key) => credentials.set(knownProvider(provider), key));
  handle('ai-chat-key-clear', async (provider) => credentials.clear(knownProvider(provider)));
  /** One tiny authenticated request (a single token) to see that the key and the model work. Costs next to nothing. */
  handle('ai-chat-key-test', async (provider, model) => {
    const l = await load();
    if (!l) throw Error(loadError ?? 'The chat is not available.');
    const prov = l.providers.PROVIDERS[knownProvider(provider)];
    const key = credentials.get(provider);
    if (!key) return { ok: false, message: `No key is connected for ${prov.label}.` };
    if (typeof model !== 'string' || !MODEL.test(model)) return { ok: false, message: 'Choose a model first.' };
    try {
      const base = (testEndpoints && testEndpoints[provider]) || prov.baseURL;
      const res = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the word ok.' }], max_tokens: 8 }), signal: AbortSignal.timeout(30000) });
      if (res.ok) return { ok: true, message: `The connection to ${prov.label} works with the model ${model}.` };
      const why = res.status === 401 || res.status === 403 ? 'The key was not accepted (check that it is right and active).' : res.status === 404 ? 'The model does not exist at the provider.' : res.status === 429 ? 'Too many calls or out of credit.' : `The provider answered ${res.status}.`;
      return { ok: false, message: why };
    } catch (e) { return { ok: false, message: 'No contact with the provider (offline?).' }; }
  });
  handle('ai-chat-cancel', () => { engine?.cancel(); return true; });
  handle('ai-chat-reset', async () => {
    const ok = engine ? engine.reset() : true;
    if (ok && sessionFile) { uiState = null; await fs.promises.rm(sessionFile, { force: true }).catch(() => {}); }
    return ok;
  });

  // ---- the creative session survives a restart: the readable chat, the settings and the model's conversation (never any picture) -----------
  let uiState = null;
  const MAX_UI_BYTES = 2 * 1024 * 1024;
  function cleanUi(u) {
    if (!u || typeof u !== 'object') return null;
    const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
    const log = Array.isArray(u.log) ? u.log.slice(-200).filter((e) => e && ['user', 'ai', 'system', 'tool'].includes(e.who) && typeof e.text === 'string').map((e) => ({ who: e.who, text: e.text.slice(0, 4000) })) : [];
    const draft = typeof u.activeDraftId === 'string' && /^draft-[a-z0-9]{6,32}$/.test(u.activeDraftId) ? u.activeDraftId : undefined;
    return { log, mode: s(u.mode, 20), provider: s(u.provider, 20), model: typeof u.model === 'string' && MODEL.test(u.model) ? u.model : undefined, activeDraftId: draft, lastExplanation: s(u.lastExplanation, 4000) };
  }
  async function saveEngineSession() {
    if (!sessionFile || !uiState) return;
    try {
      const text = JSON.stringify({ format: 'noema-ai-chat-session', version: 1, savedAt: Date.now(), ui: uiState, engine: engine ? engine.exportSession() : null });
      if (text.length > MAX_UI_BYTES * 4) return;
      await fs.promises.mkdir(path.dirname(sessionFile), { recursive: true });
      await atomicWrite(sessionFile, text);
    } catch { /* losing a chat log must never disturb the work */ }
  }
  handle('ai-chat-session-save', async (ui) => { const c = cleanUi(ui); if (!c) return false; uiState = c; await saveEngineSession(); return true; });
  handle('ai-chat-session-load', async () => {
    if (!sessionFile) return null;
    try {
      const raw = JSON.parse(await fs.promises.readFile(sessionFile, 'utf8'));
      if (raw?.format !== 'noema-ai-chat-session' || raw.version !== 1) return null;
      const ui = cleanUi(raw.ui);
      if (!ui) return null;
      uiState = ui;
      let engineRestored = false;
      if (raw.engine) { try { engineRestored = (await ensureEngine()).importSession(raw.engine); } catch { /* the readable log is still shown */ } }
      return { ui, engineRestored, savedAt: raw.savedAt };
    } catch (e) { return e?.code === 'ENOENT' ? null : null; }
  });
  handle('ai-chat-state', () => (engine ? engine.state() : { running: false, turns: 0, historyItems: 0 }));
  return { createGpuProbe };
}

module.exports = { install, createGpuProbe };
