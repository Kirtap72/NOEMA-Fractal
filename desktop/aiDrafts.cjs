'use strict';
/**
 * Disk side of the persistent AI drafts (MCP-02). One JSON file per draft in <profile>/ai-bridge/drafts/.
 *
 * - Every write is atomic (temporary file, fsync, rename: the same routine the artwork library uses). A crash or power loss therefore
 *   leaves either the old file or the new one, never half of each. The previous good version is kept as <id>.prev.json.
 * - Reading never throws away data: a file that cannot be read is moved to <id>.corrupt.<time>.json and reported, and the previous
 *   version is tried first. Leftover temporary files from an interrupted write are removed.
 * - Discarding is permanent for the artist, but the last few discarded drafts are kept in discarded/ in case of a misclick.
 * - Nothing here ever touches the artist's library, scenes or thumbnails. Reading a draft back applies nothing.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./storage.cjs');

const ID = /^draft-[a-z0-9]{6,32}$/;
const MAX_BYTES = 96 * 1024 * 1024;
const MAX_FILES = 60;
const KEEP_DISCARDED = 5;
const STALE_TMP_MS = 60_000;

const validId = (id) => { if (typeof id !== 'string' || !ID.test(id)) throw Error('Invalid draft id.'); return id; };

function createDraftDisk({ dir, write = atomicWrite, now = () => Date.now() }) {
  const file = (id) => path.join(dir, validId(id) + '.json');
  const prev = (id) => path.join(dir, validId(id) + '.prev.json');
  const discardedDir = path.join(dir, 'discarded');

  async function names() { try { return await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }

  async function save(id, text) {
    validId(id);
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw Error('The draft is too large to save.');
    JSON.parse(text); // an unparseable text must never replace a good file
    const existing = (await names()).filter((n) => /^draft-[a-z0-9]{6,32}\.json$/.test(n));
    if (!existing.includes(validId(id) + '.json') && existing.length >= MAX_FILES) throw Error(`At most ${MAX_FILES} saved drafts. Discard some first.`);
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(file(id), prev(id)).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    await write(file(id), text);
    return true;
  }

  async function readJson(p) { const text = await fs.readFile(p, 'utf8'); JSON.parse(text); return text; }

  async function list() {
    const drafts = [], problems = [];
    for (const n of await names()) {
      if (/\.tmp$/.test(n)) { // an interrupted write: remove it once it is clearly not in progress
        const p = path.join(dir, n); const st = await fs.stat(p).catch(() => null);
        if (st && now() - st.mtimeMs > STALE_TMP_MS) await fs.rm(p, { force: true }).catch(() => {});
        continue;
      }
      const m = /^(draft-[a-z0-9]{6,32})\.json$/.exec(n);
      if (!m) continue;
      const id = m[1];
      try { drafts.push(await readJson(file(id))); continue; } catch (e) { var firstError = e; }
      try { const text = await readJson(prev(id)); drafts.push(text); problems.push({ id, reason: 'The latest file was damaged; the previous version was restored.' }); await fs.rename(file(id), path.join(dir, `${id}.corrupt.${now()}.json`)).catch(() => {}); await write(file(id), text); continue; }
      catch { problems.push({ id, reason: 'The draft file could not be read (' + String(firstError?.code ?? 'invalid JSON') + '). It was saved as a .corrupt file.' }); }
      await fs.rename(file(id), path.join(dir, `${id}.corrupt.${now()}.json`)).catch(() => {});
    }
    return { drafts, problems };
  }

  async function remove(id) {
    validId(id);
    await fs.mkdir(discardedDir, { recursive: true });
    try { await fs.rename(file(id), path.join(discardedDir, `${id}.${now()}.json`)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await fs.rm(prev(id), { force: true });
    const old = (await fs.readdir(discardedDir).catch(() => [])).filter((n) => n.endsWith('.json')).sort();
    for (const n of old.slice(0, Math.max(0, old.length - KEEP_DISCARDED))) await fs.rm(path.join(discardedDir, n), { force: true });
    return true;
  }

  return { save, list, remove, dir };
}

module.exports = { createDraftDisk, MAX_BYTES, MAX_FILES };
