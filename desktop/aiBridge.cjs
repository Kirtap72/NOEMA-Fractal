'use strict';
/**
 * Electron side of the AI bridge (MCP-01): the glue between the local pipe (aiBridgeCore.cjs) and the application service that
 * lives in the window. Off until the artist switches it on in the "AI bridge" panel; only the trusted main frame can switch it on,
 * off, or answer a request (the `handle` helper of main.cjs checks that).
 *
 * Flow of one call: MCP shim -> pipe (token) -> dispatch() -> `noema:ai-request` to the window -> AppService -> `noema:ai-respond`.
 */
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createBridge } = require('./aiBridgeCore.cjs');
const { createDraftDisk } = require('./aiDrafts.cjs');
const { createExperimentStore } = require('./knowledge.cjs');

function install({ app, handle, getWindow, dir }) {
  let registered = false;
  const pending = new Map();
  const send = (channel, payload) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, payload); };

  const dispatch = (op, args, signal) => new Promise((resolve) => {
    const w = getWindow();
    if (!registered || !w || w.isDestroyed()) return resolve({ ok: false, code: 'app_not_ready', message: 'NOEMA Fractal is not ready yet.' });
    const id = randomUUID();
    const done = (result) => { pending.delete(id); resolve(result); };
    pending.set(id, done);
    signal.addEventListener('abort', () => { if (pending.has(id)) { done({ ok: false, code: 'cancelled', message: 'Cancelled.' }); send('noema:ai-cancel', { id }); } }, { once: true });
    send('noema:ai-request', { id, op, args });
  });

  let status;
  const bridge = createBridge({ dir, dispatch, onChange: () => send('noema:ai-state', status()) });
  const shimPath = path.resolve(__dirname, '../tools/noema-mcp/server.mjs');
  status = () => ({ ...bridge.status(), registered, shimPath: fs.existsSync(shimPath) ? shimPath : null });

  // MCP-02: persistent drafts. Plain strings in and out; the main process validates ids and sizes and writes atomically.
  const drafts = createDraftDisk({ dir: path.join(dir, 'drafts') });
  handle('ai-drafts-save', (id, text) => drafts.save(id, text));
  handle('ai-drafts-list', () => drafts.list());
  handle('ai-drafts-remove', (id) => drafts.remove(id));
  // FORMULA-EXPLORATION-01: the experiment memory (compact records, local only).
  const experiments = createExperimentStore({ dir: path.join(dir, 'knowledge') });
  handle('ai-knowledge-list', () => experiments.list());
  handle('ai-knowledge-append', (text) => experiments.append(text));
  handle('ai-register', () => { registered = true; return status(); });
  handle('ai-status', () => status());
  handle('ai-enable', async () => { if (!registered) throw Error('The service in the window is not ready.'); await bridge.start(); return status(); });
  handle('ai-disable', async () => { await bridge.stop(); return status(); });
  handle('ai-respond', (id, result) => {
    const done = typeof id === 'string' ? pending.get(id) : undefined;
    if (!done) return false;
    done(result && typeof result === 'object' && typeof result.ok === 'boolean' ? result : { ok: false, code: 'internal_error', message: 'Invalid response from the app.' });
    return true;
  });

  // The window's state (drafts, the service) is gone when it reloads or crashes: switch the bridge off with it.
  const w = getWindow();
  const reset = () => { registered = false; for (const done of [...pending.values()]) done({ ok: false, code: 'app_not_ready', message: 'The window was restarted.' }); void bridge.stop(); };
  w?.webContents.on('did-start-loading', reset);
  w?.webContents.on('render-process-gone', reset);
  // The endpoint file (with the token) must not outlive the app.
  app.on('will-quit', () => { bridge.shutdownSync(); });
  // Test hook for automated Electron checks only: honoured solely with --noema-test-profile, never in a normal run.
  let testEndpoints;
  if (process.argv.some((a) => a.startsWith('--noema-test-profile=')) && process.env.NOEMA_AI_TEST_ENDPOINTS) { try { testEndpoints = JSON.parse(process.env.NOEMA_AI_TEST_ENDPOINTS); } catch { /* ignored */ } }
  let credentials;
  try { credentials = require('./credentials.cjs').createCredentialStore({ dir: path.join(dir, '..', 'credentials'), safeStorage: require('electron').safeStorage }); } catch { credentials = undefined; }
  require('./aiChat.cjs').install({ handle, getWindow, bridge, bridgeStatus: status, dir, testEndpoints, credentials });
  return { bridge, status, drafts, credentials };
}

module.exports = { install };
