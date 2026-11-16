'use strict';
/**
 * Local, voluntary feedback export. Nothing here sends anything anywhere: the artist sees the exact text first (a preview in the window),
 * and only then chooses a place to save it as a file. There is no telemetry, no upload, no scene, no picture, no prompt and no key in it.
 * What it holds: program and system versions, graphics status, simple yes/no facts about the AI setup, the last few program error messages
 * (cleaned of file paths and anything that looks like a key), and the artist's own optional note.
 */
const fs = require('node:fs/promises');
const os = require('node:os');

const MAX_NOTE = 2000, MAX_ERRORS = 20, MAX_BYTES = 200 * 1024;

/** Removes file paths, user names in paths and anything that looks like a key or a token. `secrets` are exact values to hide as well. */
function scrub(text, secrets = []) {
  let s = String(text ?? '');
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 8) s = s.split(secret).join('***');
  return s
    .replace(/(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|\b[A-Fa-f0-9]{32,}\b)/g, '***')
    .replace(/[A-Za-z]:\\[^\s"'<>|]*/g, '<path>').replace(/\\\\[^\s"'<>|]+/g, '<path>').replace(/\/(?:Users|home)\/[^\s"'<>|]*/g, '<path>').replace(/file:\/\/\/[^\s"'<>|]*/g, '<path>')
    .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{16,}/g, '<embedded data omitted>');
}

function createFeedback({ app, dialog, getWindow, secrets = () => [], keyFacts = () => ({}), now = () => new Date() }) {
  const errors = [];
  /** Remember the last few error messages of the window (cleaned). */
  function watch(win) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level < 3) return;
      errors.push({ at: now().toISOString(), message: scrub(message, secrets()).slice(0, 300) });
      if (errors.length > MAX_ERRORS) errors.shift();
    });
  }
  function build(note) {
    const cleanNote = scrub(String(note ?? '').slice(0, MAX_NOTE), secrets());
    return JSON.stringify({
      format: 'noema-feedback', version: 1, createdAt: now().toISOString(),
      note: cleanNote,
      program: { name: 'NOEMA Fractal', version: app.getVersion?.() ?? 'unknown', electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      system: { platform: process.platform, arch: process.arch, osRelease: os.release(), memoryGB: Math.round(os.totalmem() / 1073741824), cpuCount: os.cpus().length },
      graphics: (() => { try { return app.getGPUFeatureStatus?.() ?? null; } catch { return null; } })(),
      ai: keyFacts(),
      recentErrors: errors.slice(),
      notIncluded: 'No scenes, pictures, previews, drafts, AI conversations, paths or keys are included. Nothing is sent automatically: the file is only saved where you choose.',
    }, null, 2);
  }
  async function save(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw Error('The feedback is too large.');
    const doc = JSON.parse(text);
    if (doc?.format !== 'noema-feedback' || doc.version !== 1) throw Error('Invalid feedback file.');
    const day = now().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(getWindow() ?? undefined, { title: 'Save feedback', defaultPath: `noema-feedback-${day}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { saved: false };
    await fs.writeFile(r.filePath, text, 'utf8');
    return { saved: true };
  }
  return { watch, build, save, scrub };
}

module.exports = { createFeedback, scrub, MAX_NOTE };
