'use strict';
/**
 * Poly Haven (https://polyhaven.com) for NOEMA: browse the public texture catalogue, show previews, download the PBR maps of a chosen
 * material once, keep them in a local cache so they can be reused offline, and hand them to the window as data addresses.
 *
 * Runs in the main process (the window has no network access). Everything remote is treated as UNTRUSTED DATA:
 *  - only the official hosts below are ever contacted, only over HTTPS, and a download URL must sit under the expected path for that asset;
 *  - ids, resolutions and map names are validated against fixed patterns/lists; names and author text are cleaned and shortened;
 *  - every request has a timeout, every body a hard size limit, downloads are checked against the MD5 the API publishes, written atomically,
 *    and confined to the cache folder (no path ever comes from the network);
 *  - the cache has a size limit; nothing is deleted without being asked.
 * The API is used as documented at https://api.polyhaven.com (identify the app with a User-Agent; assets are CC0). The app shows
 * "Powered by Poly Haven". Nothing about the artist (scenes, prompts, pictures, keys) is ever sent.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomicWrite } = require('./storage.cjs');

const API = 'https://api.polyhaven.com';
const HOSTS = new Set(['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.com']);
const USER_AGENT = 'NOEMA-Fractal/0.1 (private artist build; shows "Powered by Poly Haven" with source and CC0 license)';
const ID = /^[a-z0-9_]{2,80}$/;
const RESOLUTIONS = ['1k', '2k', '4k'];
/** NOEMA channel <- Poly Haven file key. Others (displacement, arm, blend, gltf, ...) are never downloaded. */
const MAPS = { baseColor: 'Diffuse', roughness: 'Rough', metallic: 'Metal', ao: 'AO', normal: 'nor_gl' };
const LIMITS = { catalogBytes: 20 * 1024 * 1024, jsonBytes: 2 * 1024 * 1024, thumbBytes: 1024 * 1024, mapBytes: 12 * 1024 * 1024, cacheBytes: 1536 * 1024 * 1024, timeoutMs: 30_000, mapTimeoutMs: 120_000, catalogMaxAgeMs: 24 * 3600 * 1000 };

const clean = (v, n = 120) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const validId = (id) => { if (typeof id !== 'string' || !ID.test(id)) throw Error('Invalid Poly Haven id.'); return id; };
const validRes = (r) => { if (!RESOLUTIONS.includes(r)) throw Error('Invalid resolution (1k, 2k or 4k).'); return r; };

/** Only the official hosts over https, and (when a prefix is given) only below that path. */
function safeUrl(u, prefix) {
  let url;
  try { url = new URL(String(u)); } catch { throw Error('Invalid address from Poly Haven.'); }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password) throw Error('The address is not an official Poly Haven address over https.');
  if (prefix && !url.pathname.startsWith(prefix)) throw Error('The address is not where it should be for this material.');
  return url;
}

function createPolyHaven({ dir, fetchImpl = fetch, now = () => Date.now(), onProgress = () => {}, limits: override = {} }) {
  const limits = { ...LIMITS, ...override }; // per instance: nothing shared is ever modified
  const file = (...p) => path.join(dir, ...p);
  const matDir = (id, res) => file('materials', validId(id), validRes(res));
  let busy = false;

  /** GET with timeout and a hard size limit (the body is read in pieces and cut off, never buffered unbounded). */
  async function get(url, { maxBytes, timeoutMs = limits.timeoutMs, signal } = {}) {
    const res = await fetchImpl(url.href, { headers: { 'user-agent': USER_AGENT, accept: '*/*' }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw Object.assign(Error(`Poly Haven svarade ${res.status}.`), { code: 'http_' + res.status });
    const declared = Number(res.headers?.get?.('content-length') ?? 0);
    if (declared > maxBytes) throw Error('The file is larger than allowed.');
    const chunks = []; let total = 0;
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maxBytes) { try { await reader.cancel(); } catch { /* already closed */ } throw Error('The file is larger than allowed.'); } chunks.push(Buffer.from(value)); }
    } else { const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > maxBytes) throw Error('The file is larger than allowed.'); chunks.push(buf); }
    return Buffer.concat(chunks);
  }
  const getJson = async (url, o) => JSON.parse((await get(url, { maxBytes: limits.jsonBytes, ...o })).toString('utf8'));
  const readJson = async (p) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } };

  // ---- catalogue -------------------------------------------------------------------------------------------------------------------------
  let catalogMemo = null;
  async function catalog({ signal } = {}) {
    if (catalogMemo && now() - catalogMemo.at < 10 * 60 * 1000) return catalogMemo;
    const cached = await readJson(file('catalog.json'));
    if (cached && Array.isArray(cached.items) && now() - cached.at < limits.catalogMaxAgeMs) return (catalogMemo = { ...cached, offline: false });
    try {
      const raw = JSON.parse((await get(safeUrl(API + '/assets?t=textures', '/assets'), { maxBytes: limits.catalogBytes, signal })).toString('utf8'));
      const items = Object.entries(raw).filter(([id, a]) => ID.test(id) && a && typeof a === 'object').map(([id, a]) => ({
        id, name: clean(a.name || id), categories: (Array.isArray(a.categories) ? a.categories : []).map((c) => clean(c, 40)).filter(Boolean).slice(0, 12),
        tags: (Array.isArray(a.tags) ? a.tags : []).map((c) => clean(c, 40)).filter(Boolean).slice(0, 16),
        authors: Object.keys(a.authors && typeof a.authors === 'object' ? a.authors : {}).map((n) => clean(n, 60)).filter(Boolean).slice(0, 6),
        maxResolution: Array.isArray(a.max_resolution) && Number.isFinite(a.max_resolution[0]) ? Math.round(a.max_resolution[0]) : null,
      })).sort((x, y) => x.name.localeCompare(y.name, 'en'));
      const out = { at: now(), items };
      await fs.mkdir(dir, { recursive: true });
      await atomicWrite(file('catalog.json'), JSON.stringify(out));
      return (catalogMemo = { ...out, offline: false });
    } catch (e) {
      if (cached && Array.isArray(cached.items)) return (catalogMemo = { ...cached, offline: true, note: 'The catalogue could not be updated (offline?). The saved catalogue is shown.' });
      throw Object.assign(Error('The Poly Haven catalogue could not be fetched and no saved catalogue exists (offline?). Materials already fetched remain.'), { code: 'offline' });
    }
  }

  async function downloaded() {
    const out = new Map();
    let ids = [];
    try { ids = await fs.readdir(file('materials')); } catch { return out; }
    for (const id of ids) { if (!ID.test(id)) continue; try { const have = (await fs.readdir(file('materials', id))).filter((r) => RESOLUTIONS.includes(r)); if (have.length) out.set(id, have); } catch { /* skip */ } }
    return out;
  }

  async function page({ query = '', category = '', offset = 0, limit = 24, signal } = {}) {
    const cat = await catalog({ signal });
    const words = clean(query, 80).toLowerCase().split(' ').filter(Boolean);
    const have = await downloaded();
    let items = cat.items.filter((a) => (!category || a.categories.includes(category)) && words.every((w) => `${a.name} ${a.id} ${a.tags.join(' ')} ${a.categories.join(' ')}`.toLowerCase().includes(w)));
    const total = items.length;
    const lim = Math.max(1, Math.min(60, Math.floor(Number(limit)) || 24)), off = Math.max(0, Math.floor(Number(offset)) || 0);
    items = items.slice(off, off + lim).map((a) => ({ ...a, downloaded: have.get(a.id) ?? [] }));
    const categories = [...new Set(cat.items.flatMap((a) => a.categories))].sort();
    return { total, items, categories, offline: !!cat.offline, ...(cat.note ? { note: cat.note } : {}), fetchedAt: cat.at };
  }

  // ---- previews --------------------------------------------------------------------------------------------------------------------------
  /** The picture type by its first bytes (the server sometimes sends WebP for a ".png" address). Anything else is refused. */
  const imageMime = (b) => (b.length >= 12 && b.readUInt32BE(0) === 0x89504e47 ? 'image/png' : b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : null);
  async function thumbnail(id, { signal } = {}) {
    validId(id);
    const p = file('thumbs', id + '.img');
    try { const cached = await fs.readFile(p); const m = imageMime(cached); if (m) return `data:${m};base64,` + cached.toString('base64'); } catch { /* not cached yet */ }
    const bytes = await get(safeUrl(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`, '/asset_img/thumbs/'), { maxBytes: limits.thumbBytes, signal });
    const mime = imageMime(bytes);
    if (!mime) throw Error('The preview is not a picture (PNG, JPEG or WebP).');
    await fs.mkdir(file('thumbs'), { recursive: true });
    await atomicWrite(p, bytes);
    return `data:${mime};base64,` + bytes.toString('base64');
  }

  // ---- details ---------------------------------------------------------------------------------------------------------------------------
  async function filesOf(id, { signal } = {}) { return getJson(safeUrl(`${API}/files/${validId(id)}`, '/files/'), { signal }); }
  /** What the material really offers, per NOEMA channel and resolution (never assumed), plus its credit and licence. */
  async function details(id, { signal } = {}) {
    validId(id);
    const [info, files] = await Promise.all([getJson(safeUrl(`${API}/info/${id}`, '/info/'), { signal }), filesOf(id, { signal })]);
    const channels = {};
    for (const [channel, key] of Object.entries(MAPS)) {
      const entry = files?.[key];
      channels[channel] = entry && typeof entry === 'object' ? RESOLUTIONS.filter((r) => entry[r]?.jpg?.url).map((r) => ({ resolution: r, bytes: Number(entry[r].jpg.size) || null })) : [];
    }
    channels.displacement = files?.Displacement && typeof files.Displacement === 'object' ? ['available'] : [];
    const authors = Object.entries(info?.authors && typeof info.authors === 'object' ? info.authors : {}).map(([name, role]) => ({ name: clean(name, 60), role: clean(role, 40) })).slice(0, 8);
    return { id, name: clean(info?.name || id), authors, categories: (Array.isArray(info?.categories) ? info.categories : []).map((c) => clean(c, 40)).slice(0, 12), tags: (Array.isArray(info?.tags) ? info.tags : []).map((c) => clean(c, 40)).slice(0, 16),
      license: 'CC0', url: `https://polyhaven.com/a/${id}`, filesHash: clean(info?.files_hash, 64), channels, cached: (await downloaded()).get(id) ?? [] };
  }

  // ---- download ---------------------------------------------------------------------------------------------------------------------------
  async function cacheSize() {
    let total = 0;
    const walk = async (d) => { let list; try { list = await fs.readdir(d, { withFileTypes: true }); } catch { return; } for (const e of list) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else total += (await fs.stat(p).catch(() => ({ size: 0 }))).size; } };
    await walk(dir);
    return total;
  }

  /** Downloads the supported maps of one material at one resolution (skipping files already in the cache). Returns what is now available. */
  async function download(id, res = '1k', { signal } = {}) {
    validId(id); validRes(res);
    if (busy) throw Error('A download is already in progress. Wait until it is finished.');
    busy = true;
    try {
      const existing = await readJson(path.join(matDir(id, res), 'meta.json'));
      const [info, files] = await Promise.all([getJson(safeUrl(`${API}/info/${id}`, '/info/'), { signal }), filesOf(id, { signal })]);
      const want = Object.entries(MAPS).map(([channel, key]) => ({ channel, key, entry: files?.[key]?.[res]?.jpg })).filter((m) => m.entry?.url);
      if (!want.some((m) => m.channel === 'baseColor')) throw Error(`The material lacks a colour map in ${res} (jpg).`);
      const before = await cacheSize();
      const need = want.filter((m) => !existing?.maps?.[m.channel]).reduce((n, m) => n + (Number(m.entry.size) || 0), 0);
      if (before + need > limits.cacheBytes) throw Error('The Poly Haven cache would become larger than the limit (1.5 GB). Clear old materials first.');
      await fs.mkdir(matDir(id, res), { recursive: true });
      const maps = { ...(existing?.maps ?? {}) };
      let done = 0;
      for (const m of want) {
        onProgress({ id, step: done, steps: want.length, channel: m.channel });
        if (maps[m.channel]) { done++; continue; }
        const url = safeUrl(m.entry.url, `/file/ph-assets/Textures/jpg/${res}/${id}/`);
        const size = Number(m.entry.size) || 0;
        if (size > limits.mapBytes) throw Error(`The map ${m.channel} is ${(size / 1048576).toFixed(1)} MB, over the limit ${limits.mapBytes / 1048576} MB. Choose a lower resolution.`);
        const bytes = await get(url, { maxBytes: limits.mapBytes, timeoutMs: limits.mapTimeoutMs, signal });
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw Error(`The map ${m.channel} is not a JPEG picture.`);
        if (typeof m.entry.md5 === 'string' && m.entry.md5.length === 32 && createHash('md5').update(bytes).digest('hex') !== m.entry.md5.toLowerCase()) throw Error(`The map ${m.channel} is damaged (the checksum does not match). Try again.`);
        const name = `${m.channel}.jpg`;
        await atomicWrite(path.join(matDir(id, res), name), bytes);
        maps[m.channel] = { file: name, bytes: bytes.length, md5: createHash('md5').update(bytes).digest('hex') };
        done++;
      }
      const meta = {
        id, resolution: res, name: clean(info?.name || id), license: 'CC0', url: `https://polyhaven.com/a/${id}`,
        authors: Object.entries(info?.authors && typeof info.authors === 'object' ? info.authors : {}).map(([name, role]) => ({ name: clean(name, 60), role: clean(role, 40) })).slice(0, 8),
        filesHash: clean(info?.files_hash, 64), dimensionsCm: Array.isArray(info?.dimensions) ? info.dimensions.map((d) => Math.round(Number(d))).filter(Number.isFinite).slice(0, 2) : [],
        downloadedAt: new Date(now()).toISOString(), maps, missing: Object.keys(MAPS).filter((c) => !maps[c]), notImported: files?.Displacement ? ['displacement'] : [],
      };
      await atomicWrite(path.join(matDir(id, res), 'meta.json'), JSON.stringify(meta, null, 1));
      onProgress({ id, step: want.length, steps: want.length, done: true });
      return meta;
    } finally { busy = false; }
  }

  /** The cached files as data addresses plus their metadata. Never touches the network, so a downloaded material always works offline. */
  async function read(id, res = '1k') {
    const meta = await readJson(path.join(matDir(id, res), 'meta.json'));
    if (!meta || !meta.maps || typeof meta.maps !== 'object') throw Error('The material has not been fetched yet.');
    const images = {};
    for (const [channel, info] of Object.entries(meta.maps)) {
      if (!(channel in MAPS) || !info || !/^[a-zA-Z]+\.jpg$/.test(info.file)) continue;
      const bytes = await fs.readFile(path.join(matDir(id, res), info.file));
      if (bytes.length > limits.mapBytes || bytes[0] !== 0xff) throw Error(`The saved map ${channel} is invalid. Fetch the material again.`);
      images[channel] = 'data:image/jpeg;base64,' + bytes.toString('base64');
    }
    return { meta, images };
  }

  async function cacheInfo() { return { bytes: await cacheSize(), limit: limits.cacheBytes, materials: [...(await downloaded())].map(([id, resolutions]) => ({ id, resolutions })) }; }
  async function remove(id, res) {
    validId(id); const target = res ? matDir(id, res) : file('materials', id);
    await fs.rm(target, { recursive: true, force: true }); return true;
  }

  return { catalog, page, thumbnail, details, download, read, cacheInfo, remove, safeUrl, LIMITS, MAPS };
}

module.exports = { createPolyHaven, safeUrl, MAPS, LIMITS, HOSTS, USER_AGENT };
