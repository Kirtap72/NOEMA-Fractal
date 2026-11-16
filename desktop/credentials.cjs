'use strict';
/**
 * API keys for the AI providers, stored with the operating system's own protection: Electron `safeStorage`, which on Windows uses DPAPI
 * (the key can only be decrypted by the same Windows user on the same computer). Only the ENCRYPTED bytes are written to the profile; no key is ever
 * written in plain text, put in a log, an event, a setting or a project file, or sent to the window (it only learns "stored: yes/no").
 * Lookup order: a key the artist stored here, then the provider's environment variable (OLLAMA_API_KEY / OPENAI_API_KEY).
 */
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./storage.cjs');

const PROVIDERS = { ollama: 'OLLAMA_API_KEY', openai: 'OPENAI_API_KEY' };
const KEY_SHAPE = /^[\x21-\x7e]{8,400}$/; // visible ASCII, no spaces or control characters

function createCredentialStore({ dir, safeStorage, env = process.env }) {
  const file = (p) => path.join(dir, p + '.key');
  const known = (p) => { if (!(p in PROVIDERS)) throw Error('Unknown provider.'); return p; };
  const cache = new Map();
  const available = () => { try { return !!safeStorage?.isEncryptionAvailable?.(); } catch { return false; } };

  /** The key (synchronously, for the engine): stored key first, then the environment variable. Never logged. */
  function get(provider) {
    known(provider);
    if (cache.has(provider)) return cache.get(provider);
    let key;
    try {
      if (available() && fsSync.existsSync(file(provider))) key = safeStorage.decryptString(fsSync.readFileSync(file(provider)));
    } catch { key = undefined; /* damaged or from another Windows account: treated as "not stored" */ }
    if (!key) { const e = env[PROVIDERS[provider]]; key = typeof e === 'string' && e.trim() ? e.trim() : undefined; }
    cache.set(provider, key);
    return key;
  }
  function status(provider) {
    known(provider);
    let stored = false;
    try { stored = available() && fsSync.existsSync(file(provider)) && !!safeStorage.decryptString(fsSync.readFileSync(file(provider))); } catch { stored = false; }
    const fromEnv = !!(typeof env[PROVIDERS[provider]] === 'string' && env[PROVIDERS[provider]].trim());
    return { stored, fromEnv, protectedStorage: available(), envName: PROVIDERS[provider] };
  }
  async function set(provider, key) {
    known(provider);
    if (!available()) throw Error('Windows protected storage (DPAPI) is not available, so the key is not saved. You can instead set the environment variable ' + PROVIDERS[provider] + '.');
    const k = String(key ?? '').trim();
    if (!KEY_SHAPE.test(k)) throw Error('The key does not look right (8–400 visible characters without spaces).');
    await fs.mkdir(dir, { recursive: true });
    await atomicWrite(file(provider), safeStorage.encryptString(k));
    cache.delete(provider);
    return status(provider);
  }
  async function clear(provider) {
    known(provider);
    await fs.rm(file(provider), { force: true });
    cache.delete(provider);
    return status(provider);
  }
  /** An object that looks like process.env for the two key variables, answered from this store (so no other code needs to change). */
  function environment() {
    return new Proxy(env, { get: (t, name) => { for (const [p, v] of Object.entries(PROVIDERS)) if (name === v) return get(p); return t[name]; }, has: (t, name) => Object.values(PROVIDERS).includes(name) || name in t });
  }
  return { get, status, set, clear, environment, PROVIDERS };
}

module.exports = { createCredentialStore, KEY_SHAPE };
